/* Black Market Flipper: buy in a city (optionally enchant-upgrade), sell to the Black Market. */
(function () {
  'use strict';
  const C = window.AOC, U = window.UI, COM = window.COM, h = U.h;
  const KEY = 'flipper';
  const CATS = [['w', 'Weapons'], ['a', 'Armor'], ['o', 'Off-hands'], ['x', 'Capes & bags'], ['m', 'Mounts'], ['f', 'Consumables']];

  const saved = C.Store.get(KEY, {});
  const st = Object.assign({
    direct: true, upgrade: true,
    cities: ['Fort Sterling', 'Lymhurst', 'Bridgewatch', 'Martlock', 'Thetford', 'Caerleon', 'Brecilien'],
    qualities: [1, 2, 3, 4, 5], tiers: [4, 5, 6, 7, 8], ench: [0, 1, 2, 3, 4], cats: ['w', 'a', 'o', 'x'],
    maxAge: 24, minProfit: 0, search: '', sort: 'profit', type: 'all', upCity: 'Fort Sterling', limit: 100,
  }, saved);
  const save = () => C.Store.set(KEY, st);

  let results = [], lastScan = null, shown = 100, ctl = null;
  const root = h('div', { class: 'tool' });
  const prog = U.progress();
  let resEl, statEl;

  // flip item lookups
  const flipById = new Map(window.AO.flip.map((f) => [f[0], f]));
  const baseOf = (id) => id.replace(/@\d$/, '');
  const idAt = (id, lvl) => baseOf(id) + (lvl ? '@' + lvl : '');

  function candidates() {
    const q = st.search.trim().toLowerCase();
    const T = new Set(st.tiers), E = new Set(st.ench), K = new Set(st.cats);
    return window.AO.flip.filter((f) => T.has(f[1]) && E.has(f[2]) && K.has(f[3]) && (!q || C.name(f[0]).toLowerCase().includes(q)));
  }

  async function scan() {
    if (ctl) ctl.abort();
    ctl = new AbortController();
    const signal = ctl.signal;
    const cand = candidates();
    if (!cand.length) { U.toast('No items match the tier / category filters', 'err'); return; }
    if (!st.cities.length) { U.toast('Pick at least one buy city', 'err'); return; }
    if (!st.direct && !st.upgrade) { U.toast('Enable Direct and/or Upgrade scans', 'err'); return; }
    const quals = st.qualities.slice().sort();
    if (!quals.length) { U.toast('Pick at least one quality', 'err'); return; }
    const maxAgeMs = st.maxAge * 3.6e6;
    const now = Date.now();
    const fresh = (ts) => ts != null && (now - ts) <= maxAgeMs;
    try {
      // ---- stage A: Black Market buy orders
      prog.show('Stage 1/3 – reading Black Market orders for ' + cand.length + ' items…');
      const bmRows = await C.api.prices(cand.map((f) => f[0]), ['Black Market'], quals, {
        signal, onProgress: (d, t) => prog.set(d, t, 'Stage 1/3 – Black Market ' + d + '/' + t),
      });
      const bm = new Map();
      for (const r of bmRows) {
        const at = C.parseDate(r.buy_price_max_date);
        if (r.buy_price_max > 0 && fresh(at)) bm.set(r.item_id + '|' + r.quality, { price: r.buy_price_max, at });
      }
      if (!bm.size) { results = []; lastScan = { n: cand.length, bm: 0, at: Date.now() }; prog.hide(); U.toast('No fresh Black Market orders found. Try a longer "max age".', 'err'); render(); return; }

      // ---- which city prices do we need?
      const need = new Set(); const upMats = new Set();
      const targets = [...bm.keys()].map((k) => { const [id, q] = k.split('|'); return { id, q: +q, key: k }; });
      targets.forEach((t) => {
        if (st.direct) need.add(t.id);
        const lvl = C.enchOf(t.id);
        if (st.upgrade && lvl >= 1) {
          for (let s = 0; s < lvl; s++) { const sid = idAt(t.id, s); if (flipById.has(sid)) need.add(sid); }
          for (let k = 1; k <= lvl; k++) { const u = window.AO.meta.up[idAt(t.id, k)]; if (u) upMats.add(u[0]); }
        }
      });

      // ---- stage B: city prices
      prog.show('Stage 2/3 – reading city markets…');
      const cityRows = await C.api.prices([...need], st.cities, quals, {
        signal, onProgress: (d, t) => prog.set(d, t, 'Stage 2/3 – cities ' + d + '/' + t),
      });
      const city = C.indexPrices(cityRows);
      let matIdx = new Map();
      if (upMats.size) {
        prog.show('Stage 3/3 – runes, souls & relics…');
        matIdx = C.indexPrices(await C.api.prices([...upMats], [st.upCity], [1], { signal }));
      }

      // ---- compute
      const orderMode = C.S.buyBasis === 'buy';
      const buyPrice = (rec) => (orderMode ? rec.buy : rec.sell);
      const buyAt = (rec) => (orderMode ? rec.buyAt : rec.sellAt);
      const feeIn = 1 + C.buyFee();
      const tax = C.sellTaxOnly();
      const rows = [];
      for (const t of targets) {
        const b = bm.get(t.key);
        const net = b.price * (1 - tax);
        const lvl = C.enchOf(t.id);
        if (st.direct) {
          let best = null;
          for (const c of st.cities) {
            const rec = city.get(t.id + '|' + c + '|' + t.q);
            if (!rec) continue;
            const p = buyPrice(rec), at = buyAt(rec);
            if (!(p > 0) || !fresh(at)) continue;
            if (!best || p < best.p) best = { c, p, at };
          }
          if (best) {
            const cost = best.p * feeIn;
            rows.push({ id: t.id, q: t.q, type: 'Direct', buyCity: best.c, cost, base: best.p, bm: b.price, profit: net - cost, margin: (net - cost) / cost, at: Math.min(best.at, b.at), from: null, steps: 0 });
          }
        }
        if (st.upgrade && lvl >= 1) {
          let best = null;
          for (let s = 0; s < lvl; s++) {
            const sid = idAt(t.id, s);
            // upgrade materials for steps s+1..lvl
            let up = 0, ok = true, upAt = Infinity;
            for (let k = s + 1; k <= lvl; k++) {
              const u = window.AO.meta.up[idAt(t.id, k)];
              const rec = u && matIdx.get(u[0] + '|' + st.upCity + '|1');
              const p = rec && buyPrice(rec);
              if (!(p > 0)) { ok = false; break; }
              up += p * u[1] * feeIn; upAt = Math.min(upAt, buyAt(rec) || now);
            }
            if (!ok) continue;
            for (const c of st.cities) {
              const rec = city.get(sid + '|' + c + '|' + t.q);
              if (!rec) continue;
              const p = buyPrice(rec), at = buyAt(rec);
              if (!(p > 0) || !fresh(at)) continue;
              const total = p * feeIn + up;
              if (!best || total < best.total) best = { c, p, at, total, up, s, upAt };
            }
          }
          if (best) {
            rows.push({ id: t.id, q: t.q, type: 'Upgrade', buyCity: best.c, cost: best.total, base: best.p, upCost: best.up, bm: b.price, profit: net - best.total, margin: (net - best.total) / best.total, at: Math.min(best.at, b.at, best.upAt), from: idAt(t.id, best.s), steps: lvl - best.s });
          }
        }
      }
      results = rows; shown = st.limit;
      lastScan = { n: cand.length, bm: bm.size, at: Date.now(), rows: rows.length };
      U.toast(rows.length + ' opportunities found');
    } catch (e) {
      if (e.name !== 'AbortError') U.toast(e.message || String(e), 'err');
    } finally { prog.hide(); ctl = null; }
    render();
  }

  // ------------------------------------------------------------------ results
  function view() {
    const q = st.search.trim().toLowerCase();
    let r = results.filter((x) => x.profit >= (st.minProfit || 0) && (st.type === 'all' || x.type.toLowerCase() === st.type) &&
      (!q || C.name(x.id).toLowerCase().includes(q)));
    const cmp = {
      profit: (a, b) => b.profit - a.profit,
      margin: (a, b) => b.margin - a.margin,
      update: (a, b) => b.at - a.at,
      tier: (a, b) => C.tierOf(b.id) - C.tierOf(a.id) || b.profit - a.profit,
    }[st.sort];
    return r.sort(cmp);
  }

  function render() {
    U.clear(resEl);
    const v = view();
    statEl.textContent = lastScan
      ? 'Scanned ' + lastScan.n + ' items · ' + lastScan.bm + ' with fresh Black Market orders · ' + results.length + ' flips · scan ' + C.ago(lastScan.at)
      : 'Set your filters and press Fetch flips.';
    const cols = [
      { l: 'Item', w: 'minmax(180px,2fr)' }, { l: 'Type', w: '80px' }, { l: 'Last update', w: '110px' },
      { l: 'Buy', w: 'minmax(130px,1fr)' }, { l: 'Sell (Black Market)', w: '130px' }, { l: 'Profit per item', w: '130px' }, { l: 'Margin', w: '80px' },
    ];
    const rows = v.slice(0, shown).map((x) => {
      const sub = C.QUALITIES[x.q - 1] + (x.type === 'Upgrade' ? ' · upgrade from ' + C.tierLabel(x.from) + ' (' + x.steps + ' step' + (x.steps > 1 ? 's' : '') + ')' : '');
      return [
        U.itemCell(x.id, { sub }),
        h('span', { class: 'badge ' + x.type.toLowerCase() }, x.type),
        h('span', { class: 'age ' + C.ageClass(x.at) }, C.ago(x.at)),
        h('div', null, h('span', { class: 'dot', style: { background: C.CITY_COLORS[x.buyCity] } }), ' ' + x.buyCity,
          h('div', { class: 'm' }, C.fmt(x.cost), ' ', h('span', { class: 'cur' }, 'silver')),
          x.type === 'Upgrade' ? h('div', { class: 'seen' }, C.fmt(x.base) + ' item + ' + C.fmt(x.upCost) + ' upgrade') : null),
        h('div', null, h('div', { class: 'm' }, C.fmt(x.bm), ' ', h('span', { class: 'cur' }, 'silver'))),
        U.profitSpan(x.profit),
        h('span', { class: 'm ' + (x.margin > 0 ? 'pos' : 'neg') }, C.pct(x.margin, 1)),
      ];
    });
    resEl.appendChild(COM.gridTable(cols, rows, { empty: lastScan ? 'No flips match the filters' : 'Nothing scanned yet' }));
    if (v.length > shown) resEl.appendChild(h('div', { class: 'more' }, U.btn('Show ' + Math.min(100, v.length - shown) + ' more (' + (v.length - shown) + ' hidden)', () => { shown += 100; render(); })));
  }

  function exportRows(fmt) {
    const v = view();
    if (!v.length) { U.toast('Nothing to export'); return; }
    const data = v.map((x) => ({
      item_id: x.id, name: C.name(x.id), tier: C.tierLabel(x.id), quality: C.QUALITIES[x.q - 1], type: x.type,
      buy_city: x.buyCity, buy_cost: Math.round(x.cost), black_market_price: x.bm, profit: Math.round(x.profit), margin_pct: +(x.margin * 100).toFixed(2),
      upgrade_from: x.from || '', upgrade_steps: x.steps, price_updated: new Date(x.at).toISOString(),
    }));
    if (fmt === 'json') C.download('albion-flips.json', JSON.stringify(data, null, 2), 'application/json');
    else {
      const keys = Object.keys(data[0]);
      const csv = [keys.join(',')].concat(data.map((d) => keys.map((k) => '"' + String(d[k]).replace(/"/g, '""') + '"').join(','))).join('\n');
      C.download('albion-flips.csv', csv, 'text/csv');
    }
  }

  // ------------------------------------------------------------------ layout
  const setOf = (arr) => new Set(arr);
  const bind = (key, set) => { st[key] = [...set]; save(); };
  const countLbl = h('span', { class: 'seen' });
  const updCount = () => { countLbl.textContent = candidates().length + ' items match the filters'; };
  const fchg = () => { save(); updCount(); render(); };

  const filters = h('div', null,
    h('div', { class: 'panel-grid' },
      U.field('Scan types', h('div', { class: 'col-inline' },
        U.toggle('Direct', () => st.direct, (v) => { st.direct = v; save(); }),
        U.toggle('Upgrade', () => st.upgrade, (v) => { st.upgrade = v; save(); })),
        'Direct: buy and resell as is. Upgrade: buy a lower enchant and pay runes/souls/relics to enchant it.'),
      U.field('Buy locations', U.chips(C.MARKETS.map((m) => [m, m, C.CITY_COLORS[m]]), setOf(st.cities), (s) => { bind('cities', s); })),
      U.field('Qualities', U.chips(C.QUALITIES.map((q, i) => [i + 1, q]), setOf(st.qualities), (s) => bind('qualities', s))),
      U.field('Tier', U.chips([4, 5, 6, 7, 8].map((t) => [t, 'T' + t]), setOf(st.tiers), (s) => { bind('tiers', s); fchg(); })),
      U.field('Enchantment', U.chips([0, 1, 2, 3, 4].map((e) => [e, '.' + e]), setOf(st.ench), (s) => { bind('ench', s); fchg(); })),
      U.field('Categories', U.chips(CATS, setOf(st.cats), (s) => { bind('cats', s); fchg(); }))),
    h('div', { class: 'panel-grid' },
      U.field('Max data age (hours)', U.num(() => st.maxAge, (n) => { st.maxAge = n || 24; save(); }, { w: '80px' }), 'Ignore prices older than this.'),
      U.field('Upgrade materials from', U.select(C.MARKETS, () => st.upCity, (v) => { st.upCity = v; save(); })),
      U.field('Buy method', U.select([['sell', 'Instant (lowest sell order)'], ['buy', 'Buy order (+2.5% fee)']], () => C.S.buyBasis || 'sell', (v) => { C.S.buyBasis = v; C.saveSettings(); })),
      U.field('Premium', U.toggle('Enabled', () => C.S.premium, (v) => { C.S.premium = v; C.saveSettings(); render(); }), 'Black Market sale tax: 4% premium, 8% without.'),
      U.field('Buy order fee', U.toggle('Include 2.5%', () => C.S.buyTaxes, (v) => { C.S.buyTaxes = v; C.saveSettings(); }))),
    h('div', { class: 'fetchbar' },
      U.btn('⟳ Fetch flips', scan, 'primary', 'Shortcut: A'),
      U.btn('■ Stop', () => ctl && ctl.abort(), 'ghost'),
      countLbl, prog.el));

  const refineHost = h('div');
  const resetFilters = () => { st.type = 'all'; st.search = ''; st.minProfit = 0; st.sort = 'profit'; save(); buildRefine(); updCount(); render(); };
  function buildRefine() {
    U.clear(refineHost).appendChild(h('div', { class: 'panel-grid' },
      U.field('Flip type', U.select([['all', 'All'], ['direct', 'Direct'], ['upgrade', 'Upgrade']], () => st.type, (v) => { st.type = v; fchg(); })),
      U.field('Search by name', U.num(() => st.search, (n, raw) => { st.search = raw || ''; save(); updCount(); renderSoon(); }, { w: '100%', ph: 'Search items…', text: true })),
      U.field('Sort by', U.select([['profit', 'Profit'], ['margin', 'Margin'], ['update', 'Last update'], ['tier', 'Tier']], () => st.sort, (v) => { st.sort = v; fchg(); })),
      U.field('Min profit per item', U.num(() => st.minProfit, (n) => { st.minProfit = n || 0; save(); renderSoon(); }, { w: '110px' })),
      U.field('\u00a0', U.btn('Reset filters', resetFilters, 'danger', 'Shortcut: X'))));
  }
  buildRefine();
  // the search box is a text box, so make it behave like one
  const renderSoon = U.debounce(render, 150);

  resEl = h('div', { class: 'results' });
  statEl = h('div', { class: 'seen' });
  root.append(
    h('p', { class: 'lead' }, 'Finds items that sell for more on the Black Market than they cost in the royal cities. Upgrade flips also price the runes, souls and relics needed to enchant a cheaper item. Data comes from the Albion Data Project and is only as fresh as the last player who scanned that market.'),
    U.card('Scan settings', filters),
    U.card('Filter results', refineHost),
    U.card('Top market flips', h('div', { class: 'toolbar' }, statEl, h('span', { class: 'sp' }), U.btn('Export CSV', () => exportRows('csv'), 'ghost'), U.btn('Export JSON', () => exportRows('json'), 'ghost')), resEl),
  );
  updCount();

  window.Tools = window.Tools || {};
  window.Tools.flipper = {
    title: 'Black Market Flipper', el: root, render,
    shortcuts: { a: scan, x: resetFilters },
  };
})();

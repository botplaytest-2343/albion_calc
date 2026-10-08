/* Black Market Flipper: buy in a city (optionally enchant-upgrade), or craft it yourself, and sell to the Black Market. */
(function () {
  'use strict';
  const C = window.AOC, U = window.UI, COM = window.COM, h = U.h;
  const KEY = 'flipper';
  const CATS = [['w', 'Weapons'], ['a', 'Armor'], ['o', 'Off-hands'], ['x', 'Capes & bags'], ['m', 'Mounts'], ['f', 'Consumables']];

  const saved = C.Store.get(KEY, {});
  const st = Object.assign({
    direct: false, upgrade: false, craft: false,
    cities: [], qualities: [], tiers: [], ench: [], cats: [],
    maxAge: null, minProfit: null, search: '', sort: 'profit', dir: 'desc', type: 'all', upCity: '', pageSize: 50,
  }, saved);
  st.prod = Object.assign(COM.prodDefaults(), saved.prod || {});
  const save = () => C.Store.set(KEY, st);

  let results = [], lastScan = null, page = 0, ctl = null;
  const root = h('div', { class: 'tool' });
  const prog = U.progress();
  let resEl, statEl;

  // flip item lookups
  const flipById = new Map(window.AO.flip.map((f) => [f[0], f]));
  const baseOf = (id) => id.replace(/@\d$/, '');
  const idAt = (id, lvl) => baseOf(id) + (lvl ? '@' + lvl : '');
  const craftRec = (id) => { const r = C.recipeFor(id, 0); return r && r.k === 'craft' ? r : null; };

  function candidates() {
    const q = st.search.trim().toLowerCase();
    const T = new Set(st.tiers), E = new Set(st.ench), K = new Set(st.cats);
    return window.AO.flip.filter((f) => T.has(f[1]) && E.has(f[2]) && K.has(f[3]) && (!q || C.name(f[0]).toLowerCase().includes(q)));
  }

  function validate() {
    if (!st.direct && !st.upgrade && !st.craft) return 'Turn on at least one scan type: Direct, Upgrade or Craft';
    if (!st.tiers.length || !st.ench.length || !st.cats.length) return 'Choose at least one tier, enchantment and category';
    if (!st.qualities.length) return 'Choose at least one quality';
    if (!st.cities.length) return 'Choose at least one buy location';
    if (st.upgrade && !st.upCity) return 'Choose where to buy upgrade materials (runes, souls, relics)';
    if (st.craft && !st.prod.location) return 'Choose a craft location in “Craft settings”';
    if (!C.SERVERS[C.S.server]) return 'Select a server first (top right)';
    return null;
  }

  async function scan() {
    const bad = validate();
    if (bad) { U.toast(bad, 'err'); return; }
    if (ctl) ctl.abort();
    ctl = new AbortController();
    const signal = ctl.signal;
    const cand = candidates();
    if (!cand.length) { U.toast('No items match the tier / category filters', 'err'); ctl = null; return; }
    const wantQ = new Set(st.qualities);
    const quals = [...new Set(st.qualities.concat(st.craft ? [1] : []))].sort();
    const maxAgeMs = st.maxAge > 0 ? st.maxAge * 3.6e6 : Infinity;
    const now = Date.now();
    const fresh = (ts) => ts != null && (now - ts) <= maxAgeMs;
    try {
      // ---- stage A: Black Market buy orders
      prog.show('Stage 1/4 – reading Black Market orders for ' + cand.length + ' items…');
      const bmRows = await C.api.prices(cand.map((f) => f[0]), ['Black Market'], quals, {
        signal, onProgress: (d, t) => prog.set(d, t, 'Stage 1/4 – Black Market ' + d + '/' + t),
      });
      const bm = new Map();
      for (const r of bmRows) {
        const at = C.parseDate(r.buy_price_max_date);
        if (r.buy_price_max > 0 && fresh(at)) bm.set(r.item_id + '|' + r.quality, { price: r.buy_price_max, at });
      }
      if (!bm.size) { results = []; page = 0; lastScan = { n: cand.length, bm: 0, at: Date.now() }; prog.hide(); U.toast('No fresh Black Market orders found. Try a longer “max age”.', 'err'); render(); return; }

      // ---- which city prices do we need?
      const need = new Set(); const upMats = new Set(); const craftMats = new Set();
      const targets = [...bm.keys()].map((k) => { const [id, q] = k.split('|'); return { id, q: +q, key: k }; });
      const flipTargets = targets.filter((t) => wantQ.has(t.q));
      const craftTargets = st.craft ? targets.filter((t) => t.q === 1 && craftRec(t.id)) : [];
      flipTargets.forEach((t) => {
        if (st.direct) need.add(t.id);
        const lvl = C.enchOf(t.id);
        if (st.upgrade && lvl >= 1) {
          for (let s = 0; s < lvl; s++) { const sid = idAt(t.id, s); if (flipById.has(sid)) need.add(sid); }
          for (let k = 1; k <= lvl; k++) { const u = window.AO.meta.up[idAt(t.id, k)]; if (u) upMats.add(u[0]); }
        }
      });
      craftTargets.forEach((t) => craftRec(t.id).r.forEach(([mid]) => craftMats.add(mid)));

      // ---- stage B: city prices
      let city = new Map();
      if (need.size) {
        prog.show('Stage 2/4 – reading city markets…');
        city = C.indexPrices(await C.api.prices([...need], st.cities, [...wantQ].sort(), {
          signal, onProgress: (d, t) => prog.set(d, t, 'Stage 2/4 – cities ' + d + '/' + t),
        }));
      }
      let matIdx = new Map();
      if (upMats.size) {
        prog.show('Stage 3/4 – runes, souls & relics…');
        matIdx = C.indexPrices(await C.api.prices([...upMats], [st.upCity], [1], { signal }));
      }
      let craftIdx = new Map();
      if (craftMats.size) {
        prog.show('Stage 4/4 – crafting materials…');
        craftIdx = C.indexPrices(await C.api.prices([...craftMats], st.cities, [1], {
          signal, onProgress: (d, t) => prog.set(d, t, 'Stage 4/4 – materials ' + d + '/' + t),
        }));
      }

      // ---- compute
      const orderMode = C.S.buyBasis === 'buy';
      const buyPrice = (rec) => (orderMode ? rec.buy : rec.sell);
      const buyAt = (rec) => (orderMode ? rec.buyAt : rec.sellAt);
      const feeIn = 1 + C.buyFee();
      const tax = C.sellTaxOnly();
      const rows = [];
      let skipped = 0;
      for (const t of flipTargets) {
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

      // craft it yourself: cheapest material in any selected city, return rate / focus / fee from "Craft settings"
      for (const t of craftTargets) {
        const rec = craftRec(t.id), b = bm.get(t.key);
        const picks = new Map();
        let at = b.at;
        const rrr = C.returnRate(rec, st.prod);
        const c = C.calcCraft(rec, {
          rrr, focus: st.prod.focus, feeRate: st.prod.feeRate, crafts: 1, outPrice: null,
          priceOf: (mid) => {
            let best = null;
            for (const cn of st.cities) {
              const r = craftIdx.get(mid + '|' + cn + '|1');
              if (!r) continue;
              const p = buyPrice(r), a = buyAt(r);
              if (!(p > 0) || !fresh(a)) continue;
              if (!best || p < best.p) best = { p, c: cn, a };
            }
            if (!best) return null;
            picks.set(mid, best); at = Math.min(at, best.a);
            return best.p;
          },
        });
        if (c.missing) { skipped++; continue; }
        const net = b.price * (1 - tax);
        const profit = net - c.cost;
        rows.push({
          id: t.id, q: 1, type: 'Craft', buyCity: [...new Set([...picks.values()].map((p) => p.c))].join(', '), cost: c.cost, base: c.matCost,
          mats: c.lines.map((l) => ({ id: l.id, count: l.count, nr: l.nr, city: picks.get(l.id) && picks.get(l.id).c })),
          rrr, fee: c.fee, bm: b.price, profit, margin: c.cost ? profit / c.cost : 0, at, from: null, steps: 0,
          focus: c.focusPerCraft, spf: c.focusPerCraft ? profit / c.focusPerCraft : null,
        });
      }
      results = rows; page = 0;
      lastScan = { n: cand.length, bm: bm.size, at: Date.now(), rows: rows.length, skipped };
      U.toast(rows.length + ' opportunities found' + (skipped ? ' (' + skipped + ' craft recipes skipped – missing material prices)' : ''));
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
    r = r.sort(cmp);
    if (st.dir === 'asc') r.reverse();            // least → most
    return r;
  }

  function pager(total) {
    const size = +st.pageSize || 50;
    const pages = Math.max(1, Math.ceil(total / size));
    if (page >= pages) page = pages - 1;
    const go = (p) => { page = Math.max(0, Math.min(pages - 1, p)); render(); const t = root.querySelector('.results'); if (t) t.scrollIntoView({ block: 'start' }); };
    const nums = [];
    const add = (p) => nums.push(h('button', { type: 'button', class: 'pg' + (p === page ? ' on' : ''), onclick: () => go(p) }, String(p + 1)));
    const near = new Set([0, pages - 1, page - 2, page - 1, page, page + 1, page + 2]);
    let last = -1;
    for (let p = 0; p < pages; p++) {
      if (!near.has(p)) continue;
      if (p - last > 1) nums.push(h('span', { class: 'seen' }, '…'));
      add(p); last = p;
    }
    const from = total ? page * size + 1 : 0, to = Math.min(total, (page + 1) * size);
    return h('div', { class: 'pager' },
      h('button', { type: 'button', class: 'pg', disabled: page === 0, onclick: () => go(page - 1) }, '‹'),
      nums,
      h('button', { type: 'button', class: 'pg', disabled: page >= pages - 1, onclick: () => go(page + 1) }, '›'),
      h('div', { class: 'pginfo' }, 'Showing ' + C.fmt(from) + '–' + C.fmt(to) + ' of ' + C.fmt(total) + ' · page ' + (page + 1) + ' / ' + pages));
  }

  function render() {
    U.clear(resEl);
    const v = view();
    statEl.textContent = lastScan
      ? 'Scanned ' + lastScan.n + ' items · ' + lastScan.bm + ' with fresh Black Market orders · ' + results.length + ' flips' + (lastScan.skipped ? ' · ' + lastScan.skipped + ' crafts skipped (missing prices)' : '') + ' · scan ' + C.ago(lastScan.at)
      : 'Set your filters and press Fetch flips.';
    const cols = [
      { l: 'Item', w: 'minmax(180px,2fr)' }, { l: 'Type', w: '80px' }, { l: 'Last update', w: '110px' },
      { l: 'Buy / craft', w: 'minmax(150px,1.2fr)' }, { l: 'Sell (Black Market)', w: '130px' }, { l: 'Profit per item', w: '130px' }, { l: 'Margin', w: '80px' },
    ];
    const size = +st.pageSize || 50;
    if (page * size >= v.length) page = 0;
    const rows = v.slice(page * size, (page + 1) * size).map((x) => {
      const sub = C.QUALITIES[x.q - 1] + (x.type === 'Upgrade' ? ' · upgrade from ' + C.tierLabel(x.from) + ' (' + x.steps + ' step' + (x.steps > 1 ? 's' : '') + ')' : '');
      const buyCell = x.type === 'Craft'
        ? h('div', null, h('div', { class: 'seen' }, 'Materials from ' + x.buyCity),
          h('div', { class: 'm' }, C.fmt(x.cost), ' ', h('span', { class: 'cur' }, 'silver')),
          h('div', { class: 'seen' }, 'RRR ' + C.pct(x.rrr, 1) + (x.focus ? ' · ' + C.fmt(x.focus) + ' focus' + (x.spf != null ? ' · ' + C.fmt(x.spf) + '/focus' : '') : '')),
          COM.matChips(x.mats))
        : h('div', null, h('span', { class: 'dot', style: { background: C.CITY_COLORS[x.buyCity] } }), ' ' + x.buyCity,
          h('div', { class: 'm' }, C.fmt(x.cost), ' ', h('span', { class: 'cur' }, 'silver')),
          x.type === 'Upgrade' ? h('div', { class: 'seen' }, C.fmt(x.base) + ' item + ' + C.fmt(x.upCost) + ' upgrade') : null);
      return [
        U.itemCell(x.id, { sub }),
        h('span', { class: 'badge ' + x.type.toLowerCase() }, x.type),
        h('span', { class: 'age ' + C.ageClass(x.at) }, C.ago(x.at)),
        buyCell,
        h('div', null, h('div', { class: 'm' }, C.fmt(x.bm), ' ', h('span', { class: 'cur' }, 'silver'))),
        U.profitSpan(x.profit),
        h('span', { class: 'm ' + (x.margin > 0 ? 'pos' : 'neg') }, C.pct(x.margin, 1)),
      ];
    });
    resEl.appendChild(COM.gridTable(cols, rows, { empty: lastScan ? 'No flips match the filters' : 'Nothing scanned yet' }));
    if (v.length) resEl.appendChild(pager(v.length));
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
  const craftBox = h('div', { class: 'craftbox' });
  const craftPanel = COM.prodPanel(st.prod, () => save(), { sample: () => null });

  const filters = h('div', null,
    h('div', { class: 'panel-grid' },
      U.field('Scan types', h('div', { class: 'col-inline' },
        U.toggle('Direct', () => st.direct, (v) => { st.direct = v; save(); }),
        U.toggle('Upgrade', () => st.upgrade, (v) => { st.upgrade = v; save(); }),
        U.toggle('Craft', () => st.craft, (v) => { st.craft = v; save(); craftBox.hidden = !v; })),
        'Direct: buy and resell as is. Upgrade: buy a lower enchant and pay runes/souls/relics to enchant it. Craft: make the item yourself from the cheapest materials and sell it to the Black Market.'),
      U.field('Buy locations', U.chips(C.MARKETS.map((m) => [m, m, C.CITY_COLORS[m]]), setOf(st.cities), (s) => { bind('cities', s); })),
      U.field('Qualities', U.chips(C.QUALITIES.map((q, i) => [i + 1, q]), setOf(st.qualities), (s) => bind('qualities', s))),
      U.field('Tier', U.chips([3, 4, 5, 6, 7, 8].map((t) => [t, 'T' + t]), setOf(st.tiers), (s) => { bind('tiers', s); fchg(); })),
      U.field('Enchantment', U.chips([0, 1, 2, 3, 4].map((e) => [e, '.' + e]), setOf(st.ench), (s) => { bind('ench', s); fchg(); })),
      U.field('Categories', U.chips(CATS, setOf(st.cats), (s) => { bind('cats', s); fchg(); }))),
    h('div', { class: 'panel-grid' },
      U.field('Max data age (hours)', U.num(() => st.maxAge, (n) => { st.maxAge = n; save(); }, { w: '80px', ph: 'any' }), 'Ignore prices older than this. Empty = no limit.'),
      U.field('Upgrade materials from', U.select(U.blank(C.MARKETS, 'Select city'), () => st.upCity, (v) => { st.upCity = v; save(); })),
      U.field('Buy method', U.select([['', 'Default: instant (lowest sell order)'], ['sell', 'Instant (lowest sell order)'], ['buy', 'Buy order (+2.5% fee)']], () => C.S.buyBasis, (v) => { C.S.buyBasis = v; C.saveSettings(); })),
      U.field('Premium', U.toggle('Enabled', () => C.S.premium, (v) => { C.S.premium = v; C.saveSettings(); render(); }), 'Black Market sale tax: 4% premium, 8% without.'),
      U.field('Buy order fee', U.toggle('Include 2.5%', () => C.S.buyTaxes, (v) => { C.S.buyTaxes = v; C.saveSettings(); }))),
    h('div', { class: 'fetchbar' },
      U.btn('⟳ Fetch flips', scan, 'primary', 'Shortcut: A'),
      U.btn('■ Stop', () => ctl && ctl.abort(), 'ghost'),
      countLbl, prog.el));
  craftBox.hidden = !st.craft;
  craftBox.appendChild(U.card('Craft settings', h('p', { class: 'lead' }, 'Used by Craft scans: the return rate, focus and usage fee of the station where you would craft. Materials are bought in the cheapest of your selected buy locations. Crafted items are Normal quality, so they are compared with the Normal Black Market price.'), craftPanel));

  const refineHost = h('div');
  const resetFilters = () => { st.type = 'all'; st.search = ''; st.minProfit = null; st.sort = 'profit'; st.dir = 'desc'; page = 0; save(); buildRefine(); updCount(); render(); };
  function buildRefine() {
    U.clear(refineHost).appendChild(h('div', { class: 'panel-grid' },
      U.field('Flip type', U.select([['all', 'All'], ['direct', 'Direct'], ['upgrade', 'Upgrade'], ['craft', 'Craft']], () => st.type, (v) => { st.type = v; page = 0; fchg(); })),
      U.field('Search by name', U.num(() => st.search, (n, raw) => { st.search = raw || ''; page = 0; save(); updCount(); renderSoon(); }, { w: '100%', ph: 'Search items…', text: true })),
      U.field('Sort by', U.select([['profit', 'Profit per item'], ['margin', 'Margin %'], ['update', 'Last update'], ['tier', 'Tier']], () => st.sort, (v) => { st.sort = v; page = 0; fchg(); })),
      U.field('Order', h('div', { class: 'seg' },
        h('button', { class: st.dir === 'desc' ? 'on' : '', onclick: () => { st.dir = 'desc'; page = 0; buildRefine(); fchg(); } }, 'Most → least'),
        h('button', { class: st.dir === 'asc' ? 'on' : '', onclick: () => { st.dir = 'asc'; page = 0; buildRefine(); fchg(); } }, 'Least → most')),
        'Most → least shows the most profitable (or highest value) first.'),
      U.field('Min profit per item', U.num(() => st.minProfit, (n) => { st.minProfit = n; page = 0; save(); renderSoon(); }, { w: '110px', ph: '0' })),
      U.field('Items per tab', U.select([[50, '50'], [100, '100']], () => st.pageSize, (v) => { st.pageSize = +v; page = 0; save(); render(); })),
      U.field(' ', U.btn('Reset filters', resetFilters, 'danger', 'Shortcut: X'))));
  }
  buildRefine();
  // the search box is a text box, so make it behave like one
  const renderSoon = U.debounce(render, 150);

  resEl = h('div', { class: 'results' });
  statEl = h('div', { class: 'seen' });
  root.append(
    h('p', { class: 'lead' }, 'Finds items that sell for more on the Black Market than they cost in the royal cities, or than they cost you to craft. Upgrade flips also price the runes, souls and relics needed to enchant a cheaper item. Data comes from the Albion Data Project and is only as fresh as the last player who scanned that market.'),
    U.card('Scan settings', filters),
    craftBox,
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

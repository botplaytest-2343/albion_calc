/* Crafting Planner: multi-recipe plan with overview, shopping list and weight management. */
(function () {
  'use strict';
  const C = window.AOC, U = window.UI, COM = window.COM, h = U.h;
  const KEY = 'planner';

  const saved = C.Store.get(KEY, {});
  const st = Object.assign({
    items: [], buyCity: '', sellCity: '', quality: '', checked: {}, mount: '', wtab: 'in',
    jBuy: '', jSell: '', fameBonus: null, fameMult: null,
  }, saved);
  st.prod = Object.assign(COM.prodDefaults(), saved.prod || {});
  const save = () => C.Store.set(KEY, st);
  const SELL_CITIES = U.blank(C.MARKETS.concat(['Black Market']), 'Select city');
  const BUY_CITIES = U.blank(C.MARKETS, 'Select city');
  const MOUNTS = U.blank([['25735', 'Transport Mammoth (25,735 kg)'], ['custom', 'Custom capacity']], 'Select mount');

  // ---------------------------------------------------------------- search index
  let index = null;
  function buildIndex() {
    index = [];
    const seen = new Set();
    window.AO.recipes.forEach((r) => {
      if (r.a !== 0 || seen.has(r.id)) return;
      seen.add(r.id);
      const tl = 't' + r.t + (r.e ? '.' + r.e : '');
      index.push({ id: r.id, text: (C.name(r.id) + ' ' + tl + ' ' + tl.slice(1)).toLowerCase(), t: r.t, e: r.e, k: r.k, name: C.name(r.id) });
    });
  }
  function search(q) {
    if (!index) buildIndex();
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const x of index) {
      if (toks.every((t) => x.text.includes(t))) {
        out.push(x);
        if (out.length > 400) break;
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name) || a.t - b.t || a.e - b.e);
    return out.slice(0, 40).map((x) => ({ id: x.id, title: x.name, sub: 'T' + x.t + (x.e ? '.' + x.e : '') + ' · ' + x.k }));
  }

  // ---------------------------------------------------------------- journals / fame / nutrition
  const FAME_MULT = { 4: 22.5, 5: 90, 6: 270, 7: 645, 8: 1395 };    // community-wiki base fame per non-artifact material
  function journalOf(rec) {
    const j = window.AO.journals && window.AO.journals.of[rec.id.replace(/@\d$/, '')];
    if (!j) return null;
    const max = window.AO.journals.max[j[0]][rec.t];
    if (!max) return null;
    return { type: j[0], per: j[1], max, empty: 'T' + rec.t + '_JOURNAL_' + j[0] + '_EMPTY', full: 'T' + rec.t + '_JOURNAL_' + j[0] + '_FULL' };
  }
  /** estimated crafting fame for ONE craft (before premium / bonus). An estimate: the game files do not ship exact values. */
  function fameOneCraft(rec) {
    const A = rec.r.reduce((a, [, n, nr]) => a + (nr ? 0 : n), 0);
    const fb = A * (FAME_MULT[rec.t] || 0);
    const artifact = rec.r.some((x) => x[2]) ? 500 : 0;
    return fb + artifact + (rec.e || 0) * Math.max(0, fb - 7.5 * A);
  }

  // ---------------------------------------------------------------- compute
  const qtyOf = (it) => (it.qty > 0 ? it.qty : 1);      // empty box = a single craft
  function compute() {
    const out = st.items.map((it) => {
      const rec = C.recipeFor(it.id, it.alt) || C.recipeFor(it.id, 0);
      const calcRrr = C.returnRate(rec, st.prod);
      const rrr = it.rrr != null ? it.rrr / 100 : calcRrr;
      const fee = it.fee != null ? it.fee : st.prod.feeRate;
      const c = C.calcCraft(rec, {
        rrr, focus: st.prod.focus, feeRate: fee, crafts: qtyOf(it),
        priceOf: (id) => C.book.buy[id], outPrice: C.book.sell[it.id],
      });
      const jr = journalOf(rec);
      let jFilled = 0, jProfit = null;
      if (jr) {
        jFilled = c.items * jr.per / jr.max;
        const pe = C.book.buy[jr.empty], pf = C.book.sell[jr.full];
        if (pe > 0 && pf > 0) jProfit = jFilled * (pf * (1 - C.sellFee()) - pe * (1 + C.buyFee()));
      }
      const fame = fameOneCraft(rec) * qtyOf(it) * (C.S.premium ? 1.5 : 1) * (1 + (st.fameBonus || 0) / 100) * (st.fameMult || 1);
      const nutrition = rec.v * C.NUTRITION * qtyOf(it);
      return { it, rec, c, calcRrr, rrr, fee, jr, jFilled, jProfit, fame, nutrition };
    });
    const mats = new Map();
    let cost = 0, profit = 0, focus = 0, revenue = 0, anyProfit = false, wIn = 0, wOut = 0, jProfit = 0, nutrition = 0, fame = 0, jMissing = false;
    const jTotals = new Map();
    out.forEach((o) => {
      cost += o.c.cost; focus += o.c.focus; wIn += o.c.weightIn * (1 - o.rrr); wOut += o.c.weightOut;
      if (o.c.profit != null) { profit += o.c.profit; anyProfit = true; }
      if (o.c.revenue != null) revenue += o.c.revenue;
      nutrition += o.nutrition; fame += o.fame;
      if (o.jr) { jProfit += o.jProfit || 0; if (o.jProfit == null) jMissing = true; const k = o.jr.full; const e = jTotals.get(k) || { filled: 0, empty: o.jr.empty }; e.filled += o.jFilled; jTotals.set(k, e); }
      o.c.lines.forEach((l) => { mats.set(l.id, (mats.get(l.id) || 0) + l.unitsEff); });
    });
    return { out, mats, cost, profit: anyProfit ? profit : null, focus, revenue, margin: cost ? profit / cost : null, wIn, wOut, jProfit, jMissing, jTotals, nutrition, fame };
  }

  // ---------------------------------------------------------------- render
  const root = h('div', { class: 'tool' });
  let listEl, overEl, matsEl, wtEl, fameEl;

  function render() {
    U.keepFocus(root, () => {
      const P = compute();
      sample = P.out.length ? P.out[0].rec : null;
      panel.refresh();
      renderList(P); renderOverview(P); renderMats(P); renderWeight(P); renderFame(P);
    });
  }
  const renderSoon = U.debounce(render, 120);
  const change = () => { save(); render(); };
  let sample = null;

  function move(i, d) { const j = i + d; if (j < 0 || j >= st.items.length) return; [st.items[i], st.items[j]] = [st.items[j], st.items[i]]; change(); }

  function renderList(P) {
    U.clear(listEl);
    if (!P.out.length) listEl.appendChild(h('div', { class: 'empty' }, 'No recipes yet – search above and add what you plan to craft.'));
    P.out.forEach((o, i) => {
      const { it, rec, c } = o;
      const stepper = h('div', { class: 'stepper' },
        h('button', { onclick: () => { it.qty = Math.max(1, qtyOf(it) - 1); change(); } }, '−'),
        U.num(() => it.qty, (n) => { it.qty = n == null ? null : Math.max(0, Math.floor(n)); save(); renderSoon(); }, { w: '60px', key: 'qty|' + i, ph: '1' }),
        h('button', { onclick: () => { it.qty = qtyOf(it) + 1; change(); } }, '+'));
      const rrrIn = h('div', { class: 'row-inline' },
        U.num(() => it.rrr != null ? it.rrr : +(o.calcRrr * 100).toFixed(2), (n) => { it.rrr = n; save(); renderSoon(); }, { w: '70px', key: 'rrr|' + i }),
        it.rrr != null ? h('button', { class: 'xs', title: 'Back to calculated value', onclick: () => { delete it.rrr; change(); } }, '↺') : null);
      const alt = C.byId.get(it.id).length > 1 ? h('div', { class: 'seg' },
        h('button', { class: !it.alt ? 'on' : '', onclick: () => { it.alt = 0; change(); } }, 'Regular'),
        h('button', { class: it.alt ? 'on' : '', onclick: () => { it.alt = 1; change(); } }, 'Alternative')) : null;

      const head = h('div', { class: 'ihead' },
        h('div', { class: 'ctl' }, h('button', { class: 'xs', onclick: () => move(i, -1) }, '▲'), h('button', { class: 'xs', onclick: () => move(i, 1) }, '▼')),
        h('div', { class: 'grow' }, U.itemCell(it.id)),
        h('div', { class: 'big' }, U.profitSpan(c.profit)),
        U.btn(it.open ? 'Hide' : 'Details', () => { it.open = !it.open; change(); }, 'ghost'),
        U.btn('✕', () => { st.items.splice(i, 1); change(); }, 'danger'));
      const stats = h('div', { class: 'istats' },
        U.field('Quantity (crafts)', stepper),
        U.field('Return rate (%)', rrrIn),
        U.field('Usage fee', U.num(() => it.fee != null ? it.fee : st.prod.feeRate, (n) => { it.fee = n; save(); renderSoon(); }, { w: '70px', key: 'fee|' + i })),
        U.field('Items', h('span', { class: 'm' }, C.fmt(c.items))),
        U.field('Weight', h('span', { class: 'm' }, C.fmt2(c.weightOut) + ' kg')),
        U.field('Focus cost', h('span', { class: 'm' }, C.fmt(c.focus))),
        U.field('Silver / focus', h('span', { class: 'm ' + (c.spf > 0 ? 'pos' : c.spf < 0 ? 'neg' : '') }, c.spf == null ? '–' : C.fmt(c.spf))));
      const card = h('div', { class: 'icard' }, head, stats);
      if (it.open) {
        const meta = C.book.meta['sell|' + it.id];
        card.appendChild(h('div', { class: 'idet' },
          alt,
          h('div', { class: 'dsec' }, 'Recipe item'),
          h('div', { class: 'drow' }, U.itemCell(it.id, { size: 30, sub: C.fmt(c.items) + ' items · ' + C.fmt2(c.weightOut) + ' kg' }),
            h('div', null, U.priceInput('sell', it.id, render), meta && meta.vol != null ? h('div', { class: 'seen' }, C.fmt(meta.vol) + ' sold/day') : null),
            h('div', { class: 'dnum' }, h('b', { class: 'm' }, C.fmt(c.revenue), ' silver'), h('div', { class: 'seen' }, 'after ' + C.pct(C.sellFee(), 1) + ' fees'))),
          h('div', { class: 'dsec' }, 'Required materials'),
          c.lines.map((l) => h('div', { class: 'drow' },
            U.itemCell(l.id, { size: 30, sub: C.fmt(l.count * qtyOf(it)) + ' units' + (l.nr ? ' · not returned' : '') + ' · ' + C.fmt2(l.units * (window.AO.meta.wt[l.id] || 0)) + ' kg' }),
            U.priceInput('buy', l.id, render),
            h('div', { class: 'dnum' }, h('b', { class: 'm' }, C.fmt(l.cost), ' silver'), h('div', { class: 'seen' }, '≈ ' + C.fmt(Math.ceil(l.unitsEff)) + ' to buy'))))));
      }
      listEl.appendChild(card);
    });
  }

  function renderOverview(P) {
    U.clear(overEl);
    P.out.forEach((o) => overEl.appendChild(h('div', { class: 'orow' },
      U.itemCell(o.it.id, { size: 28, sub: C.fmt(o.c.crafts) + ' crafts · ' + C.fmt(o.c.items) + ' items' }), U.profitSpan(o.c.profit))));
    const line = (l, v, cls) => h('div', { class: 'tot' }, h('span', null, l), h('b', { class: 'm ' + (cls || '') }, v));
    overEl.appendChild(h('div', { class: 'totals' },
      line('Total cost', C.fmt(P.cost) + ' silver'),
      line('Revenue (after fees)', C.fmt(P.revenue) + ' silver'),
      line('Total profit', P.profit == null ? '–' : C.fmt(P.profit) + ' silver', P.profit > 0 ? 'pos' : P.profit < 0 ? 'neg' : ''),
      line('Profit margin', P.margin == null ? '–' : C.pct(P.margin, 1), P.margin > 0 ? 'pos' : P.margin < 0 ? 'neg' : ''),
      line('Total focus cost', C.fmt(P.focus)),
      line('Station nutrition required', C.fmt(P.nutrition)),
      line('Journal profit', P.jTotals.size ? (P.jMissing ? 'set journal prices' : C.fmt(P.jProfit) + ' silver') : '–', P.jProfit > 0 ? 'pos' : P.jProfit < 0 ? 'neg' : ''),
      line('Total profit incl. journals', P.profit == null ? '–' : C.fmt(P.profit + P.jProfit) + ' silver', P.profit + P.jProfit > 0 ? 'pos' : 'neg')));
    P.jTotals.forEach((e, full) => overEl.appendChild(h('div', { class: 'orow' },
      U.itemCell(full, { size: 28, sub: 'journals filled: ' + C.fmt2(e.filled) }),
      h('div', { class: 'row-inline' }, U.priceInput('buy', e.empty, render), U.priceInput('sell', full, render)))));
  }

  function renderMats(P) {
    U.clear(matsEl);
    const arr = [...P.mats.entries()].sort((a, b) => C.name(a[0]).localeCompare(C.name(b[0])) || C.tierOf(a[0]) - C.tierOf(b[0]) || C.enchOf(a[0]) - C.enchOf(b[0]));
    if (!arr.length) { matsEl.appendChild(h('div', { class: 'empty' }, 'Add a recipe to see the shopping list')); return; }
    arr.forEach(([id, u]) => {
      const units = Math.ceil(u - 1e-9);
      const cb = h('input', { type: 'checkbox', checked: !!st.checked[id], onchange: () => { st.checked[id] = cb.checked; save(); row.classList.toggle('done', cb.checked); } });
      const row = h('label', { class: 'mrow' + (st.checked[id] ? ' done' : '') }, cb, U.itemCell(id, { size: 28, sub: C.fmt2(units * (window.AO.meta.wt[id] || 0)) + ' kg' }),
        h('div', { class: 'units' }, h('b', null, C.fmt(units)), ' units'));
      matsEl.appendChild(row);
    });
  }

  function renderFame(P) {
    U.clear(fameEl);
    fameEl.appendChild(h('div', { class: 'panel-grid' },
      U.field('Fame bonus %', U.num(() => st.fameBonus, (n) => { st.fameBonus = n; save(); renderSoon(); }, { w: '70px', ph: '0' }), 'Extra fame from events / bonuses.'),
      U.field('Fame calibration ×', U.num(() => st.fameMult, (n) => { st.fameMult = n; save(); renderSoon(); }, { w: '70px', ph: '1' }),
        'Crafting fame is an estimate (the game files do not contain exact values). Multiply by your in-game / observed ratio if it is off.')));
    P.out.forEach((o) => fameEl.appendChild(h('div', { class: 'orow' }, U.itemCell(o.it.id, { size: 28, sub: C.fmt(o.c.items) + ' items' }), h('span', { class: 'm' }, C.fmt(o.fame) + ' fame'))));
    fameEl.appendChild(h('div', { class: 'tot' }, h('span', null, 'Total crafting fame' + (C.S.premium ? ' (premium +50%)' : '')), h('b', { class: 'm' }, C.fmt(P.fame))));
  }

  function renderWeight(P) {
    U.clear(wtEl);
    const cap = st.mount === 'custom' ? (C.S.mountCap || 0) : (+st.mount || 0);
    const w = st.wtab === 'in' ? P.wIn : P.wOut;
    const pctUsed = cap ? w / cap : 0;
    wtEl.appendChild(h('div', null,
      h('div', { class: 'panel-grid' }, U.field('Mount', U.select(MOUNTS, () => st.mount, (v) => { st.mount = v; change(); })),
        st.mount === 'custom' ? U.field('Capacity (kg)', U.num(() => C.S.mountCap, (n) => { C.S.mountCap = n; C.saveSettings(); renderSoon(); }, { w: '90px' })) : null),
      h('div', { class: 'seg' },
        h('button', { class: st.wtab === 'in' ? 'on' : '', onclick: () => { st.wtab = 'in'; change(); } }, 'Input (' + C.fmt(P.wIn) + ' kg)'),
        h('button', { class: st.wtab === 'out' ? 'on' : '', onclick: () => { st.wtab = 'out'; change(); } }, 'Output (' + C.fmt(P.wOut) + ' kg)')),
      h('div', { class: 'wbar' }, h('div', { class: 'wfill' + (pctUsed > 1 ? ' over' : ''), style: { width: Math.min(100, pctUsed * 100) + '%' } })),
      h('div', { class: 'seen' }, cap ? C.pct(pctUsed, 0) + ' used · ' + C.fmt(Math.max(0, cap - w)) + ' kg free · ' + Math.max(1, Math.ceil(pctUsed)) + ' trip(s)' : 'Choose a mount or enter a capacity')));
  }

  // ---------------------------------------------------------------- controls
  const panel = COM.prodPanel(st.prod, change, { sample: () => sample });
  const picker = U.picker(search, (r) => {
    st.items.push({ id: r.id, qty: null, alt: 0, open: true });
    change(); U.toast('Added ' + r.title + ' ' + r.sub.split(' ')[0]);
  }, { ph: 'Search any recipe (e.g. "bow t6.1", "plate armor", "pork pie")…' });

  const fetchJobs = () => {
    const mats = new Set(), prods = new Set();
    st.items.forEach((it) => { prods.add(it.id); (C.recipeFor(it.id, it.alt) || { r: [] }).r.forEach(([id]) => mats.add(id)); });
    const je = new Set(), jf = new Set();
    st.items.forEach((it) => { const r = C.recipeFor(it.id, it.alt); const jr = r && journalOf(r); if (jr) { je.add(jr.empty); jf.add(jr.full); } });
    return [
      { ids: [...mats], city: st.buyCity, side: 'buy', quality: 1 },
      { ids: [...prods], city: st.sellCity, side: 'sell', quality: st.quality },
      { ids: [...je], city: st.jBuy, side: 'buy', quality: 1, opt: true },     // journals are optional: skipped until a city is chosen
      { ids: [...jf], city: st.jSell, side: 'sell', quality: 1, opt: true },
    ].filter((j) => j.ids.length && (j.city || !j.opt));
  };
  const fetchBar = COM.fetchBar(fetchJobs, render, {
    extra: U.btn('✕ Clear all', () => { if (st.items.length && confirm('Remove all recipes from the plan?')) { st.items = []; change(); } }, 'danger'),
  });

  listEl = h('div', { class: 'ilist' });
  overEl = h('div'); matsEl = h('div'); wtEl = h('div'); fameEl = h('div');
  const copyBtn = U.btn('⧉ Copy shopping list', () => {
    const P = compute();
    const txt = [...P.mats.entries()].map(([id, u]) => Math.ceil(u - 1e-9) + ' × ' + C.label(id)).join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => U.toast('Shopping list copied'), () => { prompt('Copy:', txt); });
  }, 'ghost');

  root.append(
    h('p', { class: 'lead' }, 'Build a crafting plan: add recipes, set quantities, and see total cost, profit and the shopping list. Return rate is calculated from your city, but you can override it per recipe.'),
    U.card('Add recipes', picker),
    U.card('Crafting setup', panel),
    U.card('Prices',
      h('div', { class: 'panel-grid' },
        U.field('Buy materials from', U.select(BUY_CITIES, () => st.buyCity, (v) => { st.buyCity = v; change(); })),
        U.field('Sell crafted items to', U.select(SELL_CITIES, () => st.sellCity, (v) => { st.sellCity = v; change(); })),
        U.field('Product quality', U.select(U.blank(C.QUALITIES.map((q, i) => [i + 1, q]), 'Select quality'), () => st.quality, (v) => { st.quality = v ? +v : ''; change(); })),
        U.field('Buy empty journals from', U.select(BUY_CITIES, () => st.jBuy, (v) => { st.jBuy = v; change(); })),
        U.field('Sell full journals to', U.select(BUY_CITIES, () => st.jSell, (v) => { st.jSell = v; change(); }))),
      COM.basisPanel(change), fetchBar),
    h('div', { class: 'two' },
      h('div', { class: 'col' }, U.card('Selected recipes', listEl)),
      h('div', { class: 'col' },
        U.card('Profit overview', overEl),
        U.card('Required materials', h('div', { class: 'toolbar' }, copyBtn), matsEl),
        U.collapsible('Crafting fame (estimate)', fameEl, false),
        U.collapsible('Weight management', wtEl, false))),
  );

  window.Tools = window.Tools || {};
  window.Tools.planner = {
    title: 'Crafting Planner', el: root, render,
    shortcuts: { a: () => fetchBar.run('latest'), s: () => fetchBar.run('average') },
  };
})();

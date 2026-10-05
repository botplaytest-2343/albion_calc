/* Refining Profit Calculator */
(function () {
  'use strict';
  const C = window.AOC, U = window.UI, COM = window.COM, h = U.h;
  const CATS = [['wood', 'Planks (wood)'], ['ore', 'Metal bars (ore)'], ['hide', 'Leather (hide)'], ['fiber', 'Cloth (fiber)'], ['rock', 'Stone blocks (rock)']];

  const saved = C.Store.get('refining', {});
  const st = Object.assign({
    cat: 'wood', sellCity: 'Fort Sterling', rawCity: 'Lymhurst', refCity: 'Fort Sterling', heartCity: 'Lymhurst',
    stack: false, stackFrom: 4, hideEnch: [], hideTier: [2, 3], hideMissing: false, hideNeg: false, hideAlt: false,
    sort: 'tier-desc', qty: {}, alt: {},
  }, saved);
  st.prod = Object.assign(COM.prodDefaults(), saved.prod || {});
  const save = () => C.Store.set('refining', st);

  const isRefined = (id) => { const l = C.byId.get(id); return !!(l && l[0].k === 'refine'); };
  const isHeart = (id) => /_TOKEN_/.test(id);

  function rowsFor() {
    const out = [];
    C.byId.forEach((list, id) => {
      const r0 = list[0];
      if (r0.k !== 'refine' || r0.cc !== st.cat) return;
      if (st.hideTier.includes(r0.t) || st.hideEnch.includes(r0.e)) return;
      out.push(r0.id);
    });
    return out;
  }

  function compute() {
    // all rows ascending by tier so stacking can use lower-tier crafting costs
    const ids = rowsFor();
    const asc = ids.slice().sort((a, b) => C.tierOf(a) - C.tierOf(b) || C.enchOf(a) - C.enchOf(b));
    const unit = new Map();      // id -> cost per refined item when crafted
    const res = new Map();
    for (const id of asc) {
      const list = C.byId.get(id);
      const wantAlt = !st.hideAlt && st.alt[id] && list[1];
      const rec = wantAlt ? list[1] : list[0];
      const qty = st.qty[id] == null ? 1 : st.qty[id];
      const priceOf = (rid) => {
        if (st.stack && C.tierOf(id) >= st.stackFrom && unit.has(rid)) return unit.get(rid);
        return C.book.buy[rid];
      };
      const c = C.calcCraft(rec, {
        rrr: C.returnRate(rec, st.prod), focus: st.prod.focus, feeRate: st.prod.feeRate,
        crafts: qty, priceOf, outPrice: C.book.sell[id],
      });
      if (!c.missing) unit.set(id, c.costPerItem);
      res.set(id, { rec, c, qty, hasAlt: !!list[1] });
    }
    return { ids, res };
  }

  let resultsEl, matsEl, sampleRec = null;
  const root = h('div', { class: 'tool' });

  function render() {
    U.keepFocus(root, () => {
      const { ids, res } = compute();
      sampleRec = ids.length ? res.get(ids[0]).rec : null;
      panel.refresh();
      // ---- filter + sort
      let list = ids.filter((id) => {
        const r = res.get(id);
        if (st.hideMissing && (r.c.missing || C.book.sell[id] == null)) return false;
        if (st.hideNeg && !(r.c.profit > 0)) return false;
        return true;
      });
      const key = {
        'tier-desc': (a, b) => C.tierOf(b) - C.tierOf(a) || C.enchOf(b) - C.enchOf(a),
        'tier-asc': (a, b) => C.tierOf(a) - C.tierOf(b) || C.enchOf(a) - C.enchOf(b),
        'profit': (a, b) => (res.get(b).c.profit ?? -1e18) - (res.get(a).c.profit ?? -1e18),
        'spf': (a, b) => (res.get(b).c.spf ?? -1e18) - (res.get(a).c.spf ?? -1e18),
      }[st.sort];
      list.sort(key);

      const cols = [
        { l: 'Name', w: 'minmax(160px,1.5fr)' }, { l: 'Price', w: '120px' }, { l: 'Quantity', w: '80px' },
        { l: 'Recipe', w: 'minmax(170px,1.3fr)' }, { l: 'Crafting cost', w: '120px' }, { l: 'Crafting profit', w: '130px' },
        { l: 'Focus cost', w: '80px' }, { l: 'Silver / focus', w: '80px' },
      ];
      const rows = list.map((id) => {
        const r = res.get(id), c = r.c, meta = C.book.meta['sell|' + id];
        const vol = meta && meta.vol != null ? h('div', { class: 'seen' }, C.fmt(meta.vol) + ' sold/day') : null;
        const altBtns = (r.hasAlt && !st.hideAlt) ? h('div', { class: 'seg' },
          h('button', { class: r.rec.a === 0 ? 'on' : '', onclick: () => { st.alt[id] = 0; save(); render(); } }, 'Regular'),
          h('button', { class: r.rec.a === 1 ? 'on' : '', onclick: () => { st.alt[id] = 1; save(); render(); } }, 'Alternative')) : null;
        return [
          U.itemCell(id),
          h('div', null, U.priceInput('sell', id, render), vol),
          U.num(() => r.qty, (n) => { st.qty[id] = n == null ? 0 : Math.max(0, Math.floor(n)); save(); renderSoon(); }, { w: '64px', key: 'q|' + id }),
          h('div', null, altBtns, COM.matChips(c.lines.map((l) => ({ id: l.id, count: l.count, nr: l.nr })))),
          h('div', null, h('span', { class: 'm', title: 'Material ' + C.fmt(c.matCost) + ' + station fee ' + C.fmt(c.fee) }, C.fmt(c.cost), ' ', h('span', { class: 'cur' }, 'silver')),
            c.missing ? h('div', { class: 'seen bad' }, c.missing + ' price(s) missing') : null),
          h('div', null, U.profitSpan(c.profit), c.margin != null ? h('div', { class: 'seen' }, C.pct(c.margin, 1) + ' margin') : null),
          h('span', { class: 'm' }, c.focus ? C.fmt(c.focusPerCraft) : '–'),
          h('span', { class: 'm ' + (c.spf > 0 ? 'pos' : c.spf < 0 ? 'neg' : '') }, c.spf == null ? '–' : C.fmt(c.spf)),
        ];
      });
      U.clear(resultsEl).appendChild(COM.gridTable(cols, rows, { empty: 'No recipes match the current filters' }));

      // ---- material price panel
      const mats = new Map();
      ids.forEach((id) => res.get(id).rec.r.forEach(([rid]) => mats.set(rid, true)));
      const grp = { raw: [], ref: [], heart: [] };
      [...mats.keys()].forEach((rid) => (isHeart(rid) ? grp.heart : isRefined(rid) ? grp.ref : grp.raw).push(rid));
      const byTier = (a, b) => C.tierOf(a) - C.tierOf(b) || C.enchOf(a) - C.enchOf(b);
      const box = (title, arr, city) => arr.length ? h('div', { class: 'mgroup' },
        h('div', { class: 'mgt' }, title, h('span', { class: 'seen' }, ' · ' + city)),
        h('div', { class: 'mgrid' }, arr.sort(byTier).map((rid) => h('div', { class: 'mcell' }, U.itemCell(rid, { size: 28 }), U.priceInput('buy', rid, render))))) : null;
      U.clear(matsEl).appendChild(h('div', null,
        box('Raw materials', grp.raw, st.rawCity), box('Refined (previous tier)', grp.ref, st.refCity), box('Hearts / tokens (alternative recipes)', grp.heart, st.heartCity)));
    });
  }
  const renderSoon = U.debounce(render, 120);
  const change = () => { save(); render(); };

  // ---------------------------------------------------------------- layout
  const panel = COM.prodPanel(st.prod, change, { sample: () => sampleRec });
  const cityOpt = C.MARKETS;
  const fetchJobs = () => {
    const { ids, res } = compute();
    const raw = new Set(), ref = new Set(), heart = new Set(), prod = new Set(ids);
    ids.forEach((id) => res.get(id).rec.r.forEach(([rid]) => (isHeart(rid) ? heart : isRefined(rid) ? ref : raw).add(rid)));
    return [
      { ids: [...raw], city: st.rawCity, side: 'buy', quality: 1 },
      { ids: [...ref], city: st.refCity, side: 'buy', quality: 1 },
      { ids: [...heart], city: st.heartCity, side: 'buy', quality: 1 },
      { ids: [...prod], city: st.sellCity, side: 'sell', quality: 1 },
    ].filter((j) => j.ids.length);
  };
  const fetchBar = COM.fetchBar(fetchJobs, render, {
    extra: U.btn('✕ Reset prices', () => { ids().forEach((id) => { delete C.book.sell[id]; }); C.saveBook(); render(); }, 'danger', 'Shortcut: X'),
  });
  const ids = () => compute().ids;

  const filters = h('div', { class: 'panel-grid' },
    U.field('Resource', U.select(CATS, () => st.cat, (v) => { st.cat = v; change(); })),
    U.field('Sort by', U.select([['tier-desc', 'T8 → T2'], ['tier-asc', 'T2 → T8'], ['profit', 'Profit'], ['spf', 'Silver per focus']], () => st.sort, (v) => { st.sort = v; change(); })),
    U.field('Stacking', U.toggle('Use crafted lower tier', () => st.stack, (v) => { st.stack = v; change(); }), 'Cost the previous-tier refined input at what it costs you to craft it, instead of its market price.'),
    U.field('Stack from tier', U.select([4, 5, 6, 7, 8].map((t) => [t, 'T' + t]), () => st.stackFrom, (v) => { st.stackFrom = +v; change(); })),
    U.field('Hide enchantments', U.chips([0, 1, 2, 3, 4].map((e) => [e, '.' + e]), new Set(st.hideEnch), (s) => { st.hideEnch = [...s]; change(); })),
    U.field('Hide tiers', U.chips([2, 3, 4, 5, 6, 7, 8].map((t) => [t, 'T' + t]), new Set(st.hideTier), (s) => { st.hideTier = [...s]; change(); })),
    U.field('Missing prices', U.toggle('Hide', () => st.hideMissing, (v) => { st.hideMissing = v; change(); })),
    U.field('Negative profit', U.toggle('Hide', () => st.hideNeg, (v) => { st.hideNeg = v; change(); })),
    U.field('Alternative recipes', U.toggle('Hide', () => st.hideAlt, (v) => { st.hideAlt = v; change(); })),
  );

  const sel = (key) => U.select(cityOpt, () => st[key], (v) => { st[key] = v; change(); });
  const pricesCard = U.card('Prices',
    h('div', { class: 'panel-grid' },
      U.field('Sell product to', sel('sellCity')), U.field('Buy raw from', sel('rawCity')),
      U.field('Buy refined from', sel('refCity')), U.field('Buy hearts from', sel('heartCity'))),
    COM.basisPanel(change), fetchBar);

  resultsEl = h('div', { class: 'results' });
  matsEl = h('div');
  root.append(
    h('p', { class: 'lead' }, 'Pick a resource family, fetch prices (or type your own) and compare every tier and enchantment. Price boxes are always editable.'),
    U.card('Crafting setup', filters, panel),
    pricesCard,
    U.card('Results', resultsEl),
    U.collapsible('Material prices', matsEl, false),
  );

  window.Tools = window.Tools || {};
  window.Tools.refining = {
    title: 'Refining', el: root, render,
    shortcuts: { a: () => fetchBar.run('latest'), s: () => fetchBar.run('average'), x: () => { ids().forEach((id) => { delete C.book.sell[id]; }); C.saveBook(); render(); } },
  };
})();

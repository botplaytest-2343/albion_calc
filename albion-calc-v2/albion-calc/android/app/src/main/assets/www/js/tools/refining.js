/* Refining Profit Calculator
 * - every recipe variant of an item is selectable (regular, hearts, and for stone blocks the enchanted-rock
 *   recipes: .1 rock = 2 blocks, .2 = 4, .3 = 8)
 * - "craft previous tiers yourself": the refined input of each tier is costed as if you made it yourself,
 *   all the way down to the tier you choose to start from, with a stage-by-stage cost breakdown. */
(function () {
  'use strict';
  const C = window.AOC, U = window.UI, COM = window.COM, h = U.h;
  const CATS = [['wood', 'Planks (wood)'], ['ore', 'Metal bars (ore)'], ['hide', 'Leather (hide)'], ['fiber', 'Cloth (fiber)'], ['rock', 'Stone blocks (rock)']];

  const saved = C.Store.get('refining', {});
  const st = Object.assign({
    cat: '', sellCity: '', rawCity: '', refCity: '', heartCity: '',
    chain: false, chainFrom: '', hideEnch: [], hideTier: [], hideMissing: false, hideNeg: false, hideAlt: false,
    sort: 'tier-desc', qty: {}, alt: {}, open: {},
  }, saved);
  st.prod = Object.assign(COM.prodDefaults(), saved.prod || {});
  const save = () => C.Store.set('refining', st);

  const isRefined = (id) => { const l = C.byId.get(id); return !!(l && l[0].k === 'refine'); };
  const isHeart = (id) => /_TOKEN_/.test(id);
  const byTierAsc = (a, b) => C.tierOf(a) - C.tierOf(b) || C.enchOf(a) - C.enchOf(b);

  /** short name of a recipe variant: Regular / Heart / ".1 rock ×2" */
  function variantLabel(rec) {
    if (rec.r.some(([id]) => isHeart(id))) return 'Heart';
    const m = rec.r.map(([id]) => /_ROCK_LEVEL(\d)/.exec(id)).find(Boolean);
    if (m && !rec.e) return '.' + m[1] + ' rock → ' + rec.n + ' blocks';
    return 'Regular';
  }

  const familyIds = () => {
    const out = [];
    C.byId.forEach((list, id) => { const r0 = list[0]; if (r0.k === 'refine' && r0.cc === st.cat) out.push(id); });
    return out.sort(byTierAsc);
  };
  const shownIds = (all) => all.filter((id) => !st.hideTier.includes(C.tierOf(id)) && !st.hideEnch.includes(C.enchOf(id)));
  const chainStart = () => (st.chain && +st.chainFrom) ? +st.chainFrom : 0;

  // ------------------------------------------------------------------ compute
  function compute() {
    const all = st.cat ? familyIds() : [];
    const S = chainStart();
    const info = new Map();
    const priceFor = (rid) => {
      if (S && isRefined(rid) && C.tierOf(rid) >= S) {
        const x = info.get(rid);
        if (x && x.unit != null) return { p: x.unit, own: true };
      }
      return C.book.buy[rid];
    };
    const evalRec = (rec, crafts) => C.calcCraft(rec, {
      rrr: C.returnRate(rec, st.prod), focus: st.prod.focus, feeRate: st.prod.feeRate,
      crafts, priceOf: priceFor, outPrice: C.book.sell[rec.id],
    });

    for (const id of all) {                      // ascending tier, so lower tiers are always known first
      const list = C.byId.get(id);
      const evals = list.map((rec, i) => ({ i, rec, c1: evalRec(rec, 1) })).filter((e) => !st.hideAlt || e.i === 0);
      const cheapest = () => {
        const ok = evals.filter((e) => !e.c1.missing);
        return (ok.length ? ok : evals).reduce((a, b) => (b.c1.costPerItem < a.c1.costPerItem ? b : a));
      };
      const want = st.alt[id];
      const pick = want === 'best' ? cheapest() : (evals.find((e) => e.i === (+want || 0)) || evals[0]);
      const qty = st.qty[id] > 0 ? st.qty[id] : 1;
      const c = evalRec(pick.rec, qty);
      const c1 = pick.c1, n = pick.rec.n;

      // focus and bought-material totals rolled up through crafted inputs
      let fpc = c1.focusPerCraft;
      const roll = new Map();
      c1.lines.forEach((l) => {
        if (l.own) {
          const sub = info.get(l.id);
          fpc += l.count * l.eff * sub.focusItem;
          sub.roll.forEach((u, k) => roll.set(k, (roll.get(k) || 0) + l.count * l.eff * u));
        } else roll.set(l.id, (roll.get(l.id) || 0) + l.count * l.eff);
      });
      info.set(id, {
        id, rec: pick.rec, idx: pick.i, c, c1, qty, n, unit: c.missing ? null : c.costPerItem, roll,
        focusPerCraft: fpc, focusItem: fpc / n, spf: (c.profitPerCraft != null && fpc > 0) ? c.profitPerCraft / fpc : null,
        hasOwn: c1.lines.some((l) => l.own), variants: evals.map((e) => ({ i: e.i, label: variantLabel(e.rec) })),
      });
    }
    return { all, info, S, ids: shownIds(all) };
  }

  /** stage-by-stage breakdown for `id`, bottom tier first */
  function stagesOf(info, id) {
    const out = [];
    (function walk(cid, items) {
      const x = info.get(cid), crafts = items / x.n;
      const stg = { id: cid, items, crafts, bought: [], fee: (x.c1.fee + x.c1.silver) * crafts, cost: (x.c1.fee + x.c1.silver) * crafts, unit: x.unit };
      out.push(stg);
      x.c1.lines.forEach((l) => {
        const units = l.count * l.eff * crafts;
        if (l.own) walk(l.id, units);
        else { const cost = l.cost * crafts; stg.bought.push({ id: l.id, units, cost }); stg.cost += cost; }
      });
    })(id, info.get(id).qty * info.get(id).n);
    return out.reverse();
  }

  // ------------------------------------------------------------------ render
  let resultsEl, matsEl, sampleRec = null;
  const root = h('div', { class: 'tool' });

  function breakdown(info, id) {
    const stg = stagesOf(info, id);
    const cols = [
      { l: 'Stage', w: 'minmax(170px,1.6fr)' }, { l: 'Items needed', w: '100px' }, { l: 'Crafts', w: '80px' },
      { l: 'Materials to buy', w: 'minmax(190px,2fr)' }, { l: 'Fee', w: '80px' }, { l: 'Stage cost', w: '110px' }, { l: 'Cost / item', w: '100px' },
    ];
    const rows = stg.map((s) => [
      U.itemCell(s.id, { size: 28 }),
      h('span', { class: 'm' }, C.fmt2(s.items)), h('span', { class: 'm' }, C.fmt2(s.crafts)),
      COM.matChips(s.bought.map((b) => ({ id: b.id, count: 1, shown: C.fmt2(b.units) }))),
      h('span', { class: 'm' }, C.fmt(s.fee)), h('span', { class: 'm' }, C.fmt(s.cost)),
      h('span', { class: 'm' }, s.unit == null ? '–' : C.fmt(s.unit)),
    ]);
    const total = stg.reduce((a, s) => a + s.cost, 0);
    const need = new Map();
    stg.forEach((s) => s.bought.forEach((b) => need.set(b.id, (need.get(b.id) || 0) + b.units)));
    return h('div', { class: 'brk' },
      h('div', { class: 'dsec' }, 'Cost breakdown – each tier is crafted from the one below it, starting at T' + st.chainFrom),
      COM.gridTable(cols, rows),
      h('div', { class: 'tot' }, h('span', null, 'Total for all stages'), h('b', { class: 'm' }, C.fmt(total) + ' silver')),
      h('div', { class: 'dsec' }, 'Everything you need to buy'),
      COM.matChips([...need.entries()].map(([mid, u]) => ({ id: mid, count: 1, shown: C.fmt2(u) }))));
  }

  function render() {
    U.keepFocus(root, () => {
      const { all, info, S, ids } = compute();
      sampleRec = ids.length ? info.get(ids[0]).rec : null;
      panel.refresh();

      if (!st.cat) {
        U.clear(resultsEl).appendChild(h('div', { class: 'empty' }, 'Choose a resource above to list its refining recipes.'));
        U.clear(matsEl);
        return;
      }
      const chainHint = (st.chain && !S) ? h('div', { class: 'seen bad' }, 'Choose the tier you start crafting from to enable the chain.') : null;

      let list = ids.filter((id) => {
        const r = info.get(id);
        if (st.hideMissing && (r.c.missing || C.book.sell[id] == null)) return false;
        if (st.hideNeg && !(r.c.profit > 0)) return false;
        return true;
      });
      const key = {
        'tier-desc': (a, b) => C.tierOf(b) - C.tierOf(a) || C.enchOf(b) - C.enchOf(a),
        'tier-asc': (a, b) => C.tierOf(a) - C.tierOf(b) || C.enchOf(a) - C.enchOf(b),
        'profit': (a, b) => (info.get(b).c.profit ?? -1e18) - (info.get(a).c.profit ?? -1e18),
        'spf': (a, b) => (info.get(b).spf ?? -1e18) - (info.get(a).spf ?? -1e18),
      }[st.sort];
      list.sort(key);

      const cols = [
        { l: 'Name', w: 'minmax(160px,1.5fr)' }, { l: 'Price', w: '120px' }, { l: 'Quantity', w: '80px' },
        { l: 'Recipe', w: 'minmax(190px,1.4fr)' }, { l: 'Crafting cost', w: '125px' }, { l: 'Crafting profit', w: '130px' },
        { l: 'Focus cost', w: '80px' }, { l: 'Silver / focus', w: '80px' },
      ];
      const rows = list.map((id) => {
        const r = info.get(id), c = r.c, meta = C.book.meta['sell|' + id];
        const vol = meta && meta.vol != null ? h('div', { class: 'seen' }, C.fmt(meta.vol) + ' sold/day') : null;
        const alts = r.variants.length > 1 ? h('div', { class: 'seg wrapseg' },
          r.variants.map((v) => h('button', { class: (st.alt[id] !== 'best' && r.idx === v.i) ? 'on' : '', onclick: () => { st.alt[id] = v.i; save(); render(); } }, v.label)),
          h('button', { class: st.alt[id] === 'best' ? 'on' : '', title: 'Pick whichever recipe costs least with the current prices', onclick: () => { st.alt[id] = 'best'; save(); render(); } }, 'Cheapest')) : null;
        const open = !!st.open[id] && r.hasOwn;
        const brk = r.hasOwn ? U.btn(open ? 'Hide breakdown' : 'Cost breakdown', () => { st.open[id] = !open; save(); render(); }, 'ghost xs2') : null;
        const cells = [
          U.itemCell(id),
          h('div', null, U.priceInput('sell', id, render), vol),
          U.num(() => st.qty[id], (n) => { st.qty[id] = n == null ? null : Math.max(0, Math.floor(n)); save(); renderSoon(); }, { w: '64px', key: 'q|' + id, ph: '1' }),
          h('div', null, alts, COM.matChips(c.lines.map((l) => ({ id: l.id, count: l.count, nr: l.nr }))), brk),
          h('div', null, h('span', { class: 'm', title: 'Material ' + C.fmt(c.matCost) + ' + station fee ' + C.fmt(c.fee) }, C.fmt(c.cost), ' ', h('span', { class: 'cur' }, 'silver')),
            r.hasOwn ? h('div', { class: 'seen' }, 'incl. crafted lower tiers') : null,
            c.missing ? h('div', { class: 'seen bad' }, c.missing + ' price(s) missing') : null),
          h('div', null, U.profitSpan(c.profit), c.margin != null ? h('div', { class: 'seen' }, C.pct(c.margin, 1) + ' margin') : null),
          h('span', { class: 'm' }, r.focusPerCraft ? C.fmt(r.focusPerCraft) : '–'),
          h('span', { class: 'm ' + (r.spf > 0 ? 'pos' : r.spf < 0 ? 'neg' : '') }, r.spf == null ? '–' : C.fmt(r.spf)),
        ];
        return open ? { cells, detail: breakdown(info, id) } : cells;
      });
      U.clear(resultsEl);
      if (chainHint) resultsEl.appendChild(chainHint);
      resultsEl.appendChild(COM.gridTable(cols, rows, { empty: 'No recipes match the current filters' }));

      // ---- material price panel (every variant, so alternative recipes can be priced too)
      const mats = new Map();
      const need = S ? all : ids;
      need.forEach((id) => C.byId.get(id).forEach((rec, i) => { if (!st.hideAlt || i === 0) rec.r.forEach(([rid]) => mats.set(rid, true)); }));
      const grp = { raw: [], ref: [], heart: [] };
      [...mats.keys()].forEach((rid) => {
        if (isHeart(rid)) grp.heart.push(rid);
        else if (isRefined(rid)) { if (!S || C.tierOf(rid) < S) grp.ref.push(rid); }
        else grp.raw.push(rid);
      });
      const box = (title, arr, city) => arr.length ? h('div', { class: 'mgroup' },
        h('div', { class: 'mgt' }, title, h('span', { class: 'seen' }, city ? ' · ' + city : ' · choose a city above')),
        h('div', { class: 'mgrid' }, arr.sort(byTierAsc).map((rid) => h('div', { class: 'mcell' }, U.itemCell(rid, { size: 28 }), U.priceInput('buy', rid, render))))) : null;
      U.clear(matsEl).appendChild(h('div', null,
        box('Raw materials', grp.raw, st.rawCity),
        box(S ? 'Refined materials you buy (below T' + S + ')' : 'Refined (previous tier)', grp.ref, st.refCity),
        box('Hearts / tokens (alternative recipes)', grp.heart, st.heartCity)));
    });
  }
  const renderSoon = U.debounce(render, 120);
  const change = () => { save(); render(); };

  // ------------------------------------------------------------------ layout
  const panel = COM.prodPanel(st.prod, change, { sample: () => sampleRec });
  const fetchJobs = () => {
    const { all, info, S, ids } = compute();
    const raw = new Set(), ref = new Set(), heart = new Set(), prod = new Set(ids);
    (S ? all : ids).forEach((id) => C.byId.get(id).forEach((rec, i) => {
      if (st.hideAlt && i) return;
      rec.r.forEach(([rid]) => {
        if (isHeart(rid)) heart.add(rid);
        else if (isRefined(rid)) { if (!S || C.tierOf(rid) < S) ref.add(rid); }
        else raw.add(rid);
      });
    }));
    return [
      { ids: [...raw], city: st.rawCity, side: 'buy', quality: 1 },
      { ids: [...ref], city: st.refCity, side: 'buy', quality: 1 },
      { ids: [...heart], city: st.heartCity, side: 'buy', quality: 1 },
      { ids: [...prod], city: st.sellCity, side: 'sell', quality: 1 },
    ].filter((j) => j.ids.length);
  };
  const resetSell = () => { shown().forEach((id) => { delete C.book.sell[id]; }); C.saveBook(); render(); };
  const shown = () => compute().ids;
  const fetchBar = COM.fetchBar(fetchJobs, render, {
    extra: U.btn('✕ Reset prices', resetSell, 'danger', 'Shortcut: X'),
  });

  const filters = h('div', { class: 'panel-grid' },
    U.field('Resource', U.select(U.blank(CATS, 'Select resource'), () => st.cat, (v) => { st.cat = v; st.open = {}; change(); })),
    U.field('Sort by', U.select([['tier-desc', 'T8 → T2'], ['tier-asc', 'T2 → T8'], ['profit', 'Profit'], ['spf', 'Silver per focus']], () => st.sort, (v) => { st.sort = v; change(); })),
    U.field('Craft previous tiers yourself', U.toggle('Enabled', () => st.chain, (v) => { st.chain = v; change(); }),
      'Instead of buying the refined input of each tier, cost it as something you craft yourself from the tier below, down to the tier you start from.'),
    U.field('Start crafting from tier', U.select(U.blank([2, 3, 4, 5, 6, 7, 8].map((t) => [t, 'T' + t]), 'Select tier'), () => st.chainFrom, (v) => { st.chainFrom = v; st.open = {}; change(); }),
      'The lowest tier you make yourself (from raw materials). Example: refining T5 starting from T2 makes T2, then T3, T4 and finally T5. Tiers below it are bought.'),
    U.field('Hide enchantments', U.chips([0, 1, 2, 3, 4].map((e) => [e, '.' + e]), new Set(st.hideEnch), (s) => { st.hideEnch = [...s]; change(); })),
    U.field('Hide tiers', U.chips([2, 3, 4, 5, 6, 7, 8].map((t) => [t, 'T' + t]), new Set(st.hideTier), (s) => { st.hideTier = [...s]; change(); })),
    U.field('Missing prices', U.toggle('Hide', () => st.hideMissing, (v) => { st.hideMissing = v; change(); })),
    U.field('Negative profit', U.toggle('Hide', () => st.hideNeg, (v) => { st.hideNeg = v; change(); })),
    U.field('Alternative recipes', U.toggle('Hide', () => st.hideAlt, (v) => { st.hideAlt = v; change(); }),
      'Hearts, and for stone the enchanted-rock recipes (.1 = 2 blocks, .2 = 4, .3 = 8).'),
  );

  const sel = (key) => U.select(U.blank(C.MARKETS, 'Select city'), () => st[key], (v) => { st[key] = v; change(); });
  const pricesCard = U.card('Prices',
    h('div', { class: 'panel-grid' },
      U.field('Sell product to', sel('sellCity')), U.field('Buy raw from', sel('rawCity')),
      U.field('Buy refined from', sel('refCity')), U.field('Buy hearts from', sel('heartCity'))),
    COM.basisPanel(change), fetchBar);

  resultsEl = h('div', { class: 'results' });
  matsEl = h('div');
  root.append(
    h('p', { class: 'lead' }, 'Pick a resource family, fetch prices (or type your own) and compare every tier and enchantment. Turn on “craft previous tiers yourself” to cost each tier from the one below it. Price boxes are always editable.'),
    U.card('Crafting setup', filters, panel),
    pricesCard,
    U.card('Results', resultsEl),
    U.collapsible('Material prices', matsEl, false),
  );

  window.Tools = window.Tools || {};
  window.Tools.refining = {
    title: 'Refining', el: root, render,
    shortcuts: { a: () => fetchBar.run('latest'), s: () => fetchBar.run('average'), x: resetSell },
  };
})();

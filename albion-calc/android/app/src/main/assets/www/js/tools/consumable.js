/* Cooking & Alchemy profit calculators (same engine, different recipe family). */
(function () {
  'use strict';
  const C = window.AOC, U = window.UI, COM = window.COM, h = U.h;

  const MOUNTS = [['25735', 'Transport Mammoth (25,735 kg)'], ['custom', 'Custom capacity']];

  function make(kind, o) {
    const key = o.key;
    const saved = C.Store.get(key, {});
    const st = Object.assign({
      base: o.defaultId, qty: 100, showEnch: true, selVariant: 0,
      sellCity: 'Martlock', defCity: 'Martlock', matCity: 'Martlock', cities: {}, mount: '25735',
    }, saved);
    st.prod = Object.assign(COM.prodDefaults({ feeRate: 700 }), saved.prod || {});
    const save = () => C.Store.set(key, st);

    // recipe families: base id (e=0) -> {0: rec, 1: rec, ...}
    const family = new Map();
    window.AO.recipes.forEach((r) => {
      if (r.k !== kind || r.a !== 0) return;
      const b = r.id.replace(/@\d$/, '');
      if (!family.has(b)) family.set(b, {});
      family.get(b)[r.e] = r;
    });
    if (!family.has(st.base)) st.base = [...family.keys()][0];

    const variants = () => { const f = family.get(st.base) || {}; return Object.keys(f).map(Number).sort((a, b) => a - b).filter((e) => e === 0 || st.showEnch).map((e) => f[e]); };
    const baseRec = () => (family.get(st.base) || {})[0];
    const cityFor = (id) => st.cities[id] || st.defCity;
    const isEnchMat = (id) => /_LEVEL\d/.test(id);

    const root = h('div', { class: 'tool' });
    let outEl, ingEl, weightEl, headEl;

    const calcFor = (rec) => C.calcCraft(rec, {
      rrr: C.returnRate(rec, st.prod), focus: st.prod.focus, feeRate: st.prod.feeRate,
      crafts: st.qty || 0, priceOf: (id) => C.book.buy[id], outPrice: C.book.sell[rec.id],
    });

    function render() {
      U.keepFocus(root, () => {
        const vs = variants();
        const b = baseRec();
        panel.refresh();
        // header
        U.clear(headEl);
        if (b) headEl.appendChild(h('div', { class: 'selrec' }, U.itemCell(st.base, { size: 40, sub: (b.n) + ' item' + (b.n > 1 ? 's' : '') + ' per craft · ' + C.fmt(b.f) + ' focus' })));

        // output table
        const cols = [
          { l: 'Item', w: 'minmax(150px,1.4fr)' }, { l: 'Price', w: '120px' }, { l: 'Craft cost', w: '130px' },
          { l: 'Buy orders', w: '120px' }, { l: 'Sell orders', w: '120px' }, { l: 'Nutrition / item', w: '90px' }, { l: 'Cost / item', w: '100px' }, { l: 'Crafting profit', w: '140px' }, { l: 'Focus cost', w: '90px' }, { l: 'Silver / focus', w: '90px' },
        ];
        const calcs = vs.map(calcFor);
        const rows = vs.map((rec, i) => {
          const c = calcs[i], meta = C.book.meta['sell|' + rec.id];
          return [
            U.itemCell(rec.id, { sub: rec.e ? 'Enchantment ' + rec.e : null }),
            h('div', null, U.priceInput('sell', rec.id, render), meta && meta.vol != null ? h('div', { class: 'seen' }, C.fmt(meta.vol) + ' sold/day') : null),
            h('div', null, h('span', { class: 'm' }, C.fmt(c.cost), ' ', h('span', { class: 'cur' }, 'silver')), c.missing ? h('div', { class: 'seen bad' }, c.missing + ' price(s) missing') : null),
            h('span', { class: 'm' }, meta && meta.rng ? C.fmt(meta.rng[0]) + ' – ' + C.fmt(meta.rng[1]) : '–'),
            h('span', { class: 'm' }, meta && meta.rng ? C.fmt(meta.rng[2]) + ' – ' + C.fmt(meta.rng[3]) : '–'),
            h('span', { class: 'm' }, C.fmt(rec.v * C.NUTRITION / rec.n)),
            h('span', { class: 'm' }, C.fmt(c.costPerItem)),
            h('div', null, U.profitSpan(c.profit), c.margin != null ? h('div', { class: 'seen' }, C.pct(c.margin, 1) + ' margin') : null),
            h('span', { class: 'm' }, C.fmt(c.focus)),
            h('span', { class: 'm ' + (c.spf > 0 ? 'pos' : c.spf < 0 ? 'neg' : '') }, c.spf == null ? '–' : C.fmt(c.spf)),
          ];
        });
        U.clear(outEl).appendChild(COM.gridTable(cols, rows, { empty: 'Search for a recipe above' }));

        // ingredients
        U.clear(ingEl);
        if (b) {
          const base = new Map(), ench = new Map();
          vs.forEach((rec) => {
            const keep = 1 - C.returnRate(rec, st.prod);
            rec.r.forEach(([id, n, nr]) => {
              const eff = n * (st.qty || 0) * (nr ? 1 : keep);
              if (isEnchMat(id)) ench.set(id, { id, eff });
              else if (!base.has(id)) base.set(id, { id, eff });   // the .0 recipe defines base amounts
            });
          });
          const table = (title, map, cityLabel) => {
            const c2 = [{ l: 'Name', w: 'minmax(150px,1.4fr)' }, { l: 'City', w: '150px' }, { l: 'Price', w: '120px' }, { l: 'Required', w: '90px' }, { l: 'Weight', w: '90px' }, { l: 'Total cost', w: '120px' }];
            const r2 = [...map.values()].map((x) => {
              const units = Math.ceil(x.eff);
              const p = C.book.buy[x.id] || 0;
              return [
                U.itemCell(x.id, { size: 30 }),
                U.select(C.MARKETS, () => cityFor(x.id), (v) => { st.cities[x.id] = v; save(); }),
                U.priceInput('buy', x.id, render),
                h('span', { class: 'm' }, C.fmt(units)),
                h('span', { class: 'm' }, C.fmt(units * (window.AO.meta.wt[x.id] || 0)) + ' kg'),
                h('span', { class: 'm' }, C.fmt(units * p * (1 + C.buyFee()))),
              ];
            });
            return h('div', { class: 'sub' }, h('h4', null, title), COM.gridTable(c2, r2));
          };
          ingEl.appendChild(table('Ingredients', base));
          if (ench.size) ingEl.appendChild(table(o.enchTitle, ench));
        }

        // weight
        U.clear(weightEl);
        if (b) {
          const vsAll = variants();
          const idx = Math.min(st.selVariant, vsAll.length - 1);
          const rec = vsAll[idx] || vsAll[0];
          const c = calcs[idx] || calcs[0];
          const cap = st.mount === 'custom' ? (C.S.mountCap || 0) : +st.mount;
          const inW = c.lines.reduce((a, l) => a + Math.ceil(l.unitsEff) * (window.AO.meta.wt[l.id] || 0), 0);
          const outW = c.weightOut;
          const peak = Math.max(inW, outW);
          const usedPct = cap ? peak / cap : 0;
          weightEl.appendChild(h('div', { class: 'panel-grid' },
            U.field('Variant', U.select(vsAll.map((r, i) => [i, 'T' + r.t + (r.e ? '.' + r.e : '')]), () => idx, (v) => { st.selVariant = +v; save(); render(); })),
            U.field('Mount', U.select(MOUNTS, () => st.mount, (v) => { st.mount = v; save(); render(); })),
            st.mount === 'custom' ? U.field('Capacity (kg)', U.num(() => C.S.mountCap, (n) => { C.S.mountCap = n || 0; C.saveSettings(); renderSoon(); }, { w: '90px' })) : null,
            U.field('Ingredients weight', h('span', { class: 'm' }, C.fmt(inW) + ' kg')),
            U.field('Crafted item weight', h('span', { class: 'm' }, C.fmt(outW) + ' kg')),
            U.field('Summary', h('div', { class: 'm' },
              cap ? ['Heaviest load is ', h('b', { class: usedPct > 1 ? 'neg' : 'pos' }, C.pct(usedPct, 1)), ' of capacity. To craft ',
                h('b', null, C.fmt(c.items)), ' × ', C.name(rec.id), ' you need at least ', h('b', null, String(Math.max(1, Math.ceil(usedPct)))), ' trip(s).'] : 'Set a capacity'))));
        }
      });
    }
    const renderSoon = U.debounce(render, 120);
    const change = () => { save(); render(); };

    const panel = COM.prodPanel(st.prod, change, { sample: baseRec });
    const picker = U.picker((q) => {
      const toks = q.toLowerCase().split(/\s+/);
      const out = [];
      family.forEach((f, b) => {
        const rec = f[0]; if (!rec) return;
        const text = (C.name(b) + ' t' + rec.t).toLowerCase();
        if (toks.every((t) => text.includes(t))) out.push({ id: b, title: C.name(b), sub: 'T' + rec.t });
      });
      return out.sort((a, b) => a.title.localeCompare(b.title) || a.sub.localeCompare(b.sub)).slice(0, 40);
    }, (r) => { st.base = r.id; st.selVariant = 0; change(); }, { ph: o.searchPh });

    const fetchJobs = () => {
      const vs = variants(); const b = baseRec();
      if (!b) return [];
      const byCity = new Map();
      const addMat = (id) => {
        const c = cityFor(id);
        if (!byCity.has(c)) byCity.set(c, new Set());
        byCity.get(c).add(id);
      };
      vs.forEach((rec) => rec.r.forEach(([id]) => addMat(id)));
      const jobs = [...byCity.entries()].map(([city, set]) => ({ ids: [...set], city, side: 'buy', quality: 1 }));
      jobs.push({ ids: vs.map((r) => r.id), city: st.sellCity, side: 'sell', quality: 1 });
      return jobs;
    };
    const fetchBar = COM.fetchBar(fetchJobs, render);

    headEl = h('div');
    outEl = h('div', { class: 'results' });
    ingEl = h('div');
    weightEl = h('div');

    root.append(
      h('p', { class: 'lead' }, o.lead),
      U.card('Recipe',
        h('div', { class: 'panel-grid' },
          U.field('Search ' + o.noun, picker),
          U.field('Quantity (crafts)', U.num(() => st.qty, (n) => { st.qty = n == null ? 0 : Math.max(0, Math.floor(n)); save(); renderSoon(); }, { w: '90px', key: 'qty' }), 'One craft yields several items – see the line under the recipe name.'),
          U.field('Enchanted recipes', U.toggle('Show variants', () => st.showEnch, (v) => { st.showEnch = v; change(); }))),
        headEl),
      U.card('Crafting setup', panel),
      U.card('Prices',
        h('div', { class: 'panel-grid' },
          U.field('Sell ' + o.noun + ' to', U.select(C.MARKETS, () => st.sellCity, (v) => { st.sellCity = v; change(); })),
          U.field('Default buy city', U.select(C.MARKETS, () => st.defCity, (v) => { st.defCity = v; st.cities = {}; change(); }), 'Changing this resets the per-ingredient cities below.')),
        COM.basisPanel(change), fetchBar),
      U.card(o.outTitle, outEl),
      U.collapsible('Ingredients & per-ingredient cities', ingEl, true),
      U.collapsible('Transport & weight', weightEl, false),
    );

    return {
      title: o.title, el: root, render,
      shortcuts: { a: () => fetchBar.run('latest'), s: () => fetchBar.run('average') },
    };
  }

  window.Tools = window.Tools || {};
  const hasPotion = window.AO.recipes.some((r) => r.id === 'T6_POTION_COOLDOWN');
  window.Tools.cooking = make('food', {
    key: 'cooking', title: 'Cooking', defaultId: 'T3_MEAL_PIE', noun: 'food', searchPh: 'Search food (e.g. pork pie, omelette)…',
    outTitle: 'Cooked items', enchTitle: 'Fish sauces (enchanted recipes)',
    lead: 'Pick a dish, set how many crafts you plan, then compare every enchantment level. Each ingredient can be bought in a different city.',
  });
  window.Tools.alchemy = make('potion', {
    key: 'alchemy', title: 'Alchemy', defaultId: hasPotion ? 'T6_POTION_COOLDOWN' : 'T4_POTION_HEAL', noun: 'potion', searchPh: 'Search potion (e.g. poison, healing)…',
    outTitle: 'Brewed items', enchTitle: 'Arcane extracts (enchanted recipes)',
    lead: 'Pick a potion, set how many crafts you plan, then compare every enchantment level. Each ingredient can be bought in a different city.',
  });
})();

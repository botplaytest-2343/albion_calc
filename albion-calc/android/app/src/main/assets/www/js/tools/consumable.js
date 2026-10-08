/* Cooking & Alchemy profit calculators (same engine, different recipe family).
 * Cooking can cost fish sauce as something you make yourself (chopped fish + seaweed).
 * Alchemy can cost arcane extracts as something you make yourself (animal remains, optionally by breaking artifacts). */
(function () {
  'use strict';
  const C = window.AOC, U = window.UI, COM = window.COM, h = U.h;
  const EX = window.AO.extras || { sauce: {}, chops: [], remains: [], extract: {} };

  const MOUNTS = [['25735', 'Transport Mammoth (25,735 kg)'], ['custom', 'Custom capacity']];

  function make(kind, o) {
    const key = o.key;
    const saved = C.Store.get(key, {});
    const st = Object.assign({
      base: '', qty: null, showEnch: false, selVariant: 0,
      sellCity: '', defCity: '', cities: {}, mount: '',
      self: false, selfSrc: '', selfRrr: false, fishId: '', animal: '', artPick: '', breakTo: '',
    }, saved);
    st.prod = Object.assign(COM.prodDefaults(), saved.prod || {});
    const save = () => C.Store.set(key, st);
    const qty = () => (st.qty > 0 ? st.qty : 1);

    // recipe families: base id (e=0) -> {0: rec, 1: rec, ...}
    const family = new Map();
    window.AO.recipes.forEach((r) => {
      if (r.k !== kind || r.a !== 0) return;
      const b = r.id.replace(/@\d$/, '');
      if (!family.has(b)) family.set(b, {});
      family.get(b)[r.e] = r;
    });
    if (st.base && !family.has(st.base)) st.base = '';

    const variants = () => { const f = family.get(st.base) || {}; return Object.keys(f).map(Number).sort((a, b) => a - b).filter((e) => e === 0 || st.showEnch).map((e) => f[e]); };
    const baseRec = () => (family.get(st.base) || {})[0];
    const cityFor = (id) => st.cities[id] || st.defCity;
    const isEnchMat = (id) => /_LEVEL\d/.test(id);
    const cityPick = (id) => U.select(U.blank(C.MARKETS, 'Select city'), () => cityFor(id), (v) => { st.cities[id] = v; save(); });

    // ------------------------------------------------------------------ "make it yourself" modules
    /** one input row: item, city, price box */
    const inRow = (id, sub) => h('div', { class: 'srow' }, U.itemCell(id, { size: 28, sub }), cityPick(id), U.priceInput('buy', id, render));
    const costOf = (id) => { const p = C.book.buy[id]; return p > 0 ? p * (1 + C.buyFee()) : null; };

    let SM = null;
    if (kind === 'food') {
      const fish = EX.chops.map(([id, per]) => ({ id, per })).sort((a, b) => C.tierOf(a.id) - C.tierOf(b.id) || C.name(a.id).localeCompare(C.name(b.id)));
      const fishById = new Map(fish.map((f) => [f.id, f]));
      const chopUnit = () => {
        if (st.selfSrc === 'buy') return costOf('T1_FISHCHOPS');
        if (st.selfSrc === 'make') { const f = fishById.get(st.fishId), c = f && costOf(f.id); return c == null ? null : c / f.per; }
        return null;
      };
      SM = {
        title: 'Fish sauce crafting', toggle: 'Make fish sauce myself',
        lead: 'Enchanted dishes need fish sauce. Turn this on to cost each sauce from chopped fish and seaweed instead of its market price.',
        match: (id) => { const m = /^T1_FISHSAUCE_LEVEL(\d)$/.exec(id); return m ? +m[1] : null; },
        unit(n, rrr) {
          const x = EX.sauce[n], cu = chopUnit(), w = costOf('T1_SEAWEED');
          if (!x || cu == null || w == null) return null;
          return (x.chops * cu + x.weed * w) * (st.selfRrr ? 1 - rrr : 1);
        },
        fetchIds: () => (st.selfSrc === 'buy' ? ['T1_FISHCHOPS'] : st.selfSrc === 'make' && st.fishId ? [st.fishId] : []).concat(['T1_SEAWEED']),
        body() {
          const f = fishById.get(st.fishId);
          return h('div', null,
            h('div', { class: 'panel-grid' },
              U.field('Chopped fish', h('div', { class: 'seg' },
                h('button', { class: st.selfSrc === 'buy' ? 'on' : '', onclick: () => { st.selfSrc = 'buy'; change(); } }, 'Buy chopped fish'),
                h('button', { class: st.selfSrc === 'make' ? 'on' : '', onclick: () => { st.selfSrc = 'make'; change(); } }, 'Chop fish myself'))),
              st.selfSrc === 'make' ? U.field('Fish to chop', U.select(U.blank(fish.map((x) => [x.id, C.name(x.id) + ' (T' + C.tierOf(x.id) + ') → ' + x.per + ' chops']), 'Select fish'), () => st.fishId, (v) => { st.fishId = v; change(); })) : null),
            h('div', { class: 'sgrid' },
              st.selfSrc === 'buy' ? inRow('T1_FISHCHOPS') : null,
              st.selfSrc === 'make' && f ? inRow(f.id, f.per + ' chopped fish each') : null,
              inRow('T1_SEAWEED')));
        },
      };
    } else {
      const animals = [...new Set(EX.remains.map(([id]) => id.replace(/^T\d_ALCHEMY_RARE_/, '')))];
      const animalLabel = (a) => C.name('T7_ALCHEMY_RARE_' + a).replace(/^\S+\s/, '');
      const arts = () => EX.remains.filter(([id]) => st.animal === 'any' || id.endsWith('_RARE_' + st.animal)).map(([id, per]) => ({ id, per, cpr: costOf(id) == null ? null : costOf(id) / per }));
      // Breaking an artifact gives 2 artifacts of the next tier down (T7 -> 2 x T5 -> 4 x T3); remains per artifact: T3 5, T5 10, T7 25.
      const PER = {}; EX.remains.forEach(([id, per]) => { PER[C.tierOf(id)] = per; });
      /** every way to turn one bought artifact into remains: break it straight, or step it down to a lower tier first */
      const routes = () => {
        const out = [];
        arts().forEach((a) => {
          const B = C.tierOf(a.id), p = costOf(a.id);
          [7, 5, 3].filter((T) => T <= B && PER[T]).forEach((T) => {
            const units = Math.pow(2, (B - T) / 2), remains = units * PER[T];
            out.push({ id: a.id, B, T, units, remains, cpr: p == null ? null : p / remains });
          });
        });
        return out;
      };
      const cheapestRoute = (rs) => rs.filter((r) => r.cpr != null).reduce((a, b) => (!a || b.cpr < a.cpr ? b : a), null);
      const usedRoute = () => {
        if (st.selfSrc !== 'break' || !st.animal) return null;
        const rs = routes();
        if (st.animal !== 'any' && /^[357]$/.test(st.artPick)) {
          const B = +st.artPick, T = (/^[357]$/.test(st.breakTo) && +st.breakTo < B) ? +st.breakTo : B;
          return rs.find((r) => r.B === B && r.T === T) || null;
        }
        return cheapestRoute(rs);
      };
      const routeText = (r) => {
        const parts = ['1 × T' + r.B];
        for (let t = r.B - 2; t >= r.T; t -= 2) parts.push(Math.pow(2, (r.B - t) / 2) + ' × T' + t);
        parts.push(C.fmt(r.remains) + ' remains');
        return parts.join(' → ');
      };
      const remainsUnit = () => {
        if (st.selfSrc === 'buy') return costOf('T1_ALCHEMY_COMMON');
        const r = usedRoute();
        return r && r.cpr != null ? r.cpr : null;
      };
      SM = {
        title: 'Arcane extract crafting', toggle: 'Make arcane extracts myself',
        lead: 'Arcane extracts are made from rare animal remains, which you get by breaking animal artifacts (Rugged T3 = 5 remains, Fine T5 = 10, Excellent T7 = 25), and a high-tier artifact can first be broken down to lower tiers (T7 → T5 → T3). Turn this on to cost extracts yourself.',
        match: (id) => { const m = /^T1_ALCHEMY_EXTRACT_LEVEL(\d)$/.exec(id); return m ? +m[1] : null; },
        unit(n, rrr) {
          const x = EX.extract[n], ru = remainsUnit();
          if (!x || ru == null) return null;
          return x.remains * ru * (st.selfRrr ? 1 - rrr : 1);
        },
        fetchIds: () => (st.selfSrc === 'buy' ? ['T1_ALCHEMY_COMMON'] : st.selfSrc === 'break' && st.animal ? arts().map((x) => x.id) : []),
        body() {
          const list = st.selfSrc === 'break' && st.animal ? arts() : [];
          const used = usedRoute();
          const best = used ? { id: used.id } : null;
          const tierBtn = (v, l) => h('button', { class: st.artPick === v ? 'on' : '', onclick: () => { st.artPick = v; st.breakTo = ''; change(); } }, l);
          const toBtn = (v, l) => h('button', { class: st.breakTo === v ? 'on' : '', onclick: () => { st.breakTo = v; change(); } }, l);
          const pickedB = (st.animal && st.animal !== 'any' && /^[357]$/.test(st.artPick)) ? +st.artPick : 0;
          return h('div', null,
            h('div', { class: 'panel-grid' },
              U.field('Animal remains', h('div', { class: 'seg' },
                h('button', { class: st.selfSrc === 'buy' ? 'on' : '', onclick: () => { st.selfSrc = 'buy'; change(); } }, 'Buy remains'),
                h('button', { class: st.selfSrc === 'break' ? 'on' : '', onclick: () => { st.selfSrc = 'break'; change(); } }, 'Break artifacts myself'))),
              st.selfSrc === 'break' ? U.field('Artifact', U.select(U.blank([['any', 'Any animal (cheapest)']].concat(animals.map((a) => [a, animalLabel(a)])), 'Select animal'), () => st.animal, (v) => { st.animal = v; change(); })) : null,
              st.selfSrc === 'break' && st.animal && st.animal !== 'any' ? U.field('Artifact tier to buy', h('div', { class: 'seg' }, tierBtn('', 'Cheapest'), tierBtn('3', 'T3'), tierBtn('5', 'T5'), tierBtn('7', 'T7'))) : null,
              pickedB > 3 ? U.field('Break it down first to', h('div', { class: 'seg' }, toBtn('', 'Straight to remains'), pickedB > 5 ? toBtn('5', 'T5') : null, toBtn('3', 'T3')),
                'Breaking an artifact gives 2 artifacts of the next tier down (T7 → 2 × T5 → 4 × T3). Each of those is then broken for remains.') : null),
            st.selfSrc === 'buy' ? h('div', { class: 'sgrid' }, inRow('T1_ALCHEMY_COMMON')) : null,
            list.length ? h('div', { class: 'sgrid' }, list.map((x) => h('div', { class: 'srow' + (best && best.id === x.id ? ' best' : '') },
              U.itemCell(x.id, { size: 28, sub: x.per + ' remains each' + (x.cpr != null ? ' · ' + C.fmt(x.cpr) + ' per remains' : '') + (best && best.id === x.id ? ' · cheapest' : '') }),
              cityPick(x.id), U.priceInput('buy', x.id, render)))) : null,
            list.length ? h('div', { class: 'sub' }, h('h4', null, 'Break-down routes (cost per remains)'),
              COM.gridTable([{ l: 'Artifact', w: 'minmax(150px,1.2fr)' }, { l: 'Route', w: 'minmax(220px,2fr)' }, { l: 'Remains', w: '80px' }, { l: 'Cost / remains', w: '110px' }],
                routes().sort((a, b) => (a.cpr == null) - (b.cpr == null) || a.cpr - b.cpr).slice(0, st.animal === 'any' ? 10 : 12).map((r) => ({
                  cls: used && used.id === r.id && used.T === r.T ? 'usedrow' : '',
                  cells: [U.itemCell(r.id, { size: 26 }), h('span', null, routeText(r)), h('span', { class: 'm' }, C.fmt(r.remains)),
                    h('span', { class: 'm' }, r.cpr == null ? '–' : C.fmt(r.cpr) + (used && used.id === r.id && used.T === r.T ? '  ◀ used' : ''))],
                })), { empty: 'Enter artifact prices to compare routes' }),
              h('div', { class: 'seen' }, 'Stepping down never costs silver or focus, but it gives fewer remains than breaking the high-tier artifact directly (T7 = 25 remains vs 20 via T5 or T3) – this table shows the real cost of each route.')) : null);
        },
      };
    }
    const selfOn = () => !!(SM && st.self);

    // ------------------------------------------------------------------ calculation
    const root = h('div', { class: 'tool' });
    let outEl, ingEl, weightEl, headEl, selfBody;
    const priceOfFor = (rec) => (id) => {
      if (selfOn()) {
        const lv = SM.match(id);
        if (lv != null) { const u = SM.unit(lv, C.returnRate(rec, st.prod)); return u == null ? null : { p: u, own: true }; }
      }
      return C.book.buy[id];
    };
    const calcFor = (rec) => C.calcCraft(rec, {
      rrr: C.returnRate(rec, st.prod), focus: st.prod.focus, feeRate: st.prod.feeRate,
      crafts: qty(), priceOf: priceOfFor(rec), outPrice: C.book.sell[rec.id],
    });

    function render() {
      U.keepFocus(root, () => {
        const vs = variants();
        const b = baseRec();
        panel.refresh();
        // header
        U.clear(headEl);
        if (b) headEl.appendChild(h('div', { class: 'selrec' }, U.itemCell(st.base, { size: 40, sub: (b.n) + ' item' + (b.n > 1 ? 's' : '') + ' per craft · ' + C.fmt(b.f) + ' focus' })));
        else headEl.appendChild(h('div', { class: 'seen' }, 'Search for a recipe above to begin.'));

        // output table
        const cols = [
          { l: 'Item', w: 'minmax(150px,1.4fr)' }, { l: 'Price', w: '120px' }, { l: 'Craft cost', w: '130px' },
          { l: 'Buy orders', w: '120px' }, { l: 'Sell orders', w: '120px' }, { l: 'Nutrition / item', w: '90px' },
          { l: 'Cost / item', w: '100px' }, { l: 'Crafting profit', w: '140px' }, { l: 'Focus cost', w: '90px' }, { l: 'Silver / focus', w: '90px' },
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
              const eff = n * qty() * (nr ? 1 : keep);
              if (isEnchMat(id)) ench.set(id, { id, eff, rec });
              else if (!base.has(id)) base.set(id, { id, eff, rec });   // the .0 recipe defines base amounts
            });
          });
          const table = (title, map) => {
            const c2 = [{ l: 'Name', w: 'minmax(150px,1.4fr)' }, { l: 'City', w: '150px' }, { l: 'Price', w: '120px' }, { l: 'Required', w: '90px' }, { l: 'Weight', w: '90px' }, { l: 'Total cost', w: '120px' }];
            const r2 = [...map.values()].map((x) => {
              const units = Math.ceil(x.eff);
              const lv = selfOn() ? SM.match(x.id) : null;
              const own = lv != null ? SM.unit(lv, C.returnRate(x.rec, st.prod)) : null;
              const p = lv != null ? (own || 0) : (C.book.buy[x.id] || 0);
              return [
                U.itemCell(x.id, { size: 30 }),
                lv != null ? h('span', { class: 'seen' }, 'made by you') : cityPick(x.id),
                lv != null ? h('div', null, h('span', { class: 'm' }, own == null ? '–' : C.fmt(own)), h('div', { class: 'seen' }, own == null ? 'set prices below' : 'cost to make')) : U.priceInput('buy', x.id, render),
                h('span', { class: 'm' }, C.fmt(units)),
                h('span', { class: 'm' }, C.fmt(units * (window.AO.meta.wt[x.id] || 0)) + ' kg'),
                h('span', { class: 'm' }, C.fmt(units * p * (lv != null ? 1 : 1 + C.buyFee()))),
              ];
            });
            return h('div', { class: 'sub' }, h('h4', null, title), COM.gridTable(c2, r2));
          };
          ingEl.appendChild(table('Ingredients', base));
          if (ench.size) ingEl.appendChild(table(o.enchTitle + (selfOn() ? ' – made by you' : ''), ench));
        }

        // self-made inputs
        if (SM) {
          U.clear(selfBody);
          if (st.self) {
            selfBody.appendChild(SM.body());
            const rrr = b ? C.returnRate(b, st.prod) : 0;
            const lines = [1, 2, 3].map((n) => { const u = SM.unit(n, rrr); const id = (kind === 'food' ? 'T1_FISHSAUCE_LEVEL' : 'T1_ALCHEMY_EXTRACT_LEVEL') + n; return h('div', { class: 'orow' }, U.itemCell(id, { size: 28 }), h('span', { class: 'm' }, u == null ? 'set the prices above' : C.fmt(u) + ' silver each')); });
            selfBody.appendChild(h('div', { class: 'sub' }, h('h4', null, 'Cost to make one'), lines));
          }
        }

        // weight
        U.clear(weightEl);
        if (b) {
          const vsAll = variants();
          const idx = Math.min(st.selVariant, vsAll.length - 1);
          const rec = vsAll[idx] || vsAll[0];
          const c = calcs[idx] || calcs[0];
          const cap = st.mount === 'custom' ? (C.S.mountCap || 0) : (+st.mount || 0);
          const inW = c.lines.reduce((a, l) => a + Math.ceil(l.unitsEff) * (window.AO.meta.wt[l.id] || 0), 0);
          const outW = c.weightOut;
          const peak = Math.max(inW, outW);
          const usedPct = cap ? peak / cap : 0;
          weightEl.appendChild(h('div', { class: 'panel-grid' },
            U.field('Variant', U.select(vsAll.map((r, i) => [i, 'T' + r.t + (r.e ? '.' + r.e : '')]), () => idx, (v) => { st.selVariant = +v; save(); render(); })),
            U.field('Mount', U.select(U.blank(MOUNTS, 'Select mount'), () => st.mount, (v) => { st.mount = v; save(); render(); })),
            st.mount === 'custom' ? U.field('Capacity (kg)', U.num(() => C.S.mountCap, (n) => { C.S.mountCap = n; C.saveSettings(); renderSoon(); }, { w: '90px' })) : null,
            U.field('Ingredients weight', h('span', { class: 'm' }, C.fmt(inW) + ' kg')),
            U.field('Crafted item weight', h('span', { class: 'm' }, C.fmt(outW) + ' kg')),
            U.field('Summary', h('div', { class: 'm' },
              cap ? ['Heaviest load is ', h('b', { class: usedPct > 1 ? 'neg' : 'pos' }, C.pct(usedPct, 1)), ' of capacity. To craft ',
                h('b', null, C.fmt(c.items)), ' × ', C.name(rec.id), ' you need at least ', h('b', null, String(Math.max(1, Math.ceil(usedPct)))), ' trip(s).'] : 'Choose a mount to see trips'))));
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
      vs.forEach((rec) => rec.r.forEach(([id]) => { if (!(selfOn() && SM.match(id) != null)) addMat(id); }));
      if (selfOn()) SM.fetchIds().forEach(addMat);
      const jobs = [...byCity.entries()].map(([city, set]) => ({ ids: [...set], city, side: 'buy', quality: 1 }));
      jobs.push({ ids: vs.map((r) => r.id), city: st.sellCity, side: 'sell', quality: 1 });
      return jobs;
    };
    const fetchBar = COM.fetchBar(fetchJobs, render);

    headEl = h('div');
    outEl = h('div', { class: 'results' });
    ingEl = h('div');
    weightEl = h('div');
    selfBody = h('div');

    root.append(...[
      h('p', { class: 'lead' }, o.lead),
      U.card('Recipe',
        h('div', { class: 'panel-grid' },
          U.field('Search ' + o.noun, picker),
          U.field('Quantity (crafts)', U.num(() => st.qty, (n) => { st.qty = n == null ? null : Math.max(0, Math.floor(n)); save(); renderSoon(); }, { w: '90px', key: 'qty', ph: '1' }), 'One craft yields several items – see the line under the recipe name. Leave empty to see a single craft.'),
          U.field('Enchanted recipes', U.toggle('Show variants', () => st.showEnch, (v) => { st.showEnch = v; change(); }))),
        headEl),
      U.card('Crafting setup', panel),
      U.card('Prices',
        h('div', { class: 'panel-grid' },
          U.field('Sell ' + o.noun + ' to', U.select(U.blank(C.MARKETS, 'Select city'), () => st.sellCity, (v) => { st.sellCity = v; change(); })),
          U.field('Default buy city', U.select(U.blank(C.MARKETS, 'Select city'), () => st.defCity, (v) => { st.defCity = v; st.cities = {}; change(); }), 'Changing this resets the per-ingredient cities below.')),
        COM.basisPanel(change), fetchBar),
      SM ? U.card(SM.title,
        h('p', { class: 'lead' }, SM.lead),
        h('div', { class: 'panel-grid' },
          U.field(SM.toggle, U.toggle('Enabled', () => st.self, (v) => { st.self = v; change(); })),
          U.field('Return rate on this crafting', U.toggle('Apply', () => st.selfRrr, (v) => { st.selfRrr = v; change(); }), 'Apply the calculated (or custom) return rate to the ingredients of this extra crafting step too.')),
        selfBody) : null,
      U.card(o.outTitle, outEl),
      U.collapsible('Ingredients & per-ingredient cities', ingEl, true),
      U.collapsible('Transport & weight', weightEl, false),
    ].filter(Boolean));

    return {
      title: o.title, el: root, render,
      shortcuts: { a: () => fetchBar.run('latest'), s: () => fetchBar.run('average') },
    };
  }

  window.Tools = window.Tools || {};
  window.Tools.cooking = make('food', {
    key: 'cooking', title: 'Cooking', noun: 'food', searchPh: 'Search food (e.g. pork pie, omelette)…',
    outTitle: 'Cooked items', enchTitle: 'Fish sauces (enchanted recipes)',
    lead: 'Pick a dish, set how many crafts you plan, then compare every enchantment level. Each ingredient can be bought in a different city, and fish sauce can be costed as something you make yourself.',
  });
  window.Tools.alchemy = make('potion', {
    key: 'alchemy', title: 'Alchemy', noun: 'potion', searchPh: 'Search potion (e.g. poison, healing)…',
    outTitle: 'Brewed items', enchTitle: 'Arcane extracts (enchanted recipes)',
    lead: 'Pick a potion, set how many crafts you plan, then compare every enchantment level. Each ingredient can be bought in a different city, and arcane extracts can be costed from animal remains you get by breaking artifacts yourself.',
  });
})();

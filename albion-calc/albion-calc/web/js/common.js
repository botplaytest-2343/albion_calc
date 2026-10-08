/* Shared panels used by several tools. */
(function () {
  'use strict';
  const C = window.AOC, U = window.UI, h = U.h;

  const LOCATIONS = ['Fort Sterling', 'Lymhurst', 'Bridgewatch', 'Martlock', 'Thetford', 'Caerleon', 'Brecilien',
    "Arthur's Rest", "Merlyn's Rest", "Morgana's Rest", 'Hideout', 'Island'];

  /** state shape created by prodDefaults() */
  function prodDefaults(over) {
    return Object.assign({
      location: '', hideoutPb: null, feeRate: null, daily: 0,
      production: false, focus: false, customOn: false, customRrr: null,
    }, over || {});
  }

  /**
   * Production / return-rate / fee / tax panel.
   * st: state object (mutated).  onChange(): called after any change.
   * o.sample: () => recipe used to show the calculated RRR (optional)
   */
  function prodPanel(st, onChange, o = {}) {
    const rrrBox = h('div', { class: 'rrrbox' });
    const refresh = () => {
      U.clear(rrrBox);
      const rec = o.sample && o.sample();
      if (rec && !st.customOn) {
        const pb = C.productionBonus(rec, st);
        rrrBox.appendChild(h('span', { class: 'rrrv' }, C.pct(C.rrrFromPb(pb.pb))));
        rrrBox.appendChild(h('span', { class: 'rrrs' }, ' PB ' + C.pct(pb.pb, 0) + (pb.spec ? ' (city ' + C.pct(pb.base, 0) + ' + specialty ' + C.pct(pb.spec, 0) + ')' : '')));
      } else if (st.customOn) rrrBox.appendChild(h('span', { class: 'rrrv' }, C.pct((st.customRrr || 0) / 100)));
      else rrrBox.appendChild(h('span', { class: 'rrrs' }, 'per recipe'));
    };
    const chg = () => { refresh(); onChange(); };
    const hideout = h('div', { class: 'fld', hidden: st.location !== 'Hideout' });
    hideout.appendChild(h('div', { class: 'fl' }, 'Hideout bonus %', h('span', { class: 'hint', title: 'Total production bonus of your hideout / island station, before focus' }, 'ⓘ')));
    hideout.appendChild(U.num(() => st.hideoutPb, (n) => { st.hideoutPb = n; chg(); }, { w: '80px', ph: '0' }));

    const root = h('div', { class: 'panel-grid' },
      U.field('Location', U.select(U.blank(LOCATIONS, 'Select location'), () => st.location, (v) => { st.location = v; hideout.hidden = v !== 'Hideout'; chg(); }),
        'Base crafting bonus comes from your station. City specialty bonuses are read from the game data.'),
      hideout,
      U.field('Usage fee (silver)', U.num(() => st.feeRate, (n) => { st.feeRate = n; chg(); }, { w: '90px', ph: '0' }),
        'The fee shown on the crafting station: silver per 100 nutrition.'),
      U.field('Daily bonus', U.select([[0, 'No daily bonus'], [0.1, '+10%'], [0.2, '+20%']], () => st.daily, (v) => { st.daily = +v; chg(); })),
      U.field('Calculated RRR', rrrBox, 'Resource return rate = 1 − 1 / (1 + production bonus)'),
      U.field('Custom RRR', h('div', { class: 'row-inline' },
        U.toggle('Override', () => st.customOn, (v) => { st.customOn = v; chg(); }),
        U.num(() => st.customRrr, (n) => { st.customRrr = n; chg(); }, { w: '70px', ph: '%' }))),
      U.field('Focus points', U.toggle('Use focus', () => st.focus, (v) => { st.focus = v; chg(); })),
      U.field('Production bonus', U.toggle('City specialty', () => st.production, (v) => { st.production = v; chg(); })),
      U.field('Focus efficiency', U.num(() => C.S.focusEff, (n) => { C.S.focusEff = n; C.saveSettings(); chg(); }, { w: '80px', ph: '0' }),
        'Total focus-efficiency points from your masteries/specs. Focus cost is halved every 10,000 points. Leave 0 if unsure.'),
      U.field('Premium', U.toggle('Enabled', () => C.S.premium, (v) => { C.S.premium = v; C.saveSettings(); chg(); })),
      U.field('Sell order', U.toggle('Include taxes', () => C.S.sellTaxes, (v) => { C.S.sellTaxes = v; C.saveSettings(); chg(); }),
        'Sales tax 4% (premium) or 8% + 2.5% order setup fee'),
      U.field('Buy order', U.toggle('Include taxes', () => C.S.buyTaxes, (v) => { C.S.buyTaxes = v; C.saveSettings(); chg(); }),
        '2.5% setup fee on buy orders'),
    );
    refresh();
    root.refresh = refresh;
    return root;
  }

  /** how fetched prices are read: buy side & sell side */
  function basisPanel(onChange) {
    const S = C.S;
    return h('div', { class: 'panel-grid' },
      U.field('Material price basis', U.select([['', 'Default: lowest sell order'], ['sell', 'Lowest sell order (buy instantly)'], ['buy', 'Highest buy order (place order)']], () => S.buyBasis, (v) => { S.buyBasis = v; C.saveSettings(); onChange && onChange(); })),
      U.field('Product price basis', U.select([['', 'Default: lowest sell order'], ['sell', 'Lowest sell order (list at)'], ['buy', 'Highest buy order (sell instantly)']], () => S.sellBasis, (v) => { S.sellBasis = v; C.saveSettings(); onChange && onChange(); })),
    );
  }

  function cityOptions(extra) { return (extra || []).concat(C.MARKETS); }

  /** fetch buttons row. build(mode) must return jobs [{ids,city,side,quality}] */
  function fetchBar(build, after, o = {}) {
    const prog = U.progress();
    let ctl = null;
    const run = async (mode) => {
      if (ctl) { ctl.abort(); }
      ctl = new AbortController();
      const jobs = build(mode);
      if (!jobs.length) { U.toast('Nothing to fetch yet – choose a recipe and cities first'); return; }
      if (jobs.some((j) => !j.city || !j.quality)) { U.toast('Choose a city (and quality) for every price you want to fetch', 'err'); return; }
      if (!C.SERVERS[C.S.server]) { U.toast('Select a server first (top right)', 'err'); return; }
      prog.show('Contacting AODP (' + C.SERVERS[C.S.server].label + ')…');
      try {
        const n = await C.fetchBook(jobs, mode, {
          signal: ctl.signal,
          instantSell: C.S.sellBasis === 'buy', buyOrders: C.S.buyBasis === 'buy',
          onProgress: (d, t) => prog.set(d, t, 'Request ' + d + ' / ' + t),
        });
        U.toast(n ? 'Updated ' + n + ' prices' : 'No data returned – set prices manually', n ? '' : 'err');
      } catch (e) {
        if (e.name !== 'AbortError') U.toast(e.message || String(e), 'err');
      } finally { prog.hide(); ctl = null; }
      after && after();
    };
    const el = h('div', { class: 'fetchbar' },
      U.btn('⟳ Fetch latest prices', () => run('latest'), 'primary', 'Shortcut: A'),
      U.btn('⟳ Fetch average prices', () => run('average'), '', 'Shortcut: S (7-day average, daily volume)'),
      o.extra,
      prog.el);
    el.run = run;
    return el;
  }

  /** responsive grid table. cols: [{l: label, w: css width, cls}] rows: arrays of nodes */
  function gridTable(cols, rows, o = {}) {
    const tpl = cols.map((c) => c.w || 'minmax(0,1fr)').join(' ');
    const root = h('div', { class: 'gt ' + (o.cls || '') });
    root.style.setProperty('--cols', tpl);
    const head = h('div', { class: 'gh' });
    cols.forEach((c) => head.appendChild(h('div', { class: 'gc ' + (c.cls || '') }, c.l)));
    root.appendChild(head);
    rows.forEach((r) => {
      const cells = Array.isArray(r) ? r : r.cells;
      const row = h('div', { class: 'gr ' + (r.cls || '') });
      cells.forEach((cell, i) => {
        const col = cols[i] || {};
        row.appendChild(h('div', { class: 'gc ' + (col.cls || ''), 'data-l': col.l || '' }, cell));
      });
      root.appendChild(row);
      if (r.detail) root.appendChild(h('div', { class: 'gdet' }, r.detail));
    });
    if (!rows.length) root.appendChild(h('div', { class: 'gempty' }, o.empty || 'Nothing to show'));
    return root;
  }

  /** compact material chips: icon × count */
  function matChips(lines) {
    return h('div', { class: 'mats' }, lines.map((l) => h('span', { class: 'mat' + (l.nr ? ' nr' : ''), title: C.label(l.id) + (l.nr ? ' (not returned)' : '') },
      U.icon(l.id, 24), h('b', null, '×' + (l.shown != null ? l.shown : l.count)))));
  }

  function keyShortcuts(map) {
    document.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const fn = map[e.key.toLowerCase()];
      if (fn && document.querySelector('.view.active')) fn(e);
    });
  }

  window.COM = { LOCATIONS, prodDefaults, prodPanel, basisPanel, cityOptions, fetchBar, gridTable, matChips, keyShortcuts };
})();

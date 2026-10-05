/* Albion Calc – core: math, AODP client, persistence. No dependencies. */
(function () {
  'use strict';
  const AO = window.AO;

  // ------------------------------------------------------------------ constants
  const SERVERS = {
    east:   { label: 'Asia (East)',     host: 'https://east.albion-online-data.com' },
    west:   { label: 'Americas (West)', host: 'https://west.albion-online-data.com' },
    europe: { label: 'Europe',          host: 'https://europe.albion-online-data.com' },
  };
  const MARKETS = ['Fort Sterling', 'Lymhurst', 'Bridgewatch', 'Martlock', 'Thetford', 'Caerleon', 'Brecilien'];
  const CITY_COLORS = {
    'Fort Sterling': '#e6e8ee', 'Lymhurst': '#6fbf4a', 'Bridgewatch': '#e08a3c', 'Martlock': '#4a63d8',
    'Thetford': '#a56bd6', 'Caerleon': '#d9484e', 'Brecilien': '#3fb3b0', 'Black Market': '#3a3a3a',
  };
  const QUALITIES = ['Normal', 'Good', 'Outstanding', 'Excellent', 'Masterpiece'];
  const FOCUS_PB = 0.59;           // production bonus granted by spending focus
  const NUTRITION_PER_VALUE = 0.1125;

  // ------------------------------------------------------------------ persistence
  const KEY = 'albion-calc.v1';
  const Store = {
    d: {},
    load() { try { this.d = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { this.d = {}; } },
    save() {
      clearTimeout(this._t);
      this._t = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) {} }, 250);
    },
    get(k, def) { return (k in this.d) ? this.d[k] : def; },
    set(k, v) { this.d[k] = v; this.save(); },
  };
  Store.load();

  // global settings shared by every tool
  const defaults = {
    server: 'east', premium: true, sellTaxes: true, buyTaxes: true,
    focusEff: 0, mountCap: 25735,
  };
  const S = Object.assign({}, defaults, Store.get('settings', {}));
  function saveSettings() { Store.set('settings', S); }

  // price book: user typed or fetched values, shared by all tools
  //   book.buy[id]  = what you pay when buying this item as a material
  //   book.sell[id] = what you get when selling this item
  const book = Store.get('book', { buy: {}, sell: {}, meta: {} });
  book.buy = book.buy || {}; book.sell = book.sell || {}; book.meta = book.meta || {};
  function saveBook() { Store.set('book', book); }

  // ------------------------------------------------------------------ formatting / names
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const fmt = (n) => (n == null || !isFinite(n)) ? '–' : nf0.format(Math.round(n));
  const fmt2 = (n) => (n == null || !isFinite(n)) ? '–' : nf2.format(n);
  const pct = (x, d = 2) => (x == null || !isFinite(x)) ? '–' : (x * 100).toFixed(d).replace(/\.?0+$/, '') + '%';

  const tierOf = (id) => { const m = /^T(\d)/.exec(id); return m ? +m[1] : 0; };
  const enchOf = (id) => { const m = /@(\d)$/.exec(id); return m ? +m[1] : 0; };
  const name = (id) => AO.names[id] || AO.names[id.replace(/@\d$/, '')] || id;
  const tierLabel = (id) => { const t = tierOf(id), e = enchOf(id); return t ? 'T' + t + (e ? '.' + e : '') : ''; };
  const label = (id) => { const t = tierLabel(id); return name(id) + (t ? ' (' + t + ')' : ''); };
  const iconUrl = (id, size = 64) => 'https://render.albiononline.com/v1/item/' + encodeURIComponent(id) + '.png?size=' + size;

  function parseDate(s) {
    if (!s || s.startsWith('0001')) return null;
    const t = Date.parse(/Z|[+-]\d\d:\d\d$/.test(s) ? s : s + 'Z');
    return isNaN(t) ? null : t;
  }
  function ago(ts) {
    if (ts == null) return 'no data';
    const m = Math.max(0, (Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return Math.round(m) + ' min ago';
    const h = m / 60; if (h < 48) return Math.round(h) + ' h ago';
    const d = h / 24; if (d < 60) return Math.round(d) + ' days ago';
    return Math.round(d / 30) + ' months ago';
  }
  const ageClass = (ts) => ts == null ? 'bad' : (Date.now() - ts) < 3.6e6 ? 'good' : (Date.now() - ts) < 8.64e7 ? 'warn' : 'bad';

  // ------------------------------------------------------------------ taxes
  function sellFee() { return S.sellTaxes ? ((S.premium ? 4 : 8) + 2.5) / 100 : 0; }   // sales tax + order setup
  function sellTaxOnly() { return (S.premium ? 4 : 8) / 100; }                          // instant-sell to a buy order
  function buyFee() { return S.buyTaxes ? 0.025 : 0; }

  // ------------------------------------------------------------------ production bonus / return rate
  const rrrFromPb = (pb) => 1 - 1 / (1 + pb);
  const pbFromRrr = (r) => 1 / (1 - r) - 1;

  /**
   * Production bonus (fraction) for a recipe at a location.
   * kind: 'refine' uses the refining base bonus, everything else the crafting base bonus.
   * opts: {location, production(bool specialty), daily(fraction), focus(bool), hideoutPb(%), }
   */
  function productionBonus(rec, o) {
    let base = 0, spec = 0;
    const loc = o.location;
    if (loc === 'Hideout') base = (o.hideoutPb || 0) / 100;
    else if (loc === 'Island') base = 0;
    else {
      const L = AO.meta.loc[loc];
      if (L) {
        base = rec.k === 'refine' ? L.rb : L.cb;
        if (o.production !== false) spec = L.m[rec.cc] || 0;
      }
    }
    const pb = base + spec + (o.daily || 0) + (o.focus ? FOCUS_PB : 0);
    return { pb, base, spec };
  }
  function returnRate(rec, o) {
    if (o.customRrr != null && o.customRrr !== '' && !isNaN(+o.customRrr)) return +o.customRrr / 100;
    return rrrFromPb(productionBonus(rec, o).pb);
  }

  // ------------------------------------------------------------------ crafting calculation
  /**
   * rec  : recipe object from AO.recipes
   * c    : { rrr (fraction), focus(bool), feeRate (silver per 100 nutrition), crafts (int),
   *          priceOf(id)->silver|null  (cost to buy a material), outPrice (silver | null) }
   * Returns per-batch totals and per-line detail.
   */
  function calcCraft(rec, c) {
    const crafts = c.crafts || 0;
    const bf = buyFee();
    let matPerCraft = 0, missing = 0;
    const lines = rec.r.map(([id, count, nr]) => {
      const p = c.priceOf(id);
      if (p == null || p === 0) missing++;
      const unit = (p || 0) * (1 + bf);
      const eff = nr ? 1 : (1 - c.rrr);
      const cost = count * unit * eff;
      matPerCraft += cost;
      return { id, count, nr, price: p, units: count * crafts, unitsEff: count * eff * crafts, cost: cost * crafts };
    });
    const feePerCraft = rec.v * NUTRITION_PER_VALUE * (c.feeRate || 0) / 100;
    const silverPerCraft = rec.si || 0;
    const costPerCraft = matPerCraft + feePerCraft + silverPerCraft;
    const items = rec.n * crafts;
    const outPrice = c.outPrice;
    const revenuePerCraft = outPrice == null ? null : rec.n * outPrice * (1 - sellFee());
    const profitPerCraft = revenuePerCraft == null ? null : revenuePerCraft - costPerCraft;
    const focusPerCraft = c.focus ? rec.f * Math.pow(0.5, (S.focusEff || 0) / 10000) : 0;
    return {
      crafts, items, lines, missing,
      matCost: matPerCraft * crafts, fee: feePerCraft * crafts, silver: silverPerCraft * crafts,
      cost: costPerCraft * crafts, costPerItem: costPerCraft / rec.n,
      revenue: revenuePerCraft == null ? null : revenuePerCraft * crafts,
      profit: profitPerCraft == null ? null : profitPerCraft * crafts,
      profitPerCraft,
      margin: (profitPerCraft == null || costPerCraft === 0) ? null : profitPerCraft / costPerCraft,
      focus: focusPerCraft * crafts, focusPerCraft,
      spf: (profitPerCraft == null || !focusPerCraft) ? null : profitPerCraft / focusPerCraft,
      weightIn: rec.r.reduce((a, [id, n]) => a + n * crafts * (AO.meta.wt[id] || 0), 0),
      weightOut: items * (rec.w || 0),
    };
  }

  // ------------------------------------------------------------------ recipe index
  const byId = new Map();       // id -> [recipes]
  AO.recipes.forEach((r) => { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); });
  const recipeFor = (id, alt) => { const l = byId.get(id); return l ? (l[alt || 0] || l[0]) : null; };

  // ------------------------------------------------------------------ AODP client
  const MIN_GAP = 380;     // ms between requests (limit is ~180/min)
  const api = {
    _tail: Promise.resolve(), _last: 0, pending: 0,
    host() { return SERVERS[S.server].host; },
    _sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    /** serialised, throttled GET returning parsed JSON */
    get(path, signal) {
      const run = async () => {
        let attempt = 0;
        for (;;) {
          if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
          const wait = this._last + MIN_GAP - Date.now();
          if (wait > 0) await this._sleep(wait);
          this._last = Date.now();
          try {
            const res = await fetch(this.host() + path, { signal, headers: { Accept: 'application/json' } });
            if (res.status === 429 || res.status >= 500) {
              if (++attempt > 4) throw new Error('AODP busy (HTTP ' + res.status + ')');
              await this._sleep(1500 * attempt);
              continue;
            }
            if (!res.ok) throw new Error('AODP error HTTP ' + res.status);
            return await res.json();
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            if (++attempt > 3) throw (e instanceof TypeError ? new Error('Network error – check your connection') : e);
            await this._sleep(1200 * attempt);
          }
        }
      };
      const p = this._tail.then(run, run);
      this._tail = p.catch(() => {});
      return p;
    },
    /** split ids into URL-safe chunks */
    chunks(ids, extraLen = 200, maxLen = 3300) {
      const out = []; let cur = [], len = extraLen;
      for (const id of ids) {
        if (len + id.length + 1 > maxLen && cur.length) { out.push(cur); cur = []; len = extraLen; }
        cur.push(id); len += id.length + 1;
      }
      if (cur.length) out.push(cur);
      return out;
    },
    async prices(ids, locations, qualities, o = {}) {
      ids = [...new Set(ids)];
      const qs = '.json?locations=' + encodeURIComponent(locations.join(',')) + '&qualities=' + qualities.join(',');
      const chunks = this.chunks(ids, qs.length + 40);
      const rows = [];
      let i = 0;
      for (const ch of chunks) {
        const part = await this.get('/api/v2/stats/prices/' + ch.map(encodeURIComponent).join(',') + qs, o.signal);
        for (const r of part) rows.push(r);
        if (o.onProgress) o.onProgress(++i, chunks.length);
      }
      return rows;
    },
    async history(ids, locations, qualities, scale = 24, o = {}) {
      ids = [...new Set(ids)];
      const qs = '.json?locations=' + encodeURIComponent(locations.join(',')) + '&qualities=' + qualities.join(',') + '&time-scale=' + scale;
      const chunks = this.chunks(ids, qs.length + 40, 2600);
      const rows = [];
      let i = 0;
      for (const ch of chunks) {
        const part = await this.get('/api/v2/stats/history/' + ch.map(encodeURIComponent).join(',') + qs, o.signal);
        for (const r of part) rows.push(r);
        if (o.onProgress) o.onProgress(++i, chunks.length);
      }
      return rows;
    },
  };

  /** rows from /prices -> Map "id|city|quality" -> normalised record */
  function indexPrices(rows) {
    const m = new Map();
    for (const r of rows) {
      m.set(r.item_id + '|' + r.city + '|' + r.quality, {
        sell: r.sell_price_min || 0, sellAt: parseDate(r.sell_price_min_date),
        buy: r.buy_price_max || 0, buyAt: parseDate(r.buy_price_max_date),
        sellMax: r.sell_price_max || 0, buyMin: r.buy_price_min || 0,
      });
    }
    return m;
  }
  /** rows from /history -> Map "id|city|quality" -> {avg, vol} (avg of last 7 days weighted by volume) */
  function indexHistory(rows) {
    const m = new Map();
    for (const r of rows) {
      const d = (r.data || []).slice(-7);
      if (!d.length) continue;
      let cnt = 0, sum = 0;
      d.forEach((x) => { cnt += x.item_count; sum += x.avg_price * x.item_count; });
      const last = d[d.length - 1];
      const at = parseDate(last.timestamp);
      m.set(r.item_id + '|' + r.location + '|' + r.quality, {
        avg: cnt ? sum / cnt : last.avg_price, vol: last.item_count, at,
      });
    }
    return m;
  }

  /**
   * Fill the price book from AODP.
   * jobs: [{ids, city, side:'buy'|'sell', quality}]   mode: 'latest' | 'average'
   * latest : buying uses the lowest sell order, selling uses the lowest sell order too (list price)
   *          or highest buy order if opts.instantSell
   */
  async function fetchBook(jobs, mode, opts = {}) {
    const byCityQ = new Map();
    jobs.forEach((j) => {
      const k = j.city + '|' + j.quality;
      if (!byCityQ.has(k)) byCityQ.set(k, { city: j.city, quality: j.quality, ids: new Set() });
      j.ids.forEach((id) => byCityQ.get(k).ids.add(id));
    });
    let filled = 0;
    for (const g of byCityQ.values()) {
      const ids = [...g.ids];
      if (mode === 'latest') {
        const idx = indexPrices(await api.prices(ids, [g.city], [g.quality], opts));
        jobs.filter((j) => j.city === g.city && j.quality === g.quality).forEach((j) => {
          j.ids.forEach((id) => {
            const rec = idx.get(id + '|' + g.city + '|' + g.quality);
            if (!rec) return;
            let v = 0, at = null;
            if (j.side === 'sell' && (opts.instantSell || g.city === 'Black Market')) { v = rec.buy; at = rec.buyAt; }   // Black Market only has buy orders
            else if (j.side === 'buy' && opts.buyOrders) { v = rec.buy; at = rec.buyAt; }
            else { v = rec.sell; at = rec.sellAt; }
            if (v > 0) { book[j.side][id] = v; book.meta[j.side + '|' + id] = { at, src: 'latest', rng: [rec.buyMin, rec.buy, rec.sell, rec.sellMax] }; filled++; }
          });
        });
      } else {
        const idx = indexHistory(await api.history(ids, [g.city], [g.quality], 24, opts));
        jobs.filter((j) => j.city === g.city && j.quality === g.quality).forEach((j) => {
          j.ids.forEach((id) => {
            const rec = idx.get(id + '|' + g.city + '|' + g.quality);
            if (!rec) return;
            book[j.side][id] = Math.round(rec.avg);
            book.meta[j.side + '|' + id] = { at: rec.at, vol: rec.vol, src: 'avg' };
            filled++;
          });
        });
      }
    }
    saveBook();
    return filled;
  }

  // ------------------------------------------------------------------ export helpers
  function download(filename, text, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  window.AOC = {
    NUTRITION: NUTRITION_PER_VALUE, SERVERS, MARKETS, CITY_COLORS, QUALITIES, FOCUS_PB, S, saveSettings, Store, book, saveBook,
    fmt, fmt2, pct, tierOf, enchOf, name, tierLabel, label, iconUrl, ago, ageClass, parseDate,
    sellFee, sellTaxOnly, buyFee, rrrFromPb, pbFromRrr, productionBonus, returnRate, calcCraft,
    byId, recipeFor, api, indexPrices, indexHistory, fetchBook, download,
  };
})();

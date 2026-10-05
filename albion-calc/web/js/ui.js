/* Albion Calc – tiny UI toolkit (no framework). */
(function () {
  'use strict';
  const C = window.AOC;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'disabled') el.disabled = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const k of kids) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) add(el, k);
      else el.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
    }
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /** parse "24,8" / "1 234" / "1.5k" style numbers; returns null when empty */
  function parseNum(s) {
    if (s == null) return null;
    s = String(s).trim().toLowerCase().replace(/\s/g, '');
    if (!s) return null;
    let mult = 1;
    if (/[km]$/.test(s)) { mult = s.endsWith('k') ? 1e3 : 1e6; s = s.slice(0, -1); }
    // "1,234" thousands vs "24,8" decimal comma
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n * mult;
  }

  // ---- controls ---------------------------------------------------------
  function toggle(text, get, set) {
    const cb = h('input', { type: 'checkbox', checked: get(), onchange: () => set(cb.checked) });
    return h('label', { class: 'tog' }, cb, h('span', { class: 'sw' }), h('span', { class: 'tt' }, text));
  }
  function num(get, set, o = {}) {
    const v = get();
    const inp = h('input', {
      type: 'text', inputmode: o.text ? 'text' : 'decimal', autocomplete: 'off', class: 'in ' + (o.cls || ''),
      value: v == null ? '' : String(v), placeholder: o.ph || '',
      dataset: o.key ? { k: o.key } : null,
      style: o.w ? { width: o.w } : null,
    });
    inp.addEventListener('input', () => set(parseNum(inp.value), inp.value));
    inp.addEventListener('focus', () => { try { inp.select(); } catch (e) {} });
    return inp;
  }
  function select(opts, get, set, o = {}) {
    const sel = h('select', { class: 'in sel ' + (o.cls || ''), onchange: () => set(sel.value) },
      opts.map((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; return h('option', { value: v, selected: String(v) === String(get()) }, l); }));
    sel.value = String(get());
    return sel;
  }
  function field(label, control, hint) {
    return h('div', { class: 'fld' }, h('div', { class: 'fl' }, label, hint ? h('span', { class: 'hint', title: hint }, 'ⓘ') : null), control);
  }
  /** multi-select chips. sel is a Set; values can be numbers or strings */
  function chips(options, sel, onchange, o = {}) {
    const wrap = h('div', { class: 'chips ' + (o.cls || '') });
    options.forEach((x) => {
      const [v, l, color] = Array.isArray(x) ? x : [x, x];
      const b = h('button', { type: 'button', class: 'chip' + (sel.has(v) ? ' on' : ''), style: color ? { '--c': color } : null }, l);
      b.addEventListener('click', () => { sel.has(v) ? sel.delete(v) : sel.add(v); b.classList.toggle('on', sel.has(v)); onchange && onchange(sel); });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function btn(text, fn, cls, title) { return h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: fn, title: title || null }, text); }

  function icon(id, size = 32) {
    const img = h('img', { class: 'ic', loading: 'lazy', width: size, height: size, alt: '', src: C.iconUrl(id, size > 40 ? 128 : 64) });
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    return img;
  }
  function itemCell(id, o = {}) {
    return h('div', { class: 'item' },
      icon(id, o.size || 36),
      h('div', { class: 'itxt' }, h('div', { class: 'iname' }, C.name(id), ' ', h('span', { class: 'tier t' + C.tierOf(id) }, C.tierLabel(id))), o.sub ? h('div', { class: 'isub' }, o.sub) : null));
  }
  const card = (title, ...body) => h('section', { class: 'card' }, title ? h('h3', null, title) : null, ...body);
  const money = (n, cls) => h('span', { class: 'm ' + (cls || '') }, C.fmt(n), ' ', h('span', { class: 'cur' }, 'silver'));
  function profitSpan(n, o = {}) {
    if (n == null || !isFinite(n)) return h('span', { class: 'm na' }, '–');
    return h('span', { class: 'm ' + (n > 0 ? 'pos' : n < 0 ? 'neg' : '') }, C.fmt(n), o.noUnit ? '' : ' silver');
  }

  /** price input bound to the shared price book. side: 'buy' | 'sell' */
  function priceInput(side, id, onchange, o = {}) {
    const book = C.book;
    const wrap = h('div', { class: 'pin' });
    const inp = num(() => book[side][id] != null ? book[side][id] : '', (n) => {
      if (n == null) delete book[side][id]; else book[side][id] = n;
      delete book.meta[side + '|' + id];
      C.saveBook(); onchange && onchange();
    }, { key: side + '|' + id, w: o.w || '96px' });
    const m = book.meta[side + '|' + id];
    wrap.appendChild(inp);
    if (m) {
      const bits = [C.ago(m.at)];
      wrap.appendChild(h('div', { class: 'seen ' + C.ageClass(m.at) }, bits.join(' ')));
    } else if (book[side][id] != null) wrap.appendChild(h('div', { class: 'seen' }, 'manual'));
    return wrap;
  }

  // re-render without losing the caret in a price/number input
  function keepFocus(root, fn) {
    const a = document.activeElement;
    const key = a && a.dataset && a.dataset.k, pos = a && a.selectionStart, end = a && a.selectionEnd;
    fn();
    if (key) {
      const n = root.querySelector('[data-k="' + CSS.escape(key) + '"]');
      if (n) { n.focus(); try { n.setSelectionRange(pos, end); } catch (e) {} }
    }
  }

  // ---- toast & progress ----------------------------------------------------
  let toastEl;
  function toast(msg, kind) {
    if (!toastEl) { toastEl = h('div', { class: 'toast' }); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.className = 'toast show ' + (kind || '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { toastEl.className = 'toast'; }, kind === 'err' ? 6000 : 3000);
  }
  function progress() {
    const bar = h('div', { class: 'bar' }), txt = h('span', { class: 'ptxt' });
    const root = h('div', { class: 'prog', hidden: true }, h('div', { class: 'track' }, bar), txt);
    return {
      el: root,
      show(t) { root.hidden = false; bar.style.width = '0%'; txt.textContent = t || ''; },
      set(done, total, t) { bar.style.width = (total ? (100 * done / total) : 0) + '%'; txt.textContent = t || (done + ' / ' + total); },
      hide() { root.hidden = true; },
    };
  }

  /** search box with dropdown. search(q) -> [{id, title, sub}] */
  function picker(search, onPick, o = {}) {
    const inp = h('input', { type: 'search', class: 'in picker-in', placeholder: o.ph || 'Search…', autocomplete: 'off' });
    const list = h('div', { class: 'plist', hidden: true });
    const root = h('div', { class: 'picker' }, inp, list);
    const run = debounce(() => {
      const q = inp.value.trim();
      clear(list);
      if (q.length < 2) { list.hidden = true; return; }
      const res = search(q);
      if (!res.length) list.appendChild(h('div', { class: 'pempty' }, 'No match'));
      res.forEach((r) => {
        const row = h('button', { type: 'button', class: 'prow' }, icon(r.id, 28), h('span', { class: 'pt' }, r.title), h('span', { class: 'ps' }, r.sub || ''));
        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.addEventListener('click', () => { onPick(r); list.hidden = true; if (o.clear !== false) inp.value = ''; else inp.value = r.title; });
        list.appendChild(row);
      });
      list.hidden = false;
    }, 120);
    inp.addEventListener('input', run);
    inp.addEventListener('focus', run);
    inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
    root.focusInput = () => inp.focus();
    root.setText = (t) => { inp.value = t; };
    return root;
  }

  /** collapsible card */
  function collapsible(title, body, open = true) {
    const cls = open ? 'card coll' : 'card coll closed';
    const head = h('h3', { class: 'chead' }, title, h('span', { class: 'chev' }, '▾'));
    const sec = h('section', { class: cls }, head, h('div', { class: 'cbody' }, body));
    head.addEventListener('click', () => sec.classList.toggle('closed'));
    return sec;
  }

  window.UI = { h, clear, debounce, parseNum, toggle, num, select, field, chips, btn, icon, itemCell, card, money, profitSpan, priceInput, keepFocus, toast, progress, picker, collapsible };
})();

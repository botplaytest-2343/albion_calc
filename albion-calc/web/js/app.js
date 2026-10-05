/* App shell: tabs, server select, keyboard shortcuts, service worker. */
(function () {
  'use strict';
  const C = window.AOC, U = window.UI, h = U.h;
  const ORDER = ['flipper', 'planner', 'refining', 'cooking', 'alchemy'];
  const T = window.Tools;

  const main = document.getElementById('main');
  const tabs = document.getElementById('tabs');
  const srv = document.getElementById('server');

  Object.keys(C.SERVERS).forEach((k) => srv.appendChild(h('option', { value: k, selected: k === C.S.server }, C.SERVERS[k].label)));
  srv.addEventListener('change', () => { C.S.server = srv.value; C.saveSettings(); U.toast('Server: ' + C.SERVERS[srv.value].label); });

  const views = {};
  ORDER.forEach((k) => {
    const t = T[k];
    const view = h('section', { class: 'view', id: 'view-' + k }, t.el);
    main.appendChild(view); views[k] = view;
    tabs.appendChild(h('button', { class: 'tab', dataset: { k }, onclick: () => go(k) }, t.title));
  });

  let current = null;
  function go(k) {
    if (!T[k]) k = ORDER[0];
    current = k;
    try { history.replaceState(null, '', '#' + k); } catch (e) {}
    ORDER.forEach((x) => views[x].classList.toggle('active', x === k));
    [...tabs.children].forEach((b) => b.classList.toggle('active', b.dataset.k === k));
    C.Store.set('tab', k);
    try { T[k].render(); } catch (e) { console.error(e); }
    window.scrollTo(0, 0);
  }

  document.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const fn = T[current] && T[current].shortcuts && T[current].shortcuts[e.key.toLowerCase()];
    if (fn) { e.preventDefault(); fn(); }
  });

  const start = (location.hash || '').slice(1) || C.Store.get('tab', ORDER[0]);
  go(start);
  window.addEventListener('hashchange', () => { const k = (location.hash || '').slice(1); if (T[k] && k !== current) go(k); });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.App = { go };
})();

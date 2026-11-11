'use strict';
/* Fills the shared top bar: who is signed in, which tools they can open, and sign-out. */
(() => {
  const bar = document.querySelector('.appbar');
  if (!bar) return;
  const tool = document.body.dataset.tool || '';
  bar.querySelectorAll('.appbar-nav a').forEach(a => { if (a.dataset.tool === tool) a.setAttribute('aria-current', 'page'); });
  fetch('/api/me').then(r => (r.ok ? r.json() : null)).then(me => {
    if (!me) return;
    const who = bar.querySelector('.who'), av = bar.querySelector('.avatar');
    if (who) { who.querySelector('b').textContent = me.name || me.username; who.querySelector('span').textContent = me.roleLabel || ''; }
    if (av) av.textContent = String(me.name || me.username || '?').trim().charAt(0).toUpperCase();
    if (me.role !== 'admin') bar.querySelectorAll('.appbar-nav a[data-admin]').forEach(a => a.remove());
  }).catch(() => {});
  const out = bar.querySelector('.appbar-out');
  if (out) out.addEventListener('click', async () => { try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {} location.href = '/login'; });
})();

'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v); for (const k of kids.flat()) if (k != null) e.append(k); return e; };
  async function api(url, opt = {}) {
    const r = await fetch(url, { cache: 'no-store', ...opt, headers: { ...(opt.body ? { 'Content-Type': 'application/json' } : {}) } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !url.includes('login')) { showLogin(); throw new Error(j.error || 'Escribe el PIN.'); }
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }
  const msg = (box, text, bad) => { $(box).replaceChildren(el('div', { class: 'msg' + (bad ? ' bad' : '') }, text)); };
  const ago = iso => { if (!iso) return 'nunca'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`; };
  const add = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const monday = ymd => { const d = new Date(ymd + 'T12:00:00Z'); return add(ymd, -((d.getUTCDay() + 6) % 7)); };
  const todayL = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const DL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  function showLogin(first) {
    $('#app').hidden = true; $('#login').hidden = false;
    if (first) { $('#loginTitle').textContent = 'Primera vez: crea el PIN'; $('#loginHelp').textContent = 'Elige un PIN de 4 a 8 números. Lo pide esta pantalla de administración; no lo compartas con el personal del comedor.'; }
    $('#pin').focus();
  }
  $('#loginForm').addEventListener('submit', async e => { e.preventDefault(); try { await api('/api/login', { method: 'POST', body: JSON.stringify({ pin: $('#pin').value }) }); $('#pin').value = ''; boot(); } catch (err) { msg('#loginMsg', err.message, true); } });
  $('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {}); location.href = '/'; });

  let tab = 'estado';
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; tab = b.dataset.t; for (const x of $('#tabs').children) x.setAttribute('aria-selected', String(x === b)); document.querySelectorAll('[data-p]').forEach(p => { p.hidden = p.dataset.p !== tab; }); show(); });
  function show() { if (tab === 'estado') status(); if (tab === 'dias') report(); if (tab === 'config') config(); }

  async function status() {
    const s = await api('/api/live'), y = s.sync, row = (k, v) => [el('dt', {}, k), el('dd', {}, v)];
    $('#status').replaceChildren(...[
      row('Planta / estación', [s.plant && s.plant.name, s.station && s.station.name].filter(Boolean).join(' · ') || 'Sin sincronizar todavía'),
      row('Tarjetas en la lista', s.configured.cards ? String(s.configured.cards) : 'Ninguna (llegan de gpoave.com al sincronizar)'),
      row('Comidas hoy', `${s.count}${s.unknown ? ` (${s.unknown} con tarjeta no registrada)` : ''}`),
      row('Última sincronización', y.lastSync ? `${new Date(y.lastSync).toLocaleString('es-MX')} (${ago(y.lastSync)})` : 'nunca'),
      row('Pendientes de enviar', String(y.pending)),
      y.lastError ? row('Último error', y.lastError) : null,
      s.clockWarning ? row('Reloj', s.clockWarning) : null,
    ].filter(Boolean).flat());
    const l = await api('/api/log'); $('#log').textContent = l.lines.join('\n');
  }
  $('#syncBtn').addEventListener('click', async () => {
    $('#syncBtn').disabled = true; $('#stMsg').textContent = 'Sincronizando…';
    try { const r = await api('/api/sync', { method: 'POST', body: '{}' }); $('#stMsg').textContent = r.error ? r.error : r.busy ? 'Ya se está sincronizando.' : `Listo: ${r.sent} enviadas, ${r.pending} pendientes.`; } catch (e) { $('#stMsg').textContent = e.message; }
    $('#syncBtn').disabled = false; status();
  });
  $('#test').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = $('#test').value.trim(); $('#testMsg').textContent = v ? `El lector envió: "${v}"` : 'No llegó nada.'; $('#test').value = ''; } });

  $('#wk').value = monday(todayL());
  $('#wk').addEventListener('change', report);
  $('#prevW').addEventListener('click', () => { $('#wk').value = add(monday($('#wk').value), -7); report(); });
  $('#nextW').addEventListener('click', () => { $('#wk').value = add(monday($('#wk').value), 7); report(); });
  async function report() {
    const from = monday($('#wk').value || todayL()), to = add(from, 6);
    $('#csv').href = `/api/export.csv?desde=${from}&hasta=${to}`;
    const r = await api(`/api/report?desde=${from}&hasta=${to}`);
    $('#rep').replaceChildren(el('thead', {}, el('tr', {}, ['Día', 'Comidas', 'Tarjeta no registrada', 'Manuales'].map(t => el('th', {}, t)))),
      el('tbody', {}, r.days.map((d, i) => el('tr', {}, el('td', {}, `${DL[i]} ${d.ymd.slice(8)}/${d.ymd.slice(5, 7)}`), el('td', { class: 'n' }, String(d.total)), el('td', { class: 'n' }, d.unknown ? String(d.unknown) : ''), el('td', { class: 'n' }, d.manual ? String(d.manual) : ''))),
        el('tr', {}, el('td', {}, el('b', {}, 'Total')), el('td', { class: 'n' }, el('b', {}, String(r.total))), el('td'), el('td'))));
    $('#unk').replaceChildren(el('thead', {}, el('tr', {}, ['Tarjeta', 'Comidas', 'Última'].map(t => el('th', {}, t)))), el('tbody', {}, r.unknownCards.length ? r.unknownCards.map(u => el('tr', {}, el('td', {}, u.card || '—'), el('td', { class: 'n' }, String(u.count)), el('td', {}, u.last.replace('T', ' ').slice(0, 16)))) : [el('tr', {}, el('td', { colspan: 3 }, 'Ninguna.'))]));
  }

  $('#manForm').addEventListener('submit', async e => {
    e.preventDefault();
    const v = $('#mEmp').value.trim(), k = $('#mKind').value;
    try {
      const r = await api('/api/manual', { method: 'POST', body: JSON.stringify({ emp: k === 'emp' ? v : '', card: k === 'card' ? v : '', qty: $('#mQty').value, by: $('#mBy').value, note: $('#mNote').value }) });
      msg('#manMsg', `${r.added} comida(s) registrada(s)${r.name ? ` para ${r.name}` : v ? ` (${v} no está en la lista: queda para revisión)` : ''}.`);
      $('#mEmp').value = ''; $('#mQty').value = 1; $('#mNote').value = '';
    } catch (err) { msg('#manMsg', err.message, true); }
  });

  async function config() {
    const c = await api('/api/config');
    $('#cToken').value = ''; $('#cToken').placeholder = c.hasToken ? `Guardado (${c.token}). Pega uno nuevo solo para cambiarlo.` : 'avc_…';
    $('#cName').value = c.stationName || ''; $('#cServer').value = c.server;
    $('#cardsInfo').textContent = c.cards ? `${c.cards} tarjetas en la lista (recibida ${c.cardsAt ? new Date(c.cardsAt).toLocaleString('es-MX') : ''}). Una misma tarjeta leída dos veces en menos de ${c.debounceSec ?? 10} s cuenta una sola comida.` : 'La lista de tarjetas llega de gpoave.com al sincronizar.';
    $('#dataDir').textContent = `Las comidas se guardan en: ${c.data}`;
  }
  $('#cfgForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/api/config', { method: 'PUT', body: JSON.stringify({ token: $('#cToken').value.trim() || undefined, stationName: $('#cName').value, server: $('#cServer').value.trim(), newPin: $('#newPin').value || undefined }) }); $('#newPin').value = ''; $('#cfgMsg').textContent = 'Guardado. Si pegaste el código, ya se está sincronizando.'; config(); }
    catch (err) { $('#cfgMsg').textContent = err.message; }
  });

  async function boot() { const st = await api('/api/state'); if (!st.admin) return showLogin(!st.pinSet); $('#login').hidden = true; $('#app').hidden = false; show(); }
  boot();
  setInterval(() => { if (!$('#app').hidden && tab === 'estado') status().catch(() => {}); }, 15000);
})();

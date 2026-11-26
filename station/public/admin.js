'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v); for (const k of kids.flat()) if (k != null) e.append(k); return e; };
  async function api(url, opt = {}) {
    const r = await fetch(url, { cache: 'no-store', ...opt, headers: { ...(opt.body && typeof opt.body === 'string' && !opt.raw ? { 'Content-Type': 'application/json' } : {}), ...(opt.headers || {}) } });
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

  /* ---------- login ---------- */
  function showLogin(first) {
    $('#app').hidden = true; $('#login').hidden = false;
    if (first) { $('#loginTitle').textContent = 'Primera vez: crea el PIN'; $('#loginHelp').textContent = 'Elige un PIN de 4 a 8 números. Lo pedirá esta pantalla de administración; no lo compartas con el personal.'; }
    $('#pin').focus();
  }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/api/login', { method: 'POST', body: JSON.stringify({ pin: $('#pin').value }) }); $('#pin').value = ''; boot(); }
    catch (err) { msg('#loginMsg', err.message, true); }
  });
  $('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); location.href = '/'; });

  /* ---------- tabs ---------- */
  let tab = 'estado';
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; tab = b.dataset.t; for (const x of $('#tabs').children) x.setAttribute('aria-selected', String(x === b)); document.querySelectorAll('[data-p]').forEach(p => { p.hidden = p.dataset.p !== tab; }); show(); });
  function show() { if (tab === 'estado') status(); if (tab === 'horas') report(); if (tab === 'manual') manual(); if (tab === 'config') config(); }

  /* ---------- status ---------- */
  async function status() {
    const s = await api('/api/live'), d = s.device, y = s.sync;
    const kinds = { none: 'Sin terminal', 'zk-pull': 'ZKTeco (lectura por red)', 'zk-push': 'ZKTeco (envía a esta PC)', hik: 'Hikvision' };
    const row = (k, v) => [el('dt', {}, k), el('dd', {}, v)];
    $('#status').replaceChildren(...[
      row('Planta / estación', [s.plant && s.plant.name, s.station && s.station.name].filter(Boolean).join(' · ') || 'Sin sincronizar todavía'),
      row('Empleados en la lista', s.employees ? String(s.employees) : 'Ninguno (llegan de gpoave.com al sincronizar)'),
      row('Terminal', `${kinds[d.kind] || d.kind}${d.ip ? ' · ' + d.ip : ''}${d.serial ? ' · serie ' + d.serial : ''}`),
      row('Estado de la terminal', d.kind === 'none' ? '—' : d.ok ? `Conectada, leída ${ago(d.lastRead)}${d.users != null ? ` · ${d.users} usuarios, ${d.records} registros` : ''}` : `Sin conexión${d.error ? ': ' + d.error : ''}`),
      row('Checadas hoy', String(s.todayCount)),
      row('Última sincronización', y.lastSync ? `${new Date(y.lastSync).toLocaleString('es-MX')} (${ago(y.lastSync)})` : 'nunca'),
      row('Pendientes de enviar', String(y.pending)),
      y.lastError ? row('Último error', y.lastError) : null,
      s.clockWarning ? row('Reloj', s.clockWarning) : null,
      row('Turnos', (s.shifts || []).map(t => `${t.name} ${t.start}–${t.end}`).join(' · ') || '—'),
    ].filter(Boolean).flat());
    const l = await api('/api/log'); $('#log').textContent = l.lines.join('\n');
  }
  $('#syncBtn').addEventListener('click', async () => {
    $('#syncBtn').disabled = true; $('#stMsg').textContent = 'Sincronizando…';
    try { const r = await api('/api/sync', { method: 'POST' }); $('#stMsg').textContent = r.error ? r.error : r.busy ? 'Ya se está sincronizando.' : `Listo: ${r.sent} enviadas, ${r.pending} pendientes.`; }
    catch (e) { $('#stMsg').textContent = e.message; }
    $('#syncBtn').disabled = false; status();
  });
  $('#readBtn').addEventListener('click', async () => {
    $('#readBtn').disabled = true; $('#stMsg').textContent = 'Leyendo la terminal…';
    try { const d = await api('/api/device/read', { method: 'POST' }); $('#stMsg').textContent = d.ok ? 'Terminal leída.' : `No se pudo leer: ${d.error || 'sin conexión'}`; }
    catch (e) { $('#stMsg').textContent = e.message; }
    $('#readBtn').disabled = false; status();
  });

  /* ---------- weekly hours ---------- */
  $('#wk').value = monday(todayL());
  $('#wk').addEventListener('change', report);
  $('#prevW').addEventListener('click', () => { $('#wk').value = add(monday($('#wk').value), -7); report(); });
  $('#nextW').addEventListener('click', () => { $('#wk').value = add(monday($('#wk').value), 7); report(); });
  async function report() {
    const from = monday($('#wk').value || todayL()), to = add(from, 6);
    $('#csv').href = `/api/export.csv?desde=${from}&hasta=${to}`;
    const r = await api(`/api/report?desde=${from}&hasta=${to}`);
    $('#rep').replaceChildren(
      el('thead', {}, el('tr', {}, el('th', {}, 'ID'), el('th', {}, 'Nombre'), r.dates.map((d, i) => el('th', {}, `${DL[i]} ${d.slice(8)}/${d.slice(5, 7)}`)), el('th', {}, 'Total h'), el('th', {}, 'Incompletos'))),
      el('tbody', {}, r.people.map(p => el('tr', {}, el('td', {}, p.id), el('td', {}, p.name),
        r.dates.map(d => { const x = p.days[d]; return el('td', { title: x ? `${x.in || '?'} – ${x.out || '?'}${x.shift ? ' · ' + x.shift : ''}` : '' }, x ? (x.incomplete ? el('span', { class: 'pill warn' }, `${x.in || '?'}–${x.out || '?'}`) : `${x.in}–${x.out} (${x.hours.toFixed(1)})`) : ''); }),
        el('td', { class: 'n' }, p.total.toFixed(1)), el('td', { class: 'n' }, p.incomplete ? String(p.incomplete) : '')))));
  }

  /* ---------- manual punch ---------- */
  async function manual() {
    const s = await api('/api/live');
    const list = await api(`/api/report?desde=${todayL()}&hasta=${todayL()}`);
    const cur = $('#mEmp').value;
    $('#mEmp').replaceChildren(el('option', { value: '' }, '— Elige —'), ...list.people.map(p => el('option', { value: p.id }, `${p.id} · ${p.name}`)));
    $('#mEmp').value = cur;
    if (!$('#mDate').value) $('#mDate').value = todayL();
    if (!s.employees) msg('#manMsg', 'La lista de empleados llega de gpoave.com en la primera sincronización.', true);
  }
  $('#manForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/api/manual', { method: 'POST', body: JSON.stringify({ emp: $('#mEmp').value, date: $('#mDate').value, time: $('#mTime').value, by: $('#mBy').value, note: $('#mNote').value }) }); msg('#manMsg', `Guardada: ${$('#mEmp').selectedOptions[0].textContent} a las ${$('#mTime').value}.`); $('#mTime').value = ''; $('#mNote').value = ''; }
    catch (err) { msg('#manMsg', err.message, true); }
  });

  /* ---------- import ---------- */
  $('#impFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const text = await f.text(); const r = await api('/api/import', { method: 'POST', raw: true, body: text, headers: { 'Content-Type': 'text/plain', 'X-File-Name': encodeURIComponent(f.name) } }); msg('#impMsg', `${f.name}: ${r.read} renglones leídos, ${r.fresh} checadas nuevas.`, !r.read); }
    catch (err) { msg('#impMsg', err.message, true); }
    e.target.value = '';
  });

  /* ---------- config ---------- */
  const KIND_HELP = {
    none: 'Sin terminal conectada: las checadas entran solo por archivo o a mano.',
    'zk-pull': 'En la terminal: Menú → Comunicación → Ethernet: pon una IP fija de la misma red que esta PC (ej. 192.168.1.201) y anótala aquí. Puerto 4370. La PC la lee cada minuto.',
    'zk-push': 'En la terminal: Menú → Comunicación → Servidor en la nube (ADMS): dirección = la IP de esta PC, puerto = el de abajo. La terminal manda cada checada al momento. El instalador ya abrió ese puerto en el firewall de Windows.',
    hik: 'En la terminal Hikvision: Red → IP fija de la misma red. Usuario y contraseña son los del administrador de la terminal. Puerto 80. La PC la lee cada minuto.',
  };
  function kindUI() {
    const k = $('#dKind').value;
    document.querySelectorAll('.dIp').forEach(x => { x.hidden = !(k === 'zk-pull' || k === 'hik'); });
    document.querySelectorAll('.dHik').forEach(x => { x.hidden = k !== 'hik'; });
    document.querySelectorAll('.dPush').forEach(x => { x.hidden = k !== 'zk-push'; });
    $('#kindHelp').textContent = KIND_HELP[k] || '';
    if (!$('#dPort').value || ['4370', '80'].includes($('#dPort').value)) $('#dPort').value = k === 'hik' ? 80 : 4370;
  }
  $('#dKind').addEventListener('change', kindUI);
  async function config() {
    const c = await api('/api/config');
    $('#cToken').value = ''; $('#cToken').placeholder = c.hasToken ? `Guardado (${c.token}). Pega uno nuevo solo para cambiarlo.` : 'ave_…';
    $('#cName').value = c.stationName || ''; $('#cServer').value = c.server;
    $('#dKind').value = c.device.kind; $('#dIp').value = c.device.ip; $('#dPort').value = c.device.port; $('#dUser').value = c.device.user; $('#dPass').value = c.device.password; $('#dPush').value = c.device.pushPort;
    $('#dataDir').textContent = `Las checadas se guardan en: ${c.data}`;
    kindUI();
  }
  $('#cfgForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/config', { method: 'PUT', body: JSON.stringify({ token: $('#cToken').value.trim() || undefined, stationName: $('#cName').value, server: $('#cServer').value.trim(),
        device: { kind: $('#dKind').value, ip: $('#dIp').value.trim(), port: $('#dPort').value, user: $('#dUser').value, password: $('#dPass').value, pushPort: $('#dPush').value }, newPin: $('#newPin').value || undefined }) });
      $('#newPin').value = ''; $('#cfgMsg').textContent = 'Guardado. Si pegaste el código, ya se está sincronizando.'; config();
    } catch (err) { $('#cfgMsg').textContent = err.message; }
  });

  /* ---------- start ---------- */
  async function boot() {
    const st = await api('/api/state');
    if (!st.admin) return showLogin(!st.pinSet);
    $('#login').hidden = true; $('#app').hidden = false;
    show();
  }
  boot();
  setInterval(() => { if (!$('#app').hidden && tab === 'estado') status().catch(() => {}); }, 15000);
})();

(function () {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOC = 'es-MX';
let employees = [], loaded = false, filter = 'all', openId = null, isNew = false, plantSel = '';
try { plantSel = localStorage.getItem('ave-plant') || ''; } catch (e) {}
let win = 60; try { const v = localStorage.getItem('ave-win'); if (v) win = +v || 60; } catch (e) {}
$('#win').value = String(win);

/* ---------- servidor ---------- */
class ApiError extends Error {}
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await (window.aveFetch || fetch)(url, opt); } catch (e) { throw new ApiError('Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'); }
  if (r.status === 401) { location.href = '/login'; throw new ApiError('Tu sesión terminó. Vuelve a iniciar sesión.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || 'Algo salió mal. Inténtalo de nuevo.');
  return j;
}
function put(emp) {
  const i = employees.findIndex(e => e.id === emp.id);
  if (i >= 0) employees[i] = emp; else employees.push(emp);
  render();
}
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');

/* ---------- fechas ---------- */
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const parse = iso => { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); if (!y || !m || !d) return null; return new Date(y, m - 1, d); };
const daysUntil = d => Math.round((d - today()) / 864e5);
const fmt = iso => { const d = typeof iso === 'string' ? parse(iso) : iso; return d ? d.toLocaleDateString(LOC, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
const fmtShort = d => d.toLocaleDateString(LOC, { day: 'numeric', month: 'short' });
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dias = n => `${n} día${n === 1 ? '' : 's'}`;
function nextBirthday(e) {
  if (!e.birthday) return null; const [y, m, d] = e.birthday.split('-').map(Number); if (!m || !d) return null;
  const t = today(); const mk = Y => new Date(Y, m - 1, (m === 2 && d === 29 && !isLeap(Y)) ? 28 : d);
  let c = mk(t.getFullYear()); if (c < t) c = mk(t.getFullYear() + 1);
  return { date: c, days: daysUntil(c), age: y ? c.getFullYear() - y : null };
}
function tStatus(t) {
  const d = parse(t.expires); if (!d) return { key: 'none', label: 'Sin fecha de vencimiento', days: Infinity };
  const n = daysUntil(d);
  if (n < 0) return { key: 'bad', label: `Venció hace ${dias(-n)}`, days: n };
  if (n === 0) return { key: 'warn', label: 'Vence hoy', days: 0 };
  if (n <= win) return { key: 'warn', label: `Vence en ${dias(n)}`, days: n };
  return { key: 'ok', label: `Vigente al ${fmt(t.expires)}`, days: n };
}
function eStatus(e) {
  const tr = e.trainings || []; if (!tr.length) return { key: 'none', label: 'Sin capacitaciones' };
  const st = tr.map(tStatus); const bad = st.filter(s => s.key === 'bad').length, warn = st.filter(s => s.key === 'warn').length;
  if (bad) return { key: 'bad', label: `${bad} vencida${bad === 1 ? '' : 's'}` + (warn ? `, ${warn} por vencer` : '') };
  if (warn) return { key: 'warn', label: `${warn} por vencer` };
  if (st.every(s => s.key === 'none')) return { key: 'none', label: `${tr.length} registrada${tr.length === 1 ? '' : 's'}` };
  return { key: 'ok', label: tr.length === 1 ? 'Vigente' : `Las ${tr.length} vigentes` };
}
const bdayLabel = b => b.days === 0 ? 'Hoy' : b.days === 1 ? 'Mañana' : `En ${dias(b.days)}`;

/* ---------- ayudas de interfaz ---------- */
let toastT; function toast(m) { if (!m) return; const el = $('#toast'); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3400); }
function armed(btn, label, fn) { // confirmación en dos pasos, sin ventanas emergentes
  btn.addEventListener('click', () => {
    if (btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = btn.dataset.orig; fn(); return; }
    btn.dataset.orig = btn.dataset.orig || btn.textContent; btn.textContent = label; btn.classList.add('armed');
    setTimeout(() => { if (btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = btn.dataset.orig; } }, 4000);
  });
}
const getEmp = id => employees.find(e => e.id === id);

/* ---------- pantalla ---------- */
function render() {
  const act = active(); const t = act.length; let expired = 0, expiring = 0; const tAlerts = [];
  act.forEach(e => (e.trainings || []).forEach(tr => {
    const s = tStatus(tr); if (s.key === 'bad') expired++; if (s.key === 'warn') expiring++;
    if (s.key === 'bad' || s.key === 'warn') tAlerts.push({ e, tr, s });
  }));
  const bdays = act.map(e => ({ e, b: nextBirthday(e) })).filter(x => x.b && x.b.days <= 30).sort((a, b) => a.b.days - b.b.days);
  const show = loaded || t;
  $('#sTotal').textContent = show ? t : '–'; $('#sExpired').textContent = show ? expired : '–';
  $('#sExpiring').textContent = show ? expiring : '–'; $('#sExpiringL').textContent = `Vencen en ${win} días`; $('#sBday').textContent = show ? bdays.length : '–';

  tAlerts.sort((a, b) => a.s.days - b.s.days);
  $('#trainAlerts').innerHTML = tAlerts.length ? tAlerts.map(a => `<button class="alert ${a.s.key}" data-open="${esc(a.e.id)}"><i></i>
    <span><span class="t">${esc(a.e.name)}</span><br><span class="s">${esc(a.tr.name)}</span></span>
    <span class="d">${a.s.key === 'bad' ? 'VENCIDA' : a.s.days === 0 ? 'HOY' : a.s.days + ' d'}<br><span class="muted">${fmt(a.tr.expires)}</span></span></button>`).join('')
    : `<div class="empty">${t ? `Nada vence en los próximos ${win} días.` : 'Aquí aparecerán los avisos cuando los empleados tengan capacitaciones con fecha de vencimiento.'}</div>`;

  $('#bdayAlerts').innerHTML = bdays.length ? bdays.map(x => `<button class="alert bday" data-open="${esc(x.e.id)}"><i></i>
    <span><span class="t">${esc(x.e.name)}</span><br><span class="s">${fmtShort(x.b.date)}${x.b.age ? ` · cumple ${x.b.age}` : ''}</span></span>
    <span class="d">${x.b.days === 0 ? 'HOY' : x.b.days + ' d'}</span></button>`).join('')
    : `<div class="empty">${t ? 'No hay cumpleaños en los próximos 30 días.' : 'Agrega la fecha de cumpleaños en el expediente para recibir avisos aquí.'}</div>`;

  renderPlants();
  renderRoster();
  if (openId && !isNew) renderFileLists();
}
function renderRoster() {
  const el = $('#roster');
  if (!employees.length) {
    el.innerHTML = loaded ? `<div class="empty"><strong>Todavía no hay empleados.</strong> Usa “Agregar empleado” para crear el primer expediente: datos, cumpleaños, capacitaciones con fecha de vencimiento y documentos como INE, CURP o NSS.</div>` : '<div class="state muted">Cargando expedientes…</div>';
    return;
  }
  const q = $('#q').value.trim().toLowerCase();
  let list = employees.filter(e => (plantSel === '__bajas' ? isBaja(e) : !isBaja(e) && (!plantSel || (e.site || '') === plantSel)) && (!q || [e.name, e.number, e.position, e.site, e.curp].some(v => (v || '').toLowerCase().includes(q))));
  if (filter === 'attn') list = list.filter(e => ['bad', 'warn'].includes(eStatus(e).key));
  const rank = { bad: 0, warn: 1, none: 2, ok: 3 };
  const byNum = (a, b) => (parseInt(a.number, 10) || 1e9) - (parseInt(b.number, 10) || 1e9) || (a.name || '').localeCompare(b.name || '', LOC);
  list.sort((a, b) => filter === 'attn' ? (rank[eStatus(a).key] - rank[eStatus(b).key]) : byNum(a, b));
  if (!list.length) { el.innerHTML = `<div class="empty">${filter === 'attn' ? 'Nadie necesita atención por ahora.' : 'Ningún empleado coincide con la búsqueda.'}</div>`; return; }
  const groups = new Map();
  for (const e of list) { const k = e.site || 'Sin planta'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const order = [...groups.keys()].sort((a, b) => plantRank(a) - plantRank(b) || a.localeCompare(b, LOC));
  el.innerHTML = `<div class="row head"><span>Empleado</span><span class="c-site">No.</span><span>Capacitaciones</span><span class="c-bday">Cumpleaños</span><span class="c-docs">Docs</span></div>` +
    order.map(k => `<div class="group-head">${esc(k)}<span>${groups.get(k).length} empleado${groups.get(k).length === 1 ? '' : 's'}</span></div>` + groups.get(k).map(rowHTML).join('')).join('');
}
const PLANT_ORDER = ['Auto Kabel Juárez', 'Juárez', 'Guadalajara', 'Monclova', 'Tijuana', 'Jabil Chihuahua', 'Wistron', 'Jabil Torres'];
const plantRank = p => { const i = PLANT_ORDER.indexOf(p); return i < 0 ? 99 : i; };
function renderPlants() {
  const counts = {}; employees.filter(e => !isBaja(e)).forEach(e => { const k = e.site || 'Sin planta'; counts[k] = (counts[k] || 0) + 1; });
  const nb = employees.filter(isBaja).length;
  const names = Object.keys(counts).sort((a, b) => plantRank(a) - plantRank(b) || a.localeCompare(b, LOC));
  if (plantSel && plantSel !== '__bajas' && !counts[plantSel]) plantSel = '';
  $('#plant').innerHTML = `<option value="">Todas las plantas (${employees.length - nb})</option>` + names.map(n => `<option value="${esc(n === 'Sin planta' ? '' : n)}"${n === plantSel ? ' selected' : ''}>${esc(n)} (${counts[n]})</option>`).join('')
    + (nb ? `<option value="__bajas"${plantSel === '__bajas' ? ' selected' : ''}>Bajas (${nb})</option>` : '');
  $('#plantNames').innerHTML = [...new Set([...PLANT_ORDER, ...names.filter(n => n !== 'Sin planta')])].map(n => `<option value="${esc(n)}">`).join('');
}
function rowHTML(e) {
  {
      const s = eStatus(e), b = nextBirthday(e);
      return `<button class="row" data-open="${esc(e.id)}">
      <span><span class="name">${esc(e.name)}</span><br><span class="sub">${esc(e.position || '—')}</span></span>
      <span class="c-site sub mono">${esc(e.number || '—')}</span>
      <span><span class="chip ${s.key}">${esc(s.label)}</span></span>
      <span class="c-bday">${b ? (b.days <= 30 ? `<span class="chip bday">${fmtShort(b.date)} · ${bdayLabel(b)}</span>` : `<span class="mono muted">${fmtShort(b.date)}</span>`) : '<span class="muted">—</span>'}</span>
      <span class="c-docs mono muted">${(e.docs || []).length}</span></button>`;
  }
}

/* ---------- expediente ---------- */
const P = ['name', 'number', 'position', 'site', 'curp', 'rfc', 'nss', 'contractType', 'address', 'status', 'bajaDate', 'birthday', 'hire', 'phone', 'emerg', 'notes'];
const isBaja = e => e.status === 'baja';
const active = () => employees.filter(e => !isBaja(e) && !/no es empleado/i.test(e.name));
function setLocked(v) { $('#trainCard').classList.toggle('locked', v); $('#docCard').classList.toggle('locked', v); }
function openFile(id) {
  const e = id ? getEmp(id) : null; isNew = !e;
  openId = e ? e.id : newId();
  P.forEach(k => $('#p_' + k).value = e ? (e[k] || (k === 'status' ? 'activo' : '')) : '');
  if (!e && plantSel && plantSel !== '__bajas') $('#p_site').value = plantSel;
  if (!e) $('#p_status').value = 'activo';
  const ex = e && e.extra ? Object.entries(e.extra) : [];
  $('#extraBox').hidden = !ex.length;
  $('#extraList').innerHTML = ex.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('#dName').textContent = e ? e.name : 'Nuevo empleado';
  $('#dSub').textContent = e ? [e.position, e.site].filter(Boolean).join(' · ') : 'Guarda los datos para poder agregar capacitaciones y documentos.';
  $('#delEmp').hidden = !e;
  setLocked(isNew);
  $('#trainForm').reset(); $('#docForm').reset();
  renderFileLists();
  const d = $('#dlg'); if (!d.open) d.showModal();
  if (isNew) setTimeout(() => $('#p_name').focus(), 30);
}
function payload(emp, overrides) {
  const b = {}; P.forEach(k => b[k] = emp[k] || ''); b.trainings = emp.trainings || [];
  return Object.assign(b, overrides || {});
}
function renderFileLists() {
  const e = getEmp(openId); const tr = (e && e.trainings) || [], docs = (e && e.docs) || [];
  $('#trainList').innerHTML = tr.length ? tr.slice().sort((a, b) => tStatus(a).days - tStatus(b).days).map(t => {
    const s = tStatus(t); return `<div class="item">
      <span><span class="t">${esc(t.name)}</span><br><span class="s mono">${t.done ? 'Realizada el ' + fmt(t.done) : 'Sin fecha de realización'}</span></span>
      <span class="chip ${s.key}">${esc(s.label)}</span>
      <button class="btn sm danger" data-deltrain="${esc(t.id)}">Quitar</button></div>`;
  }).join('') : `<div class="empty">Sin capacitaciones registradas. Agrega cada curso con su fecha de vencimiento para recibir avisos antes de que venza.</div>`;
  $('#docList').innerHTML = docs.length ? docs.slice().sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || '')).map(d => `<div class="item">
      <span><span class="t">${esc(d.type)}</span><br><span class="s">${esc(d.fileName)} · <span class="mono">${(d.size / 1048576).toFixed(d.size < 1048576 ? 2 : 1)} MB · ${fmt((d.uploadedAt || '').slice(0, 10))}</span></span></span>
      <a href="/files/${esc(d.id)}" target="_blank" rel="noopener">${/pdf|image\/(png|jpeg|webp)/.test(d.mime || '') ? 'Abrir' : 'Descargar'}</a>
      <button class="btn sm danger" data-deldoc="${esc(d.id)}">Eliminar</button></div>`).join('')
    : `<div class="empty">Todavía no hay documentos. Sube escaneos o fotos de INE, CURP, NSS, contratos y constancias.</div>`;
  $('#trainList').querySelectorAll('[data-deltrain]').forEach(b => armed(b, 'Confirmar', async () => {
    const emp = getEmp(openId); if (!emp) return;
    try { put(await api('PUT', '/api/employees/' + openId, payload(emp, { trainings: emp.trainings.filter(t => t.id !== b.dataset.deltrain) }))); toast('Capacitación eliminada'); }
    catch (err) { toast(err.message); }
  }));
  $('#docList').querySelectorAll('[data-deldoc]').forEach(b => armed(b, 'Confirmar', async () => {
    try { put(await api('DELETE', `/api/employees/${openId}/docs/${b.dataset.deldoc}`)); toast('Documento eliminado'); }
    catch (err) { toast(err.message); }
  }));
}

$('#profile').addEventListener('submit', async ev => {
  ev.preventDefault(); const name = $('#p_name').value.trim();
  if (!name) { toast('Escribe el nombre completo del empleado.'); $('#p_name').focus(); return; }
  const prev = getEmp(openId) || { trainings: [] };
  const body = { trainings: prev.trainings || [] }; P.forEach(k => body[k] = $('#p_' + k).value.trim());
  const btn = $('#saveProfile'); btn.disabled = true;
  try {
    const emp = await api('PUT', '/api/employees/' + openId, body); put(emp);
    toast(isNew ? 'Empleado agregado' : 'Datos guardados');
    if (isNew) { isNew = false; setLocked(false); $('#delEmp').hidden = false; renderFileLists(); }
    $('#dName').textContent = emp.name; $('#dSub').textContent = [emp.position, emp.site].filter(Boolean).join(' · ');
  } catch (err) { toast(err.message); } finally { btn.disabled = false; }
});
armed($('#delEmp'), 'Confirmar: borrar expediente y documentos', async () => {
  try { await api('DELETE', '/api/employees/' + openId); employees = employees.filter(e => e.id !== openId); $('#dlg').close(); render(); toast('Empleado eliminado'); }
  catch (err) { toast(err.message); }
});
$('#trainForm').addEventListener('submit', async ev => {
  ev.preventDefault(); const name = $('#t_name').value.trim(), done = $('#t_done').value, exp = $('#t_exp').value;
  if (!name) { toast('Escribe el nombre de la capacitación.'); return; }
  if (!exp) { toast('Pon la fecha de vencimiento para recibir el aviso antes de que venza.'); return; }
  if (done && exp < done) { toast('La fecha de vencimiento es anterior a la de realización.'); return; }
  const emp = getEmp(openId); if (!emp) return; const list = (emp.trainings || []).slice();
  const i = list.findIndex(t => (t.name || '').toLowerCase() === name.toLowerCase());
  const rec = { id: i >= 0 ? list[i].id : newId().slice(0, 12), name, done, expires: exp };
  if (i >= 0) list[i] = rec; else list.push(rec);
  try { put(await api('PUT', '/api/employees/' + openId, payload(emp, { trainings: list }))); $('#trainForm').reset(); toast(i >= 0 ? 'Capacitación renovada' : 'Capacitación agregada'); }
  catch (err) { toast(err.message); }
});
$('#docForm').addEventListener('submit', async ev => {
  ev.preventDefault(); const f = $('#u_file').files[0]; if (!f) { toast('Elige un archivo para subir.'); return; }
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (!['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) { toast('Sube un PDF o una foto (JPG, PNG). Los archivos de Word guárdalos primero como PDF.'); return; }
  if (f.size > 20 * 1048576) { toast('El archivo pesa más de 20 MB. Escanéalo con menor resolución e inténtalo de nuevo.'); return; }
  const fd = new FormData(); fd.append('type', $('#u_type').value); fd.append('file', f);
  const btn = $('#upBtn'); btn.disabled = true; btn.textContent = 'Subiendo…';
  try { put(await api('POST', `/api/employees/${openId}/docs`, fd)); $('#docForm').reset(); toast('Documento subido'); }
  catch (err) { toast(err.message); }
  finally { btn.disabled = false; btn.textContent = 'Subir'; }
});

/* ---------- contraseña ---------- */
$('#pwBtn').addEventListener('click', () => { $('#pwForm').reset(); $('#pwErr').hidden = true; $('#pwDlg').showModal(); $('#pw_cur').focus(); });
$('#pwClose').addEventListener('click', () => $('#pwDlg').close());
$('#pwForm').addEventListener('submit', async ev => {
  ev.preventDefault(); const e = $('#pwErr'); e.hidden = true;
  const a = $('#pw_new').value, b = $('#pw_new2').value;
  if (a !== b) { e.textContent = 'Las dos contraseñas nuevas no coinciden.'; e.hidden = false; return; }
  try { await api('POST', '/api/password', { current: $('#pw_cur').value, next: a }); $('#pwDlg').close(); toast('Contraseña actualizada'); }
  catch (err) { e.textContent = err.message; e.hidden = false; }
});
$('#outBtn') && $('#outBtn').addEventListener('click', async () => { try { await api('POST', '/api/logout'); } catch (e) {} location.href = '/login'; });

/* ---------- conexiones ---------- */
document.addEventListener('click', ev => { const b = ev.target.closest('[data-open]'); if (b) openFile(b.dataset.open); });
$('#dClose').addEventListener('click', () => $('#dlg').close());
$('#dlg').addEventListener('click', ev => { if (ev.target === ev.currentTarget) $('#dlg').close(); });
$('#pwDlg').addEventListener('click', ev => { if (ev.target === ev.currentTarget) $('#pwDlg').close(); });
$('#dlg').addEventListener('close', () => { openId = null; isNew = false; });
$('#addBtn').addEventListener('click', () => openFile(null));
$('#q').addEventListener('input', renderRoster);
$('#plant').addEventListener('change', () => { plantSel = $('#plant').value; try { localStorage.setItem('ave-plant', plantSel); } catch (e) {} renderRoster(); });
$('#fAll').addEventListener('click', () => { filter = 'all'; $('#fAll').setAttribute('aria-pressed', 'true'); $('#fAttn').setAttribute('aria-pressed', 'false'); renderRoster(); });
$('#fAttn').addEventListener('click', () => { filter = 'attn'; $('#fAttn').setAttribute('aria-pressed', 'true'); $('#fAll').setAttribute('aria-pressed', 'false'); renderRoster(); });
function syncReports() {
  $('#rWeekly').href = '/reports/weekly.pdf?days=' + win;
  $('#rWeeklyS').textContent = `Vencidas, por vencer en ${win} días y cumpleaños`;
  $('#rCal').href = '/reports/calendar.pdf?month=' + ($('#rMonth').value || '');
}
{ const t = new Date(); $('#rMonth').value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; }
$('#rMonth').addEventListener('change', syncReports);
syncReports();
$('#win').addEventListener('change', () => { win = +$('#win').value; try { localStorage.setItem('ave-win', String(win)); } catch (e) {} syncReports(); render(); });

async function load() {
  try { employees = await api('GET', '/api/employees'); loaded = true; render(); }
  catch (err) { $('#roster').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}
render(); load();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('#dlg').open) load(); });
})();

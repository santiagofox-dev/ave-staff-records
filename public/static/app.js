(function () {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let employees = [], loaded = false, filter = 'all', openId = null, isNew = false;
let win = 60; try { const v = localStorage.getItem('ave-win'); if (v) win = +v || 60; } catch (e) {}
$('#win').value = String(win);

/* ---------- server ---------- */
class ApiError extends Error {}
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opt); } catch (e) { throw new ApiError('No connection to the server. Check your internet and try again.'); }
  if (r.status === 401) { location.href = '/login'; throw new ApiError('Your session ended. Sign in again.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || 'Something went wrong. Try again.');
  return j;
}
function put(emp) {
  const i = employees.findIndex(e => e.id === emp.id);
  if (i >= 0) employees[i] = emp; else employees.push(emp);
  render();
}
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');

/* ---------- dates ---------- */
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const parse = iso => { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); if (!y || !m || !d) return null; return new Date(y, m - 1, d); };
const daysUntil = d => Math.round((d - today()) / 864e5);
const fmt = iso => { const d = typeof iso === 'string' ? parse(iso) : iso; return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; };
const fmtShort = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function nextBirthday(e) {
  if (!e.birthday) return null; const [y, m, d] = e.birthday.split('-').map(Number); if (!m || !d) return null;
  const t = today(); const mk = Y => new Date(Y, m - 1, (m === 2 && d === 29 && !isLeap(Y)) ? 28 : d);
  let c = mk(t.getFullYear()); if (c < t) c = mk(t.getFullYear() + 1);
  return { date: c, days: daysUntil(c), age: y ? c.getFullYear() - y : null };
}
function tStatus(t) {
  const d = parse(t.expires); if (!d) return { key: 'none', label: 'No expiry date', days: Infinity };
  const n = daysUntil(d);
  if (n < 0) return { key: 'bad', label: `Expired ${-n} day${n === -1 ? '' : 's'} ago`, days: n };
  if (n === 0) return { key: 'warn', label: 'Expires today', days: 0 };
  if (n <= win) return { key: 'warn', label: `Expires in ${n} day${n === 1 ? '' : 's'}`, days: n };
  return { key: 'ok', label: `Valid to ${fmt(t.expires)}`, days: n };
}
function eStatus(e) {
  const tr = e.trainings || []; if (!tr.length) return { key: 'none', label: 'No trainings on file' };
  const st = tr.map(tStatus); const bad = st.filter(s => s.key === 'bad').length, warn = st.filter(s => s.key === 'warn').length;
  if (bad) return { key: 'bad', label: `${bad} expired` + (warn ? `, ${warn} expiring` : '') };
  if (warn) return { key: 'warn', label: `${warn} expiring soon` };
  if (st.every(s => s.key === 'none')) return { key: 'none', label: `${tr.length} on file` };
  return { key: 'ok', label: `All ${tr.length} current` };
}
const bdayLabel = b => b.days === 0 ? 'Today' : b.days === 1 ? 'Tomorrow' : `In ${b.days} days`;

/* ---------- ui helpers ---------- */
let toastT; function toast(m) { if (!m) return; const el = $('#toast'); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3400); }
function armed(btn, label, fn) { // two-step confirm instead of a browser popup
  btn.addEventListener('click', () => {
    if (btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = btn.dataset.orig; fn(); return; }
    btn.dataset.orig = btn.dataset.orig || btn.textContent; btn.textContent = label; btn.classList.add('armed');
    setTimeout(() => { if (btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = btn.dataset.orig; } }, 4000);
  });
}
const getEmp = id => employees.find(e => e.id === id);

/* ---------- render ---------- */
function render() {
  const t = employees.length; let expired = 0, expiring = 0; const tAlerts = [];
  employees.forEach(e => (e.trainings || []).forEach(tr => {
    const s = tStatus(tr); if (s.key === 'bad') expired++; if (s.key === 'warn') expiring++;
    if (s.key === 'bad' || s.key === 'warn') tAlerts.push({ e, tr, s });
  }));
  const bdays = employees.map(e => ({ e, b: nextBirthday(e) })).filter(x => x.b && x.b.days <= 30).sort((a, b) => a.b.days - b.b.days);
  const show = loaded || t;
  $('#sTotal').textContent = show ? t : '–'; $('#sExpired').textContent = show ? expired : '–';
  $('#sExpiring').textContent = show ? expiring : '–'; $('#sExpiringL').textContent = `Expiring in ${win} days`; $('#sBday').textContent = show ? bdays.length : '–';

  tAlerts.sort((a, b) => a.s.days - b.s.days);
  $('#trainAlerts').innerHTML = tAlerts.length ? tAlerts.map(a => `<button class="alert ${a.s.key}" data-open="${esc(a.e.id)}"><i></i>
    <span><span class="t">${esc(a.e.name)}</span><br><span class="s">${esc(a.tr.name)}</span></span>
    <span class="d">${a.s.key === 'bad' ? 'EXPIRED' : a.s.days === 0 ? 'TODAY' : a.s.days + ' d'}<br><span class="muted">${fmt(a.tr.expires)}</span></span></button>`).join('')
    : `<div class="empty">${t ? `Nothing expires in the next ${win} days.` : 'Training alerts show here once employees have trainings with expiry dates.'}</div>`;

  $('#bdayAlerts').innerHTML = bdays.length ? bdays.map(x => `<button class="alert bday" data-open="${esc(x.e.id)}"><i></i>
    <span><span class="t">${esc(x.e.name)}</span><br><span class="s">${fmtShort(x.b.date)}${x.b.age ? ` · turns ${x.b.age}` : ''}</span></span>
    <span class="d">${x.b.days === 0 ? 'TODAY' : x.b.days + ' d'}</span></button>`).join('')
    : `<div class="empty">${t ? 'No birthdays in the next 30 days.' : 'Add a birthday to an employee profile to get reminders here.'}</div>`;

  renderRoster();
  if (openId && !isNew) renderFileLists();
}
function renderRoster() {
  const el = $('#roster');
  if (!employees.length) {
    el.innerHTML = loaded ? `<div class="empty"><strong>No employees yet.</strong> Use “Add employee” to create the first file: profile, birthday, safety trainings with expiry dates, and documents like INE, CURP or NSS.</div>` : '<div class="state muted">Loading records…</div>';
    return;
  }
  const q = $('#q').value.trim().toLowerCase();
  let list = employees.filter(e => !q || [e.name, e.position, e.site].some(v => (v || '').toLowerCase().includes(q)));
  if (filter === 'attn') list = list.filter(e => ['bad', 'warn'].includes(eStatus(e).key));
  const rank = { bad: 0, warn: 1, none: 2, ok: 3 };
  list.sort((a, b) => filter === 'attn' ? (rank[eStatus(a).key] - rank[eStatus(b).key]) : (a.name || '').localeCompare(b.name || ''));
  if (!list.length) { el.innerHTML = `<div class="empty">${filter === 'attn' ? 'No one needs attention right now.' : 'No employees match that search.'}</div>`; return; }
  el.innerHTML = `<div class="row head"><span>Employee</span><span class="c-site">Site</span><span>Safety training</span><span class="c-bday">Next birthday</span><span class="c-docs">Docs</span></div>` +
    list.map(e => {
      const s = eStatus(e), b = nextBirthday(e);
      return `<button class="row" data-open="${esc(e.id)}">
      <span><span class="name">${esc(e.name)}</span><br><span class="sub">${esc(e.position || '—')}</span></span>
      <span class="c-site sub">${esc(e.site || '—')}</span>
      <span><span class="chip ${s.key}">${esc(s.label)}</span></span>
      <span class="c-bday">${b ? (b.days <= 30 ? `<span class="chip bday">${fmtShort(b.date)} · ${bdayLabel(b)}</span>` : `<span class="mono muted">${fmtShort(b.date)}</span>`) : '<span class="muted">—</span>'}</span>
      <span class="c-docs mono muted">${(e.docs || []).length}</span></button>`;
    }).join('');
}

/* ---------- employee file ---------- */
const P = ['name', 'position', 'site', 'birthday', 'hire', 'phone', 'emerg', 'notes'];
function setLocked(v) { $('#trainCard').classList.toggle('locked', v); $('#docCard').classList.toggle('locked', v); }
function openFile(id) {
  const e = id ? getEmp(id) : null; isNew = !e;
  openId = e ? e.id : newId();
  P.forEach(k => $('#p_' + k).value = e ? (e[k] || '') : '');
  $('#dName').textContent = e ? e.name : 'New employee';
  $('#dSub').textContent = e ? [e.position, e.site].filter(Boolean).join(' · ') : 'Save the profile to start adding trainings and documents.';
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
      <span><span class="t">${esc(t.name)}</span><br><span class="s mono">${t.done ? 'Completed ' + fmt(t.done) : 'Completion date not set'}</span></span>
      <span class="chip ${s.key}">${esc(s.label)}</span>
      <button class="btn sm danger" data-deltrain="${esc(t.id)}">Remove</button></div>`;
  }).join('') : `<div class="empty">No trainings recorded. Add each course with its expiry date to get warnings before it lapses.</div>`;
  $('#docList').innerHTML = docs.length ? docs.slice().sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || '')).map(d => `<div class="item">
      <span><span class="t">${esc(d.type)}</span><br><span class="s">${esc(d.fileName)} · <span class="mono">${(d.size / 1048576).toFixed(d.size < 1048576 ? 2 : 1)} MB · ${fmt((d.uploadedAt || '').slice(0, 10))}</span></span></span>
      <a href="/files/${esc(d.id)}" target="_blank" rel="noopener">Open</a>
      <button class="btn sm danger" data-deldoc="${esc(d.id)}">Delete</button></div>`).join('')
    : `<div class="empty">No documents yet. Upload scans or photos of INE, CURP, NSS, contracts and certificates.</div>`;
  $('#trainList').querySelectorAll('[data-deltrain]').forEach(b => armed(b, 'Confirm', async () => {
    const emp = getEmp(openId); if (!emp) return;
    try { put(await api('PUT', '/api/employees/' + openId, payload(emp, { trainings: emp.trainings.filter(t => t.id !== b.dataset.deltrain) }))); toast('Training removed'); }
    catch (err) { toast(err.message); }
  }));
  $('#docList').querySelectorAll('[data-deldoc]').forEach(b => armed(b, 'Confirm delete', async () => {
    try { put(await api('DELETE', `/api/employees/${openId}/docs/${b.dataset.deldoc}`)); toast('Document deleted'); }
    catch (err) { toast(err.message); }
  }));
}

$('#profile').addEventListener('submit', async ev => {
  ev.preventDefault(); const name = $('#p_name').value.trim();
  if (!name) { toast('Enter the employee’s full name.'); $('#p_name').focus(); return; }
  const prev = getEmp(openId) || { trainings: [] };
  const body = { trainings: prev.trainings || [] }; P.forEach(k => body[k] = $('#p_' + k).value.trim());
  const btn = $('#saveProfile'); btn.disabled = true;
  try {
    const emp = await api('PUT', '/api/employees/' + openId, body); put(emp);
    toast(isNew ? 'Employee added' : 'Profile saved');
    if (isNew) { isNew = false; setLocked(false); $('#delEmp').hidden = false; renderFileLists(); }
    $('#dName').textContent = emp.name; $('#dSub').textContent = [emp.position, emp.site].filter(Boolean).join(' · ');
  } catch (err) { toast(err.message); } finally { btn.disabled = false; }
});
armed($('#delEmp'), 'Confirm: delete file and documents', async () => {
  try { await api('DELETE', '/api/employees/' + openId); employees = employees.filter(e => e.id !== openId); $('#dlg').close(); render(); toast('Employee deleted'); }
  catch (err) { toast(err.message); }
});
$('#trainForm').addEventListener('submit', async ev => {
  ev.preventDefault(); const name = $('#t_name').value.trim(), done = $('#t_done').value, exp = $('#t_exp').value;
  if (!name) { toast('Enter the training name.'); return; }
  if (!exp) { toast('Enter the expiry date so you get a warning before it lapses.'); return; }
  if (done && exp < done) { toast('The expiry date is before the completion date.'); return; }
  const emp = getEmp(openId); if (!emp) return; const list = (emp.trainings || []).slice();
  const i = list.findIndex(t => (t.name || '').toLowerCase() === name.toLowerCase());
  const rec = { id: i >= 0 ? list[i].id : newId().slice(0, 12), name, done, expires: exp };
  if (i >= 0) list[i] = rec; else list.push(rec);
  try { put(await api('PUT', '/api/employees/' + openId, payload(emp, { trainings: list }))); $('#trainForm').reset(); toast(i >= 0 ? 'Training renewed' : 'Training added'); }
  catch (err) { toast(err.message); }
});
$('#docForm').addEventListener('submit', async ev => {
  ev.preventDefault(); const f = $('#u_file').files[0]; if (!f) { toast('Choose a file to upload.'); return; }
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (!['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) { toast('Upload a PDF or a photo (JPG, PNG). Save Word files as PDF first.'); return; }
  if (f.size > 20 * 1048576) { toast('That file is over 20 MB. Scan it at a lower resolution and try again.'); return; }
  const fd = new FormData(); fd.append('type', $('#u_type').value); fd.append('file', f);
  const btn = $('#upBtn'); btn.disabled = true; btn.textContent = 'Uploading…';
  try { put(await api('POST', `/api/employees/${openId}/docs`, fd)); $('#docForm').reset(); toast('Document uploaded'); }
  catch (err) { toast(err.message); }
  finally { btn.disabled = false; btn.textContent = 'Upload'; }
});

/* ---------- password ---------- */
$('#pwBtn').addEventListener('click', () => { $('#pwForm').reset(); $('#pwErr').hidden = true; $('#pwDlg').showModal(); $('#pw_cur').focus(); });
$('#pwClose').addEventListener('click', () => $('#pwDlg').close());
$('#pwForm').addEventListener('submit', async ev => {
  ev.preventDefault(); const e = $('#pwErr'); e.hidden = true;
  const a = $('#pw_new').value, b = $('#pw_new2').value;
  if (a !== b) { e.textContent = 'The two new passwords don’t match.'; e.hidden = false; return; }
  try { await api('POST', '/api/password', { current: $('#pw_cur').value, next: a }); $('#pwDlg').close(); toast('Password changed'); }
  catch (err) { e.textContent = err.message; e.hidden = false; }
});
$('#outBtn').addEventListener('click', async () => { try { await api('POST', '/api/logout'); } catch (e) {} location.href = '/login'; });

/* ---------- wiring ---------- */
document.addEventListener('click', ev => { const b = ev.target.closest('[data-open]'); if (b) openFile(b.dataset.open); });
$('#dClose').addEventListener('click', () => $('#dlg').close());
$('#dlg').addEventListener('click', ev => { if (ev.target === ev.currentTarget) $('#dlg').close(); });
$('#pwDlg').addEventListener('click', ev => { if (ev.target === ev.currentTarget) $('#pwDlg').close(); });
$('#dlg').addEventListener('close', () => { openId = null; isNew = false; });
$('#addBtn').addEventListener('click', () => openFile(null));
$('#q').addEventListener('input', renderRoster);
$('#fAll').addEventListener('click', () => { filter = 'all'; $('#fAll').setAttribute('aria-pressed', 'true'); $('#fAttn').setAttribute('aria-pressed', 'false'); renderRoster(); });
$('#fAttn').addEventListener('click', () => { filter = 'attn'; $('#fAttn').setAttribute('aria-pressed', 'true'); $('#fAll').setAttribute('aria-pressed', 'false'); renderRoster(); });
$('#win').addEventListener('change', () => { win = +$('#win').value; try { localStorage.setItem('ave-win', String(win)); } catch (e) {} render(); });

async function load() {
  try { employees = await api('GET', '/api/employees'); loaded = true; render(); }
  catch (err) { $('#roster').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}
render(); load();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('#dlg').open) load(); });
})();

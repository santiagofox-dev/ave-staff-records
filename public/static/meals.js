(function () {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let run = null, rows = [], curPhoto = 1, rot = 0, rosterOpts = '', unusual = new Set(), byId = {};

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body; else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r; try { r = await fetch(url, opt); } catch (e) { throw new Error('Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'); }
  if (r.status === 401) { location.href = '/login'; throw new Error('Tu sesión terminó.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Algo salió mal. Inténtalo de nuevo.');
  return j;
}
let toastT; function toast(m) { const el = $('#toast'); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3500); }
function showErr(sel, msg) { const e = $(sel); e.textContent = msg || ''; e.hidden = !msg; }
function step(n) { document.querySelectorAll('#steps li').forEach(li => { const k = +li.dataset.step; li.className = k < n ? 'done' : k === n ? 'on' : ''; }); }

/* ---------- 1. upload ---------- */
$('#up').addEventListener('submit', async ev => {
  ev.preventDefault(); showErr('#upErr');
  const fd = new FormData();
  const photos = $('#f_photos').files;
  if (!photos.length) return showErr('#upErr', 'Elige al menos una foto de las hojas.');
  for (const f of photos) fd.append('photos', f);
  for (const [k, sel, label] of [['roster', '#f_roster', 'la lista de nuevos ingresos'], ['noreg', '#f_noreg', 'NO REGISTRADOS'], ['delphi', '#f_delphi', 'el reporte DELPHI']]) {
    const f = $(sel).files[0]; if (!f) return showErr('#upErr', `Falta ${label}.`); fd.append(k, f);
  }
  const b = $('#upBtn'); b.disabled = true; b.textContent = 'Subiendo…';
  try { run = await api('POST', '/api/meals/runs', fd); showRun(); }
  catch (e) { showErr('#upErr', e.message); }
  finally { b.disabled = false; b.textContent = 'Subir archivos'; }
});

function showRun() {
  $('#s2').hidden = false; step(2);
  $('#runInfo').innerHTML = `<b>${esc(run.label)}</b> · días en DELPHI: ${run.days.map(esc).join(', ')} · ${run.files.photos.length} foto(s) · ${run.rosterSize} nuevos ingresos en la lista · ${run.noRegSize} escaneos NO REGISTRADOS (${run.noRegMatches} de nuevos ingresos)`;
  history.replaceState(null, '', '#' + run.id);
}

/* ---------- 2. read ---------- */
$('#readBtn').addEventListener('click', async () => {
  showErr('#readErr'); $('#readBtn').disabled = true;
  try { run = await api('POST', `/api/meals/runs/${run.id}/read`); poll(); }
  catch (e) { showErr('#readErr', e.message); $('#readBtn').disabled = false; }
});
async function poll() {
  $('#prog').hidden = false;
  for (;;) {
    run = await api('GET', `/api/meals/runs/${run.id}`);
    const r = run.reading || { done: 0, total: 1 };
    $('#progBar').style.width = `${Math.round(100 * r.done / Math.max(1, r.total))}%`;
    $('#progTxt').textContent = `${r.done} de ${r.total} fotos`;
    if (run.status === 'read' || run.status === 'generated') break;
    await new Promise(res => setTimeout(res, 2000));
  }
  $('#readBtn').disabled = false; $('#readBtn').textContent = 'Volver a leer fotos';
  if (run.reading.errors.length) showErr('#readErr', run.reading.errors.join(' · '));
  buildReview();
}

/* ---------- 3. review ---------- */
function buildReview() {
  $('#s3').hidden = false; step(3);
  byId = Object.fromEntries(run.roster.map(r => [r.id, r]));
  unusual = new Set(run.unusualIds);
  rosterOpts = run.roster.slice().sort((a, b) => a.name.localeCompare(b.name, 'es')).map(r => `<option value="${esc(r.id)}">${esc(r.name)} · ${esc(r.id)}</option>`).join('');
  rows = run.suggestions.rows.map((r, i) => ({ ...r, key: i, origId: r.id }));
  const flags = [];
  if (run.suggestions.unknownDays.length) flags.push(['bad', `Columnas de día que no están en el reporte DELPHI (no se cuentan): ${run.suggestions.unknownDays.join(', ')}`]);
  for (const p of run.photos) { if (p.error) flags.push(['bad', `Foto ${p.n}: ${p.error}`]); else { if (p.warning) flags.push(['bad', `Foto ${p.n}: ${p.warning}`]); if (p.sheet_title) flags.push(['ok', `Foto ${p.n}: “${p.sheet_title}” · ${p.rows.length} renglones${p.retried ? ' (se reintentó)' : ''}`]); } }
  const unc = rows.filter(r => r.uncertain.length).length; if (unc) flags.push(['', `${unc} renglón(es) con celdas inciertas, marcadas en amarillo. Compáralas con la foto.`]);
  const fz = rows.filter(r => r.matchKind === 'fuzzy').length; if (fz) flags.push(['', `${fz} nombre(s) con coincidencia aproximada. Confirma o cambia el nombre en la lista.`]);
  const no = rows.filter(r => !r.id).length; if (no) flags.push(['bad', `${no} nombre(s) sin ID. Elige el nombre correcto o déjalos como SIN ID (no se agregan a DELPHI).`]);
  $('#flags').innerHTML = flags.map(([k, t]) => `<div class="flag ${k}">${esc(t)}</div>`).join('');
  $('#photoTabs').innerHTML = run.files.photos.map(p => `<button type="button" data-p="${p.n}" aria-pressed="${p.n === curPhoto}">Foto ${p.n}</button>`).join('');
  showPhoto(curPhoto); renderGrid();
}
function showPhoto(n) {
  curPhoto = n;
  $('#photo').src = `/api/meals/runs/${run.id}/photo/${n}`;
  document.querySelectorAll('#photoTabs button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.p === n)));
  applyZoom(); renderGrid();
}
function applyZoom() {
  const z = +$('#zoom').value / 100, img = $('#photo');
  const w = Math.max(200, ($('#imgbox').clientWidth - 2)) * z; // 100% = fit the box width
  img.style.width = `${w}px`; img.style.transform = rot ? `rotate(${rot}deg)` : '';
  if (rot % 180) img.style.transformOrigin = 'center'; else img.style.transformOrigin = 'top left';
}
$('#photo').addEventListener('load', applyZoom);
$('#zoom').addEventListener('input', applyZoom);
$('#rot').addEventListener('click', () => { rot = (rot + 90) % 360; applyZoom(); });
$('#photoTabs').addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (b) showPhoto(+b.dataset.p); });
$('#onlyPhoto').addEventListener('change', renderGrid);

function rowClass(r) { return [!r.id ? 'no' : (r.matchKind === 'fuzzy' && r.id === r.origId ? 'fz' : ''), r.id && unusual.has(r.id) ? 'odd' : ''].join(' '); }
function selectHTML(r) {
  const alts = (r.alternatives || []).filter(a => a.id).map(a => `<option value="${esc(a.id)}">${esc(a.name)} · ${a.score}%</option>`).join('');
  return `<select data-k="${r.key}" aria-label="Nombre en la lista oficial"><option value="">— SIN ID —</option>${alts ? `<optgroup label="Más parecidos">${alts}</optgroup>` : ''}<optgroup label="Todos">${rosterOpts}</optgroup></select>`;
}
function renderGrid() {
  if (!run) return;
  const days = run.days;
  const vis = rows.filter(r => !r.deleted && (!$('#onlyPhoto').checked || r.photo === curPhoto || r.photo == null));
  $('#grid').innerHTML = `<thead><tr><th>#</th><th>Nombre en la hoja</th><th>Lista oficial</th><th>ID</th>${days.map(d => `<th>${esc(d)}</th>`).join('')}<th>Nota</th><th></th></tr></thead><tbody>` +
    vis.map(r => `<tr class="${rowClass(r)}" data-k="${r.key}">
      <td class="src">${r.photo ? 'F' + r.photo : '+'}${r.row != null ? ' #' + esc(r.row) : ''}</td>
      <td><input class="nm" data-k="${r.key}" value="${esc(r.nameAsWritten)}" aria-label="Nombre como aparece en la hoja"></td>
      <td>${selectHTML(r)}${r.matchKind === 'fuzzy' && r.id === r.origId ? `<div class="note">aprox. ${r.matchScore}%</div>` : ''}</td>
      <td class="idc mono">${esc(r.id || 'SIN ID')}${r.id && unusual.has(r.id) ? ' ⚠' : ''}</td>
      ${days.map(d => `<td class="d${r.uncertain.includes(d) ? ' unc' : ''}"><input type="checkbox" data-k="${r.key}" data-d="${esc(d)}" ${r.marks[d] ? 'checked' : ''} aria-label="${esc(d)}"></td>`).join('')}
      <td class="note">${esc(r.note || '')}</td>
      <td><button class="x" data-del="${r.key}" title="Quitar renglón" aria-label="Quitar renglón">×</button></td></tr>`).join('') + '</tbody>';
  vis.forEach(r => { const s = document.querySelector(`select[data-k="${r.key}"]`); if (s) s.value = r.id || ''; });
  const all = rows.filter(r => !r.deleted);
  const meals = all.reduce((s, r) => s + Object.values(r.marks).filter(Boolean).length, 0);
  $('#countTxt').textContent = `${all.length} renglones · ${meals} marcas en total (antes de quitar duplicados)`;
}
$('#grid').addEventListener('change', e => {
  const t = e.target, r = rows.find(x => x.key === +t.dataset.k); if (!r) return;
  if (t.matches('input[type=checkbox]')) r.marks[t.dataset.d] = t.checked;
  else if (t.matches('select')) { r.id = t.value || null; r.matchKind = r.id ? (r.id === r.origId && r.matchKind !== 'manual' ? r.matchKind : 'manual') : null; renderGrid(); }
  else if (t.matches('input.nm')) r.nameAsWritten = t.value;
});
$('#grid').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; const r = rows.find(x => x.key === +b.dataset.del); if (r) { r.deleted = true; renderGrid(); } });
$('#addRow').addEventListener('click', () => {
  const k = rows.length ? Math.max(...rows.map(r => r.key)) + 1 : 0;
  rows.push({ key: k, source: `Foto ${curPhoto}`, photo: curPhoto, row: null, nameAsWritten: '', marks: {}, uncertain: [], note: 'Agregado en la revisión', id: null, matchKind: 'manual', alternatives: [] });
  renderGrid(); const inp = document.querySelector(`input.nm[data-k="${k}"]`); if (inp) inp.focus();
});

/* ---------- 4. generate ---------- */
$('#genBtn').addEventListener('click', async () => {
  showErr('#genErr');
  const payload = rows.filter(r => !r.deleted).map(r => ({ source: r.source, row: r.row, nameAsWritten: r.nameAsWritten, id: r.id, marks: r.marks, uncertain: r.uncertain, note: r.note, matchKind: r.matchKind }));
  const b = $('#genBtn'); b.disabled = true; b.textContent = 'Generando…';
  try { const out = await api('POST', `/api/meals/runs/${run.id}/generate`, { rows: payload }); showResult(out); loadHistory(); }
  catch (e) { showErr('#genErr', e.message); }
  finally { b.disabled = false; b.textContent = 'Generar'; }
});
function showResult(out) {
  $('#s4').hidden = false; step(4);
  const t = out.totals;
  $('#result').innerHTML = `<div class="res">
    <div class="dl"><a class="btn primary" href="/api/meals/runs/${run.id}/file/delphi">Descargar DELPHI actualizado</a><a class="btn" href="/api/meals/runs/${run.id}/file/summary">Descargar resumen</a></div>
    <p><b>${t.added}</b> comidas agregadas a DELPHI · <b>${t.sinId}</b> sin ID · <b>${t.employees}</b> empleados comieron · <b>${t.noRegAdded}</b> de NO REGISTRADOS</p>
    <table><thead><tr><th>Día</th><th>DELPHI original</th><th>Agregadas</th><th>Actualizado</th></tr></thead><tbody>
    ${t.days.map(d => `<tr><td>${esc(d.day)}</td><td>${d.original}</td><td>${d.added}</td><td>${d.updated}</td></tr>`).join('')}
    <tr class="t"><td>SERVICIOS NETO</td><td>${t.netoOriginal}</td><td>${t.neto - t.netoOriginal}</td><td>${t.neto}</td></tr></tbody></table>
    ${out.flags.length ? `<h3>Puntos a revisar</h3><div class="flags">${out.flags.map(f => `<div class="flag">${esc(f)}</div>`).join('')}</div>` : ''}</div>`;
  $('#s4').scrollIntoView({ behavior: 'smooth' });
}

/* ---------- history ---------- */
async function loadHistory() {
  try {
    const h = await api('GET', '/api/meals/history');
    $('#hist').innerHTML = h.length ? `<table class="hist"><thead><tr><th>Semana</th><th>Generado</th><th>Por</th><th>Agregadas</th><th>Sin ID</th><th>Empleados</th><th>Neto</th><th></th></tr></thead><tbody>${h.map(x => `<tr><td>${esc(x.label)}</td><td>${new Date(x.at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${esc(x.by)}</td><td>${x.added}</td><td>${x.sinId}</td><td>${x.employees}</td><td>${x.neto}</td><td><a href="/api/meals/runs/${esc(x.id)}/file/delphi">DELPHI</a> · <a href="/api/meals/runs/${esc(x.id)}/file/summary">Resumen</a></td></tr>`).join('')}</tbody></table>` : 'Todavía no hay conciliaciones.';
  } catch (e) { $('#hist').textContent = e.message; }
}

(async () => {
  try { const c = await api('GET', '/api/meals/config'); $('#keyWarn').hidden = c.hasKey; } catch (e) {}
  loadHistory();
  const id = location.hash.slice(1);
  if (/^[a-f0-9]{16}$/.test(id)) {
    try { run = await api('GET', `/api/meals/runs/${id}`); showRun(); if (run.status === 'reading') poll(); else if (run.status === 'read' || run.status === 'generated') { $('#readBtn').textContent = 'Volver a leer fotos'; buildReview(); } }
    catch (e) { history.replaceState(null, '', location.pathname); }
  }
})();
})();

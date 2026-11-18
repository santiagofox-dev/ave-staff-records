(function () {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let typedPeople = {};
let run = null, readConf = null, genArmed = false, rows = [], curPhoto = 1, rot = 0, rosterOpts = '', unusual = new Set(), byId = {};

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body; else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r; try { r = await (window.aveFetch || fetch)(url, opt); } catch (e) { throw new Error('Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'); }
  if (r.status === 401) { location.href = '/login'; throw new Error('Tu sesión terminó.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Algo salió mal. Inténtalo de nuevo.');
  return j;
}
let toastT; function toast(m) { const el = $('#toast'); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3500); }
function showErr(sel, msg) { const e = $(sel); e.textContent = msg || ''; e.hidden = !msg; }
function step(n) { document.querySelectorAll('#steps li').forEach(li => { const k = +li.dataset.step; li.className = k < n ? 'done' : k === n ? 'on' : ''; }); }

/* ---------- 1. upload: one drop zone for everything ---------- */
// Photos and Excel files go in together; the Excel kind is guessed by name here and confirmed by its columns on the server
let photoList = [], xlsxList = []; // xlsxList: { file, kind: 'delphi'|'noreg'|'roster'|'?'|null }
const guess = n => /delphi|detallado/i.test(n) ? 'delphi' : /no[\s_-]*registrad/i.test(n) ? 'noreg' : /numero|ingreso|listado|personal/i.test(n) ? 'roster' : '?';
const kindOf = x => x.kind;
async function sniff(x) {
  const fd = new FormData(); fd.append('file', x.file, x.file.name);
  try { const r = await api('POST', '/api/meals/sniff', fd); x.kind = r.kind; } catch (e) { x.kind = guess(x.file.name); }
  if (!x.kind) toast(`No reconocí "${x.file.name}": no parece DELPHI, NO REGISTRADOS ni la lista.`);
  // one file per kind: the newest wins
  xlsxList = xlsxList.filter(y => y === x || !x.kind || y.kind !== x.kind);
  renderFiles();
}
const KIND = { delphi: 'Reporte DELPHI', noreg: 'NO REGISTRADOS', roster: 'Lista de nuevos ingresos' };
function addFiles(files) {
  for (const f of files) {
    if (/\.xlsx$/i.test(f.name)) { if (!xlsxList.some(x => x.file.name === f.name && x.file.size === f.size)) { const x = { file: f, kind: '?' }; xlsxList.push(x); sniff(x); } continue; }
    if (/\.(xls|csv)$/i.test(f.name)) { toast(`"${f.name}": guárdalo como Excel .xlsx.`); continue; }
    if (!/^image\/(jpeg|png|webp)$/i.test(f.type) && !/\.(jpe?g|png|webp)$/i.test(f.name)) { toast(/heic/i.test(f.name + f.type) ? 'Las fotos HEIC no se pueden leer: envíalas como JPG.' : `"${f.name}" no es foto ni Excel.`); continue; }
    if (!photoList.some(p => p.name === f.name && p.size === f.size)) photoList.push(f);
  }
  if (photoList.length > 40) { photoList = photoList.slice(0, 40); toast('Máximo 40 fotos por semana.'); }
  renderFiles();
}
function renderFiles() {
  const has = k => { const x = xlsxList.find(y => y.kind === k); return x && x.file; };
  const checking = xlsxList.some(x => x.kind === '?');
  const item = (ok, label, detail, optional) => `<li class="${ok ? 'ok' : optional ? 'optional' : 'miss'}"><span class="ic" aria-hidden="true">${ok ? '✓' : optional ? '–' : '!'}</span><b>${label}</b><span class="d">${detail}</span></li>`;
  $('#checklist').innerHTML =
    item(photoList.length, 'Fotos de las hojas', photoList.length ? `${photoList.length} foto${photoList.length === 1 ? '' : 's'}` : 'falta al menos una') +
    item(has('delphi'), 'Reporte DELPHI', has('delphi') ? esc(has('delphi').name) : 'falta “DELPHI … Detallado.xlsx”') +
    item(has('noreg'), 'NO REGISTRADOS', has('noreg') ? esc(has('noreg').name) : 'falta') +
    item(has('roster'), 'Lista de nuevos ingresos', has('roster') ? esc(has('roster').name) : (window.__savedNums ? `opcional: se usan los ${window.__savedNums} números guardados` : 'opcional: la primera vez conviene subirla'), true);
  $('#dropTxt').textContent = photoList.length || xlsxList.length ? 'Toca o arrastra para agregar más' : 'Toca aquí o arrastra todos los archivos de la semana';
  const ready = photoList.length && has('delphi') && has('noreg') && !checking;
  $('#upBtn').disabled = !ready;
  const box = $('#pthumbs'); box.replaceChildren();
  photoList.forEach((f, i) => {
    const fig = document.createElement('figure'), img = document.createElement('img'), x = document.createElement('button'), cap = document.createElement('figcaption');
    img.alt = f.name; const rd = new FileReader(); rd.onload = () => { img.src = rd.result; }; rd.readAsDataURL(f); // data: URLs (the page's CSP blocks blob:)
    x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.title = 'Quitar foto'; x.setAttribute('aria-label', 'Quitar ' + f.name); x.onclick = () => { photoList.splice(i, 1); renderFiles(); };
    cap.textContent = `Foto ${i + 1}`;
    fig.append(img, x, cap); box.append(fig);
  });
  xlsxList.forEach((f, i) => {
    const chip = document.createElement('figure'), x = document.createElement('button'), t = document.createElement('div');
    chip.className = 'xchip' + (f.kind ? '' : ' bad'); t.innerHTML = `<b>${f.kind === '?' ? 'Revisando…' : f.kind ? esc(KIND[f.kind]) : 'No reconocido'}</b><span>${esc(f.file.name)}</span>`;
    x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.title = 'Quitar'; x.onclick = () => { xlsxList.splice(i, 1); renderFiles(); };
    chip.append(t, x); box.append(chip);
  });
}
$('#f_all').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
const pd = $('#photoDrop');
['dragenter', 'dragover'].forEach(t => pd.addEventListener(t, e => { e.preventDefault(); pd.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => pd.addEventListener(t, e => { e.preventDefault(); pd.classList.remove('over'); }));
pd.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));
renderFiles();

$('#up').addEventListener('submit', async ev => {
  ev.preventDefault(); showErr('#upErr');
  if (!photoList.length) return showErr('#upErr', 'Agrega al menos una foto de las hojas.');
  const fd = new FormData();
  for (const f of photoList) fd.append('photos', f);
  for (const x of xlsxList.filter(y => y.kind)) fd.append('xlsx', x.file, x.file.name);
  const b = $('#upBtn'); b.disabled = true; b.textContent = 'Subiendo…';
  try {
    run = await api('POST', '/api/meals/runs', fd); showRun();
    // go straight on to reading the photos
    b.textContent = 'Leyendo…'; await startRead();
  } catch (e) { showErr('#upErr', e.message); }
  finally { b.disabled = false; b.textContent = 'Subir y leer fotos'; }
});

function showRun() {
  $('#s2').hidden = false; step(1);
  // this week is under way: fold the upload box into a one-line summary
  $('#up').hidden = true; $('#s1 > p').hidden = true; $('#foldRow').hidden = false;
  $('#s1 h2').textContent = `1. Semana ${run.label}`;
  $('#runInfo').innerHTML = `<b>${esc(run.label)}</b> · días en DELPHI: ${run.days.map(esc).join(', ')} · ${run.files.photos.length} foto(s) · ${run.rosterSize} números de empleado guardados · ${run.noRegSize} escaneos NO REGISTRADOS (${run.noRegMatches} de nuevos ingresos)`;
  $('#rosterUpd').innerHTML = rosterUpdHTML(run.rosterUpdate, run.rosterSize);
  history.replaceState(null, '', '#' + run.id);
}

/* ---------- 2. read ---------- */
async function startRead() {
  showErr('#readErr'); $('#readBtn').disabled = true;
  try { run = await api('POST', `/api/meals/runs/${run.id}/read`); await poll(); }
  catch (e) { showErr('#readErr', e.message); $('#readBtn').disabled = false; }
}
$('#readBtn').addEventListener('click', startRead);
$('#newWeek').addEventListener('click', () => { location.href = location.pathname; });
async function poll() {
  $('#prog').hidden = false;
  for (;;) {
    run = await api('GET', `/api/meals/runs/${run.id}`);
    const r = run.reading || { done: 0, total: 1 };
    $('#progBar').style.width = `${Math.round(100 * r.done / Math.max(1, r.total))}%`;
    $('#progTxt').textContent = r.done < r.total ? `Leyendo foto ${r.done + 1} de ${r.total}… (cada foto tarda unos segundos)` : `${r.total} de ${r.total} fotos leídas`;
    if (run.status === 'read' || run.status === 'generated') break;
    await new Promise(res => setTimeout(res, 2000));
  }
  $('#readBtn').disabled = false; $('#readBtn').textContent = 'Volver a leer fotos'; $('#readBtn').hidden = false; $('#prog').hidden = true;
  if (run.reading.errors.length) showErr('#readErr', run.reading.errors.join(' · '));
  buildReview();
  if (run.confidence) toast(`Lectura terminada · confianza ${run.confidence.pct}% · ${run.confidence.items.length} puntos por revisar`);
}

/* ---------- 3. review ---------- */
function buildReview() {
  $('#s3').hidden = false; step(2); $('#s1').classList.add('compact');
  setTimeout(() => $('#s3').scrollIntoView({ behavior: 'smooth' }), 50);
  byId = Object.fromEntries(run.roster.map(r => [r.id, r]));
  unusual = new Set(run.unusualIds);
  rosterOpts = run.roster.slice().sort((a, b) => a.name.localeCompare(b.name, 'es')).map(r => `<option value="${esc(r.id)}">${esc(r.name)} · ${esc(r.id)}</option>`).join('');
  rows = run.suggestions.rows.map((r, i) => ({ ...r, disputed: r.disputed || [], key: i, origId: r.id, reviewed: { days: [], name: false, id: false } }));
  readConf = run.confidence;
  const flags = [];
  if (run.suggestions.unknownDays.length) flags.push(['bad', `Columnas de día que no están en el reporte DELPHI (no se cuentan): ${run.suggestions.unknownDays.join(', ')}`]);
  for (const p of run.photos) { if (p.error) flags.push(['bad', `Foto ${p.n}: ${p.error}`]); else { if (p.warning) flags.push(['bad', `Foto ${p.n}: ${p.warning}`]); if (p.sheet_title) flags.push(['ok', `Foto ${p.n}: “${p.sheet_title}” · ${p.rows.length} renglones${p.retried ? ' (se reintentó)' : ''}`]); } }
  $('#flags').innerHTML = flags.map(([k, t]) => `<div class="flag ${k}">${esc(t)}</div>`).join('');
  showPhoto(curPhoto);
}
function showPhoto(n) {
  if (curPhoto !== n || !$('#photo').src) $('#photo').src = `/api/meals/runs/${run.id}/photo/${n}`;
  curPhoto = n;
  applyZoom(); renderGrid();
}
const confClass = p => p >= 95 ? 'hi' : p >= 80 ? 'mid' : 'lo';
function officialName(id) { return id && byId[id] ? byId[id].name : null; }
function current() { return MealsConf.assess(rows.map(r => ({ ...r, officialName: officialName(r.id) })), run.days, { unusualIds: run.unusualIds }); }
function refreshConf() {
  const now = current();
  const pend = now.items.length;
  $('#nextPt').hidden = !pend; $('#nextPt').textContent = pend ? `Ir al siguiente punto (${pend})` : '';
  $('#genBtn').textContent = pend ? 'Generar de todos modos' : 'Generar DELPHI';
  $('#genBtn').classList.toggle('ready', !pend);
  $('#conf').innerHTML = `<div class="confbox ${confClass(now.pct)}">
      <div class="big">${now.pct}%</div>
      <div><b>Confianza ${MealsConf.label(now.pct)}</b><br><span class="muted small">Lectura de la IA: ${readConf ? readConf.pct + '%' : '—'} · ahora, con tu revisión: ${now.pct}% · ${now.sure} de ${now.total} marcas seguras</span></div>
      <div class="pend ${pend ? 'lo' : 'hi'}">${pend ? `${pend} punto${pend === 1 ? '' : 's'} por revisar` : 'Todo revisado'}</div>
    </div>`;
  $('#photoTabs').innerHTML = run.files.photos.map(p => { const c = now.perPhoto[p.n]; return `<button type="button" data-p="${p.n}" aria-pressed="${p.n === curPhoto}">Foto ${p.n}${c ? ` · <span class="pc ${confClass(c.pct)}">${c.pct}%</span>${c.pending ? ` · ${c.pending} por revisar` : ''}` : ''}</button>`; }).join('');
  const only = $('#todoOnly').checked;
  const list = now.items.filter(it => !only || it.photo === curPhoto);
  $('#todo').innerHTML = list.length ? list.map((it, i) => `<li class="ti ${it.kind}">
      <button type="button" class="go" data-go="${it.key}" data-day="${esc(it.day || '')}" title="Ver en la foto y en la tabla">${esc(MealsConf.itemText(it))}</button>
      <button type="button" class="ok" data-ok="${it.key}" data-kind="${it.kind}" data-day="${esc(it.day || '')}" title="Ya lo revisé">✓ Está bien</button></li>`).join('')
    : `<li class="none">${now.items.length ? 'No hay puntos pendientes en esta foto.' : 'No hay puntos pendientes. Puedes generar.'}</li>`;
  return now;
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

function rowClass(r) { return [!r.id ? (r.reviewed.name ? '' : 'no') : (r.matchKind === 'fuzzy' && !r.reviewed.name ? 'fz' : ''), r.id && unusual.has(r.id) && !r.reviewed.id ? 'odd' : ''].join(' '); }
function selectHTML(r) {
  const alts = (r.alternatives || []).filter(a => a.id).map(a => `<option value="${esc(a.id)}">${esc(a.name)} · ${a.score}%</option>`).join('');
  return `<select data-k="${r.key}" aria-label="Nombre en la lista oficial"><option value="">— SIN ID —</option><option value="__new">Escribir número de empleado…</option>${alts ? `<optgroup label="Más parecidos">${alts}</optgroup>` : ''}<optgroup label="Todos">${rosterOpts}</optgroup></select>`;
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
      <td class="idc mono">${esc(r.id || 'SIN ID')}${r.id && unusual.has(r.id) ? ' (revisar)' : ''}</td>
      ${days.map(d => `<td class="d${(r.uncertain.includes(d) || r.disputed.includes(d)) ? (r.reviewed.days.includes(d) ? ' rv' : ' unc') : ''}"><input type="checkbox" data-k="${r.key}" data-d="${esc(d)}" ${r.marks[d] ? 'checked' : ''} aria-label="${esc(d)}"></td>`).join('')}
      <td class="note">${esc(r.note || '')}</td>
      <td><button class="x" data-del="${r.key}" title="Quitar renglón" aria-label="Quitar renglón">×</button></td></tr>`).join('') + '</tbody>';
  vis.forEach(r => { const s = document.querySelector(`select[data-k="${r.key}"]`); if (s) s.value = r.id || ''; });
  const all = rows.filter(r => !r.deleted);
  const meals = all.reduce((s, r) => s + Object.values(r.marks).filter(Boolean).length, 0);
  $('#countTxt').textContent = `${all.length} renglones · ${meals} marcas en total (antes de quitar duplicados)`;
  refreshConf();
}
$('#grid').addEventListener('change', e => {
  const t = e.target, r = rows.find(x => x.key === +t.dataset.k); if (!r) return;
  if (t.matches('input[type=checkbox]')) { r.marks[t.dataset.d] = t.checked; if (!r.reviewed.days.includes(t.dataset.d)) r.reviewed.days.push(t.dataset.d); genArmed = false; renderGrid(); }
  else if (t.matches('select') && t.value === '__new') {
    const id = (prompt(`Número de empleado de "${r.nameAsWritten || 'esta persona'}":`, '') || '').replace(/\D/g, '');
    if (!id) { t.value = r.id || ''; return; }
    if (id.length < 3) { toast('Ese número es muy corto.'); t.value = r.id || ''; return; }
    if (!byId[id]) {
      const tecnico = confirm('¿Es TÉCNICO? Acepta = Técnico · Cancelar = Operador general');
      const p = { id, name: (r.nameAsWritten || '').toUpperCase().trim() || id, type: tecnico ? 'TECNICO' : 'OPERADOR GENERAL' };
      typedPeople[id] = p; byId[id] = p;
      rosterOpts = `<option value="${esc(id)}">${esc(p.name)} · ${esc(id)} (nuevo)</option>` + rosterOpts;
    }
    r.id = id; r.matchKind = 'manual'; r.reviewed.name = true; r.reviewed.id = true; genArmed = false; renderGrid();
  }
  else if (t.matches('select')) { r.id = t.value || null; r.matchKind = r.id ? (r.id === r.origId && r.matchKind !== 'manual' ? r.matchKind : 'manual') : null; r.reviewed.name = true; r.reviewed.id = true; genArmed = false; renderGrid(); }
  else if (t.matches('input.nm')) r.nameAsWritten = t.value;
});
$('#grid').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; const r = rows.find(x => x.key === +b.dataset.del); if (r) { r.deleted = true; renderGrid(); } });
$('#addRow').addEventListener('click', () => {
  const k = rows.length ? Math.max(...rows.map(r => r.key)) + 1 : 0;
  rows.push({ key: k, source: `Foto ${curPhoto}`, photo: curPhoto, row: null, nameAsWritten: '', marks: {}, uncertain: [], disputed: [], note: 'Agregado en la revisión', id: null, matchKind: 'manual', alternatives: [], reviewed: { days: [], name: false, id: false } });
  renderGrid(); const inp = document.querySelector(`input.nm[data-k="${k}"]`); if (inp) inp.focus();
});

$('#todoOnly').addEventListener('change', refreshConf);
$('#nextPt').addEventListener('click', () => { const b = document.querySelector('#todo [data-go]'); if (b) { $('#todoOnly').checked = false; b.click(); } });
$('#todo').addEventListener('click', e => {
  const ok = e.target.closest('[data-ok]'), go = e.target.closest('[data-go]');
  if (ok) {
    const r = rows.find(x => x.key === +ok.dataset.ok); if (!r) return;
    if (ok.dataset.kind === 'cell') { if (!r.reviewed.days.includes(ok.dataset.day)) r.reviewed.days.push(ok.dataset.day); }
    else if (ok.dataset.kind === 'name') r.reviewed.name = true; else r.reviewed.id = true;
    genArmed = false; renderGrid();
  } else if (go) {
    const r = rows.find(x => x.key === +go.dataset.go); if (!r) return;
    if (r.photo && r.photo !== curPhoto) showPhoto(r.photo);
    const tr = document.querySelector(`#grid tr[data-k="${r.key}"]`);
    if (tr) {
      tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const cell = go.dataset.day ? tr.querySelector(`input[data-d="${CSS.escape(go.dataset.day)}"]`) : tr.querySelector('select');
      tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash');
      if (cell) cell.focus({ preventScroll: true });
    }
  }
});

/* ---------- 4. generate ---------- */
$('#genBtn').addEventListener('click', async () => {
  showErr('#genErr');
  const pending = current().items.length;
  if (pending && !genArmed) { genArmed = true; showErr('#genErr', `${pending === 1 ? 'Queda 1 punto' : `Quedan ${pending} puntos`} sin revisar. Presiona de nuevo para generar así (quedan anotados en el resumen), o usa “Ir al siguiente punto”.`); return; }
  genArmed = false;
  const newPeople = Object.values(typedPeople).filter(p => rows.some(r => !r.deleted && r.id === p.id));
  const payload = rows.filter(r => !r.deleted).map(r => ({ source: r.source, photo: r.photo, row: r.row, nameAsWritten: r.nameAsWritten, id: r.id, marks: r.marks, uncertain: r.uncertain, disputed: r.disputed, reviewed: r.reviewed, note: r.note, matchKind: r.matchKind, matchScore: r.matchScore }));
  const b = $('#genBtn'); b.disabled = true; b.textContent = 'Generando…';
  try { const out = await api('POST', `/api/meals/runs/${run.id}/generate`, { rows: payload, newPeople }); showResult(out); loadHistory(); loadRoster(); }
  catch (e) { showErr('#genErr', e.message); }
  finally { b.disabled = false; refreshConf(); }
});
function showResult(out) {
  $('#s4').hidden = false; step(3);
  const t = out.totals;
  $('#result').innerHTML = `<div class="res">
    <div class="dl"><a class="btn primary" href="/api/meals/runs/${run.id}/file/delphi">Descargar DELPHI actualizado</a><a class="btn" href="/api/meals/runs/${run.id}/file/summary">Descargar resumen</a></div>
    <div class="confbox ${confClass(out.confidence.final)}"><div class="big">${out.confidence.final}%</div><div><b>Confianza al generar</b><br><span class="muted small">Lectura de la IA: ${out.confidence.read}% · después de tu revisión: ${out.confidence.final}%</span></div><div class="pend ${out.confidence.pending ? 'lo' : 'hi'}">${out.confidence.pending ? `${out.confidence.pending} sin revisar` : 'Todo revisado'}</div></div>
    <p><b>${t.added}</b> comidas agregadas a DELPHI · <b>${t.sinId}</b> sin ID · <b>${t.employees}</b> empleados comieron · <b>${t.noRegAdded}</b> de NO REGISTRADOS</p>
    <table><thead><tr><th>Día</th><th>DELPHI original</th><th>Agregadas</th><th>Actualizado</th></tr></thead><tbody>
    ${t.days.map(d => `<tr><td>${esc(d.day)}</td><td>${d.original}</td><td>${d.added}</td><td>${d.updated}</td></tr>`).join('')}
    <tr class="t"><td>SERVICIOS NETO</td><td>${t.netoOriginal}</td><td>${t.neto - t.netoOriginal}</td><td>${t.neto}</td></tr></tbody></table>
    ${out.flags.length ? `<h3>Puntos a revisar</h3><div class="flags">${out.flags.map(f => `<div class="flag">${esc(f)}</div>`).join('')}</div>` : ''}</div>`;
  $('#s4').scrollIntoView({ behavior: 'smooth' });
}

/* ---------- history ---------- */
function rosterUpdHTML(u, size) {
  if (!u) return `<div class="rupd">No subiste lista nueva: se usan los <b>${size}</b> números guardados. Si alguien no aparece, en la revisión elige <b>Escribir número de empleado…</b>.</div>`;
  const parts = [`<b>Lista ${esc(u.file || '')}</b>: ${u.added.length} persona${u.added.length === 1 ? '' : 's'} nueva${u.added.length === 1 ? '' : 's'} · ${u.changed.length} dato${u.changed.length === 1 ? '' : 's'} cambiado${u.changed.length === 1 ? '' : 's'} · ${u.unchanged} sin cambios`];
  if (u.added.length) parts.push(`<details><summary>Nuevos (${u.added.length})</summary><ul>${u.added.map(p => `<li><span class="mono">${esc(p.id)}</span> ${esc(p.name)}${p.type ? ' · ' + esc(p.type) : ''}</li>`).join('')}</ul></details>`);
  if (u.changed.length) parts.push(`<details open><summary>Cambios (${u.changed.length})</summary><ul>${u.changed.map(c => `<li><span class="mono">${esc(c.id)}</span> ${esc(c.field)}: <s>${esc(c.old)}</s> → <b>${esc(c.new)}</b></li>`).join('')}</ul></details>`);
  if (u.otherId.length) parts.push(`<details open><summary class="warn">Mismo nombre con otro número (${u.otherId.length})</summary><ul>${u.otherId.map(c => `<li>${esc(c.name)}: nuevo <span class="mono">${esc(c.id)}</span>, ya estaba como <span class="mono">${c.otherIds.map(esc).join(', ')}</span> — confirma cuál es el correcto</li>`).join('')}</ul></details>`);
  return `<div class="rupd">${parts.join('')}</div>`;
}
let rosterData = null;
async function loadRoster() {
  try { rosterData = await api('GET', '/api/meals/roster'); } catch (e) { $('#rosterMeta').textContent = e.message; return; }
  $('#rosterMeta').textContent = `${rosterData.count} guardados${rosterData.updatedAt ? ' · actualizado ' + new Date(rosterData.updatedAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : ''}`;
  window.__savedNums = rosterData.count; renderFiles();
  $('#rosterUploads').innerHTML = rosterData.uploads.length ? `<ul class="rlog">${rosterData.uploads.slice(0, 6).map(u => `<li><b>${esc(new Date(u.at).toLocaleDateString('es-MX', { dateStyle: 'medium' }))}</b> · ${esc(u.file || u.source)} · ${u.added} nuevos · ${u.changed} cambios${u.otherId ? ` · <span class="warn">${u.otherId} con otro número</span>` : ''}${u.by ? ' · ' + esc(u.by) : ''}</li>`).join('')}</ul>` : '';
  renderRosterTab();
}
function renderRosterTab() {
  if (!rosterData) return;
  const q = ($('#rosterQ').value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const list = rosterData.people.filter(p => !q || p.id.includes(q) || p.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().includes(q));
  $('#rosterCount').textContent = q ? `${list.length} de ${rosterData.count}` : '';
  const fdt = s => s ? new Date(s).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  $('#rosterTab').innerHTML = `<thead><tr><th>Número</th><th>Nombre</th><th>Tipo</th><th>Desde</th><th>Último cambio</th></tr></thead><tbody>${list.slice(0, 300).map(p => {
    const c = p.changes[p.changes.length - 1];
    return `<tr><td class="mono">${esc(p.id)}</td><td>${esc(p.name)}${p.source === 'captura manual' ? ' <span class="opt">a mano</span>' : ''}</td><td>${esc(p.type || '')}</td><td>${fdt(p.firstSeen)}</td><td class="small">${c ? `${esc(c.field)}: <s>${esc(c.old)}</s> → ${esc(c.new)} (${fdt(c.at)})` : ''}</td></tr>`;
  }).join('')}${list.length > 300 ? `<tr><td colspan="5" class="muted">… ${list.length - 300} más; busca para encontrarlos.</td></tr>` : ''}</tbody>`;
}
$('#rosterQ').addEventListener('input', renderRosterTab);

async function loadHistory() {
  try {
    const h = await api('GET', '/api/meals/history');
    $('#hist').innerHTML = h.length ? `<table class="hist"><thead><tr><th>Semana</th><th>Generado</th><th>Por</th><th>Agregadas</th><th>Sin ID</th><th>Empleados</th><th>Neto</th><th>Confianza</th><th></th></tr></thead><tbody>${h.map(x => `<tr><td>${esc(x.label)}</td><td>${new Date(x.at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${esc(x.by)}</td><td>${x.added}</td><td>${x.sinId}</td><td>${x.employees}</td><td>${x.neto}</td><td>${x.confFinal != null ? `${x.confRead}% → <b>${x.confFinal}%</b>${x.pending ? ` · ${x.pending} sin revisar` : ''}` : '—'}</td><td><a href="/api/meals/runs/${esc(x.id)}/file/delphi">DELPHI</a> · <a href="/api/meals/runs/${esc(x.id)}/file/summary">Resumen</a> · <button class="x" data-delrun="${esc(x.id)}" title="Eliminar conciliación" aria-label="Eliminar conciliación">Eliminar</button></td></tr>`).join('')}</tbody></table>` : 'Todavía no hay conciliaciones.';
  } catch (e) { $('#hist').textContent = e.message; }
}

$('#hist').addEventListener('click', async e => {
  const b = e.target.closest('[data-delrun]'); if (!b) return;
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = '¿Seguro? Clic otra vez'; return; }
  try { await api('DELETE', `/api/meals/runs/${b.dataset.delrun}`); toast('Conciliación eliminada.'); if (run && run.id === b.dataset.delrun) { history.replaceState(null, '', location.pathname); location.reload(); } else loadHistory(); }
  catch (err) { toast(err.message); }
});

(async () => {
  try { const c = await api('GET', '/api/meals/config'); $('#keyWarn').hidden = c.hasKey; } catch (e) {}
  loadHistory(); loadRoster();
  const id = location.hash.slice(1);
  if (/^[a-f0-9]{16}$/.test(id)) {
    try { run = await api('GET', `/api/meals/runs/${id}`); showRun(); if (run.status === 'reading') poll(); else if (run.status === 'read' || run.status === 'generated') { $('#readBtn').textContent = 'Volver a leer fotos'; buildReview(); } else if (run.status === 'uploaded') $('#readBtn').hidden = false; }
    catch (e) { history.replaceState(null, '', location.pathname); }
  }
})();
})();

'use strict';
/* Asistente asistencia: checador upload, printable sheet per week, and the photo-vs-checador review. */
(() => {
  const $ = s => document.querySelector(s);
  const F = (u, o) => (window.aveFetch || fetch)(u, o);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
    return el;
  }
  async function api(url, opt) {
    const r = await F(url, opt);
    if (r.status === 401) { location.href = '/login'; throw new Error('Sesión expirada.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DL = { lun: 'Lun', mar: 'Mar', mie: 'Mié', jue: 'Jue', vie: 'Vie', sab: 'Sáb', dom: 'Dom' };
  const add = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const monday = ymd => { const d = new Date(ymd + 'T12:00:00Z'); return add(ymd, -((d.getUTCDay() + 6) % 7)); };
  const dm = ymd => `${ymd.slice(8)}/${ymd.slice(5, 7)}`;
  const weekTxt = mon => { const e = add(mon, 6); return `${+mon.slice(8)} ${MES[+mon.slice(5, 7) - 1]} – ${+e.slice(8)} ${MES[+e.slice(5, 7) - 1]} ${e.slice(0, 4)}`; };
  const when = iso => iso ? new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Ciudad_Juarez' }) : '';
  const num = n => (Math.round((n || 0) * 10) / 10).toLocaleString('es-MX');
  let S = null;
  let PLANT = (() => { try { return localStorage.getItem('asisPlant') || 'monclova'; } catch (e) { return 'monclova'; } })();
  const q = (u, extra) => `${u}?planta=${encodeURIComponent(PLANT)}${extra ? '&' + extra : ''}`;
  const isExcel = () => S && S.plant.source === 'excel';

  /* ---------- home ---------- */
  async function loadState() {
    S = await api(q('/api/asis/state'));
    if (S.plant.id !== PLANT) PLANT = S.plant.id;
    $('#plantTabs').replaceChildren(...S.plants.map(p => h('button', { type: 'button', role: 'tab', 'aria-selected': String(p.id === PLANT), onclick: () => {
      if (p.id === PLANT) return; PLANT = p.id; try { localStorage.setItem('asisPlant', PLANT); } catch (e) {}
      $('#revWeek').value = ''; $('#chkMsg').replaceChildren(); $('#incMsg').replaceChildren(); files = []; thumbs(); loadState().catch(e => alert(e.message));
    } }, p.name)));
    $('#eyebrow').textContent = `Grupo AVE · ${S.plant.name}`;
    $('#keyWarn').hidden = S.hasKey || isExcel();
    $('#pPrint').hidden = isExcel(); $('#pInc').hidden = !isExcel();
    $('#drop').hidden = isExcel(); $('#thumbs').hidden = isExcel();
    $('#revHelp').textContent = isExcel() ? 'Elige la semana. Se compara lo que dicen las incidencias contra el checador de esa misma semana.' : 'Toma una foto por hoja, de frente y con las cuatro esquinas negras visibles. Antes, carga el checador de esa misma semana.';
    $('#readBtn').textContent = isExcel() ? 'Comparar' : 'Leer y comparar';
    if (isExcel()) {
      $('#incState').replaceChildren(...(S.incidencias.length ? S.incidencias.slice(0, 6).map(w => h('div', {}, h('span', {}, `${weekTxt(w.monday)} (${w.sheet})`), h('b', {}, `${w.rows} personas`))) : [h('div', {}, h('span', { class: 'muted' }, 'Sin incidencias cargadas'))]));
    }
    const r = S.roster;
    $('#chkState').replaceChildren(...[
      h('div', {}, h('span', {}, 'Personas en la lista'), h('b', {}, r.count || 0)),
      ...Object.entries(r.turnos).sort().map(([t, n]) => h('div', {}, h('span', { class: 'muted' }, t), h('b', {}, n))),
      h('div', {}, h('span', {}, 'Último checador'), h('b', {}, r.week ? `semana ${weekTxt(r.week)}` : 'sin cargar')),
      r.merged.length ? h('div', {}, h('span', {}, 'IDs combinados (misma persona)'), h('b', {}, r.merged.map(m => m.ids.join(' = ')).join(', '))) : null].filter(Boolean));
    $('#subtitle').textContent = isExcel() ? 'Compara las incidencias que manda la planta contra el checador. Si no coinciden, gana el checador.' : 'Imprime la lista de cada semana y compárala contra el checador. Si la hoja y el checador no coinciden, gana el checador.';
    $('#limits').textContent = '';
    if (!$('#printWeek').value) $('#printWeek').value = S.nextMonday;
    if (!$('#revWeek').value) { const both = S.weeks.find(w => !isExcel() || w.incidencias); $('#revWeek').value = (both && both.monday) || (S.weeks[0] && S.weeks[0].monday) || S.thisMonday; }
    printLinks(); revLabel(); history(); settingsUI();
  }
  function printLinks() {
    const v = $('#printWeek').value; if (!v) return;
    const mon = monday(v);
    $('#printLabel').textContent = `Lun ${dm(mon)} a Sáb ${dm(add(mon, 5))}`;
    $('#printDl').href = q('/api/asis/lista.pdf', `semana=${mon}`);
    $('#printView').href = q('/api/asis/lista.pdf', `semana=${mon}&ver=1`);
    const n = S && S.roster.count;
    $('#printNote').textContent = n ? `${n} personas, una hoja por turno. Al imprimir, usa tamaño carta horizontal al 100%.` : 'Primero carga el checador para tener la lista del personal.';
    $('#printDl').toggleAttribute('aria-disabled', !n);
  }
  function revLabel() {
    const v = $('#revWeek').value; if (!v) return;
    const mon = monday(v), w = S && S.weeks.find(x => x.monday === mon), inc = S && S.incidencias.find(x => x.monday === mon);
    $('#revLabel').replaceChildren(`Lun ${dm(mon)} a ${isExcel() ? 'Dom ' + dm(add(mon, 6)) : 'Sáb ' + dm(add(mon, 5))}`,
      h('div', { class: 'small ' + (w ? 'muted' : '') }, w ? `Checador cargado: ${w.file}` : h('span', { class: 'pill warn' }, 'Falta el checador de esta semana')),
      isExcel() ? h('div', { class: 'small ' + (inc ? 'muted' : '') }, inc ? `Incidencias: ${inc.sheet} (${inc.rows} personas)` : h('span', { class: 'pill warn' }, 'Faltan las incidencias de esta semana')) : null);
    if (isExcel()) $('#readBtn').disabled = !(w && inc);
  }
  $('#printWeek').addEventListener('change', printLinks);
  $('#revWeek').addEventListener('change', revLabel);
  $('#printDl').addEventListener('click', e => { if (!S || !S.roster.count) { e.preventDefault(); $('#printNote').textContent = 'Primero carga el checador.'; } });

  $('#chkFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const box = $('#chkMsg'); box.replaceChildren(h('div', { class: 'msg warn' }, 'Leyendo el Excel…'));
    const fd = new FormData(); fd.append('planta', PLANT); fd.append('file', f);
    try {
      const r = await api('/api/asis/checador', { method: 'POST', body: fd });
      const parts = [`Listo: ${r.people} personas, semana ${r.weeks.map(weekTxt).join(', ')}.`];
      if (r.merged.length) parts.push(`Combiné ${r.merged.map(m => `${m.ids.join(' y ')} (${m.name})`).join('; ')} como una sola persona.`);
      if (r.changes.added.length && r.changes.removed.length + r.changes.added.length < 30) parts.push(`Nuevos en la lista: ${r.changes.added.join(', ')}.`);
      if (r.changes.removed.length) parts.push(`Ya no aparecen: ${r.changes.removed.join(', ')}.`);
      if (!r.rosterUpdated) parts.push('Es una semana anterior: la lista para imprimir no cambió.');
      box.replaceChildren(h('div', { class: 'msg' }, parts.join(' ')));
      await loadState();
      if (r.weeks.length) { $('#revWeek').value = r.weeks[r.weeks.length - 1]; revLabel(); }
    } catch (err) { box.replaceChildren(h('div', { class: 'msg bad' }, err.message)); }
    e.target.value = '';
  });

  /* turnos y límites */
  function settingsUI() {
    const T = S.turnos;
    $('#setSum').textContent = T.length ? '· ' + T.map(t => `${t.turno.replace(/^(MVA|JY)\s+/, '')}: ${t.start || '?'}–${t.end || '?'}, ${t.limit} h`).join(' · ') : '· carga el checador para ver los turnos';
    $('#setTable').replaceChildren(h('thead', {}, h('tr', {}, ['Turno', 'Personas', 'Checador', 'Entrada', 'Salida', 'Límite semanal (h)'].map(x => h('th', {}, x)))),
      h('tbody', {}, T.map(t => h('tr', { 'data-t': t.turno }, h('td', {}, t.turno), h('td', { class: 'n' }, t.people), h('td', { class: 'muted' }, t.checador || '—'),
        h('td', {}, h('input', { class: 'st', value: t.start || '', placeholder: 'HH:MM', 'aria-label': `Entrada ${t.turno}` })),
        h('td', {}, h('input', { class: 'en', value: t.end || '', placeholder: 'HH:MM', 'aria-label': `Salida ${t.turno}` })),
        h('td', {}, h('input', { class: 'li', type: 'number', min: 20, max: 84, step: 0.5, value: t.limit, 'aria-label': `Límite ${t.turno}` }))))));
    $('#tolRow').hidden = !isExcel(); $('#tolMin').value = S.tolMin;
  }
  $('#setSave').addEventListener('click', async () => {
    const turnos = {};
    $('#setTable').querySelectorAll('tbody tr').forEach(tr => { turnos[tr.dataset.t] = { start: tr.querySelector('.st').value.trim(), end: tr.querySelector('.en').value.trim(), limit: tr.querySelector('.li').value }; });
    const m = $('#setMsg');
    try { const r = await api('/api/asis/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planta: PLANT, turnos, tolMin: isExcel() ? $('#tolMin').value : undefined }) }); S.turnos = r.turns || r.turnos; S.tolMin = r.tolMin; settingsUI(); m.textContent = 'Guardado. Las revisiones se recalculan al abrirlas.'; }
    catch (e) { m.textContent = e.message; }
  });

  /* incidencias */
  $('#incFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const box = $('#incMsg'); box.replaceChildren(h('div', { class: 'msg warn' }, 'Leyendo el Excel…'));
    const fd = new FormData(); fd.append('planta', PLANT); fd.append('file', f);
    try {
      const r = await api('/api/asis/incidencias', { method: 'POST', body: fd });
      const last = r.weeks[r.weeks.length - 1];
      box.replaceChildren(h('div', { class: 'msg' }, `Listo: ${r.weeks.length} semana(s), la más reciente ${weekTxt(last.monday)} (${last.sheet}, ${last.rows} personas).${last.checador ? '' : ' Falta el checador de esa semana.'}`));
      await loadState(); $('#revWeek').value = last.monday; revLabel();
    } catch (err) { box.replaceChildren(h('div', { class: 'msg bad' }, err.message)); }
    e.target.value = '';
  });

  /* photos */
  let files = [];
  function thumbs() {
    $('#thumbs').replaceChildren(...files.map((f, i) => {
      const img = h('img', { alt: f.name }); const fr = new FileReader(); fr.onload = () => { img.src = fr.result; }; fr.readAsDataURL(f);
      return h('figure', {}, img, h('button', { type: 'button', 'aria-label': 'Quitar ' + f.name, onclick: () => { files.splice(i, 1); thumbs(); } }, '×'));
    }));
    $('#dropTxt').textContent = files.length ? `${files.length} foto${files.length > 1 ? 's' : ''} lista${files.length > 1 ? 's' : ''}. Puedes agregar más.` : 'Arrastra aquí las fotos de la lista o haz clic para elegirlas';
    $('#readBtn').disabled = isExcel() ? $('#readBtn').disabled : !files.length;
  }
  $('#photos').addEventListener('change', e => { files.push(...[...e.target.files].filter(f => /^image\//.test(f.type))); e.target.value = ''; thumbs(); });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', e => { e.preventDefault(); files.push(...[...e.dataTransfer.files].filter(f => /^image\//.test(f.type))); thumbs(); });
  $('#readBtn').addEventListener('click', async () => {
    const err = $('#revErr'); err.hidden = true;
    const fd = new FormData(); fd.append('planta', PLANT); fd.append('semana', monday($('#revWeek').value)); if (!isExcel()) files.forEach(f => fd.append('photos', f));
    const label = $('#readBtn').textContent;
    $('#readBtn').disabled = true; $('#readBtn').textContent = isExcel() ? 'Comparando…' : 'Subiendo…';
    try { const r = await api('/api/asis/runs', { method: 'POST', body: fd }); files = []; thumbs(); location.hash = 'r=' + r.id; }
    catch (e) { err.textContent = e.message; err.hidden = false; }
    $('#readBtn').textContent = label; $('#readBtn').disabled = isExcel() ? false : !files.length;
  });

  function history() {
    const runs = S.runs;
    if (!runs.length) { $('#hist').replaceChildren(h('p', { class: 'muted small' }, 'Aún no hay revisiones.')); return; }
    $('#hist').replaceChildren(h('table', { class: 'hist' },
      h('thead', {}, h('tr', {}, ['Semana', 'Subida', 'Por', isExcel() ? 'Origen' : 'Fotos', 'Por revisar', 'TE checador', isExcel() ? 'TE incidencias' : 'TE hoja'].map(t => h('th', {}, t)))),
      h('tbody', {}, runs.map(r => h('tr', { class: 'go', tabindex: 0, onclick: () => { location.hash = 'r=' + r.id; }, onkeydown: e => { if (e.key === 'Enter') location.hash = 'r=' + r.id; } },
        h('td', {}, weekTxt(r.monday)), h('td', {}, when(r.createdAt)), h('td', {}, r.by || ''), h('td', { class: 'n' }, r.source === 'excel' ? 'Excel' : r.photos),
        h('td', { class: 'n' }, r.status !== 'read' ? h('span', { class: 'pill warn' }, 'leyendo') : r.summary ? h('span', { class: 'pill ' + (r.summary.bad ? 'bad' : 'ok') }, r.summary.bad) : '—'),
        h('td', { class: 'n' }, r.summary ? num(r.summary.teChk) + ' h' : '—'), h('td', { class: 'n' }, r.summary ? num(r.summary.teSheet) + ' h' : '—'))))));
  }

  /* ---------- run view ---------- */
  let RUN = null, poll = null, filter = 'todo', open = new Set();
  function showHome() { $('#run').hidden = true; $('#home').hidden = false; $('#histP').hidden = false; $('#setP').hidden = false; $('#plantTabs').hidden = false; clearTimeout(poll); RUN = null; loadState().catch(e => alert(e.message)); }
  async function showRun(id) {
    $('#home').hidden = true; $('#histP').hidden = true; $('#setP').hidden = true; $('#plantTabs').hidden = true; $('#run').hidden = false;
    try { RUN = await api('/api/asis/runs/' + id); } catch (e) { $('#runFlags').replaceChildren(h('div', { class: 'msg bad' }, e.message)); return; }
    renderRun();
    clearTimeout(poll);
    if (RUN.status !== 'read') poll = setTimeout(() => { if (location.hash === '#r=' + id) showRun(id); }, 3000);
  }
  function renderRun() {
    const r = RUN, an = r.analysis;
    $('#runTitle').textContent = `${r.plantName} · Semana ${weekTxt(r.monday)}`;
    $('#photosBox').hidden = r.source === 'excel';
    $('#legendTxt').textContent = r.source === 'excel' ? 'Arriba: checador · Abajo: lo que dice incidencias. Haz clic en una celda para corregirla.' : 'Arriba: checador · Abajo: lo que dice la hoja. Haz clic en una celda para corregir la lectura.';
    $('#legUnc').hidden = r.source === 'excel';
    $('#xlsBtn').href = `/api/asis/runs/${r.id}/excel`;
    $('#xlsBtn').hidden = !(an && an.results);
    const reading = r.status !== 'read';
    $('#prog').hidden = !reading;
    if (reading) { const rd = r.reading || { done: 0, total: r.photos.length }; $('#progBar').style.width = (rd.done / Math.max(1, rd.total) * 100) + '%'; $('#progTxt').textContent = `Leyendo ${rd.done} de ${rd.total} foto(s)… (cada foto se lee dos veces; tarda 1–2 minutos)`; }
    const fl = [];
    for (const p of r.photos) {
      if (p.error) fl.push(h('div', { class: 'msg bad' }, `Foto ${p.n}: ${p.error}`));
      if (p.warning) fl.push(h('div', { class: 'msg warn' }, `Foto ${p.n}: ${p.warning}`));
      if (p.codeDiffers) fl.push(h('div', { class: 'msg warn' }, `Foto ${p.n}: las dos lecturas no coinciden en el código de hoja.`));
      if (r.status === 'read' && p.manager_signed === false) fl.push(h('div', { class: 'msg warn' }, `Foto ${p.n} (${p.sheet_code || 'sin código'}): falta la firma del gerente.`));
    }
    if (r.status === 'read' && r.photos.some(p => p.error)) fl.push(h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: async e => { e.currentTarget.disabled = true; try { await api(`/api/asis/runs/${r.id}/reread`, { method: 'POST' }); showRun(r.id); } catch (err) { alert(err.message); } } }, 'Volver a leer las fotos')));
    if (an && an.nothingRead) fl.push(h('div', { class: 'msg bad' }, 'No se pudo leer ninguna foto, así que todavía no hay comparación.'));
    if (an && an.missingWeek) fl.push(h('div', { class: 'msg bad' }, 'Falta el Excel del checador de esta semana. Súbelo en la pantalla principal y vuelve a abrir esta revisión.'));
    if (an && an.wrongWeek && an.wrongWeek.length) fl.push(h('div', { class: 'msg bad' }, `La hoja ${an.wrongWeek.join(', ')} es de otra semana.`));
    $('#runFlags').replaceChildren(...fl);
    // photos
    $('#photoTabs').replaceChildren(...r.photos.map((p, i) => h('button', { type: 'button', 'aria-pressed': String(i === 0), onclick: e => { $('#photoTabs').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); setPhoto(p.n); } }, `Foto ${p.n}${p.sheet_code ? ' · ' + p.sheet_code : ''}`)));
    if (r.photos.length) setPhoto(r.photos[0].n);
    if (!an || !an.results) { $('#mets').replaceChildren(); $('#filters').replaceChildren(); $('#grid').replaceChildren(); $('#extras').replaceChildren(); return; }
    const s = an.summary, X = r.source === 'excel', L = X ? 'incidencias' : 'la hoja';
    if (an.notices && an.notices.length) $('#runFlags').append(...an.notices.map(n => h('div', { class: 'msg warn' }, n.msg)));
    if (X && r.incid) $('#runFlags').append(h('div', { class: 'muted small' }, `Incidencias: ${r.incid.file} · hoja ${r.incid.sheet}${r.incid.title ? ' · ' + r.incid.title : ''}`));
    $('#mets').replaceChildren(
      h('div', { class: 'met' }, h('b', {}, s.people), h('span', {}, X ? 'Personas en el checador' : `Personas (${an.turnosRead.join(', ') || 'sin turno'})`)),
      h('div', { class: 'met ' + (s.bad ? 'bad' : 'ok') }, h('b', {}, s.bad), h('span', {}, 'Por revisar')),
      h('div', { class: 'met ' + (s.warn ? 'warn' : '') }, h('b', {}, s.warn), h('span', {}, 'Con avisos')),
      h('div', { class: 'met' }, h('b', {}, num(s.teChk) + ' h'), h('span', {}, 'TE según checador')),
      h('div', { class: 'met ' + (s.teSheet > s.teChk + 0.5 ? 'bad' : '') }, h('b', {}, num(s.teSheet) + ' h'), h('span', {}, `TE anotado en ${L}`)),
      h('div', { class: 'met ' + (s.FI ? 'bad' : '') }, h('b', {}, s.FI), h('span', {}, 'Faltas (FI)')),
      h('div', { class: 'met' }, h('b', {}, s.INC), h('span', {}, 'Días de incapacidad')),
      X ? h('div', { class: 'met ' + (s.RET ? 'warn' : '') }, h('b', {}, s.RET || 0), h('span', {}, 'Retardos / salidas antes (checador)')) : null);
    const counts = { todo: an.results.length, bad: an.results.filter(x => x.lvl === 'bad').length, warn: an.results.filter(x => x.lvl === 'warn').length, ok: an.results.filter(x => x.lvl === 'ok').length };
    $('#filters').replaceChildren(...[['todo', 'Todos'], ['bad', 'Revisar'], ['warn', 'Atención'], ['ok', 'Sin diferencias']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; renderRun(); } }, `${t} (${counts[k]})`)));
    grid();
    $('#extras').replaceChildren(...(an.extras.length ? [h('h3', {}, `${X ? 'Personas en incidencias' : 'Renglones de la hoja'} que no están en el checador (${an.extras.length})`), h('ul', {}, an.extras.map(x => h('li', {}, `${X ? '' : x.sheet + ': '}${x.id || 'sin número'} ${x.name}${x.why === 'duplicado' ? ' (repetido)' : ''}${x.codes && x.codes.length ? ' · ' + [...new Set(x.codes)].join(', ') : ''}`)))] : []));
  }
  function setPhoto(n) { const img = $('#photo'); img.src = `/api/asis/runs/${RUN.id}/photo/${n}`; img.style.width = $('#zoom').value + '%'; }
  $('#zoom').addEventListener('input', e => { $('#photo').style.width = e.target.value + '%'; });

  function cellFor(p, d) {
    const c = d.clock, sh = d.sheet;
    let k;
    if (c.status === 'trabajo' || c.status === 'descanso-trabajado') k = h('span', { class: 'k' }, `${c.in}–${c.out}`, h('br'), `${num(c.hours)} h${c.extra ? ` · +${num(c.extra)}` : ''}`);
    else if (c.status === 'incompleto') k = h('span', { class: 'k' }, h('b', {}, 'Incompleto'), h('br'), [c.in, c.out].filter(Boolean).join('–') || '');
    else if (c.status === 'falta') k = h('span', { class: 'k' }, h('b', {}, d.final === 'FI' ? 'Falta (FI)' : `Falta · ${d.final}`));
    else if (c.status === 'descanso') k = h('span', { class: 'k' }, 'Descanso');
    else k = h('span', { class: 'k muted' }, '—');
    const onSheet = (RUN.sheetDays || []).includes(d.key);
    const s = !onSheet ? null : !sh ? h('span', { class: 's none' }, RUN.source === 'excel' ? 'sin renglón' : 'sin hoja') : h('span', { class: 's' + (sh.clave || sh.te ? '' : ' none') }, [sh.clave, sh.te ? `TE ${num(sh.te)}` : ''].filter(Boolean).join(' · ') || 'vacío');
    const lv = d.flags.includes('bad') ? 'bad' : d.flags.includes('warn') ? 'warn' : '';
    const editable = !!(sh && p.sheetRow && onSheet);
    const tol = RUN.tolMin ?? 10;
    if (k && (c.late > tol || c.early > tol) && RUN.source === 'excel') k.append(h('br'), [c.late > tol ? `+${c.late} min entrada` : '', c.early > tol ? `-${c.early} min salida` : ''].filter(Boolean).join(' · '));
    const td = h('td', { class: `c ${lv} ${sh && sh.uncertain ? 'unc' : ''} ${c.status === 'descanso' ? 'rest' : ''} f-${d.final} ${editable ? '' : 'nos'}`, title: p.flags.filter(f => f.day === d.key).map(f => f.msg).join('\n') || null }, k, s);
    if (editable) td.addEventListener('click', e => { e.stopPropagation(); editCell(p, d); });
    return td;
  }
  function grid() {
    const an = RUN.analysis, dates = RUN.dates;
    const rows = an.results.filter(x => filter === 'todo' || x.lvl === filter);
    const head = h('tr', {}, h('th', {}, 'ID'), h('th', {}, 'Nombre'), dates.map(d => h('th', {}, `${DL[d.key]} ${dm(d.ymd)}`)), h('th', {}, 'Horas'), h('th', {}, 'TE chk'), h('th', {}, RUN.source === 'excel' ? 'TE inc.' : 'TE hoja'), h('th', {}, 'Estado'));
    const body = []; let lastT = null;
    for (const p of rows) {
      if (p.turno !== lastT) { lastT = p.turno; body.push(h('tr', { class: 'grp' }, h('td', { colspan: dates.length + 6 }, `${p.turno}${p.shift && p.shift.start ? ` · ${p.shift.start}–${p.shift.end}` : ''} · tiempo extra después de ${p.limit} h`))); }
      const t = p.totals, isOpen = open.has(p.id);
      const tr = h('tr', { class: 'prow', onclick: () => { isOpen ? open.delete(p.id) : open.add(p.id); grid(); } },
        h('td', { class: 'id' }, p.id, p.ids.length > 1 ? h('small', { class: 'muted' }, ` (${p.ids.filter(x => x !== p.id).join(', ')})`) : ''),
        h('td', { class: 'nm' }, p.name, p.sheetRow && p.sheetRow.how !== 'id' ? h('small', {}, `${RUN.source === 'excel' ? 'Incidencias' : 'Hoja'}: ${p.sheetRow.id || 's/n'} ${p.sheetRow.name}`) : null),
        p.days.map(d => cellFor(p, d)),
        h('td', { class: 'n' }, num(t.hours)), h('td', { class: 'n' }, num(t.teChk)), h('td', { class: 'n' + (t.teSheet > t.teChk + 0.5 ? ' hi' : '') }, num(t.teSheet)),
        h('td', {}, h('span', { class: 'pill ' + p.lvl }, { bad: 'Revisar', warn: 'Atención', ok: 'OK' }[p.lvl])));
      body.push(tr);
      const fl = p.flags.filter(f => f.lvl !== 'info' || isOpen);
      if (isOpen || (p.lvl === 'bad' && fl.length)) body.push(h('tr', { class: 'more' }, h('td', { colspan: dates.length + 6 }, h('ul', {}, fl.map(f => h('li', { class: f.lvl }, (f.day ? `${DL[f.day]} ${dm(f.ymd)}: ` : '') + f.msg))), p.sheetRow && p.sheetRow.note ? h('div', { class: 'muted small' }, (RUN.source === 'excel' ? 'Comentario en incidencias: ' : 'Nota de lectura: ') + p.sheetRow.note) : null)));
    }
    if (!rows.length) body.push(h('tr', {}, h('td', { colspan: dates.length + 6, class: 'muted' }, 'Nada en este filtro.')));
    $('#grid').replaceChildren(h('thead', {}, head), h('tbody', {}, body));
  }

  let editing = null;
  function editCell(p, d) {
    editing = { key: p.sheetRow.key, day: d.key };
    $('#cellTitle').textContent = `${p.id} ${p.name} · ${DL[d.key]} ${dm(d.ymd)}`;
    const c = d.clock;
    $('#cellClock').textContent = 'Checador: ' + ({ trabajo: `${c.in}–${c.out} (${num(c.hours)} h)`, 'descanso-trabajado': `descanso trabajado ${c.in}–${c.out} (${num(c.hours)} h)`, incompleto: `incompleto (${[c.in, c.out].filter(Boolean).join('–')})`, falta: 'sin registro', descanso: 'descanso' }[c.status] || '—') + (d.sheet.uncertain ? '. La lectura de la foto es dudosa: compárala con la foto.' : '');
    const X = RUN.source === 'excel';
    $('#cClaveL').textContent = X ? 'Incidencia' : 'Clave en la hoja';
    $('#cTeL').textContent = X ? 'TE en incidencias (horas)' : 'TE en la hoja (horas)';
    $('#cellHelp').textContent = X ? 'Corrige la incidencia si el Excel venía mal. El resultado lo sigue decidiendo el checador.' : 'Corrige solo lo que está escrito en el papel. El resultado lo sigue decidiendo el checador.';
    document.querySelectorAll('#cClave .xo').forEach(o => { o.hidden = !X; o.disabled = !X; });
    $('#cClave').value = [...$('#cClave').options].some(o => o.value === d.sheet.clave && !o.disabled) ? d.sheet.clave : '';
    $('#cTe').value = d.sheet.te || '';
    $('#cellDlg').showModal();
  }
  $('#cellDlg').addEventListener('close', async () => {
    if ($('#cellDlg').returnValue !== 'save' || !editing) return;
    try { RUN = await api(`/api/asis/runs/${RUN.id}/cell`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...editing, clave: $('#cClave').value, te: $('#cTe').value }) }); renderRun(); }
    catch (e) { alert(e.message); }
  });
  $('#back').addEventListener('click', () => { location.hash = ''; });
  $('#delRun').addEventListener('click', async e => {
    const b = e.currentTarget;
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Confirmar borrar'; setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Borrar'; }, 4000); return; }
    try { await api('/api/asis/runs/' + RUN.id, { method: 'DELETE' }); location.hash = ''; } catch (err) { alert(err.message); }
  });

  function route() { const m = /^#r=([a-f0-9]{16})$/.exec(location.hash); if (m) showRun(m[1]); else showHome(); }
  window.addEventListener('hashchange', () => { open = new Set(); filter = 'todo'; route(); });
  route();
})();

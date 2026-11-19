'use strict';
/* ASISTENTE ASISTENCIA (Monclova): upload the CHECADOR export, print the week's sheet, then read the
   photo of the filled sheet and compare it against the CHECADOR (which wins every disagreement). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const multer = require('multer');
const A = require('./asistencia-core');
const PDF = require('./asistencia-pdf');
const AI = require('./asistencia-ai');

module.exports = function (app, { DATA_DIR }) {
  const ROOT = path.join(DATA_DIR, 'asistencia');
  const WEEKS = path.join(ROOT, 'weeks'), PRINTS = path.join(ROOT, 'prints'), RUNS = path.join(ROOT, 'runs');
  for (const d of [WEEKS, PRINTS, RUNS]) fs.mkdirSync(d, { recursive: true });
  const ROSTER = path.join(ROOT, 'roster.json');
  const readJ = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
  const writeJ = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const RUN_ID = /^[a-f0-9]{16}$/;
  const who = req => (req.user && (req.user.name || req.user.username)) || 'admin';
  const roster = () => readJ(ROSTER, { people: {}, uploads: [], week: null });
  const week = mon => readJ(path.join(WEEKS, mon + '.json'), null);
  const prints = mon => readJ(path.join(PRINTS, mon + '.json'), null);
  const runDir = id => path.join(RUNS, id);
  const loadRun = id => RUN_ID.test(id) ? readJ(path.join(runDir(id), 'run.json'), null) : null;
  const saveRun = r => writeJ(path.join(runDir(r.id), 'run.json'), r);
  const todayCJ = () => new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  const nextMonday = () => A.addDays(A.mondayOf(todayCJ()), 7);
  const plantName = 'MONCLOVA';

  app.get('/asistencia', (req, res) => res.sendFile(path.join(__dirname, 'public', 'asistencia.html')));

  function listRuns() {
    return fs.readdirSync(RUNS).filter(x => RUN_ID.test(x)).map(loadRun).filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40)
      .map(r => ({ id: r.id, monday: r.monday, createdAt: r.createdAt, by: r.by, status: r.status, photos: (r.photos || []).length, summary: r.lastSummary || null }));
  }
  app.get('/api/asis/state', (req, res) => {
    const ro = roster();
    const people = Object.values(ro.people);
    const turnos = {}; for (const p of people) turnos[p.turno] = (turnos[p.turno] || 0) + 1;
    const runs = listRuns();
    const weeks = fs.readdirSync(WEEKS).filter(f => /\.json$/.test(f)).map(f => f.slice(0, 10)).sort().reverse().slice(0, 20).map(mon => {
      const w = week(mon); return { monday: mon, people: Object.keys(w.people).length, uploadedAt: w.uploadedAt, by: w.by, file: w.file, printed: fs.existsSync(path.join(PRINTS, mon + '.json')), runs: runs.filter(r => r.monday === mon).length };
    });
    res.json({ hasKey: AI.hasKey(), model: AI.MODEL(), plant: plantName, nextMonday: nextMonday(), thisMonday: A.mondayOf(todayCJ()),
      limits: A.LIMITS.map(l => { const sh = A.SHIFTS.find(x => x.label === l.label); return { turno: l.label, limit: l.limit, start: sh && sh.start, end: sh && sh.end }; }),
      roster: { count: people.length, turnos, week: ro.week, updatedAt: ro.updatedAt || null, merged: people.filter(p => (p.ids || []).length > 1).map(p => ({ name: p.name, ids: p.ids })) },
      uploads: (ro.uploads || []).slice(-5).reverse(), weeks, runs });
  });

  /* ---------- 1. CHECADOR upload ---------- */
  const xlsxUp = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } }).single('file');
  app.post('/api/asis/checador', (req, res) => xlsxUp(req, res, async err => {
    if (err || !req.file) return res.status(400).json({ error: 'No se pudo recibir el archivo.' });
    if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Sube el Excel (.xlsx) que genera el checador.' });
    const tmp = path.join(os.tmpdir(), 'chk-' + crypto.randomBytes(6).toString('hex') + '.xlsx');
    try {
      fs.writeFileSync(tmp, req.file.buffer);
      const { people } = await A.readChecador(tmp);
      const weeks = A.splitWeeks(people), at = new Date().toISOString();
      const mons = Object.keys(weeks).sort();
      for (const mon of mons) writeJ(path.join(WEEKS, mon + '.json'), { monday: mon, uploadedAt: at, by: who(req), file: req.file.originalname, people: weeks[mon] });
      const ro = roster(), latest = mons[mons.length - 1];
      const changes = { added: [], removed: [] };
      if (!ro.week || latest >= ro.week) {
        const nu = {};
        for (const p of Object.values(weeks[latest])) nu[p.id] = { id: p.id, ids: p.ids, name: p.name, turno: p.turno, horario: p.horario, rest: A.restPattern(p) };
        if (ro.week) changes.added = Object.keys(nu).filter(id => !ro.people[id]).map(id => nu[id].name);
        changes.removed = Object.keys(ro.people).filter(id => !nu[id]).map(id => ro.people[id].name);
        ro.people = nu; ro.week = latest; ro.updatedAt = at;
      }
      ro.uploads = [...(ro.uploads || []), { at, by: who(req), file: req.file.originalname, weeks: mons, people: people.length }].slice(-30);
      writeJ(ROSTER, ro);
      res.json({ ok: true, weeks: mons, people: people.length, merged: people.filter(p => p.ids.length > 1).map(p => ({ name: p.name, ids: p.ids })), rosterUpdated: ro.week === latest, changes });
    } catch (e) { res.status(400).json({ error: e.message }); }
    finally { fs.rmSync(tmp, { force: true }); }
  }));

  /* ---------- 2. Printable sheet ---------- */
  app.get('/api/asis/lista.pdf', (req, res) => {
    const mon = A.mondayOf(YMD.test(req.query.semana || '') ? req.query.semana : nextMonday());
    const ro = roster(), people = Object.values(ro.people);
    if (!people.length) return res.status(400).send('Primero sube el Excel del checador para tener la lista del personal.');
    const sheets = A.layoutSheets(people, mon, { plant: plantName });
    writeJ(path.join(PRINTS, mon + '.json'), { monday: mon, at: new Date().toISOString(), by: who(req), sheets });
    const end = A.addDays(mon, 6);
    const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const fname = `Lista_Asistencia_Monclova_${+mon.slice(8)}-${+end.slice(8)}_${MES[+end.slice(5, 7) - 1]}_${end.slice(0, 4)}.pdf`;
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `${req.query.ver ? 'inline' : 'attachment'}; filename="${fname}"`);
    PDF.sheetsPdf(res, sheets);
  });

  /* ---------- 3. Review: photos → read → compare ---------- */
  const reading = new Set();
  const photoUp = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => { const d = runDir(req.runId); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
      filename: (req, file, cb) => cb(null, `foto-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 30 * 1024 * 1024, files: 12 },
    fileFilter: (req, file, cb) => /\.(jpe?g|png|webp)$/i.test(file.originalname) ? cb(null, true) : cb(Object.assign(new Error(`"${file.originalname}" no es una foto (JPG o PNG).`), { status: 400 })),
  }).array('photos', 12);

  function sheetsFor(mon) {
    const p = prints(mon); if (p) return p.sheets;
    const people = Object.values(roster().people);
    return people.length ? A.layoutSheets(people, mon, { plant: plantName }) : [];
  }
  function startRead(run) {
    if (reading.has(run.id)) return;
    reading.add(run.id);
    const sheets = sheetsFor(run.monday);
    run.status = 'reading'; run.reading = { done: 0, total: run.photos.length, errors: [] }; saveRun(run);
    (async () => {
      await Promise.all(run.photos.map(async ph => {
        try {
          const r = await AI.readAttendancePhoto(path.join(runDir(run.id), ph.file), sheets);
          Object.assign(ph, { sheet_code: r.sheet_code, codeDiffers: !!r.codeDiffers, manager_signed: r.manager_signed, rows: r.rows, warning: r.warning || null, usage: r.usage, error: null });
        } catch (e) { ph.error = e.message; run.reading.errors.push(`Foto ${ph.n}: ${e.message}`); }
        run.reading.done++; saveRun(run);
      }));
      run.status = 'read'; run.readAt = new Date().toISOString(); saveRun(run);
    })().catch(e => { run.status = 'read'; run.reading.errors.push(e.message); saveRun(run); }).finally(() => reading.delete(run.id));
  }

  app.post('/api/asis/runs', (req, res, next) => { req.runId = crypto.randomBytes(8).toString('hex'); next(); }, (req, res) => photoUp(req, res, err => {
    const fail = (msg, code = 400) => { fs.rmSync(runDir(req.runId), { recursive: true, force: true }); res.status(code).json({ error: msg }); };
    if (err) return fail(err.message || 'No se pudieron recibir las fotos.');
    if (!req.files || !req.files.length) return fail('Agrega al menos una foto de la lista.');
    if (!AI.hasKey()) return fail('Falta la variable ANTHROPIC_API_KEY en Render.');
    const mon = YMD.test((req.body || {}).semana || '') ? A.mondayOf(req.body.semana) : null;
    if (!mon) return fail('Elige la semana de la lista.');
    const run = { id: req.runId, monday: mon, createdAt: new Date().toISOString(), by: who(req), status: 'uploaded', edits: {},
      photos: req.files.map((f, i) => ({ n: i + 1, file: f.filename, name: f.originalname })) };
    saveRun(run); startRead(run);
    res.status(202).json(publicRun(run));
  }));

  /* Flatten the photo reads into sheet rows, apply manual corrections, and compare. */
  function sheetRows(run) {
    const sheets = sheetsFor(run.monday), byCode = Object.fromEntries(sheets.map(s => [s.code.replace(/\s/g, ''), s]));
    const out = [];
    for (const ph of run.photos || []) (ph.rows || []).forEach((r, i) => {
      const key = `${ph.n}:${i}`, ed = (run.edits || {})[key] || {};
      const days = {}; for (const d of A.DAYS) days[d] = { ...r.days[d], ...(ed[d] || {}) };
      const sh = byCode[ph.sheet_code];
      out.push({ key, id: r.id, name: r.name, days, uncertain: r.uncertain.filter(d => !(ed[d] && ed[d].ok)), note: r.note, sheet: ph.sheet_code || `Foto ${ph.n}`, turno: sh ? sh.turno : null, photo: ph.n, handwritten: r.handwritten });
    });
    return out;
  }
  function analyse(run) {
    const w = week(run.monday);
    if (!w) return { missingWeek: true };
    const rows = sheetRows(run);
    if (!rows.length) return { nothingRead: true };
    const byId = {}; for (const p of Object.values(w.people)) for (const id of p.ids || [p.id]) byId[id] = p;
    const turnosRead = new Set(rows.map(r => r.turno || (byId[r.id] && byId[r.id].turno)).filter(Boolean));
    const cmp = A.compare(rows, w.people, run.monday, { turnosRead: [...turnosRead] });
    const codes = (run.photos || []).map(p => p.sheet_code).filter(Boolean);
    const wrongWeek = codes.filter(c => { const m = /-(\d{6})-/.exec(c); return m && m[1] !== run.monday.replace(/-/g, '').slice(2); });
    return { ...cmp, turnosRead: [...turnosRead], wrongWeek, checador: { file: w.file, uploadedAt: w.uploadedAt } };
  }
  function publicRun(run) {
    const out = { id: run.id, monday: run.monday, createdAt: run.createdAt, by: run.by, status: run.status, reading: run.reading || null,
      photos: (run.photos || []).map(p => ({ n: p.n, name: p.name, sheet_code: p.sheet_code || null, codeDiffers: !!p.codeDiffers, manager_signed: p.manager_signed ?? null, rows: (p.rows || []).length, warning: p.warning || null, error: p.error || null })),
      dates: A.weekDates(run.monday).concat([{ key: 'dom', ymd: A.addDays(run.monday, 6) }]), model: AI.MODEL() };
    if (run.status === 'read') {
      out.analysis = analyse(run); out.sheetRows = sheetRows(run);
      if (out.analysis.summary) { run.lastSummary = out.analysis.summary; try { saveRun(run); } catch (e) {} }
    }
    return out;
  }
  app.get('/api/asis/runs/:id', (req, res) => { const r = loadRun(req.params.id); if (!r) return res.status(404).json({ error: 'No existe esa revisión.' }); res.json(publicRun(r)); });
  app.post('/api/asis/runs/:id/reread', (req, res) => { const r = loadRun(req.params.id); if (!r) return res.status(404).json({ error: 'No existe esa revisión.' }); if (reading.has(r.id)) return res.status(409).json({ error: 'Todavía se está leyendo.' }); startRead(r); res.status(202).json(publicRun(r)); });
  app.get('/api/asis/runs/:id/photo/:n', (req, res) => {
    const r = loadRun(req.params.id), p = r && (r.photos || []).find(x => x.n === +req.params.n);
    if (!p) return res.status(404).send('No encontrada.');
    res.sendFile(path.join(runDir(r.id), p.file));
  });
  /* Manual correction of one cell of the sheet reading (what the paper says), or "confirmed as read". */
  app.put('/api/asis/runs/:id/cell', (req, res) => {
    const r = loadRun(req.params.id); if (!r) return res.status(404).json({ error: 'No existe esa revisión.' });
    const { key, day, clave, te, ok } = req.body || {};
    if (!/^\d+:\d+$/.test(key || '') || !A.DAYS.includes(day)) return res.status(400).json({ error: 'Celda no válida.' });
    const c = String(clave == null ? '' : clave).trim().toUpperCase().slice(0, 12);
    const t = te === '' || te == null ? null : +String(te).replace(',', '.');
    if (t != null && !(t >= 0 && t < 24)) return res.status(400).json({ error: 'TE debe ser un número de horas entre 0 y 24.' });
    r.edits = r.edits || {}; r.edits[key] = r.edits[key] || {};
    r.edits[key][day] = { clave: c, te: t, ok: true, by: who(req), at: new Date().toISOString(), ...(ok ? { confirmed: true } : {}) };
    saveRun(r); res.json(publicRun(r));
  });
  app.delete('/api/asis/runs/:id', (req, res) => {
    const id = req.params.id; if (!RUN_ID.test(id)) return res.status(400).json({ error: 'Identificador no válido.' });
    if (reading.has(id)) return res.status(409).json({ error: 'Todavía se está leyendo.' });
    fs.rmSync(runDir(id), { recursive: true, force: true }); res.json({ ok: true });
  });

  /* ---------- Excel for payroll ---------- */
  app.get('/api/asis/runs/:id/excel', async (req, res, next) => {
    try {
      const r = loadRun(req.params.id); if (!r || r.status !== 'read') return res.status(404).send('Aún no hay resultados.');
      const an = analyse(r); if (an.missingWeek) return res.status(400).send('Falta el Excel del checador de esa semana.');
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook(); wb.creator = 'Grupo AVE';
      const head = (ws, cols) => { ws.columns = cols; const h = ws.getRow(1); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2328' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
      const ws = wb.addWorksheet('Nómina');
      head(ws, [{ header: 'ID', key: 'id', width: 9 }, { header: 'Nombre', key: 'name', width: 38 }, { header: 'Turno', key: 'turno', width: 14 },
        { header: 'Días asistidos', key: 'A', width: 9 }, { header: 'Descanso trabajado', key: 'DT', width: 10 }, { header: 'FI', key: 'FI', width: 6 }, { header: 'INC', key: 'INC', width: 6 }, { header: 'VAC', key: 'VAC', width: 6 }, { header: 'PSS', key: 'PSS', width: 6 }, { header: 'Checador incompleto', key: 'INCOMP', width: 11 },
        { header: 'Horas checador', key: 'hours', width: 10 }, { header: 'Límite semanal', key: 'limit', width: 9 }, { header: 'TE checador', key: 'teChk', width: 10 }, { header: 'TE hoja', key: 'teSheet', width: 9 }, { header: 'Diferencia (hoja - checador)', key: 'teDiff', width: 12 },
        { header: 'Estado', key: 'lvl', width: 10 }, { header: 'Observaciones', key: 'obs', width: 90 }]);
      for (const p of an.results) {
        const row = ws.addRow({ id: p.id + (p.ids.length > 1 ? ` (${p.ids.filter(x => x !== p.id).join(', ')})` : ''), name: p.name, turno: p.turno, ...p.totals, limit: p.limit, lvl: { bad: 'Revisar', warn: 'Atención', ok: 'OK' }[p.lvl],
          obs: p.flags.filter(f => f.lvl !== 'info' || !f.day).map(f => (f.day ? `${A.DAY_LABEL[f.day]} ${A.ddmm(f.ymd)}: ` : '') + f.msg).join(' | ') });
        const col = { bad: 'FFFBE3E3', warn: 'FFFFF3D6' }[p.lvl]; if (col) row.getCell('lvl').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col } };
      }
      ws.autoFilter = { from: 'A1', to: 'Q1' };
      const wd = wb.addWorksheet('Detalle por día');
      const dates = A.weekDates(r.monday).concat([{ key: 'dom', ymd: A.addDays(r.monday, 6) }]);
      head(wd, [{ header: 'ID', key: 'id', width: 9 }, { header: 'Nombre', key: 'name', width: 34 }, { header: 'Fecha', key: 'f', width: 12 }, { header: 'Día', key: 'd', width: 6 },
        { header: 'Entrada', key: 'in', width: 8 }, { header: 'Salida', key: 'out', width: 8 }, { header: 'Horas', key: 'h', width: 7 }, { header: 'Extra del día (checador)', key: 'x', width: 10 },
        { header: 'Hoja: clave', key: 'c', width: 9 }, { header: 'Hoja: TE', key: 't', width: 8 }, { header: 'Resultado', key: 'r', width: 12 }, { header: 'Nota', key: 'n', width: 80 }]);
      const RES = { A: 'Asistió', DT: 'Descanso trabajado', D: 'Descanso', FI: 'FI', INC: 'INC', VAC: 'VAC', PSS: 'PSS', INCOMP: 'Incompleto' };
      for (const p of an.results) for (const d of p.days) {
        const ymd = dates.find(x => x.key === d.key).ymd;
        wd.addRow({ id: p.id, name: p.name, f: `${ymd.slice(8)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`, d: A.DAY_LABEL[d.key], in: d.clock.in || '', out: d.clock.out || '', h: d.clock.hours || 0, x: d.clock.extra || 0,
          c: d.sheet ? d.sheet.clave : '', t: d.sheet && d.sheet.te ? d.sheet.te : '', r: RES[d.final] || '', n: p.flags.filter(f => f.day === d.key).map(f => f.msg).join(' | ') });
      }
      const wa = wb.addWorksheet('Alertas');
      head(wa, [{ header: 'Nivel', key: 'l', width: 10 }, { header: 'ID', key: 'id', width: 9 }, { header: 'Nombre', key: 'name', width: 34 }, { header: 'Día', key: 'd', width: 12 }, { header: 'Alerta', key: 'm', width: 110 }]);
      for (const p of an.results) for (const f of p.flags) if (f.lvl !== 'info') wa.addRow({ l: f.lvl === 'bad' ? 'Revisar' : 'Atención', id: p.id, name: p.name, d: f.day ? `${A.DAY_LABEL[f.day]} ${A.ddmm(f.ymd)}` : 'Semana', m: f.msg });
      for (const x of an.extras) wa.addRow({ l: 'Revisar', id: x.id || '', name: x.name, d: x.sheet, m: x.why === 'duplicado' ? 'Aparece dos veces en las hojas.' : 'Está en la hoja pero no en el checador de esta semana.' });
      const end = A.addDays(r.monday, 6);
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="Asistencia_Monclova_${r.monday.slice(8)}-${end.slice(8)}_${end.slice(5, 7)}_${end.slice(0, 4)}.xlsx"`);
      await wb.xlsx.write(res); res.end();
    } catch (e) { next(e); }
  });

  return { summary: () => { const runs = listRuns(); const ro = roster(); return { people: Object.keys(ro.people).length, week: ro.week, last: runs.find(r => r.status === 'read') || null, nextMonday: nextMonday() }; } };
};

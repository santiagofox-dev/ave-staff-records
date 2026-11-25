'use strict';
/* ASISTENTE ASISTENCIA: upload the CHECADOR export, then compare it against what the plant reports
   (Monclova: printed sheet read from a photo; Jabil Chihuahua: INCIDENCIAS Excel). The CHECADOR wins. */
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
  const RUNS = path.join(ROOT, 'runs');
  fs.mkdirSync(RUNS, { recursive: true });
  const PL = id => A.PLANTS[id] ? id : 'monclova';
  const plantOf = req => PL(String((req.query && req.query.planta) || (req.body && req.body.planta) || 'monclova'));
  const base = pl => pl === 'monclova' ? ROOT : path.join(ROOT, 'plantas', pl);
  const dir = (pl, sub) => { const d = path.join(base(pl), sub); fs.mkdirSync(d, { recursive: true }); return d; };
  const readJ = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
  const writeJ = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const RUN_ID = /^[a-f0-9]{16}$/;
  const who = req => (req.user && (req.user.name || req.user.username)) || 'admin';
  const roster = pl => readJ(path.join(base(pl), 'roster.json'), { people: {}, uploads: [], week: null });
  // Tolerance: 15 min (Allan, Nov 19 2026). Settings saved before that rule get 15 too.
  const settings = pl => { const st = readJ(path.join(base(pl), 'settings.json'), { turnos: {} }); if (st.tolVer !== 2) { st.tolMin = 15; st.tolVer = 2; } return st; };
  const week = (pl, mon) => readJ(path.join(dir(pl, 'weeks'), mon + '.json'), null);
  const prints = (pl, mon) => readJ(path.join(dir(pl, 'prints'), mon + '.json'), null);
  const incid = (pl, mon) => readJ(path.join(dir(pl, 'incidencias'), mon + '.json'), null);
  const listDir = (pl, sub) => fs.readdirSync(dir(pl, sub)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort().reverse();
  const runDir = id => path.join(RUNS, id);
  const loadRun = id => RUN_ID.test(id) ? readJ(path.join(runDir(id), 'run.json'), null) : null;
  const saveRun = r => writeJ(path.join(runDir(r.id), 'run.json'), r);
  const todayCJ = () => new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  const nextMonday = () => A.addDays(A.mondayOf(todayCJ()), 7);
  const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const fileTag = (pl, mon) => { const e = A.addDays(mon, 6); return `${A.PLANTS[pl].name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_')}_${+mon.slice(8)}-${+e.slice(8)}_${MES[+e.slice(5, 7) - 1]}_${e.slice(0, 4)}`; };

  app.get('/asistencia', (req, res) => res.sendFile(path.join(__dirname, 'public', 'asistencia.html')));

  /* Summaries of big JSON files, kept in memory until the file changes (mtime/size), so lists don't re-read every run. */
  const memo = new Map();
  function cached(f, make) {
    let st; try { st = fs.statSync(f); } catch { memo.delete(f); return null; }
    const k = st.mtimeMs + ':' + st.size, hit = memo.get(f);
    if (hit && hit.k === k) return hit.v;
    const raw = readJ(f, null), v = raw && make(raw);
    memo.set(f, { k, v }); return v;
  }
  const runMeta = id => cached(path.join(runDir(id), 'run.json'), r => ({ id: r.id, plant: r.plant || 'monclova', monday: r.monday, createdAt: r.createdAt, by: r.by, status: r.status, source: r.source || 'foto', photos: (r.photos || []).length, summary: r.lastSummary || null }));
  function listRuns(pl) {
    return fs.readdirSync(RUNS).filter(x => RUN_ID.test(x)).map(runMeta).filter(Boolean).filter(r => !pl || r.plant === pl)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 40).map(r => ({ ...r }));
  }
  /* Turnos seen in the last CHECADOR, with the rules in force (saved > plant default > CHECADOR schedule). */
  function turnoTable(pl) {
    const ro = roster(pl), st = settings(pl), out = {};
    for (const p of Object.values(ro.people)) {
      const t = out[p.turno] || (out[p.turno] = { turno: p.turno, horario: p.horario, people: 0 }); t.people++;
    }
    for (const name of Object.keys(st.turnos || {})) if (!out[name]) out[name] = { turno: name, horario: '', people: 0 };
    return Object.values(out).sort((a, b) => a.turno.localeCompare(b.turno)).map(t => {
      const r = A.ruleFor(pl, st, t.turno, t.horario), ht = A.horarioTimes(t.horario);
      return { ...t, ...r, checador: ht ? `${ht[0]}–${ht[1]}` : '', saved: !!(st.turnos || {})[t.turno] };
    });
  }
  function exemptView(pl) {
    const ro = roster(pl), names = {};
    for (const p of Object.values(ro.people)) for (const id of p.ids || [p.id]) names[id] = p.name;
    for (const mon of listDir(pl, 'incidencias').slice(0, 1)) for (const r of incid(pl, mon).rows) if (!names[r.id]) names[r.id] = r.name;
    return A.exemptFor(pl, settings(pl)).map(A.parseExempt).filter(Boolean).map(e => ({ id: e.id, name: e.name || names[e.id] || '', named: !!e.name }));
  }
  const inactiveView = pl => A.inactiveFor(pl, settings(pl));
  app.get('/api/asis/state', (req, res) => {
    const pl = plantOf(req), P = A.PLANTS[pl];
    const ro = roster(pl), people = Object.values(ro.people);
    const turnos = {}; for (const p of people) turnos[p.turno] = (turnos[p.turno] || 0) + 1;
    const runs = listRuns(pl);
    const incWeeks = listDir(pl, 'incidencias');
    const weeks = listDir(pl, 'weeks').slice(0, 20).map(mon => {
      const w = cached(path.join(dir(pl, 'weeks'), mon + '.json'), x => ({ people: Object.keys(x.people || {}).length, uploadedAt: x.uploadedAt, by: x.by, file: x.file })) || {}; return { monday: mon, people: w.people || 0, uploadedAt: w.uploadedAt, by: w.by, file: w.file, printed: fs.existsSync(path.join(dir(pl, 'prints'), mon + '.json')), incidencias: incWeeks.includes(mon), runs: runs.filter(r => r.monday === mon).length };
    });
    const inc = incWeeks.slice(0, 20).map(mon => { const x = cached(path.join(dir(pl, 'incidencias'), mon + '.json'), y => ({ rows: (y.rows || []).length, file: y.file, sheet: y.sheet, uploadedAt: y.uploadedAt })) || { rows: 0 }; return { monday: mon, rows: x.rows, file: x.file, sheet: x.sheet, uploadedAt: x.uploadedAt, checador: fs.existsSync(path.join(dir(pl, 'weeks'), mon + '.json')) }; });
    res.json({ plant: { id: pl, name: P.name, source: P.source }, plants: Object.values(A.PLANTS).map(x => ({ id: x.id, name: x.name, source: x.source })),
      hasKey: AI.hasKey(), model: AI.MODEL(), nextMonday: nextMonday(), thisMonday: A.mondayOf(todayCJ()),
      turnos: turnoTable(pl), tolMin: settings(pl).tolMin ?? 15, exempt: exemptView(pl), inactive: inactiveView(pl),
      roster: { count: people.length, turnos, week: ro.week, updatedAt: ro.updatedAt || null, merged: people.filter(p => (p.ids || []).length > 1).map(p => ({ name: p.name, ids: p.ids })) },
      uploads: (ro.uploads || []).slice(-5).reverse(), weeks, incidencias: inc, runs });
  });
  app.put('/api/asis/settings', (req, res) => {
    const pl = plantOf(req), body = req.body || {}, st = settings(pl), T = /^\d{1,2}:\d{2}$/;
    const turnos = {};
    for (const [name, v] of Object.entries(body.turnos || {})) {
      if (!v || typeof name !== 'string' || name.length > 80) continue;
      const lim = +v.limit;
      if (v.start && !T.test(v.start) || v.end && !T.test(v.end)) return res.status(400).json({ error: `Horario no válido en ${name} (usa HH:MM).` });
      if (v.limit !== '' && v.limit != null && !(lim >= 20 && lim <= 84)) return res.status(400).json({ error: `El límite semanal de ${name} debe estar entre 20 y 84 horas.` });
      turnos[name] = { start: v.start ? v.start.padStart(5, '0') : undefined, end: v.end ? v.end.padStart(5, '0') : undefined, limit: lim || undefined };
    }
    st.turnos = turnos;
    if (body.tolMin != null) { const t = +body.tolMin; if (!(t >= 0 && t <= 120)) return res.status(400).json({ error: 'La tolerancia debe estar entre 0 y 120 minutos.' }); st.tolMin = t; st.tolVer = 2; }
    const cleanList = a => [...new Set(a.map(x => String(x).replace(/\s+/g, ' ').trim().slice(0, 80)).filter(x => /^(\d{1,10}( [^\d,;]+)?|[^\d,;]{3,})$/.test(x)))];
    if (Array.isArray(body.inactive)) st.inactive = cleanList(body.inactive);
    if (Array.isArray(body.exempt)) st.exempt = [...new Set(body.exempt.map(x => String(x).replace(/\s+/g, ' ').trim().slice(0, 80)).filter(x => /^\d{1,10}( [^\d,;]+)?$/.test(x)))];
    st.updatedAt = new Date().toISOString(); st.by = who(req);
    writeJ(path.join(base(pl), 'settings.json'), st);
    res.json({ ok: true, turnos: turnoTable(pl), tolMin: st.tolMin, exempt: exemptView(pl), inactive: inactiveView(pl) });
  });

  /* ---------- 1. CHECADOR upload ---------- */
  const xlsxUp = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } }).single('file');
  app.post('/api/asis/checador', (req, res) => xlsxUp(req, res, async err => {
    if (err || !req.file) return res.status(400).json({ error: 'No se pudo recibir el archivo.' });
    if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Sube el Excel (.xlsx) que genera el checador.' });
    const tmp = path.join(os.tmpdir(), 'chk-' + crypto.randomBytes(6).toString('hex') + '.xlsx');
    try {
      fs.writeFileSync(tmp, req.file.buffer);
      const pl = plantOf(req);
      const { people } = await A.readChecador(tmp);
      const weeks = A.splitWeeks(people), at = new Date().toISOString();
      const mons = Object.keys(weeks).sort();
      for (const mon of mons) writeJ(path.join(dir(pl, 'weeks'), mon + '.json'), { monday: mon, uploadedAt: at, by: who(req), file: req.file.originalname, people: weeks[mon] });
      const ro = roster(pl), latest = mons[mons.length - 1];
      const changes = { added: [], removed: [] };
      if (!ro.week || latest >= ro.week) {
        const nu = {};
        for (const p of Object.values(weeks[latest])) nu[p.id] = { id: p.id, ids: p.ids, name: p.name, turno: p.turno, horario: p.horario, rest: A.restPattern(p) };
        if (ro.week) changes.added = Object.keys(nu).filter(id => !ro.people[id]).map(id => nu[id].name);
        changes.removed = Object.keys(ro.people).filter(id => !nu[id]).map(id => ro.people[id].name);
        ro.people = nu; ro.week = latest; ro.updatedAt = at;
      }
      ro.uploads = [...(ro.uploads || []), { at, by: who(req), file: req.file.originalname, weeks: mons, people: people.length }].slice(-30);
      writeJ(path.join(base(pl), 'roster.json'), ro);
      res.json({ ok: true, weeks: mons, people: people.length, merged: people.filter(p => p.ids.length > 1).map(p => ({ name: p.name, ids: p.ids })), rosterUpdated: ro.week === latest, changes });
    } catch (e) { res.status(400).json({ error: e.message }); }
    finally { fs.rmSync(tmp, { force: true }); }
  }));

  /* ---------- INCIDENCIAS upload (Excel plants) ---------- */
  app.post('/api/asis/incidencias', (req, res) => xlsxUp(req, res, async err => {
    if (err || !req.file) return res.status(400).json({ error: 'No se pudo recibir el archivo.' });
    if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Sube el Excel (.xlsx) de incidencias.' });
    const tmp = path.join(os.tmpdir(), 'inc-' + crypto.randomBytes(6).toString('hex') + '.xlsx');
    try {
      fs.writeFileSync(tmp, req.file.buffer);
      const pl = plantOf(req), at = new Date().toISOString();
      const weeks = await A.readIncidencias(tmp);
      const mons = Object.keys(weeks).sort();
      for (const mon of mons) writeJ(path.join(dir(pl, 'incidencias'), mon + '.json'), { ...weeks[mon], file: req.file.originalname, uploadedAt: at, by: who(req) });
      res.json({ ok: true, weeks: mons.map(m => ({ monday: m, rows: weeks[m].rows.length, sheet: weeks[m].sheet, checador: fs.existsSync(path.join(dir(pl, 'weeks'), m + '.json')) })) });
    } catch (e) { res.status(400).json({ error: e.message }); }
    finally { fs.rmSync(tmp, { force: true }); }
  }));

  /* ---------- 2. Printable sheet ---------- */
  app.get('/api/asis/lista.pdf', (req, res) => {
    const pl = plantOf(req), P = A.PLANTS[pl];
    const mon = A.mondayOf(YMD.test(req.query.semana || '') ? req.query.semana : nextMonday());
    const ro = roster(pl), inM = A.listMatcher(A.inactiveFor(pl, settings(pl)));
    const people = Object.values(ro.people).filter(p => !(p.ids || [p.id]).some(id => inM(id, p.name)));
    if (!people.length) return res.status(400).send('Primero sube el Excel del checador para tener la lista del personal.');
    const sheets = A.layoutSheets(people, mon, { plant: P.print, code: P.code });
    const st = settings(pl), hor = {}; for (const p of people) if (p.horario && !hor[p.turno]) hor[p.turno] = p.horario;
    for (const sh of sheets) sh.shift = A.ruleFor(pl, st, sh.turno, hor[sh.turno]);
    writeJ(path.join(dir(pl, 'prints'), mon + '.json'), { monday: mon, at: new Date().toISOString(), by: who(req), sheets });
    const fname = `Lista_Asistencia_${fileTag(pl, mon)}.pdf`;
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

  function sheetsFor(pl, mon) {
    const p = prints(pl, mon); if (p) return p.sheets;
    const inM = A.listMatcher(A.inactiveFor(pl, settings(pl)));
    const people = Object.values(roster(pl).people).filter(p => !(p.ids || [p.id]).some(id => inM(id, p.name))), P = A.PLANTS[pl];
    return people.length ? A.layoutSheets(people, mon, { plant: P.print, code: P.code }) : [];
  }
  function startRead(run) {
    if (reading.has(run.id)) return;
    reading.add(run.id);
    const sheets = sheetsFor(run.plant || 'monclova', run.monday);
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
    const pl = plantOf(req), P = A.PLANTS[pl];
    if (P.source === 'excel') {
      const mon = YMD.test((req.body || {}).semana || '') ? A.mondayOf(req.body.semana) : null;
      const x = mon && incid(pl, mon);
      if (!x) return fail('No hay incidencias cargadas para esa semana.');
      const run = { id: req.runId, plant: pl, source: 'excel', monday: mon, createdAt: new Date().toISOString(), by: who(req), status: 'read', edits: {}, photos: [],
        incid: { file: x.file, sheet: x.sheet, title: x.title, rows: x.rows } };
      saveRun(run);
      return res.status(201).json(publicRun(run));
    }
    if (!req.files || !req.files.length) return fail('Agrega al menos una foto de la lista.');
    if (!AI.hasKey()) return fail('Falta la variable ANTHROPIC_API_KEY en Render.');
    const mon = YMD.test((req.body || {}).semana || '') ? A.mondayOf(req.body.semana) : null;
    if (!mon) return fail('Elige la semana de la lista.');
    const run = { id: req.runId, plant: pl, source: 'foto', monday: mon, createdAt: new Date().toISOString(), by: who(req), status: 'uploaded', edits: {},
      photos: req.files.map((f, i) => ({ n: i + 1, file: f.filename, name: f.originalname })) };
    saveRun(run); startRead(run);
    res.status(202).json(publicRun(run));
  }));

  /* Flatten the photo reads into sheet rows, apply manual corrections, and compare. */
  function sheetRows(run) {
    const pl = run.plant || 'monclova', ED = run.edits || {};
    if (run.source === 'excel') return (run.incid.rows || []).map(r => {
      const ed = ED[r.key] || {}, days = {};
      for (const d of A.DAYS7) days[d] = { ...(r.days[d] || { clave: '', te: null }), ...(ed[d] || {}) };
      return { ...r, days, sheet: run.incid.sheet, edited: Object.keys(ed) };
    });
    const sheets = sheetsFor(pl, run.monday), byCode = Object.fromEntries(sheets.map(s => [s.code.replace(/\s/g, ''), s]));
    const out = [];
    for (const ph of run.photos || []) (ph.rows || []).forEach((r, i) => {
      const key = `${ph.n}:${i}`, ed = ED[key] || {};
      const days = {}; for (const d of A.DAYS) days[d] = { ...r.days[d], ...(ed[d] || {}) };
      const sh = byCode[ph.sheet_code];
      out.push({ key, id: r.id, name: r.name, days, uncertain: r.uncertain.filter(d => !(ed[d] && ed[d].ok)), note: r.note, sheet: ph.sheet_code || `Foto ${ph.n}`, turno: sh ? sh.turno : null, photo: ph.n, handwritten: r.handwritten });
    });
    return out;
  }
  function analyse(run) {
    const pl = run.plant || 'monclova', excel = run.source === 'excel';
    const w = week(pl, run.monday);
    if (!w) return { missingWeek: true };
    const rows = sheetRows(run);
    if (!rows.length) return { nothingRead: true };
    const byId = {}; for (const p of Object.values(w.people)) for (const id of p.ids || [p.id]) byId[id] = p;
    const turnosRead = excel ? null : [...new Set(rows.map(r => r.turno || (byId[r.id] && byId[r.id].turno)).filter(Boolean))];
    const cmp = A.compare(rows, w.people, run.monday, { turnosRead, plant: pl, settings: settings(pl), sheetLabel: excel ? 'incidencias' : 'la hoja', overrides: run.overrides || {} });
    const codes = (run.photos || []).map(p => p.sheet_code).filter(Boolean);
    const wrongWeek = codes.filter(c => { const m = /-(\d{6})-/.exec(c); return m && m[1] !== run.monday.replace(/-/g, '').slice(2); });
    return { ...cmp, turnosRead: turnosRead || [...new Set(cmp.results.map(r => r.turno))], wrongWeek, checador: { file: w.file, uploadedAt: w.uploadedAt } };
  }
  function publicRun(run) {
    const pl = run.plant || 'monclova';
    const out = { id: run.id, plant: pl, plantName: A.PLANTS[pl].name, source: run.source || 'foto', incid: run.incid ? { file: run.incid.file, sheet: run.incid.sheet, title: run.incid.title } : null, monday: run.monday, createdAt: run.createdAt, by: run.by, status: run.status, reading: run.reading || null,
      photos: (run.photos || []).map(p => ({ n: p.n, name: p.name, sheet_code: p.sheet_code || null, codeDiffers: !!p.codeDiffers, manager_signed: p.manager_signed ?? null, rows: (p.rows || []).length, warning: p.warning || null, error: p.error || null })),
      dates: A.DAYS7.map((key, i) => ({ key, ymd: A.addDays(run.monday, i) })), sheetDays: A.PLANTS[pl].sheetDays, tolMin: settings(pl).tolMin ?? 15, model: AI.MODEL() };
    if (run.status === 'read') {
      out.analysis = analyse(run); out.sheetRows = sheetRows(run);
      if (out.analysis.summary) { run.lastSummary = out.analysis.summary; try { saveRun(run); } catch (e) {} }
    }
    return out;
  }
  app.get('/api/asis/runs/:id', (req, res) => { const r = loadRun(req.params.id); if (!r) return res.status(404).json({ error: 'No existe esa revisión.' }); res.json(publicRun(r)); });
  app.post('/api/asis/runs/:id/reread', (req, res) => { const r = loadRun(req.params.id); if (!r) return res.status(404).json({ error: 'No existe esa revisión.' }); if (reading.has(r.id)) return res.status(409).json({ error: 'Todavía se está leyendo.' }); if (r.source === 'excel') return res.status(400).json({ error: 'Esta revisión no tiene fotos.' }); startRead(r); res.status(202).json(publicRun(r)); });
  app.get('/api/asis/runs/:id/photo/:n', (req, res) => {
    const r = loadRun(req.params.id), p = r && (r.photos || []).find(x => x.n === +req.params.n);
    if (!p) return res.status(404).send('No encontrada.');
    res.sendFile(path.join(runDir(r.id), p.file));
  });
  /* Manual correction of one cell of the sheet reading (what the paper says), or "confirmed as read". */
  app.put('/api/asis/runs/:id/cell', (req, res) => {
    const r = loadRun(req.params.id); if (!r) return res.status(404).json({ error: 'No existe esa revisión.' });
    const { key, day, clave, te, ok } = req.body || {};
    if (!/^[\d:-]{3,30}$/.test(key || '') || !A.PLANTS[r.plant || 'monclova'].sheetDays.includes(day)) return res.status(400).json({ error: 'Celda no válida.' });
    const c = String(clave == null ? '' : clave).trim().toUpperCase().slice(0, 12);
    if (r.source !== 'excel' && !/^[a-z\d]+$/i.test(key.replace(':', ''))) return res.status(400).json({ error: 'Celda no válida.' });
    const t = te === '' || te == null ? null : +String(te).replace(',', '.');
    if (t != null && !(t >= 0 && t < 24)) return res.status(400).json({ error: 'TE debe ser un número de horas entre 0 y 24.' });
    r.edits = r.edits || {}; r.edits[key] = r.edits[key] || {};
    r.edits[key][day] = { clave: c, te: t, ok: true, by: who(req), at: new Date().toISOString(), ...(ok ? { confirmed: true } : {}) };
    saveRun(r); res.json(publicRun(r));
  });
  /* Admin decision for one person-day: overrides what the checador says (e.g. "sí asistió", with hours). */
  const FINALS = ['A', 'DT', 'FI', 'INC', 'VAC', 'PSS', 'PCS', 'MAT', 'DFD', 'D', 'BAJ'];
  app.put('/api/asis/runs/:id/override', (req, res) => {
    const r = loadRun(req.params.id); if (!r) return res.status(404).json({ error: 'No existe esa revisión.' });
    const { person, day, final, hours, note } = req.body || {};
    if (!/^\d{1,12}$/.test(String(person || '')) || !A.DAYS7.includes(day)) return res.status(400).json({ error: 'Celda no válida.' });
    r.overrides = r.overrides || {};
    const k = `${person}:${day}`;
    if (!final) delete r.overrides[k];
    else {
      if (!FINALS.includes(final)) return res.status(400).json({ error: 'Resultado no válido.' });
      const h = hours === '' || hours == null ? null : +String(hours).replace(',', '.');
      if (h != null && !(h >= 0 && h <= 24)) return res.status(400).json({ error: 'Las horas deben estar entre 0 y 24.' });
      r.overrides[k] = { final, hours: h, note: String(note || '').slice(0, 200), by: who(req), at: new Date().toISOString() };
    }
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
      const excel = r.source === 'excel', L = excel ? 'incidencias' : 'hoja', pl = r.plant || 'monclova';
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook(); wb.creator = 'Grupo AVE';
      const head = (ws, cols) => { ws.columns = cols; const h = ws.getRow(1); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2328' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
      const ws = wb.addWorksheet('Nómina');
      head(ws, [{ header: 'ID', key: 'id', width: 9 }, { header: 'Nombre', key: 'name', width: 38 }, { header: 'Turno', key: 'turno', width: 14 },
        { header: 'Días asistidos', key: 'A', width: 9 }, { header: 'Descanso trabajado', key: 'DT', width: 10 }, { header: 'FI', key: 'FI', width: 6 }, { header: 'INC', key: 'INC', width: 6 }, { header: 'VAC', key: 'VAC', width: 6 }, { header: 'PSS', key: 'PSS', width: 6 }, ...(excel ? [{ header: 'PCS', key: 'PCS', width: 6 }, { header: 'MAT', key: 'MAT', width: 6 }, { header: 'BAJ', key: 'BAJ', width: 6 }, { header: 'RET (checador)', key: 'RET', width: 9 }, { header: 'Min. retardo (después de tolerancia)', key: 'retMin', width: 12 }, { header: 'Min. salida antes (sin tolerancia)', key: 'earlyMin', width: 12 }] : []), { header: 'Checador incompleto', key: 'INCOMP', width: 11 },
        { header: 'Horas checador', key: 'hours', width: 10 }, { header: 'Límite semanal', key: 'limit', width: 9 }, { header: 'TE checador', key: 'teChk', width: 10 }, { header: `TE ${L}`, key: 'teSheet', width: 9 }, { header: `Diferencia (${L} - checador)`, key: 'teDiff', width: 12 },
        { header: 'Estado', key: 'lvl', width: 10 }, { header: 'Observaciones', key: 'obs', width: 90 }]);
      for (const p of an.results) {
        const row = ws.addRow({ id: p.id + (p.ids.length > 1 ? ` (${p.ids.filter(x => x !== p.id).join(', ')})` : ''), name: p.name, turno: p.turno, ...p.totals, limit: p.limit, lvl: { bad: 'Revisar', warn: 'Atención', ok: 'OK' }[p.lvl],
          obs: p.flags.filter(f => f.lvl !== 'info' || !f.day).map(f => (f.day ? `${A.DAY_LABEL[f.day]} ${A.ddmm(f.ymd)}: ` : '') + f.msg).join(' | ') });
        const col = { bad: 'FFFBE3E3', warn: 'FFFFF3D6' }[p.lvl]; if (col) row.getCell('lvl').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col } };
      }
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
      const wd = wb.addWorksheet('Detalle por día');
      const dates = A.DAYS7.map((key, i) => ({ key, ymd: A.addDays(r.monday, i) }));
      head(wd, [{ header: 'ID', key: 'id', width: 9 }, { header: 'Nombre', key: 'name', width: 34 }, { header: 'Fecha', key: 'f', width: 12 }, { header: 'Día', key: 'd', width: 6 },
        { header: 'Entrada', key: 'in', width: 8 }, { header: 'Salida', key: 'out', width: 8 }, { header: 'Horas', key: 'h', width: 7 }, { header: 'Extra del día (checador)', key: 'x', width: 10 }, ...(excel ? [{ header: 'Retardo (min, después de tolerancia)', key: 'rm', width: 12 }, { header: 'Salida antes (min)', key: 'em', width: 10 }] : []),
        { header: excel ? 'Incidencia' : 'Hoja: clave', key: 'c', width: 10 }, { header: excel ? 'Incidencias: TE' : 'Hoja: TE', key: 't', width: 8 }, { header: 'Resultado', key: 'r', width: 12 }, { header: 'Nota', key: 'n', width: 80 }]);
      const RES = { A: 'Asistió', DT: 'Descanso trabajado', D: 'Descanso', FI: 'FI', INC: 'INC', VAC: 'VAC', PSS: 'PSS', PCS: 'PCS', MAT: 'MAT', DFD: 'DFD', BAJ: 'Baja', INCOMP: 'Incompleto' };
      for (const p of an.results) for (const d of p.days) {
        const ymd = dates.find(x => x.key === d.key).ymd;
        wd.addRow({ id: p.id, name: p.name, f: `${ymd.slice(8)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`, d: A.DAY_LABEL[d.key], in: d.clock.in || '', out: d.clock.out || '', h: d.clock.hours || 0, x: d.clock.extra || 0, rm: d.clock.retMin || '', em: d.clock.early > 0 && !d.manual ? d.clock.early : '',
          c: d.sheet ? d.sheet.clave : '', t: d.sheet && d.sheet.te ? d.sheet.te : '', r: (RES[d.final] || '') + (d.manual ? ' (manual)' : ''), n: p.flags.filter(f => f.day === d.key).map(f => f.msg).join(' | ') });
      }
      const wa = wb.addWorksheet('Alertas');
      head(wa, [{ header: 'Nivel', key: 'l', width: 10 }, { header: 'ID', key: 'id', width: 9 }, { header: 'Nombre', key: 'name', width: 34 }, { header: 'Día', key: 'd', width: 12 }, { header: 'Alerta', key: 'm', width: 110 }]);
      for (const p of an.results) for (const f of p.flags) if (f.lvl !== 'info') wa.addRow({ l: f.lvl === 'bad' ? 'Revisar' : 'Atención', id: p.id, name: p.name, d: f.day ? `${A.DAY_LABEL[f.day]} ${A.ddmm(f.ymd)}` : 'Semana', m: f.msg });
      for (const x of an.extras) wa.addRow({ l: 'Revisar', id: x.id || '', name: x.name, d: x.sheet, m: x.why === 'duplicado' ? `Aparece dos veces en ${excel ? 'incidencias' : 'las hojas'}.` : `Está en ${excel ? 'incidencias' : 'la hoja'} pero no en el checador de esta semana${x.codes && x.codes.length ? ` (claves: ${[...new Set(x.codes)].join(', ')})` : ''}.` });
      if (an.notices) for (const n of an.notices) wa.addRow({ l: 'Atención', id: '', name: n.turno, d: 'Semana', m: n.msg });
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="Asistencia_${fileTag(pl, r.monday)}.xlsx"`);
      await wb.xlsx.write(res); res.end();
    } catch (e) { next(e); }
  });

  return { summary: () => {
    const runs = listRuns(), ro = roster('monclova');
    const people = Object.keys(A.PLANTS).reduce((a, pl) => a + Object.keys(roster(pl).people).length, 0);
    const last = runs.find(r => r.status === 'read') || null;
    return { people, week: ro.week, last: last && { ...last, plantName: A.PLANTS[last.plant].name }, nextMonday: nextMonday() };
  } };
};

'use strict';
/* "Comidas de Nuevos Ingresos" module: upload → read photos (Claude) → review → generate DELPHI + summary. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const M = require('./meals-core');
const Conf = require('./public/static/meals-conf');
const AI = require('./meals-ai');

module.exports = function (app, { DATA_DIR, getUser }) {
  const ROOT = path.join(DATA_DIR, 'meals');
  const RUNS = path.join(ROOT, 'runs');
  const HIST = path.join(ROOT, 'history.json');
  fs.mkdirSync(RUNS, { recursive: true });
  const runDir = id => path.join(RUNS, id);
  const ID_RE = /^[a-f0-9]{16}$/;
  const load = id => { if (!ID_RE.test(id)) return null; try { return JSON.parse(fs.readFileSync(path.join(runDir(id), 'run.json'), 'utf8')); } catch { return null; } };
  const save = run => { const f = path.join(runDir(run.id), 'run.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(run)); fs.renameSync(f + '.tmp', f); };
  const history = () => { try { return JSON.parse(fs.readFileSync(HIST, 'utf8')); } catch { return []; } };

  app.get('/comidas', (req, res) => res.sendFile(path.join(__dirname, 'public', 'meals.html')));
  app.get('/api/meals/config', (req, res) => res.json({ hasKey: AI.hasKey(), model: AI.MODEL() }));
  app.get('/api/meals/history', (req, res) => res.json(history().slice(-50).reverse()));

  /* ---------- 1. upload ---------- */
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => { const d = runDir(req.runId); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
      filename: (req, file, cb) => cb(null, `${file.fieldname}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 30 * 1024 * 1024, files: 30 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (file.fieldname === 'photos' ? /^\.(jpe?g|png|webp|heic)$/.test(ext) : ext === '.xlsx') return cb(null, true);
      cb(Object.assign(new Error(file.fieldname === 'photos' ? `"${file.originalname}" no es una foto (JPG o PNG).` : `"${file.originalname}" debe ser un archivo .xlsx.`), { status: 400 }));
    },
  }).fields([{ name: 'photos', maxCount: 25 }, { name: 'roster', maxCount: 1 }, { name: 'noreg', maxCount: 1 }, { name: 'delphi', maxCount: 1 }]);

  app.post('/api/meals/runs', (req, res, next) => { req.runId = crypto.randomBytes(8).toString('hex'); next(); }, (req, res) => {
    upload(req, res, async err => {
      const fail = (msg, code = 400) => { fs.rmSync(runDir(req.runId), { recursive: true, force: true }); res.status(code).json({ error: msg }); };
      if (err) return fail(err.code === 'LIMIT_FILE_SIZE' ? 'Un archivo pesa más de 30 MB.' : err.message);
      const f = req.files || {};
      if (!f.photos || !f.photos.length) return fail('Sube al menos una foto de las hojas INGRESOS.');
      if (/heic/i.test(f.photos.map(p => p.originalname).join())) return fail('Las fotos HEIC de iPhone no se pueden leer; envíalas como JPG (en el iPhone: Ajustes › Cámara › Formatos › Más compatible).');
      if (!f.roster) return fail('Falta NUMEROS DE EMPLEADO NUEVOS INGRESOS.xlsx.');
      if (!f.noreg) return fail('Falta el archivo NO REGISTRADOS.');
      if (!f.delphi) return fail('Falta el reporte DELPHI.');
      try {
        const roster = await M.readRoster(f.roster[0].path);
        if (!roster.length) return fail('La lista de nuevos ingresos está vacía.');
        const noReg = await M.readNoRegistrados(f.noreg[0].path);
        const dwb = await M.loadWorkbook(f.delphi[0].path);
        const { blocks } = M.readDelphi(dwb.getWorksheet('Hoja1') || dwb.worksheets[0]);
        const delphiName = f.delphi[0].originalname.replace(/\.xlsx$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
        const m = delphiName.match(/DELPHI\s*-\s*(.+?)\s*-\s*Detallado/i);
        const run = {
          id: req.runId, createdAt: new Date().toISOString(), by: getUser(req), status: 'uploaded',
          label: m ? m[1] : `${blocks[0].key} a ${blocks[blocks.length - 1].key}`,
          files: {
            photos: f.photos.map((p, i) => ({ n: i + 1, name: p.originalname, stored: path.basename(p.path) })),
            roster: { name: f.roster[0].originalname, stored: path.basename(f.roster[0].path) },
            noreg: { name: f.noreg[0].originalname, stored: path.basename(f.noreg[0].path) },
            delphi: { name: f.delphi[0].originalname, stored: path.basename(f.delphi[0].path), base: delphiName },
          },
          days: blocks.map(b => b.key), year: blocks[0].real.y, delphiCounts: Object.fromEntries(blocks.map(b => [b.key, b.count])),
          roster, noReg, reading: { done: 0, total: f.photos.length, running: false, errors: [] }, photos: [],
        };
        save(run);
        res.json(publicRun(run));
      } catch (e) { fail(e.message); }
    });
  });

  /* ---------- 2. read photos (one Claude call per photo) ---------- */
  const reading = new Set();
  app.post('/api/meals/runs/:id/read', (req, res) => {
    const run = load(req.params.id);
    if (!run) return res.status(404).json({ error: 'No existe esa conciliación.' });
    if (!AI.hasKey()) return res.status(400).json({ error: 'Falta la variable ANTHROPIC_API_KEY en Render.' });
    if (reading.has(run.id)) return res.json(publicRun(run));
    reading.add(run.id);
    run.status = 'reading'; run.reading = { done: 0, total: run.files.photos.length, running: true, errors: [] }; run.photos = []; save(run);
    (async () => {
      for (const p of run.files.photos) {
        try {
          const r = await AI.readSheetPhoto(path.join(runDir(run.id), p.stored));
          run.photos.push({ n: p.n, ...r });
        } catch (e) {
          run.photos.push({ n: p.n, error: e.message, rows: [], day_columns: [] });
          run.reading.errors.push(`Foto ${p.n}: ${e.message}`);
        }
        run.reading.done++; save(run);
      }
      run.reading.running = false; run.status = 'read'; save(run); reading.delete(run.id);
    })().catch(e => { run.reading.running = false; run.reading.errors.push(e.message); run.status = 'read'; save(run); reading.delete(run.id); });
    res.status(202).json(publicRun(run));
  });

  // Suggested review grid: rows from every photo, day labels mapped to DELPHI days, names matched to the official list
  function suggestions(run) {
    const out = [], unknownDays = new Set();
    for (const ph of run.photos || []) {
      const map = {};
      for (const label of ph.day_columns || []) {
        const k = M.resolveDay(label, run.days, run.year || new Date(run.createdAt).getFullYear());
        if (k) map[label] = k; else unknownDays.add(label);
      }
      for (const r of ph.rows || []) {
        const marks = {}, uncertain = [], disputed = [];
        for (const [label, k] of Object.entries(map)) { if (r.marks[label]) marks[k] = true; if (r.uncertain_cells.includes(label)) uncertain.push(k); if ((r.disputed_cells || []).includes(label)) disputed.push(k); }
        const match = M.matchName(r.name_as_written, run.roster);
        out.push({ source: `Foto ${ph.n}`, photo: ph.n, row: r.row_number, nameAsWritten: r.name_as_written, marks, uncertain, disputed, note: r.note,
          id: match.id, officialName: match.id ? (run.roster.find(x => x.id === match.id) || {}).name : null, matchKind: match.kind, matchScore: match.score, alternatives: match.alternatives });
      }
    }
    return { rows: out, unknownDays: [...unknownDays] };
  }
  function publicRun(run) {
    const { roster, noReg, ...rest } = run;
    const sug = run.status === 'read' || run.status === 'generated' ? suggestions(run) : null;
    const rosterIds = new Set(roster.map(r => r.id));
    const unusualIds = M.unusualIds(roster.map(r => r.id));
    const confidence = sug ? Conf.assess(sug.rows, run.days, { unusualIds }) : null;
    return { ...rest, confidence, rosterSize: roster.length, noRegSize: noReg.length,
      noRegMatches: noReg.filter(s => rosterIds.has(String(s.codigo))).length,
      roster: roster.map(r => ({ id: r.id, name: r.name, type: r.type })),
      unusualIds, suggestions: sug, usage: (run.photos || []).reduce((a, p) => ({ in: a.in + ((p.usage || {}).input_tokens || 0), out: a.out + ((p.usage || {}).output_tokens || 0) }), { in: 0, out: 0 }) };
  }
  app.get('/api/meals/runs/:id', (req, res) => { const run = load(req.params.id); if (!run) return res.status(404).json({ error: 'No existe esa conciliación.' }); res.json(publicRun(run)); });
  app.get('/api/meals/runs/:id/photo/:n', (req, res) => {
    const run = load(req.params.id); const p = run && run.files.photos.find(x => x.n === +req.params.n);
    if (!p) return res.status(404).send('No encontrada.');
    res.sendFile(path.join(runDir(run.id), p.stored));
  });

  /* ---------- 3. generate ---------- */
  app.post('/api/meals/runs/:id/generate', express_json_guard, async (req, res) => {
    const run = load(req.params.id);
    if (!run) return res.status(404).json({ error: 'No existe esa conciliación.' });
    const rowsIn = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
    if (!rowsIn) return res.status(400).json({ error: 'Faltan los renglones revisados.' });
    const byId = Object.fromEntries(run.roster.map(r => [r.id, r]));
    const review = [];
    for (const r of rowsIn.slice(0, 2000)) {
      const id = r.id && byId[String(r.id)] ? String(r.id) : null;
      const name = String(r.nameAsWritten || '').trim().slice(0, 120);
      if (!name && !id) continue;
      const marks = {}; for (const d of run.days) if (r.marks && r.marks[d]) marks[d] = true;
      review.push({ source: String(r.source || 'Manual').slice(0, 30), row: r.row ?? '', nameAsWritten: name || (id ? byId[id].name : ''), id, name: id ? byId[id].name : null,
        type: id ? byId[id].type : '', marks, uncertain: (r.uncertain || []).filter(d => run.days.includes(d)), notes: String(r.note || '').slice(0, 300),
        matchNote: r.matchKind === 'fuzzy' && id ? `Coincidencia aproximada aceptada: "${name}" → ${byId[id].name}` : (r.matchKind === 'manual' && id ? `Asignado a mano: "${name}" → ${byId[id].name}` : '') });
    }
    // Confidence: of the AI read (no review) and of what is being generated (after the user's review)
    const unusualIds = M.unusualIds(run.roster.map(r => r.id));
    const readConf = Conf.assess(suggestions(run).rows, run.days, { unusualIds });
    const clean = rowsIn.slice(0, 2000).map(r => ({ source: String(r.source || 'Manual').slice(0, 30), photo: Number.isFinite(+r.photo) ? +r.photo : null, row: r.row ?? '',
      nameAsWritten: String(r.nameAsWritten || '').slice(0, 120), id: r.id && byId[String(r.id)] ? String(r.id) : null, officialName: r.id && byId[String(r.id)] ? byId[String(r.id)].name : null,
      marks: Object.fromEntries(run.days.map(d => [d, !!(r.marks && r.marks[d])])), uncertain: (r.uncertain || []).filter(d => run.days.includes(d)), disputed: (r.disputed || []).filter(d => run.days.includes(d)),
      matchKind: r.matchKind, matchScore: r.matchScore, reviewed: { days: ((r.reviewed || {}).days || []).filter(d => run.days.includes(d)), name: !!(r.reviewed || {}).name, id: !!(r.reviewed || {}).id } }));
    const finalConf = Conf.assess(clean, run.days, { unusualIds });
    const confidence = { read: readConf.pct, final: finalConf.pct, pending: finalConf.items.length, pendingItems: finalConf.items.map(Conf.itemText) };
    try {
      const rec = M.reconcile(review, run.noReg, run.roster, run.days);
      const dir = runDir(run.id);
      const dwb = await M.loadWorkbook(path.join(dir, run.files.delphi.stored));
      const stats = M.updateDelphi(dwb, rec.meals);
      const delphiOut = `${run.files.delphi.base} (actualizado).xlsx`;
      await dwb.xlsx.writeFile(path.join(dir, 'out-delphi.xlsx'));
      // review points
      const flags = confidence.pendingItems.map(t => `SIN REVISAR: ${t}`);
      for (const p of rec.people.filter(p => !p.id && p.total > 0)) flags.push(`SIN ID: ${p.written} — ${p.total} comida${p.total === 1 ? '' : 's'} (no agregada${p.total === 1 ? '' : 's'} a DELPHI)`);
      const usedIds = rec.people.filter(p => p.id && p.total).map(p => p.id);
      for (const id of M.unusualIds(run.roster.map(r => r.id)).filter(id => usedIds.includes(id))) flags.push(`ID fuera del patrón del lote: ${id} (${byId[id].name}) — confirmar`);
      for (const c of rec.cruce.filter(c => c.enLista)) flags.push(`NO REGISTRADOS: ${c.codigo} ${c.nombre} — ${c.dayKey} ${M.hhmm(c.hora)} — ${c.accion}`);
      for (const r of review.filter(x => x.matchNote)) flags.push(r.matchNote);
      const sumName = `Resumen comidas nuevos ingresos ${run.label}.xlsx`;
      await M.buildSummary(path.join(dir, 'out-summary.xlsx'), { label: run.label, dayKeys: run.days, people: rec.people, cruce: rec.cruce, delphiStats: stats, flags, confidence });
      const totals = {
        meals: rec.people.reduce((s, p) => s + p.total, 0), added: rec.meals.length,
        sinId: rec.people.filter(p => !p.id).reduce((s, p) => s + p.total, 0), employees: rec.people.filter(p => p.total > 0).length,
        noRegAdded: rec.cruce.filter(c => c.accion === 'Agregado a DELPHI').length, confRead: confidence.read, confFinal: confidence.final, pending: confidence.pending, netoOriginal: stats.netoOriginal, neto: stats.neto, days: stats.days,
      };
      run.status = 'generated'; run.review = rowsIn; run.totals = totals; run.outputs = { delphi: delphiOut, summary: sumName }; run.generatedAt = new Date().toISOString();
      save(run);
      const h = history().filter(x => x.id !== run.id);
      h.push({ id: run.id, at: run.generatedAt, by: getUser(req), label: run.label, ...totals, days: undefined, files: run.outputs });
      fs.writeFileSync(HIST, JSON.stringify(h));
      res.json({ totals, outputs: run.outputs, flags, confidence });
    } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
  });
  function express_json_guard(req, res, next) { next(); }

  // Delete a run (its files and its history entry)
  app.delete('/api/meals/runs/:id', (req, res) => {
    const id = String(req.params.id);
    if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: 'Identificador no válido.' });
    if (reading.has(id)) return res.status(409).json({ error: 'Esa conciliación todavía se está leyendo.' });
    fs.rmSync(runDir(id), { recursive: true, force: true });
    fs.writeFileSync(HIST, JSON.stringify(history().filter(x => x.id !== id)));
    res.json({ ok: true });
  });

  app.get('/api/meals/runs/:id/file/:which', (req, res) => {
    const run = load(req.params.id);
    if (!run || !run.outputs) return res.status(404).send('Aún no se ha generado.');
    const which = req.params.which === 'delphi' ? 'delphi' : 'summary';
    res.download(path.join(runDir(run.id), which === 'delphi' ? 'out-delphi.xlsx' : 'out-summary.xlsx'), run.outputs[which]);
  });
};

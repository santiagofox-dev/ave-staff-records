'use strict';
/* VACACIONES (Expedientes): what each employee is owed under LFT art. 76, the days taken, and the starting
   balances from the CONTPAQi "Kárdex de vacaciones". Absences can be turned into vacation days, here or from
   the Asistencia review (marking a day as VAC). The rules live in public/static/vac.js (shared with the page). */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const VAC = require('./public/static/vac');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['FI', 'falta', 'vacaciones']; // FI: falta sin justificar (no usa días) · falta: falta pasada a vacaciones
const todayCJ = () => new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-ZÑ ]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = s => new Set(norm(s).split(' ').filter(w => w.length > 1 && !['DE', 'DEL', 'LA', 'LOS', 'LAS', 'Y'].includes(w)));
/** Same person if every word of the shorter name is in the longer one (order doesn't matter: "APELLIDOS NOMBRES"). */
function sameName(a, b) {
  const A = toks(a), B = toks(b); if (!A.size || !B.size) return false;
  const [s, l] = A.size <= B.size ? [A, B] : [B, A];
  let hit = 0; for (const w of s) if (l.has(w)) hit++;
  return hit === s.size && s.size >= 2;
}
/** Same person when the employee number already matches: most of the words agree, allowing small typos
    ("CARRASCO"/"CARRASO", "VANNESA"/"VANESSA"). */
function lev(a, b) { const m = a.length, n = b.length; let p = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; }
function likeName(a, b) {
  const A = [...toks(a)], B = [...toks(b)]; if (!A.length || !B.length) return false;
  const [s, l] = A.length <= B.length ? [A, B] : [B, A];
  let hit = 0; for (const w of s) if (l.some(x => x === w || lev(x, w) <= (Math.min(x.length, w.length) >= 6 ? 2 : 1))) hit++;
  return hit >= 2 && hit >= Math.ceil(s.length * 0.6);
}
const numKey = n => String(n || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

module.exports = function (app, { state, persist, who }) {
  const emps = () => Object.values(state.employees);
  const entry = (e, x, by) => ({ id: crypto.randomBytes(6).toString('hex'), from: x.from, to: x.to || x.from, days: Math.round((+x.days || 0) * 100) / 100, kind: x.kind || 'FI', note: String(x.note || '').slice(0, 200), src: x.src || undefined, by, at: new Date().toISOString() });
  const touch = e => { e.updatedAt = new Date().toISOString(); };
  const withSummary = e => ({ id: e.id, vac: e.vac || null, summary: VAC.summary(e, todayCJ()) });
  /* every change to someone's vacaciones leaves a trace: what it was, what it is now, who and when */
  const pick = t => t ? { from: t.from, to: t.to, days: t.days, kind: t.kind, note: t.note } : null;
  function log(e, by, action, before, after, reason) {
    e.vac = e.vac || { taken: [] }; e.vac.log = e.vac.log || [];
    e.vac.log.push({ at: new Date().toISOString(), by, action, before: before || null, after: after || null, reason: String(reason || '').slice(0, 200) || undefined });
    if (e.vac.log.length > 1000) e.vac.log.splice(0, e.vac.log.length - 1000);
  }
  /** Validates and normalizes an entry's fields; returns { error } or the fields. */
  function fields(b, prev) {
    const from = b.from !== undefined ? b.from : prev && prev.from;
    if (!YMD.test(from || '')) return { error: 'Pon la fecha de inicio.' };
    const to = YMD.test((b.to !== undefined ? b.to : prev && prev.to) || '') ? (b.to !== undefined ? b.to : prev.to) : from;
    if (to < from) return { error: 'La fecha final es anterior a la inicial.' };
    const raw = b.days !== undefined ? b.days : prev && prev.days;
    const days = raw === '' || raw == null ? VAC.workDays(from, to) : Math.round(+raw * 100) / 100;
    if (!(days > 0 && days <= 60)) return { error: 'Los días deben ser de 0.5 a 60.' };
    let kind = b.kind !== undefined ? b.kind : prev ? prev.kind : 'FI';
    if (!(KINDS.includes(kind) || (prev && prev.kind === 'kardex' && kind === 'kardex'))) kind = 'FI'; // an absence is a falta sin justificar unless said otherwise
    const note = String((b.note !== undefined ? b.note : prev && prev.note) || '').slice(0, 200);
    return { from, to, days, kind, note };
  }

  /** Who in Expedientes is this person from another tool (number + name, or a unique name). */
  function findEmployee(number, name, site) {
    const list = emps().filter(e => e.status !== 'baja');
    const n = numKey(number);
    let c = n ? list.filter(e => numKey(e.number) === n && sameName(e.name, name)) : [];
    if (c.length !== 1) c = list.filter(e => sameName(e.name, name) && (!site || !e.site || e.site === site));
    if (c.length !== 1) c = list.filter(e => sameName(e.name, name));
    if (c.length === 1) return c[0];
    // same number and a close name (typos between CONTPAQi and Expedientes), including people already dados de baja
    if (n) { const all = emps().filter(e => numKey(e.number) === n && likeName(e.name, name)); const act = all.filter(e => e.status !== 'baja'); if (act.length) return act[0]; if (all.length) return all[0]; }
    return null;
  }
  /** Repeated records of the same person in Expedientes (same number and name): they all get the same data. */
  function twins(e, number, name) {
    const n = numKey(number); if (!n) return [];
    return emps().filter(x => x.id !== e.id && numKey(x.number) === n && likeName(x.name, name) && (x.status === 'baja') === (e.status === 'baja'));
  }

  /* ---------- CONTPAQi Kárdex de vacaciones ---------- */
  async function readKardex(file) {
    const { loadWorkbook } = require('./meals-core');
    const wb = await loadWorkbook(file), ws = wb.worksheets[0];
    const txt = v => { if (v == null) return ''; if (v instanceof Date) return v.toISOString().slice(0, 10); if (typeof v === 'object') return String(v.result ?? v.text ?? ''); return String(v); };
    const date = v => v instanceof Date ? v.toISOString().slice(0, 10) : (/^(\d{2})\/(\d{2})\/(\d{4})/.exec(txt(v)) || []).slice(1).reverse().join('-') || '';
    let asOf = '', company = '', cur = null; const people = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r), a = txt(row.getCell(1).value).trim();
      if (!asOf) { const m = /K[aá]rdex de vacaciones del empleado al (\d{2})\/(\d{2})\/(\d{4})/i.exec(a); if (m) asOf = `${m[3]}-${m[2]}-${m[1]}`; }
      if (!company) { const c = txt(row.getCell(4).value).trim(); if (/AVE|S\.?A\.?|GRUPO/i.test(c)) company = c; }
      const h = /^(\d{1,6})\.(.+)$/.exec(a);
      if (h) { cur = { number: numKey(h[1]), name: h[2].replace(/\s+/g, ' ').trim(), taken: [], anniversaries: [], saldo: 0, proportion: null }; people.push(cur); continue; }
      if (!cur || !a || a === 'Concepto') continue;
      const reg = date(row.getCell(2).value), from = date(row.getCell(3).value), to = date(row.getCell(4).value);
      const tomadas = +txt(row.getCell(5).value) || 0, derecho = +txt(row.getCell(6).value) || 0, saldo = row.getCell(7).value;
      if (/^Vacaciones tomadas$/i.test(a)) cur.taken.push({ from: from || reg, to: to || from || reg, days: tomadas });
      else if (/^Vac\. tomadas antes/i.test(a)) { if (tomadas) cur.taken.push({ from: '', to: '', days: tomadas, before: true }); }
      else if (/^Aniversario/i.test(a)) cur.anniversaries.push({ date: reg, days: derecho });
      else if (/^Proporci/i.test(a)) { cur.proportion = derecho; continue; }
      if (saldo != null && saldo !== '') cur.saldo = +txt(saldo) || 0;
    }
    if (!people.length) throw Object.assign(new Error('No parece un Kárdex de vacaciones de CONTPAQi (no encontré empleados "001.NOMBRE").'), { status: 400 });
    if (!asOf) throw Object.assign(new Error('No encontré la fecha del kárdex ("Kárdex de vacaciones del empleado al dd/mm/aaaa").'), { status: 400 });
    for (const p of people) {
      // start date: the first anniversary one year back; with none yet, from the fraction of the year worked
      // "Aniversario laboral al finalizar la jornada": the year is complete at the end of that day, so the start was the next day a year before
      if (p.anniversaries.length) { const d = new Date(VAC.addYears(p.anniversaries[0].date, -1) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); p.hire = d.toISOString().slice(0, 10); }
      else if (p.proportion != null) { const d = new Date(asOf + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - Math.round(p.proportion * 365)); p.hire = d.toISOString().slice(0, 10); }
    }
    return { asOf, company, people };
  }
  function planKardex(k) {
    const used = new Set(), rows = [];
    for (const p of k.people) {
      const e = findEmployee(p.number, p.name);
      const tw = e ? twins(e, p.number, p.name) : [];
      const dHire = e && e.hire && p.hire ? Math.abs((Date.parse(e.hire) - Date.parse(p.hire)) / 864e5) : null;
      rows.push({ number: p.number, name: p.name, saldo: Math.round(p.saldo * 100) / 100, taken: p.taken.reduce((a, t) => a + t.days, 0), hire: p.hire || '',
        match: e ? { id: e.id, name: e.name, number: e.number || '', site: e.site || '', hire: e.hire || '', baja: e.status === 'baja' } : null, twins: tw.map(x => x.id),
        dup: e ? used.has(e.id) : false, hireDiff: dHire != null && dHire > 3, fillHire: !!(e && !e.hire && p.hire) });
      if (e) { used.add(e.id); tw.forEach(x => used.add(x.id)); }
    }
    return rows;
  }

  const xlsUp = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).single('file');
  app.post('/api/vacaciones/kardex', (req, res) => xlsUp(req, res, async err => {
    if (err || !req.file) return res.status(400).json({ error: 'No se pudo recibir el archivo.' });
    if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Sube el Kárdex exportado a Excel (.xlsx).' });
    const tmp = path.join(os.tmpdir(), 'kdx-' + crypto.randomBytes(6).toString('hex') + '.xlsx');
    try {
      fs.writeFileSync(tmp, req.file.buffer);
      const k = await readKardex(tmp), plan = planKardex(k), apply = String(req.body && req.body.apply) === '1';
      if (apply) {
        const by = who(req);
        for (const r of plan) {
          if (!r.match || r.dup) continue;
          const p = k.people.find(x => x.number === r.number && x.name === r.name);
          for (const id of [r.match.id, ...(r.twins || [])]) {
            const e = state.employees[id]; if (!e) continue;
            const keep = ((e.vac && e.vac.taken) || []).filter(t => t.kind !== 'kardex' && (t.from || '') > k.asOf);
            const hist = p.taken.filter(t => !t.before).map(t => entry(e, { ...t, kind: 'kardex', note: '' }, by));
            const before = e.vac && e.vac.opening ? { date: e.vac.opening.date, saldo: e.vac.opening.saldo, file: e.vac.opening.file } : null;
            const oldK = ((e.vac && e.vac.taken) || []).filter(t => !keep.includes(t)).length;
            e.vac = { ...(e.vac || {}), opening: { date: k.asOf, saldo: r.saldo, file: req.file.originalname, by, at: new Date().toISOString() }, taken: [...hist, ...keep] };
            log(e, by, 'kardex', before && { ...before, registros: oldK }, { date: k.asOf, saldo: r.saldo, file: req.file.originalname, registros: hist.length });
            if (!e.hire && p.hire) e.hire = p.hire;
            touch(e);
          }
        }
        persist();
      }
      res.json({ asOf: k.asOf, company: k.company, applied: apply, total: plan.length, matched: plan.filter(r => r.match && !r.dup).length, rows: plan });
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
    finally { fs.rmSync(tmp, { force: true }); }
  }));

  /* ---------- days taken ---------- */
  app.get('/api/vacaciones', (req, res) => res.json(emps().filter(e => e.status !== 'baja').map(withSummary)));
  app.post('/api/employees/:id/vacaciones', (req, res) => {
    const e = state.employees[req.params.id]; if (!e) return res.status(404).json({ error: 'No existe ese empleado.' });
    const b = req.body || {}, f = fields(b, null);
    if (f.error) return res.status(400).json(f);
    e.vac = e.vac || { taken: [] }; e.vac.taken = e.vac.taken || [];
    const t = entry(e, f, who(req)); e.vac.taken.push(t);
    log(e, who(req), 'alta', null, { id: t.id, ...pick(t) }, b.reason);
    touch(e); persist();
    res.json(withSummary(e));
  });
  /* edit any entry (dates, days, type, note), including the ones that came from the kárdex */
  const edit = (req, res) => {
    const e = state.employees[req.params.id]; if (!e || !e.vac) return res.status(404).json({ error: 'No existe.' });
    const t = (e.vac.taken || []).find(x => x.id === req.params.entry);
    if (!t) return res.status(404).json({ error: 'No existe ese registro.' });
    const b = req.body || {}, f = fields(b, t);
    if (f.error) return res.status(400).json(f);
    const before = pick(t);
    if (JSON.stringify(before) === JSON.stringify(f)) return res.json(withSummary(e));
    Object.assign(t, f); t.changedBy = who(req); t.changedAt = new Date().toISOString();
    log(e, who(req), 'cambio', { id: t.id, ...before }, { id: t.id, ...pick(t) }, b.reason);
    touch(e); persist();
    res.json(withSummary(e));
  };
  app.patch('/api/employees/:id/vacaciones/:entry', edit);
  app.put('/api/employees/:id/vacaciones/:entry', edit);
  app.delete('/api/employees/:id/vacaciones/:entry', (req, res) => {
    const e = state.employees[req.params.id]; if (!e || !e.vac) return res.status(404).json({ error: 'No existe.' });
    const i = (e.vac.taken || []).findIndex(t => t.id === req.params.entry);
    if (i < 0) return res.status(404).json({ error: 'No existe ese registro.' });
    const [t] = e.vac.taken.splice(i, 1);
    log(e, who(req), 'baja', { id: t.id, ...pick(t) }, null, (req.body || {}).reason || req.query.reason);
    touch(e); persist();
    res.json(withSummary(e));
  });
  /* the starting balance (from the kárdex, or typed by hand) */
  app.put('/api/employees/:id/vacaciones-saldo', (req, res) => {
    const e = state.employees[req.params.id]; if (!e) return res.status(404).json({ error: 'No existe ese empleado.' });
    const b = req.body || {}; e.vac = e.vac || { taken: [] }; e.vac.taken = e.vac.taken || [];
    const prev = e.vac.opening ? { date: e.vac.opening.date, saldo: e.vac.opening.saldo, file: e.vac.opening.file } : null;
    if (b.clear) {
      if (!prev) return res.json(withSummary(e));
      delete e.vac.opening; log(e, who(req), 'saldo', prev, null, b.reason);
    } else {
      if (!YMD.test(b.date || '')) return res.status(400).json({ error: 'Pon la fecha del saldo.' });
      const saldo = Math.round(+b.saldo * 100) / 100;
      if (!Number.isFinite(saldo) || Math.abs(saldo) > 400) return res.status(400).json({ error: 'El saldo debe ser un número de días.' });
      if (prev && prev.date === b.date && prev.saldo === saldo) return res.json(withSummary(e));
      e.vac.opening = { ...(e.vac.opening || {}), date: b.date, saldo, by: who(req), at: new Date().toISOString(), edited: true };
      log(e, who(req), 'saldo', prev, { date: b.date, saldo, file: e.vac.opening.file }, b.reason);
    }
    touch(e); persist();
    res.json(withSummary(e));
  });

  /* ---------- from Asistencia: VAC days wait for someone to confirm them ----------
     Every week reviewed in Asistencia (Excel de incidencias, fotos or the local checador) is scanned for days whose
     result is VAC. Each one becomes an item to review; nothing is taken from Expedientes until someone confirms it.
     If a confirmed day stops being VAC (the week is corrected), it comes back for review to return the day.
     state.vacPending[key] = { key, plant, site, monday, ymd, person, name, runs:[], source, status: 'pending'|'confirmed'|'dismissed', gone, empId, entryId } */
  const reg = () => (state.vacPending = state.vacPending || {});
  const vacKey = (plant, person, ymd) => `asis:${plant}:${numKey(person) || norm(person)}:${ymd}`;
  /** run: { id, plant, site, monday }, days: [{ person, name, ymd, source }] = the VAC days in that run now */
  function syncRun(run, days, by) {
    const R = reg(), now = new Date().toISOString(), seen = new Set();
    let changed = false;
    for (const d of days) {
      const k = vacKey(run.plant, d.person, d.ymd); seen.add(k);
      let it = R[k];
      if (!it) {
        const e = findEmployee(d.person, d.name, run.site);
        it = R[k] = { key: k, plant: run.plant, site: run.site, monday: run.monday, ymd: d.ymd, person: String(d.person), name: d.name, runs: [], source: d.source, status: 'pending', empId: e ? e.id : null, at: now, by };
        changed = true;
      }
      if (!it.runs.includes(run.id)) { it.runs.push(run.id); changed = true; }
      if (it.gone) { delete it.gone; changed = true; }
      if (d.source && it.source !== d.source) { it.source = d.source; changed = true; }
    }
    for (const it of Object.values(R)) {
      if (it.plant !== run.plant || it.monday !== run.monday || seen.has(it.key) || !it.runs.includes(run.id)) continue;
      it.runs = it.runs.filter(x => x !== run.id); changed = true;
      if (it.runs.length) continue;
      if (it.status === 'confirmed') it.gone = now; // the day was taken from Expedientes: ask whether to give it back
      else delete R[it.key];
    }
    if (changed) persist();
  }
  /** Asistencia deleted a run: its VAC days no longer come from it. */
  function dropRun(runId) {
    const R = reg(); let changed = false;
    for (const it of Object.values(R)) if (it.runs.includes(runId)) {
      it.runs = it.runs.filter(x => x !== runId); changed = true;
      if (!it.runs.length) { if (it.status === 'confirmed') it.gone = new Date().toISOString(); else delete R[it.key]; }
    }
    if (changed) persist();
  }
  function pendingView(it) {
    const e = it.empId && state.employees[it.empId];
    const s = e ? VAC.summary(e, todayCJ()) : null;
    const already = e ? ((e.vac && e.vac.taken) || []).find(t => t.kind !== 'FI' && t.from <= it.ymd && (t.to || t.from) >= it.ymd && t.src !== it.key) : null;
    const op = e && e.vac && e.vac.opening;
    return { beforeKardex: !!(op && it.ymd <= op.date), key: it.key, plant: it.plant, site: it.site, monday: it.monday, ymd: it.ymd, person: it.person, name: it.name, source: it.source, status: it.status, gone: !!it.gone,
      need: it.gone ? 'devolver' : it.status === 'pending' ? 'descontar' : null,
      emp: e ? { id: e.id, name: e.name, number: e.number || '', site: e.site || '', balance: s.balance } : null,
      already: already ? { from: already.from, to: already.to, kind: already.kind } : null, decidedBy: it.decidedBy, decidedAt: it.decidedAt };
  }
  const needs = it => it.status === 'pending' || it.gone;
  const pendingFor = (plant, monday) => Object.values(reg()).filter(it => it.plant === plant && it.monday === monday).sort((a, b) => a.ymd.localeCompare(b.ymd) || String(a.name).localeCompare(String(b.name))).map(pendingView);
  app.get('/api/vacaciones/pendientes', (req, res) => {
    const { plant, monday, all } = req.query;
    const list = Object.values(reg()).filter(it => (!plant || it.plant === plant) && (!monday || it.monday === monday) && (all ? true : needs(it)))
      .sort((a, b) => a.ymd.localeCompare(b.ymd) || String(a.name).localeCompare(String(b.name)));
    res.json({ items: list.map(pendingView), open: Object.values(reg()).filter(needs).length });
  });
  /* confirm: take the day from Expedientes (or give it back when the VAC disappeared). body: { keys:[], emp: { key: empId } } */
  app.post('/api/vacaciones/pendientes/confirmar', (req, res) => {
    const b = req.body || {}, by = who(req), R = reg(), done = [], skipped = [];
    for (const k of [].concat(b.keys || [])) {
      const it = R[k]; if (!it || !needs(it)) continue;
      if (it.gone) {
        const e = it.empId && state.employees[it.empId];
        if (e && e.vac) {
          const t = (e.vac.taken || []).find(x => x.id === it.entryId || x.src === it.key);
          if (t) { e.vac.taken = e.vac.taken.filter(x => x !== t); log(e, by, 'baja', { id: t.id, ...pick(t) }, null, 'Ya no está como VAC en Asistencia: se devuelve el día'); touch(e); }
        }
        delete R[k]; done.push(k); continue;
      }
      const empId = (b.emp && b.emp[k]) || it.empId, e = empId && state.employees[empId];
      if (!e) { skipped.push({ key: k, why: 'No se sabe a quién de Expedientes corresponde.' }); continue; }
      e.vac = e.vac || { taken: [] }; e.vac.taken = e.vac.taken || [];
      const t = entry(e, { from: it.ymd, to: it.ymd, days: 1, kind: 'vacaciones', note: `VAC en Asistencia (${it.site || it.plant})`, src: it.key }, by);
      e.vac.taken.push(t); log(e, by, 'alta', null, { id: t.id, ...pick(t) }, `Confirmado desde Asistencia (${it.site || it.plant}, semana del ${it.monday})`);
      touch(e);
      Object.assign(it, { status: 'confirmed', empId: e.id, entryId: t.id, decidedBy: by, decidedAt: new Date().toISOString() });
      done.push(k);
    }
    persist();
    res.json({ done: done.length, skipped, open: Object.values(R).filter(needs).length });
  });
  /* don't take it from Expedientes (or, for a day that stopped being VAC, keep it taken) */
  app.post('/api/vacaciones/pendientes/descartar', (req, res) => {
    const b = req.body || {}, by = who(req), R = reg(); let n = 0;
    for (const k of [].concat(b.keys || [])) {
      const it = R[k]; if (!it || !needs(it)) continue;
      if (it.gone) { delete it.gone; it.keep = true; } else it.status = 'dismissed';
      Object.assign(it, { decidedBy: by, decidedAt: new Date().toISOString(), why: String(b.reason || '').slice(0, 200) || undefined }); n++;
    }
    persist();
    res.json({ done: n, open: Object.values(R).filter(needs).length });
  });
  /* undo a decision: back to review */
  app.post('/api/vacaciones/pendientes/revisar', (req, res) => {
    const it = reg()[(req.body || {}).key]; if (!it) return res.status(404).json({ error: 'No existe.' });
    if (it.status === 'dismissed') { it.status = 'pending'; persist(); }
    res.json(pendingView(it));
  });

  /** Old direct link (kept for compatibility): a manual VAC mark is now only queued for review by syncRun. */
  function fromAsistencia() { return { queued: true }; }

  return { fromAsistencia, syncRun, dropRun, pendingFor, readKardex, planKardex, findEmployee, sameName, likeName };
};

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
            e.vac = { opening: { date: k.asOf, saldo: r.saldo, file: req.file.originalname, by, at: new Date().toISOString() }, taken: [...hist, ...keep] };
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
    const b = req.body || {};
    if (!YMD.test(b.from || '')) return res.status(400).json({ error: 'Pon la fecha de inicio.' });
    const to = YMD.test(b.to || '') ? b.to : b.from;
    if (to < b.from) return res.status(400).json({ error: 'La fecha final es anterior a la inicial.' });
    const days = b.days === '' || b.days == null ? VAC.workDays(b.from, to) : +b.days;
    if (!(days > 0 && days <= 60)) return res.status(400).json({ error: 'Los días deben ser de 0.5 a 60.' });
    const kind = KINDS.includes(b.kind) ? b.kind : 'FI'; // an absence is a falta sin justificar unless said otherwise
    e.vac = e.vac || { taken: [] }; e.vac.taken = e.vac.taken || [];
    e.vac.taken.push(entry(e, { from: b.from, to, days, kind, note: b.note }, who(req)));
    touch(e); persist();
    res.json(withSummary(e));
  });
  /* a falta sin justificar can be passed to vacaciones (and back) */
  app.patch('/api/employees/:id/vacaciones/:entry', (req, res) => {
    const e = state.employees[req.params.id]; if (!e || !e.vac) return res.status(404).json({ error: 'No existe.' });
    const t = (e.vac.taken || []).find(x => x.id === req.params.entry);
    if (!t) return res.status(404).json({ error: 'No existe ese registro.' });
    if (t.kind === 'kardex') return res.status(400).json({ error: 'Los registros del Kárdex de CONTPAQi solo se cambian volviendo a cargar el Kárdex.' });
    const kind = (req.body || {}).kind;
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Tipo no válido.' });
    t.kind = kind; t.changedBy = who(req); t.changedAt = new Date().toISOString();
    touch(e); persist();
    res.json(withSummary(e));
  });
  app.delete('/api/employees/:id/vacaciones/:entry', (req, res) => {
    const e = state.employees[req.params.id]; if (!e || !e.vac) return res.status(404).json({ error: 'No existe.' });
    const i = (e.vac.taken || []).findIndex(t => t.id === req.params.entry);
    if (i < 0) return res.status(404).json({ error: 'No existe ese registro.' });
    if (e.vac.taken[i].kind === 'kardex') return res.status(400).json({ error: 'Los registros del Kárdex de CONTPAQi solo se cambian volviendo a cargar el Kárdex.' });
    e.vac.taken.splice(i, 1); touch(e); persist();
    res.json(withSummary(e));
  });

  /* ---------- from Asistencia: a day marked VAC in the weekly review ---------- */
  function fromAsistencia({ key, number, name, site, ymd, on, by }) {
    // remove any earlier entry for this same cell, then add it again if the day is VAC
    for (const e of emps()) if (e.vac && (e.vac.taken || []).some(t => t.src === key)) { e.vac.taken = e.vac.taken.filter(t => t.src !== key); touch(e); }
    if (!on) { persist(); return null; }
    const e = findEmployee(number, name, site);
    if (!e) { persist(); return { found: false }; }
    e.vac = e.vac || { taken: [] }; e.vac.taken = e.vac.taken || [];
    e.vac.taken.push(entry(e, { from: ymd, to: ymd, days: 1, kind: 'falta', note: 'Marcado como VAC en Asistencia', src: key }, by));
    touch(e); persist();
    const s = VAC.summary(e, todayCJ());
    return { found: true, name: e.name, balance: s.balance };
  }

  return { fromAsistencia, readKardex, planKardex, findEmployee, sameName, likeName };
};

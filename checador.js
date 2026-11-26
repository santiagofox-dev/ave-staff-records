'use strict';
/* CHECADOR EN SITIO: receives the punches that the on-site program (a Windows PC next to the face terminal)
   sends every hour, keeps them, and turns them into the same weekly CHECADOR data that Asistencia already
   reviews. The site keeps working with no internet; whatever it collected arrives on the next sync.

   Storage (DATA/checador):
     stations.json                       on-site PCs and their tokens (only a hash is kept)
     <plant>/employees.json              the plant's personnel (ID, NSS, name), sent down to the station
     <plant>/punches-YYYY-MM.json        every punch, keyed by its unique id (re-sending is harmless) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const A = require('./asistencia-core');

const DUP_MIN = 20;          // two punches closer than this = the same tap twice
const MAX_SPAN_MIN = 20 * 60; // longer than this between entry and exit = a missed punch
const NO_PUNCH = 'SIN CHECADAS'; // shift label for people with no punches yet (shift unknown)
const YMDHMS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

module.exports = function ({ DATA_DIR }) {
  const ROOT = path.join(DATA_DIR, 'checador');
  fs.mkdirSync(ROOT, { recursive: true });
  const ASIS = path.join(DATA_DIR, 'asistencia');
  const asisBase = pl => pl === 'monclova' ? ASIS : path.join(ASIS, 'plantas', pl);
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const writeJ = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };
  const pdir = pl => path.join(ROOT, pl);
  const LOCAL = () => Object.values(A.PLANTS).filter(p => p.source === 'local').map(p => p.id);

  /* ---------- stations ---------- */
  const stationsFile = path.join(ROOT, 'stations.json');
  const stations = () => readJ(stationsFile, { stations: [] });
  const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
  function createStation(plant, name, by) {
    if (!LOCAL().includes(plant)) throw Object.assign(new Error('Esa planta no usa checador en sitio.'), { status: 400 });
    const token = 'ave_' + crypto.randomBytes(24).toString('base64url');
    const st = stations();
    const s = { id: crypto.randomBytes(6).toString('hex'), plant, name: String(name || 'Estación').slice(0, 60), hash: hash(token), createdAt: new Date().toISOString(), by, lastSync: null };
    st.stations.push(s); writeJ(stationsFile, st);
    return { station: publicStation(s), token };
  }
  function revokeStation(id, by) {
    const st = stations(), s = st.stations.find(x => x.id === id);
    if (!s) throw Object.assign(new Error('No existe esa estación.'), { status: 404 });
    s.revoked = new Date().toISOString(); s.revokedBy = by; writeJ(stationsFile, st);
  }
  const publicStation = s => ({ id: s.id, plant: s.plant, name: s.name, createdAt: s.createdAt, by: s.by, lastSync: s.lastSync, lastIp: s.lastIp, version: s.version, info: s.info || null, revoked: s.revoked || null, pending: s.pending || 0, totalSent: s.totalSent || 0 });
  function stationByToken(token) {
    if (!token) return null;
    const hh = hash(token), st = stations();
    const s = st.stations.find(x => !x.revoked && x.hash.length === hh.length && crypto.timingSafeEqual(Buffer.from(x.hash), Buffer.from(hh)));
    return s ? { st, s } : null;
  }

  /* ---------- employees ---------- */
  const employees = pl => readJ(path.join(pdir(pl), 'employees.json'), { people: {}, updatedAt: null });
  async function importEmployees(pl, file, original, by) {
    const { loadWorkbook, normName } = require('./meals-core');
    const wb = await loadWorkbook(file);
    const out = {};
    for (const ws of wb.worksheets) {
      let hdr = null, col = {};
      for (let r = 1; r <= Math.min(ws.rowCount, 10) && !hdr; r++) {
        const m = {}; ws.getRow(r).eachCell({ includeEmpty: true }, (c, n) => { const t = normName(String(c.value == null ? '' : (c.value.result ?? c.value.text ?? c.value))); if (t) m[t] = n; });
        const nameC = m['EMPLEADO'] || m['NOMBRE'] || m['NOMBRE COMPLETO'];
        if (nameC) { hdr = r; col = { name: nameC, nss: m['NSS'] || m['IMSS'] || null, id: m['ID'] || m['NO'] || m['NUMERO'] || m['NO EMPLEADO'] || m['NUMERO DE EMPLEADO'] || m['ID DE EMPLEADO'] || null }; }
      }
      if (!hdr) continue;
      for (let r = hdr + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r), v = c => { if (!c) return ''; const x = row.getCell(c).value; return String(x == null ? '' : (x.result ?? x.text ?? x)).trim(); };
        let id = v(col.id || 1).replace(/\.0$/, ''); const name = v(col.name).replace(/[^\p{L}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim().toUpperCase(); // stray characters (e.g. "CAMACHO }CRUZ") out
        if (!/^\d{1,10}$/.test(id) || !name) continue;
        out[id] = { id, name, nss: v(col.nss) };
      }
      if (Object.keys(out).length) break;
    }
    if (!Object.keys(out).length) throw Object.assign(new Error('No encontré empleados. El Excel necesita una columna con el número de empleado y otra "EMPLEADO" o "NOMBRE".'), { status: 400 });
    const prev = employees(pl), added = Object.keys(out).filter(id => !prev.people[id]), gone = Object.keys(prev.people).filter(id => !out[id]);
    writeJ(path.join(pdir(pl), 'employees.json'), { people: out, updatedAt: new Date().toISOString(), by, file: original });
    rebuildRoster(pl);
    return { count: Object.keys(out).length, added: added.map(id => out[id].name), removed: gone.map(id => prev.people[id].name) };
  }

  /* ---------- punches ---------- */
  const monthFile = (pl, ym) => path.join(pdir(pl), `punches-${ym}.json`);
  function storePunches(pl, list, stationId) {
    const byMonth = {}, accepted = [], weeks = new Set(), now = Date.now();
    for (const p of list || []) {
      const uid = String(p.uid || '').slice(0, 80), emp = String(p.emp || '').replace(/\D/g, '').slice(0, 10), ts = String(p.ts || '').slice(0, 19);
      if (!uid || !emp || !YMDHMS.test(ts)) continue;
      const t = Date.parse(ts + 'Z');
      if (!(t > now - 400 * 864e5 && t < now + 2 * 864e5)) continue; // device clock far off: ignore
      (byMonth[ts.slice(0, 7)] = byMonth[ts.slice(0, 7)] || []).push({ uid, emp, ts: ts.length === 16 ? ts + ':00' : ts, src: String(p.src || 'face').slice(0, 12), by: p.by ? String(p.by).slice(0, 60) : undefined, station: stationId, at: new Date().toISOString() });
      accepted.push(uid);
    }
    let fresh = 0;
    for (const [ym, arr] of Object.entries(byMonth)) {
      const f = monthFile(pl, ym), cur = readJ(f, {});
      for (const p of arr) if (!cur[p.uid]) { cur[p.uid] = p; fresh++; weeks.add(A.mondayOf(p.ts.slice(0, 10))); weeks.add(A.mondayOf(A.addDays(p.ts.slice(0, 10), -1))); }
      writeJ(f, cur);
    }
    return { accepted, fresh, weeks: [...weeks] };
  }
  function punchesBetween(pl, fromYmd, toYmd) {
    const out = [];
    let ym = fromYmd.slice(0, 7);
    while (ym <= toYmd.slice(0, 7)) {
      for (const p of Object.values(readJ(monthFile(pl, ym), {}))) { const d = p.ts.slice(0, 10); if (d >= fromYmd && d <= toYmd) out.push(p); }
      const [y, m] = ym.split('-').map(Number); ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
    return out.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  /* ---------- turning punches into work days ---------- */
  const settingsOf = pl => readJ(path.join(asisBase(pl), 'settings.json'), { turnos: {} });
  /** The plant's shifts as minutes, from "Turnos y límites" (falls back to the plant defaults). */
  function shiftsOf(pl) {
    const st = settingsOf(pl), names = new Set([...(A.PLANTS[pl].defaults || []).map(d => d.name).filter(Boolean), ...Object.keys(st.turnos || {})]);
    const toM = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
    return [...names].map(name => { const r = A.ruleFor(pl, st, name, ''); return { name, start: toM(r.start), end: toM(r.end), limit: r.limit, startT: r.start, endT: r.end }; })
      .filter(s => s.start != null && s.end != null).sort((a, b) => a.name.localeCompare(b.name));
  }
  const circ = (a, b) => { const d = Math.abs(a - b) % 1440; return Math.min(d, 1440 - d); };
  const nearest = (shifts, m, key) => shifts.reduce((best, s) => (!best || circ(m, s[key]) < circ(m, best[key]) ? s : best), null);
  const mins = ts => Math.floor(Date.parse(ts.slice(0, 16) + 'Z') / 60000);
  const ymdOf = abs => new Date(abs * 60000).toISOString().slice(0, 10);
  const mod = abs => ((abs % 1440) + 1440) % 1440;

  /** One person's punches → sessions {in, out, shift}. Double taps are dropped; a lone exit stays a lone exit. */
  function sessionsOf(times, shifts) {
    const S = [];
    let open = null, lastOut = null;
    const looksLikeExit = m => { if (!shifts.length) return false; const st = nearest(shifts, m, 'start'), en = nearest(shifts, m, 'end'); return circ(m, en.end) <= 90 && circ(m, st.start) > 90; };
    const looksLikeEntry = m => shifts.length && circ(m, nearest(shifts, m, 'start').start) <= 60;
    for (const t of times) {
      if (open) {
        const span = t - open.in;
        if (span < DUP_MIN) continue;
        if (span <= MAX_SPAN_MIN && !(span > 14 * 60 && looksLikeEntry(mod(t)) && !looksLikeExit(mod(t)))) { open.out = t; S.push(open); lastOut = t; open = null; continue; }
        S.push(open); open = null; // missed the exit
      }
      if (lastOut != null && t - lastOut < DUP_MIN) continue;
      if (looksLikeExit(mod(t))) { S.push({ in: null, out: t }); lastOut = t; continue; }
      open = { in: t };
    }
    if (open) S.push(open);
    for (const s of S) {
      s.shift = s.in != null ? nearest(shifts, mod(s.in), 'start') : nearest(shifts, mod(s.out), 'end');
      // work day: the day the shift started (a night shift that ends after midnight belongs to the day it began)
      if (s.in != null) s.day = ymdOf(s.in);
      else { const sh = s.shift; s.day = ymdOf(s.out - (sh && sh.end < sh.start && mod(s.out) < sh.start ? 1440 : 0)); }
    }
    return S;
  }

  /** Rebuild the week files Asistencia reads, from the punches. */
  function rebuildWeek(pl, monday) {
    const shifts = shiftsOf(pl), emp = employees(pl).people;
    const sunday = A.addDays(monday, 6);
    const list = punchesBetween(pl, A.addDays(monday, -1), A.addDays(sunday, 1));
    const byEmp = {};
    for (const p of list) (byEmp[p.emp] = byEmp[p.emp] || []).push(mins(p.ts));
    const today = todayLocal(), nowMin = nowLocalMin();
    const people = {};
    const usual = {};
    for (const [id, times] of Object.entries(byEmp)) {
      const ses = sessionsOf([...new Set(times)].sort((a, b) => a - b), shifts).filter(s => s.day >= monday && s.day <= sunday);
      if (!ses.length) continue;
      const count = {}; for (const s of ses) if (s.shift) count[s.shift.name] = (count[s.shift.name] || 0) + 1;
      usual[id] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
      const p = people[id] = { id, ids: [id], name: (emp[id] && emp[id].name) || `EMPLEADO ${id}`, turno: usual[id] ? usual[id][0] : '', horario: '', days: {} };
      for (const s of ses) {
        const sh = s.shift, dow = A.dowKey(s.day), d = p.days[s.day];
        const rec = { rest: dow === 'sab' || dow === 'dom', in: s.in != null ? mod(s.in) : null, out: s.out != null ? mod(s.out) : null, sched: sh ? ((sh.end - sh.start + 1440) % 1440 || 1440) / 60 : null, start: sh ? sh.start : null, end: sh ? sh.end : null };
        if (!d) p.days[s.day] = rec;
        else { // two sessions the same day: first entry, last exit
          if (rec.in != null && (d.in == null || s.in < dayAbs(s.day, d.in))) d.in = rec.in;
          if (rec.out != null) d.out = rec.out;
        }
      }
    }
    // everyone on the plant list who should have worked Monday to Friday and has no punch: a day with no punches (= falta)
    const prevRoster = readJ(path.join(asisBase(pl), 'roster.json'), { people: {} }).people;
    for (const [id, e] of Object.entries(emp)) {
      const p = people[id] || (people[id] = { id, ids: [id], name: e.name, turno: (prevRoster[id] && prevRoster[id].turno) || NO_PUNCH, horario: '', days: {} });
      const sh = shifts.find(s => s.name === p.turno) || shifts[0];
      for (let i = 0; i < 5; i++) {
        const ymd = A.addDays(monday, i);
        if (p.days[ymd] || ymd > today) continue;
        if (ymd === today && sh && nowMin < sh.end + 60 && sh.end > sh.start) continue; // today's shift isn't over yet
        p.days[ymd] = { rest: false, in: null, out: null, sched: sh ? ((sh.end - sh.start + 1440) % 1440) / 60 : null, start: sh ? sh.start : null, end: sh ? sh.end : null };
      }
      for (const k of ['sab', 'dom']) { const ymd = A.addDays(monday, k === 'sab' ? 5 : 6); if (!p.days[ymd] && ymd <= today) p.days[ymd] = { rest: true, in: null, out: null, sched: null, start: null, end: null }; }
    }
    const wdir = path.join(asisBase(pl), 'weeks');
    writeJ(path.join(wdir, monday + '.json'), { monday, uploadedAt: new Date().toISOString(), by: 'Checador en sitio', file: 'Checador en sitio (sincronizado)', source: 'local', people });
    return { monday, people: Object.keys(people).length, punches: list.length };
  }
  const dayAbs = (ymd, m) => Math.floor(Date.parse(ymd + 'T00:00Z') / 60000) + m;

  /** Roster for Asistencia: the plant's employee list, each with the shift they used most recently. */
  function rebuildRoster(pl) {
    const emp = employees(pl).people, f = path.join(asisBase(pl), 'roster.json'), ro = readJ(f, { people: {}, uploads: [], week: null });
    const wdir = path.join(asisBase(pl), 'weeks');
    const weeks = fs.existsSync(wdir) ? fs.readdirSync(wdir).filter(x => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().reverse().slice(0, 4) : [];
    const turno = {};
    for (const w of weeks) for (const p of Object.values(readJ(path.join(wdir, w), { people: {} }).people || {})) if (p.turno && p.turno !== NO_PUNCH && !turno[p.id]) turno[p.id] = p.turno;
    const people = {};
    for (const [id, e] of Object.entries(emp)) { const old = ro.people[id] && ro.people[id].turno; people[id] = { id, ids: [id], name: e.name, turno: turno[id] || (old && old !== NO_PUNCH ? old : ''), horario: '', rest: ['sab', 'dom'], nss: e.nss }; }
    ro.people = people; ro.week = weeks[0] ? weeks[0].slice(0, 10) : ro.week; ro.updatedAt = new Date().toISOString();
    writeJ(f, ro);
  }

  const todayLocal = () => new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10); // Ciudad Juárez / Chihuahua, UTC-7 all year
  const nowLocalMin = () => { const d = new Date(Date.now() - 7 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

  /* ---------- views ---------- */
  function liveState(pl) {
    const today = todayLocal(), emp = employees(pl).people;
    const recent = punchesBetween(pl, A.addDays(today, -6), today);
    const shifts = shiftsOf(pl);
    const lastByEmp = {};
    for (const p of recent) lastByEmp[p.emp] = p;
    // who is in right now: their latest session today/yesterday has an entry and no exit
    const inside = [];
    const byEmp = {}; for (const p of punchesBetween(pl, A.addDays(today, -1), today)) (byEmp[p.emp] = byEmp[p.emp] || []).push(mins(p.ts));
    const nowAbs = Math.floor((Date.now() - 7 * 3600e3) / 60000);
    for (const [id, times] of Object.entries(byEmp)) {
      const ses = sessionsOf(times, shifts), last = ses[ses.length - 1];
      if (last && last.in != null && last.out == null && nowAbs - last.in < 16 * 60) inside.push({ id, name: (emp[id] || {}).name || `EMPLEADO ${id}`, since: new Date(last.in * 60000).toISOString().slice(11, 16), shift: last.shift && last.shift.name });
    }
    const days = {}; for (let i = 6; i >= 0; i--) days[A.addDays(today, -i)] = { punches: 0, people: new Set() };
    for (const p of recent) { const d = days[p.ts.slice(0, 10)]; if (d) { d.punches++; d.people.add(p.emp); } }
    return {
      today, employees: Object.keys(emp).length, employeesFile: employees(pl).file || null, employeesAt: employees(pl).updatedAt,
      unknown: [...new Set(recent.map(p => p.emp).filter(id => !emp[id]))],
      stations: stations().stations.filter(s => s.plant === pl).map(publicStation),
      inside: inside.sort((a, b) => a.name.localeCompare(b.name)),
      todayPunches: recent.filter(p => p.ts.startsWith(today)).reverse().slice(0, 300).map(p => ({ emp: p.emp, name: (emp[p.emp] || {}).name || '', time: p.ts.slice(11, 16), src: p.src, by: p.by })),
      days: Object.entries(days).map(([ymd, d]) => ({ ymd, punches: d.punches, people: d.people.size })),
      shifts: shifts.map(s => ({ name: s.name, start: s.startT, end: s.endT, limit: s.limit })),
    };
  }

  /* ---------- HTTP ---------- */
  /** Public: the on-site program authenticates with its station token. */
  function publicRoutes(app) {
    app.post('/api/checador/sync', (req, res) => {
      const auth = String(req.get('authorization') || ''), token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const found = stationByToken(token);
      if (!found) return res.status(401).json({ error: 'Estación no autorizada. Genera un código nuevo en gpoave.com → Asistencia.' });
      const { st, s } = found, b = req.body || {};
      const list = Array.isArray(b.punches) ? b.punches.slice(0, 5000) : [];
      let r = { accepted: [], fresh: 0, weeks: [] };
      try {
        r = storePunches(s.plant, list, s.id);
        for (const mon of r.weeks) rebuildWeek(s.plant, mon);
        if (r.weeks.length) rebuildRoster(s.plant);
      } catch (e) { console.error('checador sync', e); return res.status(500).json({ error: 'No se pudieron guardar las checadas. Se reintenta en la próxima sincronización.' }); }
      const info = b.station || {};
      s.lastSync = new Date().toISOString(); s.lastIp = req.ip; s.version = String(info.version || '').slice(0, 20);
      s.info = { device: info.device ? { kind: String(info.device.kind || '').slice(0, 20), ok: !!info.device.ok, ip: String(info.device.ip || '').slice(0, 40), serial: String(info.device.serial || '').slice(0, 40), lastRead: info.device.lastRead || null, error: info.device.error ? String(info.device.error).slice(0, 200) : null } : null,
        clock: info.clock || null, hostname: String(info.hostname || '').slice(0, 60), offlineSince: info.offlineSince || null };
      s.pending = Math.max(0, (+info.pending || 0) - r.accepted.length); s.totalSent = (s.totalSent || 0) + r.fresh;
      writeJ(stationsFile, st);
      const emp = employees(s.plant);
      res.json({ ok: true, accepted: r.accepted, fresh: r.fresh, plant: { id: s.plant, name: A.PLANTS[s.plant].name }, station: { id: s.id, name: s.name },
        employees: Object.values(emp.people).map(e => ({ id: e.id, name: e.name })), employeesAt: emp.updatedAt,
        shifts: shiftsOf(s.plant).map(x => ({ name: x.name, start: x.startT, end: x.endT })), serverTime: new Date().toISOString(), syncEveryMin: 60 });
    });
  }

  /** Admin (behind the login). */
  function adminRoutes(app, { who }) {
    const plantQ = req => { const p = String((req.query && req.query.planta) || (req.body && req.body.planta) || ''); if (!LOCAL().includes(p)) throw Object.assign(new Error('Esa planta no usa checador en sitio.'), { status: 400 }); return p; };
    const J = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Ocurrió un error.' }); if (!e.status) console.error(e); } };
    app.get('/api/checador/state', J(req => liveState(plantQ(req))));
    app.post('/api/checador/stations', J(req => createStation(plantQ(req), (req.body || {}).name, who(req))));
    app.delete('/api/checador/stations/:id', J(req => { revokeStation(req.params.id, who(req)); return { ok: true }; }));
    const multer = require('multer');
    const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }).single('file');
    app.post('/api/checador/employees', (req, res) => up(req, res, async err => {
      if (err || !req.file) return res.status(400).json({ error: 'No se pudo recibir el archivo.' });
      if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Sube un Excel (.xlsx).' });
      const tmp = path.join(require('os').tmpdir(), 'emp-' + crypto.randomBytes(6).toString('hex') + '.xlsx');
      try { const pl = plantQ(req); fs.writeFileSync(tmp, req.file.buffer); res.json(await importEmployees(pl, tmp, req.file.originalname, who(req))); }
      catch (e) { res.status(e.status || 400).json({ error: e.message }); }
      finally { fs.rmSync(tmp, { force: true }); }
    }));
    app.get('/api/checador/programa.zip', (req, res) => {
      const v = require('./station/package.json').version;
      res.set('Content-Type', 'application/zip').set('Content-Disposition', `attachment; filename="AVE-Checador-${v}.zip"`).send(programZip());
    });
    app.get('/api/checador/punches.csv', (req, res) => {
      let pl; try { pl = plantQ(req); } catch (e) { return res.status(400).json({ error: e.message }); }
      const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
      const to = ok(req.query.hasta) ? req.query.hasta : todayLocal(), from = ok(req.query.desde) ? req.query.desde : A.addDays(to, -13);
      const emp = employees(pl).people, st = Object.fromEntries(stations().stations.map(s => [s.id, s.name]));
      const rows = [['ID', 'Nombre', 'Fecha', 'Hora', 'Origen', 'Capturó', 'Estación'], ...punchesBetween(pl, from, to).map(p => [p.emp, (emp[p.emp] || {}).name || '', p.ts.slice(0, 10), p.ts.slice(11, 16), { face: 'Rostro', manual: 'Manual', import: 'Archivo', finger: 'Huella', card: 'Tarjeta' }[p.src] || p.src, p.by || '', st[p.station] || ''])];
      res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="checadas_${pl}_${from}_${to}.csv"`);
      res.send('﻿' + rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\r\n'));
    });
  }

  /** The on-site program as a ZIP (the station/ folder of this repo), so the latest version is always here. */
  function programZip() {
    const zlib = require('zlib'), dirRoot = path.join(__dirname, 'station'), files = [];
    const walk = (d, rel) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name === 'datos' || f.name.startsWith('.')) continue; const full = path.join(d, f.name), r = rel ? rel + '/' + f.name : f.name; f.isDirectory() ? walk(full, r) : files.push([r, full]); } };
    walk(dirRoot, '');
    const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return b => { let c = -1; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }; })();
    const parts = [], central = []; let off = 0;
    const d = new Date(), dt = ((d.getFullYear() - 1980) << 25) | ((d.getMonth() + 1) << 21) | (d.getDate() << 16) | (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    for (const [rel, full] of files) {
      const raw = fs.readFileSync(full), comp = zlib.deflateRawSync(raw), name = Buffer.from('AVE-Checador/' + rel, 'utf8'), crc = CRC(raw);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(dt >>> 0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
      parts.push(lh, name, comp);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(dt >>> 0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
      central.push(ch, name); off += 30 + name.length + comp.length;
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat([...parts, cd, end]);
  }

  /** Make sure a week's data is current (Asistencia calls this before a review). */
  const ensureWeek = (pl, monday) => { const r = rebuildWeek(pl, monday); rebuildRoster(pl); return r; };

  return { publicRoutes, adminRoutes, ensureWeek, rebuildWeek, rebuildRoster, sessionsOf, shiftsOf, storePunches, importEmployees, liveState, isLocal: pl => LOCAL().includes(pl) };
};

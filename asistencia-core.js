'use strict';
/* ASISTENTE ASISTENCIA — pure logic: read the CHECADOR INTERNO export, build weeks, and compare the
   handwritten sheet against it. The CHECADOR is the source of truth; the sheet only classifies absences
   (INC / VAC / PSS / FI) and is checked for inflated overtime. */
const { loadWorkbook, normName } = require('./meals-core');

const DAYS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab'];            // printed columns on the Monclova paper sheet
const DAYS7 = [...DAYS, 'dom'];
const DAY_LABEL = { lun: 'Lun', mar: 'Mar', mie: 'Mié', jue: 'Jue', vie: 'Vie', sab: 'Sáb', dom: 'Dom' };
const CODES = ['FI', 'INC', 'VAC', 'PSS'];
const JUSTIFIED = ['INC', 'VAC', 'PSS', 'PCS', 'MAT', 'DFD'];
const CODE_LABEL = { FI: 'Falta injustificada', INC: 'Incapacidad', VAC: 'Vacaciones', PSS: 'Permiso sin goce', PCS: 'Permiso con goce', MAT: 'Maternidad', DFD: 'Día festivo descansado',
  DFT: 'Día festivo trabajado', RET: 'Retardo / salida anticipada', BAJ: 'Baja', ALT: 'Alta' };

/* Plants. Monclova: paper sheet read from a photo. Jabil Chihuahua: INCIDENCIAS Excel. */
const PLANTS = {
  monclova: { id: 'monclova', name: 'Monclova', print: 'MONCLOVA', code: 'MVA', source: 'foto', sheetDays: DAYS, trackLate: false,
    // Allan, Nov 19 2026
    defaults: [{ re: /TURNO\s*2/i, start: '15:20', end: '23:30', limit: 45 }, { re: /TURNO\s*1/i, start: '06:00', end: '15:30', limit: 48 }] },
  'jabil-chih': { id: 'jabil-chih', name: 'Jabil Chihuahua', print: 'JABIL CHIHUAHUA', code: 'JCH', source: 'excel', sheetDays: DAYS7, trackLate: true,
    // Allan, Nov 19 2026
    defaults: [{ re: /TURNO\s*1\b/i, start: '06:00', end: '15:00', limit: 48 }, { re: /TURNO\s*2\b/i, start: '15:00', end: '23:00', limit: 45 }] },
};
const toM = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const spanH = (a, b) => Math.round(((b - a + (b <= a ? 1440 : 0)) / 60) * 100) / 100;
/** Weekly hours before overtime, by how much of the shift falls between 20:00 and 06:00 (day 48, mixed 45, night 42). */
function legalLimit(start, end) {
  const a = toM(start), b = toM(end); if (a == null || b == null) return 48;
  let night = 0; for (let m = a, n = 0; n < spanH(a, b) * 60; m = (m + 1) % 1440, n++) if (m >= 1200 || m < 360) night++;
  return night === 0 ? 48 : night <= 210 ? 45 : 42;
}
const horarioTimes = h => { const m = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(h || ''); return m ? [m[1].padStart(5, '0'), m[2].padStart(5, '0')] : null; };
/** Rules for one turno: saved settings win, then the plant defaults, then the CHECADOR's own schedule. */
function ruleFor(plant, settings, turno, horario) {
  const P = PLANTS[plant] || PLANTS.monclova;
  const saved = ((settings || {}).turnos || {})[turno] || {};
  const dflt = P.defaults.find(d => d.re.test(turno || '')) || {};
  const ht = horarioTimes(horario) || [];
  const start = saved.start || dflt.start || ht[0] || null, end = saved.end || dflt.end || ht[1] || null;
  const limit = +saved.limit || dflt.limit || legalLimit(start, end);
  return { start, end, hours: start && end ? spanH(toM(start), toM(end)) : null, limit };
}
// Monclova helpers kept for the printed sheet
const SHIFTS = PLANTS.monclova.defaults.map(d => ({ ...d, label: /2/.test(d.re.source) ? 'Turno 2' : 'Turno 1', hours: spanH(toM(d.start), toM(d.end)) }));
const LIMITS = SHIFTS.map(x => ({ re: x.re, limit: x.limit, label: x.label }));
const shiftFor = turno => SHIFTS.find(x => x.re.test(turno || '')) || null;
const limitFor = turno => (LIMITS.find(l => l.re.test(turno || '')) || { limit: 48 }).limit;

const pad = n => String(n).padStart(2, '0');
const ymdUTC = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymdUTC(d); };
const mondayOf = ymd => { const d = new Date(ymd + 'T12:00:00Z'); const w = (d.getUTCDay() + 6) % 7; return addDays(ymd, -w); };
const dowKey = ymd => ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'][new Date(ymd + 'T12:00:00Z').getUTCDay()];
const weekDates = monday => DAYS.map((k, i) => ({ key: k, ymd: addDays(monday, i) }));
const ddmm = ymd => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const r1 = n => Math.round(n * 10) / 10;

function txt(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') { if (v.richText) return v.richText.map(t => t.text).join(''); if (v.text != null) return String(v.text); if (v.result != null) return String(v.result); }
  return String(v).trim();
}
function toYMD(v) {
  if (v instanceof Date) return ymdUTC(v);
  const s = txt(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return '';
}
function toMin(v) {
  if (v instanceof Date) return v.getUTCHours() * 60 + v.getUTCMinutes();
  const m = /^(\d{1,2}):(\d{2})/.exec(txt(v));
  return m ? +m[1] * 60 + +m[2] : null;
}
const hhmm = m => m == null ? '' : `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/** Reads a CHECADOR INTERNO export (.xlsx). Returns people (duplicates by name merged) with their days. */
async function readChecador(file) {
  const wb = await loadWorkbook(file);
  for (const ws of wb.worksheets) {
    let hdr = null, col = {};
    for (let r = 1; r <= Math.min(ws.rowCount, 15) && !hdr; r++) {
      const map = {};
      ws.getRow(r).eachCell({ includeEmpty: false }, (c, n) => { map[normName(txt(c.value))] = n; });
      if (map['ID DE EMPLEADO'] && map['FECHA'] && map['NOMBRE']) { hdr = r; col = map; }
    }
    if (!hdr) continue;
    const get = (row, name) => col[normName(name)] ? row.getCell(col[normName(name)]).value : null;
    const people = {};
    for (let r = hdr + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const id = txt(get(row, 'ID de Empleado')).replace(/\.0$/, '');
      const ymd = toYMD(get(row, 'Fecha'));
      if (!id || !ymd) continue;
      const name = `${txt(get(row, 'Nombre'))} ${txt(get(row, 'Apellido'))}`.replace(/\s+/g, ' ').trim().toUpperCase();
      const p = people[id] || (people[id] = { id, name, turno: txt(get(row, 'Departamento')), cargo: txt(get(row, 'Cargo')), horario: '', days: {} });
      const horario = txt(get(row, 'Horario'));
      const rest = /descanso/i.test(txt(get(row, 'Excepción'))) || /descanso/i.test(horario);
      if (!rest && horario) p.horario = horario;
      const s = toMin(get(row, 'Hora de Entrada')), e = toMin(get(row, 'Hora de Salida'));
      let sched = !rest && s != null && e != null ? (e - s + (e <= s ? 1440 : 0)) / 60 : null;
      const dur = parseFloat(txt(get(row, 'Duración Trabajo')));
      if (!rest && Number.isFinite(dur) && dur > 0) sched = dur;
      p.days[ymd] = { rest, in: toMin(get(row, 'Entrada')), out: toMin(get(row, 'Salida')), sched, start: rest ? null : s, end: rest ? null : e };
    }
    const list = Object.values(people);
    if (!list.length) continue;
    return { people: mergeDuplicates(list), raw: list.length };
  }
  throw new Error('Este Excel no parece ser del checador (no encontré las columnas "ID de Empleado", "Nombre" y "Fecha").');
}

const punches = p => Object.values(p.days).reduce((a, d) => a + (d.in != null) + (d.out != null), 0);
/** Same full name under two IDs = one person (Allan confirmed 66 / 1066). Keeps the ID with more punches. */
function mergeDuplicates(list) {
  const groups = {};
  for (const p of list) (groups[normName(p.name)] = groups[normName(p.name)] || []).push(p);
  return Object.values(groups).map(g => {
    if (g.length === 1) return { ...g[0], ids: [g[0].id] };
    g.sort((a, b) => punches(b) - punches(a) || a.id.length - b.id.length || a.id.localeCompare(b.id));
    const main = { ...g[0], ids: g.map(x => x.id), days: {} };
    const dates = new Set(g.flatMap(x => Object.keys(x.days)));
    for (const ymd of dates) {
      const ds = g.map(x => x.days[ymd]).filter(Boolean), base = g[0].days[ymd] || ds[0];
      const ins = ds.map(d => d.in).filter(v => v != null), outs = ds.map(d => d.out).filter(v => v != null);
      main.days[ymd] = { ...base, in: ins.length ? Math.min(...ins) : null, out: outs.length ? Math.max(...outs) : null };
    }
    return main;
  });
}

/** What the clock says about one day. */
function dayFromClock(d) {
  if (!d) return { status: 'sin-dato', hours: 0, extra: 0 };
  const base = { in: hhmm(d.in), out: hhmm(d.out), rest: d.rest };
  if (d.in != null && d.out != null) {
    let span = d.out - d.in; if (span < 0) span += 1440;
    if (span < 20) return { ...base, status: 'incompleto', hours: d.rest ? 0 : (d.sched || 0), extra: 0, note: 'Entrada y salida casi iguales' };
    // 16+ hours between punches is almost always a missed punch the clock paired wrongly (e.g. 00:02–23:53)
    if (span > 16 * 60) return { ...base, status: 'incompleto', hours: d.rest ? 0 : (d.sched || 0), extra: 0, note: `Registro de ${r1(span / 60)} h seguidas, probablemente falta una checada` };
    const hours = r1(span / 60);
    const extra = d.rest ? hours : Math.max(0, r1(hours - (d.sched || 0)));
    return { ...base, status: d.rest ? 'descanso-trabajado' : 'trabajo', hours, extra: extra >= 0.25 ? extra : 0 };
  }
  if (d.in != null || d.out != null) return { ...base, status: 'incompleto', hours: d.rest ? 0 : (d.sched || 0), extra: 0, note: d.in != null ? 'Solo hay entrada' : 'Solo hay salida' };
  return { ...base, status: d.rest ? 'descanso' : 'falta', hours: 0, extra: 0 };
}

/** Splits a CHECADOR read into weeks (Monday → people with that week's days). */
function splitWeeks(people) {
  const weeks = {};
  for (const p of people) for (const [ymd, d] of Object.entries(p.days)) {
    const mon = mondayOf(ymd);
    const w = weeks[mon] || (weeks[mon] = {});
    const q = w[p.id] || (w[p.id] = { id: p.id, ids: p.ids, name: p.name, turno: p.turno, horario: p.horario, days: {} });
    q.days[ymd] = d;
  }
  return weeks;
}

/** Rest weekdays per person, from the most recent week we have. */
function restPattern(person) {
  const out = new Set();
  for (const [ymd, d] of Object.entries(person.days || {})) if (d.rest) out.add(dowKey(ymd));
  return [...out];
}

const turnoShort = t => { const m = /TURNO\s*(\d+)/i.exec(t || ''); return m ? 'T' + m[1] : (t || 'SIN TURNO').replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase(); };
/** Splits the roster into printed pages: one turno per sheet, balanced pages of up to `per` rows. */
function layoutSheets(roster, monday, { per = 18, plant = 'MONCLOVA', code = 'MVA' } = {}) {
  const byT = {};
  for (const p of roster) (byT[p.turno || 'SIN TURNO'] = byT[p.turno || 'SIN TURNO'] || []).push(p);
  const sheets = [];
  for (const turno of Object.keys(byT).sort()) {
    const lst = byT[turno].sort((a, b) => (+a.id || 1e12) - (+b.id || 1e12) || a.id.localeCompare(b.id));
    const n = Math.max(1, Math.ceil(lst.length / per)), size = Math.ceil(lst.length / n);
    for (let i = 0; i < n; i++) {
      const rows = lst.slice(i * size, (i + 1) * size);
      sheets.push({ code: `${code}-${turnoShort(turno)}-${monday.replace(/-/g, '').slice(2)}-${i + 1}/${n}`, plant, turno, page: i + 1, pages: n, monday,
        rows: rows.map(p => ({ id: p.id, ids: p.ids || [p.id], name: p.name, rest: p.rest || [] })), blanks: i === n - 1 ? Math.min(3, per + 2 - rows.length) : 0 });
    }
  }
  return sheets;
}

/* ---------- INCIDENCIAS (Jabil Chihuahua) ---------- */
/** Reads the INCIDENCIAS workbook: one sheet per payroll week, a row per employee, a code per day. */
async function readIncidencias(file) {
  const wb = await loadWorkbook(file);
  const weeks = {};
  for (const ws of wb.worksheets) {
    let hdr = null, map = {}, dateCols = [];
    for (let r = 1; r <= Math.min(ws.rowCount, 20) && !hdr; r++) {
      const m = {}, dc = [];
      ws.getRow(r).eachCell({ includeEmpty: false }, (c, n) => { let v = c.value; if (v && typeof v === 'object' && !(v instanceof Date) && 'result' in v) v = v.result; if (v instanceof Date) dc.push([n, ymdUTC(v)]); else m[normName(txt(v))] = n; });
      const idCol = Object.keys(m).find(k => /^C(O|Ó)DIGO( DE)? EMPLEADO$/.test(k) || k === 'CODIGO EMPLEADO');
      if (idCol && dc.length >= 5) { hdr = r; map = m; map._id = m[idCol]; dateCols = dc; }
    }
    if (!hdr) continue;
    const monday = mondayOf(dateCols[0][1]);
    const puesto = map['PUESTO'], dept = map['DEPARTAMENTO'];
    const nameCol = map['NOMBRE'] || (puesto ? puesto + 1 : null);
    const comCol = Object.keys(map).find(k => k.startsWith('COMENTARIO'));
    const rows = [];
    for (let r = hdr + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const id = txt(row.getCell(map._id).value).replace(/\.0$/, '');
      if (!/^\d+$/.test(id)) continue;
      const days = {};
      for (const [c, ymd] of dateCols) {
        const raw = txt(row.getCell(c).value).toUpperCase().replace(/\s+/g, '');
        const k = dowKey(ymd); if (mondayOf(ymd) !== monday) continue;
        let clave = raw, te = null;
        const he = /^HE(\d+(?:\.\d+)?)$/.exec(raw); if (he) { clave = ''; te = +he[1]; }
        else if (/^\d+(\.\d+)?$/.test(raw)) { clave = ''; te = +raw; }
        days[k] = { clave, te };
      }
      rows.push({ key: `${monday}:${id}`, id, name: txt(nameCol && row.getCell(nameCol).value).replace(/\s+/g, ' ').toUpperCase(), puesto: txt(puesto && row.getCell(puesto).value),
        dept: txt(dept && row.getCell(dept).value), days, uncertain: [], note: comCol ? txt(row.getCell(map[comCol]).value) : '' });
    }
    if (rows.length) weeks[monday] = { monday, sheet: ws.name, title: txt(ws.getRow(2).getCell(1).value) || ws.name, rows };
  }
  if (!Object.keys(weeks).length) throw new Error('No encontré semanas en este Excel (busco la columna "CÓDIGO EMPLEADO" y las fechas de cada día).');
  return weeks;
}

/* ---------- comparing the sheet against the clock ---------- */
const tokens = s => normName(s).split(' ').filter(w => w.length > 1);
function nameScore(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return 0;
  if (A.join(' ') === B.join(' ')) return 1;
  const hit = A.filter(w => B.some(x => x === w || (w.length > 3 && x.length > 3 && (x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4)))))).length;
  return hit / Math.max(A.length, B.length);
}
function normClave(c) {
  const s = normName(c || '').replace(/ /g, '');
  if (!s) return '';
  if (['FI', 'INC', 'VAC', 'PSS', 'PCS', 'MAT', 'DFD', 'DFT', 'RET', 'BAJ', 'ALT'].includes(s)) return s;
  if (s === 'FINJ' || /^F(I|1|L)?$|FALTA/.test(s)) return 'FI';
  if (s === 'VACR' || /^VAC/.test(s)) return 'VAC';
  if (/^IN[CG]|INCAP/.test(s)) return 'INC';
  if (/^P[S5]{1,2}$|PERM/.test(s)) return 'PSS';
  if (/^BAJA?$/.test(s)) return 'BAJ';
  if (/^ALTA?$/.test(s)) return 'ALT';
  return 'OTRO:' + String(c).trim().slice(0, 12);
}
const numTE = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && n > 0 && n < 24 ? r1(n) : 0; };
const diffMin = (a, b) => { let d = a - b; if (d > 720) d -= 1440; if (d < -720) d += 1440; return d; };

/**
 * sheetRows: [{ key, id, name, days: { lun: { clave, te }, … }, uncertain: [dayKeys], note, sheet }]
 * week: { personId: { id, ids, name, turno, horario, days: { ymd: clockDay } } } for that Monday.
 * opts: { plant, settings, turnosRead, sheetLabel }. Turnos with no sheet read are left out.
 */
function compare(sheetRows, week, monday, { turnosRead, plant = 'monclova', settings = null, sheetLabel = 'la hoja' } = {}) {
  const P = PLANTS[plant] || PLANTS.monclova, H = sheetLabel;
  const tol = settings && Number.isFinite(+settings.tolMin) ? +settings.tolMin : 15;
  const people = Object.values(week || {});
  const byId = {};
  for (const p of people) for (const id of p.ids || [p.id]) byId[String(id)] = p;
  const used = new Map();
  const extraRows = [];
  for (const r of sheetRows) {
    let p = r.id && byId[String(r.id).replace(/^0+(?=\d)/, '')];
    let how = p ? 'id' : '';
    if (p && r.name && nameScore(r.name, p.name) < 0.34) how = 'id-nombre-distinto';
    if (!p && r.name) {
      const best = people.map(x => [x, nameScore(r.name, x.name)]).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 0.6 && !used.has(best[0].id)) { p = best[0]; how = 'nombre'; }
    }
    if (p && used.has(p.id)) { extraRows.push({ ...r, why: 'duplicado' }); continue; }
    if (p) used.set(p.id, { ...r, how }); else extraRows.push({ ...r, why: 'no-checador' });
  }
  const turnos = new Set(turnosRead || sheetRows.map(r => r.turno).filter(Boolean));
  const allDates = DAYS7.map((key, i) => ({ key, ymd: addDays(monday, i) }));
  const results = [], notices = [];
  // If most of a turno leaves early by a similar amount, the schedule is probably wrong, not the people.
  const schedOff = new Set();
  if (P.trackLate) {
    const byT = {};
    for (const p of people) {
      const rule = ruleFor(plant, settings, p.turno, p.horario), e0 = toM(rule.end);
      if (e0 == null) continue;
      for (const d of Object.values(p.days)) if (!d.rest && d.in != null && d.out != null) {
        const span = (d.out - d.in + 1440) % 1440; if (span < 20 || span > 960) continue;
        const t = byT[p.turno] || (byT[p.turno] = { end: rule.end, n: 0, early: [] }); t.n++;
        const e = diffMin(e0, d.out); if (e > tol) t.early.push(d.out);
      }
    }
    for (const [t, v] of Object.entries(byT)) if (v.n >= 10 && v.early.length / v.n >= 0.5) {
      const outs = v.early.slice().sort((a, b) => a - b), med = outs[Math.floor(outs.length / 2)];
      schedOff.add(t);
      notices.push({ turno: t, msg: `${t}: en ${v.early.length} de ${v.n} jornadas salieron antes de las ${v.end} (salida típica ${hhmm(med)}). Parece que el horario real termina antes; ajústalo en "Turnos y límites". Mientras tanto, las salidas anticipadas de este turno no se marcan como RET.` });
    }
  }
  for (const p of people) {
    const row = used.get(p.id) || null;
    if (!row && turnos.size && !turnos.has(p.turno)) continue;
    const rule = ruleFor(plant, settings, p.turno, p.horario), limit = rule.limit;
    const flags = [], days = [];
    let hours = 0, teSheet = 0;
    const count = { A: 0, FI: 0, INC: 0, VAC: 0, PSS: 0, PCS: 0, MAT: 0, DFD: 0, D: 0, DT: 0, INCOMP: 0, BAJ: 0, RET: 0 };
    for (const { key, ymd } of allDates) {
      const raw = p.days[ymd];
      const clock = dayFromClock(raw && !raw.rest && rule.hours ? { ...raw, sched: rule.hours } : raw);
      const onSheet = P.sheetDays.includes(key);
      const sd = onSheet && row && row.days ? row.days[key] || {} : {};
      let clave = normClave(sd.clave); const te = numTE(sd.te);
      if (clave === 'ALT' || clave === 'DFT') clave = '';
      const unc = !!(row && (row.uncertain || []).includes(key));
      teSheet += te; hours += clock.hours || 0;
      let final; const f = [];
      const st = clock.status, span = `${clock.in}–${clock.out}`;
      // lateness / early exit (Jabil reports both as RET)
      let late = 0, early = 0;
      if (P.trackLate && raw && !raw.rest && (st === 'trabajo' || st === 'incompleto')) {
        const s0 = toM(rule.start) ?? raw.start, e0 = toM(rule.end) ?? raw.end;
        if (raw.in != null && s0 != null) late = Math.max(0, diffMin(raw.in, s0));
        if (raw.out != null && e0 != null && st === 'trabajo') early = Math.max(0, diffMin(e0, raw.out));
      }
      if (st === 'trabajo' || st === 'descanso-trabajado') {
        final = st === 'trabajo' ? 'A' : 'DT';
        if (clave === 'FI' || JUSTIFIED.includes(clave)) f.push(['warn', `${H} dice ${clave}, pero el checador registró ${span}. Gana el checador.`]);
        if (clave === 'BAJ') f.push(['bad', `${H} lo reporta como BAJA, pero el checador registró ${span}.`]);
        if (st === 'descanso-trabajado' && row && !te && !P.trackLate) f.push(['info', `Trabajó en su día de descanso (${clock.hours} h) y ${H} no anota TE.`]);
      } else if (st === 'incompleto') {
        final = 'INCOMP';
        const what = `${clock.note.charAt(0).toLowerCase() + clock.note.slice(1)} (${[clock.in, clock.out].filter(Boolean).join('–')})`;
        f.push(['warn', clock.rest ? `Checador incompleto en su día de descanso: ${what}. No se contaron horas; revisa.` : `Checador incompleto: ${what}. Se contó la jornada normal (${clock.hours} h); revisa.`]);
      } else if (st === 'falta') {
        if (JUSTIFIED.includes(clave) || clave === 'BAJ') final = clave;
        else {
          final = 'FI';
          if (row && !clave) f.push(['bad', `${H} no reporta falta, pero el checador no tiene registro. Se cuenta como FI.`]);
          if (clave === 'RET') f.push(['bad', `${H} dice RET, pero el checador no tiene registro ese día. Se cuenta como FI.`]);
        }
      } else if (st === 'descanso') {
        final = 'D';
        if (te) f.push(['bad', `${H} anota ${te} h de TE en su día de descanso, pero el checador no tiene registro.`]);
      } else final = '';
      if (P.trackLate && row && (final === 'A' || final === 'INCOMP')) {
        if (schedOff.has(p.turno)) early = 0;
        const bad = late > tol || early > tol;
        const why = [late > tol ? `entró ${late} min tarde (${clock.in}, turno ${rule.start})` : '', early > tol ? `salió ${early} min antes (${clock.out}, turno ${rule.end})` : ''].filter(Boolean).join(' y ');
        if (bad) count.RET++;
        if (bad && clave !== 'RET') f.push(['warn', `El checador marca que ${why} y ${H} no reporta RET.`]);
        if (!bad && clave === 'RET') f.push(['warn', `${H} reporta RET, pero en el checador llegó y salió a tiempo (${span}).`]);
      }
      if (te && (st === 'trabajo' || st === 'descanso-trabajado') && te > clock.extra + 0.5) f.push(['warn', `${H} anota ${te} h de TE; el checador da ${clock.extra} h ese día.`]);
      if (te && (st === 'falta' || st === 'incompleto')) f.push(['bad', `${H} anota ${te} h de TE en un día sin jornada completa en el checador.`]);
      if (clave.startsWith('OTRO')) f.push(['warn', `Clave no reconocida en ${H}: "${clave.slice(5)}".`]);
      if (unc) f.push(['warn', 'Lectura dudosa de la foto: confirma esta celda.']);
      if (final && final !== 'RET') count[final] = (count[final] || 0) + 1;
      for (const [lvl, msg] of f) flags.push({ lvl, day: key, ymd, msg });
      days.push({ key, ymd, clock: { ...clock, late, early }, sheet: row && onSheet ? { clave, te, uncertain: unc } : null, final, flags: f.map(x => x[0]) });
    }
    hours = r1(hours); teSheet = r1(teSheet);
    const teChk = Math.max(0, r1(hours - limit));
    if (!row) flags.unshift({ lvl: 'bad', msg: `No aparece en ${H}${P.source === 'foto' ? ' (o no se leyó su renglón)' : ''}.` });
    else {
      if (row.how === 'nombre') flags.unshift({ lvl: 'info', msg: `Se identificó por nombre ("${row.name}"), no por número.` });
      if (row.how === 'id-nombre-distinto') flags.unshift({ lvl: 'warn', msg: `El número ${row.id} coincide, pero el nombre en ${H} es "${row.name}".` });
    }
    if (teChk > 0) flags.unshift({ lvl: 'warn', msg: `Rebasa ${limit} h: ${hours} h trabajadas = ${teChk} h extra según el checador${teSheet ? ` (${H}: ${teSheet} h)` : ''}.` });
    if (row && teSheet > teChk + 0.5) flags.unshift({ lvl: 'bad', msg: `${H} reclama ${teSheet} h extra; el checador solo respalda ${teChk} h (${r1(teSheet - teChk)} h de más).` });
    const lvl = flags.some(f => f.lvl === 'bad') ? 'bad' : flags.some(f => f.lvl === 'warn') ? 'warn' : 'ok';
    results.push({ id: p.id, ids: p.ids || [p.id], name: p.name, turno: p.turno, limit, shift: rule, sheetRow: row ? { key: row.key, id: row.id, name: row.name, how: row.how, sheet: row.sheet, note: row.note } : null,
      days, totals: { hours, teChk, teSheet, teDiff: r1(teSheet - teChk), ...count }, flags, lvl });
  }
  results.sort((a, b) => a.turno.localeCompare(b.turno) || (+a.id || 1e12) - (+b.id || 1e12));
  const extras = extraRows.map(r => ({ key: r.key, id: r.id, name: r.name, sheet: r.sheet, why: r.why, codes: Object.values(r.days || {}).map(d => d.clave).filter(Boolean) }));
  const summary = {
    people: results.length, bad: results.filter(r => r.lvl === 'bad').length, warn: results.filter(r => r.lvl === 'warn').length,
    teChk: r1(results.reduce((a, r) => a + r.totals.teChk, 0)), teSheet: r1(results.reduce((a, r) => a + r.totals.teSheet, 0)),
    FI: results.reduce((a, r) => a + r.totals.FI, 0), INC: results.reduce((a, r) => a + r.totals.INC, 0), RET: results.reduce((a, r) => a + r.totals.RET, 0), extras: extras.length,
  };
  return { results, extras, summary, notices };
}

module.exports = { readChecador, readIncidencias, mergeDuplicates, dayFromClock, splitWeeks, restPattern, layoutSheets, compare, normClave, nameScore, ruleFor, legalLimit, horarioTimes,
  mondayOf, addDays, weekDates, dowKey, ddmm, DAYS, DAYS7, DAY_LABEL, CODES, CODE_LABEL, JUSTIFIED, PLANTS, LIMITS, limitFor, SHIFTS, shiftFor, turnoShort, hhmm };

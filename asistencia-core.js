'use strict';
/* ASISTENTE ASISTENCIA — pure logic: read the CHECADOR INTERNO export, build weeks, and compare the
   handwritten sheet against it. The CHECADOR is the source of truth; the sheet only classifies absences
   (INC / VAC / PSS / FI) and is checked for inflated overtime. */
const { loadWorkbook, normName } = require('./meals-core');

const DAYS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab'];            // printed columns (Sunday is not printed)
const DAY_LABEL = { lun: 'Lun', mar: 'Mar', mie: 'Mié', jue: 'Jue', vie: 'Vie', sab: 'Sáb', dom: 'Dom' };
const CODES = ['FI', 'INC', 'VAC', 'PSS'];
/* Weekly hours before time counts as overtime, by turno (Allan, Nov 2026) */
const LIMITS = [{ re: /TURNO\s*2/i, limit: 45, label: 'Turno 2' }, { re: /TURNO\s*1/i, limit: 48, label: 'Turno 1' }];
/* Shift times (Allan, Nov 19 2026). They override the CHECADOR's schedule for daily hours. */
const SHIFTS = [{ re: /TURNO\s*2/i, label: 'Turno 2', start: '15:20', end: '23:30' }, { re: /TURNO\s*1/i, label: 'Turno 1', start: '06:00', end: '15:30' }]
  .map(x => { const [a, b] = [x.start, x.end].map(t => +t.slice(0, 2) * 60 + +t.slice(3)); return { ...x, hours: Math.round(((b - a + (b <= a ? 1440 : 0)) / 60) * 100) / 100 }; });
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
      p.days[ymd] = { rest, in: toMin(get(row, 'Entrada')), out: toMin(get(row, 'Salida')), sched, start: rest ? null : s };
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
  if (CODES.includes(s)) return s;
  if (/^F(I|1|L)?$|FALTA/.test(s)) return 'FI';
  if (/^IN[CG]|INCAP/.test(s)) return 'INC';
  if (/^VAC/.test(s)) return 'VAC';
  if (/^P[S5]{1,2}$|PERM/.test(s)) return 'PSS';
  return 'OTRO:' + String(c).trim().slice(0, 12);
}
const numTE = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && n > 0 && n < 24 ? r1(n) : 0; };

/**
 * sheetRows: [{ key, id, name, days: { lun: { clave, te }, … }, uncertain: [dayKeys], note, sheet }]
 * week: { personId: { id, ids, name, turno, days: { ymd: clockDay } } } for that Monday.
 * Returns per-person results, flags and totals. Turnos with no sheet read are left out.
 */
function compare(sheetRows, week, monday, { turnosRead } = {}) {
  const people = Object.values(week || {});
  const byId = {};
  for (const p of people) for (const id of p.ids || [p.id]) byId[String(id)] = p;
  const used = new Map();   // person id -> sheet row
  const extraRows = [];
  for (const r of sheetRows) {
    let p = r.id && byId[String(r.id).replace(/^0+(?=\d)/, '')];
    let how = p ? 'id' : '';
    if (p && r.name && nameScore(r.name, p.name) < 0.34) { how = 'id-nombre-distinto'; }
    if (!p && r.name) {
      const best = people.map(x => [x, nameScore(r.name, x.name)]).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 0.6 && !used.has(best[0].id)) { p = best[0]; how = 'nombre'; }
    }
    if (p && used.has(p.id)) { extraRows.push({ ...r, why: 'duplicado' }); continue; }
    if (p) used.set(p.id, { ...r, how }); else extraRows.push({ ...r, why: 'no-checador' });
  }
  const turnos = new Set(turnosRead || sheetRows.map(r => r.turno).filter(Boolean));
  const dates = weekDates(monday);
  const results = [];
  for (const p of people) {
    const row = used.get(p.id) || null;
    if (!row && turnos.size && !turnos.has(p.turno)) continue;
    const limit = limitFor(p.turno);
    const flags = [];
    const days = [];
    let hours = 0, teSheet = 0;
    const count = { A: 0, FI: 0, INC: 0, VAC: 0, PSS: 0, D: 0, DT: 0, INCOMP: 0 };
    const allDates = [...dates, { key: 'dom', ymd: addDays(monday, 6) }];
    for (const { key, ymd } of allDates) {
      const raw = p.days[ymd], shift = shiftFor(p.turno);
      const clock = dayFromClock(raw && shift && !raw.rest ? { ...raw, sched: shift.hours } : raw);
      const sd = key !== 'dom' && row && row.days ? row.days[key] || {} : {};
      const clave = normClave(sd.clave), te = numTE(sd.te);
      const unc = !!(row && (row.uncertain || []).includes(key));
      teSheet += te;
      hours += clock.hours || 0;
      let final, f = [];
      const st = clock.status;
      if (st === 'trabajo') {
        final = 'A';
        if (clave && clave !== 'FI' && !clave.startsWith('OTRO')) f.push(['warn', `Hoja dice ${clave}, pero el checador registró ${clock.in}–${clock.out}. Gana el checador.`]);
        else if (clave === 'FI') f.push(['warn', `Hoja dice FI, pero el checador registró ${clock.in}–${clock.out}. Gana el checador.`]);
      } else if (st === 'descanso-trabajado') {
        final = 'DT';
        if (row && !te) f.push(['info', `Trabajó en su día de descanso (${clock.hours} h) y la hoja no anota TE.`]);
      } else if (st === 'incompleto') {
        final = 'INCOMP';
        const what = `${clock.note.charAt(0).toLowerCase() + clock.note.slice(1)} (${[clock.in, clock.out].filter(Boolean).join('–')})`;
        f.push(['warn', clock.rest ? `Checador incompleto en su día de descanso: ${what}. No se contaron horas; revisa.` : `Checador incompleto: ${what}. Se contó la jornada normal (${clock.hours} h); revisa.`]);
      } else if (st === 'falta') {
        if (['INC', 'VAC', 'PSS'].includes(clave)) final = clave;
        else {
          final = 'FI';
          if (row && !clave) f.push(['bad', 'Hoja dice que asistió, pero el checador no tiene registro. Se cuenta como FI.']);
        }
      } else if (st === 'descanso') {
        final = 'D';
        if (te) f.push(['bad', `Hoja anota ${te} h de TE en su día de descanso, pero el checador no tiene registro.`]);
      } else final = '';
      if (te && (st === 'trabajo' || st === 'descanso-trabajado') && te > clock.extra + 0.5) f.push(['warn', `Hoja anota ${te} h de TE; el checador da ${clock.extra} h ese día.`]);
      if (te && (st === 'falta' || st === 'incompleto')) f.push(['bad', `Hoja anota ${te} h de TE en un día sin jornada completa en el checador.`]);
      if (clave.startsWith('OTRO')) f.push(['warn', `Clave no reconocida en la hoja: "${clave.slice(5)}".`]);
      if (unc) f.push(['warn', 'Lectura dudosa de la foto: confirma esta celda.']);
      if (final) count[final] = (count[final] || 0) + 1;
      for (const [lvl, msg] of f) flags.push({ lvl, day: key, ymd, msg });
      days.push({ key, ymd, clock, sheet: row ? { clave, te, uncertain: unc } : null, final, flags: f.map(x => x[0]) });
    }
    hours = r1(hours); teSheet = r1(teSheet);
    const teChk = Math.max(0, r1(hours - limit));
    if (!row) flags.unshift({ lvl: 'bad', msg: 'No aparece en la hoja (o no se leyó su renglón).' });
    else {
      if (row.how === 'nombre') flags.unshift({ lvl: 'info', msg: `Se identificó por nombre ("${row.name}"), no por número.` });
      if (row.how === 'id-nombre-distinto') flags.unshift({ lvl: 'warn', msg: `El número ${row.id} coincide, pero el nombre en la hoja es "${row.name}".` });
    }
    if (teChk > 0) flags.unshift({ lvl: 'warn', msg: `Rebasa ${limit} h: ${hours} h trabajadas = ${teChk} h extra según el checador${teSheet ? ` (hoja: ${teSheet} h)` : ''}.` });
    if (row && teSheet > teChk + 0.5) flags.unshift({ lvl: 'bad', msg: `La hoja reclama ${teSheet} h extra; el checador solo respalda ${teChk} h (${r1(teSheet - teChk)} h de más).` });
    const lvl = flags.some(f => f.lvl === 'bad') ? 'bad' : flags.some(f => f.lvl === 'warn') ? 'warn' : 'ok';
    results.push({ id: p.id, ids: p.ids || [p.id], name: p.name, turno: p.turno, limit, sheetRow: row ? { key: row.key, id: row.id, name: row.name, how: row.how, sheet: row.sheet, note: row.note } : null,
      days, totals: { hours, teChk, teSheet, teDiff: r1(teSheet - teChk), ...count }, flags, lvl });
  }
  results.sort((a, b) => a.turno.localeCompare(b.turno) || (+a.id || 1e12) - (+b.id || 1e12));
  const extras = extraRows.map(r => ({ key: r.key, id: r.id, name: r.name, sheet: r.sheet, why: r.why }));
  const summary = {
    people: results.length, bad: results.filter(r => r.lvl === 'bad').length, warn: results.filter(r => r.lvl === 'warn').length,
    teChk: r1(results.reduce((a, r) => a + r.totals.teChk, 0)), teSheet: r1(results.reduce((a, r) => a + r.totals.teSheet, 0)),
    FI: results.reduce((a, r) => a + r.totals.FI, 0), INC: results.reduce((a, r) => a + r.totals.INC, 0), extras: extras.length,
  };
  return { results, extras, summary };
}

module.exports = { readChecador, mergeDuplicates, dayFromClock, splitWeeks, restPattern, layoutSheets, compare, normClave, nameScore,
  mondayOf, addDays, weekDates, dowKey, ddmm, DAYS, DAY_LABEL, CODES, LIMITS, limitFor, SHIFTS, shiftFor, turnoShort, hhmm };

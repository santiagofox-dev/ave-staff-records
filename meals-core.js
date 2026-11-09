'use strict';
/*
 * Comidas de Nuevos Ingresos — all deterministic logic (no AI).
 * Name matching, NO REGISTRADOS cross-reference, DELPHI update and the summary workbook.
 */
const ExcelJS = require('exceljs');

const MON = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BLUE = 'FFBDD7EE', YELLOW = 'FFFFF2CC';

/* ---------------- names ---------------- */
const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
function normName(s) {
  return strip(s).toUpperCase().replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const tokens = s => normName(s).split(' ').filter(Boolean);
// Indel (insert/delete) based similarity, same definition as rapidfuzz.fuzz.ratio
function lcs(a, b) {
  if (!a.length || !b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}
const ratio = (a, b) => (a.length + b.length ? (200 * lcs(a, b)) / (a.length + b.length) : 100);
const tokenSortRatio = (a, b) => ratio(tokens(a).sort().join(' '), tokens(b).sort().join(' '));
// Like rapidfuzz token_set_ratio: compare the shared tokens against each side's remainder
function tokenSetRatio(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  const inter = [...A].filter(t => B.has(t)).sort();
  const da = [...A].filter(t => !B.has(t)).sort(), db = [...B].filter(t => !A.has(t)).sort();
  const s = inter.join(' ');
  const s1 = [s, da.join(' ')].filter(Boolean).join(' '), s2 = [s, db.join(' ')].filter(Boolean).join(' ');
  return Math.max(ratio(s, s1), ratio(s, s2), ratio(s1, s2));
}
// Each sheet token paired with its closest official token; handles a missing middle name and typos
function tokenPairScore(sheet, official) {
  const S = tokens(sheet), O = tokens(official);
  if (S.length < 2 || !O.length) return 0;
  const used = new Set(); let sum = 0;
  for (const t of S) {
    let best = 0, bi = -1;
    O.forEach((o, i) => { if (used.has(i)) return; const r = ratio(t, o); if (r > best) { best = r; bi = i; } });
    if (bi >= 0) used.add(bi);
    sum += best;
  }
  const avg = sum / S.length;
  // penalise when the sheet name covers too little of the official one (e.g. 2 of 5 words)
  return S.length / O.length >= 0.5 ? avg : avg * 0.9;
}
// Words run together on the sheet ("ZAVALADE LOS SANTOS") compare equal once spaces go.
const compact = s => normName(s).replace(/ /g, '');
function score(sheetName, officialName) {
  if (normName(sheetName) === normName(officialName)) return 100;
  if (compact(sheetName) === compact(officialName)) return 99;
  return Math.max(tokenSortRatio(sheetName, officialName), tokenPairScore(sheetName, officialName), ratio(compact(sheetName), compact(officialName)) - 2);
}
const FUZZY_MIN = 88;
/** Best official match for a name on the sheet: {id, name, type, score, kind:'exact'|'fuzzy'|null, alternatives} */
function matchName(sheetName, roster) {
  const scored = roster.map(r => ({ ...r, score: score(sheetName, r.name) })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const alternatives = scored.slice(0, 5).map(r => ({ id: r.id, name: r.name, score: Math.round(r.score) }));
  if (best && best.score >= 99) return { id: best.id, name: best.name, type: best.type, score: 100, kind: 'exact', alternatives };
  if (best && best.score >= FUZZY_MIN && (!scored[1] || best.score - scored[1].score >= 2 || scored[1].score < FUZZY_MIN))
    return { id: best.id, name: best.name, type: best.type, score: Math.round(best.score), kind: 'fuzzy', alternatives };
  return { id: null, name: null, type: null, score: best ? Math.round(best.score) : 0, kind: null, alternatives };
}
/** IDs that don't share the batch's usual 5-digit prefix (e.g. 80118204 among 801825xx–801828xx). */
function unusualIds(ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (list.length < 4) return [];
  const pre = {}; list.forEach(id => { const p = id.slice(0, 5); pre[p] = (pre[p] || 0) + 1; });
  const common = Object.entries(pre).sort((a, b) => b[1] - a[1])[0][0];
  return list.filter(id => id.slice(0, 5) !== common || id.length !== list.filter(x => x.slice(0, 5) === common)[0].length);
}

/* ---------------- spreadsheet helpers ---------------- */
function cellVal(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.result !== undefined) return cellVal(v.result);
    if (v.text != null) return String(v.text);
    if (v.error) return '';
  }
  return v;
}
const txt = v => { const x = cellVal(v); return x instanceof Date ? x.toISOString() : String(x).trim(); };
function findHeader(ws, required) {
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const row = ws.getRow(r), map = {};
    row.eachCell({ includeEmpty: false }, (c, n) => { map[normName(txt(c.value))] = n; });
    if (required.every(h => Object.keys(map).some(k => k === normName(h) || k.includes(normName(h))))) {
      const col = h => { const k = Object.keys(map).find(x => x === normName(h)) || Object.keys(map).find(x => x.includes(normName(h))); return map[k]; };
      return { row: r, col };
    }
  }
  return null;
}
/** Excel time (fraction of a day, or a 1899-12-30 Date) → seconds since midnight */
function toSeconds(v) {
  v = cellVal(v);
  if (v instanceof Date) return v.getUTCHours() * 3600 + v.getUTCMinutes() * 60 + v.getUTCSeconds();
  if (typeof v === 'number') return Math.round((v % 1) * 86400);
  const m = String(v || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s*m\.?)?/i);
  if (!m) return null;
  let h = +m[1]; const pm = m[4] && /p/i.test(m[4]); if (m[4]) { if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return h * 3600 + +m[2] * 60 + (+m[3] || 0);
}
const hhmm = s => s == null ? '' : `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
/** A real calendar date {y,m,d} from a cell (Date, Excel serial, or dd/mm/yyyy text) */
function toYMD(v) {
  v = cellVal(v);
  if (v instanceof Date) return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate() };
  if (typeof v === 'number' && v > 20000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
  const s = String(v || '');
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); if (m) return { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], m: +m[2], d: +m[1] };
  return null;
}
/** "2-Nov", "2 nov", "02/11" … → {d, m} ; month by name (es/en) or number */
function parseDayLabel(label) {
  const s = strip(label).toLowerCase();
  let m = s.match(/(\d{1,2})\s*[-\/ .]?\s*([a-z]{3})/);
  if (m) { const i = MON.findIndex(x => x.toLowerCase() === m[2]); const j = MON_EN.findIndex(x => x.toLowerCase() === m[2]); const mo = (i >= 0 ? i : j) + 1; if (mo > 0) return { d: +m[1], m: mo }; }
  m = s.match(/(\d{1,2})[\/-](\d{1,2})/); if (m) return { d: +m[1], m: +m[2] };
  return null;
}
const dayKey = ({ d, m }) => `${d}-${MON[m - 1]}`;
// Map a handwritten column header to one of the report's day keys.
// Accepts "2-Nov", "2/11", "L 2", "LUN 2", "Lunes 2", "2", or just "LUNES".
const WD = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
function resolveDay(label, days, year) {
  const p = parseDayLabel(label); const k = p && dayKey(p);
  if (k && days.includes(k)) return k;
  const s = strip(label).toLowerCase();
  const num = s.match(/\b(\d{1,2})\b/);
  if (num) { const hits = days.filter(d => +d.split('-')[0] === +num[1]); if (hits.length === 1) return hits[0]; }
  const w = s.match(/\b(dom|lun|mar|mie|jue|vie|sab)[a-z]*/);
  if (w && !num) {
    const hits = days.filter(d => { const [dd, mm] = d.split('-'); const mo = MON.indexOf(mm); return mo >= 0 && WD[new Date(Date.UTC(year, mo, +dd)).getUTCDay()] === w[1]; });
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/* ---------------- input readers ---------------- */
async function loadWorkbook(file) { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file); return wb; }

async function readRoster(file) {
  const wb = await loadWorkbook(file);
  for (const ws of wb.worksheets) {
    const h = findHeader(ws, ['ID EMPLEADO', 'NOMBRE COMPLETO']);
    if (!h) continue;
    const cId = h.col('ID EMPLEADO'), cName = h.col('NOMBRE COMPLETO'), cType = h.col('TIPO EMPLEADO');
    const out = [];
    for (let r = h.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const id = txt(row.getCell(cId).value).replace(/\.0+$/, '').replace(/\D/g, '');
      const name = txt(row.getCell(cName).value).replace(/\s+/g, ' ');
      if (!id || !name) continue;
      out.push({ id, name, type: cType ? txt(row.getCell(cType).value) : '' });
    }
    return out;
  }
  throw new Error('No encontré las columnas "ID Empleado" y "Nombre Completo" en la lista de nuevos ingresos.');
}

async function readNoRegistrados(file) {
  const wb = await loadWorkbook(file);
  for (const ws of wb.worksheets) {
    const h = findHeader(ws, ['FECHA', 'HORA', 'CODIGO']);
    if (!h) continue;
    const c = { fecha: h.col('FECHA'), hora: h.col('HORA'), motivo: h.col('MOTIVO'), servicio: h.col('SERVICIO'), terminal: h.col('TERMINAL'), codigo: h.col('CODIGO') };
    const out = [];
    for (let r = h.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r), get = k => (c[k] ? row.getCell(c[k]).value : '');
      const fecha = toYMD(get('fecha'));
      if (!fecha && !txt(get('codigo'))) continue;
      out.push({ rowNum: r, fecha, hora: toSeconds(get('hora')), motivo: txt(get('motivo')), servicio: txt(get('servicio')), terminal: txt(get('terminal')),
        codigo: txt(get('codigo')).replace(/\.0+$/, '') });
    }
    return out;
  }
  throw new Error('No encontré las columnas Fecha, Hora y Código en el archivo NO REGISTRADOS.');
}

/* ---------------- DELPHI ---------------- */
const COLS = 11; // A..K
/**
 * Reads Hoja1 into blocks. FECHA is stored with day and month swapped (Nov 2 → 2026-02-11); we never rebuild it,
 * we keep the cell, and derive the real day only to know which block is which.
 */
function readDelphi(ws) {
  let hdr = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) if (normName(txt(ws.getRow(r).getCell(1).value)) === 'FECHA') { hdr = r; break; }
  if (!hdr) throw new Error('No encontré el encabezado FECHA en la hoja del reporte DELPHI.');
  const blocks = []; let cur = []; let neto = null;
  for (let r = hdr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const a = txt(row.getCell(1).value), j = normName(txt(row.getCell(10).value));
    if (normName(a) === 'SERVICIOS NETO') { neto = r; break; }
    if (j === 'TOTAL SEGMENTO') { blocks.push({ rows: cur, totalRow: r }); cur = []; continue; }
    if (!a && !txt(row.getCell(5).value) && !txt(row.getCell(6).value)) continue;
    cur.push(r);
  }
  if (neto == null) throw new Error('No encontré la fila SERVICIOS NETO en el reporte DELPHI.');
  for (const b of blocks) {
    const first = ws.getRow(b.rows[0]).getCell(1).value;
    const stored = cellVal(first);
    if (!(stored instanceof Date)) throw new Error('La columna FECHA del reporte DELPHI no contiene fechas.');
    b.stored = stored;
    b.real = { y: stored.getUTCFullYear(), m: stored.getUTCDate(), d: stored.getUTCMonth() + 1 }; // swapped
    b.key = dayKey(b.real);
    b.count = b.rows.length;
  }
  return { hdr, blocks, neto };
}

function snapshotRow(row) {
  const cells = [];
  for (let c = 1; c <= COLS; c++) { const cell = row.getCell(c); cells.push({ value: cell.value, style: JSON.parse(JSON.stringify(cell.style || {})) }); }
  return { cells, height: row.height };
}

/**
 * Adds meals to the DELPHI workbook (in place, returns stats). meals: [{dayKey, id, name, type, seconds|null}]
 * Scanned meals (with time) go in time order; handwritten ones (no time) go at the end of the block, sorted by name.
 * Existing rows are copied unchanged; only TOTAL SEGMENTO / SERVICIOS NETO values change.
 */
function updateDelphi(wb, meals) {
  const ws = wb.getWorksheet('Hoja1') || wb.worksheets[0];
  const { hdr, blocks, neto } = readDelphi(ws);
  const byKey = Object.fromEntries(blocks.map(b => [b.key, b]));
  const missing = [...new Set(meals.filter(m => !byKey[m.dayKey]).map(m => m.dayKey))];
  if (missing.length) throw new Error(`El reporte DELPHI no tiene los días: ${missing.join(', ')}.`);

  // Snapshot everything from the header down, then rewrite in the new order.
  const plan = [];
  const stats = [];
  for (const b of blocks) {
    const existing = b.rows.map(r => ({ kind: 'old', snap: snapshotRow(ws.getRow(r)), seconds: toSeconds(ws.getRow(r).getCell(4).value) }));
    const template = existing[existing.length - 1].snap;
    const add = meals.filter(m => m.dayKey === b.key);
    const timed = add.filter(m => m.seconds != null).sort((x, y) => x.seconds - y.seconds);
    const untimed = add.filter(m => m.seconds == null).sort((x, y) => x.name.localeCompare(y.name, 'es'));
    let list = existing.slice();
    for (const m of timed) { // after the last existing row with time ≤ the scan time
      let at = list.length;
      for (let i = 0; i < list.length; i++) if (list[i].seconds != null && list[i].seconds > m.seconds) { at = i; break; }
      list.splice(at, 0, { kind: 'new', meal: m, template, stored: b.stored, seconds: m.seconds });
    }
    for (const m of untimed) list.push({ kind: 'new', meal: m, template, stored: b.stored, seconds: null });
    plan.push(...list, { kind: 'total', snap: snapshotRow(ws.getRow(b.totalRow)), count: list.length, changed: add.length > 0 });
    stats.push({ day: b.key, original: b.count, added: add.length, updated: list.length });
  }
  const netoSnap = snapshotRow(ws.getRow(neto));
  const lastOld = neto;

  const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
  let r = hdr + 1;
  const timeCellType = (() => { // write times the same way the file stores them
    for (const b of blocks) for (const rr of b.rows) { const v = cellVal(ws.getRow(rr).getCell(4).value); if (v instanceof Date) return 'date'; if (typeof v === 'number') return 'number'; }
    return 'number';
  })();
  for (const p of plan) {
    const row = ws.getRow(r);
    if (p.kind === 'old' || p.kind === 'total') {
      p.snap.cells.forEach((c, i) => { const cell = row.getCell(i + 1); cell.value = c.value; cell.style = c.style; });
      if (p.snap.height) row.height = p.snap.height;
      if (p.kind === 'total') {
        const k = row.getCell(11); k.value = p.count;
        if (p.changed) k.fill = fill;
      }
    } else {
      const m = p.meal;
      const vals = [p.stored, 'APTIV', '01-SERVICIO', null, String(m.id), m.name, /TECNICO/i.test(strip(m.type || '')) ? 'TECNICO' : 'OPERADOR GENERAL', 'T01', '-', null, null];
      if (m.seconds != null) vals[3] = timeCellType === 'date' ? new Date(Date.UTC(1899, 11, 30) + m.seconds * 1000) : m.seconds / 86400;
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.style = JSON.parse(JSON.stringify(p.template.cells[i].style || {}));
        cell.value = v;
        if (i === 3) cell.numFmt = 'h:mm:ss';
        if (i === 4) cell.numFmt = '@';
        if (i === 0) cell.numFmt = p.template.cells[0].style.numFmt || 'mm-dd-yy';
        cell.font = { ...(cell.font || {}), name: 'Calibri', size: 11, bold: false };
        if (i < 9) cell.fill = fill;
      });
      if (p.template.height) row.height = p.template.height;
    }
    row.commit && row.commit();
    r++;
  }
  // SERVICIOS NETO
  const nrow = ws.getRow(r);
  netoSnap.cells.forEach((c, i) => { const cell = nrow.getCell(i + 1); cell.value = c.value; cell.style = c.style; });
  const total = stats.reduce((s, x) => s + x.updated, 0);
  nrow.getCell(4).value = total;
  if (meals.length) nrow.getCell(4).fill = fill;
  // clear anything left below (the sheet only grew, so this only matters if it didn't)
  for (let k = r + 1; k <= Math.max(lastOld, ws.rowCount); k++) { const row = ws.getRow(k); for (let c = 1; c <= COLS; c++) { row.getCell(c).value = null; row.getCell(c).style = {}; } }
  return { days: stats, netoOriginal: stats.reduce((s, x) => s + x.original, 0), neto: total };
}

/* ---------------- reconciliation ---------------- */
/**
 * review: [{source:'Foto 1', row, nameAsWritten, id|null, name|null, type, marks:{dayKey:bool}, notes, uncertain:[dayKey]}]
 * noReg: rows from readNoRegistrados; roster: official list; dayKeys: days present in DELPHI
 * → people (one per person), meals for DELPHI, cruce rows
 */
function reconcile(review, noReg, roster, dayKeys) {
  const byId = Object.fromEntries(roster.map(r => [r.id, r]));
  const people = new Map(); // key: id or 'SIN ID|name'
  const keyOf = x => (x.id ? x.id : `SIN ID|${normName(x.nameAsWritten)}`);
  for (const x of review) {
    const k = keyOf(x);
    if (!people.has(k)) people.set(k, { id: x.id || null, name: x.id ? (byId[x.id] || {}).name || x.name : '', type: x.id ? (byId[x.id] || {}).type || '' : '',
      written: new Set(), origins: [], days: {}, scans: {}, notes: [] });
    const p = people.get(k);
    p.written.add(x.nameAsWritten);
    p.origins.push(`${x.source} #${x.row}`);
    for (const d of dayKeys) if (x.marks && x.marks[d]) p.days[d] = 1; // at most one meal per person per day
    if (x.notes) p.notes.push(x.notes);
    if (x.uncertain && x.uncertain.length) p.notes.push(`Revisar ${x.uncertain.join(', ')} (${x.source} #${x.row})`);
    if (x.matchNote) p.notes.push(x.matchNote);
  }
  if ([...people.values()].some(p => p.origins.length > 1)) for (const p of people.values()) if (p.origins.length > 1) p.notes.push('Aparece más de una vez en las hojas (se cuenta 1 comida por día)');
  // NO REGISTRADOS
  const cruce = [];
  for (const s of noReg) {
    const code = String(s.codigo || '').replace(/\s/g, '');
    const hit = /^\d+$/.test(code) ? byId[code] : null;
    const real = s.fecha;
    let dk = real ? dayKey(real) : '';
    if (real && !dayKeys.includes(dk) && dayKeys.includes(dayKey({ d: real.m, m: real.d }))) dk = dayKey({ d: real.m, m: real.d });
    const row = { ...s, enLista: !!hit, nombre: hit ? hit.name : '', dayKey: dk, accion: 'No aplica' };
    if (hit) {
      if (!dayKeys.includes(dk)) row.accion = 'Fecha fuera del reporte';
      else {
        if (!people.has(hit.id)) people.set(hit.id, { id: hit.id, name: hit.name, type: hit.type, written: new Set(), origins: [], days: {}, scans: {}, notes: [] });
        const p = people.get(hit.id);
        if (p.days[dk]) row.accion = 'Ya marcado en la hoja (no se duplica)';
        else { p.days[dk] = 1; p.scans[dk] = s.hora; p.origins.push(`NO REGISTRADOS ${hhmm(s.hora)}`); row.accion = 'Agregado a DELPHI'; }
      }
    }
    cruce.push(row);
  }
  const list = [...people.values()].map(p => ({ ...p, written: [...p.written].join(' / '), total: Object.values(p.days).reduce((a, b) => a + b, 0) }));
  const meals = [];
  for (const p of list) if (p.id) for (const d of dayKeys) if (p.days[d]) meals.push({ dayKey: d, id: p.id, name: p.name, type: p.type, seconds: p.scans[d] != null ? p.scans[d] : null });
  return { people: list, meals, cruce };
}

/* ---------------- summary workbook ---------------- */
async function buildSummary(file, { label, dayKeys, people, cruce, delphiStats, flags }) {
  const wb = new ExcelJS.Workbook();
  const font = { name: 'Arial', size: 10 }, bold = { name: 'Arial', size: 10, bold: true };
  const blue = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }, yellow = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
  const head = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  const L = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  const res = wb.addWorksheet('Resumen');
  const det = wb.addWorksheet('Detalle por empleado');
  const cru = wb.addWorksheet('Cruce NO REGISTRADOS');

  // Detalle
  const dHead = ['ID', 'Nombre lista oficial', 'Nombre como aparece en hoja', 'Origen', '# renglón', ...dayKeys, 'Total', 'Notas'];
  det.addRow(dHead).eachCell(c => { c.font = bold; c.fill = head; });
  const sorted = people.slice().sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || (a.name || a.written).localeCompare(b.name || b.written, 'es'));
  const first = 2;
  sorted.forEach((p, i) => {
    const r = first + i;
    const rowsNum = p.origins.map(o => (o.match(/#(\d+)/) || [])[1]).filter(Boolean).join(', ');
    const vals = [p.id || 'SIN ID', p.name || '', p.written || '', p.origins.join('; '), rowsNum, ...dayKeys.map(d => (p.days[d] ? 1 : null)),
      { formula: `SUM(${L(5)}${r}:${L(4 + dayKeys.length)}${r})` }, p.notes.join(' · ')];
    const row = det.addRow(vals);
    row.eachCell({ includeEmpty: true }, c => { c.font = font; if (p.notes.length) c.fill = yellow; });
    row.getCell(1).numFmt = '@';
  });
  const last = first + sorted.length - 1;
  det.views = [{ state: 'frozen', ySplit: 1 }];
  det.autoFilter = { from: 'A1', to: `${L(dHead.length - 1)}1` };
  det.columns.forEach((c, i) => { c.width = [12, 34, 34, 30, 10][i] || (i === dHead.length - 1 ? 60 : 9); });

  // Resumen
  const R = (r, c) => res.getRow(r).getCell(c);
  res.getCell('A1').value = `Resumen comidas nuevos ingresos ${label}`; res.getCell('A1').font = { name: 'Arial', size: 13, bold: true };
  const h1 = ['Día', 'Comidas totales', 'Con ID (agregadas a DELPHI)', 'Sin ID (no agregadas)', 'Empleados que comieron'];
  res.getRow(3).values = h1; res.getRow(3).eachCell(c => { c.font = bold; c.fill = head; });
  const idCol = `'Detalle por empleado'!$A$${first}:$A$${Math.max(last, first)}`;
  dayKeys.forEach((d, i) => {
    const r = 4 + i, col = L(5 + i), rng = `'Detalle por empleado'!$${col}$${first}:$${col}$${Math.max(last, first)}`;
    res.getRow(r).values = [d, { formula: `SUM(${rng})` }, { formula: `SUMIF(${idCol},"<>SIN ID",${rng})` }, { formula: `SUMIF(${idCol},"SIN ID",${rng})` }, { formula: `COUNTIF(${rng},">0")` }];
  });
  const tr = 4 + dayKeys.length, totCol = L(5 + dayKeys.length);
  res.getRow(tr).values = ['TOTAL', { formula: `SUM(B4:B${tr - 1})` }, { formula: `SUM(C4:C${tr - 1})` }, { formula: `SUM(D4:D${tr - 1})` },
    { formula: `COUNTIF('Detalle por empleado'!$${totCol}$${first}:$${totCol}$${Math.max(last, first)},">0")` }];
  res.getRow(tr).eachCell(c => { c.font = bold; });
  for (let r = 4; r < tr; r++) res.getRow(r).eachCell(c => { c.font = font; });
  res.getCell(`E${tr + 1}`).value = 'Empleados = personas distintas con al menos 1 comida (no la suma de los días).';
  res.getCell(`E${tr + 1}`).font = { name: 'Arial', size: 9, italic: true };

  const t2 = tr + 3;
  res.getRow(t2).values = ['Día', 'DELPHI original', 'Agregadas', 'DELPHI actualizado'];
  res.getRow(t2).eachCell(c => { c.font = bold; c.fill = head; });
  dayKeys.forEach((d, i) => {
    const r = t2 + 1 + i, st = delphiStats.days.find(x => x.day === d) || { original: 0 };
    res.getRow(r).values = [d, st.original, { formula: `C${4 + i}` }, { formula: `B${r}+C${r}` }];
    res.getRow(r).eachCell(c => { c.font = font; });
  });
  const nr = t2 + 1 + dayKeys.length;
  res.getRow(nr).values = ['SERVICIOS NETO', { formula: `SUM(B${t2 + 1}:B${nr - 1})` }, { formula: `SUM(C${t2 + 1}:C${nr - 1})` }, { formula: `SUM(D${t2 + 1}:D${nr - 1})` }];
  res.getRow(nr).eachCell(c => { c.font = bold; });

  let pr = nr + 3;
  res.getCell(`A${pr}`).value = 'Puntos a revisar'; res.getCell(`A${pr}`).font = { name: 'Arial', size: 12, bold: true };
  pr++;
  const points = flags.length ? flags : ['Sin observaciones.'];
  for (const f of points) { res.getCell(`A${pr}`).value = `• ${f}`; res.getCell(`A${pr}`).font = font; pr++; }
  res.getColumn(1).width = 18; [2, 3, 4, 5].forEach(c => { res.getColumn(c).width = 26; });

  // Cruce
  cru.addRow(['Fecha', 'Hora', 'Motivo', 'Servicio', 'Terminal', 'Código', '¿En lista de nuevos ingresos?', 'Nombre', 'Acción']).eachCell(c => { c.font = bold; c.fill = head; });
  for (const s of cruce) {
    const f = s.fecha ? `${String(s.fecha.d).padStart(2, '0')}/${String(s.fecha.m).padStart(2, '0')}/${s.fecha.y}` : '';
    const row = cru.addRow([f, s.hora != null ? s.hora / 86400 : '', s.motivo, s.servicio, s.terminal, s.codigo, s.enLista ? 'SÍ' : 'NO', s.nombre, s.accion]);
    row.getCell(2).numFmt = 'h:mm:ss'; row.getCell(6).numFmt = '@';
    row.eachCell({ includeEmpty: true }, c => { c.font = font; if (s.enLista) c.fill = blue; });
  }
  cru.views = [{ state: 'frozen', ySplit: 1 }];
  cru.autoFilter = { from: 'A1', to: 'I1' };
  cru.columns.forEach((c, i) => { c.width = [12, 10, 26, 16, 12, 14, 18, 34, 34][i]; });
  await wb.xlsx.writeFile(file);
}

module.exports = {
  normName, tokenSortRatio, tokenSetRatio, score, matchName, unusualIds, FUZZY_MIN,
  toSeconds, toYMD, parseDayLabel, dayKey, resolveDay, hhmm, MON,
  readRoster, readNoRegistrados, readDelphi, updateDelphi, reconcile, buildSummary, loadWorkbook,
};

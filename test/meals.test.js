'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path');
const ExcelJS = require('exceljs');
const M = require('../meals-core');

/* ---------- name matching ---------- */
const ROSTER = [
  { id: '80182523', name: 'ISAAC NEFTALI GOMEZ TORRES', type: 'Operador' },
  { id: '80182540', name: 'KEREN BETSAI SALAS MEDINA', type: 'Operador' },
  { id: '80182561', name: 'JOSE LUIS PALOS DURON', type: 'Operador' },
  { id: '80182577', name: 'ANA MARIA CARRILLO GALICIA', type: 'Tecnico' },
  { id: '80182588', name: 'JUAN CARLOS LOPEZ RAMIREZ', type: 'Operador' },
  { id: '80182599', name: 'MARIA FERNANDA ZAVALA DE LOS SANTOS', type: 'Operador' },
  { id: '80182610', name: 'JUAN CARLOS LOPEZ RAMOS', type: 'Operador' },
  { id: '80118204', name: 'PEDRO ANTONIO RUIZ PEREZ', type: 'Operador' },
];
test('exact match ignores accents, case and spaces', () => {
  const r = M.matchName('  maría  fernanda zavala de los santos ', ROSTER);
  assert.equal(r.id, '80182599'); assert.equal(r.kind, 'exact');
});
test('words run together on the sheet still match', () => {
  assert.equal(M.matchName('MARIA FERNANDA ZAVALADE LOS SANTOS', ROSTER).id, '80182599');
});
for (const [sheet, id] of [
  ['ISAC GOMEZ TORRES', '80182523'],           // ISAC → ISAAC NEFTALI
  ['KAREN BETSAI SALAS MEDINA', '80182540'],   // KAREN → KEREN
  ['JOSE LUIS PALOS DURAN', '80182561'],       // DURAN → DURON
  ['ANA MARIA CARRILLO GARCIA', '80182577'],   // GARCIA → GALICIA
  ['JUAN CARLOS LOPEZ RAMIEZ', '80182588'],    // RAMIEZ → RAMIREZ (not LOPEZ RAMOS)
]) test(`fuzzy: ${sheet}`, () => { const r = M.matchName(sheet, ROSTER); assert.equal(r.id, id, JSON.stringify(r)); assert.equal(r.kind, 'fuzzy'); });
test('unknown person gets no ID', () => { assert.equal(M.matchName('ROBERTO HERNANDEZ VEGA', ROSTER).id, null); });
test('unusual ID is flagged', () => {
  assert.deepEqual(M.unusualIds(['80182523', '80182540', '80182561', '80182810', '80118204']), ['80118204']);
});

/* ---------- a DELPHI file like the real one ---------- */
// Nov 2–6, 2026 stored with day/month swapped: Nov 2 → 2026-02-11 (mm-dd-yy)
const swapped = d => new Date(Date.UTC(2026, d - 1, 11)); // month=d, day=11
async function makeDelphi(file, counts) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Hoja1');
  ws.addRow(['FECHA', 'PLANTA', 'SERVICIO', 'HORA', 'NO-RELOJ', 'NOMBRE', 'DEPARTAMENTO', 'GRADO', 'TERMINAL', 'T.E.', null]);
  const days = [2, 3, 4, 5, 6];
  days.forEach((d, i) => {
    for (let k = 0; k < counts[i]; k++) {
      const row = ws.addRow([swapped(d), 'APTIV', '01-SERVICIO', (6 * 3600 + k * 600) / 86400, String(80000000 + k), `EMPLEADO ${k}`, 'OPERADOR GENERAL', 'T01', 'T3', 'N', null]);
      row.getCell(1).numFmt = 'mm-dd-yy'; row.getCell(4).numFmt = 'h:mm:ss'; row.getCell(5).numFmt = '@';
      row.eachCell(c => { c.font = { name: 'Calibri', size: 11 }; });
    }
    const t = ws.addRow([null, null, null, null, null, null, null, null, null, 'TOTAL SEGMENTO', counts[i]]);
    t.getCell(11).font = { name: 'Calibri', size: 11, bold: true };
  });
  const n = ws.addRow(['SERVICIOS NETO', null, null, counts.reduce((a, b) => a + b, 0)]);
  n.getCell(4).font = { name: 'Calibri', size: 11, bold: true };
  await wb.xlsx.writeFile(file);
}
const tmp = f => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'meals-')), f);

test('swapped dates: blocks are read as Nov 2–6 and FECHA is reused unchanged', async () => {
  const f = tmp('delphi.xlsx'); await makeDelphi(f, [3, 2, 2, 1, 1]);
  const wb = await M.loadWorkbook(f);
  const { blocks } = M.readDelphi(wb.getWorksheet('Hoja1'));
  assert.deepEqual(blocks.map(b => b.key), ['2-Nov', '3-Nov', '4-Nov', '5-Nov', '6-Nov']);
  M.updateDelphi(wb, [{ dayKey: '2-Nov', id: '80182523', name: 'ISAAC NEFTALI GOMEZ TORRES', type: 'Operador', seconds: null }]);
  const out = tmp('out.xlsx'); await wb.xlsx.writeFile(out);
  const ws = (await M.loadWorkbook(out)).getWorksheet('Hoja1');
  const added = ws.getRow(5); // 3 existing rows of Nov 2, then the new one
  assert.equal(added.getCell(1).value.toISOString().slice(0, 10), '2026-02-11');
  assert.equal(added.getCell(1).numFmt, 'mm-dd-yy');
  assert.equal(added.getCell(5).value, '80182523');
  assert.equal(typeof added.getCell(5).value, 'string');
  assert.equal(added.getCell(1).fill.fgColor.argb, 'FFBDD7EE');
});

test('segment insertion and totals', async () => {
  const f = tmp('delphi.xlsx'); await makeDelphi(f, [3, 2, 2, 1, 1]);
  const wb = await M.loadWorkbook(f);
  const stats = M.updateDelphi(wb, [
    { dayKey: '2-Nov', id: '80182561', name: 'JOSE LUIS PALOS DURON', type: 'Operador', seconds: null },
    { dayKey: '2-Nov', id: '80182523', name: 'ISAAC NEFTALI GOMEZ TORRES', type: 'Operador', seconds: null },
    { dayKey: '6-Nov', id: '80182577', name: 'ANA MARIA CARRILLO GALICIA', type: 'Tecnico', seconds: 6 * 3600 + 300 }, // between 6:00 and 6:10? only one row 6:00 → after it
    { dayKey: '6-Nov', id: '80182588', name: 'JUAN CARLOS LOPEZ RAMIREZ', type: 'Operador', seconds: 5 * 3600 },     // before 6:00
  ]);
  assert.deepEqual(stats.days.map(d => d.updated), [5, 2, 2, 1, 3]);
  assert.equal(stats.neto, 13); assert.equal(stats.netoOriginal, 9);
  const out = tmp('out.xlsx'); await wb.xlsx.writeFile(out);
  const ws = (await M.loadWorkbook(out)).getWorksheet('Hoja1');
  const col = (c, r) => ws.getRow(r).getCell(c).value;
  // Nov 2 block: rows 2-4 old, 5-6 new (sorted by name: ISAAC, JOSE), 7 total
  assert.equal(col(6, 5), 'ISAAC NEFTALI GOMEZ TORRES'); assert.equal(col(6, 6), 'JOSE LUIS PALOS DURON');
  assert.equal(col(4, 5), null);
  assert.equal(col(10, 7), 'TOTAL SEGMENTO'); assert.equal(col(11, 7), 5);
  assert.ok(ws.getRow(7).getCell(11).font.bold);
  // no blank rows: Nov 3 starts right after
  assert.equal(col(10, 10), 'TOTAL SEGMENTO'); assert.equal(col(11, 10), 2);
  // Nov 6: scanned meals in time order around the existing 6:00 row
  const last = ws.rowCount;
  assert.equal(col(1, last), 'SERVICIOS NETO'); assert.equal(col(4, last), 13);
  const n6 = [last - 4, last - 3, last - 2].map(r => col(6, r));
  assert.deepEqual(n6, ['JUAN CARLOS LOPEZ RAMIREZ', 'EMPLEADO 0', 'ANA MARIA CARRILLO GALICIA']);
  assert.equal(col(7, last - 2), 'TECNICO');
  assert.equal(ws.getRow(last - 4).getCell(4).numFmt, 'h:mm:ss');
  // existing rows untouched
  assert.equal(col(6, 2), 'EMPLEADO 0'); assert.equal(col(9, 2), 'T3');
});

test('NO REGISTRADOS: adds matches with scan time, skips duplicates and non-hires', () => {
  const days = ['2-Nov', '3-Nov', '4-Nov', '5-Nov', '6-Nov'];
  const review = [
    { source: 'Foto 1', row: 1, nameAsWritten: 'ISAC GOMEZ', id: '80182523', name: 'ISAAC NEFTALI GOMEZ TORRES', marks: { '6-Nov': true } },
    { source: 'Foto 1', row: 9, nameAsWritten: 'ISAC GOMEZ', id: '80182523', name: 'ISAAC NEFTALI GOMEZ TORRES', marks: { '2-Nov': true, '6-Nov': true } }, // repeated row
    { source: 'Foto 2', row: 3, nameAsWritten: 'ROBERTO VEGA', id: null, marks: { '3-Nov': true } },
  ];
  const noReg = [
    { fecha: { y: 2026, m: 11, d: 6 }, hora: 21 * 3600 + 40 * 60, codigo: '80182523', motivo: 'COMENSAL NO REGISTRADO' }, // already on the sheet that day
    { fecha: { y: 2026, m: 11, d: 6 }, hora: 22 * 3600, codigo: '80182561', motivo: 'COMENSAL NO REGISTRADO' },             // new
    { fecha: { y: 2026, m: 11, d: 6 }, hora: 22 * 3600, codigo: '4DOS', motivo: 'COMENSAL DEBE PAGAR' },
    { fecha: { y: 2026, m: 11, d: 4 }, hora: 13 * 3600, codigo: '2023', motivo: 'COMENSAL DEBE PAGAR' },
  ];
  const r = M.reconcile(review, noReg, ROSTER, days);
  const isaac = r.people.find(p => p.id === '80182523');
  assert.equal(isaac.total, 2, 'repeated row counts once per day');
  assert.deepEqual(r.cruce.map(c => c.accion), ['Ya marcado en la hoja (no se duplica)', 'Agregado a DELPHI', 'No aplica', 'No aplica']);
  const scanned = r.meals.find(m => m.id === '80182561');
  assert.equal(scanned.seconds, 22 * 3600); assert.equal(scanned.dayKey, '6-Nov');
  assert.equal(r.meals.length, 3);                 // 2 for Isaac + 1 scan; SIN ID not in DELPHI
  assert.equal(r.people.find(p => !p.id).total, 1); // listed with its meal count
});

test('day labels and times', () => {
  assert.deepEqual(M.parseDayLabel('2-Nov'), { d: 2, m: 11 });
  assert.deepEqual(M.parseDayLabel('06 nov'), { d: 6, m: 11 });
  assert.equal(M.toSeconds('9:41:07 p. m.'), 21 * 3600 + 41 * 60 + 7);
  assert.equal(M.toSeconds(0.5), 43200);
});

test('day column headers resolve to report days', () => {
  const days = ['2-Nov', '3-Nov', '4-Nov', '5-Nov', '6-Nov'];
  assert.equal(M.resolveDay('2-Nov', days, 2026), '2-Nov');
  assert.equal(M.resolveDay('L 2', days, 2026), '2-Nov');
  assert.equal(M.resolveDay('3/11', days, 2026), '3-Nov');
  assert.equal(M.resolveDay('Jueves 5', days, 2026), '5-Nov');
  assert.equal(M.resolveDay('VIERNES', days, 2026), '6-Nov');
  assert.equal(M.resolveDay('Miércoles', days, 2026), '4-Nov');
  assert.equal(M.resolveDay('9', days, 2026), null);
});

test('photo JSON parsing tolerates code fences and fills missing marks', () => {
  const AI = require('../meals-ai');
  const j = AI.parseJson('```json\n{"sheet_title":"INGRESOS","day_columns":["2-Nov","3-Nov"],"rows":[{"row_number":1,"name_as_written":"ANA","marks":{"2-Nov":true},"uncertain_cells":["3-Nov","x"],"note":""}]}\n```');
  assert.deepEqual(j.rows[0].marks, { '2-Nov': true, '3-Nov': false });
  assert.deepEqual(j.rows[0].uncertain_cells, ['3-Nov']);
  assert.throws(() => AI.parseJson('no json here'));
});

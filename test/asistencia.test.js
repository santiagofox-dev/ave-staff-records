'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../asistencia-core');

const day = (inn, out, o = {}) => ({ rest: false, in: inn, out, sched: 9.5, start: 360, ...o });
const T = (h, m = 0) => h * 60 + m;

test('clock day: worked, incomplete, absent, implausible span', () => {
  assert.strictEqual(A.dayFromClock(day(T(5, 55), T(15, 31))).status, 'trabajo');
  assert.strictEqual(A.dayFromClock(day(null, T(15, 30))).status, 'incompleto');
  assert.strictEqual(A.dayFromClock(day(null, null)).status, 'falta');
  assert.strictEqual(A.dayFromClock(day(T(0, 2), T(23, 53))).status, 'incompleto');
  const t2 = A.dayFromClock({ rest: false, in: T(15, 19), out: T(23, 57), sched: 8 });
  assert.strictEqual(t2.hours, 8.6);
  const ov = A.dayFromClock({ rest: false, in: T(22), out: T(6, 30), sched: 8 });
  assert.strictEqual(ov.hours, 8.5);
});

test('same name under two IDs is one person', () => {
  const m = A.mergeDuplicates([
    { id: '66', name: 'ANA LOPEZ', days: { '2026-11-10': day(T(6), T(15, 30)) } },
    { id: '1066', name: 'ANA LOPEZ', days: { '2026-11-10': day(T(5, 57), null) } },
  ]);
  assert.strictEqual(m.length, 1);
  assert.deepStrictEqual(m[0].ids, ['66', '1066']);
  assert.strictEqual(m[0].days['2026-11-10'].in, T(5, 57));
});

test('codes are normalised', () => {
  assert.strictEqual(A.normClave('f'), 'FI');
  assert.strictEqual(A.normClave('Inc'), 'INC');
  assert.strictEqual(A.normClave('p.s.s'), 'PSS');
  assert.strictEqual(A.normClave(''), '');
  assert.strictEqual(A.normClave('FINJ'), 'FI');
  assert.strictEqual(A.normClave('VACR'), 'VAC');
  assert.strictEqual(A.normClave('RET'), 'RET');
});

test('checador wins: weekly overtime, inflated TE, absences classified by the sheet', () => {
  const mon = '2026-11-09';
  const full = {}; for (let i = 0; i < 5; i++) full[A.addDays(mon, i)] = day(T(5, 50), T(15, 40));
  full[A.addDays(mon, 5)] = { rest: true, in: T(6), out: T(14), sched: null };
  const none = {}; for (let i = 0; i < 5; i++) none[A.addDays(mon, i)] = day(null, null);
  const week = {
    '1': { id: '1', ids: ['1'], name: 'UNO PRUEBA', turno: 'MVA TURNO 1', days: full },
    '2': { id: '2', ids: ['2'], name: 'DOS PRUEBA', turno: 'MVA TURNO 1', days: none },
    '3': { id: '3', ids: ['3'], name: 'TRES PRUEBA', turno: 'MVA TURNO 1', days: none },
  };
  const D = o => Object.fromEntries(A.DAYS.map(d => [d, { clave: '', te: null, ...(o[d] || {}) }]));
  const rows = [
    { key: '1:0', id: '1', name: 'UNO PRUEBA', days: D({ lun: { te: 4 }, mar: { te: 4 }, sab: { te: 8 } }), uncertain: [] },
    { key: '1:1', id: '2', name: 'DOS PRUEBA', days: D({ lun: { clave: 'INC' }, mar: { clave: 'INC' }, mie: { clave: 'INC' }, jue: { clave: 'INC' }, vie: { clave: 'INC' } }), uncertain: [] },
    { key: '1:2', id: null, name: 'TRES PRUEBA', days: D({}), uncertain: [] },
  ];
  const r = A.compare(rows, week, mon, { turnosRead: ['MVA TURNO 1'] });
  const uno = r.results.find(x => x.id === '1'), dos = r.results.find(x => x.id === '2'), tres = r.results.find(x => x.id === '3');
  assert.strictEqual(uno.totals.hours, 57);
  assert.strictEqual(uno.totals.teChk, 9);
  assert.strictEqual(uno.totals.teSheet, 16);
  assert.strictEqual(uno.lvl, 'bad');
  assert.strictEqual(dos.totals.INC, 5);
  assert.strictEqual(dos.totals.FI, 0);
  assert.strictEqual(tres.totals.FI, 5);
  assert.strictEqual(tres.sheetRow.how, 'nombre');
  assert.strictEqual(tres.lvl, 'bad');
});

test('sheet layout: one turno per sheet, balanced pages, printed code', () => {
  const ro = Array.from({ length: 23 }, (_, i) => ({ id: String(100 + i), name: 'P ' + i, turno: 'MVA TURNO 1', rest: ['sab', 'dom'] }));
  const sh = A.layoutSheets(ro, '2026-11-16');
  assert.strictEqual(sh.length, 2);
  assert.strictEqual(sh[0].code, 'MVA-T1-261116-1/2');
  assert.ok(Math.abs(sh[0].rows.length - sh[1].rows.length) <= 1);
});

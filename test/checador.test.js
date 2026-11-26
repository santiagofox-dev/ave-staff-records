'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chk-'));
const C = require('../checador')({ DATA_DIR: dir });
const PL = 'jabil-torres';
const m = (d, hm) => Math.floor(Date.parse(`${d}T${hm}Z`) / 60000);

test('pairs entry/exit, drops double taps, keeps night shift on the day it started', () => {
  const sh = C.shiftsOf(PL);
  assert.deepStrictEqual(sh.map(s => s.name), ['TURNO 1', 'TURNO 2', 'TURNO 3']);
  const times = [m('2026-11-23', '05:55'), m('2026-11-23', '05:56'), m('2026-11-23', '15:02'), m('2026-11-23', '15:03'), // T1 with double taps
    m('2026-11-24', '22:58'), m('2026-11-25', '06:04')]; // T3 overnight
  const s = C.sessionsOf(times, sh);
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].shift.name, 'TURNO 1'); assert.strictEqual(s[0].day, '2026-11-23'); assert.ok(s[0].out);
  assert.strictEqual(s[1].shift.name, 'TURNO 3'); assert.strictEqual(s[1].day, '2026-11-24'); assert.strictEqual(s[1].out - s[1].in, 7 * 60 + 6);
});

test('an unmatched punch stays incomplete; a missed exit does not swallow the next day', () => {
  const sh = C.shiftsOf(PL);
  const s = C.sessionsOf([m('2026-11-23', '15:01'), m('2026-11-24', '05:58'), m('2026-11-25', '05:59'), m('2026-11-25', '15:00')], sh);
  assert.strictEqual(s[0].out, undefined); assert.strictEqual(s[0].day, '2026-11-23');     // 15:01 alone (T1 exit or T2 entry): incomplete
  assert.strictEqual(s[1].out, undefined); assert.strictEqual(s[1].day, '2026-11-24');     // Tuesday entry, no exit
  assert.ok(s[2].in && s[2].out); assert.strictEqual(s[2].day, '2026-11-25');
});

test('sync stores punches once and builds the week Asistencia reads', () => {
  fs.mkdirSync(path.join(dir, 'checador', PL), { recursive: true });
  fs.writeFileSync(path.join(dir, 'checador', PL, 'employees.json'), JSON.stringify({ people: { 382: { id: '382', name: 'PAOLA DE LA CRUZ BAÑUELOS', nss: '' }, 483: { id: '483', name: 'VERONICA SOTO MALDONADO', nss: '' } } }));
  const p = [{ uid: 'a1', emp: '382', ts: '2026-11-23T06:10:00' }, { uid: 'a2', emp: '382', ts: '2026-11-23T14:50:00' }];
  const r1 = C.storePunches(PL, p, 'st1'), r2 = C.storePunches(PL, p, 'st1');
  assert.strictEqual(r1.fresh, 2); assert.strictEqual(r2.fresh, 0);
  C.ensureWeek(PL, '2026-11-23');
  const w = JSON.parse(fs.readFileSync(path.join(dir, 'asistencia', 'plantas', PL, 'weeks', '2026-11-23.json'), 'utf8'));
  const d = w.people['382'].days['2026-11-23'];
  assert.strictEqual(d.in, 370); assert.strictEqual(d.out, 890); assert.strictEqual(d.start, 360); assert.strictEqual(w.people['382'].turno, 'TURNO 1');
  assert.ok(w.people['483'].days['2026-11-23'] && w.people['483'].days['2026-11-23'].in === null); // on the list, no punches = falta
});

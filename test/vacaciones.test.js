'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../public/static/vac');

test('LFT art. 76 table (2023 reform) and the old one before 2023', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 10, 11, 15, 16, 20, 21, 30, 31].map(n => V.daysForYear(n, '2026-01-01')), [12, 14, 16, 18, 20, 22, 22, 24, 24, 26, 26, 28, 30, 32]);
  assert.deepStrictEqual([1, 2, 3, 4, 5, 9, 10].map(n => V.daysForYear(n, '2022-05-01')), [6, 8, 10, 12, 14, 14, 16]);
});

test('balance: anniversaries minus days taken; opening balance from the kárdex', () => {
  const s = V.summary({ hire: '2024-06-17', vac: { taken: [{ from: '2025-07-01', to: '2025-07-03', days: 3 }] } }, '2026-11-26');
  assert.strictEqual(s.years, 2); assert.strictEqual(s.balance, 12 + 14 - 3); assert.strictEqual(s.nextDays, 16);
  const k = V.summary({ hire: '2024-06-17', vac: { opening: { date: '2026-09-21', saldo: 10 }, taken: [{ from: '2026-10-05', days: 2 }, { from: '2025-01-01', days: 5, kind: 'kardex' }] } }, '2027-07-01');
  assert.strictEqual(k.balance, 10 + 16 - 2); // 2027-06-17 anniversary (year 3) after the kárdex date
  assert.strictEqual(V.workDays('2026-11-23', '2026-11-29'), 6);
});

test('days are not cumulative: each period expires 18 months after its anniversary (arts. 81 and 516)', () => {
  // hired 2022-03-01: 2023-03-01 (12, expires 2024-09-01), 2024-03-01 (14, expires 2025-09-01), 2025-03-01 (16), 2026-03-01 (18)
  const s = V.summary({ hire: '2022-03-01', vac: { taken: [{ from: '2024-07-01', days: 5, kind: 'vacaciones' }, { from: '2025-10-01', days: 6, kind: 'vacaciones' }] } }, '2026-11-26');
  // 5 days used the 2023 period (oldest in force); 6 days in Oct-2025 used the 2025 period (2024 had already expired)
  const p = Object.fromEntries(s.periods.map(x => [x.year, x.left]));
  assert.deepStrictEqual(p, { 1: 7, 2: 14, 3: 10, 4: 18 });
  assert.strictEqual(s.expired, 7 + 14 + 10); // the 2025 period expired 2026-09-01 too
  assert.strictEqual(s.balance, 18);
  assert.deepStrictEqual(s.nextExpiry, { date: '2027-09-01', days: 18, year: 4, takeBy: '2026-09-01' });
  assert.strictEqual(V.summary({ hire: '2022-03-01', vac: s.opening ? {} : { taken: s.taken } }, '2026-08-01').balance, 10 + 18);
});

test('a falta sin justificar does not use vacation days; passed to vacaciones it does', () => {
  const base = { hire: '2024-06-17', vac: { taken: [{ from: '2025-08-04', days: 1, kind: 'FI' }] } };
  assert.strictEqual(V.summary(base, '2025-09-01').balance, 12);
  assert.strictEqual(V.summary(base, '2025-09-01').faltas, 1);
  base.vac.taken[0].kind = 'falta';
  assert.strictEqual(V.summary(base, '2025-09-01').balance, 11);
});

test('days given in advance come out of the next anniversary; kárdex balance goes to the newest periods', () => {
  const a = V.summary({ hire: '2024-06-17', vac: { taken: [{ from: '2025-03-03', days: 4, kind: 'vacaciones' }] } }, '2025-05-01');
  assert.strictEqual(a.balance, -4); assert.strictEqual(a.advanced, 4);
  assert.strictEqual(V.summary({ hire: '2024-06-17', vac: { taken: [{ from: '2025-03-03', days: 4, kind: 'vacaciones' }] } }, '2025-07-01').balance, 8);
  // hired 2021: kárdex at 2025-01-15 says 20 left → the 2024-02-01 period (16) gets 16, the 2023-02-01 one (14) gets 4
  const k = V.summary({ hire: '2021-02-01', vac: { opening: { date: '2025-01-15', saldo: 20 }, taken: [] } }, '2025-06-01');
  const p = Object.fromEntries(k.periods.map(x => [x.year, x.left]));
  assert.strictEqual(p[3], 16); assert.strictEqual(p[2], 4); assert.strictEqual(p[1], 0);
  assert.strictEqual(k.expired, 4); // 2023-02-01 period expired 2024-08-01
  assert.strictEqual(k.balance, 16 + 18); // + 2025-02-01 (year 4 = 18)
});

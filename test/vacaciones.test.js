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

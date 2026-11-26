'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { resolveCard } = require('../comedor');

test('pcProx output formats land on the same card', () => {
  const cards = { 1003: {}, 982: {} };
  for (const raw of ['1003', '01003', '12,1003', '12:01003', String(12 * 65536 + 1003), ' 1003\r']) assert.deepStrictEqual(resolveCard(raw, cards).card, '1003', raw);
  assert.strictEqual(resolveCard('5555', cards).known, false);
});

test('meals are stored once and counted for billing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-'));
  const C = require('../comedor')({ DATA_DIR: dir });
  fs.mkdirSync(path.join(dir, 'comedor', 'jabil-torres'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'comedor', 'jabil-torres', 'cards.json'), JSON.stringify({ cards: { 1003: { card: '1003', emp: '4469956', name: 'TAILY' } } }));
  fs.writeFileSync(path.join(dir, 'comedor', 'jabil-torres', 'settings.json'), JSON.stringify({ price: 60 }));
  const meals = [{ uid: 'a', ts: '2026-11-23T13:00:00', card: '1003' }, { uid: 'b', ts: '2026-11-23T13:05:00', card: '7777' }, { uid: 'c', ts: '2026-11-23T13:06:00', src: 'manual', note: 'visitante' }];
  assert.strictEqual(C.storeMeals('jabil-torres', meals, 's1').fresh, 3);
  assert.strictEqual(C.storeMeals('jabil-torres', meals, 's1').fresh, 0);
  const r = C.report('jabil-torres', '2026-11-23', '2026-11-29');
  assert.strictEqual(r.total, 3); assert.strictEqual(r.known, 1); assert.strictEqual(r.amount, 180);
});

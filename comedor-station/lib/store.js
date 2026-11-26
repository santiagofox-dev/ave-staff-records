'use strict';
/* Everything lives in the "datos" folder next to the program, so it survives restarts and works with no internet:
     config.json    settings (server, station code, admin PIN)
     meals.jsonl    every meal counted, one per line, never rewritten (append only)
     synced.txt     ids of meals gpoave.com already confirmed
     cache.json     the client's card list and settings, as last received from gpoave.com
     log.txt        what happened (rotates at 2 MB) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pad = n => String(n).padStart(2, '0');
const localTs = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

module.exports = function (DATA) {
  fs.mkdirSync(DATA, { recursive: true });
  const F = n => path.join(DATA, n);
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const writeJ = (f, v) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };

  function log(...a) {
    const line = `[${localTs(new Date()).replace('T', ' ')}] ${a.join(' ')}\n`;
    try {
      const f = F('log.txt');
      if (fs.existsSync(f) && fs.statSync(f).size > 2 * 1024 * 1024) fs.renameSync(f, F('log.old.txt'));
      fs.appendFileSync(f, line);
    } catch (e) { /* a full disk must not stop the counter */ }
    process.stdout.write(line);
  }

  const DEFAULTS = { server: 'https://gpoave.com', token: '', stationName: '', pinHash: '', syncMin: 60 };
  let config = { ...DEFAULTS, ...readJ(F('config.json'), {}) };
  const saveConfig = c => { config = { ...config, ...c }; writeJ(F('config.json'), config); return config; };
  const pinHash = pin => crypto.createHash('sha256').update('ave-comedor:' + String(pin)).digest('hex');

  /* meals */
  const meals = [], known = new Set(), synced = new Set();
  if (fs.existsSync(F('meals.jsonl'))) for (const line of fs.readFileSync(F('meals.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const m = JSON.parse(line); if (m.uid && !known.has(m.uid)) { known.add(m.uid); meals.push(m); } } catch (e) { /* half-written line after a power cut */ }
  }
  if (fs.existsSync(F('synced.txt'))) for (const u of fs.readFileSync(F('synced.txt'), 'utf8').split('\n')) if (u) synced.add(u);
  function addMeal(m) {
    const q = { uid: m.uid || `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`, ts: m.ts || localTs(new Date()), card: m.card || '', emp: m.emp || '', name: m.name || '', known: !!m.known, raw: m.raw || undefined, src: m.src || 'card', by: m.by || undefined, note: m.note || undefined };
    known.add(q.uid); meals.push(q);
    fs.appendFileSync(F('meals.jsonl'), JSON.stringify(q) + '\n'); // written to disk before the screen says OK
    return q;
  }
  const pending = () => meals.filter(m => !synced.has(m.uid));
  function markSynced(uids) { const add = uids.filter(u => !synced.has(u)); if (!add.length) return; add.forEach(u => synced.add(u)); fs.appendFileSync(F('synced.txt'), add.join('\n') + '\n'); }
  const between = (from, to) => meals.filter(m => { const d = m.ts.slice(0, 10); return d >= from && d <= to; });

  let cache = readJ(F('cache.json'), { cards: {}, cardsAt: null, settings: { debounceSec: 10 }, plant: null, station: null, lastSync: null, lastTry: null, lastError: null, offlineSince: null, serverOffsetSec: null });
  const saveCache = c => { cache = { ...cache, ...c }; writeJ(F('cache.json'), cache); return cache; };

  return { DATA, log, get config() { return config; }, saveConfig, pinHash, meals, addMeal, pending, markSynced, between, isSynced: u => synced.has(u), get cache() { return cache; }, saveCache };
};
module.exports.localTs = localTs;

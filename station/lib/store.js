'use strict';
/* Everything the station knows lives in the "datos" folder next to the program, so it survives restarts and
   works with no internet:
     config.json      settings (server, station code, terminal, admin PIN)
     punches.jsonl    every punch ever read, one per line, never rewritten (append only)
     synced.txt       ids of punches gpoave.com already confirmed
     cache.json       employees and shifts as last received from gpoave.com
     log.txt          what happened (rotates at 2 MB) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function (DATA) {
  fs.mkdirSync(DATA, { recursive: true });
  const F = n => path.join(DATA, n);
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const writeJ = (f, v) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, f); };

  /* ---------- log ---------- */
  function log(...a) {
    const line = `[${localStamp()}] ${a.join(' ')}\n`;
    try {
      const f = F('log.txt');
      if (fs.existsSync(f) && fs.statSync(f).size > 2 * 1024 * 1024) fs.renameSync(f, F('log.old.txt'));
      fs.appendFileSync(f, line);
    } catch (e) { /* the disk being full must not stop the checador */ }
    process.stdout.write(line);
  }

  /* ---------- config ---------- */
  const DEFAULTS = { server: 'https://gpoave.com', token: '', stationName: '', device: { kind: 'none', ip: '', port: 4370, user: 'admin', password: '', pushPort: 8081 }, pinHash: '', pollSec: 60, syncMin: 60 };
  let config = { ...DEFAULTS, ...readJ(F('config.json'), {}) };
  config.device = { ...DEFAULTS.device, ...(config.device || {}) };
  const saveConfig = c => { config = { ...config, ...c, device: { ...config.device, ...((c && c.device) || {}) } }; writeJ(F('config.json'), config); return config; };
  const pinHash = pin => crypto.createHash('sha256').update('ave-checador:' + String(pin)).digest('hex');

  /* ---------- punches ---------- */
  const punches = [];           // all, in memory (a few hundred thousand lines at most)
  const known = new Set();
  const synced = new Set();
  if (fs.existsSync(F('punches.jsonl'))) {
    for (const line of fs.readFileSync(F('punches.jsonl'), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const p = JSON.parse(line); if (p.uid && !known.has(p.uid)) { known.add(p.uid); punches.push(p); } } catch (e) { /* half-written last line after a power cut: skip */ }
    }
  }
  if (fs.existsSync(F('synced.txt'))) for (const u of fs.readFileSync(F('synced.txt'), 'utf8').split('\n')) if (u) synced.add(u);

  /** Adds punches not seen before. Returns how many were new. */
  function addPunches(list) {
    const fresh = [];
    for (const p of list) {
      if (!p || !p.uid || !p.emp || !p.ts || known.has(p.uid)) continue;
      const q = { uid: String(p.uid), emp: String(p.emp).replace(/\D/g, ''), ts: String(p.ts).slice(0, 19), src: p.src || 'face', by: p.by || undefined, note: p.note || undefined, read: new Date().toISOString() };
      if (!q.emp || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(q.ts)) continue;
      known.add(q.uid); punches.push(q); fresh.push(q);
    }
    if (fresh.length) {
      fs.appendFileSync(F('punches.jsonl'), fresh.map(p => JSON.stringify(p)).join('\n') + '\n');
      punches.sort((a, b) => a.ts.localeCompare(b.ts));
    }
    return fresh.length;
  }
  const pending = () => punches.filter(p => !synced.has(p.uid));
  function markSynced(uids) {
    const add = uids.filter(u => !synced.has(u));
    if (!add.length) return;
    add.forEach(u => synced.add(u));
    fs.appendFileSync(F('synced.txt'), add.join('\n') + '\n');
  }
  const between = (from, to) => punches.filter(p => { const d = p.ts.slice(0, 10); return d >= from && d <= to; });

  /* ---------- cache from the server ---------- */
  let cache = readJ(F('cache.json'), { employees: [], shifts: [], plant: null, station: null, lastSync: null, lastTry: null, lastError: null, offlineSince: null, serverOffsetSec: null });
  const saveCache = c => { cache = { ...cache, ...c }; writeJ(F('cache.json'), cache); return cache; };

  return {
    DATA, log, get config() { return config; }, saveConfig, pinHash,
    punches, addPunches, pending, markSynced, between, isSynced: uid => synced.has(uid),
    get cache() { return cache; }, saveCache,
  };
};

function localStamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
module.exports.localStamp = localStamp;
module.exports.localTs = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

'use strict';
/* AVE MEAL COUNTER (contador de comidas)
   Runs on the comedor PC with the RF IDeas pcProx Plus reader (HID Prox 125 kHz, 26 bits). Works with no internet:
   - each card swipe is one meal, saved on this PC before the screen says OK
   - the screen shows the person's name and the day's count
   - every hour the meals go to gpoave.com, and the client's card list comes back
   Screen: http://localhost:8790        Settings: http://localhost:8790/admin (PIN) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA = process.env.AVE_DATA_DIR || path.join(ROOT, 'datos');
const store = require('./lib/store')(DATA);
const sync = require('./lib/sync')(store);
const { localTs } = require('./lib/store');
const PORT = +process.env.AVE_PORT || 8790;
const HOST = process.env.AVE_HOST || '127.0.0.1';

const today = () => localTs(new Date()).slice(0, 10);
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = ymd => { const d = new Date(ymd + 'T12:00:00Z'); return addDays(ymd, -((d.getUTCDay() + 6) % 7)); };

/** What the reader typed → the card on the list (same rule as gpoave.com). */
function resolveCard(raw) {
  const cards = store.cache.cards || {};
  const parts = String(raw || '').split(/\D+/).filter(Boolean).map(x => x.replace(/^0+(?=\d)/, ''));
  if (!parts.length) return null;
  const tries = [];
  if (parts.length >= 2) tries.push(parts[parts.length - 1]);
  const all = parts.join(''), n = Number(all);
  tries.push(all);
  if (Number.isSafeInteger(n) && n > 65535) tries.push(String(n % 65536)); // facility code × 65536 + card number
  for (const t of tries) if (cards[t]) return { card: t, known: true, ...cards[t] };
  return { card: parts.length >= 2 ? parts[parts.length - 1] : (n > 65535 ? String(n % 65536) : all), known: false, emp: '', name: '' };
}

/* the reader sometimes reads a card held still twice: the same card within a few seconds is one meal */
const lastSeen = new Map();
function swipe(raw) {
  const r = resolveCard(raw);
  if (!r) return { ok: false, error: 'Lectura vacía' };
  const now = Date.now(), win = Math.max(0, +(store.cache.settings && store.cache.settings.debounceSec) || 10) * 1000, prev = lastSeen.get(r.card);
  if (prev && now - prev < win) return { ok: true, repeat: true, card: r.card, name: r.name, known: r.known, count: todayCount() };
  lastSeen.set(r.card, now);
  const m = store.addMeal({ card: r.card, emp: r.emp, name: r.name, known: r.known, raw: String(raw).trim().slice(0, 40), src: 'card' });
  if (!r.known) store.log(`Tarjeta no registrada: ${r.card} (lectura "${String(raw).trim()}")`);
  return { ok: true, card: r.card, name: r.name, emp: r.emp, known: r.known, time: m.ts.slice(11, 16), count: todayCount() };
}
const todayCount = () => store.between(today(), today()).length;

function live() {
  const t = today(), list = store.between(t, t), c = store.cache, hours = Array(24).fill(0);
  for (const m of list) hours[+m.ts.slice(11, 13)]++;
  return {
    now: localTs(new Date()), plant: c.plant, station: c.station || (store.config.stationName ? { name: store.config.stationName } : null),
    configured: { pin: !!store.config.pinHash, token: !!store.config.token, cards: Object.keys(c.cards || {}).length },
    count: list.length, unknown: list.filter(m => !m.known).length, hours,
    last: list.slice(-14).reverse().map(m => ({ time: m.ts.slice(11, 16), card: m.card, name: m.name, known: m.known, src: m.src })),
    sync: { lastSync: c.lastSync, lastTry: c.lastTry, lastError: c.lastError, offlineSince: c.offlineSince, pending: store.pending().length, running: sync.running },
    clockWarning: c.serverOffsetSec != null && Math.abs(c.serverOffsetSec) > 300 ? `El reloj de esta PC está ${Math.round(Math.abs(c.serverOffsetSec) / 60)} min ${c.serverOffsetSec > 0 ? 'atrasado' : 'adelantado'}. Corrígelo en Windows (Fecha y hora → Sincronizar ahora).` : null,
  };
}
function report(from, to) {
  const days = {}; for (let d = from; d <= to; d = addDays(d, 1)) days[d] = { ymd: d, total: 0, unknown: 0, manual: 0 };
  const unknown = {};
  for (const m of store.between(from, to)) {
    const d = days[m.ts.slice(0, 10)]; if (!d) continue;
    d.total++; if (!m.known) { d.unknown++; const u = unknown[m.card] = unknown[m.card] || { card: m.card, count: 0, last: m.ts }; u.count++; u.last = m.ts; } if (m.src === 'manual') d.manual++;
  }
  const list = Object.values(days);
  return { from, to, days: list, total: list.reduce((a, d) => a + d.total, 0), unknownCards: Object.values(unknown).sort((a, b) => b.count - a.count) };
}

/* ---------- http ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2' };
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body); };
const readBody = (req, max = 1e5) => new Promise((resolve, reject) => { let b = ''; req.setEncoding('utf8'); req.on('data', c => { b += c; if (b.length > max) { req.destroy(); reject(new Error('Demasiado grande')); } }); req.on('end', () => resolve(b)); req.on('error', reject); });
const cookie = (req, k) => { const m = new RegExp('(?:^|; )' + k + '=([^;]+)').exec(req.headers.cookie || ''); return m ? m[1] : ''; };
const sessions = new Map(), fails = { n: 0, until: 0 };
const isAdmin = req => { const t = cookie(req, 'ave_admin'), exp = t && sessions.get(t); return !!(exp && exp > Date.now()); };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost'), p = u.pathname;
  try {
    if (req.method !== 'GET' && req.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(req.headers.origin)) return send(res, 403, { error: 'Origen no permitido' });
    if (p === '/' || p === '/admin') return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', p === '/' ? 'index.html' : 'admin.html')), MIME['.html']);
    if (p.startsWith('/static/')) { const f = path.join(ROOT, 'public', path.basename(p)); return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream') : send(res, 404, 'No existe', 'text/plain'); }
    if (p === '/api/live') return send(res, 200, live());
    if (p === '/api/swipe' && req.method === 'POST') { const b = JSON.parse(await readBody(req, 2000) || '{}'); return send(res, 200, swipe(b.raw)); }
    if (p === '/api/state') return send(res, 200, { pinSet: !!store.config.pinHash, admin: isAdmin(req) });
    if (p === '/api/login' && req.method === 'POST') {
      if (fails.until > Date.now()) return send(res, 429, { error: 'Demasiados intentos. Espera 5 minutos.' });
      const b = JSON.parse(await readBody(req, 1e4) || '{}');
      if (!store.config.pinHash) { if (!/^\d{4,8}$/.test(String(b.pin || ''))) return send(res, 400, { error: 'El PIN debe tener de 4 a 8 números.' }); store.saveConfig({ pinHash: store.pinHash(b.pin) }); store.log('PIN de administrador creado'); }
      else if (store.pinHash(b.pin) !== store.config.pinHash) { if (++fails.n >= 5) { fails.until = Date.now() + 5 * 60000; fails.n = 0; } return send(res, 401, { error: 'PIN incorrecto.' }); }
      fails.n = 0;
      const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, Date.now() + 8 * 3600e3);
      return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': `ave_admin=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
    }
    if (p === '/api/logout' && req.method === 'POST') { sessions.delete(cookie(req, 'ave_admin')); return send(res, 200, { ok: true }); }

    /* ---- admin with PIN ---- */
    if (!p.startsWith('/api/')) return send(res, 404, 'No existe', 'text/plain');
    if (!isAdmin(req)) return send(res, 401, { error: 'Escribe el PIN de administrador.' });
    if (p === '/api/config' && req.method === 'GET') { const c = store.config; return send(res, 200, { server: c.server, token: c.token ? c.token.slice(0, 8) + '…' : '', hasToken: !!c.token, stationName: c.stationName, data: DATA, cards: Object.keys(store.cache.cards || {}).length, cardsAt: store.cache.cardsAt, debounceSec: (store.cache.settings || {}).debounceSec }); }
    if (p === '/api/config' && req.method === 'PUT') {
      const b = JSON.parse(await readBody(req) || '{}'), c = {};
      if (b.server) { if (!/^https?:\/\/[\w.-]+(:\d+)?\/?$/.test(b.server)) return send(res, 400, { error: 'Dirección del servidor no válida.' }); c.server = b.server.replace(/\/$/, ''); }
      if (b.token) { if (!/^avc_[\w-]{20,}$/.test(b.token.trim())) return send(res, 400, { error: 'El código de la estación empieza con "avc_". Cópialo completo de gpoave.com → Comidas → Meal Counter.' }); c.token = b.token.trim(); }
      if (b.stationName != null) c.stationName = String(b.stationName).slice(0, 60);
      if (b.newPin) { if (!/^\d{4,8}$/.test(String(b.newPin))) return send(res, 400, { error: 'El PIN debe tener de 4 a 8 números.' }); c.pinHash = store.pinHash(b.newPin); }
      store.saveConfig(c); store.log('Configuración guardada');
      if (c.token) setTimeout(() => sync.syncNow(), 300);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/sync' && req.method === 'POST') return send(res, 200, await sync.syncNow());
    if (p === '/api/manual' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req) || '{}'), qty = Math.min(200, Math.max(1, parseInt(b.qty, 10) || 1));
      const by = String(b.by || '').trim(); if (!by) return send(res, 400, { error: 'Escribe quién autoriza.' });
      let r = b.card ? resolveCard(b.card) : null;
      if (!r && b.emp) { const e = String(b.emp).replace(/\D/g, ''); const hit = Object.entries(store.cache.cards || {}).find(([, v]) => v.emp === e); r = hit ? { card: hit[0], known: true, ...hit[1] } : { card: '', emp: e, known: false, name: '' }; }
      if (!r && !String(b.note || '').trim()) return send(res, 400, { error: 'Escribe la tarjeta o el número de empleado, o en el motivo para quién son (ej. visitantes).' });
      r = r || { card: '', emp: '', known: false, name: '' };
      for (let i = 0; i < qty; i++) store.addMeal({ card: r.card, emp: r.emp, name: r.name || (b.name ? String(b.name).slice(0, 80) : ''), known: r.known, src: 'manual', by: by.slice(0, 60), note: String(b.note || '').slice(0, 200) });
      store.log(`Comida(s) manual(es): ${qty} · ${r.card || r.emp || 'sin tarjeta'} · autorizó ${by}${b.note ? ' · ' + b.note : ''}`);
      return send(res, 200, { ok: true, added: qty, name: r.name, known: r.known });
    }
    if (p === '/api/report') { const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(v || ''), from = ok(u.searchParams.get('desde')) ? u.searchParams.get('desde') : mondayOf(today()), to = ok(u.searchParams.get('hasta')) ? u.searchParams.get('hasta') : addDays(from, 6); return send(res, 200, report(from, to)); }
    if (p === '/api/export.csv') {
      const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(v || ''), from = ok(u.searchParams.get('desde')) ? u.searchParams.get('desde') : mondayOf(today()), to = ok(u.searchParams.get('hasta')) ? u.searchParams.get('hasta') : today();
      const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
      const rows = [['Fecha', 'Hora', 'Tarjeta', 'No. empleado', 'Nombre', 'Registrada', 'Origen', 'Autorizó', 'Nota', 'Enviada a gpoave.com'], ...store.between(from, to).map(m => [m.ts.slice(0, 10), m.ts.slice(11, 19), m.card, m.emp, m.name, m.known ? 'sí' : 'NO', m.src === 'manual' ? 'manual' : 'tarjeta', m.by || '', m.note || '', store.isSynced(m.uid) ? 'sí' : 'pendiente'])];
      return send(res, 200, '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="comidas_${from}_${to}.csv"` });
    }
    if (p === '/api/log') { let t = ''; try { t = fs.readFileSync(path.join(DATA, 'log.txt'), 'utf8'); } catch (e) { /* none yet */ } return send(res, 200, { lines: t.trim().split('\n').slice(-200).reverse() }); }
    return send(res, 404, { error: 'No existe' });
  } catch (e) { store.log('Error: ' + (e.stack || e.message)); return send(res, 500, { error: e.message || 'Error' }); }
});
server.on('error', e => { store.log(e.code === 'EADDRINUSE' ? `El puerto ${PORT} ya está en uso: ¿el Meal Counter ya está abierto?` : 'Error: ' + e.message); process.exit(1); });
server.listen(PORT, HOST, () => {
  store.log(`AVE Meal Counter ${require('./package.json').version} listo en http://localhost:${PORT} · datos en ${DATA}`);
  try { fs.writeFileSync(path.join(DATA, 'pid.txt'), String(process.pid)); } catch (e) { /* not critical */ }
  sync.start();
});
process.on('uncaughtException', e => store.log('Error inesperado: ' + (e.stack || e.message)));
process.on('unhandledRejection', e => store.log('Error inesperado: ' + ((e && e.stack) || e)));

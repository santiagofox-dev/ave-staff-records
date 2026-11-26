'use strict';
/* AVE CHECADOR EN SITIO
   Runs on the plant's Windows PC, next to the face terminal. Works with no internet:
   - reads the terminal every minute (or receives its punches) and saves them in the "datos" folder
   - shows on this PC who checked in today, who is inside, and the week's hours
   - sends everything to gpoave.com every hour when there is internet
   Screen:  http://localhost:8787        Settings: http://localhost:8787/admin (PIN) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA = process.env.AVE_DATA_DIR || path.join(ROOT, 'datos');
process.env.AVE_LOG_DIR = DATA;
const store = require('./lib/store')(DATA);
const devices = require('./lib/devices')(store);
const sync = require('./lib/sync')(store, devices);
const pair = require('./lib/pair');
const { localTs } = require('./lib/store');
const PORT = +process.env.AVE_PORT || 8787;
const HOST = process.env.AVE_HOST || '127.0.0.1'; // only this PC; set AVE_HOST=0.0.0.0 to open it to the local network

const sessions = new Map(); // admin sessions in memory: token -> expiry
const today = () => localTs(new Date()).slice(0, 10);
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = ymd => { const d = new Date(ymd + 'T12:00:00Z'); return addDays(ymd, -((d.getUTCDay() + 6) % 7)); };
const nameOf = () => { const m = {}; for (const e of store.cache.employees || []) m[e.id] = e.name; return id => m[id] || ''; };

function live() {
  const t = today(), name = nameOf(), recent = store.between(addDays(t, -1), t);
  const nowAbs = Math.floor(Date.parse(localTs(new Date()) + 'Z') / 60000);
  const c = store.cache, cfg = store.config;
  return {
    now: localTs(new Date()), plant: c.plant, station: c.station || (cfg.stationName ? { name: cfg.stationName } : null),
    configured: { pin: !!cfg.pinHash, token: !!cfg.token, device: cfg.device.kind !== 'none' },
    employees: (c.employees || []).length,
    today: recent.filter(p => p.ts.startsWith(t)).slice(-60).reverse().map(p => ({ emp: p.emp, name: name(p.emp), time: p.ts.slice(11, 16), src: p.src })),
    todayCount: recent.filter(p => p.ts.startsWith(t)).length,
    inside: pair.inside(recent, c.shifts, nowAbs).map(x => ({ ...x, name: name(x.emp) })).sort((a, b) => a.since.localeCompare(b.since)),
    device: devices.status,
    sync: { lastSync: c.lastSync, lastTry: c.lastTry, lastError: c.lastError, offlineSince: c.offlineSince, pending: store.pending().length, running: sync.running },
    clockWarning: c.serverOffsetSec != null && Math.abs(c.serverOffsetSec) > 300 ? `El reloj de esta PC está ${Math.round(Math.abs(c.serverOffsetSec) / 60)} min ${c.serverOffsetSec > 0 ? 'atrasado' : 'adelantado'}. Corrígelo en Windows (Fecha y hora → Sincronizar ahora).` : null,
    shifts: c.shifts || [],
  };
}

function report(from, to) {
  const name = nameOf(), days = pair.workDays(store.between(addDays(from, -1), addDays(to, 1)), store.cache.shifts, from, to);
  const ids = new Set([...(store.cache.employees || []).map(e => e.id), ...Object.keys(days)]);
  const dates = []; for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return { from, to, dates, people: [...ids].map(id => {
    const d = days[id] || {}, total = Object.values(d).reduce((a, x) => a + x.hours, 0);
    return { id, name: name(id) || `EMPLEADO ${id}`, days: d, total: Math.round(total * 100) / 100, incomplete: Object.values(d).filter(x => x.incomplete).length };
  }).sort((a, b) => a.name.localeCompare(b.name)) };
}

/* ---------- http ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body); };
const readBody = (req, max = 20e6) => new Promise((resolve, reject) => { let b = ''; req.setEncoding('utf8'); req.on('data', c => { b += c; if (b.length > max) { req.destroy(); reject(new Error('Archivo demasiado grande')); } }); req.on('end', () => resolve(b)); req.on('error', reject); });
const cookie = (req, k) => { const m = new RegExp('(?:^|; )' + k + '=([^;]+)').exec(req.headers.cookie || ''); return m ? m[1] : ''; };
const isAdmin = req => { const t = cookie(req, 'ave_admin'), exp = t && sessions.get(t); return !!(exp && exp > Date.now()); };
const fails = { n: 0, until: 0 };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost'), p = u.pathname;
  try {
    // only pages opened on this PC (or the local network if enabled) may call the API
    if (req.method !== 'GET' && req.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(req.headers.origin)) return send(res, 403, { error: 'Origen no permitido' });
    if (p === '/' || p === '/admin') return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', p === '/' ? 'index.html' : 'admin.html')), MIME['.html']);
    if (p.startsWith('/static/')) {
      const f = path.join(ROOT, 'public', path.basename(p));
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream') : send(res, 404, 'No existe', 'text/plain');
    }
    if (p === '/api/live') return send(res, 200, live());
    if (p === '/api/login' && req.method === 'POST') {
      if (fails.until > Date.now()) return send(res, 429, { error: 'Demasiados intentos. Espera 5 minutos.' });
      const b = JSON.parse(await readBody(req, 1e4) || '{}');
      if (!store.config.pinHash) { // first time: the PIN is created here
        if (!/^\d{4,8}$/.test(String(b.pin || ''))) return send(res, 400, { error: 'El PIN debe tener de 4 a 8 números.' });
        store.saveConfig({ pinHash: store.pinHash(b.pin) }); store.log('PIN de administrador creado');
      } else if (store.pinHash(b.pin) !== store.config.pinHash) {
        if (++fails.n >= 5) { fails.until = Date.now() + 5 * 60000; fails.n = 0; }
        return send(res, 401, { error: 'PIN incorrecto.' });
      }
      fails.n = 0;
      const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, Date.now() + 8 * 3600e3);
      return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': `ave_admin=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
    }
    if (p === '/api/logout' && req.method === 'POST') { sessions.delete(cookie(req, 'ave_admin')); return send(res, 200, { ok: true }); }
    if (p === '/api/state') return send(res, 200, { pinSet: !!store.config.pinHash, admin: isAdmin(req) });

    /* ---- everything below: admin with PIN ---- */
    if (!p.startsWith('/api/')) return send(res, 404, 'No existe', 'text/plain');
    if (!isAdmin(req)) return send(res, 401, { error: 'Escribe el PIN de administrador.' });
    if (p === '/api/config' && req.method === 'GET') { const c = store.config; return send(res, 200, { server: c.server, token: c.token ? c.token.slice(0, 8) + '…' : '', hasToken: !!c.token, stationName: c.stationName, device: { ...c.device, password: c.device.password ? '••••' : '' }, pollSec: c.pollSec, syncMin: c.syncMin, data: DATA }); }
    if (p === '/api/config' && req.method === 'PUT') {
      const b = JSON.parse(await readBody(req, 1e5) || '{}'), c = {};
      if (b.server) { if (!/^https?:\/\/[\w.-]+(:\d+)?\/?$/.test(b.server)) return send(res, 400, { error: 'Dirección del servidor no válida.' }); c.server = b.server.replace(/\/$/, ''); }
      if (b.token) { if (!/^ave_[\w-]{20,}$/.test(b.token.trim())) return send(res, 400, { error: 'El código de la estación empieza con "ave_". Cópialo completo de gpoave.com.' }); c.token = b.token.trim(); }
      if (b.stationName != null) c.stationName = String(b.stationName).slice(0, 60);
      if (b.device) {
        const d = b.device, kinds = ['none', 'zk-pull', 'zk-push', 'hik'];
        if (!kinds.includes(d.kind)) return send(res, 400, { error: 'Tipo de terminal no válido.' });
        if (['zk-pull', 'hik'].includes(d.kind) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(d.ip || '')) return send(res, 400, { error: 'Escribe la IP de la terminal (ej. 192.168.1.201).' });
        c.device = { kind: d.kind, ip: d.ip || '', port: +d.port || (d.kind === 'hik' ? 80 : 4370), user: d.user || 'admin', pushPort: +d.pushPort || 8081 };
        if (d.password && d.password !== '••••') c.device.password = d.password;
      }
      if (b.newPin) { if (!/^\d{4,8}$/.test(String(b.newPin))) return send(res, 400, { error: 'El PIN debe tener de 4 a 8 números.' }); c.pinHash = store.pinHash(b.newPin); }
      store.saveConfig(c); store.log('Configuración guardada');
      if (c.device) devices.start();
      if (c.token) setTimeout(() => sync.syncNow(), 500);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/sync' && req.method === 'POST') return send(res, 200, await sync.syncNow());
    if (p === '/api/device/read' && req.method === 'POST') { await devices.readNow(); return send(res, 200, devices.status); }
    if (p === '/api/import' && req.method === 'POST') { const txt = await readBody(req); return send(res, 200, devices.importText(txt, decodeURIComponent(req.headers['x-file-name'] || 'archivo'))); }
    if (p === '/api/manual' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req, 1e4) || '{}');
      const emp = String(b.emp || '').replace(/\D/g, ''), ts = `${b.date}T${b.time}:00`;
      if (!emp) return send(res, 400, { error: 'Elige al empleado.' });
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(ts)) return send(res, 400, { error: 'Fecha u hora no válida.' });
      if (!String(b.by || '').trim()) return send(res, 400, { error: 'Escribe quién autoriza.' });
      const n = store.addPunches([{ uid: `man-${emp}-${ts}-${crypto.randomBytes(3).toString('hex')}`, emp, ts, src: 'manual', by: String(b.by).trim().slice(0, 60), note: String(b.note || '').slice(0, 200) }]);
      store.log(`Checada manual: ${emp} ${ts} (autorizó ${b.by}${b.note ? ', ' + b.note : ''})`);
      return send(res, 200, { ok: true, added: n });
    }
    if (p === '/api/report') {
      const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(v || ''), from = ok(u.searchParams.get('desde')) ? u.searchParams.get('desde') : mondayOf(today());
      const to = ok(u.searchParams.get('hasta')) ? u.searchParams.get('hasta') : addDays(from, 6);
      return send(res, 200, report(from, to));
    }
    if (p === '/api/export.csv') {
      const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(v || ''), from = ok(u.searchParams.get('desde')) ? u.searchParams.get('desde') : mondayOf(today()), to = ok(u.searchParams.get('hasta')) ? u.searchParams.get('hasta') : today();
      const name = nameOf(), q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
      const rows = [['ID', 'Nombre', 'Fecha', 'Hora', 'Origen', 'Autorizó', 'Enviada a gpoave.com'], ...store.between(from, to).map(x => [x.emp, name(x.emp), x.ts.slice(0, 10), x.ts.slice(11, 16), x.src, x.by || '', store.isSynced(x.uid) ? 'sí' : 'pendiente'])];
      return send(res, 200, '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="checadas_${from}_${to}.csv"` });
    }
    if (p === '/api/log') { let t = ''; try { t = fs.readFileSync(path.join(DATA, 'log.txt'), 'utf8'); } catch (e) { /* none yet */ } return send(res, 200, { lines: t.trim().split('\n').slice(-200).reverse() }); }
    return send(res, 404, { error: 'No existe' });
  } catch (e) {
    store.log('Error: ' + (e.stack || e.message));
    return send(res, 500, { error: e.message || 'Error' });
  }
});

server.on('error', e => { store.log(e.code === 'EADDRINUSE' ? `El puerto ${PORT} ya está en uso: ¿el checador ya está abierto?` : 'Error: ' + e.message); process.exit(1); });
server.listen(PORT, HOST, () => {
  store.log(`AVE Checador en sitio ${require('./package.json').version} listo en http://localhost:${PORT} · datos en ${DATA}`);
  try { fs.writeFileSync(path.join(DATA, 'pid.txt'), String(process.pid)); } catch (e) { /* not critical */ }
  devices.start();
  sync.start();
});
process.on('uncaughtException', e => store.log('Error inesperado: ' + (e.stack || e.message)));
process.on('unhandledRejection', e => store.log('Error inesperado: ' + ((e && e.stack) || e)));

'use strict';
/* Sends the punches to gpoave.com every hour. With no internet nothing is lost: punches wait in the
   "datos" folder and go on the next attempt that works (after a failure it retries every 5 minutes). */
const https = require('https');
const http = require('http');
const os = require('os');
const VERSION = require('../package.json').version;

module.exports = function (store, devices) {
  let timer = null, running = false;

  function post(url, token, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(url), lib = u.protocol === 'http:' ? http : https, data = JSON.stringify(body);
      const req = lib.request({ hostname: u.hostname, port: u.port || undefined, path: u.pathname, method: 'POST', timeout: 30000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: 'Bearer ' + token, 'User-Agent': 'AVE-Checador/' + VERSION } }, res => {
        let txt = ''; res.setEncoding('utf8'); res.on('data', c => { txt += c; });
        res.on('end', () => { let j = null; try { j = JSON.parse(txt); } catch (e) { /* not json */ } res.statusCode === 200 && j ? resolve(j) : reject(new Error((j && j.error) || `El servidor respondió ${res.statusCode}`)); });
      });
      req.on('timeout', () => req.destroy(new Error('Sin respuesta del servidor (tiempo agotado)')));
      req.on('error', e => reject(new Error(/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|ECONNRESET/.test(e.code || e.message) ? 'Sin internet o sin acceso a gpoave.com' : e.message)));
      req.write(data); req.end();
    });
  }

  async function syncNow() {
    if (running) return { busy: true };
    const c = store.config;
    if (!c.token) return { error: 'Falta el código de la estación (pídelo en gpoave.com → Asistencia → Jabil Torres).' };
    running = true;
    const tryAt = new Date().toISOString();
    try {
      let sent = 0, fresh = 0, last = null;
      // in batches, so a long offline stretch goes up in pieces
      for (let guard = 0; guard < 100; guard++) {
        const batch = store.pending().slice(0, 2000);
        const st = devices.status;
        last = await post(c.server.replace(/\/$/, '') + '/api/checador/sync', c.token, {
          station: { version: VERSION, hostname: os.hostname(), clock: new Date().toISOString(), pending: store.pending().length, offlineSince: store.cache.offlineSince,
            device: { kind: st.kind, ok: st.ok, ip: st.ip, serial: st.serial, lastRead: st.lastRead, error: st.error } },
          punches: batch.map(p => ({ uid: p.uid, emp: p.emp, ts: p.ts, src: p.src, by: p.by })),
        });
        store.markSynced(last.accepted || []);
        sent += (last.accepted || []).length; fresh += last.fresh || 0;
        if (batch.length < 2000 || !(last.accepted || []).length) break;
      }
      const offset = last.serverTime ? Math.round((Date.parse(last.serverTime) - Date.now()) / 1000) : null;
      store.saveCache({ employees: last.employees || [], shifts: last.shifts || [], plant: last.plant, station: last.station, lastSync: new Date().toISOString(), lastTry: tryAt, lastError: null, offlineSince: null, serverOffsetSec: offset });
      store.log(`Sincronizado con gpoave.com: ${sent} enviadas (${fresh} nuevas), ${store.pending().length} pendientes`);
      schedule(c.syncMin || 60);
      return { ok: true, sent, fresh, pending: store.pending().length };
    } catch (e) {
      store.saveCache({ lastTry: tryAt, lastError: e.message, offlineSince: store.cache.offlineSince || tryAt });
      store.log('No se pudo sincronizar: ' + e.message);
      schedule(5);
      return { error: e.message, pending: store.pending().length };
    } finally { running = false; }
  }
  function schedule(min) { clearTimeout(timer); timer = setTimeout(syncNow, min * 60000); }
  function start() { schedule(1); }

  return { start, syncNow, get running() { return running; } };
};

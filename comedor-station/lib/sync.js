'use strict';
/* Sends the meals to gpoave.com every hour and brings back the client's card list. With no internet nothing is
   lost: meals wait in the "datos" folder and go on the next attempt that works (retries every 5 minutes). */
const https = require('https');
const http = require('http');
const os = require('os');
const VERSION = require('../package.json').version;

module.exports = function (store) {
  let timer = null, running = false;
  function post(url, token, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(url), lib = u.protocol === 'http:' ? http : https, data = JSON.stringify(body);
      const req = lib.request({ hostname: u.hostname, port: u.port || undefined, path: u.pathname, method: 'POST', timeout: 30000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: 'Bearer ' + token, 'User-Agent': 'AVE-Comedor/' + VERSION } }, res => {
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
    if (!c.token) return { error: 'Falta el código de la estación (se genera en gpoave.com → Comidas → Meal Counter).' };
    running = true;
    const tryAt = new Date().toISOString();
    try {
      let sent = 0, fresh = 0, last = null;
      for (let guard = 0; guard < 100; guard++) {
        const day = require('./store').localTs(new Date()).slice(0, 10), batch = store.pending().slice(0, 2000), today = store.between(day, day).length, lastM = store.meals[store.meals.length - 1];
        last = await post(c.server.replace(/\/$/, '') + '/api/comedor/sync', c.token, {
          station: { version: VERSION, hostname: os.hostname(), clock: new Date().toISOString(), pending: store.pending().length, offlineSince: store.cache.offlineSince, lastSwipe: lastM ? lastM.ts : null, today },
          cardsAt: store.cache.cardsAt,
          meals: batch.map(m => ({ uid: m.uid, ts: m.ts, card: m.card, emp: m.emp, name: m.known ? undefined : m.name, raw: m.raw, src: m.src, by: m.by, note: m.note })),
        });
        store.markSynced(last.accepted || []);
        sent += (last.accepted || []).length; fresh += last.fresh || 0;
        if (batch.length < 2000 || !(last.accepted || []).length) break;
      }
      const upd = { plant: last.plant, station: last.station, settings: { ...store.cache.settings, ...(last.settings || {}) }, lastSync: new Date().toISOString(), lastTry: tryAt, lastError: null, offlineSince: null,
        serverOffsetSec: last.serverTime ? Math.round((Date.parse(last.serverTime) - Date.now()) / 1000) : null };
      if (last.cards) { const m = {}; for (const [card, emp, name] of last.cards) m[card] = { emp, name }; upd.cards = m; upd.cardsAt = last.cardsAt; store.log(`Lista de tarjetas actualizada: ${last.cards.length} tarjetas`); }
      store.saveCache(upd);
      store.log(`Sincronizado con gpoave.com: ${sent} comidas enviadas (${fresh} nuevas), ${store.pending().length} pendientes`);
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
  return { start: () => schedule(1), syncNow, get running() { return running; } };
};

'use strict';
/* Reading the face terminal. Three ways, depending on the brand:
     zk-pull   ZKTeco (and compatible) on the network: the program asks the terminal every minute (port 4370)
     zk-push   ZKTeco with "Servidor en la nube / ADMS": the terminal sends each punch to this PC (port 8081)
     hik       Hikvision face terminals (DS-K1T…): the program asks for access events every minute (ISAPI)
   Plus, for any brand: importing the file the terminal exports to a USB stick (attlog .dat / .txt / .csv). */
const http = require('http');
const crypto = require('crypto');
const { localTs } = require('./store');

module.exports = function (store) {
  const status = { kind: 'none', ok: false, ip: '', serial: '', lastRead: null, lastNew: null, error: null, users: null, records: null };
  let timer = null, pushServer = null, busy = false;

  function start() {
    stop();
    const d = store.config.device;
    Object.assign(status, { kind: d.kind, ok: false, ip: d.ip, serial: '', error: null, users: null, records: null });
    if (d.kind === 'zk-pull' || d.kind === 'hik') {
      const tick = async () => { if (busy) return; busy = true; try { await (d.kind === 'hik' ? readHik() : readZk()); } finally { busy = false; } };
      setTimeout(tick, 2000);
      timer = setInterval(tick, Math.max(20, store.config.pollSec || 60) * 1000);
    }
    if (d.kind === 'zk-push') startPush(d.pushPort || 8081);
  }
  function stop() { clearInterval(timer); timer = null; if (pushServer) { pushServer.close(); pushServer = null; } }
  const got = (list, label) => {
    const n = store.addPunches(list);
    status.ok = true; status.error = null; status.lastRead = new Date().toISOString();
    if (n) { status.lastNew = status.lastRead; store.log(`${label}: ${n} checada(s) nueva(s)`); }
    return n;
  };
  const fail = (e, label) => { const msg = (e && (e.message || e.err && e.err.message || String(e))) || 'error'; if (status.error !== msg) store.log(`${label}: ${msg}`); status.ok = false; status.error = msg; };

  /* ---------- ZKTeco, polling ---------- */
  async function readZk() {
    const d = store.config.device;
    const ZK = require('../vendor/node-zklib/zklib');
    const zk = new ZK(d.ip, +d.port || 4370, 10000, 4000);
    try {
      await zk.createSocket();
      try { const info = await zk.getInfo(); status.users = info.userCounts; status.records = info.logCounts; } catch (e) { /* some models don't answer this */ }
      const r = await zk.getAttendances();
      const list = (r && r.data || []).map(a => {
        const t = a.recordTime instanceof Date ? a.recordTime : new Date(a.recordTime);
        const ts = localTs(t), emp = String(a.deviceUserId || '').trim();
        return { uid: `zk-${d.ip}-${emp}-${ts}`, emp, ts, src: 'face' };
      });
      got(list, 'Terminal ZKTeco');
    } catch (e) { fail(e, 'Terminal ZKTeco'); }
    finally { try { await zk.disconnect(); } catch (e) { /* ignore */ } }
  }

  /* ---------- ZKTeco, push (ADMS / iclock) ---------- */
  const VERIFY = { 1: 'finger', 4: 'card', 15: 'face', 0: 'pin', 3: 'pin' };
  function startPush(port) {
    pushServer = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'), sn = u.searchParams.get('SN') || '';
      const reply = txt => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(txt); };
      if (sn) status.serial = sn;
      if (!u.pathname.startsWith('/iclock/')) { res.writeHead(404); return res.end(); }
      if (u.pathname === '/iclock/cdata' && req.method === 'GET') {
        status.ok = true; status.lastRead = new Date().toISOString(); status.error = null;
        return reply([`GET OPTION FROM: ${sn}`, 'ATTLOGStamp=None', 'OPERLOGStamp=9999', 'ATTPHOTOStamp=None', 'ErrorDelay=30', 'Delay=10', 'TransTimes=00:00;14:05', 'TransInterval=1', 'TransFlag=TransData AttLog', 'TimeZone=-7', 'Realtime=1', 'Encrypt=None'].join('\r\n'));
      }
      if (u.pathname === '/iclock/cdata' && req.method === 'POST') {
        let body = ''; req.setEncoding('utf8');
        req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
        req.on('end', () => {
          if ((u.searchParams.get('table') || '').toUpperCase() !== 'ATTLOG') return reply('OK');
          const list = [];
          for (const line of body.split(/\r?\n/)) {
            const f = line.split('\t'); if (f.length < 2) continue;
            const emp = f[0].trim(), m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(f[1].trim());
            if (!emp || !m) continue;
            list.push({ uid: `zk-${sn}-${emp}-${m[1]}T${m[2]}`, emp, ts: `${m[1]}T${m[2]}`, src: VERIFY[+f[3]] || 'face' });
          }
          got(list, `Terminal ${sn}`);
          reply(`OK: ${list.length}`);
        });
        return;
      }
      return reply('OK'); // getrequest / devicecmd / fdata: nothing to send
    });
    pushServer.on('error', e => fail(e, `Puerto ${port}`));
    pushServer.listen(port, '0.0.0.0', () => store.log(`Esperando checadas de la terminal en el puerto ${port}`));
  }

  /* ---------- Hikvision (ISAPI, digest auth) ---------- */
  function digestRequest(method, path, body) {
    const d = store.config.device;
    const once = auth => new Promise((resolve, reject) => {
      const req = http.request({ host: d.ip, port: +d.port || 80, method, path, timeout: 12000, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}), ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
        let data = ''; res.setEncoding('utf8'); res.on('data', c => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
      });
      req.on('timeout', () => req.destroy(new Error('La terminal no contesta (tiempo agotado)')));
      req.on('error', reject);
      if (body) req.write(body); req.end();
    });
    return once().then(r => {
      if (r.status !== 401) return r;
      const h = String(r.headers['www-authenticate'] || ''), g = k => { const m = new RegExp(k + '="?([^",]+)"?').exec(h); return m ? m[1] : ''; };
      const realm = g('realm'), nonce = g('nonce'), qop = g('qop') ? 'auth' : '', opaque = g('opaque'), nc = '00000001', cnonce = crypto.randomBytes(8).toString('hex');
      const md5 = s => crypto.createHash('md5').update(s).digest('hex');
      const ha1 = md5(`${d.user}:${realm}:${d.password}`), ha2 = md5(`${method}:${path}`);
      const resp = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
      const auth = `Digest username="${d.user}", realm="${realm}", nonce="${nonce}", uri="${path}", response="${resp}"` + (qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : '') + (opaque ? `, opaque="${opaque}"` : '');
      return once(auth);
    });
  }
  let hikSince = null;
  async function readHik() {
    const d = store.config.device;
    try {
      const now = new Date(), start = hikSince ? new Date(Date.parse(hikSince) - 15 * 60000) : new Date(now - 3 * 864e5);
      const iso = t => localTs(t) + '-07:00';
      const list = [];
      for (const minor of [75, 38, 1, 76]) { // face, fingerprint, card, face+card
        let pos = 0;
        for (let guard = 0; guard < 200; guard++) {
          const body = JSON.stringify({ AcsEventCond: { searchID: crypto.randomUUID(), searchResultPosition: pos, maxResults: 30, major: 5, minor, startTime: iso(start), endTime: iso(new Date(+now + 60000)) } });
          const r = await digestRequest('POST', '/ISAPI/AccessControl/AcsEvent?format=json', body);
          if (r.status === 401) throw new Error('Usuario o contraseña de la terminal incorrectos');
          if (r.status !== 200) throw new Error(`La terminal respondió ${r.status}`);
          const j = JSON.parse(r.data || '{}').AcsEvent || {}, info = j.InfoList || [];
          for (const e of info) {
            const emp = String(e.employeeNoString || e.employeeNo || '').trim(), ts = String(e.time || '').slice(0, 19);
            if (emp && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(ts)) list.push({ uid: `hik-${d.ip}-${e.serialNo || emp + '-' + ts}`, emp, ts, src: minor === 38 ? 'finger' : minor === 1 ? 'card' : 'face' });
          }
          pos += info.length;
          if (j.responseStatusStrg !== 'MORE' || !info.length) break;
        }
      }
      got(list, 'Terminal Hikvision');
      hikSince = now.toISOString();
    } catch (e) { fail(e, 'Terminal Hikvision'); }
  }

  /* ---------- file exported to USB (any brand) ---------- */
  function importText(text, fileName) {
    const list = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      // ZKTeco attlog.dat: "  382\t2026-11-26 06:01:02\t1\t15\t0\t0"; CSV: "382,2026-11-26,06:01" or "382;26/11/2026;06:01:02"
      const m = /^"?(\d{1,10})"?[\s,;\t]+"?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})"?[\sT,;\t]+"?(\d{1,2}:\d{2}(?::\d{2})?)/.exec(line);
      if (!m) continue;
      let ymd = m[2];
      if (ymd.includes('/')) { const [dd, mm, yy] = ymd.split('/'); ymd = `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`; }
      const hms = m[3].length <= 5 ? m[3].padStart(5, '0') + ':00' : m[3].padStart(8, '0');
      list.push({ uid: `file-${m[1]}-${ymd}T${hms}`, emp: m[1], ts: `${ymd}T${hms}`, src: 'import', note: fileName });
    }
    const n = store.addPunches(list);
    store.log(`Archivo ${fileName}: ${list.length} renglones leídos, ${n} checadas nuevas`);
    return { read: list.length, fresh: n };
  }

  return { start, stop, status, importText, readNow: async () => { const d = store.config.device; if (d.kind === 'zk-pull') await readZk(); else if (d.kind === 'hik') await readHik(); return status; } };
};

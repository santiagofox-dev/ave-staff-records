'use strict';
/* MEAL COUNTER (contador de comidas): receives the meals that the comedor PC of each plant counts with the
   card reader, and gives the counts for billing the client. The comedor PC works with no internet and
   sends its meals every hour; nothing here is needed for it to keep counting.

   Storage (DATA/comedor):
     stations.json                     comedor PCs and their tokens (only a hash is kept)
     <plant>/cards.json                the client's active cards (card number → employee), from the ACTIVOS export
     <plant>/settings.json             price per meal, etc.
     <plant>/meals-YYYY-MM.json        every meal, keyed by its unique id (re-sending is harmless) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Plants with a comedor counter. Jabil Torres first (Allan, Nov 26 2026); more are added here.
const PLANTS = {
  'jabil-torres': { id: 'jabil-torres', name: 'Jabil Torres', client: 'Jabil' },
};
const YMDHMS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const normCard = v => { const s = String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+(?=\d)/, ''); return s; };

/** What the reader typed → the card number on the list. The pcProx can be set to send only the card number
    (recommended), "FAC,ID", or facility code and number as one value (FAC × 65536 + ID); all land on the same card. */
function resolveCard(raw, cards) {
  const parts = String(raw || '').split(/\D+/).filter(Boolean).map(x => x.replace(/^0+(?=\d)/, ''));
  if (!parts.length) return { card: '', known: false };
  const tries = [];
  if (parts.length >= 2) tries.push(parts[parts.length - 1]);          // "FAC,ID" / "FAC:ID"
  const all = parts.join('');
  tries.push(all);
  const n = Number(all);
  if (Number.isSafeInteger(n) && n > 65535) {
    tries.push(String(n % 65536));                                      // FAC * 65536 + ID (a card number never passes 65535)
  }
  for (const t of tries) if (cards[t]) return { card: t, known: true };
  return { card: parts.length >= 2 ? parts[parts.length - 1] : (n > 65535 ? String(n % 65536) : all), known: false, raw: String(raw).slice(0, 40) };
}

module.exports = function ({ DATA_DIR }) {
  const ROOT = path.join(DATA_DIR, 'comedor');
  fs.mkdirSync(ROOT, { recursive: true });
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const writeJ = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };
  const pdir = pl => path.join(ROOT, pl);
  const err = (status, msg) => Object.assign(new Error(msg), { status });
  const todayLocal = () => new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const mondayOf = ymd => { const d = new Date(ymd + 'T12:00:00Z'); return addDays(ymd, -((d.getUTCDay() + 6) % 7)); };

  /* ---------- stations ---------- */
  const stationsFile = path.join(ROOT, 'stations.json');
  const stations = () => readJ(stationsFile, { stations: [] });
  const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
  const publicStation = s => ({ id: s.id, plant: s.plant, name: s.name, createdAt: s.createdAt, by: s.by, lastSync: s.lastSync, version: s.version, info: s.info || null, revoked: s.revoked || null, pending: s.pending || 0, totalSent: s.totalSent || 0 });
  function createStation(plant, name, by) {
    const token = 'avc_' + crypto.randomBytes(24).toString('base64url');
    const st = stations();
    const s = { id: crypto.randomBytes(6).toString('hex'), plant, name: String(name || 'Comedor').slice(0, 60), hash: hash(token), createdAt: new Date().toISOString(), by, lastSync: null };
    st.stations.push(s); writeJ(stationsFile, st);
    return { station: publicStation(s), token };
  }
  function stationByToken(token) {
    if (!token) return null;
    const hh = hash(token), st = stations();
    const s = st.stations.find(x => !x.revoked && x.hash.length === hh.length && crypto.timingSafeEqual(Buffer.from(x.hash), Buffer.from(hh)));
    return s ? { st, s } : null;
  }

  /* ---------- cards & settings ---------- */
  const cardsOf = pl => readJ(path.join(pdir(pl), 'cards.json'), { cards: {}, updatedAt: null });
  const settingsOf = pl => ({ price: 0, debounceSec: 10, ...readJ(path.join(pdir(pl), 'settings.json'), {}) });
  async function importCards(pl, file, original, by) {
    const { loadWorkbook, normName } = require('./meals-core');
    const wb = await loadWorkbook(file);
    const cards = {}, dupes = [];
    let externos = 0;
    for (const ws of wb.worksheets) {
      let hdr = null, col = {};
      for (let r = 1; r <= Math.min(ws.rowCount, 20) && !hdr; r++) {
        const m = {}; ws.getRow(r).eachCell({ includeEmpty: false }, (c, n) => { const t = normName(String(c.value == null ? '' : (c.value.result ?? c.value.text ?? c.value))); if (t) m[t] = n; });
        const cardC = m['CARD NUMBER'] || m['TARJETA'] || m['NUMERO DE TARJETA'] || m['NO TARJETA'] || m['CARD'];
        if (cardC) { hdr = r; col = { card: cardC, emp: m['NO EMPLEADO'] || m['NO. EMPLEADO'] || m['NUMERO DE EMPLEADO'] || m['EMPLEADO'] || m['EMPLOYEE ID'] || null, last: m['LAST NAME'] || m['APELLIDOS'] || m['APELLIDO'] || null, first: m['FIRST NAME'] || m['NOMBRE'] || m['NOMBRES'] || null, name: m['NOMBRE COMPLETO'] || null }; }
      }
      if (!hdr) continue;
      for (let r = hdr + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r), v = c => { if (!c) return ''; const x = row.getCell(c).value; return String(x == null ? '' : (x.result ?? x.text ?? x)).trim(); };
        const card = normCard(v(col.card)); if (!card) continue;
        const emp = v(col.emp).replace(/\.0$/, '');
        const name = (col.name ? v(col.name) : `${v(col.first)} ${v(col.last)}`).replace(/\s+/g, ' ').trim().toUpperCase();
        if (/EXTERNO/i.test(emp)) externos++;
        if (cards[card]) dupes.push(card);
        cards[card] = { card, emp: /^\d+$/.test(emp) ? emp : '', tag: /^\d+$/.test(emp) ? '' : emp.toUpperCase().slice(0, 20), name };
      }
      if (Object.keys(cards).length) break;
    }
    const n = Object.keys(cards).length;
    if (!n) throw err(400, 'No encontré tarjetas. El Excel necesita una columna "Card Number" (o "Tarjeta") y el nombre.');
    const prev = cardsOf(pl).cards;
    writeJ(path.join(pdir(pl), 'cards.json'), { cards, updatedAt: new Date().toISOString(), by, file: original });
    return { count: n, added: Object.keys(cards).filter(c => !prev[c]).length, removed: Object.keys(prev).filter(c => !cards[c]).length, externos, dupes };
  }

  /* ---------- meals ---------- */
  const monthFile = (pl, ym) => path.join(pdir(pl), `meals-${ym}.json`);
  function storeMeals(pl, list, stationId) {
    const byMonth = {}, accepted = [], now = Date.now();
    for (const m of list || []) {
      const uid = String(m.uid || '').slice(0, 80), ts = String(m.ts || '').slice(0, 19);
      if (!uid || !YMDHMS.test(ts)) continue;
      const t = Date.parse(ts + 'Z');
      if (!(t > now - 400 * 864e5 && t < now + 2 * 864e5)) continue;
      const card = normCard(m.card).slice(0, 12), emp = String(m.emp || '').replace(/\D/g, '').slice(0, 12);
      if (!card && !emp && m.src !== 'manual') continue; // manual meals for visitors carry no card
      (byMonth[ts.slice(0, 7)] = byMonth[ts.slice(0, 7)] || []).push({ uid, ts, card, emp, raw: m.raw ? String(m.raw).slice(0, 40) : undefined, src: m.src === 'manual' ? 'manual' : 'card',
        by: m.by ? String(m.by).slice(0, 60) : undefined, note: m.note ? String(m.note).slice(0, 200) : undefined, name: m.name ? String(m.name).slice(0, 80) : undefined, station: stationId, at: new Date().toISOString() });
      accepted.push(uid);
    }
    let fresh = 0;
    for (const [ym, arr] of Object.entries(byMonth)) {
      const f = monthFile(pl, ym), cur = readJ(f, {});
      for (const m of arr) if (!cur[m.uid]) { cur[m.uid] = m; fresh++; }
      writeJ(f, cur);
    }
    return { accepted, fresh };
  }
  function mealsBetween(pl, from, to) {
    const out = [];
    let ym = from.slice(0, 7);
    while (ym <= to.slice(0, 7)) {
      for (const m of Object.values(readJ(monthFile(pl, ym), {}))) { const d = m.ts.slice(0, 10); if (d >= from && d <= to) out.push(m); }
      const [y, mo] = ym.split('-').map(Number); ym = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    return out.sort((a, b) => a.ts.localeCompare(b.ts));
  }
  /** Who each meal belongs to, by today's card list (a card added later stops being "no registrada"). */
  function enrich(pl, list) {
    const cards = cardsOf(pl).cards, byEmp = {};
    for (const c of Object.values(cards)) if (c.emp) byEmp[c.emp] = c;
    return list.map(m => { const c = (m.card && cards[m.card]) || (m.emp && byEmp[m.emp]) || null; return { ...m, known: !!c, name: c ? c.name : (m.name || ''), emp: c ? c.emp : (m.emp || ''), tag: c ? c.tag : '' }; });
  }

  function report(pl, from, to) {
    const list = enrich(pl, mealsBetween(pl, from, to)), price = settingsOf(pl).price || 0;
    const days = {}; for (let d = from; d <= to; d = addDays(d, 1)) days[d] = { ymd: d, total: 0, known: 0, unknown: 0, manual: 0, hours: Array(24).fill(0) };
    const unknown = {}, people = {};
    for (const m of list) {
      const d = days[m.ts.slice(0, 10)]; if (!d) continue;
      d.total++; m.known ? d.known++ : d.unknown++; if (m.src === 'manual') d.manual++; d.hours[+m.ts.slice(11, 13)]++;
      if (!m.known) { const k = m.card || (m.emp ? 'emp' + m.emp : 'manual'); const u = unknown[k] = unknown[k] || { card: m.card, emp: m.emp, name: m.name, manual: !m.card && !m.emp, count: 0, first: m.ts, last: m.ts }; u.count++; u.last = m.ts; }
      else { const p = people[m.card || m.emp] = people[m.card || m.emp] || { card: m.card, emp: m.emp, name: m.name, tag: m.tag, count: 0 }; p.count++; }
    }
    const total = list.length;
    return { plant: PLANTS[pl], from, to, price, total, known: list.filter(m => m.known).length, unknown: list.filter(m => !m.known).length, amount: Math.round(total * price * 100) / 100,
      days: Object.values(days), unknownCards: Object.values(unknown).sort((a, b) => b.count - a.count), people: Object.values(people).sort((a, b) => b.count - a.count), list };
  }

  async function excel(pl, from, to) {
    const ExcelJS = require('exceljs');
    const r = report(pl, from, to), P = PLANTS[pl];
    const wb = new ExcelJS.Workbook(); wb.creator = 'Grupo AVE';
    const head = (ws, cols) => { ws.columns = cols; const h = ws.getRow(1); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2328' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
    const DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const ws = wb.addWorksheet('Resumen');
    head(ws, [{ header: 'Fecha', key: 'f', width: 13 }, { header: 'Día', key: 'd', width: 12 }, { header: 'Comidas', key: 't', width: 11 }, { header: 'Con tarjeta registrada', key: 'k', width: 14 }, { header: 'Tarjeta no registrada', key: 'u', width: 14 }, { header: 'Capturadas a mano', key: 'm', width: 12 }, ...(r.price ? [{ header: 'Importe', key: 'a', width: 14 }] : [])]);
    for (const d of r.days) ws.addRow({ f: new Date(d.ymd + 'T12:00:00Z'), d: DIA[new Date(d.ymd + 'T12:00:00Z').getUTCDay()], t: d.total, k: d.known, u: d.unknown, m: d.manual, a: r.price ? d.total * r.price : undefined });
    const tot = ws.addRow({ f: 'TOTAL', t: r.total, k: r.known, u: r.unknown, m: r.days.reduce((a, d) => a + d.manual, 0), a: r.price ? r.amount : undefined }); tot.font = { bold: true };
    ws.getColumn('f').numFmt = 'dd/mm/yyyy'; if (r.price) ws.getColumn('a').numFmt = '"$"#,##0.00';
    ws.addRow([]); ws.addRow([`${P.client} · ${P.name} · del ${from} al ${to}`]); if (r.price) ws.addRow([`Precio por comida: $${r.price.toFixed(2)}`]);
    const det = wb.addWorksheet('Detalle');
    head(det, [{ header: 'Fecha', key: 'f', width: 12 }, { header: 'Hora', key: 'h', width: 9 }, { header: 'Tarjeta', key: 'c', width: 10 }, { header: 'No. empleado', key: 'e', width: 12 }, { header: 'Nombre', key: 'n', width: 38 }, { header: 'Registrada', key: 'k', width: 11 }, { header: 'Origen', key: 's', width: 10 }, { header: 'Autorizó / nota', key: 'b', width: 30 }]);
    for (const m of r.list) det.addRow({ f: m.ts.slice(0, 10), h: m.ts.slice(11, 19), c: m.card, e: m.emp || m.tag, n: m.name, k: m.known ? 'sí' : 'NO', s: m.src === 'manual' ? 'manual' : 'tarjeta', b: [m.by, m.note].filter(Boolean).join(' · ') });
    const un = wb.addWorksheet('No registradas');
    head(un, [{ header: 'Tarjeta', key: 'c', width: 10 }, { header: 'Comidas', key: 'n', width: 10 }, { header: 'Primera', key: 'a', width: 18 }, { header: 'Última', key: 'b', width: 18 }]);
    for (const u of r.unknownCards) un.addRow({ c: u.card || (u.emp ? `emp ${u.emp}` : 'sin tarjeta (manual)'), n: u.count, a: u.first.replace('T', ' '), b: u.last.replace('T', ' ') });
    const pp = wb.addWorksheet('Por empleado');
    head(pp, [{ header: 'Tarjeta', key: 'c', width: 10 }, { header: 'No. empleado', key: 'e', width: 12 }, { header: 'Nombre', key: 'n', width: 38 }, { header: 'Comidas', key: 't', width: 10 }]);
    for (const p of r.people) pp.addRow({ c: p.card, e: p.emp || p.tag, n: p.name, t: p.count });
    return wb.xlsx.writeBuffer();
  }

  function state(pl) {
    const t = todayLocal(), wk = mondayOf(t);
    const today = report(pl, t, t), week = report(pl, wk, addDays(wk, 6)), c = cardsOf(pl);
    return {
      plant: PLANTS[pl], plants: Object.values(PLANTS), today: t, settings: settingsOf(pl),
      cards: { count: Object.keys(c.cards).length, file: c.file || null, at: c.updatedAt },
      stations: stations().stations.filter(s => s.plant === pl).map(publicStation),
      todayTotal: today.total, todayUnknown: today.unknown, todayHours: today.days[0].hours, last: today.list.slice(-25).reverse().map(m => ({ time: m.ts.slice(11, 16), card: m.card, emp: m.emp, name: m.name, known: m.known, src: m.src })),
      week: { from: wk, days: week.days.map(d => ({ ymd: d.ymd, total: d.total, unknown: d.unknown })), total: week.total, amount: week.amount },
    };
  }

  /* ---------- HTTP ---------- */
  function publicRoutes(app) {
    app.post('/api/comedor/sync', (req, res) => {
      const auth = String(req.get('authorization') || ''), found = stationByToken(auth.startsWith('Bearer ') ? auth.slice(7).trim() : '');
      if (!found) return res.status(401).json({ error: 'Estación no autorizada. Genera un código nuevo en gpoave.com → Comidas → Meal Counter.' });
      const { st, s } = found, b = req.body || {};
      let r;
      try { r = storeMeals(s.plant, Array.isArray(b.meals) ? b.meals.slice(0, 5000) : [], s.id); }
      catch (e) { console.error('comedor sync', e); return res.status(500).json({ error: 'No se pudieron guardar las comidas. Se reintenta en la próxima sincronización.' }); }
      const info = b.station || {};
      s.lastSync = new Date().toISOString(); s.version = String(info.version || '').slice(0, 20);
      s.info = { hostname: String(info.hostname || '').slice(0, 60), clock: info.clock || null, offlineSince: info.offlineSince || null, lastSwipe: info.lastSwipe || null, today: +info.today || 0 };
      s.pending = Math.max(0, (+info.pending || 0) - r.accepted.length); s.totalSent = (s.totalSent || 0) + r.fresh;
      writeJ(stationsFile, st);
      const c = cardsOf(s.plant);
      res.json({ ok: true, accepted: r.accepted, fresh: r.fresh, plant: PLANTS[s.plant], station: { id: s.id, name: s.name }, settings: { debounceSec: settingsOf(s.plant).debounceSec },
        cardsAt: c.updatedAt, cards: b.cardsAt && b.cardsAt === c.updatedAt ? null : Object.values(c.cards).map(x => [x.card, x.emp || x.tag, x.name]), serverTime: new Date().toISOString() });
    });
  }
  function adminRoutes(app, { who }) {
    const plantQ = req => { const p = String((req.query && req.query.planta) || (req.body && req.body.planta) || Object.keys(PLANTS)[0]); if (!PLANTS[p]) throw err(400, 'Esa planta no tiene contador de comidas.'); return p; };
    const J = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Ocurrió un error.' }); if (!e.status) console.error(e); } };
    const range = req => { const to = YMD.test(req.query.hasta || '') ? req.query.hasta : todayLocal(), from = YMD.test(req.query.desde || '') ? req.query.desde : mondayOf(to); if (from > to) throw err(400, 'Rango de fechas al revés.'); return { from, to }; };
    app.get('/comidas/contador', (req, res) => res.sendFile(path.join(__dirname, 'public', 'comedor.html')));
    app.get('/api/comedor/state', J(req => state(plantQ(req))));
    app.get('/api/comedor/report', J(req => { const { from, to } = range(req), r = report(plantQ(req), from, to); delete r.list; return r; }));
    app.put('/api/comedor/settings', J(req => {
      const pl = plantQ(req), b = req.body || {}, cur = settingsOf(pl);
      if (b.price != null) { const p = Number(b.price); if (!(p >= 0 && p < 10000)) throw err(400, 'Precio no válido.'); cur.price = Math.round(p * 100) / 100; }
      if (b.debounceSec != null) { const d = Number(b.debounceSec); if (!(d >= 0 && d <= 600)) throw err(400, 'El tiempo entre lecturas debe ser de 0 a 600 segundos.'); cur.debounceSec = d; }
      cur.updatedAt = new Date().toISOString(); cur.by = who(req);
      writeJ(path.join(pdir(pl), 'settings.json'), cur); return cur;
    }));
    app.post('/api/comedor/stations', J(req => createStation(plantQ(req), (req.body || {}).name, who(req))));
    app.delete('/api/comedor/stations/:id', J(req => { const st = stations(), s = st.stations.find(x => x.id === req.params.id); if (!s) throw err(404, 'No existe esa estación.'); s.revoked = new Date().toISOString(); s.revokedBy = who(req); writeJ(stationsFile, st); return { ok: true }; }));
    const multer = require('multer');
    const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('file');
    app.post('/api/comedor/cards', (req, res) => up(req, res, async e => {
      if (e || !req.file) return res.status(400).json({ error: 'No se pudo recibir el archivo.' });
      if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Sube un Excel (.xlsx).' });
      const tmp = path.join(require('os').tmpdir(), 'cards-' + crypto.randomBytes(6).toString('hex') + '.xlsx');
      try { const pl = plantQ(req); fs.writeFileSync(tmp, req.file.buffer); res.json(await importCards(pl, tmp, req.file.originalname, who(req))); }
      catch (x) { res.status(x.status || 400).json({ error: x.message }); }
      finally { fs.rmSync(tmp, { force: true }); }
    }));
    app.get('/api/comedor/excel', async (req, res) => {
      try {
        const pl = plantQ(req), { from, to } = range(req), buf = await excel(pl, from, to);
        res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="Comidas_${pl}_${from}_${to}.xlsx"`).send(Buffer.from(buf));
      } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo generar el Excel.' }); if (!e.status) console.error(e); }
    });
    app.get('/api/comedor/programa.zip', (req, res) => {
      const v = require('./comedor-station/package.json').version;
      res.set('Content-Type', 'application/zip').set('Content-Disposition', `attachment; filename="AVE-Comedor-${v}.zip"`).send(zipFolder(path.join(__dirname, 'comedor-station'), 'AVE-Comedor'));
    });
  }

  return { publicRoutes, adminRoutes, resolveCard, storeMeals, report, importCards, state, excel, PLANTS };
};

/** Minimal ZIP writer (deflate) for handing out the station program. */
function zipFolder(dirRoot, prefix) {
  const zlib = require('zlib'), files = [];
  const walk = (d, rel) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name === 'datos' || f.name.startsWith('.')) continue; const full = path.join(d, f.name), r = rel ? rel + '/' + f.name : f.name; f.isDirectory() ? walk(full, r) : files.push([r, full]); } };
  walk(dirRoot, '');
  const T = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c; }
  const crc32 = b => { let c = -1; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const parts = [], central = []; let off = 0;
  const d = new Date(), dt = ((d.getFullYear() - 1980) << 25) | ((d.getMonth() + 1) << 21) | (d.getDate() << 16) | (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  for (const [rel, full] of files) {
    const raw = fs.readFileSync(full), comp = zlib.deflateRawSync(raw), name = Buffer.from(prefix + '/' + rel, 'utf8'), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(dt >>> 0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(dt >>> 0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
module.exports.resolveCard = resolveCard;

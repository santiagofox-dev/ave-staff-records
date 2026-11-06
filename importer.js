'use strict';
/*
 * Imports employee folders and the EXPEDIENTES spreadsheet straight from a Dropbox shared link.
 * Files go Dropbox → this server → the private disk; they never pass through anything else.
 * One job runs at a time; the page polls /api/import/status.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const yauzl = require('yauzl');
const ExcelJS = require('exceljs');

const MIME = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.heic': 'image/heic', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const title = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Del|La|Las|Los|Y)\b/g, w => w.toLowerCase());
const tokens = s => norm(s).split(' ').filter(t => t.length > 1);

function docType(file, personName) {
  const n = norm(path.basename(file, path.extname(file)));
  const rules = [
    [/ACTA ADMIN/, 'Acta administrativa'],
    [/\bDC ?3\b|\bDC3\b|HABILIDADES/, 'Constancia DC-3'],
    [/ALTA|\bIMSS\b|AFIL/, 'Alta IMSS'],
    [/LABORATOR|EXAMEN|ANALISIS|ANTIDOP|COPRO|EXUDADO|REACCION|BIOMETR|TOXIC|PRUEBA/, 'Laboratorios'],
    [/CERTIFICADO MEDICO|MEDICO|SALUD/, 'Certificado médico'],
    [/CONTRATO/, 'Contrato'],
    [/NACIMIENTO|\bACTA\b/, 'Acta de nacimiento'],
    [/\bCURP\b/, 'CURP'],
    [/\bRFC\b|\bCSF\b|SITUACION FISCAL|CONSTANCIA FISCAL|\bSAT\b/, 'RFC / Constancia fiscal'],
    [/\bNSS\b|SEGURO SOCIAL/, 'NSS (IMSS)'],
    [/\bINE\b|\bIFE\b|IDENTIFICACION|CREDENCIAL/, 'INE'],
    [/DOMICILIO|COMPROBANTE|RECIBO|\bLUZ\b|\bAGUA\b|\bCFE\b/, 'Comprobante de domicilio'],
    [/SOLICITUD|\bCV\b|CURRICUL/, 'Solicitud / CV'],
    [/CARATULA/, 'Carátula'],
    [/ESTUDIO|SOCIOECON/, 'Estudio socioeconómico'],
    [/CARTA|RECOMEND/, 'Carta'],
    [/ESTUDIOS|CERTIFICADO|TITULO|BOLETA/, 'Comprobante de estudios'],
  ];
  for (const [re, t] of rules) if (re.test(n)) return t;
  const pt = tokens(personName), ft = tokens(n);
  if (pt.length && pt.filter(t => ft.includes(t)).length >= Math.min(2, pt.length)) return 'Expediente completo';
  return 'Otro';
}

// "100-JENNIFER GUADALUPE …" → {number:'100', name:'JENNIFER GUADALUPE …'}
function parseFolder(f) {
  const m = String(f).trim().match(/^(\d{1,6})\s*[-–_. ]?\s*(.*)$/);
  let num = m ? m[1] : '', name = (m ? m[2] : f).replace(/\b(JRZ|JUAREZ|GDL|MTY|TIJ|CUU|CHIH)\b\s*$/i, '').trim();
  return { number: num, name };
}

function sameName(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return false;
  if (A.join(' ') === B.join(' ')) return true;
  const [s, l] = A.length <= B.length ? [A, B] : [B, A];
  const hit = s.filter(t => l.includes(t)).length;
  return s.length >= 2 && hit >= Math.max(2, Math.ceil(s.length * 0.75));
}

function birthdayFromCurp(c) {
  const m = String(c || '').toUpperCase().match(/^[A-Z]{4}(\d{2})(\d{2})(\d{2})[HMX][A-Z]{5}([0-9A-Z])\d$/);
  if (!m) return '';
  const yy = +m[1], century = /\d/.test(m[4]) ? 1900 : 2000;
  const mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${century + yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';
function decodeName(buf, flag) {
  if (typeof buf === 'string') return buf;
  const u = buf.toString('utf8');
  if ((flag & 0x800) || !u.includes('\uFFFD')) return u;
  return Array.from(buf, b => (b < 128 ? String.fromCharCode(b) : CP437[b - 128])).join('');
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return cellText(v.result);
    if (v.hyperlink) return String(v.hyperlink);
    if (v.error) return '';
    return '';
  }
  return String(v).trim();
}
function toISODate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.result != null) return toISODate(v.result);
  if (typeof v === 'number' && v > 10000 && v < 80000) { // Excel serial day
    const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return d.toISOString().slice(0, 10);
  }
  const s = cellText(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); // dd/mm/yyyy (México)
  if (m) { let y = +m[3]; if (y < 100) y += y > 30 ? 1900 : 2000; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return '';
}

module.exports = function (app, { state, persist, UPLOAD_DIR, DATA_DIR }) {
  const WORK = path.join(DATA_DIR, 'import');
  fs.mkdirSync(WORK, { recursive: true });
  const SHEET = path.join(WORK, 'sheet.json');
  let job = { running: false, log: [] };
  const log = m => { job.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`); if (job.log.length > 400) job.log.shift(); console.log('[import]', m); };

  function dropboxURL(u, dl) {
    const url = new URL(u);
    if (url.hostname !== 'www.dropbox.com' || !url.pathname.startsWith('/scl/')) throw new Error('Solo se aceptan enlaces compartidos de Dropbox.');
    url.searchParams.set('dl', dl ? '1' : '0');
    return url.toString();
  }
  async function download(u, dest) {
    const r = await fetch(dropboxURL(u, true), { redirect: 'follow' });
    if (!r.ok) throw new Error(`Dropbox respondió ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
    return fs.statSync(dest).size;
  }
  function start(kind, fn) {
    if (job.running) return false;
    job = { running: true, kind, startedAt: new Date().toISOString(), log: [], progress: null, result: null, error: null };
    fn().then(r => { job.result = r; log('Listo.'); }).catch(e => { job.error = e.message; log('ERROR: ' + e.message); })
      .finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); persist(); });
    return true;
  }
  app.get('/api/import/status', (req, res) => res.json(job));

  /* ---------- spreadsheet: download + read every sheet into sheet.json ---------- */
  app.post('/api/import/sheet', (req, res) => {
    const { url } = req.body || {};
    try { dropboxURL(url, true); } catch (e) { return res.status(400).json({ error: e.message }); }
    const ok = start('sheet', async () => {
      const f = path.join(WORK, 'sheet.xlsx');
      log('Descargando hoja de cálculo…');
      const size = await download(url, f);
      log(`Descargada (${(size / 1048576).toFixed(1)} MB). Leyendo…`);
      const reader = new ExcelJS.stream.xlsx.WorkbookReader(f, { worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', entries: 'emit' });
      const sheets = [];
      for await (const ws of reader) {
        const rows = [];
        for await (const row of ws) {
          const vals = (row.values || []).slice(1).map(v => (v instanceof Date ? v.toISOString().slice(0, 10) : (typeof v === 'number' ? v : cellText(v))));
          while (vals.length && (vals[vals.length - 1] === '' || vals[vals.length - 1] == null)) vals.pop();
          if (vals.some(v => v !== '' && v != null)) rows.push({ r: row.number, v: vals });
          if (rows.length > 5000) break;
        }
        sheets.push({ name: ws.name || `Hoja ${sheets.length + 1}`, rows });
        log(`Hoja "${ws.name}": ${rows.length} filas`);
      }
      fs.writeFileSync(SHEET, JSON.stringify(sheets));
      fs.rmSync(f, { force: true });
      return { sheets: sheets.map(s => ({ name: s.name, rows: s.rows.length })) };
    });
    res.status(ok ? 202 : 409).json(ok ? { ok: true } : { error: 'Ya hay una importación en curso.' });
  });
  // first N rows of each sheet, so the column layout can be mapped
  app.get('/api/import/sheet-preview', (req, res) => {
    if (!fs.existsSync(SHEET)) return res.status(404).json({ error: 'Primero descarga la hoja.' });
    const n = Math.min(+req.query.rows || 6, 40);
    const sheets = JSON.parse(fs.readFileSync(SHEET, 'utf8'));
    res.json(sheets.map(s => ({ name: s.name, total: s.rows.length, rows: s.rows.slice(0, n).map(x => ({ r: x.r, v: x.v.map(c => String(c ?? '').slice(0, 60)) })) })));
  });

  /* ---------- one plant folder: download zip, one employee per sub-folder ---------- */
  app.post('/api/import/plant', (req, res) => {
    const { url, plant } = req.body || {};
    try { dropboxURL(url, true); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (!plant || typeof plant !== 'string') return res.status(400).json({ error: 'Falta el nombre de la planta.' });
    const status = req.body.status === 'baja' ? 'baja' : 'activo';
    const ok = start('plant', () => importPlant(url, plant.trim().slice(0, 60), { status }));
    res.status(ok ? 202 : 409).json(ok ? { ok: true } : { error: 'Ya hay una importación en curso.' });
  });

  async function importPlant(url, plant, opts = {}) {
    const zipPath = path.join(WORK, 'plant.zip');
    log(`${plant}: descargando carpeta de Dropbox…`);
    const size = await download(url, zipPath);
    log(`${plant}: descargada (${(size / 1048576).toFixed(1)} MB). Extrayendo…`);
    const zip = await yauzl.openPromise(zipPath, { autoClose: false, lazyEntries: true, decodeStrings: false, validateEntrySizes: true });
    const entries = [];
    for await (const e of zip.eachEntry()) {
      e.fileName = decodeName(e.fileName, e.generalPurposeBitFlag);
      if (!/\/$/.test(e.fileName)) entries.push(e);
    }
    // Dropbox zips have no common root for sub-folder links, but strip one if present
    const folderName = norm(decodeURIComponent(new URL(url).pathname.split('/').pop() || ''));
    const segs = entries.map(e => e.fileName.replace(/^\/+/, '').split('/'));
    const roots = new Set(segs.map(s => s[0]));
    const strip = roots.size === 1 && (norm([...roots][0]) === folderName || segs.every(s => s.length > 2)) ? 1 : 0;

    const byKey = new Map(); // employee folder key → {folders:Set, files:[]}
    const dc3 = [], loose = [];
    for (const e of entries) {
      const parts = e.fileName.replace(/^\/+/, '').split('/').slice(strip);
      const base = parts[parts.length - 1];
      if (/^\.|^~\$|thumbs\.db$|desktop\.ini$/i.test(base)) continue;
      if (parts.length === 1) { loose.push(e); continue; }
      const folder = parts[0];
      if (/\bDC ?-?3\b|\bDC3\b/i.test(folder)) { dc3.push({ e, parts }); continue; }
      const { number, name } = parseFolder(folder);
      const key = number ? `n:${number}` : `m:${norm(name)}`;
      if (!byKey.has(key)) byKey.set(key, { number, names: [], files: [] });
      const g = byKey.get(key);
      if (!g.names.includes(name)) g.names.push(name);
      g.files.push({ e, rel: parts.slice(1).join('/') });
    }
    log(`${plant}: ${byKey.size} empleados, ${dc3.length} archivos DC-3, ${loose.length} archivos sueltos.`);
    job.progress = { done: 0, total: byKey.size, plant };

    const stats = { employees: 0, created: 0, docs: 0, skipped: 0, bytes: 0, dc3Matched: 0, dc3Unmatched: [] };
    const plantEmps = () => Object.values(state.employees).filter(x => x.site === plant);

    async function save(entry, emp, fileName, type) {
      const ext = path.extname(fileName).toLowerCase();
      if (!MIME[ext]) { stats.skipped++; return; }
      if ((emp.docs || []).some(d => d.srcPath === entry.fileName)) { stats.skipped++; return; } // already imported
      const stored = crypto.randomUUID() + ext;
      const rs = await zip.openReadStreamPromise(entry);
      await pipeline(rs, fs.createWriteStream(path.join(UPLOAD_DIR, stored)));
      emp.docs = (emp.docs || []).concat({
        id: crypto.randomBytes(10).toString('hex'), type, fileName: fileName.slice(0, 160), size: entry.uncompressedSize,
        mime: MIME[ext], stored, srcPath: entry.fileName, uploadedAt: new Date().toISOString(),
      });
      stats.docs++; stats.bytes += entry.uncompressedSize;
    }

    for (const [key, g] of byKey) {
      const longest = g.names.slice().sort((a, b) => b.length - a.length)[0] || '';
      const id = crypto.createHash('sha1').update(`${norm(plant)}|${key}`).digest('hex').slice(0, 24);
      let emp = state.employees[id];
      if (!emp) {
        emp = { id, name: title(longest), position: '', site: plant, phone: '', emerg: '', notes: '', birthday: '', hire: '',
          number: g.number, curp: '', rfc: '', nss: '', address: '', status: opts.status || 'activo', extra: {}, trainings: [], docs: [], src: { plant, folders: g.names },
          createdAt: new Date().toISOString() };
        state.employees[id] = emp; stats.created++;
      }
      for (const f of g.files) await save(f.e, emp, path.basename(f.rel), docType(f.rel, longest));
      emp.updatedAt = new Date().toISOString();
      stats.employees++; job.progress.done++;
      if (job.progress.done % 10 === 0) { persist(); log(`${plant}: ${job.progress.done}/${byKey.size}`); }
    }
    // DC-3 files kept in the plant's DC3 folder: match by name inside the file path
    for (const { e, parts } of dc3) {
      const label = parts.slice(1).join(' ');
      const { number } = parseFolder(parts[1] || '');
      const cand = plantEmps().filter(x => (number && x.number === number) || sameName(x.name, parseFolder(path.basename(label, path.extname(label))).name) || sameName(x.name, parseFolder(parts[1] || '').name));
      if (cand.length === 1) { await save(e, cand[0], path.basename(e.fileName), 'Constancia DC-3'); stats.dc3Matched++; }
      else stats.dc3Unmatched.push(label);
    }
    zip.close();
    fs.rmSync(zipPath, { force: true });
    persist();
    log(`${plant}: ${stats.employees} empleados (${stats.created} nuevos), ${stats.docs} documentos, ${(stats.bytes / 1048576).toFixed(0)} MB.`);
    if (stats.dc3Unmatched.length) log(`${plant}: ${stats.dc3Unmatched.length} DC-3 sin empleado: ${stats.dc3Unmatched.slice(0, 15).join(' · ')}`);
    return stats;
  }

  /* ---------- apply spreadsheet rows to employees ---------- */
  // body: { sheet, headerRow, numberCol?, nameCol, plantCol?, plantMap?, fields:{name,birthday,hire,curp,rfc,nss,position,phone,emerg}, dryRun }
  app.post('/api/import/apply-sheet', (req, res) => {
    if (!fs.existsSync(SHEET)) return res.status(404).json({ error: 'Primero descarga la hoja.' });
    const b = req.body || {};
    const sheets = JSON.parse(fs.readFileSync(SHEET, 'utf8'));
    const sh = sheets.find(s => s.name === b.sheet);
    if (!sh) return res.status(400).json({ error: 'No existe esa hoja.' });
    const head = (sh.rows.find(r => r.r === b.headerRow) || { v: [] }).v.map(h => String(h || '').trim());
    const F = b.fields || {};
    const col = (row, i) => (i == null || i < 0 ? '' : row.v[i]);
    const emps = Object.values(state.employees);
    const out = { matched: 0, unmatched: [], ambiguous: [], updated: [] };
    for (const row of sh.rows.filter(r => r.r > b.headerRow)) {
      const name = cellText(col(row, b.nameCol));
      if (!name) continue;
      const num = String(cellText(col(row, b.numberCol)) || '').replace(/\.0$/, '').trim();
      let plant = b.plantCol != null ? cellText(col(row, b.plantCol)) : '';
      if (plant && b.plantMap) plant = b.plantMap[norm(plant)] || plant;
      let cand = emps.filter(e => sameName(e.name, name) && (!plant || e.site === plant));
      if (cand.length !== 1 && num) {
        const byNum = emps.filter(e => e.number === num && (!plant || e.site === plant));
        if (byNum.length === 1 && (cand.length === 0 || cand.includes(byNum[0]))) cand = byNum;
      }
      if (cand.length !== 1) { (cand.length ? out.ambiguous : out.unmatched).push(`${num ? num + ' ' : ''}${name}${plant ? ' (' + plant + ')' : ''}`); continue; }
      const e = cand[0]; out.matched++;
      if (b.dryRun) continue;
      const set = (k, v) => { if (v && !e[k]) e[k] = v; };
      if (F.name != null) { const n = title(cellText(col(row, F.name))); if (n && n.length >= e.name.length) e.name = n; }
      set('birthday', toISODate(col(row, F.birthday)));
      set('hire', toISODate(col(row, F.hire)));
      set('curp', cellText(col(row, F.curp)).toUpperCase().replace(/\s/g, '').slice(0, 18));
      set('rfc', cellText(col(row, F.rfc)).toUpperCase().replace(/\s/g, '').slice(0, 13));
      set('nss', cellText(col(row, F.nss)).replace(/\s/g, '').slice(0, 20));
      set('position', title(cellText(col(row, F.position))).slice(0, 120));
      set('phone', cellText(col(row, F.phone)).slice(0, 40));
      set('emerg', cellText(col(row, F.emerg)).slice(0, 160));
      if (num && !e.number) e.number = num;
      if (!e.birthday && e.curp) e.birthday = birthdayFromCurp(e.curp);
      e.extra = e.extra || {};
      const mapped = new Set([b.numberCol, b.nameCol, b.plantCol, ...Object.values(F)].filter(x => x != null));
      head.forEach((h, i) => { const v = cellText(row.v[i]); if (h && v && !mapped.has(i)) e.extra[h.slice(0, 60)] = (row.v[i] instanceof Date ? toISODate(row.v[i]) : v).slice(0, 300); });
      e.updatedAt = new Date().toISOString();
      out.updated.push(e.name);
    }
    if (!b.dryRun) persist();
    res.json({ ...out, updated: out.updated.length });
  });

  /* ---------- apply one plant's sheet, detecting its columns automatically ---------- */
  // Sensitive columns that are never copied: chronic illnesses, bank details.
  const SKIP = /DIABETES|HIPERTENS|ENFERMEDAD|CRONIC|CUENTA|CLABE|BANCO|TARJETA DE NOMINA|SUELDO|SALARIO|BONO|NETO|PERCEPCION/;
  function layout(sh) {
    const idx = sh.rows.slice(0, 8).findIndex(r => r.v.some(c => /\bCURP\b/.test(norm(c))));
    if (idx < 0) throw new Error(`No encontré los encabezados en la hoja ${sh.name}.`);
    const h2 = sh.rows[idx].v, h1 = idx > 0 ? sh.rows[idx - 1].v : [];
    const n = Math.max(h1.length, h2.length), H = [];
    let group = '';
    for (let i = 0; i < n; i++) {
      const g = norm(h1[i]); if (g && !/LISTA DE EMPLEADOS|GRUPO FRONTERA|GRUPO AVE/.test(g)) group = g; else if (g) group = '';
      H.push({ i, label: [group, norm(h2[i])].filter(Boolean).join(' / '), raw: String(h2[i] || h1[i] || '').replace(/\s+/g, ' ').trim() });
    }
    const f = re => (H.find(h => re.test(h.label)) || {}).i;
    const enf = H.findIndex(h => /ENFERMEDAD|CRONIC/.test(norm(h1[h.i])));
    const enfEnd = enf >= 0 ? (H.findIndex((h, k) => k > enf && norm(h1[h.i]) && !/ENFERMEDAD|CRONIC/.test(norm(h1[h.i]))) || n) : -1;
    return {
      headerRow: sh.rows[idx].r, H,
      col: {
        number: f(/NO\.? ?EMPLEADO|^NO\.?$|NUM\w* (DE )?EMP/), active: f(/(^| )ACTIVO$|(^| )ESTATUS$/), hire: f(/INGRESO/), baja: f(/BAJA/),
        nss: f(/(^| )NSS$|SEGURO SOCIAL/), name: (H.find(h => /(^|\/ )(EMPLEADO|NOMBRE( COMPLETO)?( (DEL )?EMPLEADO)?)$/.test(h.label) && !/NO\.? ?EMPLEADO|NUM/.test(h.label)) || {}).i, position: f(/PUESTO/), shift: f(/TURNO/),
        curp: f(/(^| )CURP$/), rfc: f(/(^| )RFC$/), phone: f(/TELEFONO|CELULAR/), email: f(/CORREO/),
        emerg: f(/CONTACTO DE EMERGENCIA/), kin: f(/PARENTESCO/), emergPhone: f(/(^| )NUMERO$/), birthday: f(/NACIMIENTO|CUMPLE/),
        labDone: f(/LABORATORIOS? \/ EXPEDIDOS|LABORATORIOS? EXPEDIDOS/), labExp: f(/LABORATORIOS? \/ VENCIMIENTO|LABORATORIOS? VENCIMIENTO/),
        dc3: f(/DC ?3 ?\/? ?VENC|VENCIMIENTO DC ?3/),
      },
      skip: new Set(H.filter(h => SKIP.test(h.label) || (enf >= 0 && h.i >= enf && h.i < (enfEnd > 0 ? enfEnd : enf + 3))).map(h => h.i)),
    };
  }

  app.post('/api/import/apply-auto', (req, res) => {
    if (!fs.existsSync(SHEET)) return res.status(404).json({ error: 'Primero descarga la hoja.' });
    const { sheet, plant, dryRun, create } = req.body || {};
    const sheets = JSON.parse(fs.readFileSync(SHEET, 'utf8'));
    const sh = sheets.find(s => s.name.trim() === String(sheet || '').trim());
    if (!sh) return res.status(400).json({ error: 'No existe esa hoja.' });
    let L; try { L = layout(sh); } catch (e) { return res.status(400).json({ error: e.message }); }
    const C = L.col, get = (row, i) => (i == null ? '' : row.v[i]);
    const emps = Object.values(state.employees).filter(e => e.site === plant);
    const out = { sheet: sh.name.trim(), plant, headerRow: L.headerRow, columns: Object.fromEntries(Object.entries(C).filter(([, v]) => v != null).map(([k, v]) => [k, L.H[v].raw])),
      skippedColumns: [...L.skip].map(i => L.H[i].raw), rows: 0, inactiveRows: 0, matched: 0, unmatched: [], ambiguous: [], noSheetRow: [] };
    const seen = new Set();
    const rows = sh.rows.filter(r => r.r > L.headerRow && cellText(get(r, C.name)));
    // active rows first so a rehire's current row wins
    const isInactive = r => /BAJA|INACTIV|^NO$/.test(norm(get(r, C.active))) || !!toISODate(get(r, C.baja));
    rows.sort((a, b) => isInactive(a) - isInactive(b));
    for (const row of rows) {
      out.rows++;
      const name = cellText(get(row, C.name));
      const num = String(cellText(get(row, C.number)) || '').replace(/\.0+$/, '').trim();
      let cand = emps.filter(e => sameName(e.name, name));
      if (cand.length !== 1 && num) { const byNum = emps.filter(e => e.number === num); if (byNum.length === 1) cand = byNum; }
      if (cand.length > 1 && num) cand = cand.filter(e => e.number === num);
      if (cand.length !== 1) {
        if (cand.length === 0 && !dryRun) { // a former employee whose folder is in EXPEDIENTES BAJAS: link it to this plant
          const bj = Object.values(state.employees).filter(x => x.site === 'Expedientes bajas' && sameName(x.name, name));
          if (bj.length === 1) { bj[0].site = plant; bj[0].status = 'baja'; cand = bj; out.bajasLinked = (out.bajasLinked || 0) + 1; }
        }
        if (cand.length === 1) { /* linked above */ }
        else if (cand.length === 0 && create && !dryRun) { // no folder: create the person from the sheet row
          const id = crypto.createHash('sha1').update(`sheet|${norm(plant)}|${num}|${norm(name)}`).digest('hex').slice(0, 24);
          if (!state.employees[id]) {
            state.employees[id] = { id, name: title(name), site: plant, number: num, status: isInactive(row) ? 'baja' : 'activo', position: '', phone: '', emerg: '', notes: '',
              birthday: '', hire: '', curp: '', rfc: '', nss: '', address: '', extra: {}, trainings: [], docs: [], src: { sheet: sh.name.trim(), row: row.r }, createdAt: new Date().toISOString() };
            out.created = (out.created || 0) + 1; if (isInactive(row)) out.createdBajas = (out.createdBajas || 0) + 1;
          }
          cand = [state.employees[id]];
        } else { if (isInactive(row)) out.inactiveRows++; else (cand.length ? out.ambiguous : out.unmatched).push(`${num ? num + ' ' : ''}${title(name)}`); continue; }
      }
      const e = cand[0];
      if (seen.has(e.id)) continue; // keep the first (active) row
      seen.add(e.id); out.matched++;
      if (dryRun) continue;
      const set = (k, v) => { if (v) e[k] = v; };
      const nm = title(name); if (nm && tokens(nm).length >= tokens(e.name).length) e.name = nm;
      if (num) e.number = num;
      set('hire', toISODate(get(row, C.hire)));
      if (e.status === 'baja') set('bajaDate', toISODate(get(row, C.baja)));
      set('curp', cellText(get(row, C.curp)).toUpperCase().replace(/\s/g, '').slice(0, 18));
      set('rfc', cellText(get(row, C.rfc)).toUpperCase().replace(/\s/g, '').slice(0, 13));
      set('nss', cellText(get(row, C.nss)).replace(/\s/g, '').slice(0, 20));
      set('position', title(cellText(get(row, C.position))).slice(0, 120));
      set('phone', cellText(get(row, C.phone)).slice(0, 40));
      const em = [cellText(get(row, C.emerg)), cellText(get(row, C.kin)) && `(${cellText(get(row, C.kin)).toLowerCase()})`, cellText(get(row, C.emergPhone))].filter(Boolean).join(' ');
      set('emerg', em.slice(0, 160));
      set('birthday', toISODate(get(row, C.birthday)) || birthdayFromCurp(e.curp) || e.birthday);
      // lab tests → tracked expiry item
      const ld = toISODate(get(row, C.labDone)), le = toISODate(get(row, C.labExp));
      if (le) {
        e.trainings = (e.trainings || []).filter(t => norm(t.name) !== 'LABORATORIOS');
        e.trainings.push({ id: crypto.randomBytes(6).toString('hex'), name: 'Laboratorios', done: ld, expires: le });
      }
      const dc3e = toISODate(get(row, C.dc3));
      if (dc3e && !(e.trainings || []).some(t => /DC-?3/.test(t.name))) (e.trainings = e.trainings || []).push({ id: crypto.randomBytes(6).toString('hex'), name: 'DC-3 Constancia de habilidades (STPS)', done: '', expires: dc3e });
      const used = new Set(Object.values(C).filter(v => v != null));
      used.delete(C.shift); used.delete(C.email);
      e.extra = {};
      for (const h of L.H) {
        if (used.has(h.i) || L.skip.has(h.i) || !h.raw || /DIAS VENCIDOS/.test(h.label)) continue;
        const raw = get(row, h.i);
        let v = /FECHA|VENC|EXPED|CONTRATO|CURSO/.test(h.label) ? (toISODate(raw) || cellText(raw)) : cellText(raw);
        if (v) e.extra[(h.label.includes(' / ') ? title(h.label.split(' / ')[0]) + ': ' : '') + h.raw.slice(0, 50)] = String(v).slice(0, 200);
      }
      e.updatedAt = new Date().toISOString();
    }
    out.noSheetRow = emps.filter(e => !seen.has(e.id)).map(e => `${e.number ? e.number + ' ' : ''}${e.name}`);
    if (!dryRun) persist();
    res.json(out);
  });

  /* ---------- contracts folder: attach each contract to its employee, note the contract type ---------- */
  const CONTRACT_PLANTS = { 'JUAREZ': ['Juárez', 'Auto Kabel Juárez'], 'AUTO KABEL': ['Auto Kabel Juárez'], 'GUADALAJARA': ['Guadalajara'], 'MONCLOVA': ['Monclova'],
    'TIJUANA': ['Tijuana'], 'CHIHUAHUA': ['Jabil Chihuahua'], 'JABIL TORRES': ['Jabil Torres'], 'WISTRON': ['Wistron'], 'WINSTRON': ['Wistron'] };
  app.post('/api/import/contracts', (req, res) => {
    const { url } = req.body || {};
    try { dropboxURL(url, true); } catch (e) { return res.status(400).json({ error: e.message }); }
    const ok = start('contracts', async () => {
      const zipPath = path.join(WORK, 'contracts.zip');
      log('Contratos: descargando…');
      const size = await download(url, zipPath);
      log(`Contratos: descargados (${(size / 1048576).toFixed(1)} MB).`);
      const zip = await yauzl.openPromise(zipPath, { autoClose: false, lazyEntries: true, decodeStrings: false });
      const entries = [];
      for await (const e of zip.eachEntry()) { e.fileName = decodeName(e.fileName, e.generalPurposeBitFlag); if (!/\/$/.test(e.fileName)) entries.push(e); }
      const folderName = norm(decodeURIComponent(new URL(url).pathname.split('/').pop() || ''));
      const st = { attached: 0, templates: 0, unmatched: [], skipped: 0 };
      const tplDir = path.join(DATA_DIR, 'templates'); fs.mkdirSync(tplDir, { recursive: true });
      const all = Object.values(state.employees);
      for (const e of entries) {
        let parts = e.fileName.replace(/^\/+/, '').split('/');
        if (parts.length > 1 && norm(parts[0]) === folderName) parts = parts.slice(1);
        const file = parts[parts.length - 1], ext = path.extname(file).toLowerCase();
        if (!MIME[ext] || /^~\$|^\./.test(file)) { st.skipped++; continue; }
        const plantKey = Object.keys(CONTRACT_PLANTS).find(k => norm(parts[0]).includes(k));
        if (parts.length === 1 || /FORMATO|PLANTILLA|MACHOTE|CARATULA|^CONTRATO[_ ]?(INDETERMINADO|TEMPORAL|CAPACITACION)/.test(norm(file))) {
          if (parts.length <= 2) { // company templates, kept for generating contracts later
            await pipeline(await zip.openReadStreamPromise(e), fs.createWriteStream(path.join(tplDir, file.replace(/[\/\\]/g, '_'))));
            st.templates++; continue;
          }
        }
        const kind = parts.slice(0, -1).map(norm).join(' ');
        const type = /TEMPORAL/.test(kind) ? 'Temporal' : /INDETERMINADO|PLANTA\b/.test(kind) ? 'Indeterminado' : /CAPACITA/.test(kind + norm(file)) ? 'Capacitación inicial' : /PRUEBA/.test(kind + norm(file)) ? 'Periodo de prueba' : '';
        const label = norm(path.basename(file, ext)).replace(/\b(CONTRATO|INDETERMINADO|TEMPORAL(ES)?|FIRMADO|ESCANEADO|COPIA|GPO|AVE|GRUPO)\b/g, ' ').replace(/\s+/g, ' ').trim();
        const sub = parts.length > 2 ? parts[parts.length - 2] : '';
        const { number } = parseFolder(label);
        const pool = plantKey ? all.filter(x => CONTRACT_PLANTS[plantKey].includes(x.site)) : all;
        let cand = pool.filter(x => sameName(x.name, parseFolder(label).name) || (sub && sameName(x.name, parseFolder(sub).name)));
        if (cand.length !== 1 && number) { const n = pool.filter(x => x.number === number); if (n.length === 1) cand = n; }
        if (cand.length !== 1) { st.unmatched.push(parts.join('/')); continue; }
        const emp = cand[0];
        if ((emp.docs || []).some(d => d.srcPath === e.fileName)) { st.skipped++; continue; }
        const stored = crypto.randomUUID() + ext;
        await pipeline(await zip.openReadStreamPromise(e), fs.createWriteStream(path.join(UPLOAD_DIR, stored)));
        emp.docs = (emp.docs || []).concat({ id: crypto.randomBytes(10).toString('hex'), type: 'Contrato', fileName: file.slice(0, 160), size: e.uncompressedSize,
          mime: MIME[ext], stored, srcPath: e.fileName, uploadedAt: new Date().toISOString(), contractType: type });
        if (type && !emp.contractType) emp.contractType = type;
        st.attached++;
      }
      zip.close(); fs.rmSync(zipPath, { force: true }); persist();
      log(`Contratos: ${st.attached} asignados, ${st.templates} formatos guardados, ${st.unmatched.length} sin empleado.`);
      return st;
    });
    res.status(ok ? 202 : 409).json(ok ? { ok: true } : { error: 'Ya hay una importación en curso.' });
  });

  /* ---------- read every document and fill what's still empty ---------- */
  const X = require('./extract');
  const TEXT = path.join(WORK, 'text'); fs.mkdirSync(TEXT, { recursive: true });
  const NEED = ['curp', 'rfc', 'nss', 'birthday', 'address', 'phone'];
  const OCR_TYPES = /INE|CURP|RFC|NSS|Alta IMSS|Acta de nacimiento|Solicitud|Expediente completo|Comprobante de domicilio|Otro/;
  const placeholderName = e => !e.name || /^\d*\s*-?\s*(baja)?\s*$/i.test(e.name) || /^baja\b/i.test(e.name);
  async function textOf(d, useOcr) {
    const cache = path.join(TEXT, d.id + (useOcr ? '.ocr' : '.txt'));
    if (fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8');
    const f = path.join(UPLOAD_DIR, d.stored);
    if (!fs.existsSync(f) || fs.statSync(f).size === 0) { fs.writeFileSync(cache, ''); return ''; }
    let t = '';
    try {
      if (!useOcr) {
        if (d.mime === 'application/pdf') t = (await X.pdfText(f, 8)).text;
        else if (/wordprocessingml/.test(d.mime || '')) t = await X.docxText(f);
      } else {
        if (d.mime === 'application/pdf') { for (const img of await X.pdfPageImages(f, 2, 1.6)) t += (await X.ocr(img)) + '\n'; }
        else if (/^image\/(png|jpeg|webp)/.test(d.mime || '')) t = await X.ocr(fs.readFileSync(f));
      }
    } catch (err) { log(`No se pudo leer ${d.fileName}: ${err.message.slice(0, 80)}`); }
    fs.writeFileSync(cache, t);
    return t;
  }
  function applyFound(e, found, st, src) {
    if (!found.belongs) { if (found.hasIds) st.otherPerson = (st.otherPerson || 0) + 1; return; }
    for (const k of NEED.concat(['name'])) {
      const v = found[k]; if (!v) continue;
      if (k === 'name') { if (placeholderName(e)) { e.name = title(v); st.filled.name = (st.filled.name || 0) + 1; } continue; }
      if (!e[k]) { e[k] = v; st.filled[k] = (st.filled[k] || 0) + 1; (e.filledFrom = e.filledFrom || {})[k] = src; }
    }
  }
  // OCR survives restarts: a marker says it's unfinished, and the server picks it up again on boot.
  const OCR_MARK = path.join(WORK, 'ocr-state.json');
  const readMark = () => { try { return JSON.parse(fs.readFileSync(OCR_MARK, 'utf8')); } catch { return null; } };
  setTimeout(() => {
    let m = readMark();
    // an OCR run that started before this marker existed left partial results; treat it as unfinished
    if (!m && fs.readdirSync(TEXT).some(f => f.endsWith('.ocr'))) m = { pending: true, resumes: 0, startedAt: 'earlier run' };
    if (m && m.pending && (m.resumes || 0) < 6) {
      fs.writeFileSync(OCR_MARK, JSON.stringify({ ...m, resumes: (m.resumes || 0) + 1 }));
      if (start('ocr', () => runExtract(true))) log(`OCR reanudado tras reinicio (intento ${(m.resumes || 0) + 1}).`);
    }
  }, 20000);
  app.post('/api/import/extract', (req, res) => {
    const useOcr = !!(req.body && req.body.ocr);
    if (useOcr) fs.writeFileSync(OCR_MARK, JSON.stringify({ pending: true, resumes: 0, startedAt: new Date().toISOString() }));
    const ok = start(useOcr ? 'ocr' : 'extract', () => runExtract(useOcr));
    res.status(ok ? 202 : 409).json(ok ? { ok: true } : { error: 'Ya hay una importación en curso.' });
  });
  async function runExtract(useOcr) {
    {
      const emps = Object.values(state.employees);
      const st = { filled: {}, docsRead: 0, withText: 0, ocrPages: 0 };
      const todo = useOcr ? emps.filter(e => placeholderName(e) || NEED.some(k => !e[k])) : emps;
      job.progress = { done: 0, total: todo.length };
      log(useOcr ? `OCR: ${todo.length} empleados con datos faltantes.` : `Leyendo texto de los documentos de ${todo.length} empleados…`);
      for (const e of todo) {
        let docs = (e.docs || []).filter(d => d.mime);
        if (useOcr) {
          docs = docs.filter(d => OCR_TYPES.test(d.type) && /pdf|image\/(png|jpeg|webp)/.test(d.mime))
            .filter(d => { const c = path.join(TEXT, d.id + '.txt'); return !fs.existsSync(c) || fs.readFileSync(c, 'utf8').trim().length < 80; })
            .sort((a, b) => ['CURP', 'INE', 'RFC / Constancia fiscal', 'Alta IMSS', 'Acta de nacimiento', 'Solicitud / CV', 'Expediente completo'].indexOf(a.type) - ['CURP', 'INE', 'RFC / Constancia fiscal', 'Alta IMSS', 'Acta de nacimiento', 'Solicitud / CV', 'Expediente completo'].indexOf(b.type))
            .slice(0, 6);
        }
        for (const d of docs) {
          if (useOcr && !placeholderName(e) && NEED.every(k => e[k])) break;
          const t = await textOf(d, useOcr);
          st.docsRead++; if (t.trim().length > 40) st.withText++;
          if (useOcr) st.ocrPages += d.mime === 'application/pdf' ? 2 : 1;
          applyFound(e, X.parse(t, placeholderName(e) ? {} : e), st, `${d.type}: ${d.fileName}`);
        }
        if (!e.birthday && e.curp) { e.birthday = birthdayFromCurp(e.curp); if (e.birthday) st.filled.birthday = (st.filled.birthday || 0) + 1; }
        job.progress.done++;
        if (job.progress.done % 20 === 0) { persist(); log(`${job.progress.done}/${todo.length} · completados: ${JSON.stringify(st.filled)}`); }
      }
      if (useOcr) await X.stopOcr();
      // an address shared by several people is an office or plant, not a home
      const cnt = {}; Object.values(state.employees).forEach(e => { if (e.address) cnt[norm(e.address)] = (cnt[norm(e.address)] || 0) + 1; });
      let dropped = 0;
      for (const e of Object.values(state.employees)) if (e.address && cnt[norm(e.address)] > 2 && e.filledFrom && e.filledFrom.address) { e.address = ''; delete e.filledFrom.address; dropped++; }
      if (dropped) { st.filled.address = Math.max(0, (st.filled.address || 0) - dropped); log(`Quitados ${dropped} domicilios repetidos (oficina o planta).`); }
      persist();
      if (useOcr) fs.writeFileSync(OCR_MARK, JSON.stringify({ pending: false, finishedAt: new Date().toISOString(), result: st }));
      log(`Listo: ${st.docsRead} documentos leídos, completados ${JSON.stringify(st.filled)}`);
      return st;
    }
  }

  // Undo values filled from documents (e.g. after improving a rule), so a new pass can refill them.
  app.post('/api/import/clear-filled', (req, res) => {
    const field = String((req.body || {}).field || '');
    if (!['address', 'phone', 'nss', 'rfc', 'curp', 'name'].includes(field)) return res.status(400).json({ error: 'Campo no válido.' });
    const keepSat = !!(req.body || {}).keepSat;
    let n = 0;
    for (const e of Object.values(state.employees)) {
      if (!e.filledFrom || !e.filledFrom[field]) continue;
      if (keepSat && field === 'address' && /C\.P\. \d{5}/.test(e.address || '') && /RFC|Constancia/i.test(e.filledFrom.address)) continue;
      e[field] = ''; delete e.filledFrom[field]; n++;
    }
    // an address shared by several people is an office or plant, not a home
    if (field === 'address') {
      const count = {}; Object.values(state.employees).forEach(e => { if (e.address) count[norm(e.address)] = (count[norm(e.address)] || 0) + 1; });
      for (const e of Object.values(state.employees)) if (e.address && count[norm(e.address)] > 2 && e.filledFrom && e.filledFrom.address) { e.address = ''; delete e.filledFrom.address; n++; }
    }
    persist();
    res.json({ cleared: n });
  });

  /* ---------- fill report: who is still missing what ---------- */
  app.get('/api/import/gaps', (req, res) => {
    const fields = ['number', 'curp', 'rfc', 'nss', 'birthday', 'hire', 'position', 'phone', 'emerg', 'address'];
    const act = Object.values(state.employees).filter(e => e.status !== 'baja' && !/no es empleado/.test(e.name));
    const miss = Object.fromEntries(fields.map(f => [f, act.filter(e => !e[f]).length]));
    res.json({ active: act.length, bajas: Object.values(state.employees).filter(e => e.status === 'baja').length, missing: miss,
      byPlant: Object.fromEntries([...new Set(act.map(e => e.site))].map(p => [p, act.filter(e => e.site === p).length])) });
  });

  /* ---------- summary for checking the import ---------- */
  app.get('/api/import/summary', (req, res) => {
    const by = {};
    for (const e of Object.values(state.employees)) {
      const p = by[e.site || '(sin planta)'] = by[e.site || '(sin planta)'] || { employees: 0, docs: 0, mb: 0, noBirthday: 0, types: {} };
      p.employees++; p.docs += (e.docs || []).length; if (!e.birthday) p.noBirthday++;
      for (const d of e.docs || []) { p.mb += (d.size || 0) / 1048576; p.types[d.type] = (p.types[d.type] || 0) + 1; }
    }
    for (const p of Object.values(by)) p.mb = Math.round(p.mb);
    res.json(by);
  });
};
module.exports.helpers = { docType, parseFolder, sameName, birthdayFromCurp, toISODate, norm, title };

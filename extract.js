'use strict';
/* Text from employee documents: PDF text layer, Word files, and OCR for scans/photos. */
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

let lib;
const pdfjs = async () => (lib = lib || await import('pdfjs-dist/legacy/build/pdf.mjs'));
const openPdf = async file => (await pdfjs()).getDocument({
  data: new Uint8Array(fs.readFileSync(file)), disableFontFace: true, isEvalSupported: false, verbosity: 0,
}).promise;

async function pdfText(file, maxPages = 6) {
  const doc = await openPdf(file);
  let out = '';
  try {
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      out += tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
      p.cleanup();
    }
    return { text: out, pages: doc.numPages };
  } finally { await doc.destroy(); }
}

async function pdfPageImages(file, maxPages = 2, scale = 2) {
  const doc = await openPdf(file);
  const imgs = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      let vp = page.getViewport({ scale });
      if (vp.width * vp.height > 9e6) vp = page.getViewport({ scale: scale * Math.sqrt(9e6 / (vp.width * vp.height)) });
      const { canvas, context } = doc.canvasFactory.create(Math.ceil(vp.width), Math.ceil(vp.height));
      await page.render({ canvasContext: context, viewport: vp, canvas }).promise;
      imgs.push(canvas.toBuffer('image/png'));
      doc.canvasFactory.destroy({ canvas, context });
      page.cleanup();
    }
  } finally { await doc.destroy(); }
  return imgs;
}

async function docxText(file) {
  const zip = await yauzl.openPromise(file, { autoClose: false, lazyEntries: true });
  try {
    for await (const e of zip.eachEntry()) {
      if (e.fileName !== 'word/document.xml') continue;
      const rs = await zip.openReadStreamPromise(e);
      const chunks = []; for await (const c of rs) chunks.push(c);
      return Buffer.concat(chunks).toString('utf8')
        .replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    }
    return '';
  } finally { zip.close(); }
}

/* ---------- OCR (one Spanish worker, created on demand) ---------- */
let worker = null;
async function ocr(buf) {
  if (!worker) {
    const { createWorker } = require('tesseract.js');
    const langPath = path.dirname(require.resolve('@tesseract.js-data/spa/4.0.0/spa.traineddata.gz'));
    worker = await createWorker('spa', 1, { langPath, gzip: true, cacheMethod: 'none', logger: () => {} });
  }
  const { data } = await worker.recognize(buf);
  return data.text || '';
}
async function stopOcr() { if (worker) { await worker.terminate(); worker = null; } }

/* ---------- field parsing ---------- */
const deacc = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const CURP_RE = /\b([A-Z][AEIOUX][A-Z]{2})(\d{2})(\d{2})(\d{2})([HMX])([A-Z]{2})([B-DF-HJ-NP-TV-Z]{3})([0-9A-Z])(\d)\b/g;
function curpBirth(c) {
  const y = +c.slice(4, 6), m = +c.slice(6, 8), d = +c.slice(8, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  const cent = /\d/.test(c[16]) ? 1900 : 2000;
  return `${cent + y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// CURP letters 1 and 4 come from the first surname and first given name; accept either name order.
function curpFits(c, name) {
  const t = deacc(name).toUpperCase().split(/\s+/).filter(x => x.length > 1 && !/^(DE|DEL|LA|LAS|LOS|Y|MA|MARIA|JOSE)$/.test(x));
  const all = deacc(name).toUpperCase().split(/\s+/).filter(Boolean);
  if (!t.length) return false;
  const initials = new Set(all.map(x => x[0]));
  return initials.has(c[0]) && initials.has(c[3]);
}
const CURP_DICT = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
function curpCheck(c) {
  let sum = 0;
  for (let i = 0; i < 17; i++) { const v = CURP_DICT.indexOf(c[i]); if (v < 0) return false; sum += v * (18 - i); }
  return String((10 - (sum % 10)) % 10) === c[17];
}
// OCR often reads digits as letters (O→0, I→1, S→5/8, B→8, Z→2, G→6). Try the variants and keep the one whose check digit is right.
const DIGITISH = { O: ['0'], Q: ['0'], D: ['0'], I: ['1'], L: ['1'], Z: ['2'], S: ['5', '8'], B: ['8'], G: ['6'], T: ['7'] };
function repairCurps(U) {
  const found = [];
  for (const m of U.matchAll(/\b([A-Z]{4})([0-9OQDILZSBGT]{6})([HM])([A-Z]{5})([0-9A-Z])([0-9OQDILZSBGT])\b/g)) {
    let variants = [m[1]];
    for (const ch of m[2]) variants = variants.flatMap(v => (/\d/.test(ch) ? [v + ch] : DIGITISH[ch].map(d => v + d)));
    const tail = m[3] + m[4] + m[5];
    const last = /\d/.test(m[6]) ? [m[6]] : DIGITISH[m[6]];
    for (const v of variants) for (const l of last) { const c = v + tail + l; if (curpCheck(c)) found.push(c); }
  }
  return found;
}
function fixOcr(s) { return s; }

function parse(textRaw, emp) {
  const text = deacc(textRaw).replace(/\r/g, '');
  const U = fixOcr(text.toUpperCase());
  const out = {};
  // CURP
  const exact = [...U.matchAll(CURP_RE)].map(m => m[0]).filter(c => curpBirth(c));
  const curps = [...new Set([...exact.filter(curpCheck), ...repairCurps(U), ...exact])].filter(c => curpBirth(c));
  const curp = curps.find(c => !emp.name || curpFits(c, emp.name)) || (curps.length === 1 && !emp.name ? curps[0] : '');
  if (curp) { out.curp = curp; out.birthday = curpBirth(curp); }
  // RFC (persona física): 4 letters + 6 digits + 3 homoclave; prefer one that agrees with the CURP
  const rfcs = [...U.matchAll(/\b([A-Z&N]{4}\d{6}[A-Z0-9]{3})\b/g)].map(m => m[1]);
  const base = (curp || emp.curp || '').slice(0, 10);
  const rfc = rfcs.find(r => base && r.startsWith(base)) || (!base && emp.name ? rfcs.find(r => curpFits(r, emp.name)) : (!base && rfcs.length === 1 ? rfcs[0] : '')) || '';
  if (rfc) out.rfc = rfc;
  // Is this document about this employee? IDs that don't fit the name mean it belongs to someone else.
  const ids = [...curps, ...rfcs];
  const nameHits = emp.name ? deacc(emp.name).toUpperCase().split(/\s+/).filter(t => t.length > 2 && U.includes(t)).length : 0;
  out.hasIds = ids.length > 0;
  out.belongs = !emp.name || !!curp || !!rfc || (ids.length === 0 && nameHits >= 2);
  // NSS (11 digits) near its label
  const nss = U.match(/(?:N\.?\s?S\.?\s?S\.?|SEGURIDAD SOCIAL|AFILIACION|NO\.? DE SEGURO)[^\d]{0,40}((?:\d[\s-]?){10}\d)(?!\d)/);
  if (nss && nss[1].replace(/\D/g, '').length === 11) out.nss = nss[1].replace(/\D/g, '');
  // Address from the SAT constancia de situación fiscal
  const flat = text.replace(/\s+/g, ' ');
  const g = re => { const m = flat.match(re); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
  const via = g(/Nombre de Vialidad:\s*(.+?)\s+Numero Exterior/i), ext = g(/Numero Exterior:\s*(.*?)\s+Numero Interior/i),
    col = g(/Nombre de la Colonia:\s*(.+?)\s+Nombre de la Localidad/i), cp = g(/Codigo Postal:\s*(\d{5})/i),
    mun = g(/Nombre del Municipio o Demarcacion Territorial:\s*(.+?)\s+Nombre de la Entidad/i), ent = g(/Nombre de la Entidad Federativa:\s*(.+?)\s+Entre Calle/i);
  if (via && cp) out.address = [`${via} ${ext}`.trim(), col && `Col. ${col}`, cp && `C.P. ${cp}`, mun, ent].filter(Boolean).join(', ').slice(0, 200);
  else {
    // Only an address stated for the worker ("EL TRABAJADOR … con domicilio en …"), never the company's offices.
    for (const m of flat.matchAll(/domicilio(?: particular)?(?: ubicado)?(?: en| el ubicado en)?[:\s]+(?=(.{12,200}))/gi)) {
      const before = flat.slice(Math.max(0, m.index - 220), m.index);
      if (/oficina|empresa|patr[oó]n|sociedad|raz[oó]n social|fiscal|registrado|la sucursal|planta/i.test(before.slice(-90))) continue;
      if (!/trabajador|empleado|\bsr\.?\b|\bsra\.?\b|\bel c\.|\bla c\.|yo,|mi domicilio|nombre/i.test(before)) continue;
      if (!/\d/.test(m[1])) continue;
      let v = m[1];
      const cut1 = v.search(/;|,\s*(?:de nacionalidad|con R\.?F\.?C|con CURP|quien|mayor de edad|estado civil|a quien)|\s+y\s+(?:que|quien)\b/i); if (cut1 > 0) v = v.slice(0, cut1);
      const cut2 = v.search(/\.\s+[A-ZÑ]{2,}\b/); if (cut2 > 0) v = v.slice(0, cut2);
      if (v.length < 12) continue;
      out.address = v.replace(/\s+/g, ' ').replace(/[,.\s]+$/, '').trim().slice(0, 200); break;
    }
  }
  // Phone (Mexican 10 digits) near a phone label
  const tel = U.match(/(?:TELEFONO|\bTEL\b\.?|CELULAR|\bCEL\b\.?|MOVIL|WHATSAPP)[^\d\n]{0,20}(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})\b/);
  if (tel) out.phone = tel[1].replace(/\D/g, '').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
  // Name (for folders with no name, e.g. "13-BAJA")
  const nm = flat.match(/Nombre\s*\(s\):\s*([A-ZÑ ]+?)\s+Primer Apellido:\s*([A-ZÑ ]+?)\s+Segundo Apellido:\s*([A-ZÑ ]*?)\s+(?:Fecha|Estatus|Nombre)/i)
    || text.match(/NOMBRE\s*\n?\s*([A-ZÑ]+(?: [A-ZÑ]+){1,4})\s*\n\s*CURP/);
  if (nm) out.name = nm.slice(1).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return out;
}

module.exports = { pdfText, pdfPageImages, docxText, ocr, stopOcr, parse, curpBirth, curpFits, curpCheck };

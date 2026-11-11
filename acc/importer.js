'use strict';
/* Bulk import of CFDI files: XML (I, E, P), matching PDFs, and ZIPs (e.g. SAT descarga masiva). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yauzl = require('yauzl');
const ExcelJS = require('exceljs');
const { parseCfdi, factsFromText, parsePrinted } = require('./cfdi');
const { accountForClave, r2, uid, TYPES } = require('./core');

/* SAT / CONTPAQi invoice list (xlsx): UUID → issuer, total, payment method. Used to check what was read from PDFs. */
async function readList(buf) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const out = {};
  for (const ws of wb.worksheets) {
    let head = null;
    ws.eachRow((row, n) => {
      const v = row.values.slice(1).map(x => (x && typeof x === 'object' && 'text' in x ? x.text : x));
      if (!head) { if (v.some(c => /^uuid$/i.test(String(c || '').trim()))) head = v.map(c => String(c || '').replace(/[▲▼]/g, '').trim().toLowerCase()); return; }
      const g = name => { const i = head.findIndex(h => h === name); return i < 0 ? null : v[i]; };
      const uuid = String(g('uuid') || '').trim().toUpperCase();
      if (!/^[0-9A-F-]{36}$/.test(uuid)) return;
      const total = parseFloat(String(g('total') ?? '').replace(/[$,]/g, ''));
      out[uuid] = { rfc: String(g('rfc emisor') || '').trim().toUpperCase(), name: String(g('nombre emisor') || '').trim(), total: isNaN(total) ? null : total, metodo: g('método pago') || g('metodo pago') || '', forma: g('forma pago') || '', fecha: g('fecha comprobante') || '', tipo: g('tipo comprobante desc') || '', cancel: g('estado de cancelación del documento') || '' };
    });
  }
  return out;
}

async function unzip(buf) {
  const out = [];
  const zip = await yauzl.fromBufferPromise(buf, { autoClose: false, lazyEntries: true, validateEntrySizes: true });
  const entries = [];
  for await (const e of zip.eachEntry()) entries.push(e);
  for (const entry of entries) {
    if (/\/$/.test(entry.fileName)) continue;
    const name = path.basename(String(entry.fileName));
    if (!/\.(xml|pdf|xlsx)$/i.test(name)) continue;
    if (entry.uncompressedSize > 20 * 1024 * 1024) continue;
    const rs = await zip.openReadStreamPromise(entry);
    const chunks = [];
    for await (const c of rs) chunks.push(c);
    out.push({ name, buf: Buffer.concat(chunks) });
  }
  zip.close();
  return out;
}

function storeFile(books, name, buf) {
  const ext = path.extname(name).toLowerCase();
  const stored = uid() + ext;
  fs.writeFileSync(path.join(books.filesDir, stored), buf);
  return { name, stored, kind: ext === '.xml' ? 'xml' : ext === '.pdf' ? 'pdf' : 'other', size: buf.length, sha: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) };
}

/* files: [{ name, buf }]; pdf: { text: async path => string, layout: async path => string } (or a bare text function) */
async function importFiles(books, files, user, pdf) {
  const pdfText = typeof pdf === 'function' ? pdf : pdf && pdf.text;
  const pdfLayout = pdf && typeof pdf === 'object' ? pdf.layout : null;
  const res = { created: [], payments: [], duplicates: [], skipped: [], errors: [], attached: [] };
  // expand zips
  let list = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      try { list.push(...await unzip(f.buf)); } catch (e) { res.errors.push({ file: f.name, error: 'No se pudo abrir el ZIP.' }); }
    } else list.push(f);
  }
  const xmls = list.filter(f => /\.xml$/i.test(f.name)), pdfs = list.filter(f => /\.pdf$/i.test(f.name));
  let sat = null; // invoice list from an Excel, if one came along
  for (const f of list.filter(f => /\.xlsx$/i.test(f.name))) {
    try { sat = { ...(sat || {}), ...(await readList(f.buf)) }; } catch (e) { res.errors.push({ file: f.name, error: 'No se pudo leer el Excel.' }); }
  }
  const seenUuid = new Set();
  const company = books.db.company.rfc;
  const byUuid = {}; // uuid -> doc (new or existing) for PDF pairing
  const base = n => n.replace(/\.[^.]+$/, '').toLowerCase();
  const xmlBase = {};

  for (const f of xmls) {
    let c;
    try { c = parseCfdi(f.buf); } catch (e) { res.errors.push({ file: f.name, error: e.message }); continue; }
    if (!c.uuid) { res.errors.push({ file: f.name, error: 'El XML no tiene timbre fiscal (UUID). ¿Es un CFDI timbrado?' }); continue; }
    seenUuid.add(c.uuid);
    const incoming = c.receptor.rfc === company, outgoing = c.emisor.rfc === company;
    if (!incoming && !outgoing) { res.skipped.push({ file: f.name, reason: `No es de la empresa: emisor ${c.emisor.rfc}, receptor ${c.receptor.rfc}.` }); continue; }
    if (c.tipo === 'N') { res.skipped.push({ file: f.name, reason: 'Recibo de nómina: la nómina aún no se registra aquí.' }); continue; }
    if (c.tipo === 'T') { res.skipped.push({ file: f.name, reason: 'CFDI de traslado: no tiene efecto contable.' }); continue; }
    const other = incoming ? c.emisor : c.receptor;

    if (c.tipo === 'P') {
      if (books.db.payments.find(p => p.uuid === c.uuid && p.state !== 'cancelled')) { res.duplicates.push({ file: f.name, uuid: c.uuid }); continue; }
      let partner = books.findPartnerByRfc(other.rfc, other.name);
      if (!partner) partner = books.upsertPartner({ rfc: other.rfc, name: other.name || other.rfc, supplier: incoming, customer: outgoing, terms: incoming ? 30 : 30 }, user);
      for (const pg of c.payments) {
        const allocations = [], missing = [];
        for (const dr of pg.docs) {
          const d = books.db.docs.find(x => x.uuid === dr.uuid && x.state === 'posted');
          if (!d) { missing.push(dr.uuid); continue; }
          // amount in MXN: ImpPagado is in the invoice currency
          const mxn = r2(dr.paid * (d.rate || 1));
          allocations.push({ docId: d.id, amount: Math.min(mxn, books.residual(d)) });
        }
        const amountMxn = r2(pg.amount * (pg.rate || 1));
        const bank = books.db.banks[0];
        if (missing.length && !allocations.length) {
          res.errors.push({ file: f.name, error: `Complemento de pago ${c.uuid.slice(0, 8)}: las facturas pagadas (${missing.map(u => u.slice(0, 8)).join(', ')}) no están registradas o publicadas. Impórtalas y publícalas primero.` });
          continue;
        }
        try {
          const p = books.createPayment({ dir: incoming ? 'out' : 'in', partnerId: partner.id, date: pg.date || c.date, bankId: bank.id, amount: amountMxn, method: pg.forma, ref: pg.ref || `CFDI ${c.serie}${c.folio}`, uuid: c.uuid, allocations, files: [storeFile(books, f.name, f.buf)], notes: missing.length ? `Facturas no encontradas: ${missing.join(', ')}` : '' }, user);
          res.payments.push({ file: f.name, id: p.id, number: p.number, amount: p.amount, partner: partner.name });
        } catch (e) { res.errors.push({ file: f.name, error: e.message }); }
      }
      continue;
    }

    // I / E
    const existing = books.db.docs.find(d => d.uuid === c.uuid && d.state !== 'cancelled');
    if (existing) { res.duplicates.push({ file: f.name, uuid: c.uuid, number: existing.number || 'borrador' }); byUuid[c.uuid] = existing; xmlBase[base(f.name)] = existing; continue; }
    const type = incoming ? (c.tipo === 'E' ? 'in_refund' : 'in_invoice') : (c.tipo === 'E' ? 'out_refund' : 'out_invoice');
    let partner = books.findPartnerByRfc(other.rfc, other.name);
    if (!partner) partner = books.upsertPartner({ rfc: other.rfc, name: other.name || other.rfc, supplier: incoming, customer: outgoing, terms: 30, regimen: incoming ? c.emisor.regimen : c.receptor.regimen, cp: outgoing ? c.receptor.cp : '' }, user);
    else { if (incoming && !partner.supplier) partner.supplier = true; if (outgoing && !partner.customer) partner.customer = true; }
    const A = books.A;
    const lines = c.lines.map(l => ({
      description: l.description, clave: l.clave, unidad: l.unidad, qty: l.qty, price: l.price, amount: l.amount, discount: l.discount, taxes: l.taxes,
      account: incoming ? (partner.account || accountForClave(l.clave) || A.expense) : A.sales,
    }));
    const warnings = [];
    if (Math.abs(c.check) > 1) warnings.push(`Los importes del XML no suman el total (diferencia ${c.check.toFixed(2)}). Revísalo.`);
    if (c.currency !== 'MXN') warnings.push(`Factura en ${c.currency}, tipo de cambio ${c.rate}.`);
    let appliesTo = null;
    if (c.tipo === 'E') {
      const rel = c.related.map(r => books.db.docs.find(d => d.uuid === r.uuid)).find(Boolean);
      if (rel) appliesTo = rel.id; else if (c.related.length) warnings.push('La nota de crédito se relaciona con una factura que no está registrada.');
    }
    const d = books.newDoc(type, {
      partnerId: partner.id, date: c.date, currency: c.currency, rate: c.rate, uuid: c.uuid, serie: c.serie, folio: c.folio,
      metodoPago: c.metodoPago, formaPago: c.formaPago, lines, source: 'xml', warnings, related: c.related, appliesTo,
      cfdi: { version: c.version, uso: c.receptor.uso, emisor: c.emisor, receptor: c.receptor, lugar: c.lugar, fechaTimbrado: c.fechaTimbrado, condiciones: c.condiciones },
      files: [storeFile(books, f.name, f.buf)],
    }, user);
    d.total = c.total; books.computeDoc(d);
    if (!d.due || d.metodoPago === 'PUE') d.due = books.defaultDue(d);
    byUuid[c.uuid] = d; xmlBase[base(f.name)] = d;
    res.created.push({ file: f.name, id: d.id, type, partner: partner.name, total: d.total, currency: d.currency, date: d.date });
  }

  for (const f of pdfs) {
    let target = xmlBase[base(f.name)];
    let facts = null, printed = null;
    if (!target && (pdfText || pdfLayout)) {
      const tmp = path.join(books.filesDir, 'tmp-' + uid() + '.pdf');
      fs.writeFileSync(tmp, f.buf);
      try {
        const lay = pdfLayout ? await pdfLayout(tmp) : '';
        if (lay) { facts = factsFromText(lay); printed = parsePrinted(lay, company); }
        else { const r = await pdfText(tmp); facts = factsFromText(r && typeof r === 'object' ? r.text : r); }
      } catch (e) { facts = null; printed = null; } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
      if (facts && facts.uuid) target = byUuid[facts.uuid] || books.db.docs.find(d => d.uuid === facts.uuid && d.state !== 'cancelled');
    }
    if (target) {
      const sha = crypto.createHash('sha1').update(f.buf).digest('hex').slice(0, 16);
      if (!(target.files || []).some(x => x.sha === sha)) { target.files.push(storeFile(books, f.name, f.buf)); }
      res.attached.push({ file: f.name, id: target.id });
      continue;
    }
    // printed CFDI we could read completely: same as an XML import, flagged as read from the PDF
    if (printed) seenUuid.add(printed.uuid);
    const listed = printed && sat && sat[printed.uuid];
    if (listed && printed) {
      // the SAT list is authoritative for who issued it and the total
      if (listed.rfc && listed.rfc !== printed.emisor.rfc && printed.emisor.rfc !== company) printed.emisor = { ...printed.emisor, rfc: listed.rfc };
      if (listed.name) printed.emisor.name = listed.name;
      if (listed.total != null && Math.abs(listed.total - printed.total) > 0.05) { printed.ok = false; printed.notes.push(`El Excel dice total ${listed.total.toFixed(2)} y el PDF ${printed.total.toFixed(2)}.`); }
      if (/cancel/i.test(String(listed.cancel))) printed.notes.push('El Excel lo marca como cancelado ante el SAT.');
    }
    if (printed && printed.emisor.rfc && (printed.receptor.rfc === company || printed.emisor.rfc === company) && ['I', 'E'].includes(printed.tipo)) {
      if (books.db.docs.find(d => d.uuid === printed.uuid && d.state !== 'cancelled')) { res.duplicates.push({ file: f.name, uuid: printed.uuid }); continue; }
      const incoming = printed.emisor.rfc !== company, other = incoming ? printed.emisor : { rfc: printed.receptor.rfc, name: printed.receptor.name };
      let partner = books.findPartnerByRfc(other.rfc, other.name);
      if (!partner) partner = books.upsertPartner({ rfc: other.rfc, name: other.name || other.rfc, supplier: incoming, customer: !incoming, terms: 30, regimen: other.regimen || '' }, user);
      const type = incoming ? (printed.tipo === 'E' ? 'in_refund' : 'in_invoice') : (printed.tipo === 'E' ? 'out_refund' : 'out_invoice');
      const warnings = [printed.ok ? `Leído del PDF (no venía el XML). Los importes cuadran con el total impreso${listed ? ' y con el Excel del SAT' : ''}; sube el XML cuando lo tengas para confirmarlo.` : 'Leído del PDF (no venía el XML) con diferencias: revisa los conceptos y el IVA contra el PDF adjunto.', ...printed.notes];
      const d = books.newDoc(type, {
        partnerId: partner.id, date: printed.date || undefined, currency: printed.currency, rate: 1, uuid: printed.uuid, serie: printed.serie, folio: printed.folio,
        metodoPago: printed.metodoPago, formaPago: printed.formaPago, source: 'pdfcfdi', warnings,
        lines: printed.lines.map(l => ({ ...l, account: incoming ? (partner.account || books.A.expense) : books.A.sales })),
        cfdi: { version: '4.0', uso: printed.receptor.uso, emisor: printed.emisor, receptor: printed.receptor, fechaTimbrado: '' },
        files: [storeFile(books, f.name, f.buf)],
      }, user);
      d.total = printed.total; books.computeDoc(d);
      d.due = books.defaultDue(d);
      byUuid[printed.uuid] = d;
      res.created.push({ file: f.name, id: d.id, type, partner: partner.name, total: d.total, currency: d.currency, date: d.date, fromPdf: true, ok: printed.ok });
      continue;
    }
    // PDF without its XML: keep it as a supplier draft so nothing gets lost
    const rfcs = facts ? facts.rfcs.filter(r => r !== books.db.company.rfc) : [];
    const partner = rfcs.map(r => books.findPartnerByRfc(r)).find(Boolean) || null;
    if (facts && facts.uuid && books.db.docs.find(d => d.uuid === facts.uuid && d.state !== 'cancelled')) { res.duplicates.push({ file: f.name, uuid: facts.uuid }); continue; }
    const d = books.newDoc('in_invoice', {
      partnerId: partner ? partner.id : null, uuid: facts && facts.uuid ? facts.uuid : null, source: 'pdf',
      lines: [{ description: 'Capturar conceptos de la factura (PDF sin XML)', qty: 1, price: facts && facts.total ? r2(facts.total / 1.16) : 0, discount: 0, account: (partner && partner.account) || books.A.expense, taxCodes: ['IVA16'] }],
      warnings: ['Se recibió solo el PDF. Sube el XML para tener los importes exactos, o captura los conceptos a mano.' + (rfcs.length && !partner ? ` RFC encontrado en el PDF: ${rfcs.join(', ')}.` : '')],
      files: [storeFile(books, f.name, f.buf)],
    }, user);
    res.created.push({ file: f.name, id: d.id, type: 'in_invoice', partner: partner ? partner.name : '(sin proveedor)', total: d.total, currency: 'MXN', date: d.date, pdfOnly: true });
  }
  // invoices in the Excel with no file in this upload (and not already registered)
  res.missing = [];
  if (sat) for (const [uuid, x] of Object.entries(sat)) {
    if (seenUuid.has(uuid) || books.db.docs.some(d => d.uuid === uuid && d.state !== 'cancelled')) continue;
    res.missing.push({ uuid, rfc: x.rfc, name: x.name, total: x.total, fecha: x.fecha });
  }
  books.log(user, 'importó', 'archivos', '', `${res.created.length} documentos, ${res.payments.length} pagos, ${res.duplicates.length} duplicados, ${res.errors.length} errores`);
  return res;
}

module.exports = { importFiles };

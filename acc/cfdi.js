'use strict';
/* CFDI 3.3 / 4.0 reader. Returns a plain object with everything the books need.
   Handles Ingreso (I), Egreso (E), Pago (P, with pagos10/pagos20 complements); flags Nómina (N) and Traslado (T). */
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  isArray: name => ['Concepto', 'Traslado', 'Retencion', 'Pago', 'DoctoRelacionado', 'CfdiRelacionado', 'CfdiRelacionados'].includes(name),
  parseAttributeValue: false,
  trimValues: true,
});

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const TAX = { '001': 'ISR', '002': 'IVA', '003': 'IEPS' };

function taxList(node, kind) {
  if (!node) return [];
  const group = kind === 'traslado' ? node.Traslados : node.Retenciones;
  const items = group ? (kind === 'traslado' ? group.Traslado : group.Retencion) : [];
  return (items || []).map(t => ({
    kind,
    tax: TAX[t.Impuesto] || t.Impuesto,
    factor: t.TipoFactor || (kind === 'retencion' ? 'Tasa' : ''),
    rate: t.TasaOCuota != null ? num(t.TasaOCuota) : null,
    base: num(t.Base),
    amount: num(t.Importe),
  }));
}

function parseCfdi(xml) {
  const text = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml);
  let doc;
  try { doc = parser.parse(text.replace(/^﻿/, '')); } catch (e) { throw new Error('El XML no se pudo leer: ' + e.message); }
  const c = doc.Comprobante;
  if (!c) throw new Error('No es un CFDI (falta el nodo Comprobante).');
  const tfd = c.Complemento && (c.Complemento.TimbreFiscalDigital || (Array.isArray(c.Complemento) && c.Complemento.find(x => x.TimbreFiscalDigital)?.TimbreFiscalDigital));
  const uuid = tfd && tfd.UUID ? String(tfd.UUID).toUpperCase() : null;
  const emisor = c.Emisor || {}, receptor = c.Receptor || {};
  const conceptos = (c.Conceptos && c.Conceptos.Concepto) || [];
  const lines = conceptos.map(k => {
    const traslados = taxList(k.Impuestos, 'traslado'), retenciones = taxList(k.Impuestos, 'retencion');
    return {
      clave: k.ClaveProdServ || '', unidad: k.ClaveUnidad || k.Unidad || '', noIdent: k.NoIdentificacion || '',
      description: k.Descripcion || '', qty: num(k.Cantidad), price: num(k.ValorUnitario),
      amount: num(k.Importe), discount: num(k.Descuento), taxes: [...traslados, ...retenciones],
    };
  });
  const rel = [];
  (c.CfdiRelacionados || []).forEach(g => (g.CfdiRelacionado || []).forEach(x => rel.push({ tipo: g.TipoRelacion, uuid: String(x.UUID).toUpperCase() })));

  const out = {
    version: c.Version || c.version || '',
    uuid, fechaTimbrado: tfd && tfd.FechaTimbrado || null,
    tipo: c.TipoDeComprobante, // I, E, P, N, T
    serie: c.Serie || '', folio: c.Folio || '',
    date: (c.Fecha || '').slice(0, 10), datetime: c.Fecha || '',
    currency: c.Moneda || 'MXN', rate: c.TipoCambio ? num(c.TipoCambio) : 1,
    subtotal: num(c.SubTotal), discount: num(c.Descuento), total: num(c.Total),
    metodoPago: c.MetodoPago || '', formaPago: c.FormaPago || '', condiciones: c.CondicionesDePago || '',
    lugar: c.LugarExpedicion || '', exportacion: c.Exportacion || '',
    emisor: { rfc: String(emisor.Rfc || '').toUpperCase(), name: emisor.Nombre || '', regimen: emisor.RegimenFiscal || '' },
    receptor: { rfc: String(receptor.Rfc || '').toUpperCase(), name: receptor.Nombre || '', uso: receptor.UsoCFDI || '', cp: receptor.DomicilioFiscalReceptor || '', regimen: receptor.RegimenFiscalReceptor || '' },
    lines, related: rel,
    taxTotals: { traslados: num(c.Impuestos && c.Impuestos.TotalImpuestosTrasladados), retenciones: num(c.Impuestos && c.Impuestos.TotalImpuestosRetenidos) },
    payments: [],
  };
  if (out.currency === 'XXX') out.currency = 'MXN';
  if (out.tipo === 'P' && c.Complemento) {
    const comps = Array.isArray(c.Complemento) ? c.Complemento : [c.Complemento];
    for (const comp of comps) {
      const pagos = comp.Pagos;
      if (!pagos) continue;
      for (const p of pagos.Pago || []) {
        out.payments.push({
          date: String(p.FechaPago || '').slice(0, 10), forma: p.FormaDePagoP || '', currency: p.MonedaP || 'MXN',
          rate: p.TipoCambioP ? num(p.TipoCambioP) : 1, amount: num(p.Monto), ref: p.NumOperacion || '',
          docs: (p.DoctoRelacionado || []).map(d => ({
            uuid: String(d.IdDocumento || '').toUpperCase(), serie: d.Serie || '', folio: d.Folio || '',
            currency: d.MonedaDR || 'MXN', equiv: d.EquivalenciaDR ? num(d.EquivalenciaDR) : (d.TipoCambioDR ? num(d.TipoCambioDR) : 1),
            parcialidad: d.NumParcialidad || '', saldoAnt: num(d.ImpSaldoAnt), paid: num(d.ImpPagado), saldoInsoluto: num(d.ImpSaldoInsoluto),
          })),
        });
      }
    }
  }
  // sanity: lines + taxes should reproduce the total (within a peso of rounding)
  const tras = lines.reduce((a, l) => a + l.taxes.filter(t => t.kind === 'traslado').reduce((s, t) => s + t.amount, 0), 0);
  const ret = lines.reduce((a, l) => a + l.taxes.filter(t => t.kind === 'retencion').reduce((s, t) => s + t.amount, 0), 0);
  out.check = r2(out.subtotal - out.discount + (tras || out.taxTotals.traslados) - (ret || out.taxTotals.retenciones) - out.total);
  return out;
}

/* Pull CFDI facts out of a printed PDF's text (used to pair a PDF with its XML, or as a fallback). */
function factsFromText(text) {
  const t = String(text || '');
  const uuid = (t.match(/\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b/i) || [])[0];
  const rfcs = [...new Set((t.toUpperCase().match(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/g) || []))];
  let total = null;
  const m = t.match(/total[^0-9$]{0,25}\$?\s*([\d,]+\.\d{2})/i);
  if (m) total = parseFloat(m[1].replace(/,/g, ''));
  return { uuid: uuid ? uuid.toUpperCase() : null, rfcs, total };
}


/* Printed CFDI (the PDF "representación impresa"), read from layout text: lines separated by 3+ spaces between columns.
   Returns the same shape as parseCfdi plus `ok` (amounts add up) and `notes`, or null when it isn't a readable CFDI. */
const MONTHS = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
function printedDate(t) {
  let m = t.match(/Fecha[^\n\d]{0,20}(\d{1,2})[\/\- ]([A-Za-zé]{3})[a-z]*[\/\- ](\d{4})/i);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/Fecha[^\n\d]{0,20}(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/);
  return m ? m[1] : null;
}
function parsePrinted(text, companyRfc) {
  const t = String(text || '');
  const n = s => parseFloat(String(s).replace(/[$,\s]/g, ''));
  const uuid = ((t.match(/Folio Fiscal:?\s+([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})/i) || t.match(/\b([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\b/i) || [])[1] || '').toUpperCase();
  if (!uuid) return null;
  const L = t.split('\n').map(l => l.trim());
  const rfcRe = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
  // issuer: the first stand-alone RFC line that isn't ours, name on the line above
  let emisor = null;
  for (let i = 0; i < L.length; i++) if (rfcRe.test(L[i]) && L[i] !== companyRfc) { emisor = { rfc: L[i], name: (L[i - 1] || '').split(/\s{3,}/)[0].trim(), regimen: ((L[i + 1] || '').match(/^(\d{3}) - /) || [])[1] || '' }; break; }
  if (!emisor) { const r = (t.toUpperCase().match(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/g) || []).find(x => x !== companyRfc); if (r) emisor = { rfc: r, name: '', regimen: '' }; }
  const recRfc = (t.match(/RFC:?\s+([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/) || [])[1] || '';
  const tipo = (t.match(/\b([IEP]) - (Ingreso|Egreso|Pago)\b/) || [])[1] || 'I';
  const val = label => { const m = t.match(new RegExp(label + ':?\\s+\\$?\\s*([\\d,]+\\.\\d{2})', 'i')); return m ? n(m[1]) : null; };
  // concept lines
  const lines = []; let on = false;
  const lineRe = /^(\d+(?:\.\d+)?)\s{3,}([A-Z0-9]{2,3}\s-\s[^\s].*?)\s{3,}(.+?)\s{3,}([\d,]+\.\d{2,6})\s{3,}([\d,]+\.\d{2})$/;
  for (const l of L) {
    if (/^Cantidad\s{3,}/i.test(l)) { on = true; continue; }
    if (!on) continue;
    if (/Importe con letra|^Subtotal|^Forma de Pago|Sello digital/i.test(l)) { on = false; continue; }
    const m = l.match(lineRe);
    if (m) { const qty = n(m[1]), amount = n(m[5]); lines.push({ qty, unidad: m[2].trim(), description: m[3].trim(), price: qty ? Math.round(amount / qty * 1e6) / 1e6 : n(m[4]), amount, discount: 0, clave: '', taxes: [] }); }
    else if (lines.length && l && !/^\d+(\.\d+)?\s{3,}[A-Z0-9]{2,3} - /.test(l) && !/\s{3,}[\d,]+\.\d{2}$/.test(l) && !/^Cantidad|^Hoja|^P[aá]gina/i.test(l)) lines[lines.length - 1].description += ' ' + l;
  }
  if (!lines.length) return null;
  const sum = r2(lines.reduce((a, x) => a + x.amount, 0));
  const subtotal = val('Subtotal') ?? sum, iva = val('I\\.V\\.A\\.') ?? val('IVA') ?? 0, ieps = val('I\\.E\\.P\\.S\\.') ?? 0;
  const retIsr = val('Retenci[oó]n I\\.S\\.R\\.') ?? 0, retIva = val('Retenci[oó]n I\\.V\\.A\\.') ?? 0, discount = val('Descuentos?') ?? 0, total = val('Total');
  const notes = [];
  // IVA belongs to the 16% lines: find the set of lines whose 16% adds up to the IVA shown
  if (iva > 0) {
    const k = lines.length; let best = null;
    if (k <= 16) for (let mask = 1; mask < (1 << k); mask++) {
      let base = 0; for (let i = 0; i < k; i++) if (mask & (1 << i)) base += lines[i].amount;
      const d = Math.abs(r2(base * 0.16) - iva); if (d <= 0.02 * Math.max(1, Math.ceil(k / 4)) && (!best || d < best.d)) best = { mask, d };
    }
    if (best) lines.forEach((x, i) => { x.taxes.push({ kind: 'traslado', tax: 'IVA', factor: 'Tasa', rate: (best.mask & (1 << i)) ? 0.16 : 0, base: x.amount, amount: (best.mask & (1 << i)) ? r2(x.amount * 0.16) : 0 }); });
    else { notes.push('No se pudo saber qué conceptos llevan IVA; se repartió en proporción. Revísalo o sube el XML.'); let left = iva; lines.forEach((x, i) => { const a = i === k - 1 ? r2(left) : r2(iva * x.amount / sum); left -= a; x.taxes.push({ kind: 'traslado', tax: 'IVA', factor: 'Tasa', rate: 0.16, base: x.amount, amount: a }); }); }
    // make the line IVA add up to the printed IVA exactly
    const got = r2(lines.reduce((a, x) => a + x.taxes.reduce((b, y) => b + y.amount, 0), 0)), diff = r2(iva - got);
    if (diff) { const l = lines.find(x => x.taxes[0] && x.taxes[0].amount) || lines[0]; l.taxes[0].amount = r2(l.taxes[0].amount + diff); }
  } else lines.forEach(x => x.taxes.push({ kind: 'traslado', tax: 'IVA', factor: 'Tasa', rate: 0, base: x.amount, amount: 0 }));
  if (ieps) { notes.push(`El PDF trae IEPS por ${ieps.toFixed(2)}; se sumó al primer concepto. Revísalo o sube el XML.`); lines[0].taxes.push({ kind: 'traslado', tax: 'IEPS', factor: 'Tasa', rate: 0, base: lines[0].amount, amount: ieps }); }
  if (retIva) lines[0].taxes.push({ kind: 'retencion', tax: 'IVA', factor: 'Tasa', rate: 0, base: subtotal, amount: retIva });
  if (retIsr) lines[0].taxes.push({ kind: 'retencion', tax: 'ISR', factor: 'Tasa', rate: 0, base: subtotal, amount: retIsr });
  if (discount) lines[0].discount = discount;
  const calc = r2(sum - discount + iva + ieps - retIva - retIsr);
  const ok = total != null && Math.abs(sum - subtotal) <= 0.05 && Math.abs(calc - total) <= 0.05 && !notes.length;
  if (Math.abs(sum - subtotal) > 0.05) notes.push(`Los conceptos leídos suman ${sum.toFixed(2)} y el subtotal dice ${subtotal.toFixed(2)}: falta algún concepto.`);
  if (total != null && Math.abs(calc - total) > 0.05) notes.push(`Los importes leídos dan ${calc.toFixed(2)} y el total dice ${total.toFixed(2)}.`);
  return {
    uuid, tipo, serie: (t.match(/Serie:?\s+([A-Z0-9]+)/i) || [])[1] || '', folio: (t.match(/Folio:?\s+([A-Z0-9-]+)/i) || [])[1] || '',
    date: printedDate(t), currency: /D[oó]lar|USD/i.test((t.match(/Moneda:?\s+([^\n]+?)(\s{3,}|$)/m) || [])[1] || '') ? 'USD' : 'MXN', rate: 1,
    metodoPago: (t.match(/\b(PUE|PPD)\b/) || [])[1] || '', formaPago: (t.match(/Forma de Pago:?\s+(\d{2})/i) || [])[1] || '',
    emisor: emisor || { rfc: '', name: '', regimen: '' }, receptor: { rfc: recRfc, name: '', uso: (t.match(/Uso CFDI:?\s+([A-Z]\d{2})/i) || [])[1] || '' },
    lines, subtotal, total: total ?? calc, ok, notes, related: [],
  };
}

module.exports = { parseCfdi, factsFromText, parsePrinted, r2 };

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
/* RFC check digit (homoclave verifier). Lets us split a name glued to the RFC: "…EL TIGREDFL890915TE0". */
function rfcValid(rfc) {
  const abc = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ', r = rfc.length === 12 ? ' ' + rfc : rfc;
  if (r.length !== 13) return false;
  let sum = 0; for (let i = 0; i < 12; i++) { const v = abc.indexOf(r[i]); if (v < 0) return false; sum += v * (13 - i); }
  const m = 11 - (sum % 11), d = m === 11 ? '0' : m === 10 ? 'A' : String(m);
  return d === r[12];
}
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
  // issuer: in the header block (before "Cliente:"), the RFC that isn't ours; long names wrap and can end glued to the RFC.
  // Never take RFCs from the stamp's cadena original: that one is the PAC that certified the invoice.
  let emisor = null;
  const headEnd = L.findIndex(l => /^(Cliente|Receptor)\b/i.test(l));
  const head = L.slice(0, headEnd > 0 ? headEnd : 25);
  for (let i = 0; i < head.length && !emisor; i++) {
    let m = head[i].match(/([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\s*$/);
    if (!m || m[1] === companyRfc || /^RFC/i.test(head[i])) continue;
    // 4 letters = person, 3 = company; when glued to the name, keep the reading whose check digit is right
    if (m[1].length === 13 && !rfcValid(m[1]) && rfcValid(m[1].slice(1)) && head[i].length > 13) m = [m[0].slice(1), m[1].slice(1)];
    const parts = [];
    for (let j = i - 1; j >= 0 && !/^(Serie|Folio|Fecha|Hora|[IEP] - |Lugar|Versi)/i.test(head[j]) && parts.length < 3; j--) parts.unshift(head[j].split(/\s{3,}/)[0]);
    const before = head[i].slice(0, head[i].length - m[0].length).trim();
    emisor = { rfc: m[1], name: [...parts, before].filter(Boolean).join(before && parts.length && !/\s$/.test(parts[parts.length - 1]) ? ' ' : ' ').replace(/\s+/g, ' ').trim(), regimen: ((head[i + 1] || '').match(/^(\d{3}) - /) || [])[1] || '' };
  }
  if (!emisor) {
    const body = t.split(/Cadena original|\|\|1\.1\|/i)[0];
    const r = (body.toUpperCase().match(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/g) || []).find(x => x !== companyRfc);
    if (r) emisor = { rfc: r, name: '', regimen: '' };
  }
  const recRfc = (t.match(/RFC:?\s+([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/) || [])[1] || '';
  const tipo = (t.match(/\b([IEP]) - (Ingreso|Egreso|Pago)\b/) || [])[1] || 'I';
  const val = label => { const m = t.match(new RegExp(label + ':?\\s+\\$?\\s*([\\d,]+\\.\\d{2})', 'i')); return m ? n(m[1]) : null; };
  // concept lines
  const lines = []; let on = false;
  // the unit column can wrap ("Bidón de" / "plástico"), leaving its tail glued to the next line's unit code
  const lineRe = /^(\d+(?:\.\d+)?)\s{3,}[a-záéíóúñ]*([A-Z0-9]{2,3}\s-\s[^\s].*?)\s{3,}(.+?)\s{3,}([\d,]+\.\d{2,6})\s{3,}([\d,]+\.\d{2})$/;
  const looseRe = /^(\d+(?:\.\d+)?)\s{3,}[a-záéíóúñ]*(?:([A-Z0-9]{1,3})\s-\s)?(.+?)\s{3,}([\d,]+\.\d{2,6})\s{3,}([\d,]+\.\d{2})$/;
  for (const l of L) {
    if (/^Cantidad\s{3,}/i.test(l)) { on = true; continue; }
    if (!on) continue;
    if (/Importe con letra|^Subtotal|^Forma de Pago|Sello digital/i.test(l)) { on = false; continue; }
    const m = l.match(lineRe) || l.match(looseRe);
    if (m) { const qty = n(m[1]), amount = n(m[5]); lines.push({ qty, unidad: (m[2] || '').trim(), description: m[3].trim(), price: qty ? Math.round(amount / qty * 1e6) / 1e6 : n(m[4]), amount, discount: 0, clave: '', taxes: [] }); }
    else if (lines.length && l && !/^\d+(\.\d+)?\s{3,}/.test(l) && !/\s{3,}[\d,]+\.\d{2}$/.test(l) && !/^Cantidad|^Hoja|^P[aá]gina/i.test(l)) lines[lines.length - 1].description += ' ' + l;
  }
  if (!lines.length) return null;
  const sum = r2(lines.reduce((a, x) => a + x.amount, 0));
  const subtotal = val('Subtotal') ?? sum, iva = val('I\\.V\\.A\\.') ?? val('IVA') ?? 0, ieps = val('I\\.E\\.P\\.S\\.') ?? 0;
  const retIsr = val('Retenci[oó]n I\\.S\\.R\\.') ?? 0, retIva = val('Retenci[oó]n I\\.V\\.A\\.') ?? 0, discount = val('Descuentos?') ?? 0, total = val('Total');
  const notes = [];
  // Which lines carry each tax: find the set of lines whose rate × amount adds up to the printed tax.
  const k = lines.length, tol = 0.02 * Math.max(1, Math.ceil(k / 4));
  function pick(bases, target, rate) {
    if (k <= 20) {
      let best = null;
      for (let mask = 1; mask < (1 << k); mask++) {
        let b = 0; for (let i = 0; i < k; i++) if (mask & (1 << i)) b += bases[i];
        const d = Math.abs(r2(b * rate) - target); if (d <= tol && (!best || d < best.d)) best = { mask, d };
      }
      return best && bases.map((_, i) => !!(best.mask & (1 << i)));
    }
    // many lines: subset sum over cents of the base
    const cents = bases.map(b => Math.round(b * 100)), max = cents.reduce((a, b) => a + b, 0);
    if (max > 4e6) return null;
    const from = new Int32Array(max + 1).fill(-2); from[0] = -1;
    const via = new Int32Array(max + 1);
    for (let i = 0; i < k; i++) for (let v = max - cents[i]; v >= 0; v--) if (from[v] !== -2 && from[v + cents[i]] === -2) { from[v + cents[i]] = v; via[v + cents[i]] = i; }
    const want = target / rate * 100;
    let hit = -1, bd = Infinity;
    for (let v = Math.max(0, Math.floor(want - 300)); v <= Math.min(max, Math.ceil(want + 300)); v++) if (from[v] !== -2 && v) { const d = Math.abs(r2(v / 100 * rate) - target); if (d <= tol && d < bd) { bd = d; hit = v; } }
    if (hit < 0) return null;
    const use = bases.map(() => false); for (let v = hit; v > 0; v = from[v]) use[via[v]] = true;
    return use;
  }
  function spread(name, amount, rate, bases, use) {
    let left = amount;
    const idx = lines.map((_, i) => i).filter(i => use ? use[i] : true), tot = idx.reduce((a, i) => a + bases[i], 0) || 1;
    lines.forEach((x, i) => {
      const on = idx.includes(i);
      const a = !on ? 0 : i === idx[idx.length - 1] ? r2(left) : use ? r2(bases[i] * rate) : r2(amount * bases[i] / tot);
      if (on) left = r2(left - a);
      if (on || name === 'IVA') x.taxes.push({ kind: 'traslado', tax: name, factor: 'Tasa', rate: on ? rate : 0, base: bases[i], amount: a });
    });
  }
  // IEPS: printed, or the gap between the printed total and lines + IVA (many printouts leave IEPS out)
  const gap = total != null ? r2(total - (sum - discount + iva - retIva - retIsr)) : 0;
  const iepsTotal = ieps || (gap > 0.05 ? gap : 0); // a few centavos is rounding, not a tax
  const amounts = lines.map(x => x.amount);
  if (iepsTotal) {
    let use = null, rate = 0;
    for (const rt of [0.08, 0.265, 0.3, 0.53]) { use = pick(amounts, iepsTotal, rt); if (use) { rate = rt; break; } }
    if (use) spread('IEPS', iepsTotal, rate, amounts, use);
    else { notes.push(`${ieps ? 'IEPS' : 'Impuesto no desglosado en el PDF'} por ${iepsTotal.toFixed(2)}: se repartió en proporción entre los conceptos. Revísalo o sube el XML.`); spread('IEPS', iepsTotal, 0, amounts, null); }
  }
  const lineIeps = lines.map(x => x.taxes.filter(t => t.tax === 'IEPS').reduce((a, t) => a + t.amount, 0));
  if (iva > 0) {
    const withIeps = amounts.map((a, i) => r2(a + lineIeps[i]));
    let use = pick(withIeps, iva, 0.16), bases = withIeps;
    if (!use && iepsTotal) { use = pick(amounts, iva, 0.16); bases = amounts; }
    if (!use) for (const rt of [0.08]) { use = pick(amounts, iva, rt); if (use) { spread('IVA', iva, rt, amounts, use); break; } }
    if (use && !lines[0].taxes.some(t => t.tax === 'IVA')) spread('IVA', iva, 0.16, bases, use);
    if (!use) { notes.push('No se pudo saber qué conceptos llevan IVA; se repartió en proporción. Revísalo o sube el XML.'); spread('IVA', iva, 0.16, amounts, null); }
  } else lines.forEach(x => x.taxes.push({ kind: 'traslado', tax: 'IVA', factor: 'Tasa', rate: 0, base: x.amount, amount: 0 }));
  if (retIva) lines[0].taxes.push({ kind: 'retencion', tax: 'IVA', factor: 'Tasa', rate: 0, base: subtotal, amount: retIva });
  if (retIsr) lines[0].taxes.push({ kind: 'retencion', tax: 'ISR', factor: 'Tasa', rate: 0, base: subtotal, amount: retIsr });
  if (discount) lines[0].discount = discount;
  const calc = r2(sum - discount + iva + iepsTotal - retIva - retIsr);
  const ok = total != null && Math.abs(sum - subtotal) <= 0.05 && Math.abs(calc - total) <= 0.05 && !notes.length;
  if (total != null && Math.abs(calc - total) > 0 && Math.abs(calc - total) <= 0.05) lines[0].taxes[0].amount = r2(lines[0].taxes[0].amount + total - calc); // centavo rounding
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

module.exports = { parseCfdi, factsFromText, parsePrinted, rfcValid, r2 };

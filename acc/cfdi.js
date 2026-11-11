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

module.exports = { parseCfdi, factsFromText, r2 };

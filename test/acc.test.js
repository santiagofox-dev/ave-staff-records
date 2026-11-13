'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Books, r2 } = require('../acc/core');
const { parseCfdi } = require('../acc/cfdi');
const { importFiles } = require('../acc/importer');

const CO = 'GIF231017172';
function cfdi({ tipo = 'I', uuid, emisor, receptor, date = '2026-11-03T10:00:00', serie = 'A', folio = '1', metodo = 'PPD', moneda = 'MXN', tc, conceptos, related, pagos }) {
  let sub = 0, tras = 0, ret = 0;
  const cx = conceptos.map(c => {
    const imp = r2(c.qty * c.price); sub += imp;
    const t = (c.iva != null) ? r2(imp * c.iva) : 0; tras += t;
    const rIva = c.retIva ? r2(imp * c.retIva) : 0; ret += rIva;
    return `<cfdi:Concepto ClaveProdServ="${c.clave || '50000000'}" Cantidad="${c.qty}" ClaveUnidad="H87" Descripcion="${c.desc}" ValorUnitario="${c.price}" Importe="${imp.toFixed(2)}" ObjetoImp="02"><cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="${imp.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${(c.iva || 0).toFixed(6)}" Importe="${t.toFixed(2)}"/></cfdi:Traslados>${rIva ? `<cfdi:Retenciones><cfdi:Retencion Base="${imp.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${c.retIva.toFixed(6)}" Importe="${rIva.toFixed(2)}"/></cfdi:Retenciones>` : ''}</cfdi:Impuestos></cfdi:Concepto>`;
  }).join('');
  const total = r2(sub + tras - ret);
  const rel = related ? `<cfdi:CfdiRelacionados TipoRelacion="01"><cfdi:CfdiRelacionado UUID="${related}"/></cfdi:CfdiRelacionados>` : '';
  const pg = pagos ? `<pago20:Pagos Version="2.0"><pago20:Totales MontoTotalPagos="${pagos.amount}"/><pago20:Pago FechaPago="${pagos.date}T12:00:00" FormaDePagoP="03" MonedaP="MXN" TipoCambioP="1" Monto="${pagos.amount}">${pagos.docs.map(d => `<pago20:DoctoRelacionado IdDocumento="${d.uuid}" MonedaDR="MXN" EquivalenciaDR="1" NumParcialidad="1" ImpSaldoAnt="${d.ant}" ImpPagado="${d.paid}" ImpSaldoInsoluto="${r2(d.ant - d.paid)}" ObjetoImpDR="02"/>`).join('')}</pago20:Pago></pago20:Pagos>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" xmlns:pago20="http://www.sat.gob.mx/Pagos20" Version="4.0" Serie="${serie}" Folio="${folio}" Fecha="${date}" SubTotal="${tipo === 'P' ? 0 : sub.toFixed(2)}" Moneda="${tipo === 'P' ? 'XXX' : moneda}"${tc ? ` TipoCambio="${tc}"` : ''} Total="${tipo === 'P' ? 0 : total.toFixed(2)}" TipoDeComprobante="${tipo}" ${tipo === 'P' ? '' : `MetodoPago="${metodo}" FormaPago="99"`} LugarExpedicion="32000">${rel}<cfdi:Emisor Rfc="${emisor[0]}" Nombre="${emisor[1]}" RegimenFiscal="601"/><cfdi:Receptor Rfc="${receptor[0]}" Nombre="${receptor[1]}" DomicilioFiscalReceptor="32000" RegimenFiscalReceptor="601" UsoCFDI="G03"/><cfdi:Conceptos>${tipo === 'P' ? '<cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago" ValorUnitario="0" Importe="0" ObjetoImp="01"/>' : cx}</cfdi:Conceptos>${tipo === 'P' ? '' : `<cfdi:Impuestos TotalImpuestosTrasladados="${tras.toFixed(2)}"${ret ? ` TotalImpuestosRetenidos="${ret.toFixed(2)}"` : ''}/>`}<cfdi:Complemento>${pg}<tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="${date}"/></cfdi:Complemento></cfdi:Comprobante>`;
}
const SUP = ['AIN0112122R2', 'Abarrotes Institucionales, S. de R.L. de C.V.'], ME = [CO, 'GRUPO INDUSTRIAL FRONTERIZO AVE 78'], CLI = ['JCC000904KK2', 'Jabil Circuit de Chihuahua'];
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222', U3 = '33333333-3333-4333-8333-333333333333', U4 = '44444444-4444-4444-8444-444444444444', U5 = '55555555-5555-4555-8555-555555555555';

function freshBooks() { return new Books(fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'))); }
const X = (name, xml) => ({ name, buf: Buffer.from(xml) });

test('parses CFDI 4.0 ingreso with taxes and the timbre', () => {
  const c = parseCfdi(cfdi({ uuid: U1, emisor: SUP, receptor: ME, conceptos: [{ desc: 'Arroz', qty: 10, price: 100, iva: 0 }, { desc: 'Detergente', clave: '47131800', qty: 2, price: 50, iva: 0.16 }] }));
  assert.equal(c.uuid, U1); assert.equal(c.tipo, 'I'); assert.equal(c.emisor.rfc, SUP[0]);
  assert.equal(c.total, 1116); assert.equal(c.lines.length, 2); assert.equal(c.check, 0);
  assert.equal(c.lines[1].taxes[0].amount, 16);
});

test('supplier invoice → payment complement → books balance, cash-basis IVA', async () => {
  const b = freshBooks();
  const r = await importFiles(b, [X('f1.xml', cfdi({ uuid: U1, emisor: SUP, receptor: ME, conceptos: [{ desc: 'Arroz', qty: 10, price: 100, iva: 0 }, { desc: 'Detergente', clave: '47131800', qty: 2, price: 50, iva: 0.16 }] }))], 'test');
  assert.equal(r.created.length, 1);
  const d = b.doc(r.created[0].id);
  assert.equal(d.lines[0].account, '501.01.01');   // food → cost of sales
  assert.equal(d.lines[1].account, '601.54.01');   // cleaning
  b.postDoc(d.id, 'test');
  assert.match(d.number, /^PROV\/2026\/0001$/);
  assert.equal(b.residual(d), 1116);
  // duplicate import is refused
  const again = await importFiles(b, [X('f1.xml', cfdi({ uuid: U1, emisor: SUP, receptor: ME, conceptos: [{ desc: 'x', qty: 1, price: 1, iva: 0 }] }))], 'test');
  assert.equal(again.duplicates.length, 1);
  // partial payment via complemento de pago
  const p = await importFiles(b, [X('p.xml', cfdi({ tipo: 'P', uuid: U2, emisor: SUP, receptor: ME, conceptos: [], pagos: { date: '2026-11-20', amount: 558, docs: [{ uuid: U1, ant: 1116, paid: 558 }] } }))], 'test');
  assert.equal(p.payments.length, 1);
  assert.equal(b.residual(d), 558); assert.equal(b.payState(d), 'parcial');
  const tb = b.trialBalance('2026-11-01', '2026-11-30');
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(tb.totals.close, 0);
  const bal = (code) => (tb.rows.find(x => x.code === code) || { close: 0 }).close;
  assert.equal(bal('118.01.01'), 8);    // half of the 16 IVA is now paid
  assert.equal(bal('119.01.01'), 8);    // half still pending
  assert.equal(bal('201.01.01'), -558); // still owed
  const bs = b.balanceSheet('2026-11-30');
  assert.equal(bs.totals.diff, 0);
  const tax = b.taxReport('2026-11');
  assert.equal(tax.ivaPaid, 8);
  assert.equal(tax.diot[0].rfc, SUP[0]); assert.equal(tax.diot[0].paid, 558);
});

test('customer invoice with 6% IVA retention, credit note, collection', async () => {
  const b = freshBooks();
  const r = await importFiles(b, [
    X('fac.xml', cfdi({ uuid: U3, emisor: ME, receptor: CLI, conceptos: [{ desc: 'Servicio de comedor semana 45', clave: '90101700', qty: 2950, price: 70, iva: 0.16, retIva: 0.06 }] })),
    X('nc.xml', cfdi({ tipo: 'E', uuid: U4, emisor: ME, receptor: CLI, related: U3, conceptos: [{ desc: 'Bonificación', clave: '84111506', qty: 1, price: 1000, iva: 0.16, retIva: 0.06 }] })),
  ], 'test');
  assert.equal(r.created.length, 2);
  const inv = b.db.docs.find(d => d.uuid === U3), nc = b.db.docs.find(d => d.uuid === U4);
  assert.equal(inv.type, 'out_invoice'); assert.equal(nc.type, 'out_refund'); assert.equal(nc.appliesTo, inv.id);
  // 206,500 + 16% − 6% = 227,150
  assert.equal(inv.total, 227150);
  b.postDoc(inv.id, 'u'); b.postDoc(nc.id, 'u');
  assert.equal(b.residual(inv), 227150 - 1100);
  const pay = b.createPayment({ dir: 'in', partnerId: inv.partnerId, date: '2026-11-25', bankId: 'b1', amount: 226050, allocations: [{ docId: inv.id, amount: 226050 }] }, 'u');
  assert.equal(b.residual(inv), 0); assert.equal(b.payState(inv), 'pagado');
  const tb = b.trialBalance(null, '2026-11-30');
  assert.equal(tb.totals.close, 0);
  const pnl = b.pnl('2026-11-01', '2026-11-30');
  assert.equal(pnl.totals.income, 206500 - 1000);
  assert.equal(b.balanceSheet('2026-11-30').totals.diff, 0);
  assert.ok(pay.number.startsWith('COBRO/'));
  // cash basis: IVA collected and IVA withheld by the client both follow the collection (net of the credit note)
  const tax = b.taxReport('2026-11');
  assert.equal(tax.ivaCollected, 33040 - 160);
  assert.equal(tax.ivaRetByClients, 12390 - 60);
  assert.equal(b.taxReport('2026-10').ivaRetByClients, 0);
});

test('lock date, unbalanced entries and overpayment are refused', () => {
  const b = freshBooks();
  const p = b.upsertPartner({ rfc: 'XAXX010101000', name: 'Público en general', customer: true }, 'u');
  const d = b.newDoc('out_invoice', { partnerId: p.id, date: '2026-10-15', lines: [{ description: 'Evento', qty: 1, price: 1000, account: '401.01.01', taxCodes: ['IVA16'] }] }, 'u');
  assert.equal(d.total, 1160);
  b.db.settings.lockDate = '2026-10-31';
  assert.throws(() => b.postDoc(d.id, 'u'), /cerrado/);
  b.db.settings.lockDate = null;
  b.postDoc(d.id, 'u');
  assert.throws(() => b.createPayment({ dir: 'in', partnerId: p.id, date: '2026-11-01', bankId: 'b1', amount: 2000, allocations: [{ docId: d.id, amount: 2000 }] }, 'u'), /supera su saldo/);
  const e = b.saveEntry({ date: '2026-11-01', ref: 'Aportación', lines: [{ account: '102.01.01', debit: 500 }, { account: '302.01.01', credit: 400 }] }, 'u');
  assert.throws(() => b.postEntry(e.id, 'u'), /no cuadra/);
  b.saveEntry({ id: e.id, date: '2026-11-01', ref: 'Aportación', lines: [{ account: '102.01.01', debit: 500 }, { account: '302.01.01', credit: 500 }] }, 'u');
  b.postEntry(e.id, 'u');
  assert.equal(b.balanceSheet('2026-11-30').totals.diff, 0);
  const ag = b.aging('ar', '2026-12-31');
  assert.equal(ag.totals.total, 1160);
});

test('foreign-currency invoice converts at the CFDI exchange rate', async () => {
  const b = freshBooks();
  const r = await importFiles(b, [X('usd.xml', cfdi({ uuid: U5, emisor: SUP, receptor: ME, moneda: 'USD', tc: '18.50', conceptos: [{ desc: 'Equipo', clave: '48101500', qty: 1, price: 1000, iva: 0.16 }] }))], 'u');
  const d = b.doc(r.created[0].id);
  assert.equal(d.totalMxn, 21460);
  b.postDoc(d.id, 'u');
  assert.equal(b.trialBalance(null, null).totals.close, 0);
});

test('printed CFDI (PDF without XML) is read with its lines, IVA split and total', async () => {
  const { parsePrinted } = require('../acc/cfdi');
  const txt = ['I - Ingreso', 'Serie:   CHIA', 'Folio:   168080', 'Fecha:   06/Oct/2026', 'ABARROTES INSTITUCIONALES', 'AIN0112122R2', '601 - General de Ley Personas Morales',
    'RFC:   GIF231017172   Moneda: Peso Mexicano', 'Uso CFDI:   G03 - Gastos en general', 'Cantidad   Unidad   Descripción   Valor unitario   Importe',
    '7.00   H87 - Pieza   PASTA DE TOMATE DEL FUERTE BOLSA   182.53   1,277.74', '4/3 KG',
    '2.00   XPK - Paquete   PAPEL ALUMINIO PRECORTADO   163.39   326.78', 'Importe con letra   1,604.52', 'Subtotal:', 'mil seiscientos   I.V.A.:   52.28',
    'Forma de Pago:   03 - Transferencia electrónica de fondos   Retención I.S.R.:   0.00', 'Retención I.V.A.:   0.00', 'Descuentos:   0.00', 'Total:   $1,656.80',
    'PUE - Pago en una sola exhibición', 'Folio Fiscal:   2B0EC3D0-D364-43A2-94FE-B8632779C5FB'].join('\n');
  const c = parsePrinted(txt, CO);
  assert.equal(c.ok, true); assert.equal(c.date, '2026-10-06'); assert.equal(c.emisor.rfc, 'AIN0112122R2'); assert.equal(c.lines.length, 2);
  assert.equal(c.lines[0].description, 'PASTA DE TOMATE DEL FUERTE BOLSA 4/3 KG');
  assert.equal(c.lines[0].taxes[0].amount, 0); assert.equal(c.lines[1].taxes[0].amount, 52.28);
  const b = freshBooks();
  const { importFiles: imp } = require('../acc/importer');
  const r = await imp(b, [{ name: 'f.pdf', buf: Buffer.from('%PDF') }], 'u', { layout: async () => txt });
  assert.equal(r.created.length, 1); assert.equal(r.created[0].fromPdf, true);
  const d = b.doc(r.created[0].id); assert.equal(d.total, 1656.8); assert.equal(d.metodoPago, 'PUE');
  b.postDoc(d.id, 'u'); assert.equal(b.trialBalance().totals.close, 0);
});

test('printed CFDI: issuer name glued to its RFC, IEPS left off the printout, PAC RFC ignored', () => {
  const { parsePrinted, rfcValid } = require('../acc/cfdi');
  assert.ok(rfcValid('DFL890915TE0')); assert.ok(!rfcValid('EDFL890915TE0'));
  const txt = ['I - Ingreso', 'Folio:   9003176688', 'Fecha:   10/Nov/2026', 'Hora:   00:00:00', 'DISTRIBUIDORA FRUTAS Y LEGUMBRES EL', 'TIGREDFL890915TE0', '601 - General de Ley Personas Morales',
    'Cliente: GRUPO INDUSTRIAL FRONTERIZO AVE 78', 'RFC:   GIF231017172', 'Cantidad   Unidad   Descripción   Valor unitario   Importe',
    '15   H87 - Pieza   PAPIRRINGAS 40G   11.70   175.50', '1   plásticoX3H - Bidón de   CLORO   100.00   100.00', 'Importe con letra   275.50', 'I.V.A.:   0.00', 'Descuentos:   0.00',
    'Total:   $289.54', 'Folio Fiscal:   1D940A1C-2B8D-4DFA-9ECF-79DE1BD86992', '||1.1|1D940A1C-2B8D-4DFA-9ECF-79DE1BD86992|2026-11-09T10:24:45|MAS0810247C0|'].join('\n');
  const c = parsePrinted(txt, CO);
  assert.equal(c.emisor.rfc, 'DFL890915TE0'); assert.equal(c.emisor.name, 'DISTRIBUIDORA FRUTAS Y LEGUMBRES EL TIGRE');
  assert.equal(c.lines.length, 2); assert.equal(c.lines[1].description, 'CLORO');
  assert.equal(c.ok, true);
  const ieps = c.lines.map(l => (l.taxes.find(t => t.tax === 'IEPS') || {}).amount || 0);
  assert.deepEqual(ieps, [14.04, 0]);
});

test('credit days run from the received date; changing terms moves open invoices; name-only contacts get claimed', () => {
  const b = freshBooks();
  const p = b.upsertPartner({ name: 'Grupo Calibeb', supplier: true, terms: 30 }, 'u');
  assert.equal(b.claimByName('GCA010101AB1', 'GRUPO CALIBEB, S.A. DE C.V.').id, p.id);
  assert.equal(b.partner(p.id).rfc, 'GCA010101AB1');
  const d = b.newDoc('in_invoice', { partnerId: p.id, date: '2026-11-09', metodoPago: 'PPD', lines: [{ description: 'x', qty: 1, price: 100, account: '501.01.01', taxCodes: [] }] }, 'u');
  assert.equal(d.due, '2026-12-09');
  b.postDoc(d.id, 'u');
  b.setDates(d.id, { received: '2026-11-12' }, 'u');
  assert.equal(b.doc(d.id).due, '2026-12-12');
  b.upsertPartner({ ...b.partner(p.id), terms: 0 }, 'u');
  assert.equal(b.doc(d.id).due, '2026-11-12');
});

test('supplier portal import: pinned to the vendor, wrong RFC rejected, RFC learned on first invoice', async () => {
  const { importFiles } = require('../acc/importer');
  const b = freshBooks();
  const v = b.upsertPartner({ name: 'Grupo Calibeb', supplier: true, terms: 30 }, 'u');
  const ok = await importFiles(b, [{ name: 'a.xml', buf: Buffer.from(cfdi({ uuid: 'cccccccc-0000-4000-8000-000000000001', emisor: ['GCA010101AB1', 'GRUPO CALIBEB SA DE CV'], receptor: [CO, 'AVE'], conceptos: [{ desc: 'x', qty: 1, price: 100, iva: 0.16 }] })) }], 'p', null, { vendor: v });
  assert.equal(ok.created.length, 1); assert.equal(b.doc(ok.created[0].id).partnerId, v.id); assert.equal(v.rfc, 'GCA010101AB1');
  const bad = await importFiles(b, [{ name: 'b.xml', buf: Buffer.from(cfdi({ uuid: 'cccccccc-0000-4000-8000-000000000002', emisor: ['AIN0112122R2', 'OTRO'], receptor: [CO, 'AVE'], conceptos: [{ desc: 'x', qty: 1, price: 100, iva: 0 }] })) }], 'p', null, { vendor: v });
  assert.equal(bad.created.length, 0); assert.match(bad.errors[0].error, /no el de Grupo Calibeb/);
});

test('test supplier accepts any invoice as a separate PRUEBA copy and learns no RFC', async () => {
  const { importFiles } = require('../acc/importer');
  const b = freshBooks();
  const xml = Buffer.from(cfdi({ uuid: 'dddddddd-0000-4000-8000-000000000001', emisor: ['AIN0112122R2', 'ABARROTES'], receptor: [CO, 'AVE'], conceptos: [{ desc: 'x', qty: 1, price: 100, iva: 0 }] }));
  await importFiles(b, [{ name: 'real.xml', buf: xml }], 'u');
  const t = b.upsertPartner({ name: 'Proveedor Prueba', supplier: true, terms: 30 }, 'u');
  const r = await importFiles(b, [{ name: 'test.xml', buf: xml }], 'p', null, { vendor: t, test: true });
  assert.equal(r.created.length, 1); assert.equal(b.doc(r.created[0].id).partnerId, t.id);
  assert.ok(b.doc(r.created[0].id).uuid.startsWith('PRUEBA-')); assert.equal(t.rfc, '');
});

test('portal: two-word passwords and vendor usernames', () => {
  const portal = require('../acc/portal');
  const fake = { get() {}, post() {} };
  const b = freshBooks();
  const api = portal(fake, { books: () => b, pdf: null, publicUrl: 'https://x', secret: 'testsecret1234567890' });
  const p = b.upsertPartner({ name: 'Distribuidora Arca Continental', supplier: true, terms: 30 }, 'u');
  api.enable({}, p.id, 'Chihuahua', 'u');
  const c = api.credentials(p.id, 'arca.continental', 'u');
  assert.equal(c.username, 'arca.continental'); assert.match(c.password, /^[a-z]+\.[a-z]+$/);
  const q = b.upsertPartner({ name: 'Otro', supplier: true }, 'u'); api.enable({}, q.id, 'Chihuahua', 'u');
  assert.throws(() => api.credentials(q.id, 'arca.continental', 'u'), /ya lo tiene/);
});

test('erase leaves a ghost with who/when, drops it from the books and frees the UUID', async () => {
  const b = freshBooks();
  const xml = Buffer.from(cfdi({ uuid: 'eeeeeeee-1111-4000-8000-000000000001', emisor: SUP, receptor: ME, conceptos: [{ desc: 'Arroz', qty: 10, price: 100, iva: 0.16 }] }));
  const r = await importFiles(b, [{ name: 'a.xml', buf: xml }], 'u');
  const id = r.created[0].id;
  b.postDoc(id, 'u');
  const before = b.aging('ap').partners.reduce((a, p) => a + p.total, 0);
  assert.ok(before > 1000);
  const d = b.eraseDoc(id, 'Maria');
  assert.equal(d.state, 'erased'); assert.equal(d.erased.by, 'Maria'); assert.equal(d.erased.from, 'posted'); assert.ok(d.erased.at);
  assert.equal(d.uuid, undefined); assert.equal(d.erased.uuid.toLowerCase(), 'eeeeeeee-1111-4000-8000-000000000001');
  assert.equal(b.aging('ap').partners.reduce((a, p) => a + p.total, 0), 0);
  assert.ok(b.db.docs.find(x => x.id === id), 'ghost stays in the list');
  assert.throws(() => b.eraseDoc(id, 'Maria'), /ya fue eliminado/);
  const again = await importFiles(b, [{ name: 'a.xml', buf: xml }], 'u');
  assert.equal(again.created.length, 1, 'same CFDI can be imported again');
});

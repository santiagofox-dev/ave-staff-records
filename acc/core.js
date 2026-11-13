'use strict';
/* Grupo AVE accounting engine.
   Documents (invoices, credit notes), payments and manual entries are the source of truth;
   the journal (double entry) is derived from posted records, so books always balance. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const today = () => new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10); // Ciudad Juárez (UTC-7)
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const uid = () => crypto.randomBytes(6).toString('hex');
const fixedAmounts = d => d.source === 'xml' || d.source === 'pdfcfdi'; // amounts come from a stamped CFDI
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const TYPES = {
  in_invoice: { label: 'Factura de proveedor', side: 'ap', sign: 1, prefix: 'PROV' },
  in_refund: { label: 'Nota de crédito de proveedor', side: 'ap', sign: -1, prefix: 'NCP' },
  out_invoice: { label: 'Factura de cliente', side: 'ar', sign: 1, prefix: 'FAC' },
  out_refund: { label: 'Nota de crédito a cliente', side: 'ar', sign: -1, prefix: 'NC' },
};
const ACC_TYPES = {
  BK: 'Banco y caja', AR: 'Por cobrar', AC: 'Activo circulante', AN: 'Activo no circulante', AF: 'Activo fijo', AP: 'Pagos anticipados',
  LP: 'Por pagar', LU: 'Pasivo circulante', LN: 'Pasivo no circulante', LC: 'Tarjeta de crédito',
  EQ: 'Capital', EU: 'Resultado del ejercicio', IN: 'Ingresos', IO: 'Otros ingresos', EC: 'Costo directo', EX: 'Gastos', ED: 'Depreciación', OB: 'Fuera de balance',
};
const ASSET = new Set(['BK', 'AR', 'AC', 'AN', 'AF', 'AP']), LIAB = new Set(['LP', 'LU', 'LN', 'LC']), EQUITY = new Set(['EQ', 'EU']);
const INCOME = new Set(['IN', 'IO']), EXPENSE = new Set(['EC', 'EX', 'ED']);

/* Tax presets for manually captured documents */
const TAX_PRESETS = {
  IVA16: { kind: 'traslado', tax: 'IVA', rate: 0.16, label: 'IVA 16%' },
  IVA8: { kind: 'traslado', tax: 'IVA', rate: 0.08, label: 'IVA 8% (frontera)' },
  IVA0: { kind: 'traslado', tax: 'IVA', rate: 0, label: 'IVA 0%' },
  EXENTO: { kind: 'traslado', tax: 'IVA', rate: null, factor: 'Exento', label: 'Exento' },
  IEPS8: { kind: 'traslado', tax: 'IEPS', rate: 0.08, label: 'IEPS 8%' },
  RETIVA1067: { kind: 'retencion', tax: 'IVA', rate: 0.106667, label: 'Retención IVA 2/3 (10.67%)' },
  RETIVA6: { kind: 'retencion', tax: 'IVA', rate: 0.06, label: 'Retención IVA 6% (servicios especializados)' },
  RETIVA4: { kind: 'retencion', tax: 'IVA', rate: 0.04, label: 'Retención IVA 4% (fletes)' },
  RETISR10: { kind: 'retencion', tax: 'ISR', rate: 0.10, label: 'Retención ISR 10%' },
  RETISR125: { kind: 'retencion', tax: 'ISR', rate: 0.0125, label: 'Retención ISR 1.25% (RESICO)' },
};

/* Suggested expense account from the SAT product/service code (ClaveProdServ) */
const CLAVE_RULES = [
  [/^50/, '501.01.01'],            // alimentos, bebidas y tabaco → costo de venta
  [/^4719|^4713|^4712|^4711/, '601.54.01'], // limpieza
  [/^1510/, '601.48.01'],           // combustibles
  [/^4412|^4410|^1411/, '601.55.01'], // papelería
  [/^8310(15|16)/, '601.51.01'],    // agua
  [/^831018|^8310(17|18)/, '601.52.01'], // electricidad
  [/^8311/, '601.50.01'],           // telecomunicaciones
  [/^4323|^8111/, '601.60.01'],     // software
  [/^7810|^7811|^7812/, '602.72.01'], // fletes
  [/^8012|^8016|^8411|^8013/, '601.34.01'], // honorarios / servicios profesionales
  [/^8013(15|16)/, '601.46.01'],    // arrendamiento
  [/^7210|^7215|^7315/, '601.56.01'], // mantenimiento
  [/^8413/, '601.57.01'],           // seguros
  [/^4818|^4810|^4811|^4812|^5214/, '501.01.01'], // equipo y utensilios de cocina de uso diario
];
function accountForClave(clave) {
  for (const [re, acc] of CLAVE_RULES) if (re.test(clave || '')) return acc;
  return null;
}

const DEFAULT_SETTINGS = {
  lockDate: null,
  iepsCreditable: false,
  accounts: {
    payable: '201.01.01', receivable: '105.01.01', sales: '401.01.01', expense: '601.84.01', salesReturns: '402.01.01',
    ivaPending: '119.01.01', ivaPaid: '118.01.01', ivaUncollected: '209.01.01', ivaCollected: '208.01.01',
    iepsPending: '119.03.01', iepsPaid: '118.03.01', iepsUncollected: '209.02.01', iepsCollected: '208.02.01',
    retIvaPending: '216.10.10', retIvaPaid: '216.10.20', retIsr: '216.04.01',
    clientRetIva: '113.05.01', clientRetIsr: '113.02.02', advSupplier: '120.01.01', advCustomer: '206.01.01',
    result: '305.01.01',
  },
};

class Books {
  constructor(dir, opts = {}) {
    this.dir = dir; this.file = path.join(dir, 'books.json'); this.filesDir = path.join(dir, 'files');
    fs.mkdirSync(this.filesDir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    if (fs.existsSync(this.file)) this.db = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    else this.db = this.fresh(opts);
    this.db.settings = { ...DEFAULT_SETTINGS, ...this.db.settings, accounts: { ...DEFAULT_SETTINGS.accounts, ...(this.db.settings || {}).accounts } };
    this.save();
  }

  fresh(opts) {
    const coaFile = path.join(__dirname, 'coa-odoo.txt');
    const accounts = fs.readFileSync(coaFile, 'utf8').trim().split('\n').map(l => {
      const [code, name, type, rec] = l.split('|');
      return { code, name, type, reconcile: rec === 'r', active: true };
    });
    // Accounts the Odoo chart lacks but Mexican cash-basis bookkeeping needs
    accounts.push({ code: '113.05.01', name: 'IVA retenido por clientes', type: 'AC', reconcile: false, active: true });
    accounts.sort((a, b) => a.code.localeCompare(b.code));
    return {
      v: 1, seq: {},
      company: { name: 'Grupo Industrial Fronterizo AVE 78, S.A. de C.V.', rfc: (opts.rfc || 'GIF231017172').toUpperCase(), regimen: '601', cp: '' },
      settings: DEFAULT_SETTINGS,
      accounts,
      banks: [{ id: 'b1', name: 'Banco principal', account: '102.01.01', number: '' }, { id: 'b2', name: 'Caja', account: '101.01.01', number: '' }],
      partners: [], docs: [], payments: [], entries: [], audit: [],
    };
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
    const stamp = today();
    const bk = path.join(this.dir, 'backups', `books-${stamp}.json`);
    if (!fs.existsSync(bk)) {
      fs.copyFileSync(this.file, bk);
      const all = fs.readdirSync(path.join(this.dir, 'backups')).filter(f => f.startsWith('books-')).sort();
      while (all.length > 45) fs.unlinkSync(path.join(this.dir, 'backups', all.shift()));
    }
  }

  log(user, action, kind, id, detail) {
    this.db.audit.push({ ts: new Date().toISOString(), user: user || 'sistema', action, kind, id, detail: detail || '' });
    if (this.db.audit.length > 20000) this.db.audit.splice(0, this.db.audit.length - 20000);
  }

  /* ---------- lookups ---------- */
  account(code) { return this.db.accounts.find(a => a.code === code); }
  partner(id) { return this.db.partners.find(p => p.id === id); }
  doc(id) { return this.db.docs.find(d => d.id === id); }
  payment(id) { return this.db.payments.find(p => p.id === id); }
  entry(id) { return this.db.entries.find(e => e.id === id); }
  bank(id) { return this.db.banks.find(b => b.id === id); }
  get A() { return this.db.settings.accounts; }
  locked(date) { const l = this.db.settings.lockDate; return !!(l && date <= l); }

  nextNumber(prefix, date) {
    const y = (date || today()).slice(0, 4), k = prefix + '/' + y;
    this.db.seq[k] = (this.db.seq[k] || 0) + 1;
    return `${prefix}/${y}/${String(this.db.seq[k]).padStart(4, '0')}`;
  }

  /* ---------- partners ---------- */
  findPartnerByRfc(rfc, name) {
    rfc = String(rfc || '').toUpperCase().trim();
    const generic = rfc === 'XAXX010101000' || rfc === 'XEXX010101000';
    return this.db.partners.find(p => generic ? (p.rfc === rfc && p.name.toLowerCase() === String(name || '').toLowerCase()) : p.rfc === rfc);
  }
  upsertPartner(data, user) {
    let p = data.id ? this.partner(data.id) : null;
    const rfc = String(data.rfc || '').toUpperCase().trim();
    if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) throw httpErr(400, 'El RFC no tiene un formato válido.');
    if (!p && rfc) { const dup = this.findPartnerByRfc(rfc, data.name); if (dup && !['XAXX010101000', 'XEXX010101000'].includes(rfc)) throw httpErr(400, `Ya existe un contacto con el RFC ${rfc}: ${dup.name}.`); }
    if (!String(data.name || '').trim()) throw httpErr(400, 'Falta el nombre del contacto.');
    if (data.account && !this.account(data.account)) throw httpErr(400, 'La cuenta contable por defecto no existe.');
    const fields = { rfc, name: String(data.name).trim(), supplier: !!data.supplier, customer: !!data.customer, terms: Math.max(0, Math.min(365, parseInt(data.terms, 10) || 0)), account: data.account || null, email: data.email || '', phone: data.phone || '', regimen: data.regimen || '', cp: data.cp || '', notes: data.notes || '' };
    if (p) { const termsChanged = p.terms !== fields.terms; Object.assign(p, fields); this.log(user, 'editó', 'contacto', p.id, p.name); if (termsChanged) this.recomputeDue(p.id, user); }
    else { p = { id: uid(), created: new Date().toISOString(), ...fields }; this.db.partners.push(p); this.log(user, 'creó', 'contacto', p.id, p.name); }
    return p;
  }

  /* ---------- documents ---------- */
  computeDoc(d) {
    let subtotal = 0, discount = 0, tras = 0, ret = 0;
    for (const l of d.lines) {
      l.qty = Number(l.qty) || 0; l.price = Number(l.price) || 0; l.discount = r2(l.discount || 0);
      if (!fixedAmounts(d)) {
        l.amount = r2(l.qty * l.price);
        const base = r2(l.amount - l.discount);
        l.taxes = (l.taxCodes || []).filter(k => TAX_PRESETS[k]).map(k => {
          const t = TAX_PRESETS[k];
          return { kind: t.kind, tax: t.tax, rate: t.rate, factor: t.factor || 'Tasa', base, amount: t.rate == null ? 0 : r2(base * t.rate), code: k };
        });
      }
      subtotal += l.amount; discount += l.discount;
      for (const t of l.taxes || []) { if (t.kind === 'traslado') tras += t.amount; else ret += t.amount; }
    }
    d.subtotal = r2(subtotal); d.discount = r2(discount); d.traslados = r2(tras); d.retenciones = r2(ret);
    const calc = r2(subtotal - discount + tras - ret);
    if (!fixedAmounts(d) || !d.total) d.total = calc;
    d.rate = Number(d.rate) || 1;
    d.totalMxn = r2(d.total * d.rate);
    return d;
  }

  newDoc(type, data, user) {
    if (!TYPES[type]) throw httpErr(400, 'Tipo de documento no válido.');
    const d = {
      id: uid(), type, number: null, state: 'draft', partnerId: data.partnerId || null, date: data.date || today(), due: data.due || null,
      currency: data.currency || 'MXN', rate: data.rate || 1, uuid: data.uuid || null, serie: data.serie || '', folio: data.folio || '',
      metodoPago: data.metodoPago || '', formaPago: data.formaPago || '', ref: data.ref || '', notes: data.notes || '',
      lines: data.lines || [], files: data.files || [], source: data.source || 'manual', warnings: data.warnings || [], related: data.related || [],
      appliesTo: data.appliesTo || null, cfdi: data.cfdi || null,
      createdBy: user, createdAt: new Date().toISOString(),
    };
    this.computeDoc(d);
    if (!d.due) d.due = this.defaultDue(d);
    this.db.docs.push(d);
    this.log(user, 'creó', 'documento', d.id, `${TYPES[type].label} ${d.serie}${d.folio}`.trim());
    return d;
  }
  defaultDue(d) {
    const p = d.partnerId && this.partner(d.partnerId);
    if (d.metodoPago === 'PUE') return d.date;
    // credit days run from the day we received the invoice (defaults to its date)
    return addDays(d.received || d.date, p ? (p.terms || 0) : 30);
  }
  setDates(id, { received, due }, user) {
    const d = this.doc(id);
    if (!d) throw httpErr(404, 'No se encontró el documento.');
    if (d.state === 'cancelled') throw httpErr(400, 'El documento está cancelado.');
    if (received !== undefined) { if (received && !isDate(received)) throw httpErr(400, 'Fecha de recepción no válida.'); d.received = received || null; }
    if (due) { if (!isDate(due)) throw httpErr(400, 'Fecha de vencimiento no válida.'); d.due = due; }
    else if (received !== undefined) d.due = this.defaultDue(d);
    this.log(user, 'cambió fechas', 'documento', d.id, `${d.number || 'borrador'}: recibida ${d.received || d.date}, vence ${d.due}`);
    return d;
  }
  /* after a supplier's credit days change, move the due date of its open invoices */
  recomputeDue(partnerId, user) {
    let n = 0;
    for (const d of this.db.docs) {
      if (d.partnerId !== partnerId || d.state === 'cancelled' || d.state === 'erased' || d.metodoPago === 'PUE') continue;
      if (d.state === 'posted' && this.residual(d) <= 0.009) continue;
      const due = this.defaultDue(d); if (due !== d.due) { d.due = due; n++; }
    }
    if (n) this.log(user, 'recalculó vencimientos', 'contacto', partnerId, `${n} facturas`);
    return n;
  }
  /* a contact created by hand with no RFC (e.g. from a supplier list) is claimed by the first invoice whose issuer name matches */
  claimByName(rfc, name) {
    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(s\.?\s?a\.?|de|c\.?v\.?|s\.?\s?de\s?r\.?l\.?|sapi|sas|la|el|los|las|y)\b/g, ' ').replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/).filter(Boolean);
    const want = norm(name); if (!want.length) return null;
    const p = this.db.partners.find(x => !x.rfc && (() => { const t = norm(x.name); return t.length && t.every(w => want.includes(w)); })());
    if (p && rfc) p.rfc = String(rfc).toUpperCase();
    return p || null;
  }

  updateDoc(id, data, user) {
    const d = this.doc(id);
    if (!d) throw httpErr(404, 'No se encontró el documento.');
    if (d.state !== 'draft') throw httpErr(400, 'Solo se pueden editar documentos en borrador. Pásalo a borrador primero.');
    const allowed = ['partnerId', 'date', 'due', 'received', 'ref', 'notes', 'currency', 'rate', 'metodoPago', 'formaPago', 'serie', 'folio'];
    for (const k of allowed) if (k in data) d[k] = data[k];
    if ('received' in data && !data.due) d.due = this.defaultDue(d);
    if (Array.isArray(data.lines)) {
      if (fixedAmounts(d)) {
        // XML amounts are fixed by the CFDI; only the account (and description note) can change
        data.lines.forEach((l, i) => { if (d.lines[i] && l.account) d.lines[i].account = l.account; });
      } else {
        d.lines = data.lines.map(l => ({ description: String(l.description || ''), clave: l.clave || '', qty: Number(l.qty) || 0, price: Number(l.price) || 0, discount: Number(l.discount) || 0, account: l.account || '', taxCodes: (l.taxCodes || []).filter(k => TAX_PRESETS[k]) }));
      }
    }
    this.computeDoc(d);
    if (!d.due) d.due = this.defaultDue(d);
    this.log(user, 'editó', 'documento', d.id, d.number || 'borrador');
    return d;
  }

  validateDoc(d) {
    const errs = [];
    if (!d.partnerId || !this.partner(d.partnerId)) errs.push('Falta el contacto.');
    if (!isDate(d.date)) errs.push('Falta la fecha.');
    if (this.locked(d.date)) errs.push(`El periodo está cerrado hasta ${this.db.settings.lockDate}.`);
    if (!d.lines.length) errs.push('El documento no tiene conceptos.');
    d.lines.forEach((l, i) => { const a = this.account(l.account); if (!a || !a.active) errs.push(`Concepto ${i + 1}: falta una cuenta contable válida.`); });
    if (!(d.total > 0)) errs.push('El total debe ser mayor a cero.');
    if (d.uuid) {
      const dup = this.db.docs.find(x => x.id !== d.id && x.uuid === d.uuid && x.state !== 'cancelled');
      if (dup) errs.push(`El UUID ya está registrado en ${dup.number || 'otro borrador'}.`);
    }
    return errs;
  }

  postDoc(id, user) {
    const d = this.doc(id);
    if (!d) throw httpErr(404, 'No se encontró el documento.');
    if (d.state !== 'draft') throw httpErr(400, 'El documento ya está publicado.');
    const errs = this.validateDoc(d);
    if (errs.length) throw httpErr(400, errs.join(' '));
    d.state = 'posted'; d.postedAt = new Date().toISOString(); d.postedBy = user;
    if (!d.number) d.number = this.nextNumber(TYPES[d.type].prefix, d.date);
    // remember the expense account per supplier when every line uses the same one
    const p = this.partner(d.partnerId);
    const accs = [...new Set(d.lines.map(l => l.account))];
    if (p && accs.length === 1 && TYPES[d.type].side === 'ap' && !p.account) p.account = accs[0];
    this.log(user, 'publicó', 'documento', d.id, d.number);
    return d;
  }

  draftDoc(id, user) {
    const d = this.doc(id);
    if (!d) throw httpErr(404, 'No se encontró el documento.');
    if (d.state !== 'posted') throw httpErr(400, 'Solo un documento publicado puede regresar a borrador.');
    if (this.locked(d.date)) throw httpErr(400, `El periodo está cerrado hasta ${this.db.settings.lockDate}.`);
    if (this.paidOn(d).length) throw httpErr(400, 'Tiene pagos aplicados. Cancela o modifica esos pagos primero.');
    d.state = 'draft'; this.log(user, 'regresó a borrador', 'documento', d.id, d.number);
    return d;
  }
  cancelDoc(id, user) {
    const d = this.doc(id);
    if (!d) throw httpErr(404, 'No se encontró el documento.');
    if (this.locked(d.date)) throw httpErr(400, `El periodo está cerrado hasta ${this.db.settings.lockDate}.`);
    if (this.paidOn(d).length) throw httpErr(400, 'Tiene pagos aplicados. Cancela o modifica esos pagos primero.');
    d.state = 'cancelled'; this.log(user, 'canceló', 'documento', d.id, d.number || 'borrador');
    return d;
  }
  /* Erase: unlike cancel, the invoice leaves the books entirely (lines, files, UUID) and only a ghost stays in the
     list, crossed out, saying who erased it and when. The UUID is released so the same CFDI can be imported again. */
  eraseDoc(id, user) {
    const d = this.doc(id);
    if (!d) throw httpErr(404, 'No se encontró el documento.');
    if (d.state === 'erased') throw httpErr(400, 'Este documento ya fue eliminado.');
    if (d.number && this.locked(d.date)) throw httpErr(400, `El periodo está cerrado hasta ${this.db.settings.lockDate}.`);
    if (this.paidOn(d).length) throw httpErr(400, 'Tiene pagos o notas de crédito aplicados. Cancela o elimina esos primero.');
    for (const f of d.files || []) { try { fs.unlinkSync(path.join(this.filesDir, f.stored)); } catch (e) {} }
    d.erased = { by: user, at: new Date().toISOString(), from: d.state, uuid: d.uuid || '' };
    d.state = 'erased';
    delete d.uuid; d.files = []; d.lines = []; d.warnings = []; delete d.portal;
    this.log(user, 'eliminó', 'documento', d.id, d.number || `${d.serie || ''}${d.folio || ''}` || 'borrador');
    return d;
  }
  deleteDraft(id, user) {
    const d = this.doc(id);
    if (!d) throw httpErr(404, 'No se encontró el documento.');
    if (d.state !== 'draft' || d.number) throw httpErr(400, 'Solo se pueden eliminar borradores que nunca se publicaron. Cancela el documento en su lugar.');
    this.db.docs = this.db.docs.filter(x => x.id !== id);
    for (const f of d.files || []) { try { fs.unlinkSync(path.join(this.filesDir, f.stored)); } catch (e) {} }
    this.log(user, 'eliminó', 'documento', d.id, `${d.serie}${d.folio}` || 'borrador');
  }

  paidOn(d) {
    const out = [];
    for (const p of this.db.payments) if (p.state === 'posted') for (const a of p.allocations) if (a.docId === d.id) out.push({ payment: p, amount: a.amount });
    for (const r of this.db.docs) if (r.state === 'posted' && r.appliesTo === d.id && TYPES[r.type].sign < 0) out.push({ refund: r, amount: r.totalMxn });
    return out;
  }
  residual(d) {
    if (d.state !== 'posted') return 0;
    if (TYPES[d.type].sign < 0) {
      if (d.appliesTo) { const inv = this.doc(d.appliesTo); if (inv && inv.state === 'posted') return 0; }
      const used = this.db.payments.filter(p => p.state === 'posted').reduce((a, p) => a + p.allocations.filter(x => x.docId === d.id).reduce((s, x) => s + x.amount, 0), 0);
      return r2(d.totalMxn - used);
    }
    return r2(d.totalMxn - this.paidOn(d).reduce((a, x) => a + x.amount, 0));
  }
  payState(d) {
    if (d.state !== 'posted') return '';
    const res = this.residual(d);
    if (res <= 0.009) return 'pagado';
    if (res < d.totalMxn - 0.009) return 'parcial';
    return d.due && d.due < today() ? 'vencido' : 'pendiente';
  }

  /* ---------- payments ---------- */
  createPayment(data, user) {
    const dir = data.dir === 'in' ? 'in' : 'out';
    const p = this.partner(data.partnerId);
    if (!p) throw httpErr(400, 'Falta el contacto.');
    const bank = this.bank(data.bankId);
    if (!bank) throw httpErr(400, 'Elige la cuenta de banco o caja.');
    if (!isDate(data.date)) throw httpErr(400, 'Falta la fecha del pago.');
    if (this.locked(data.date)) throw httpErr(400, `El periodo está cerrado hasta ${this.db.settings.lockDate}.`);
    const amount = r2(data.amount);
    if (!(amount > 0)) throw httpErr(400, 'El monto debe ser mayor a cero.');
    const allocations = (data.allocations || []).filter(a => Number(a.amount) > 0).map(a => ({ docId: a.docId, amount: r2(a.amount) }));
    let sum = 0;
    for (const a of allocations) {
      const d = this.doc(a.docId);
      if (!d || d.partnerId !== p.id) throw httpErr(400, 'Un documento aplicado no pertenece a este contacto.');
      if (d.state !== 'posted') throw httpErr(400, `El documento ${d.number || ''} no está publicado.`);
      if (TYPES[d.type].side !== (dir === 'out' ? 'ap' : 'ar') || TYPES[d.type].sign < 0) throw httpErr(400, 'Solo se pueden aplicar facturas del tipo correcto.');
      if (a.amount > this.residual(d) + 0.01) throw httpErr(400, `El monto aplicado a ${d.number} supera su saldo (${this.residual(d).toFixed(2)}).`);
      sum += a.amount;
    }
    if (sum > amount + 0.01) throw httpErr(400, 'La suma aplicada es mayor que el monto del pago.');
    if (data.uuid && this.db.payments.find(x => x.uuid === data.uuid && x.state !== 'cancelled')) throw httpErr(400, 'Ese complemento de pago ya está registrado.');
    const pay = {
      id: uid(), number: this.nextNumber(dir === 'out' ? 'PAGO' : 'COBRO', data.date), dir, partnerId: p.id, date: data.date, bankId: bank.id, amount,
      method: data.method || '', ref: data.ref || '', uuid: data.uuid || null, notes: data.notes || '', allocations, state: 'posted', createdBy: user, createdAt: new Date().toISOString(),
      files: data.files || [],
    };
    this.db.payments.push(pay);
    this.log(user, 'registró', 'pago', pay.id, `${pay.number} ${amount.toFixed(2)}`);
    return pay;
  }
  cancelPayment(id, user) {
    const p = this.payment(id);
    if (!p) throw httpErr(404, 'No se encontró el pago.');
    if (this.locked(p.date)) throw httpErr(400, `El periodo está cerrado hasta ${this.db.settings.lockDate}.`);
    p.state = 'cancelled'; this.log(user, 'canceló', 'pago', p.id, p.number);
    return p;
  }

  /* ---------- manual journal entries ---------- */
  saveEntry(data, user) {
    let e = data.id ? this.entry(data.id) : null;
    if (e && e.state !== 'draft') throw httpErr(400, 'Solo se pueden editar pólizas en borrador.');
    const lines = (data.lines || []).map(l => ({ account: l.account, partnerId: l.partnerId || null, label: l.label || '', debit: r2(l.debit || 0), credit: r2(l.credit || 0) })).filter(l => l.account && (l.debit || l.credit));
    const fields = { date: data.date || today(), ref: data.ref || '', lines };
    if (e) Object.assign(e, fields);
    else { e = { id: uid(), number: null, state: 'draft', createdBy: user, createdAt: new Date().toISOString(), ...fields }; this.db.entries.push(e); }
    this.log(user, 'guardó', 'póliza', e.id, e.ref);
    return e;
  }
  postEntry(id, user) {
    const e = this.entry(id);
    if (!e) throw httpErr(404, 'No se encontró la póliza.');
    if (e.state !== 'draft') throw httpErr(400, 'La póliza ya está publicada.');
    if (this.locked(e.date)) throw httpErr(400, `El periodo está cerrado hasta ${this.db.settings.lockDate}.`);
    if (e.lines.length < 2) throw httpErr(400, 'La póliza necesita al menos dos movimientos.');
    for (const l of e.lines) if (!this.account(l.account)) throw httpErr(400, `La cuenta ${l.account} no existe.`);
    const dr = r2(e.lines.reduce((a, l) => a + l.debit, 0)), cr = r2(e.lines.reduce((a, l) => a + l.credit, 0));
    if (Math.abs(dr - cr) > 0.009) throw httpErr(400, `La póliza no cuadra: cargos ${dr.toFixed(2)} vs abonos ${cr.toFixed(2)}.`);
    e.state = 'posted'; e.number = e.number || this.nextNumber('ASI', e.date);
    this.log(user, 'publicó', 'póliza', e.id, e.number);
    return e;
  }
  cancelEntry(id, user) {
    const e = this.entry(id);
    if (!e) throw httpErr(404, 'No se encontró la póliza.');
    if (this.locked(e.date)) throw httpErr(400, `El periodo está cerrado hasta ${this.db.settings.lockDate}.`);
    e.state = 'cancelled'; this.log(user, 'canceló', 'póliza', e.id, e.number || 'borrador');
    return e;
  }

  /* ---------- journal derivation ---------- */
  docTaxSplit(d) {
    // Amounts in MXN: per-line net (by account), IVA, IEPS, retained IVA and ISR
    const rate = d.rate || 1, A = this.A;
    const byAccount = {}; let iva = 0, ieps = 0, retIva = 0, retIsr = 0;
    for (const l of d.lines) {
      let net = (l.amount - (l.discount || 0));
      for (const t of l.taxes || []) {
        if (t.kind === 'traslado' && t.tax === 'IVA') iva += t.amount;
        else if (t.kind === 'traslado' && t.tax === 'IEPS') { if (TYPES[d.type].side === 'ap' && !this.db.settings.iepsCreditable) net += t.amount; else ieps += t.amount; }
        else if (t.kind === 'retencion' && t.tax === 'IVA') retIva += t.amount;
        else if (t.kind === 'retencion' && t.tax === 'ISR') retIsr += t.amount;
      }
      const acc = l.account || (TYPES[d.type].side === 'ap' ? A.expense : A.sales);
      byAccount[acc] = (byAccount[acc] || 0) + net;
    }
    const out = { byAccount: {}, iva: r2(iva * rate), ieps: r2(ieps * rate), retIva: r2(retIva * rate), retIsr: r2(retIsr * rate) };
    for (const [k, v] of Object.entries(byAccount)) out.byAccount[k] = r2(v * rate);
    // keep the partner side exactly equal to the document total (absorb cent-level rounding in the largest line)
    const parts = Object.values(out.byAccount).reduce((a, v) => a + v, 0) + out.iva + out.ieps - out.retIva - out.retIsr;
    const diff = r2((d.totalMxn || 0) - parts);
    if (diff && Math.abs(diff) <= 1) {
      const big = Object.keys(out.byAccount).sort((a, b) => Math.abs(out.byAccount[b]) - Math.abs(out.byAccount[a]))[0];
      if (big) out.byAccount[big] = r2(out.byAccount[big] + diff);
    }
    return out;
  }

  docJournal(d) {
    const A = this.A, T = TYPES[d.type], s = this.docTaxSplit(d), src = { kind: 'doc', id: d.id, number: d.number, type: d.type };
    const L = [];
    const add = (account, debit, credit, label) => { if (r2(debit) || r2(credit)) L.push({ date: d.date, account, debit: r2(debit), credit: r2(credit), partnerId: d.partnerId, label, src }); };
    // "normal" orientation for an invoice; refunds flip debit/credit
    const flip = T.sign < 0;
    const dr = (acc, amt, lbl) => flip ? add(acc, 0, amt, lbl) : add(acc, amt, 0, lbl);
    const cr = (acc, amt, lbl) => flip ? add(acc, amt, 0, lbl) : add(acc, 0, amt, lbl);
    if (T.side === 'ap') {
      for (const [acc, amt] of Object.entries(s.byAccount)) dr(acc, amt, 'Compra');
      dr(A.ivaPending, s.iva, 'IVA pendiente de pago');
      dr(A.iepsPending, s.ieps, 'IEPS pendiente de pago');
      cr(A.retIvaPending, s.retIva, 'IVA retenido');
      cr(A.retIsr, s.retIsr, 'ISR retenido');
      const other = L.reduce((a, l) => a + (flip ? l.credit - l.debit : l.debit - l.credit), 0);
      cr(A.payable, other, 'Proveedor');
    } else {
      for (const [acc, amt] of Object.entries(s.byAccount)) cr(flip && acc === A.sales ? A.salesReturns : acc, amt, 'Venta');
      cr(A.ivaUncollected, s.iva, 'IVA trasladado no cobrado');
      cr(A.iepsUncollected, s.ieps, 'IEPS trasladado no cobrado');
      dr(A.clientRetIva, s.retIva, 'IVA retenido por el cliente');
      dr(A.clientRetIsr, s.retIsr, 'ISR retenido por el cliente');
      const other = L.reduce((a, l) => a + (flip ? l.debit - l.credit : l.credit - l.debit), 0);
      dr(A.receivable, other, 'Cliente');
    }
    return L;
  }

  paymentJournal(p) {
    const A = this.A, bank = this.bank(p.bankId), src = { kind: 'payment', id: p.id, number: p.number };
    const L = [];
    const add = (account, debit, credit, label) => { if (r2(debit) || r2(credit)) L.push({ date: p.date, account, debit: r2(debit), credit: r2(credit), partnerId: p.partnerId, label, src }); };
    const alloc = r2(p.allocations.reduce((a, x) => a + x.amount, 0)), extra = r2(p.amount - alloc);
    if (p.dir === 'out') {
      add(A.payable, alloc, 0, 'Pago a proveedor');
      add(A.advSupplier, extra, 0, 'Anticipo a proveedor');
      add(bank.account, 0, p.amount, bank.name);
    } else {
      add(bank.account, p.amount, 0, bank.name);
      add(A.receivable, 0, alloc, 'Cobro a cliente');
      add(A.advCustomer, 0, extra, 'Anticipo de cliente');
    }
    // cash-basis taxes: move the proportional IVA/IEPS/retentions from "pending" to "paid/collected"
    for (const a of p.allocations) {
      const d = this.doc(a.docId);
      if (!d || !d.totalMxn) continue;
      const k = a.amount / d.totalMxn, s = this.docTaxSplit(d);
      if (p.dir === 'out') {
        add(A.ivaPaid, s.iva * k, 0, `IVA pagado ${d.number}`); add(A.ivaPending, 0, s.iva * k, `IVA pagado ${d.number}`);
        add(A.iepsPaid, s.ieps * k, 0, `IEPS pagado ${d.number}`); add(A.iepsPending, 0, s.ieps * k, `IEPS pagado ${d.number}`);
        add(A.retIvaPending, s.retIva * k, 0, `IVA retenido efectivamente pagado ${d.number}`); add(A.retIvaPaid, 0, s.retIva * k, `IVA retenido efectivamente pagado ${d.number}`);
      } else {
        add(A.ivaUncollected, s.iva * k, 0, `IVA cobrado ${d.number}`); add(A.ivaCollected, 0, s.iva * k, `IVA cobrado ${d.number}`);
        add(A.iepsUncollected, s.ieps * k, 0, `IEPS cobrado ${d.number}`); add(A.iepsCollected, 0, s.ieps * k, `IEPS cobrado ${d.number}`);
      }
    }
    // tidy rounding so every payment balances to the cent
    const diff = r2(L.reduce((a, l) => a + l.debit - l.credit, 0));
    if (diff) { const t = L.find(l => /IVA|IEPS/.test(l.label)); if (t) { if (t.debit) t.debit = r2(t.debit - diff); else t.credit = r2(t.credit + diff); } }
    return L;
  }

  entryJournal(e) {
    const src = { kind: 'entry', id: e.id, number: e.number };
    return e.lines.map(l => ({ date: e.date, account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId, label: l.label || e.ref, src }));
  }

  journal(from, to) {
    const inRange = d => (!from || d >= from) && (!to || d <= to);
    const L = [];
    for (const d of this.db.docs) if (d.state === 'posted' && inRange(d.date)) L.push(...this.docJournal(d));
    for (const p of this.db.payments) if (p.state === 'posted' && inRange(p.date)) L.push(...this.paymentJournal(p));
    for (const e of this.db.entries) if (e.state === 'posted' && inRange(e.date)) L.push(...this.entryJournal(e));
    return L.sort((a, b) => a.date.localeCompare(b.date));
  }
  journalFor(kind, rec) { return kind === 'doc' ? this.docJournal(rec) : kind === 'payment' ? this.paymentJournal(rec) : this.entryJournal(rec); }

  /* ---------- reports ---------- */
  balances(from, to) {
    const m = {};
    for (const l of this.journal(from, to)) { const x = m[l.account] || (m[l.account] = { debit: 0, credit: 0 }); x.debit += l.debit; x.credit += l.credit; }
    for (const k in m) { m[k].debit = r2(m[k].debit); m[k].credit = r2(m[k].credit); }
    return m;
  }

  trialBalance(from, to) {
    const before = from ? this.balances(null, addDays(from, -1)) : {};
    const per = this.balances(from, to);
    const rows = [];
    for (const a of this.db.accounts) {
      const b = before[a.code] || { debit: 0, credit: 0 }, p = per[a.code] || { debit: 0, credit: 0 };
      const open = r2(b.debit - b.credit), close = r2(open + p.debit - p.credit);
      if (!open && !p.debit && !p.credit) continue;
      rows.push({ code: a.code, name: a.name, type: a.type, open, debit: p.debit, credit: p.credit, close });
    }
    const tot = rows.reduce((t, r) => ({ open: r2(t.open + r.open), debit: r2(t.debit + r.debit), credit: r2(t.credit + r.credit), close: r2(t.close + r.close) }), { open: 0, debit: 0, credit: 0, close: 0 });
    return { from, to, rows, totals: tot };
  }

  ledger(code, from, to) {
    const a = this.account(code);
    if (!a) throw httpErr(404, 'La cuenta no existe.');
    const open = from ? (() => { const b = this.balances(null, addDays(from, -1))[code]; return b ? r2(b.debit - b.credit) : 0; })() : 0;
    let run = open;
    const rows = this.journal(from, to).filter(l => l.account === code).map(l => {
      run = r2(run + l.debit - l.credit);
      const p = l.partnerId && this.partner(l.partnerId);
      return { date: l.date, number: l.src.number, kind: l.src.kind, id: l.src.id, partner: p ? p.name : '', label: l.label, debit: l.debit, credit: l.credit, balance: run };
    });
    return { account: a, from, to, open, rows, close: run };
  }

  pnl(from, to) {
    const per = this.balances(from, to);
    const sec = (types, sign) => this.db.accounts.filter(a => types.has(a.type)).map(a => {
      const b = per[a.code]; if (!b) return null;
      const v = r2(sign * (b.debit - b.credit)); return v ? { code: a.code, name: a.name, type: a.type, amount: v } : null;
    }).filter(Boolean);
    const income = sec(INCOME, -1), cost = sec(new Set(['EC']), 1), expense = sec(new Set(['EX', 'ED']), 1);
    const sum = a => r2(a.reduce((s, x) => s + x.amount, 0));
    const ti = sum(income), tc = sum(cost), te = sum(expense);
    return { from, to, income, cost, expense, totals: { income: ti, cost: tc, gross: r2(ti - tc), expense: te, net: r2(ti - tc - te) } };
  }

  balanceSheet(at) {
    const per = this.balances(null, at);
    const sec = (types, sign) => this.db.accounts.filter(a => types.has(a.type)).map(a => {
      const b = per[a.code]; if (!b) return null;
      const v = r2(sign * (b.debit - b.credit)); return v ? { code: a.code, name: a.name, type: a.type, amount: v } : null;
    }).filter(Boolean);
    const assets = sec(ASSET, 1), liabilities = sec(LIAB, -1), equity = sec(EQUITY, -1);
    // earnings not yet closed to equity
    let earnings = 0;
    for (const a of this.db.accounts) if (INCOME.has(a.type) || EXPENSE.has(a.type)) { const b = per[a.code]; if (b) earnings += b.credit - b.debit; }
    earnings = r2(earnings);
    if (earnings) equity.push({ code: '—', name: 'Resultado del ejercicio (no cerrado)', type: 'EU', amount: earnings });
    const sum = a => r2(a.reduce((s, x) => s + x.amount, 0));
    const ta = sum(assets), tl = sum(liabilities), te = sum(equity);
    return { at, assets, liabilities, equity, totals: { assets: ta, liabilities: tl, equity: te, liabEquity: r2(tl + te), diff: r2(ta - tl - te) } };
  }

  aging(side, at) {
    at = at || today();
    const rows = [];
    for (const d of this.db.docs) {
      if (d.state !== 'posted' || TYPES[d.type].side !== side || d.date > at) continue;
      const res = this.residual(d) * (TYPES[d.type].sign < 0 ? -1 : 1);
      if (Math.abs(res) < 0.01) continue;
      const days = Math.floor((Date.parse(at) - Date.parse(d.due || d.date)) / 864e5);
      const bucket = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'older';
      const p = this.partner(d.partnerId);
      rows.push({ id: d.id, number: d.number, partnerId: d.partnerId, partner: p ? p.name : '', date: d.date, due: d.due, days: Math.max(0, days), bucket, amount: r2(res) });
    }
    const byPartner = {};
    for (const r of rows) {
      const x = byPartner[r.partnerId] || (byPartner[r.partnerId] = { partnerId: r.partnerId, partner: r.partner, current: 0, d30: 0, d60: 0, d90: 0, older: 0, total: 0 });
      x[r.bucket] = r2(x[r.bucket] + r.amount); x.total = r2(x.total + r.amount);
    }
    const partners = Object.values(byPartner).sort((a, b) => b.total - a.total);
    const totals = partners.reduce((t, p) => { for (const k of ['current', 'd30', 'd60', 'd90', 'older', 'total']) t[k] = r2(t[k] + p[k]); return t; }, { current: 0, d30: 0, d60: 0, d90: 0, older: 0, total: 0 });
    return { side, at, partners, rows: rows.sort((a, b) => a.due.localeCompare(b.due)), totals };
  }

  statement(partnerId, from, to) {
    const p = this.partner(partnerId);
    if (!p) throw httpErr(404, 'No se encontró el contacto.');
    const items = [];
    for (const d of this.db.docs) if (d.partnerId === p.id && d.state === 'posted') {
      const T = TYPES[d.type];
      // positive = they owe us (AR) or we owe them (AP)
      items.push({ date: d.date, number: d.number, kind: 'doc', id: d.id, label: T.label + (d.serie || d.folio ? ` ${d.serie}${d.folio}` : ''), charge: T.sign > 0 ? d.totalMxn : 0, credit: T.sign < 0 ? d.totalMxn : 0, side: T.side });
    }
    for (const pay of this.db.payments) if (pay.partnerId === p.id && pay.state === 'posted') {
      items.push({ date: pay.date, number: pay.number, kind: 'payment', id: pay.id, label: pay.dir === 'out' ? 'Pago' : 'Cobro', charge: 0, credit: pay.amount, side: pay.dir === 'out' ? 'ap' : 'ar' });
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || String(a.number).localeCompare(String(b.number)));
    let open = 0, run = 0; const rows = [];
    for (const it of items) {
      const delta = r2(it.charge - it.credit);
      if (from && it.date < from) { open = r2(open + delta); continue; }
      if (to && it.date > to) continue;
      rows.push(it);
    }
    run = open; rows.forEach(r => { run = r2(run + r.charge - r.credit); r.balance = run; });
    return { partner: p, from, to, open, rows, close: run };
  }

  taxReport(month) { // month: YYYY-MM, cash basis
    const from = month + '-01', to = addDays(addDays(from, 32).slice(0, 8) + '01', -1);
    const per = this.balances(from, to), A = this.A;
    const g = (acc, side) => { const b = per[acc]; return b ? r2(side === 'd' ? b.debit - b.credit : b.credit - b.debit) : 0; };
    const ivaCollected = g(A.ivaCollected, 'c'), ivaPaid = g(A.ivaPaid, 'd'), retIvaPaid = g(A.retIvaPaid, 'c');
    // IVA withheld by our clients counts in the month we collect (cash basis), like the IVA itself
    let ivaRetByClients = 0;
    for (const p of this.db.payments) {
      if (p.state !== 'posted' || p.dir !== 'in' || p.date < from || p.date > to) continue;
      for (const a of p.allocations) { const d = this.doc(a.docId); if (d && d.totalMxn) ivaRetByClients += this.docTaxSplit(d).retIva * a.amount / d.totalMxn; }
    }
    ivaRetByClients = r2(ivaRetByClients);
    const payable = r2(ivaCollected - ivaPaid - ivaRetByClients);
    // DIOT-style detail per supplier, from payments made this month
    const diot = {};
    for (const p of this.db.payments) {
      if (p.state !== 'posted' || p.dir !== 'out' || p.date < from || p.date > to) continue;
      for (const a of p.allocations) {
        const d = this.doc(a.docId); if (!d) continue;
        const k = a.amount / d.totalMxn, s = this.docTaxSplit(d);
        let b16 = 0, b8 = 0, b0 = 0, bex = 0;
        for (const l of d.lines) for (const t of l.taxes || []) if (t.kind === 'traslado' && t.tax === 'IVA') {
          if (t.factor === 'Exento') bex += t.base; else if (t.rate >= 0.15) b16 += t.base; else if (t.rate > 0) b8 += t.base; else b0 += t.base;
        }
        const part = this.partner(d.partnerId);
        const x = diot[d.partnerId] || (diot[d.partnerId] = { partner: part ? part.name : '', rfc: part ? part.rfc : '', base16: 0, base8: 0, base0: 0, exento: 0, iva: 0, ivaRet: 0, paid: 0 });
        const rate = d.rate || 1;
        x.base16 = r2(x.base16 + b16 * rate * k); x.base8 = r2(x.base8 + b8 * rate * k); x.base0 = r2(x.base0 + b0 * rate * k); x.exento = r2(x.exento + bex * rate * k);
        x.iva = r2(x.iva + s.iva * k); x.ivaRet = r2(x.ivaRet + s.retIva * k); x.paid = r2(x.paid + a.amount);
      }
    }
    return { month, from, to, ivaCollected, ivaPaid, ivaRetByClients, payable, retIvaPaid, retIsr: g(A.retIsr, 'c'), diot: Object.values(diot).sort((a, b) => b.paid - a.paid) };
  }

  analysis(from, to, side, by) {
    const rows = {};
    for (const d of this.db.docs) {
      if (d.state !== 'posted' || TYPES[d.type].side !== side || (from && d.date < from) || (to && d.date > to)) continue;
      const sign = TYPES[d.type].sign;
      const keys = by === 'month' ? [[d.date.slice(0, 7), d.date.slice(0, 7)]] : by === 'account' ? Object.entries(this.docTaxSplit(d).byAccount).map(([k]) => [k, k]) : [[d.partnerId, (this.partner(d.partnerId) || {}).name || '']];
      if (by === 'account') {
        for (const [acc, amt] of Object.entries(this.docTaxSplit(d).byAccount)) {
          const a = this.account(acc); const x = rows[acc] || (rows[acc] = { key: acc, label: `${acc} ${a ? a.name : ''}`, count: 0, subtotal: 0, total: 0 });
          x.count++; x.subtotal = r2(x.subtotal + sign * amt); x.total = r2(x.total + sign * amt);
        }
        continue;
      }
      for (const [k, label] of keys) {
        const x = rows[k] || (rows[k] = { key: k, label, count: 0, subtotal: 0, total: 0 });
        x.count++; x.subtotal = r2(x.subtotal + sign * r2((d.subtotal - d.discount) * d.rate)); x.total = r2(x.total + sign * d.totalMxn);
      }
    }
    const list = Object.values(rows).sort((a, b) => by === 'month' ? a.key.localeCompare(b.key) : b.total - a.total);
    return { from, to, side, by, rows: list, totals: { count: list.reduce((a, r) => a + r.count, 0), subtotal: r2(list.reduce((a, r) => a + r.subtotal, 0)), total: r2(list.reduce((a, r) => a + r.total, 0)) } };
  }

  cashFlow(from, to) {
    const rows = this.db.banks.map(b => {
      const L = this.ledger(b.account, from, to);
      const inflow = r2(L.rows.reduce((a, r) => a + r.debit, 0)), outflow = r2(L.rows.reduce((a, r) => a + r.credit, 0));
      return { bank: b.name, account: b.account, open: L.open, inflow, outflow, close: L.close };
    });
    return { from, to, rows, totals: rows.reduce((t, r) => ({ open: r2(t.open + r.open), inflow: r2(t.inflow + r.inflow), outflow: r2(t.outflow + r.outflow), close: r2(t.close + r.close) }), { open: 0, inflow: 0, outflow: 0, close: 0 }) };
  }

  dashboard() {
    const t = today(), month = t.slice(0, 7);
    const ap = this.aging('ap', t), ar = this.aging('ar', t);
    const overdue = rep => r2(rep.totals.d30 + rep.totals.d60 + rep.totals.d90 + rep.totals.older);
    const months = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(t + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
    const series = months.map(m => {
      let buy = 0, sell = 0;
      for (const d of this.db.docs) if (d.state === 'posted' && d.date.startsWith(m)) { const v = TYPES[d.type].sign * r2((d.subtotal - d.discount) * d.rate); if (TYPES[d.type].side === 'ap') buy += v; else sell += v; }
      return { month: m, purchases: r2(buy), sales: r2(sell) };
    });
    const banks = this.db.banks.map(b => { const L = this.ledger(b.account, null, t); return { id: b.id, name: b.name, balance: L.close }; });
    const top = this.analysis(month + '-01', t, 'ap', 'partner').rows.slice(0, 5);
    const drafts = this.db.docs.filter(d => d.state === 'draft').length;
    const pnl = this.pnl(month + '-01', t);
    const dueSoon = ap.rows.filter(r => r.days === 0 && r.due >= t && r.due <= addDays(t, 7)).slice(0, 8);
    return { today: t, month, payable: ap.totals.total, payableOverdue: overdue(ap), receivable: ar.totals.total, receivableOverdue: overdue(ar), banks, series, top, drafts, pnl: pnl.totals, dueSoon };
  }
}

function httpErr(status, message) { const e = new Error(message); e.status = status; e.expose = true; return e; }

module.exports = { Books, TYPES, ACC_TYPES, TAX_PRESETS, accountForClave, r2, today, addDays, httpErr, uid };

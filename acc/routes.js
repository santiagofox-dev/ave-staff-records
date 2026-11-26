'use strict';
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { Books, TYPES, ACC_TYPES, TAX_PRESETS, r2, today, httpErr } = require('./core');
const { importFiles } = require('./importer');

module.exports = function accRoutes(app, { DATA_DIR, users, ownerName, rfc, portal }) {
  const books = new Books(path.join(DATA_DIR, 'acc'), { rfc });
  let pdf = null;
  try { const x = require('../extract'); pdf = { text: x.pdfText, layout: x.pdfLayoutText }; } catch (e) { pdf = null; }

  const who = req => (req.user && (req.user.name || req.user.username)) || 'admin';
  const canEdit = req => req.user && (req.user.role === 'admin' || req.user.role === 'contador');
  const isAdmin = req => req.user && req.user.role === 'admin';
  const W = fn => (req, res, next) => {
    if (!canEdit(req)) return res.status(403).json({ error: 'Tu usuario es de solo consulta.' });
    try { const out = fn(req, res); books.save(); if (out !== undefined) res.json(out); } catch (e) { next(e); }
  };
  const R = fn => (req, res, next) => { try { res.json(books.withCache(() => fn(req, res))); } catch (e) { next(e); } };
  const D = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);

  app.get('/contabilidad', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'contabilidad.html')));

  /* ---------- reference data ---------- */
  app.get('/api/acc/meta', R(req => ({
    user: { ...req.user, canEdit: canEdit(req), isAdmin: isAdmin(req) },
    company: books.db.company, settings: books.db.settings, banks: books.db.banks,
    accounts: books.db.accounts, accTypes: ACC_TYPES, taxPresets: TAX_PRESETS,
    types: Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v.label])),
    partners: books.db.partners.map(p => ({ id: p.id, name: p.name, rfc: p.rfc, supplier: p.supplier, customer: p.customer, account: p.account, terms: p.terms })),
    today: today(),
  })));
  app.get('/api/acc/dashboard', R(() => books.dashboard()));

  /* ---------- documents ---------- */
  const docRow = d => {
    const p = books.partner(d.partnerId);
    return { review: d.vendorReview ? d.vendorReview.status : '', reviewNote: d.vendorReview ? d.vendorReview.comment || '' : '', cash: d.cashSale ? d.cashSale.operation : '', plant: books.plantOf(d), plantSet: !!d.plant || !!d.noPlant, test: !!d.test, portal: !!d.portal, received: d.received || d.date, id: d.id, type: d.type, number: d.number, state: d.state, partnerId: d.partnerId, partner: p ? p.name : '', rfc: p ? p.rfc : '', date: d.date, due: d.due, currency: d.currency, total: d.total, totalMxn: d.totalMxn, residual: books.residual(d), pay: books.payState(d), erasedBy: d.erased ? d.erased.by : '', erasedAt: d.erased ? d.erased.at : '', uuid: d.uuid, serie: d.serie, folio: d.folio, source: d.source, warnings: (d.warnings || []).length, files: (d.files || []).length, bcat: d.budgetCat || (p && p.budgetCat) || '', bcatSet: !!d.budgetCat, fixes: d.fixes || 0, splits: d.splits && d.splits.length ? d.splits.map(x => ({ plant: x.plant, cat: x.cat, amount: x.amount })) : null, splitPartner: books.isSplitPartner(p) };
  };
  app.get('/api/acc/docs', R(req => {
    const { type, state, pay, q, partner } = req.query, from = D(req.query.from), to = D(req.query.to);
    const types = String(type || '').split(',').filter(t => TYPES[t]);
    const ql = String(q || '').toLowerCase().trim();
    const plantQ = req.query.plant || '';
    let rows = books.db.docs.filter(d => (req.query.origin !== 'portal' || d.portal) && (req.query.origin !== 'disputed' || (d.vendorReview && d.vendorReview.status === 'disputed')) && (!plantQ || (plantQ === '-' ? !books.plantOf(d) && !(d.splits && d.splits.length) : books.plantOf(d) === plantQ || (d.splits || []).some(x => x.plant === plantQ))) && (!types.length || types.includes(d.type)) && (!state || d.state === state) && (!from || d.date >= from) && (!to || d.date <= to) && (!partner || d.partnerId === partner)).map(docRow);
    if (pay) rows = rows.filter(r => pay === 'abierto' ? ['pendiente', 'vencido', 'parcial'].includes(r.pay) : r.pay === pay);
    if (ql) rows = rows.filter(r => [r.number, r.partner, r.rfc, r.uuid, r.serie + r.folio, String(r.total)].some(v => String(v || '').toLowerCase().includes(ql)));
    rows.sort((a, b) => b.date.localeCompare(a.date) || String(b.number || '').localeCompare(String(a.number || '')));
    const sum = rows.reduce((t, r) => ({ total: r2(t.total + (r.state === 'cancelled' || r.state === 'erased' ? 0 : r.totalMxn)), residual: r2(t.residual + r.residual) }), { total: 0, residual: 0 });
    return { rows: rows.slice(0, 2000), count: rows.length, sum };
  }));
  app.get('/api/acc/docs/:id', R(req => {
    const d = books.doc(req.params.id);
    if (!d) throw httpErr(404, 'No se encontró el documento.');
    const payments = books.paidOn(d).map(x => x.payment ? { kind: 'payment', id: x.payment.id, number: x.payment.number, date: x.payment.date, amount: x.amount } : { kind: 'doc', id: x.refund.id, number: x.refund.number, date: x.refund.date, amount: x.amount });
    const applies = d.appliesTo ? docRow(books.doc(d.appliesTo) || {}) : null;
    const journal = (d.state === 'draft' ? books.docJournal({ ...d, number: 'BORRADOR' }) : books.docJournal(d)).map(l => ({ account: l.account, name: (books.account(l.account) || {}).name || '', debit: l.debit, credit: l.credit, label: l.label }));
    return { doc: d, row: docRow(d), partner: books.partner(d.partnerId) || null, payments, applies, journal, errors: d.state === 'draft' ? books.validateDoc(d) : [], corrections: (books.db.corrections || []).filter(c => c.docId === d.id).slice().reverse() };
  }));
  app.post('/api/acc/docs', W(req => {
    const b = req.body || {};
    const d = books.newDoc(b.type, { partnerId: b.partnerId, date: b.date, due: b.due, currency: b.currency, rate: b.rate, ref: b.ref, notes: b.notes, serie: b.serie, folio: b.folio, appliesTo: b.appliesTo, source: 'manual' }, who(req));
    return books.updateDoc(d.id, { lines: b.lines || [] }, who(req));
  }));
  app.put('/api/acc/docs/:id', W(req => books.updateDoc(req.params.id, req.body || {}, who(req))));
  app.post('/api/acc/docs/:id/dates', W(req => books.setDates(req.params.id, req.body || {}, who(req))));
  app.post('/api/acc/docs/:id/post', W(req => books.postDoc(req.params.id, who(req))));
  app.post('/api/acc/docs/:id/draft', W(req => books.draftDoc(req.params.id, who(req))));
  app.post('/api/acc/docs/:id/cancel', W(req => books.cancelDoc(req.params.id, who(req))));
  // every deletion leaves a crossed-out ghost with who and when
  app.delete('/api/acc/docs/:id', W(req => { books.eraseDoc(req.params.id, who(req)); return { ok: true }; }));
  /* ---------- cash sales typed by hand ---------- */
  app.get('/api/acc/cash-sales', R(req => { const r = books.cashSales(req.query.from || '', req.query.to || '', req.query.operation || ''); return { ...r, rows: r.rows.map(d => ({ ...docRow(d), operation: d.cashSale.operation, by: d.cashSale.by, subtotal: d.subtotal, iva: d.traslados, concept: (d.lines[0] || {}).description || '' })) }; }));
  app.post('/api/acc/cash-sales', W(req => { const d = books.recordCashSale(req.body || {}, who(req)); return docRow(d); }));
  /* ---------- cash purchases typed by hand (optional ticket photo) ---------- */
  app.get('/api/acc/cash-purchases', R(req => { const r = books.cashPurchases(req.query.from || '', req.query.to || '', req.query.plant || ''); return { ...r, rows: r.rows.map(d => ({ ...docRow(d), by: d.cashSale.by, concept: (d.lines[0] || {}).description || '', catLabel: BUD.CAT_LABEL[d.budgetCat] || '' })) }; }));
  const ticketUp = multer({ storage: multer.memoryStorage(), limits: { files: 5, fileSize: 25 * 1024 * 1024 } }).array('files', 5);
  app.post('/api/acc/cash-purchases', (req, res, next) => {
    if (!canEdit(req)) return res.status(403).json({ error: 'Tu usuario es de solo consulta.' });
    ticketUp(req, res, err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Un archivo pasa de 25 MB.' : 'No se pudieron recibir los archivos.' });
      try {
        let data = {}; try { data = JSON.parse((req.body && req.body.data) || '{}'); } catch (e) { throw httpErr(400, 'Datos no válidos.'); }
        if (data.cat && !BUD.CAT_LABEL[data.cat]) throw httpErr(400, 'Concepto no válido.');
        const ok = /\.(pdf|jpe?g|png|webp|heic|heif|xml)$/i;
        const files = (req.files || []).map(f => ({ name: Buffer.from(f.originalname, 'latin1').toString('utf8'), buf: f.buffer }));
        const bad = files.find(f => !ok.test(f.name)); if (bad) throw httpErr(400, `"${bad.name}" no es PDF ni imagen.`);
        const d = books.recordCashPurchase(data, who(req), k => BUD.CAT_LABEL[k] || k);
        d.files = d.files || [];
        for (const f of files) {
          const ext = path.extname(f.name).toLowerCase(), stored = require('crypto').randomBytes(10).toString('hex') + ext;
          fs.writeFileSync(path.join(books.filesDir, stored), f.buf);
          d.files.push({ name: f.name, stored, kind: ext === '.pdf' ? 'pdf' : ext === '.xml' ? 'xml' : 'imagen', size: f.buf.length, by: who(req), at: new Date().toISOString() });
        }
        books.save();
        res.json(docRow(d));
      } catch (e) { next(e); }
    });
  });
  app.post('/api/acc/docs/:id/splits', W(req => { const b = req.body || {}; const d = books.undoable(dd => `Reparto de ${dd.serie || ''}${dd.folio || dd.number || ''}`, who(req), () => books.setSplits(req.params.id, b.splits || [], who(req), String(b.reason || '').slice(0, 200), k => BUD.CAT_LABEL[k] || k)); return docRow(d); }));
  /* ---------- plants ---------- */
  app.post('/api/acc/docs/plant', W(req => { const b = req.body || {}; return books.undoable(r => `${r.updated === 1 ? '1 factura' : r.updated + ' facturas'} → ${b.plant === '@' ? 'planta del proveedor' : b.plant || 'sin planta'}`, who(req), () => books.setPlant(b.ids, b.plant, who(req), String(b.reason || '').slice(0, 200))); }));
  /* Move facturas in one step: plant and/or concept (for this factura, or for the whole supplier). One undo for all of it. */
  app.post('/api/acc/docs/reassign', W(req => {
    const b = req.body || {}, user = who(req), reason = String(b.reason || '').slice(0, 200), lab = k => BUD.CAT_LABEL[k] || k;
    if (b.cat && !BUD.CAT_LABEL[b.cat]) throw httpErr(400, 'Concepto no válido.');
    const ids = (b.ids || []).filter(id => books.doc(id));
    const parts = [];
    return books.undoable(() => parts.join(' · '), user, () => {
      const out = {};
      if (b.plant !== undefined && ids.length) { Object.assign(out, books.setPlant(ids, b.plant, user, reason)); parts.push(`${ids.length === 1 ? '1 factura' : ids.length + ' facturas'} → ${b.plant || 'sin planta'}`); }
      if (b.cat !== undefined) {
        if (b.scope === 'partner') {
          const pids = [...new Set([...(b.partnerIds || []), ...ids.map(id => books.doc(id).partnerId)])].filter(Boolean);
          for (const pid of pids) { const p = books.setPartnerBudgetCat(pid, b.cat || null, user, reason, lab); parts.push(`${p.name} → ${b.cat ? lab(b.cat) : 'sin concepto'}`); }
          // its facturas follow the supplier again
          const own = ids.filter(id => books.doc(id).budgetCat); if (own.length) books.setDocBudgetCat(own, null, user, reason, lab);
        } else if (ids.length) { books.setDocBudgetCat(ids, b.cat || null, user, reason, lab); parts.push(`${ids.length === 1 ? '1 factura' : ids.length + ' facturas'} → ${b.cat ? lab(b.cat) : 'concepto del proveedor'}`); }
      }
      return out;
    });
  }));
  app.get('/api/acc/undo', R(req => { const u = books.nextUndo(who(req)); return { label: u ? u.label : '', at: u ? u.at : null }; }));
  app.post('/api/acc/undo', W(req => books.undo(who(req))));
  app.post('/api/acc/docs/unpay', W(req => books.undoable(r => `Quitar ${r.cancelled === 1 ? '1 pago' : r.cancelled + ' pagos'}`, who(req), () => books.unpayDocs((req.body || {}).ids, who(req), String((req.body || {}).reason || '').slice(0, 200)))));
  app.get('/api/acc/corrections', R(req => (books.db.corrections || []).filter(c => !req.query.doc || c.docId === req.query.doc).slice(-Math.min(3000, parseInt(req.query.limit, 10) || 1000)).reverse()));
  /* Weekly budget per site (presupuesto por sucursal) */
  const BUD = require('./budget');
  app.get('/api/acc/budget', R(req => BUD.report(books, /^\d{4}-\d{2}-\d{2}$/.test(req.query.week || '') ? req.query.week : new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10))));
  app.put('/api/acc/budget', W(req => { const b = req.body || {}; if (!/^\d{4}-\d{2}-\d{2}$/.test(b.week || '')) throw httpErr(400, 'Falta la semana.'); books.undoable(`Presupuesto de la semana del ${BUD.mondayOf(b.week)}`, who(req), () => BUD.setBudget(books, BUD.mondayOf(b.week), b.amounts, who(req))); return BUD.report(books, b.week); }));
  app.post('/api/acc/budget/spend', W(req => { const e = books.undoable(e => `Gasto a mano ${BUD.CAT_LABEL[e.cat]} ${e.amount.toFixed(2)}`, who(req), () => BUD.addSpend(books, req.body || {}, who(req))); return BUD.report(books, e.date); }));
  app.delete('/api/acc/budget/spend/:id', W(req => { books.undoable('Borrar gasto a mano', who(req), () => BUD.removeSpend(books, req.params.id, who(req))); return { ok: true }; }));
  app.put('/api/acc/partners/:id/budget-cat', W(req => {
    const cat = (req.body || {}).cat || null;
    if (cat && !BUD.CAT_LABEL[cat]) throw httpErr(400, 'Concepto no válido.');
    books.undoable(p => `${p.name} → ${cat ? BUD.CAT_LABEL[cat] : 'sin concepto'}`, who(req), () => books.setPartnerBudgetCat(req.params.id, cat, who(req), String((req.body || {}).reason || '').slice(0, 200), k => BUD.CAT_LABEL[k] || k));
    return { ok: true, cat };
  }));
  app.post('/api/acc/docs/budget-cat', W(req => { const b = req.body || {}; if (b.cat && !BUD.CAT_LABEL[b.cat]) throw httpErr(400, 'Concepto no válido.'); return { updated: books.undoable(n => `${n === 1 ? '1 factura' : n + ' facturas'} → ${b.cat ? BUD.CAT_LABEL[b.cat] : 'concepto del proveedor'}`, who(req), () => books.setDocBudgetCat(b.ids, b.cat || null, who(req), String(b.reason || '').slice(0, 200), k => BUD.CAT_LABEL[k] || k)) }; }));
  app.get('/api/acc/budget/available', R(req => BUD.availableFor(books, req.query.partner, req.query.date)));
  app.get('/api/acc/plant-spend', R(req => books.plantSpend(req.query.from || '', req.query.to || '')));
  app.post('/api/acc/docs/:id/erase', W(req => books.eraseDoc(req.params.id, who(req))));
  app.post('/api/acc/docs/erase', W(req => books.eraseDocs((req.body || {}).ids, who(req), String((req.body || {}).reason || '').slice(0, 200))));
  app.post('/api/acc/docs/bulk-post', W(req => {
    const ok = [], failed = [];
    const ids = (req.body.ids || []).slice(0, 2000).map(id => books.doc(id)).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || String(a.folio).localeCompare(String(b.folio), 'es', { numeric: true })).map(d => d.id);
    for (const id of ids) {
      try { const d = books.postDoc(id, who(req)); ok.push(d.number); } catch (e) { const d = books.doc(id); failed.push({ id, label: d ? `${(books.partner(d.partnerId) || {}).name || 'sin proveedor'} ${d.serie}${d.folio}` : id, error: e.message }); }
    }
    return { ok, failed };
  }));
  app.post('/api/acc/docs/pay-pue', W(req => books.payPue((req.body || {}).ids || [], who(req))));
  app.post('/api/acc/docs/bulk-account', W(req => {
    const { ids, account } = req.body || {};
    if (!books.account(account)) throw httpErr(400, 'La cuenta no existe.');
    let n = 0;
    for (const id of ids || []) { const d = books.doc(id); if (d && d.state === 'draft') { d.lines.forEach(l => { l.account = account; }); n++; } }
    books.log(who(req), 'cambió cuenta', 'documentos', '', `${n} borradores → ${account}`);
    return { updated: n };
  }));

  /* ---------- import ---------- */
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 80, fileSize: 60 * 1024 * 1024 } });
  app.post('/api/acc/import', (req, res, next) => {
    if (!canEdit(req)) return res.status(403).json({ error: 'Tu usuario es de solo consulta.' });
    upload.array('files', 80)(req, res, async err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Un archivo pasa de 60 MB.' : 'No se pudieron recibir los archivos.' });
      try {
        const files = (req.files || []).map(f => ({ name: Buffer.from(f.originalname, 'latin1').toString('utf8'), buf: f.buffer }));
        const out = await importFiles(books, files, who(req), pdf);
        books.save();
        res.json(out);
      } catch (e) { next(e); }
    });
  });

  /* ---------- attachments ---------- */
  app.get('/api/acc/file/:stored', (req, res) => {
    const stored = path.basename(req.params.stored);
    const owner = [...books.db.docs, ...books.db.payments].find(x => (x.files || []).some(f => f.stored === stored));
    if (!owner) return res.status(404).json({ error: 'No se encontró el archivo.' });
    const f = owner.files.find(x => x.stored === stored);
    const full = path.join(books.filesDir, stored);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'El archivo ya no está en el servidor.' });
    const IMGT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif' };
    res.set('Content-Type', f.kind === 'pdf' ? 'application/pdf' : f.kind === 'xml' ? 'application/xml; charset=utf-8' : IMGT[path.extname(stored).toLowerCase()] || 'application/octet-stream');
    res.set('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    fs.createReadStream(full).pipe(res);
  });

  /* ---------- supplier portal (links per supplier) ---------- */
  app.get('/api/acc/portal', R(req => ({ vendors: portal ? portal.list(req) : [], pending: portal ? portal.pendingCount() : 0 })));
  app.post('/api/acc/portal/:id/enable', W(req => { portal.enable(req, req.params.id, (req.body || {}).region, who(req)); return { ok: true }; }));
  app.post('/api/acc/portal/test-vendor', W(req => {
    let p = books.db.partners.find(x => x.portal && x.portal.test);
    if (!p) p = books.upsertPartner({ name: 'Proveedor Prueba', supplier: true, terms: 30, notes: 'Proveedor fantasma para probar el portal' }, who(req));
    portal.enable(req, p.id, 'Prueba', who(req), true);
    return { id: p.id };
  }));
  app.post('/api/acc/portal/:id/disable', W(req => { portal.disable(req.params.id, who(req)); return { ok: true }; }));
  app.post('/api/acc/portal/:id/credentials', W(req => portal.credentials(req.params.id, (req.body || {}).username, who(req), (req.body || {}).password)));
  app.post('/api/acc/portal/:id/regenerate', W(req => { portal.regenerate(req.params.id, who(req)); return { ok: true }; }));

  /* ---------- payments ---------- */
  const payRow = p => { const pa = books.partner(p.partnerId), b = books.bank(p.bankId); return { id: p.id, number: p.number, dir: p.dir, date: p.date, partnerId: p.partnerId, partner: pa ? pa.name : '', bank: b ? b.name : '', amount: p.amount, applied: r2(p.allocations.reduce((a, x) => a + x.amount, 0)), method: p.method, ref: p.ref, state: p.state, uuid: p.uuid }; };
  app.get('/api/acc/payments', R(req => {
    const from = D(req.query.from), to = D(req.query.to), ql = String(req.query.q || '').toLowerCase();
    const rows = books.db.payments.filter(p => (!req.query.dir || p.dir === req.query.dir) && (!from || p.date >= from) && (!to || p.date <= to)).map(payRow)
      .filter(r => !ql || [r.number, r.partner, r.ref, String(r.amount)].some(v => String(v || '').toLowerCase().includes(ql)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
    return { rows, sum: r2(rows.filter(r => r.state === 'posted').reduce((a, r) => a + r.amount, 0)) };
  }));
  app.get('/api/acc/payments/:id', R(req => {
    const p = books.payment(req.params.id);
    if (!p) throw httpErr(404, 'No se encontró el pago.');
    return { payment: p, row: payRow(p), allocations: p.allocations.map(a => ({ ...a, doc: books.doc(a.docId) ? docRow(books.doc(a.docId)) : null })), journal: books.paymentJournal(p).map(l => ({ account: l.account, name: (books.account(l.account) || {}).name || '', debit: l.debit, credit: l.credit, label: l.label })) };
  }));
  app.get('/api/acc/open-docs', R(req => {
    const side = req.query.dir === 'in' ? 'ar' : 'ap';
    return books.db.docs.filter(d => d.partnerId === req.query.partner && d.state === 'posted' && TYPES[d.type].side === side && TYPES[d.type].sign > 0 && books.residual(d) > 0.009).map(docRow).sort((a, b) => a.due.localeCompare(b.due));
  }));
  app.post('/api/acc/payments', W(req => books.createPayment(req.body || {}, who(req))));
  /* Our own proof of payment (transfer receipt, cheque photo): optional, internal only, never shown to suppliers. */
  const proofUp = multer({ storage: multer.memoryStorage(), limits: { files: 10, fileSize: 25 * 1024 * 1024 } }).array('files', 10);
  app.post('/api/acc/payments/:id/files', (req, res, next) => {
    if (!canEdit(req)) return res.status(403).json({ error: 'Tu usuario es de solo consulta.' });
    proofUp(req, res, err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Un archivo pasa de 25 MB.' : 'No se pudieron recibir los archivos.' });
      try {
        const p = books.payment(req.params.id); if (!p) throw httpErr(404, 'No se encontró el pago.');
        const ok = /\.(pdf|jpe?g|png|webp|heic|heif|xml)$/i;
        const files = (req.files || []).map(f => ({ name: Buffer.from(f.originalname, 'latin1').toString('utf8'), buf: f.buffer }));
        if (!files.length) throw httpErr(400, 'Elige el comprobante (PDF o foto).');
        const bad = files.find(f => !ok.test(f.name)); if (bad) throw httpErr(400, `"${bad.name}" no es PDF, imagen ni XML.`);
        p.files = p.files || [];
        for (const f of files) {
          const ext = path.extname(f.name).toLowerCase(), stored = require('crypto').randomBytes(10).toString('hex') + ext;
          fs.writeFileSync(path.join(books.filesDir, stored), f.buf);
          p.files.push({ name: f.name, stored, kind: ext === '.pdf' ? 'pdf' : ext === '.xml' ? 'xml' : 'imagen', size: f.buf.length, proof: true, by: who(req), at: new Date().toISOString() });
        }
        books.log(who(req), 'adjuntó comprobante', 'pagos', p.number, files.map(f => f.name).join(', '));
        books.save();
        res.json({ files: p.files });
      } catch (e) { next(e); }
    });
  });
  app.delete('/api/acc/payments/:id/files/:stored', W(req => {
    const p = books.payment(req.params.id); if (!p) throw httpErr(404, 'No se encontró el pago.');
    const i = (p.files || []).findIndex(f => f.stored === path.basename(req.params.stored) && f.proof);
    if (i < 0) throw httpErr(404, 'No se encontró el comprobante.');
    const [f] = p.files.splice(i, 1);
    try { fs.unlinkSync(path.join(books.filesDir, f.stored)); } catch (e) {}
    books.log(who(req), 'quitó comprobante', 'pagos', p.number, f.name);
    return { files: p.files };
  }));
  app.post('/api/acc/payments/:id/cancel', W(req => books.undoable(p => `Cancelar pago ${p.number}`, who(req), () => books.cancelPayment(req.params.id, who(req), String((req.body || {}).reason || '').slice(0, 200)))));

  /* ---------- contacts ---------- */
  app.get('/api/acc/partners', R(req => {
    const ql = String(req.query.q || '').toLowerCase();
    const ap = books.aging('ap'), ar = books.aging('ar');
    const owe = Object.fromEntries(ap.partners.map(p => [p.partnerId, p.total])), due = Object.fromEntries(ar.partners.map(p => [p.partnerId, p.total]));
    const counts = {}; for (const d of books.db.docs) if (d.state !== 'cancelled' && d.state !== 'erased') counts[d.partnerId] = (counts[d.partnerId] || 0) + 1;
    return books.db.partners.filter(p => (!req.query.kind || p[req.query.kind]) && (!ql || (p.name + ' ' + p.rfc).toLowerCase().includes(ql)))
      .map(p => ({ ...p, payable: owe[p.id] || 0, receivable: due[p.id] || 0, docs: counts[p.id] || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }));
  app.post('/api/acc/partners', W(req => books.upsertPartner(req.body || {}, who(req))));
  app.put('/api/acc/partners/:id', W(req => books.upsertPartner({ ...(req.body || {}), id: req.params.id }, who(req))));

  /* ---------- journal entries ---------- */
  app.get('/api/acc/entries', R(() => books.db.entries.map(e => ({ id: e.id, number: e.number, date: e.date, ref: e.ref, state: e.state, total: r2(e.lines.reduce((a, l) => a + l.debit, 0)) })).sort((a, b) => b.date.localeCompare(a.date))));
  app.get('/api/acc/entries/:id', R(req => { const e = books.entry(req.params.id); if (!e) throw httpErr(404, 'No se encontró la póliza.'); return e; }));
  app.post('/api/acc/entries', W(req => books.saveEntry(req.body || {}, who(req))));
  app.post('/api/acc/entries/:id/post', W(req => books.postEntry(req.params.id, who(req))));
  app.post('/api/acc/entries/:id/cancel', W(req => books.cancelEntry(req.params.id, who(req))));

  /* ---------- chart of accounts ---------- */
  app.post('/api/acc/accounts', W(req => {
    const { code, name, type } = req.body || {};
    if (!/^[0-9]{3}(\.[0-9]{2,5}){0,3}$/.test(code || '')) throw httpErr(400, 'El código debe tener el formato 000.00.00.');
    if (books.account(code)) throw httpErr(400, 'Ya existe una cuenta con ese código.');
    if (!ACC_TYPES[type]) throw httpErr(400, 'Elige el tipo de cuenta.');
    if (!String(name || '').trim()) throw httpErr(400, 'Falta el nombre.');
    const a = { code, name: String(name).trim(), type, reconcile: ['AR', 'LP'].includes(type), active: true };
    books.db.accounts.push(a); books.db.accounts.sort((x, y) => x.code.localeCompare(y.code));
    books.log(who(req), 'creó', 'cuenta', code, a.name);
    return a;
  }));
  app.put('/api/acc/accounts/:code', W(req => {
    const a = books.account(req.params.code);
    if (!a) throw httpErr(404, 'La cuenta no existe.');
    const { name, type, active } = req.body || {};
    if (name != null && String(name).trim()) a.name = String(name).trim();
    if (type != null) { if (!ACC_TYPES[type]) throw httpErr(400, 'Tipo no válido.'); a.type = type; }
    if (active != null) a.active = !!active;
    books.log(who(req), 'editó', 'cuenta', a.code, a.name);
    return a;
  }));

  /* ---------- reports ---------- */
  function report(name, q) {
    const from = D(q.from), to = D(q.to), at = D(q.at) || today();
    switch (name) {
      case 'trial': return books.trialBalance(from, to);
      case 'ledger': return books.ledger(q.account, from, to);
      case 'pnl': return books.pnl(from, to);
      case 'balance': return books.balanceSheet(at);
      case 'aging': return books.aging(q.side === 'ar' ? 'ar' : 'ap', at);
      case 'statement': return books.statement(q.partner, from, to);
      case 'tax': return books.taxReport(/^\d{4}-\d{2}$/.test(q.month || '') ? q.month : today().slice(0, 7));
      case 'analysis': return books.analysis(from, to, q.side === 'ar' ? 'ar' : 'ap', ['month', 'account'].includes(q.by) ? q.by : 'partner');
      case 'cashflow': return books.cashFlow(from, to);
      case 'schedule': {
        // open supplier invoices by due date: what to pay and when
        const rows = books.db.docs.filter(d => d.state === 'posted' && TYPES[d.type].side === 'ap' && TYPES[d.type].sign > 0 && books.residual(d) > 0.009)
          .map(d => { const p = books.partner(d.partnerId) || {}; return { id: d.id, number: d.number, folio: `${d.serie || ''}${d.folio || ''}`, partner: p.name || '', terms: d.metodoPago === 'PUE' ? 0 : p.terms, pue: d.metodoPago === 'PUE', date: d.date, received: d.received || d.date, due: d.due, amount: books.residual(d) }; })
          .sort((a, b) => a.due.localeCompare(b.due) || a.partner.localeCompare(b.partner));
        const t = today(), weeks = {};
        for (const r of rows) {
          const dd = new Date(r.due + 'T12:00:00Z'), dow = (dd.getUTCDay() + 6) % 7; dd.setUTCDate(dd.getUTCDate() - dow);
          const k = r.due < t ? 'vencido' : dd.toISOString().slice(0, 10);
          (weeks[k] = weeks[k] || { week: k, total: 0, count: 0 }); weeks[k].total = r2(weeks[k].total + r.amount); weeks[k].count++;
        }
        return { at: t, rows, weeks: Object.values(weeks).sort((a, b) => (a.week === 'vencido' ? -1 : b.week === 'vencido' ? 1 : a.week.localeCompare(b.week))), total: r2(rows.reduce((a, r) => a + r.amount, 0)) };
      }
      case 'journal': return { from, to, rows: books.journal(from, to).map(l => ({ date: l.date, number: l.src.number, account: l.account, name: (books.account(l.account) || {}).name || '', partner: (books.partner(l.partnerId) || {}).name || '', label: l.label, debit: l.debit, credit: l.credit })) };
      default: throw httpErr(404, 'Reporte no encontrado.');
    }
  }
  app.get('/api/acc/reports/:name', R(req => report(req.params.name, req.query)));

  /* Excel export: one sheet per report, same numbers as on screen */
  function table(name, r) {
    const money = true;
    switch (name) {
      case 'trial': return { title: 'Balanza de comprobación', cols: [['Cuenta', 'code'], ['Nombre', 'name'], ['Saldo inicial', 'open', money], ['Cargos', 'debit', money], ['Abonos', 'credit', money], ['Saldo final', 'close', money]], rows: r.rows, total: { name: 'Totales', ...r.totals } };
      case 'ledger': return { title: `Libro mayor ${r.account.code} ${r.account.name}`, cols: [['Fecha', 'date'], ['Número', 'number'], ['Contacto', 'partner'], ['Concepto', 'label'], ['Cargo', 'debit', money], ['Abono', 'credit', money], ['Saldo', 'balance', money]], rows: [{ label: 'Saldo inicial', balance: r.open }, ...r.rows] };
      case 'pnl': return { title: 'Estado de resultados', cols: [['Sección', 'sec'], ['Cuenta', 'code'], ['Nombre', 'name'], ['Importe', 'amount', money]], rows: [...r.income.map(x => ({ sec: 'Ingresos', ...x })), { sec: 'Total ingresos', amount: r.totals.income }, ...r.cost.map(x => ({ sec: 'Costo', ...x })), { sec: 'Utilidad bruta', amount: r.totals.gross }, ...r.expense.map(x => ({ sec: 'Gastos', ...x })), { sec: 'Utilidad neta', amount: r.totals.net }] };
      case 'balance': return { title: `Balance general al ${r.at}`, cols: [['Sección', 'sec'], ['Cuenta', 'code'], ['Nombre', 'name'], ['Importe', 'amount', money]], rows: [...r.assets.map(x => ({ sec: 'Activo', ...x })), { sec: 'Total activo', amount: r.totals.assets }, ...r.liabilities.map(x => ({ sec: 'Pasivo', ...x })), { sec: 'Total pasivo', amount: r.totals.liabilities }, ...r.equity.map(x => ({ sec: 'Capital', ...x })), { sec: 'Total pasivo + capital', amount: r.totals.liabEquity }] };
      case 'aging': return { title: r.side === 'ar' ? 'Cuentas por cobrar vencidas' : 'Cuentas por pagar vencidas', cols: [['Contacto', 'partner'], ['Por vencer', 'current', money], ['1-30 días', 'd30', money], ['31-60', 'd60', money], ['61-90', 'd90', money], ['Más de 90', 'older', money], ['Total', 'total', money]], rows: r.partners, total: { partner: 'Total', ...r.totals } };
      case 'statement': return { title: `Estado de cuenta ${r.partner.name}`, cols: [['Fecha', 'date'], ['Número', 'number'], ['Concepto', 'label'], ['Cargo', 'charge', money], ['Abono', 'credit', money], ['Saldo', 'balance', money]], rows: [{ label: 'Saldo inicial', balance: r.open }, ...r.rows] };
      case 'tax': return { title: `IVA ${r.month} (flujo de efectivo) y DIOT`, cols: [['Proveedor', 'partner'], ['RFC', 'rfc'], ['Base 16%', 'base16', money], ['Base 8%', 'base8', money], ['Base 0%', 'base0', money], ['Exento', 'exento', money], ['IVA pagado', 'iva', money], ['IVA retenido', 'ivaRet', money], ['Pagado', 'paid', money]], rows: [{ partner: 'IVA trasladado cobrado', paid: r.ivaCollected }, { partner: 'IVA acreditable pagado', paid: r.ivaPaid }, { partner: 'IVA retenido por clientes', paid: r.ivaRetByClients }, { partner: 'IVA a cargo (a favor si es negativo)', paid: r.payable }, { partner: 'Retenciones de IVA a enterar', paid: r.retIvaPaid }, {}, ...r.diot] };
      case 'analysis': return { title: 'Análisis de facturas', cols: [['Concepto', 'label'], ['Documentos', 'count'], ['Subtotal', 'subtotal', money], ['Total', 'total', money]], rows: r.rows, total: { label: 'Total', ...r.totals } };
      case 'schedule': return { title: 'Calendario de pagos a proveedores', cols: [['Vence', 'due'], ['Proveedor', 'partner'], ['Número', 'number'], ['Folio', 'folio'], ['Fecha factura', 'date'], ['Recibida', 'received'], ['Días crédito', 'terms'], ['Saldo', 'amount', money]], rows: r.rows, total: { partner: 'Total', amount: r.total } };
      case 'cashflow': return { title: 'Flujo de efectivo', cols: [['Cuenta', 'bank'], ['Saldo inicial', 'open', money], ['Entradas', 'inflow', money], ['Salidas', 'outflow', money], ['Saldo final', 'close', money]], rows: r.rows, total: { bank: 'Total', ...r.totals } };
      case 'journal': return { title: 'Libro diario', cols: [['Fecha', 'date'], ['Número', 'number'], ['Cuenta', 'account'], ['Nombre', 'name'], ['Contacto', 'partner'], ['Concepto', 'label'], ['Cargo', 'debit', money], ['Abono', 'credit', money]], rows: r.rows };
    }
  }
  app.get('/api/acc/export/:name.xlsx', async (req, res, next) => {
    try {
      const r = report(req.params.name, req.query), t = table(req.params.name, r);
      const wb = new ExcelJS.Workbook(); wb.creator = 'Grupo AVE';
      const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/*?:[\]]/g, ' '));
      ws.addRow([books.db.company.name]).font = { bold: true, size: 13 };
      ws.addRow([t.title + (r.from || r.to ? `  ·  ${r.from || 'inicio'} a ${r.to || today()}` : '')]).font = { bold: true };
      ws.addRow([]);
      const head = ws.addRow(t.cols.map(c => c[0])); head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2328' } }; });
      for (const row of t.rows) ws.addRow(t.cols.map(c => row[c[1]] ?? ''));
      if (t.total) { const tr = ws.addRow(t.cols.map(c => t.total[c[1]] ?? '')); tr.font = { bold: true }; tr.eachCell(c => { c.border = { top: { style: 'thin' } }; }); }
      t.cols.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c[2] ? 16 : Math.min(50, Math.max(10, c[0].length + 4)); if (c[2]) col.numFmt = '#,##0.00;[Red]-#,##0.00'; });
      ws.getColumn(t.cols.findIndex(c => ['name', 'label', 'partner'].includes(c[1])) + 1).width = 44;
      ws.views = [{ state: 'frozen', ySplit: 4 }];
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(t.title + '.xlsx')}`);
      await wb.xlsx.write(res); res.end();
    } catch (e) { next(e); }
  });

  /* ---------- settings ---------- */
  app.put('/api/acc/settings', W(req => {
    const b = req.body || {}, s = books.db.settings;
    if ('lockDate' in b) { if (b.lockDate && !D(b.lockDate)) throw httpErr(400, 'Fecha de cierre no válida.'); s.lockDate = b.lockDate || null; books.log(who(req), 'cambió', 'cierre', '', s.lockDate || 'sin cierre'); }
    if ('iepsCreditable' in b) s.iepsCreditable = !!b.iepsCreditable;
    if (b.accounts) for (const [k, v] of Object.entries(b.accounts)) { if (k in s.accounts) { if (!books.account(v)) throw httpErr(400, `La cuenta ${v} no existe.`); s.accounts[k] = v; } }
    if (b.company) { const c = books.db.company; for (const k of ['name', 'regimen', 'cp']) if (k in b.company) c[k] = String(b.company[k] || ''); }
    books.log(who(req), 'editó', 'configuración', '', '');
    return { settings: s, company: books.db.company };
  }));
  app.post('/api/acc/banks', W(req => {
    const { id, name, account, number } = req.body || {};
    const a = books.account(account);
    if (!a || !['BK', 'LC'].includes(a.type)) throw httpErr(400, 'La cuenta contable debe ser de tipo Banco y caja.');
    if (!String(name || '').trim()) throw httpErr(400, 'Falta el nombre.');
    let bk = id && books.bank(id);
    if (bk) Object.assign(bk, { name: String(name).trim(), account, number: number || '' });
    else { bk = { id: 'b' + Date.now().toString(36), name: String(name).trim(), account, number: number || '' }; books.db.banks.push(bk); }
    books.log(who(req), 'guardó', 'banco', bk.id, bk.name);
    return bk;
  }));

  /* ---------- users (admin) and audit ---------- */
  app.get('/api/acc/users', (req, res) => { if (!isAdmin(req)) return res.status(403).json({ error: 'Solo un administrador puede ver los usuarios.' }); res.json({ owner: ownerName(), roles: users.ROLES, users: users.list() }); });
  app.post('/api/acc/users', (req, res, next) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo un administrador puede crear usuarios.' });
    try { const u = users.create(req.body || {}, ownerName()); books.log(who(req), 'creó', 'usuario', u.id, `${u.username} (${u.roleLabel})`); books.save(); res.json(u); } catch (e) { next(e); }
  });
  app.put('/api/acc/users/:id', (req, res, next) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo un administrador puede editar usuarios.' });
    try { const u = users.update(req.params.id, req.body || {}); books.log(who(req), 'editó', 'usuario', u.id, `${u.username} (${u.roleLabel}${u.active ? '' : ', desactivado'})`); books.save(); res.json(u); } catch (e) { next(e); }
  });
  app.get('/api/acc/audit', R(req => books.db.audit.slice(-Math.min(2000, parseInt(req.query.limit, 10) || 500)).reverse()));

  // errors from this module carry a user-facing message
  app.use('/api/acc', (err, req, res, next) => {
    if (err && err.expose) return res.status(err.status || 400).json({ error: err.message });
    if (err && err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    next(err);
  });
  return books;
};

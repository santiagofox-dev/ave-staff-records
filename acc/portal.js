'use strict';
/* Supplier portal: each enabled supplier gets a private link where they upload their invoice (XML/PDF)
   plus a photo of the delivery receipt. Uploads land in Contabilidad as drafts dated "received today",
   so credit days start counting from the upload. No login: the link itself is the key. */
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { importFiles, storeFile } = require('./importer');
const { TYPES, r2, today, addDays } = require('./core');

const IMG = /\.(jpe?g|png|webp|heic|heif)$/i;
const IMG_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/i;

module.exports = function portal(app, { books: getBooks, pdf, publicUrl }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 12, fileSize: 15 * 1024 * 1024 } });
  const hits = new Map(); // token -> [timestamps] (max 40 uploads per hour per link)
  const tokenOk = t => /^[A-Za-z0-9_-]{24,64}$/.test(String(t || ''));
  const vendorFor = t => { const b = getBooks(); return tokenOk(t) ? b.db.partners.find(p => p.portal && p.portal.enabled && p.portal.token === t) : null; };
  const localToday = () => new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10); // Ciudad Juárez

  const statusOf = (b, d) => {
    if (d.state === 'cancelled') return { key: 'rechazada', label: 'Cancelada' };
    if (d.state === 'draft') return { key: 'revision', label: 'En revisión' };
    const ps = b.payState(d);
    if (ps === 'pagado') return { key: 'pagada', label: 'Pagada' };
    if (ps === 'parcial') return { key: 'parcial', label: 'Pago parcial' };
    return { key: 'porpagar', label: ps === 'vencido' ? 'Por pagar (vencida)' : 'Por pagar' };
  };

  app.get('/proveedor/:token', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '..', 'public', 'proveedor.html'));
  });

  app.get('/api/portal/:token', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const b = getBooks(), v = vendorFor(req.params.token);
    if (!v) return res.status(404).json({ error: 'Este enlace no es válido o fue desactivado. Pide uno nuevo a Grupo AVE.' });
    const docs = b.db.docs.filter(d => d.partnerId === v.id && TYPES[d.type].side === 'ap').sort((a, c) => (c.received || c.date).localeCompare(a.received || a.date)).slice(0, 60)
      .map(d => ({ folio: `${d.serie || ''}${d.folio || ''}` || (d.uuid || '').slice(0, 8), date: d.date, received: d.received || d.date, due: d.state === 'posted' ? d.due : addDays(d.received || d.date, v.terms || 0), total: d.total, residual: d.state === 'posted' ? b.residual(d) : d.total, status: statusOf(b, d), viaPortal: !!d.portal }));
    res.json({ vendor: { name: v.name, rfc: v.rfc || '', terms: v.terms || 0 }, company: { name: b.db.company.name, rfc: b.db.company.rfc }, docs });
  });

  app.post('/api/portal/:token/upload', (req, res, next) => {
    const v = vendorFor(req.params.token);
    if (!v) return res.status(404).json({ error: 'Este enlace no es válido o fue desactivado.' });
    const now = Date.now(), list = (hits.get(v.id) || []).filter(t => now - t < 3600e3);
    if (list.length >= 40) return res.status(429).json({ error: 'Demasiadas cargas en la última hora. Intenta más tarde.' });
    upload.fields([{ name: 'factura', maxCount: 6 }, { name: 'recibo', maxCount: 4 }])(req, res, async err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Un archivo pasa de 15 MB.' : 'No se pudieron recibir los archivos.' });
      try {
        const name = f => Buffer.from(f.originalname, 'latin1').toString('utf8');
        const fact = (req.files.factura || []).map(f => ({ name: name(f), buf: f.buffer })).filter(f => /\.(xml|pdf)$/i.test(f.name));
        const recs = (req.files.recibo || []).filter(f => IMG.test(name(f)) || IMG_TYPES.test(f.mimetype));
        if (!fact.length) return res.status(400).json({ error: 'Sube la factura: el XML (y el PDF si lo tienes).' });
        if (!recs.length) return res.status(400).json({ error: 'Falta la foto del recibo de entrega.' });
        list.push(now); hits.set(v.id, list);
        const b = getBooks();
        const out = await importFiles(b, fact, `Proveedor: ${v.name}`, pdf, { vendor: v });
        const created = out.created.map(c => b.doc(c.id)).filter(Boolean);
        const at = new Date().toISOString(), recv = localToday();
        for (const d of created) {
          for (const f of recs) {
            const ext = (path.extname(name(f)) || ('.' + (f.mimetype.split('/')[1] || 'jpg'))).toLowerCase();
            d.files.push({ ...storeFile(b, `Recibo de entrega${ext}`, f.buffer), kind: 'img', receipt: true });
          }
          d.portal = { at, ip: req.ip };
          d.received = recv; d.due = b.defaultDue(d);
          d.warnings = [`Subida por el proveedor desde el portal el ${recv}, con foto del recibo de entrega.`, ...(d.warnings || [])];
        }
        b.log(`Proveedor: ${v.name}`, 'subió desde el portal', 'facturas', v.id, `${created.length} facturas, ${recs.length} fotos`);
        b.save();
        res.json({
          created: created.map(d => ({ folio: `${d.serie || ''}${d.folio || ''}`, total: d.total, due: d.due })),
          duplicates: out.duplicates.length, errors: out.errors.map(e => e.error), skipped: out.skipped.map(s => s.reason),
          pdfOnly: out.created.filter(c => c.pdfOnly).length,
        });
      } catch (e) { next(e); }
    });
  });

  /* ---------- admin side (behind login, see acc/routes.js for role checks) ---------- */
  const link = (req, t) => `${publicUrl || (req.protocol + '://' + req.get('host'))}/proveedor/${t}`;
  const newToken = () => crypto.randomBytes(24).toString('base64url');
  return {
    list(req) {
      const b = getBooks();
      return b.db.partners.filter(p => p.portal).map(p => {
        const docs = b.db.docs.filter(d => d.partnerId === p.id && d.portal);
        const last = docs.map(d => d.portal.at).sort().pop() || null;
        return { id: p.id, name: p.name, rfc: p.rfc, terms: p.terms, region: p.portal.region, enabled: !!p.portal.enabled, link: link(req, p.portal.token), uploads: docs.length, pending: docs.filter(d => d.state === 'draft').length, last };
      }).sort((a, c) => a.name.localeCompare(c.name, 'es'));
    },
    enable(req, partnerId, region, user) {
      const b = getBooks(), p = b.partner(partnerId);
      if (!p) { const e = new Error('No se encontró el proveedor.'); e.status = 404; throw e; }
      p.portal = { ...(p.portal || {}), token: (p.portal && p.portal.token) || newToken(), enabled: true, region: region || (p.portal && p.portal.region) || 'Chihuahua', since: (p.portal && p.portal.since) || new Date().toISOString() };
      p.supplier = true;
      b.log(user, 'activó portal', 'contacto', p.id, p.name);
      return p;
    },
    disable(partnerId, user) { const b = getBooks(), p = b.partner(partnerId); if (p && p.portal) { p.portal.enabled = false; b.log(user, 'desactivó portal', 'contacto', p.id, p.name); } return p; },
    regenerate(partnerId, user) { const b = getBooks(), p = b.partner(partnerId); if (p && p.portal) { p.portal.token = newToken(); p.portal.enabled = true; b.log(user, 'cambió el enlace del portal', 'contacto', p.id, p.name); } return p; },
    pendingCount() { return getBooks().db.docs.filter(d => d.portal && d.state === 'draft').length; },
  };
};

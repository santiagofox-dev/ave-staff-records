'use strict';
/* Supplier portal. Each enabled supplier signs in with its own username and password (or opens its
   personal link, which fills in the username) and uploads its invoice (XML/PDF) plus a photo of the
   delivery receipt, choosing the Jabil plant it was delivered to: B1 or B3, never both.
   Uploads land in Contabilidad as drafts dated "received today", so credit days start from the upload.
   The admin can pause an account at any time; a paused account is signed out on its next request. */
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { importFiles, storeFile } = require('./importer');
const { TYPES, addDays } = require('./core');

const IMG = /\.(jpe?g|png|webp|heic|heif)$/i;
const IMG_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/i;
const PLANTS = { B1: 'Jabil B1', B3: 'Jabil B3' };
const WORDS = ['naranja', 'tortuga', 'ventana', 'canela', 'tomate', 'girasol', 'paloma', 'cereza', 'limonada', 'castillo', 'pradera', 'tortilla', 'mariposa', 'durazno', 'galleta', 'pelota', 'cometa', 'abanico', 'aguacate', 'ballena', 'bosque', 'caballo', 'camino', 'campana', 'cascada', 'cebolla', 'conejo', 'delfin', 'espiga', 'estrella', 'frijol', 'granero', 'guitarra', 'jardin', 'lechuga', 'lluvia', 'maceta', 'manzana', 'molino', 'nopal', 'oliva', 'panal', 'pepino', 'perico', 'pimienta', 'plátano', 'puente', 'rancho', 'sandia', 'semilla', 'sombrero', 'tambor', 'trigo', 'tulipan', 'verano', 'violeta', 'zanahoria', 'avena', 'brisa', 'cactus', 'colibri', 'coyote', 'elote', 'fogata', 'gaviota', 'higuera', 'laguna', 'mezquite', 'nogal', 'papaya', 'piñata'].map(w => w.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/g, 'n'));
const pick = () => WORDS[crypto.randomInt(WORDS.length)];
const twoWords = () => { let a = pick(), b = pick(); while (b === a) b = pick(); return `${a}.${b}`; };
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');

module.exports = function portal(app, { books: getBooks, pdf, publicUrl, secret }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 12, fileSize: 15 * 1024 * 1024 } });
  const hits = new Map(), fails = new Map();
  const localToday = () => new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10); // Ciudad Juárez
  const PROD = process.env.NODE_ENV === 'production';

  /* ---- vendor session: signed cookie, separate from the staff login ---- */
  const sign = s => crypto.createHmac('sha256', secret).update('portal:' + s).digest('base64url');
  const COOKIE = 'ave_v', MAX = 30 * 864e5;
  function setSession(res, v) {
    const val = `${v.id}.${v.portal.account.ver}.${Date.now() + MAX}`;
    res.cookie(COOKIE, `${val}.${sign(val)}`, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: MAX, path: '/' });
  }
  function current(req) {
    const raw = String((req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '=')) || '').slice(COOKIE.length + 1);
    const parts = decodeURIComponent(raw).split('.'); if (parts.length !== 4) return null;
    const [id, ver, exp, sig] = parts, val = `${id}.${ver}.${exp}`, want = sign(val);
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) || +exp < Date.now()) return null;
    const v = getBooks().partner(id);
    return v && v.portal && v.portal.enabled && v.portal.account && v.portal.account.ver === ver ? v : null;
  }
  const needVendor = (req, res, next) => {
    const v = current(req);
    if (!v) return res.status(401).json({ error: 'Tu sesión terminó o tu acceso está pausado. Vuelve a entrar.' });
    req.vendor = v; next();
  };

  const statusOf = (b, d) => {
    if (d.state === 'cancelled') return { key: 'rechazada', label: 'Cancelada' };
    if (d.state === 'draft') return { key: 'revision', label: 'En revisión' };
    const ps = b.payState(d);
    if (ps === 'pagado') return { key: 'pagada', label: 'Pagada' };
    if (ps === 'parcial') return { key: 'parcial', label: 'Pago parcial' };
    return { key: 'porpagar', label: ps === 'vencido' ? 'Por pagar (vencida)' : 'Por pagar' };
  };

  const page = (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(__dirname, '..', 'public', 'proveedor.html')); };
  app.get('/proveedores', page);
  app.get('/proveedor/:token', page);

  // personal link → fills in the username on the sign-in screen
  app.get('/api/portal/hint/:token', (req, res) => {
    const t = String(req.params.token || '');
    const v = /^[A-Za-z0-9_-]{24,64}$/.test(t) && getBooks().db.partners.find(p => p.portal && p.portal.token === t);
    if (!v) return res.status(404).json({ error: 'Este enlace no es válido. Entra con tu usuario y contraseña.' });
    res.json({ name: v.name, username: v.portal.account ? v.portal.account.username : '', paused: !v.portal.enabled });
  });

  app.post('/api/portal/login', (req, res) => {
    const ip = req.ip, f = fails.get(ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    const { username, password } = req.body || {};
    const u = String(username || '').trim().toLowerCase();
    const v = getBooks().db.partners.find(p => p.portal && p.portal.account && p.portal.account.username === u);
    const salt = v ? v.portal.account.salt : '00', got = Buffer.from(hashPw(String(password || '').trim().toLowerCase(), salt), 'hex');
    if (!v || !crypto.timingSafeEqual(got, Buffer.from(v.portal.account.hash, 'hex'))) {
      f.n++; if (f.n >= 8) { f.until = Date.now() + 15 * 60e3; f.n = 0; } fails.set(ip, f);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    if (!v.portal.enabled) return res.status(403).json({ error: 'Tu acceso al portal está pausado. Comunícate con Grupo AVE.' });
    fails.delete(ip);
    v.portal.account.lastLogin = new Date().toISOString(); getBooks().save();
    setSession(res, v); res.json({ ok: true });
  });
  app.post('/api/portal/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

  app.post('/api/portal/password', needVendor, (req, res) => {
    const { current: cur, next } = req.body || {}, a = req.vendor.portal.account;
    if (!crypto.timingSafeEqual(Buffer.from(hashPw(String(cur || '').trim().toLowerCase(), a.salt), 'hex'), Buffer.from(a.hash, 'hex'))) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    const n = String(next || '').trim().toLowerCase();
    if (n.length < 8) return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 8 caracteres.' });
    a.salt = crypto.randomBytes(16).toString('hex'); a.hash = hashPw(n, a.salt); a.ver = crypto.randomBytes(6).toString('hex'); a.changedByVendor = new Date().toISOString();
    getBooks().log(`Proveedor: ${req.vendor.name}`, 'cambió su contraseña', 'portal', req.vendor.id, '');
    getBooks().save(); setSession(res, req.vendor); res.json({ ok: true });
  });

  app.get('/api/portal/me', needVendor, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const b = getBooks(), v = req.vendor;
    const docs = b.db.docs.filter(d => d.partnerId === v.id && TYPES[d.type].side === 'ap').sort((a, c) => (c.received || c.date).localeCompare(a.received || a.date)).slice(0, 60)
      .map(d => ({ folio: `${d.serie || ''}${d.folio || ''}` || (d.uuid || '').slice(0, 8), date: d.date, received: d.received || d.date, plant: d.plant || '', due: d.state === 'posted' ? d.due : addDays(d.received || d.date, v.terms || 0), total: d.total, status: statusOf(b, d) }));
    res.json({ vendor: { name: v.name, rfc: v.rfc || '', terms: v.terms || 0, username: v.portal.account.username, test: !!v.portal.test }, company: { name: b.db.company.name }, plants: PLANTS, docs });
  });

  app.post('/api/portal/upload', needVendor, (req, res, next) => {
    const v = req.vendor, now = Date.now(), list = (hits.get(v.id) || []).filter(t => now - t < 3600e3);
    if (list.length >= 40) return res.status(429).json({ error: 'Demasiadas cargas en la última hora. Intenta más tarde.' });
    upload.fields([{ name: 'factura', maxCount: 6 }, { name: 'recibo', maxCount: 4 }])(req, res, async err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Un archivo pasa de 15 MB.' : 'No se pudieron recibir los archivos.' });
      try {
        const plant = String((req.body || {}).plant || '').toUpperCase();
        if (!PLANTS[plant]) return res.status(400).json({ error: 'Elige si la factura es para Jabil B1 o Jabil B3.' });
        const name = f => Buffer.from(f.originalname, 'latin1').toString('utf8');
        const fact = (req.files.factura || []).map(f => ({ name: name(f), buf: f.buffer })).filter(f => /\.(xml|pdf)$/i.test(f.name));
        const recs = (req.files.recibo || []).filter(f => IMG.test(name(f)) || IMG_TYPES.test(f.mimetype));
        if (!fact.length) return res.status(400).json({ error: 'Sube la factura: el XML (y el PDF si lo tienes).' });
        if (!recs.length) return res.status(400).json({ error: 'Falta la foto del recibo de entrega.' });
        list.push(now); hits.set(v.id, list);
        const b = getBooks();
        const out = await importFiles(b, fact, `Proveedor: ${v.name}`, pdf, { vendor: v, test: !!v.portal.test });
        const created = out.created.map(c => b.doc(c.id)).filter(Boolean);
        const at = new Date().toISOString(), recv = localToday();
        for (const d of created) {
          for (const f of recs) {
            const ext = (path.extname(name(f)) || ('.' + (f.mimetype.split('/')[1] || 'jpg'))).toLowerCase();
            d.files.push({ ...storeFile(b, `Recibo de entrega${ext}`, f.buffer), kind: 'img', receipt: true });
          }
          d.portal = { at, ip: req.ip }; d.plant = plant;
          d.received = recv; d.due = b.defaultDue(d);
          d.ref = d.ref || PLANTS[plant];
          d.warnings = [`Subida por el proveedor desde el portal el ${recv} para ${PLANTS[plant]}, con foto del recibo de entrega.`, ...(d.warnings || [])];
          if (v.portal.test) { d.test = true; d.warnings.unshift('FACTURA DE PRUEBA del proveedor fantasma: no la publiques; elimínala cuando termines.'); }
        }
        b.log(`Proveedor: ${v.name}`, 'subió desde el portal', 'facturas', v.id, `${created.length} facturas para ${PLANTS[plant]}, ${recs.length} fotos`);
        b.save();
        res.json({ plant: PLANTS[plant], created: created.map(d => ({ folio: `${d.serie || ''}${d.folio || ''}`, total: d.total, due: d.due })), duplicates: out.duplicates.length, errors: out.errors.map(e => e.error), skipped: out.skipped.map(s => s.reason), pdfOnly: out.created.filter(c => c.pdfOnly).length });
      } catch (e) { next(e); }
    });
  });

  /* ---------- admin side (behind login; role checks in acc/routes.js) ---------- */
  const base = req => publicUrl || (req.protocol + '://' + req.get('host'));
  const newToken = () => crypto.randomBytes(24).toString('base64url');
  const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 32);
  function setPassword(p, pw) { const a = p.portal.account; a.salt = crypto.randomBytes(16).toString('hex'); a.hash = hashPw(pw, a.salt); a.ver = crypto.randomBytes(6).toString('hex'); a.set = new Date().toISOString(); }
  return {
    list(req) {
      const b = getBooks();
      return b.db.partners.filter(p => p.portal).map(p => {
        const docs = b.db.docs.filter(d => d.partnerId === p.id && d.portal);
        const last = docs.map(d => d.portal.at).sort().pop() || null, acc = p.portal.account || null;
        return { test: !!p.portal.test, id: p.id, name: p.name, rfc: p.rfc, terms: p.terms, region: p.portal.region, enabled: !!p.portal.enabled, link: `${base(req)}/proveedor/${p.portal.token}`, login: `${base(req)}/proveedores`,
          username: acc ? acc.username : '', hasPassword: !!(acc && acc.hash), lastLogin: acc ? acc.lastLogin || null : null, changedByVendor: !!(acc && acc.changedByVendor), uploads: docs.length, pending: docs.filter(d => d.state === 'draft').length, last };
      }).sort((a, c) => a.name.localeCompare(c.name, 'es'));
    },
    enable(req, partnerId, region, user, test) {
      const b = getBooks(), p = b.partner(partnerId);
      if (!p) { const e = new Error('No se encontró el proveedor.'); e.status = 404; throw e; }
      p.portal = { ...(p.portal || {}), token: (p.portal && p.portal.token) || newToken(), enabled: true, region: region || (p.portal && p.portal.region) || 'Chihuahua', test: !!(test || (p.portal && p.portal.test)), since: (p.portal && p.portal.since) || new Date().toISOString() };
      p.supplier = true;
      b.log(user, 'activó portal', 'contacto', p.id, p.name);
      return p;
    },
    disable(partnerId, user) { const b = getBooks(), p = b.partner(partnerId); if (p && p.portal) { p.portal.enabled = false; b.log(user, 'pausó el acceso al portal', 'contacto', p.id, p.name); } return p; },
    regenerate(partnerId, user) { const b = getBooks(), p = b.partner(partnerId); if (p && p.portal) { p.portal.token = newToken(); b.log(user, 'cambió el enlace del portal', 'contacto', p.id, p.name); } return p; },
    /* create the account if missing (username from the request or the name) and set a fresh two-word password; returns it once */
    credentials(partnerId, wantUser, user, wantPw) {
      const b = getBooks(), p = b.partner(partnerId);
      if (!p || !p.portal) { const e = new Error('Primero agrega el proveedor al portal.'); e.status = 400; throw e; }
      let username = p.portal.account && p.portal.account.username;
      if (wantUser || !username) {
        let u = slug(wantUser || p.name.split(/\s+/).slice(0, 2).join(' '));
        if (!/^[a-z0-9][a-z0-9.]{2,31}$/.test(u)) { const e = new Error('Usuario no válido: usa letras, números y punto (3 a 32).'); e.status = 400; throw e; }
        const taken = b.db.partners.some(x => x.id !== p.id && x.portal && x.portal.account && x.portal.account.username === u);
        if (taken) { const e = new Error(`El usuario ${u} ya lo tiene otro proveedor.`); e.status = 400; throw e; }
        username = u;
      }
      const password = wantPw ? String(wantPw).trim().toLowerCase() : twoWords();
      if (password.length < 8) { const e = new Error('La contraseña debe tener al menos 8 caracteres.'); e.status = 400; throw e; }
      p.portal.account = { ...(p.portal.account || {}), username };
      delete p.portal.account.changedByVendor;
      setPassword(p, password);
      b.log(user, 'generó contraseña del portal', 'contacto', p.id, `${p.name} (${username})`);
      return { id: p.id, name: p.name, username, password };
    },
    pendingCount() { return getBooks().db.docs.filter(d => d.portal && d.state === 'draft' && !d.test).length; },
  };
};

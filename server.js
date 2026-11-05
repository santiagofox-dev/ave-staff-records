'use strict';
/*
 * AVE Staff Records — single-admin web app.
 * Data lives in DATA_DIR (a Render persistent disk in production):
 *   DATA_DIR/db.json       employees, trainings, document index, login
 *   DATA_DIR/uploads/      the uploaded files (never served without login)
 */
const express = require('express');
const multer = require('multer');
const cookieSession = require('cookie-session');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 16) {
  console.error('SESSION_SECRET is missing or too short (16+ characters). Set it in the environment.');
  process.exit(1);
}
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------- storage ---------------- */
function load() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') { console.error('Could not read db.json:', e.message); process.exit(1); }
    return { employees: {}, auth: null };
  }
}
let state = load();
function persist() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_FILE + '.bak');
  fs.renameSync(tmp, DB_FILE);
}

/* ---------------- login ---------------- */
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function setPassword(user, pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  state.auth = { user, salt, hash: hashPw(pw, salt), ver: crypto.randomBytes(8).toString('hex') };
  persist();
}
if (!state.auth || process.env.RESET_PASSWORD === '1') {
  const u = process.env.ADMIN_USER, p = process.env.ADMIN_PASSWORD;
  if (!u || !p) { console.error('Set ADMIN_USER and ADMIN_PASSWORD for the first start.'); process.exit(1); }
  setPassword(u, p);
  console.log(process.env.RESET_PASSWORD === '1' ? 'Login reset from environment.' : 'Admin login created.');
}
function checkLogin(user, pw) {
  const a = state.auth;
  if (typeof user !== 'string' || typeof pw !== 'string') return false;
  const okUser = crypto.timingSafeEqual(
    crypto.createHash('sha256').update(user).digest(),
    crypto.createHash('sha256').update(a.user).digest());
  const got = Buffer.from(hashPw(pw, a.salt), 'hex'), want = Buffer.from(a.hash, 'hex');
  return crypto.timingSafeEqual(got, want) && okUser;
}

// Lock an IP out for 15 minutes after 5 failed attempts.
const attempts = new Map();
const LOCK_MS = 15 * 60 * 1000, MAX_FAILS = 5;
function lockedOut(ip) {
  const a = attempts.get(ip);
  if (!a) return false;
  if (a.until && a.until > Date.now()) return true;
  if (a.until && a.until <= Date.now()) attempts.delete(ip);
  return false;
}
function recordFail(ip) {
  const a = attempts.get(ip) || { n: 0, until: 0 };
  a.n += 1;
  if (a.n >= MAX_FAILS) { a.until = Date.now() + LOCK_MS; a.n = 0; }
  attempts.set(ip, a);
}

/* ---------------- app ---------------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
  });
  if (PROD) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use(express.json({ limit: '200kb' }));
app.use(cookieSession({
  name: 'ave_s', keys: [SESSION_SECRET], maxAge: 12 * 60 * 60 * 1000,
  httpOnly: true, sameSite: 'strict', secure: PROD,
}));

const authed = req => req.session && req.session.ok && req.session.ver === state.auth.ver;
function requireAuth(req, res, next) {
  if (authed(req)) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/files/') || req.path.startsWith('/reports/')) return res.status(401).json({ error: 'Vuelve a iniciar sesión.' });
  return res.redirect('/login');
}

app.get('/healthz', (req, res) => res.send('ok'));
app.use('/static', express.static(path.join(__dirname, 'public', 'static'), { maxAge: '1h' }));

app.get('/login', (req, res) => {
  if (authed(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (lockedOut(ip)) return res.status(429).json({ error: 'Demasiados intentos fallidos. Inténtalo de nuevo en 15 minutos.' });
  const { username, password } = req.body || {};
  if (!checkLogin(username, password)) { recordFail(ip); return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' }); }
  attempts.delete(ip);
  req.session = { ok: true, ver: state.auth.ver };
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

/* everything below needs a login */
app.use(requireAuth);
app.use(['/api', '/files', '/reports'], (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

app.post('/api/password', (req, res) => {
  const { current, next: nextPw } = req.body || {};
  if (!checkLogin(state.auth.user, current)) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  if (typeof nextPw !== 'string' || nextPw.length < 10) return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 10 caracteres.' });
  setPassword(state.auth.user, nextPw);
  req.session = { ok: true, ver: state.auth.ver }; // other devices are signed out
  res.json({ ok: true });
});

/* ---- employees ---- */
const ID = /^[A-Za-z0-9]{8,40}$/;
const S = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const D = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const publicEmp = e => ({ ...e, docs: (e.docs || []).map(({ stored, ...d }) => d) });

app.get('/api/employees', (req, res) => res.json(Object.values(state.employees).map(publicEmp)));

app.put('/api/employees/:id', (req, res) => {
  const id = req.params.id;
  if (!ID.test(id)) return res.status(400).json({ error: 'Identificador de empleado no válido.' });
  const b = req.body || {};
  const name = S(b.name, 120);
  if (!name) return res.status(400).json({ error: 'Escribe el nombre completo del empleado.' });
  const prev = state.employees[id];
  const trainings = Array.isArray(b.trainings) ? b.trainings.slice(0, 100).map(t => ({
    id: (t && typeof t.id === 'string' && ID.test(t.id)) ? t.id : crypto.randomBytes(6).toString('hex'),
    name: S(t && t.name, 120), done: D(t && t.done), expires: D(t && t.expires),
  })).filter(t => t.name) : (prev ? prev.trainings : []);
  const emp = {
    id, name,
    position: S(b.position, 120), site: S(b.site, 120), phone: S(b.phone, 40),
    emerg: S(b.emerg, 160), notes: S(b.notes, 2000),
    birthday: D(b.birthday), hire: D(b.hire),
    trainings,
    docs: prev ? prev.docs : [],
    createdAt: prev ? prev.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.employees[id] = emp;
  persist();
  res.json(publicEmp(emp));
});

app.delete('/api/employees/:id', (req, res) => {
  const e = state.employees[req.params.id];
  if (!e) return res.json({ ok: true });
  (e.docs || []).forEach(d => fs.rm(path.join(UPLOAD_DIR, d.stored), { force: true }, () => {}));
  delete state.employees[req.params.id];
  persist();
  res.json({ ok: true });
});

/* ---- documents ---- */
const TYPES = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + (path.extname(file.originalname).toLowerCase() || '')),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (TYPES[ext]) return cb(null, true);
    cb(Object.assign(new Error('Sube un PDF o una foto (JPG, PNG). Los archivos de Word guárdalos primero como PDF.'), { status: 400 }));
  },
});

app.post('/api/employees/:id/docs', (req, res) => {
  const e = state.employees[req.params.id];
  if (!e) return res.status(404).json({ error: 'Guarda primero los datos del empleado.' });
  upload.single('file')(req, res, err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo pesa más de 20 MB. Escanéalo con menor resolución e inténtalo de nuevo.' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Elige un archivo para subir.' });
    const ext = path.extname(req.file.originalname).toLowerCase();
    const doc = {
      id: crypto.randomBytes(10).toString('hex'),
      type: S(req.body.type, 60) || 'Otro',
      fileName: S(req.file.originalname, 160),
      size: req.file.size,
      mime: TYPES[ext],
      stored: req.file.filename,
      uploadedAt: new Date().toISOString(),
    };
    e.docs = (e.docs || []).concat(doc);
    e.updatedAt = doc.uploadedAt;
    persist();
    res.json(publicEmp(e));
  });
});

app.delete('/api/employees/:id/docs/:docId', (req, res) => {
  const e = state.employees[req.params.id];
  if (!e) return res.status(404).json({ error: 'No se encontró el empleado.' });
  const d = (e.docs || []).find(x => x.id === req.params.docId);
  if (d) {
    fs.rm(path.join(UPLOAD_DIR, d.stored), { force: true }, () => {});
    e.docs = e.docs.filter(x => x !== d);
    persist();
  }
  res.json(publicEmp(e));
});

app.get('/files/:docId', (req, res) => {
  for (const e of Object.values(state.employees)) {
    const d = (e.docs || []).find(x => x.id === req.params.docId);
    if (d) {
      res.set('Content-Type', d.mime);
      res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.fileName)}`);
      return res.sendFile(path.join(UPLOAD_DIR, d.stored), err => { if (err && !res.headersSent) res.status(404).send('No se encontró el archivo.'); });
    }
  }
  res.status(404).send('No se encontró el archivo.');
});

/* ---- downloadable reports ---- */
const reports = require('./reports');
const empList = () => Object.values(state.employees);
app.get('/reports/weekly.pdf', (req, res) => {
  const w = [30, 60, 90].includes(+req.query.days) ? +req.query.days : 60;
  reports.weekly(res, empList(), w);
});
app.get('/reports/past-due.pdf', (req, res) => reports.pastDue(res, empList()));
app.get('/reports/calendar.pdf', (req, res) => {
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month || '') ? req.query.month : reports.todayISO().slice(0, 7);
  reports.calendar(res, empList(), m);
});

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: 'Ocurrió un error en el servidor.' }); });

app.listen(PORT, () => console.log(`AVE Staff Records on port ${PORT}, data in ${DATA_DIR}`));

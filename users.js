'use strict';
/* Extra logins with roles. The original admin (ADMIN_USER) keeps full access and lives in db.json.
   Roles: admin = everything; contador = Contabilidad (edit); consulta = Contabilidad (read only);
   personal = Expedientes del personal only. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROLES = { admin: 'Administrador', contador: 'Contador', consulta: 'Consulta', personal: 'Personal' };
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');

module.exports = function users(DATA_DIR) {
  const file = path.join(DATA_DIR, 'users.json');
  let list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const save = () => { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(list, null, 1)); fs.renameSync(t, file); };
  const pub = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, roleLabel: ROLES[u.role], active: u.active, created: u.created, lastLogin: u.lastLogin || null });
  const norm = s => String(s || '').trim().toLowerCase();

  function setPw(u, pw) {
    if (typeof pw !== 'string' || pw.length < 10) { const e = new Error('La contraseña debe tener al menos 10 caracteres.'); e.status = 400; throw e; }
    u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(pw, u.salt); u.ver = crypto.randomBytes(8).toString('hex');
  }
  return {
    ROLES,
    list: () => list.map(pub),
    get: id => list.find(u => u.id === id),
    pub,
    create({ username, name, role, password }, reserved) {
      username = norm(username);
      const bad = m => { const e = new Error(m); e.status = 400; return e; };
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw bad('El usuario debe tener de 3 a 32 letras, números, punto, guion o guion bajo.');
      if (username === norm(reserved) || list.some(u => u.username === username)) throw bad('Ese usuario ya existe.');
      if (!ROLES[role]) throw bad('Elige un rol válido.');
      const u = { id: crypto.randomBytes(6).toString('hex'), username, name: String(name || username).trim().slice(0, 80), role, active: true, created: new Date().toISOString() };
      setPw(u, password);
      list.push(u); save(); return pub(u);
    },
    update(id, { name, role, active, password }) {
      const u = list.find(x => x.id === id);
      if (!u) { const e = new Error('No se encontró el usuario.'); e.status = 404; throw e; }
      if (name != null) u.name = String(name).trim().slice(0, 80) || u.username;
      if (role != null) { if (!ROLES[role]) { const e = new Error('Elige un rol válido.'); e.status = 400; throw e; } u.role = role; u.ver = crypto.randomBytes(8).toString('hex'); }
      if (active != null) { u.active = !!active; u.ver = crypto.randomBytes(8).toString('hex'); }
      if (password) setPw(u, password);
      save(); return pub(u);
    },
    check(username, pw) {
      const u = list.find(x => x.username === norm(username));
      // always spend the hashing time so a wrong username is not faster than a wrong password
      const salt = u ? u.salt : '00', got = Buffer.from(hash(String(pw || ''), salt), 'hex');
      if (!u || !u.active) return null;
      if (!crypto.timingSafeEqual(got, Buffer.from(u.hash, 'hex'))) return null;
      u.lastLogin = new Date().toISOString(); save();
      return u;
    },
    changeOwn(id, current, next) {
      const u = list.find(x => x.id === id);
      if (!u || !crypto.timingSafeEqual(Buffer.from(hash(String(current || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'))) { const e = new Error('La contraseña actual no es correcta.'); e.status = 400; throw e; }
      setPw(u, next); save(); return u;
    },
  };
};

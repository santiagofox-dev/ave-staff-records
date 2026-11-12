'use strict';
/* Usuarios y permisos (admin only): who can sign in and which tools each role opens. */
(() => {
  const $ = s => document.querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (['value', 'checked', 'selected', 'disabled'].includes(k)) el[k] = v; else el.setAttribute(k, v); }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const ROLE_INFO = {
    admin: { label: 'Administrador', desc: 'Acceso completo, incluida la creación de usuarios.', tools: ['Expedientes', 'Comidas', 'Contabilidad', 'Usuarios'] },
    personal: { label: 'Personal', desc: 'Solo expedientes del personal: empleados, documentos, capacitaciones y cumpleaños.', tools: ['Expedientes'] },
    contador: { label: 'Contador', desc: 'Contabilidad completa: captura, publica, registra pagos y cierra periodos.', tools: ['Contabilidad'] },
    consulta: { label: 'Consulta', desc: 'Contabilidad de solo lectura: ve y descarga reportes.', tools: ['Contabilidad'] },
  };
  const ALL = ['Expedientes', 'Comidas', 'Contabilidad', 'Usuarios'];
  const api = async (m, u, b) => { const r = await (window.aveFetch || fetch)(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); if (r.status === 401) location.href = '/login'; const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Error ' + r.status); return j; };
  let tt; const toast = m => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 3000); };
  const when = s => s ? new Date(s).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Nunca';

  $('#roles').append(...Object.entries(ROLE_INFO).map(([k, r]) => h('div', { class: 'role r-' + k }, h('b', {}, r.label), h('p', {}, r.desc), h('div', { class: 'tools' }, ALL.map(t => h('span', { class: r.tools.includes(t) ? '' : 'no' }, t))))));

  let roles = {};
  async function load() {
    let d;
    try { d = await api('GET', '/api/acc/users'); } catch (e) { $('#list').textContent = e.message; return; }
    roles = d.roles;
    const rows = [{ owner: true, name: d.owner, username: d.owner, role: 'admin', active: true }, ...d.users];
    const t = h('table', { class: 'ut' }, h('thead', {}, h('tr', {}, ['Usuario', 'Rol', 'Puede abrir', 'Último acceso', 'Estado'].map((x, i) => h('th', { class: i === 2 || i === 3 ? 'hide-s' : '' }, x)))),
      h('tbody', {}, rows.map(u => {
        const tr = h('tr', { class: u.owner ? '' : 'click' },
          h('td', {}, h('div', { class: 'who2' }, h('div', { class: 'av r-' + u.role }, String(u.name || u.username).charAt(0).toUpperCase()), h('div', {}, h('div', {}, u.name + (u.owner ? ' (dueño)' : '')), h('div', { class: 'sub' }, u.username)))),
          h('td', {}, (ROLE_INFO[u.role] || {}).label || u.role),
          h('td', { class: 'hide-s' }, ((ROLE_INFO[u.role] || {}).tools || []).join(', ')),
          h('td', { class: 'hide-s sub' }, u.owner ? '—' : when(u.lastLogin)),
          h('td', {}, h('span', { class: 'pill ' + (u.active ? 'on' : 'off') }, u.active ? 'Activo' : 'Desactivado')));
        if (!u.owner) tr.addEventListener('click', () => edit(u));
        return tr;
      })));
    $('#list').replaceWith(Object.assign(t, { id: 'list' }));
  }

  function edit(u) {
    const f = $('#uform'); f.replaceChildren();
    const v = u ? { name: u.name, role: u.role, active: u.active, password: '' } : { username: '', name: '', role: 'personal', password: '' };
    const err = h('div', { class: 'err', role: 'alert' });
    const roleSel = h('select', { onchange: e => { v.role = e.target.value; hint.textContent = ROLE_INFO[v.role].desc; } }, Object.keys(ROLE_INFO).map(k => h('option', { value: k, selected: k === v.role }, ROLE_INFO[k].label)));
    const hint = h('p', { class: 'hint' }, ROLE_INFO[v.role].desc);
    f.append(h('h2', {}, u ? 'Editar usuario' : 'Nuevo usuario'),
      u ? h('label', {}, 'Usuario', h('input', { value: u.username, disabled: true })) : h('label', {}, 'Usuario (para entrar)', h('input', { autocomplete: 'off', placeholder: 'maria.lopez', oninput: e => { v.username = e.target.value; } })),
      h('label', {}, 'Nombre', h('input', { value: v.name, oninput: e => { v.name = e.target.value; } })),
      h('label', {}, 'Rol', roleSel), hint,
      h('label', {}, u ? 'Nueva contraseña (déjala vacía para no cambiarla)' : 'Contraseña inicial (mínimo 10 caracteres)', h('input', { type: 'password', autocomplete: 'new-password', oninput: e => { v.password = e.target.value; } })),
      u ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.active, onchange: e => { v.active = e.target.checked; } }), 'Activo (puede entrar)') : null,
      err,
      h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => $('#dlg').close() }, 'Cancelar'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          err.textContent = '';
          try { if (u) await api('PUT', '/api/acc/users/' + u.id, v); else await api('POST', '/api/acc/users', v); $('#dlg').close(); toast(u ? 'Usuario actualizado.' : 'Usuario creado. Ya puede entrar.'); load(); }
          catch (e) { err.textContent = e.message; }
        } }, 'Guardar')));
    $('#dlg').showModal();
  }
  $('#newUser').addEventListener('click', () => edit(null));
  load();
})();

'use strict';
/* Supplier portal: sign in, choose Jabil B1 or B3, upload invoice + delivery-receipt photo, see own invoices, change password. */
(() => {
  const $ = s => document.querySelector(s);
  const parts = location.pathname.split('/').filter(Boolean);
  const token = parts[0] === 'proveedor' ? parts[1] : '';
  const NF = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const fd = s => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
  function h(tag, attrs, ...kids) { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) { if (k === 'class') el.className = v; else el.setAttribute(k, v); } for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c)); return el; }
  const api = async (m, u, body) => { const r = await fetch(u, { method: m, cache: 'no-store', headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Error'); e.status = r.status; throw e; } return j; };
  const show = (...ids) => { for (const id of ['login', 'hello', 'form', 'mine', 'acct', 'done']) $('#' + id).hidden = !ids.includes(id); };

  async function showLogin(msg) {
    show('login');
    if (token) {
      try { const h2 = await api('GET', '/api/portal/hint/' + encodeURIComponent(token)); $('#lgFor').textContent = 'Portal de proveedores · Grupo AVE'; $('#lgName').textContent = h2.name; if (h2.username) $('#lgUser').value = h2.username; }
      catch (e) { /* invalid link: plain sign-in */ }
    }
    $('#lgErr').textContent = msg || '';
    ($('#lgUser').value ? $('#lgPw') : $('#lgUser')).focus();
  }
  $('#lgForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#lgErr').textContent = '';
    try { await api('POST', '/api/portal/login', { username: $('#lgUser').value, password: $('#lgPw').value }); $('#lgPw').value = ''; load(); }
    catch (err) { $('#lgErr').textContent = err.message; }
  });

  async function load() {
    let d;
    try { d = await api('GET', '/api/portal/me'); }
    catch (e) { return showLogin(e.status === 401 ? '' : e.message); }
    show('hello', 'form', 'mine', 'acct');
    $('#hello').replaceChildren(h('div', { class: 'pv-who' }, h('span', {}, 'Usuario: ' + d.vendor.username), h('button', { type: 'button', id: 'out2' }, 'Salir')),
      h('div', { class: 'eyebrow' }, 'Proveedor de ' + d.company.name), h('h1', {}, d.vendor.name), h('p', {}, d.vendor.rfc ? 'RFC ' + d.vendor.rfc : 'Tu RFC se registra con tu primera factura.'),
      h('span', { class: 'pv-terms' }, d.vendor.terms ? `Crédito: ${d.vendor.terms} días desde que recibimos tu factura` : 'Pago de contado'),
      d.vendor.test ? h('div', {}, h('span', { class: 'pv-test' }, 'Cuenta de prueba')) : null);
    $('#out2').addEventListener('click', logout);
    $('#list').replaceChildren(...(d.docs.length ? d.docs.map(x => h('div', { class: 'pv-inv' },
      h('span', { class: 'f' }, 'Factura ' + (x.folio || '—') + (x.plant ? ' · Jabil ' + x.plant : '')), h('span', { class: 't' }, NF.format(x.total)),
      h('span', { class: 'm' }, `Recibida ${fd(x.received)}` + (x.status.key === 'pagada' ? '' : ` · vence ${fd(x.due)}`)), h('span', { class: 'pv-st ' + x.status.key }, x.status.label))) : [h('p', { class: 'pv-empty' }, 'Aún no has subido facturas.')]));
  }
  async function logout() { try { await api('POST', '/api/portal/logout'); } catch (e) {} $('#lgPw').value = ''; showLogin(); }
  $('#logout').addEventListener('click', logout);

  const fact = $('#fact'), rec = $('#rec');
  const plant = () => (document.querySelector('input[name=plant]:checked') || {}).value || '';
  function refresh() {
    const fs = [...fact.files], rs = [...rec.files];
    $('#factList').replaceChildren(...fs.map(f => h('li', {}, '📄 ' + f.name)));
    $('#factTxt').textContent = fs.length ? `${fs.length} archivo${fs.length > 1 ? 's' : ''} · cambiar` : 'Elegir XML / PDF';
    $('#factTxt').parentElement.classList.toggle('ok', !!fs.length);
    $('#recTxt').textContent = rs.length ? `${rs.length} foto${rs.length > 1 ? 's' : ''} · cambiar` : 'Tomar o elegir foto';
    $('#recTxt').parentElement.classList.toggle('ok', !!rs.length);
    const th = $('#thumbs'); th.replaceChildren();
    for (const f of rs.slice(0, 4)) { const img = h('img', { alt: 'Foto del recibo' }); const r = new FileReader(); r.onload = () => { img.src = r.result; }; r.readAsDataURL(f); th.append(img); }
    $('#send').disabled = !(plant() && fs.length && rs.length);
    $('#send').textContent = plant() ? `Enviar factura para Jabil ${plant()}` : 'Enviar factura';
    $('#err').textContent = '';
  }
  fact.addEventListener('change', refresh); rec.addEventListener('change', refresh);
  document.querySelectorAll('input[name=plant]').forEach(r => r.addEventListener('change', refresh));

  $('#form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!plant()) { $('#err').textContent = 'Elige si la factura es para Jabil B1 o Jabil B3.'; return; }
    if (!fact.files.length) { $('#err').textContent = 'Falta la factura (XML o PDF).'; return; }
    if (!rec.files.length) { $('#err').textContent = 'Falta la foto del recibo de entrega.'; return; }
    const body = new FormData(); body.append('plant', plant());
    for (const f of fact.files) body.append('factura', f, f.name);
    for (const f of rec.files) body.append('recibo', f, f.name || 'recibo.jpg');
    const btn = $('#send'); btn.disabled = true; btn.textContent = 'Enviando…';
    const done = $('#done');
    try {
      const j = await api('POST', '/api/portal/upload', body);
      const ok = j.created.length;
      done.className = 'pv-done ' + (ok ? 'ok' : 'bad');
      done.replaceChildren(h('b', {}, ok ? `¡Listo! Recibimos ${ok} factura${ok > 1 ? 's' : ''} para ${j.plant}.` : 'No se registró ninguna factura.'),
        ok ? h('ul', {}, j.created.map(c => h('li', {}, `Factura ${c.folio || ''} por ${NF.format(c.total)} · vence ${fd(c.due)}`))) : null,
        j.duplicates ? h('div', {}, `${j.duplicates} ya la habías subido antes.`) : null,
        j.pdfOnly ? h('div', {}, 'Recibimos el PDF sin XML: por favor súbenos también el XML.') : null,
        ...j.errors.map(x => h('div', {}, '⚠ ' + x)), ...j.skipped.map(x => h('div', {}, x)));
      done.hidden = false;
      if (ok) { fact.value = ''; rec.value = ''; document.querySelectorAll('input[name=plant]').forEach(r => { r.checked = false; }); refresh(); }
      await load(); done.hidden = false; done.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) { if (err.status === 401) return showLogin(err.message); $('#err').textContent = err.message; }
    finally { refresh(); }
  });

  $('#pwForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#pwErr').textContent = '';
    try { await api('POST', '/api/portal/password', { current: $('#pwCur').value, next: $('#pwNew').value }); $('#pwCur').value = ''; $('#pwNew').value = ''; $('#pwErr').textContent = ''; alertOk(); }
    catch (err) { $('#pwErr').textContent = err.message; }
  });
  function alertOk() { const d = $('#done'); d.className = 'pv-done ok'; d.replaceChildren(h('b', {}, 'Contraseña cambiada.'), h('div', {}, 'Úsala la próxima vez que entres.')); d.hidden = false; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  load();
})();

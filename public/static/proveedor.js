'use strict';
/* Supplier portal: sign in, choose the plant (any of ours), upload invoice + delivery-receipt photo, see own invoices, change password. */
(() => {
  const $ = s => document.querySelector(s);
  const parts = location.pathname.split('/').filter(Boolean);
  const token = parts[0] === 'proveedor' ? parts[1] : '';
  const NF = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const fd = s => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
  function h(tag, attrs, ...kids) {
    kids = kids.flat(Infinity).filter(k => k != null && k !== false && k !== ''); const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) { if (k === 'class') el.className = v; else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); } for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c)); return el; }
  const api = async (m, u, body) => { const r = await (window.aveFetch || fetch)(u, { method: m, cache: 'no-store', headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Error'); e.status = r.status; throw e; } return j; };
  const show = (...ids) => { for (const id of ['login', 'hello', 'form', 'mine', 'acct', 'done', 'toReview']) $('#' + id).hidden = !ids.includes(id); };
  // replaceChildren() prints null as the text "null": drop empty pieces first
  const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false && k !== ''));

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
    if (window.__plantButtons) window.__plantButtons(d.plantGroups || [{ city: '', plants: d.plants || [] }]);
    put($('#hello'), h('div', { class: 'pv-who' }, h('span', {}, 'Usuario: ' + d.vendor.username), h('button', { type: 'button', id: 'out2' }, 'Salir')),
      h('div', { class: 'eyebrow' }, 'Proveedor de ' + d.company.name), h('h1', {}, d.vendor.name), h('p', {}, d.vendor.rfc ? 'RFC ' + d.vendor.rfc : 'Tu RFC se registra con tu primera factura.'),
      h('span', { class: 'pv-terms' }, d.vendor.terms ? `Crédito: ${d.vendor.terms} días desde que recibimos tu factura` : 'Pago de contado'),
      d.vendor.test ? h('div', {}, h('span', { class: 'pv-test' }, 'Cuenta de prueba')) : null);
    $('#out2').addEventListener('click', logout);
    const pending = d.docs.filter(x => x.review && x.review.status === 'pending');
    put($('#toReview'), pending.length ? h('h2', {}, `Facturas por confirmar (${pending.length})`) : null, pending.length ? h('p', { class: 'pv-fine' }, 'Confírmalas con la foto de su recibo de entrega para que entren a pago.') : null, ...pending.map(x => reviewCard(x)));
    $('#toReview').hidden = !pending.length;
    $('#list').replaceChildren(...(d.docs.length ? d.docs.map(x => h('div', { class: 'pv-inv' },
      h('span', { class: 'f' }, 'Factura ' + (x.folio || '—') + (x.plant ? ' · ' + x.plant : '')), h('span', { class: 't' }, NF.format(x.total)),
      h('span', { class: 'm' }, `Recibida ${fd(x.received)}` + (x.status.key === 'pagada' ? '' : ` · vence ${fd(x.due)}`),
        x.review && x.review.status === 'ok' ? ' · confirmada por ti' : x.review && x.review.status === 'disputed' ? ' · reportaste diferencia' : null),
      h('span', { class: 'pv-st ' + x.status.key }, x.review && x.review.status === 'pending' ? 'Por confirmar' : x.status.label))) : [h('p', { class: 'pv-empty' }, 'Aún no has subido facturas.')]));
  }
  async function logout() { try { await api('POST', '/api/portal/logout'); } catch (e) {} $('#lgPw').value = ''; showLogin(); }
  $('#logout').addEventListener('click', logout);

  const fact = $('#fact'), rec = $('#rec');
  const plant = () => (document.querySelector('input[name=plant]:checked') || {}).value || '';
  function refresh() {
    const fs = [...fact.files], rs = [...rec.files];
    $('#factList').replaceChildren(...fs.map(f => h('li', {}, f.name)));
    $('#factTxt').textContent = fs.length ? `${fs.length} archivo${fs.length > 1 ? 's' : ''} · cambiar` : 'Elegir XML / PDF';
    $('#factTxt').parentElement.classList.toggle('ok', !!fs.length);
    $('#recTxt').textContent = rs.length ? `${rs.length} foto${rs.length > 1 ? 's' : ''} · cambiar` : 'Tomar o elegir foto';
    $('#recTxt').parentElement.classList.toggle('ok', !!rs.length);
    const th = $('#thumbs'); th.replaceChildren();
    for (const f of rs.slice(0, 4)) { const img = h('img', { alt: 'Foto del recibo' }); const r = new FileReader(); r.onload = () => { img.src = r.result; }; r.readAsDataURL(f); th.append(img); }
    $('#send').disabled = !(plant() && fs.length && rs.length);
    $('#send').textContent = plant() ? `Enviar factura para ${plant()}` : 'Enviar factura';
    $('#err').textContent = '';
  }
  fact.addEventListener('change', refresh); rec.addEventListener('change', refresh);
  // plant buttons: every plant we serve, grouped by city
  function plantButtons(groups) {
    const box = document.querySelector('.pv-plants'), cur = plant(), all = groups.flatMap(g => g.plants);
    const btn = p => { const i = h('input', { type: 'radio', name: 'plant', value: p }); if (p === cur || all.length === 1) i.checked = true; i.addEventListener('change', refresh); return h('label', { class: 'pv-plant' }, i, h('span', {}, h('strong', {}, p))); };
    box.replaceChildren(...groups.map(g => h('div', { class: 'pv-city' }, g.city ? h('div', { class: 'pv-cityname' }, g.city) : null, h('div', { class: 'pv-cityplants' }, g.plants.map(btn)))));
    $('#plantRule').hidden = all.length < 2;
    refresh();
  }
  window.__plantButtons = plantButtons;

  $('#form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!plant()) { $('#err').textContent = 'Elige la planta de esta factura.'; return; }
    if (!fact.files.length) { $('#err').textContent = 'Falta la factura (XML o PDF).'; return; }
    if (!rec.files.length) { $('#err').textContent = 'Falta la foto del recibo de entrega.'; return; }
    const body = new FormData(); body.append('plant', plant());
    for (const f of fact.files) body.append('factura', f, f.name);
    for (const f of rec.files) body.append('recibo', f, f.name || 'recibo.jpg');
    const btn = $('#send'); btn.disabled = true; btn.textContent = 'Enviando…';
    const done = $('#done');
    try {
      const j = await api('POST', '/api/portal/upload', body);
      const ok = j.created.length, rv = (j.review || []).length;
      done.className = 'pv-done ' + (ok || rv ? 'ok' : 'bad');
      put(done, h('b', {}, ok ? `¡Listo! Recibimos ${ok} factura${ok > 1 ? 's' : ''} para ${j.plant}.` : rv ? `Ya teníamos ${rv === 1 ? 'esta factura' : 'estas facturas'} registrada${rv === 1 ? '' : 's'}.` : 'No se registró ninguna factura.'),
        ok ? h('ul', {}, j.created.map(c => h('li', {}, `Factura ${c.folio || ''} por ${NF.format(c.total)} · vence ${fd(c.due)}`))) : null,
        rv ? h('div', {}, 'Guardamos tu foto del recibo. Revisa abajo los datos que tenemos y confirma si coinciden.') : null,
        j.duplicates && !rv ? h('div', {}, `${j.duplicates === 1 ? 'Esta factura ya' : j.duplicates + ' facturas ya'} estaba${j.duplicates === 1 ? '' : 'n'} registrada${j.duplicates === 1 ? '' : 's'}.`) : null,
        j.pdfOnly ? h('div', {}, 'Recibimos el PDF sin XML: por favor súbenos también el XML.') : null,
        ...j.errors.map(x => h('div', {}, 'Aviso: ' + x)), ...j.skipped.map(x => h('div', {}, x)));
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
  // Card asking the supplier to confirm an invoice we already had; the delivery-receipt photo is required to confirm
  function reviewCard(x) {
    const mine = plant();
    const rows = [['Folio', x.folio], ['Fecha', fd(x.date)], ['Subtotal', NF.format(x.subtotal)], ['IVA', NF.format(x.iva)], x.retenciones ? ['Retenciones', NF.format(x.retenciones)] : null, ['Total', NF.format(x.total)], ['Planta', x.plant || 'Sin planta asignada'], ['Vence', fd(x.due)]].filter(Boolean);
    const err = h('div', { class: 'pv-err' }), why = h('textarea', { rows: '3', placeholder: 'Ej. el total es otro, la fecha no es esa, es para otra planta…' });
    why.hidden = true;
    const id = 'rv' + x.id;
    const photo = h('input', { type: 'file', id, accept: 'image/*', capture: 'environment', multiple: 'multiple', class: 'pv-hidden' });
    const thumbs = h('div', { class: 'pv-thumbs' });
    const pick = h('label', { class: 'pv-pick cam', for: id }, h('span', {}, 'Tomar o elegir foto del recibo'));
    photo.addEventListener('change', () => {
      thumbs.replaceChildren();
      for (const f of [...photo.files].slice(0, 4)) { const img = h('img', { alt: 'Foto del recibo' }); const r = new FileReader(); r.onload = () => { img.src = r.result; }; r.readAsDataURL(f); thumbs.append(img); }
      pick.classList.toggle('ok', photo.files.length > 0); pick.firstChild.textContent = photo.files.length ? `${photo.files.length} foto${photo.files.length > 1 ? 's' : ''} · cambiar` : 'Tomar o elegir foto del recibo';
      err.textContent = '';
    });
    const send = async (ok) => {
      if (ok && !x.hasReceipt && !photo.files.length) { err.textContent = 'Falta la foto del recibo de entrega de esta factura.'; return; }
      if (!ok && !why.value.trim()) { err.textContent = 'Escribe qué no coincide.'; return; }
      const body = new FormData(); body.append('id', x.id); body.append('ok', ok ? 'true' : 'false'); body.append('plant', (x.review && x.review.plant) || mine || ''); body.append('comment', why.value);
      for (const f of photo.files) body.append('recibo', f, f.name || 'recibo.jpg');
      try {
        await api('POST', '/api/portal/review', body);
        card.replaceWith(ok ? h('div', { class: 'pv-done ok' }, h('b', {}, `Factura ${x.folio} confirmada.`), h('div', {}, '¡Gracias! Quedó marcada como correcta con su foto del recibo.')) : h('div', { class: 'pv-done bad' }, h('b', {}, `Reportaste una diferencia en la factura ${x.folio}.`), h('div', {}, 'Grupo AVE la va a revisar.')));
        load();
      } catch (e) { err.textContent = e.message; }
    };
    const card = h('div', { class: 'pv-review' },
      h('b', {}, `Confirma la factura ${x.folio}`),
      h('p', {}, 'Grupo AVE ya tiene registrada esta factura. Revisa que los datos coincidan con tu factura y sube la foto del recibo de entrega firmado o sellado.'),
      h('dl', { class: 'pv-dl' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))])),
      x.review && x.review.plant && x.plant && x.review.plant !== x.plant ? h('div', { class: 'pv-warn' }, `Tú elegiste ${x.review.plant}, pero la tenemos en ${x.plant}.`) : null,
      x.hasReceipt ? h('div', { class: 'pv-okline' }, 'Ya tenemos tu foto del recibo de esta factura.') : [h('div', { class: 'pv-req' }, 'Foto del recibo de entrega ', h('em', {}, 'obligatoria')), pick, photo, thumbs],
      why, err,
      h('div', { class: 'pv-row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => send(true) }, 'Sí, los datos coinciden'),
        h('button', { class: 'btn', type: 'button', onclick: e => { if (why.hidden) { why.hidden = false; why.focus(); e.target.textContent = 'Enviar diferencia'; return; } send(false); } }, 'No coincide')));
    return card;
  }
  function alertOk() { const d = $('#done'); d.className = 'pv-done ok'; put(d, h('b', {}, 'Contraseña cambiada.'), h('div', {}, 'Úsala la próxima vez que entres.')); d.hidden = false; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  load();
})();

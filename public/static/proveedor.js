'use strict';
/* Supplier portal page: upload invoice + delivery-receipt photo, see own invoices. */
(() => {
  const $ = s => document.querySelector(s);
  const token = location.pathname.split('/').filter(Boolean).pop();
  const NF = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const fd = s => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
  function h(tag, attrs, ...kids) { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) { if (k === 'class') el.className = v; else el.setAttribute(k, v); } for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c)); return el; }

  async function load() {
    let d;
    try { const r = await fetch('/api/portal/' + encodeURIComponent(token), { cache: 'no-store' }); d = await r.json(); if (!r.ok) throw new Error(d.error); }
    catch (e) { $('#hello').replaceChildren(h('h1', {}, 'Enlace no válido'), h('p', {}, e.message || 'No se pudo abrir el portal.')); return; }
    $('#hello').replaceChildren(h('div', { class: 'eyebrow' }, 'Proveedor de ' + d.company.name), h('h1', {}, d.vendor.name), h('p', {}, d.vendor.rfc ? 'RFC ' + d.vendor.rfc : 'Tu RFC se registra con tu primera factura.'),
      h('span', { class: 'pv-terms' }, d.vendor.terms ? `Crédito: ${d.vendor.terms} días desde que recibimos tu factura` : 'Pago de contado'));
    $('#form').hidden = false; $('#mine').hidden = false;
    $('#list').replaceChildren(...(d.docs.length ? d.docs.map(x => h('div', { class: 'pv-inv' },
      h('span', { class: 'f' }, 'Factura ' + (x.folio || '—')), h('span', { class: 't' }, NF.format(x.total)),
      h('span', { class: 'm' }, `Recibida ${fd(x.received)}` + (x.status.key === 'pagada' ? '' : ` · vence ${fd(x.due)}`)), h('span', { class: 'pv-st ' + x.status.key }, x.status.label))) : [h('p', { class: 'pv-empty' }, 'Aún no has subido facturas.')]));
  }

  const fact = $('#fact'), rec = $('#rec');
  function refresh() {
    const fs = [...fact.files], rs = [...rec.files];
    $('#factList').replaceChildren(...fs.map(f => h('li', {}, '📄 ' + f.name)));
    $('#factTxt').textContent = fs.length ? `${fs.length} archivo${fs.length > 1 ? 's' : ''} · cambiar` : 'Elegir XML / PDF';
    $('#factTxt').parentElement.classList.toggle('ok', !!fs.length);
    $('#recTxt').textContent = rs.length ? `${rs.length} foto${rs.length > 1 ? 's' : ''} · cambiar` : 'Tomar o elegir foto';
    $('#recTxt').parentElement.classList.toggle('ok', !!rs.length);
    const th = $('#thumbs'); th.replaceChildren();
    for (const f of rs.slice(0, 4)) { const img = h('img', { alt: 'Foto del recibo' }); const r = new FileReader(); r.onload = () => { img.src = r.result; }; r.readAsDataURL(f); th.append(img); }
    $('#send').disabled = !(fs.length && rs.length);
    $('#err').textContent = '';
  }
  fact.addEventListener('change', refresh); rec.addEventListener('change', refresh);

  $('#form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!fact.files.length) { $('#err').textContent = 'Falta la factura (XML o PDF).'; return; }
    if (!rec.files.length) { $('#err').textContent = 'Falta la foto del recibo de entrega.'; return; }
    const body = new FormData();
    for (const f of fact.files) body.append('factura', f, f.name);
    for (const f of rec.files) body.append('recibo', f, f.name || 'recibo.jpg');
    const btn = $('#send'); btn.disabled = true; btn.textContent = 'Enviando…';
    const done = $('#done');
    try {
      const r = await fetch('/api/portal/' + encodeURIComponent(token) + '/upload', { method: 'POST', body });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'No se pudo enviar.');
      const ok = j.created.length;
      done.className = 'pv-done ' + (ok ? 'ok' : 'bad');
      done.replaceChildren(h('b', {}, ok ? `¡Listo! Recibimos ${ok} factura${ok > 1 ? 's' : ''}.` : 'No se registró ninguna factura.'),
        ok ? h('ul', {}, j.created.map(c => h('li', {}, `Factura ${c.folio || ''} por ${NF.format(c.total)} · vence ${fd(c.due)}`))) : null,
        j.duplicates ? h('div', {}, `${j.duplicates} ya la habías subido antes.`) : null,
        j.pdfOnly ? h('div', {}, 'Recibimos el PDF sin XML: por favor súbenos también el XML.') : null,
        ...j.errors.map(x => h('div', {}, '⚠ ' + x)), ...j.skipped.map(x => h('div', {}, x)));
      done.hidden = false;
      if (ok) { fact.value = ''; rec.value = ''; refresh(); }
      load(); done.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) { $('#err').textContent = err.message; }
    finally { btn.textContent = 'Enviar factura'; btn.disabled = !(fact.files.length && rec.files.length); }
  });
  load();
})();

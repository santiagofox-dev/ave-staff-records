'use strict';
/* Contabilidad Grupo AVE — single page app (hash routes). No inline styles or scripts (CSP). */
(() => {
  const $ = s => document.querySelector(s);
  const main = $('#main');
  let META = null, ME = null, RENDER = 0;

  /* ---------- tiny DOM builder ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (['value', 'checked', 'disabled', 'selected', 'hidden', 'required', 'multiple', 'readOnly'].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) { for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k)); return el; }
  const clear = el => { while (el.firstChild) el.firstChild.remove(); return el; };

  const NF = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = n => (n == null || n === '' ? '' : NF.format(Number(n) || 0));
  const moneyK = n => { const a = Math.abs(n); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + ' M' : a >= 1e3 ? Math.round(a / 1e3) + ' k' : Math.round(a)); };
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fd = s => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
  const fts = s => { if (!s) return ''; const d = new Date(s); return d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }); };
  const monthName = m => `${MES[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;
  const today = () => META ? META.today : new Date().toISOString().slice(0, 10);
  const firstOfMonth = () => today().slice(0, 8) + '01';
  const firstOfYear = () => today().slice(0, 5) + '01-01';
  const STATE = { draft: 'Borrador', posted: 'Publicado', cancelled: 'Cancelado', erased: 'Eliminada' };
  const fdt = s => { try { return new Date(s).toLocaleString('es-MX', { timeZone: 'America/Ciudad_Juarez', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return s; } };
  const PAY = { pagado: 'Pagado', parcial: 'Parcial', vencido: 'Vencido', pendiente: 'Pendiente' };
  const FORMAS = { '01': 'Efectivo', '02': 'Cheque', '03': 'Transferencia', '04': 'Tarjeta de crédito', '28': 'Tarjeta de débito', '17': 'Compensación', '99': 'Por definir' };
  const badge = (cls, txt) => h('span', { class: 'badge ' + cls }, txt);
  const canEdit = () => ME && ME.canEdit;

  /* ---------- API ---------- */
  async function api(method, url, body) {
    const opt = { method, headers: {} };
    if (body instanceof FormData) opt.body = body;
    else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await (window.aveFetch || fetch)(url, opt);
    if (r.status === 401) { location.href = '/login'; throw new Error('Sesión expirada.'); }
    let j = null; try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok) throw new Error((j && j.error) || `Error ${r.status}`);
    return j;
  }
  const get = u => api('GET', u), post = (u, b) => api('POST', u, b || {}), put = (u, b) => api('PUT', u, b);
  const qs = o => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  let toastT;
  function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3000); }
  async function act(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); return undefined; } }

  /* ---------- dialog ---------- */
  const dlg = $('#dlg');
  function dialog(title, body, buttons) {
    const box = clear($('#dlgBody'));
    const err = h('div', { class: 'err', role: 'alert' });
    return new Promise(resolve => {
      const close = v => { dlg.close(); resolve(v); };
      const acts = h('div', { class: 'dacts' }, (buttons || [{ label: 'Cerrar' }]).map(b => h('button', {
        class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), type: 'button',
        onclick: async () => {
          if (!b.run) return close(b.value);
          err.textContent = '';
          try { const v = await b.run(); if (v !== false) close(v === undefined ? true : v); } catch (e) { err.textContent = e.message; }
        },
      }, b.label)));
      add(box, [h('h2', {}, title), body, err, acts]);
      dlg.onclose = () => resolve(undefined);
      dlg.showModal();
    });
  }
  const confirmDlg = (title, text, label, danger) => dialog(title, h('p', {}, text), [{ label: 'Volver' }, { label, primary: !danger, danger, value: true }]);

  /* ---------- form helpers ---------- */
  const field = (label, input, cls) => h('label', { class: cls || '' }, label, input);
  const inp = (attrs) => h('input', attrs);
  const sel = (opts, value, attrs) => h('select', attrs || {}, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, t)));
  function accOptions(filter) { return META.accounts.filter(a => a.active !== false && (!filter || filter(a))).map(a => [a.code, `${a.code} ${a.name}`]); }
  function accSelect(value, attrs, filter) {
    const opts = [['', '— Cuenta —'], ...accOptions(filter)];
    if (value && !opts.some(o => o[0] === value)) opts.push([value, value + ' (inactiva)']);
    return sel(opts, value, { class: 'acc', ...(attrs || {}) });
  }
  function partnerSelect(value, kind, attrs) {
    const list = META.partners.filter(p => !kind || p[kind] || p.id === value);
    return sel([['', '— Contacto —'], ...list.map(p => [p.id, `${p.name}${p.rfc ? ' · ' + p.rfc : ''}`])], value, attrs);
  }
  const accName = code => { const a = META.accounts.find(x => x.code === code); return a ? a.name : ''; };
  async function refreshMeta() { META = await get('/api/acc/meta'); ME = META.user; }

  function phead(title, sub, actions) {
    return h('div', { class: 'phead' }, h('div', {}, h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null), h('div', { class: 'acts' }, actions || []));
  }
  function table(cols, rows, opts = {}) {
    // cols: [{ t, k | f(row), n (number), c (center), cls }]
    const head = h('tr', {}, cols.map(c => h('th', { class: c.n ? 'n' : c.c ? 'c' : '' }, c.t)));
    const body = rows.map(r => {
      const tr = h('tr', { class: [opts.rowClass ? opts.rowClass(r) : '', opts.onRow ? 'click' : ''].join(' ').trim() || null }, cols.map(c => {
        const v = c.f ? c.f(r) : r[c.k];
        return h('td', { class: [c.n ? 'n' : '', c.c ? 'c' : '', c.cls || ''].join(' ').trim() || null }, c.n && typeof v === 'number' ? money(v) : v);
      }));
      if (opts.onRow) tr.addEventListener('click', e => { if (!e.target.closest('input,button,a,select,label')) opts.onRow(r, e); });
      return tr;
    });
    const tot = opts.total ? h('tr', { class: 'tot' }, cols.map(c => { const v = opts.total[c.k || c.tk]; return h('td', { class: c.n ? 'n' : '' }, c.n && typeof v === 'number' ? money(v) : v ?? ''); })) : null;
    const t = h('table', { class: 't' }, h('thead', {}, head), h('tbody', {}, body.length ? body : h('tr', {}, h('td', { colspan: cols.length, class: 'empty2' }, opts.empty || 'No hay registros.')), tot));
    return h('div', { class: 'tw' + (opts.tall ? ' tall' : '') }, t);
  }

  /* ---------- router ---------- */
  const routes = [];
  const route = (re, fn) => routes.push([re, fn]);
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, ''); const [p, q] = raw.split('?');
    return { path: p || '', q: Object.fromEntries(new URLSearchParams(q || '')) };
  }
  const go = (p, q) => { location.hash = '#/' + p + (q && qs(q) ? '?' + qs(q) : ''); };
  async function render() {
    const { path, q } = parseHash();
    const token = ++RENDER;
    document.querySelectorAll('.nav a[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === path || (a.dataset.r && path.startsWith(a.dataset.r)) || (a.dataset.r === 'docs/ap' && /^doc\//.test(path) && last.side === 'ap') || (a.dataset.r === 'docs/ar' && /^doc\//.test(path) && last.side === 'ar')));
    $('#nav').classList.remove('open');
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (!m) continue;
      try {
        const out = await fn(m, q);
        if (token !== RENDER) return;
        clear(main); add(main, [out]); main.focus({ preventScroll: true });
      } catch (e) {
        if (token !== RENDER) return;
        clear(main); add(main, [h('div', { class: 'msg bad' }, e.message)]);
      }
      return;
    }
    go('');
  }
  const last = { side: 'ap' };

  /* ================= DASHBOARD ================= */
  route(/^$/, async () => {
    const d = await get('/api/acc/dashboard');
    const max = Math.max(1, ...d.series.map(s => Math.max(s.purchases, s.sales)));
    const bars = h('div', { class: 'bars' }, d.series.map(s => {
      const p = h('i', { class: 'p', title: `Compras ${monthName(s.month)}: ${money(s.purchases)}` }), v = h('i', { class: 's', title: `Ventas ${monthName(s.month)}: ${money(s.sales)}` });
      p.style.height = Math.max(0, s.purchases / max * 100) + '%'; v.style.height = Math.max(0, s.sales / max * 100) + '%';
      return h('div', { class: 'bar' }, p, v);
    }));
    const bankTotal = d.banks.reduce((a, b) => a + b.balance, 0);
    return h('div', { class: 'stack' },
      phead('Inicio', `${META.company.name} · RFC ${META.company.rfc}`, canEdit() ? [h('button', { class: 'btn primary', type: 'button', onclick: () => pickFiles() }, 'Importar XML / PDF')] : []),
      h('div', { class: 'kpis' },
        h('a', { class: 'kpi', href: '#/reportes/aging?side=ap' }, h('span', {}, 'Por pagar a proveedores'), h('b', {}, money(d.payable)), h('small', { class: d.payableOverdue > 0 ? 'bad' : '' }, d.payableOverdue > 0 ? `${money(d.payableOverdue)} vencido` : 'Nada vencido')),
        h('a', { class: 'kpi', href: '#/reportes/aging?side=ar' }, h('span', {}, 'Por cobrar a clientes'), h('b', {}, money(d.receivable)), h('small', { class: d.receivableOverdue > 0 ? 'bad' : '' }, d.receivableOverdue > 0 ? `${money(d.receivableOverdue)} vencido` : 'Nada vencido')),
        h('a', { class: 'kpi', href: '#/reportes/cashflow' }, h('span', {}, 'Bancos y caja'), h('b', {}, money(bankTotal)), h('small', {}, d.banks.map(b => `${b.name}: ${money(b.balance)}`).join(' · '))),
        h('a', { class: 'kpi', href: '#/docs/ap?state=draft' }, h('span', {}, 'Borradores por revisar'), h('b', {}, String(d.drafts)), h('small', {}, d.drafts ? 'Revisa y publica para que cuenten' : 'Todo publicado')),
      ),
      h('div', { class: 'cols' },
        h('section', { class: 'panel chart' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Compras y ventas, últimos 12 meses'), h('div', { class: 'legend2' }, h('span', {}, h('i', { class: 'p' }), 'Compras'), h('span', {}, h('i', { class: 's' }), 'Ventas'))),
          bars, h('div', { class: 'bar-x' }, d.series.map(s => h('span', {}, monthName(s.month)))),
          h('div', { class: 'muted small' }, 'Importes antes de impuestos, en pesos. Solo documentos publicados.')),
        h('section', { class: 'panel' }, h('h2', {}, `Resultado de ${monthName(d.month)}`),
          h('div', { class: 'totals' }, h('span', {}, 'Ingresos'), h('span', {}, money(d.pnl.income)), h('span', {}, 'Costo de venta'), h('span', {}, money(d.pnl.cost)), h('span', {}, 'Gastos'), h('span', {}, money(d.pnl.expense)), h('span', { class: 'big' }, 'Utilidad'), h('span', { class: 'big' }, money(d.pnl.net))),
          h('a', { href: '#/reportes/pnl' }, 'Ver estado de resultados →')),
      ),
      h('div', { class: 'cols' },
        h('section', { class: 'panel' }, h('h2', {}, 'Principales proveedores del mes'),
          table([{ t: 'Proveedor', k: 'label' }, { t: 'Facturas', k: 'count', n: 1 }, { t: 'Total', k: 'total', n: 1 }], d.top.map(r => ({ ...r, count: String(r.count) })), { empty: 'Sin compras publicadas este mes.' })),
        h('section', { class: 'panel' }, h('h2', {}, 'Vencen en los próximos 7 días'),
          table([{ t: 'Proveedor', k: 'partner' }, { t: 'Vence', f: r => fd(r.due) }, { t: 'Saldo', k: 'amount', n: 1 }], d.dueSoon, { empty: 'Nada por vencer esta semana.', onRow: r => go('doc/' + r.id) })),
      ),
    );
  });

  /* ================= DOCUMENT LISTS ================= */
  const listState = { ap: { state: '', pay: '', q: '', from: '', to: '', origin: '' }, ar: { state: '', pay: '', q: '', from: '', to: '', origin: '' } };
  route(/^docs\/(ap|ar)$/, async (m, q) => {
    const side = m[1]; last.side = side;
    const st = listState[side];
    for (const k of ['state', 'pay', 'q', 'from', 'to', 'partner', 'origin']) if (k in q) st[k] = q[k];
    const types = side === 'ap' ? 'in_invoice,in_refund' : 'out_invoice,out_refund';
    const data = await get('/api/acc/docs?' + qs({ type: types, ...st }));
    const selected = new Set();
    const selBar = h('div', { class: 'sel-bar', hidden: true });
    const byId = Object.fromEntries(data.rows.map(r => [r.id, r]));
    const payable = r => r.state === 'posted' && !r.type.endsWith('refund') && r.residual > 0.009;
    const updateSel = () => {
      selBar.hidden = !selected.size; clear(selBar);
      if (!selected.size) return;
      const rows = [...selected].map(id => byId[id]).filter(Boolean);
      const dr = rows.filter(r => r.state === 'draft'), op = rows.filter(payable);
      const partners = [...new Set(op.map(r => r.partnerId))];
      const owed = r2(op.reduce((a, r) => a + r.residual, 0));
      const parts = [h('b', {}, `${selected.size} seleccionadas`)];
      if (op.length) {
        parts.push(h('span', {}, `Por pagar: `, h('b', {}, money(owed))));
        if (partners.length === 1 && !dr.length) parts.push(h('button', { class: 'btn sm primary', type: 'button', onclick: () => go('pago/new/' + (side === 'ap' ? 'out' : 'in'), { partner: partners[0], docs: op.map(r => r.id).join(',') }) }, op.length > 1 ? `Pagar estas ${op.length} facturas en un pago` : 'Registrar pago'));
        else if (partners.length > 1) parts.push(h('span', { class: 'muted small' }, 'Para juntarlas en un pago elige facturas de un solo proveedor.'));
      }
      if (dr.length) {
        const accSel = accSelect('', {}, a => side === 'ap' ? ['EC', 'EX', 'ED', 'AF', 'AC', 'AN', 'AP'].includes(a.type) : ['IN', 'IO'].includes(a.type));
        parts.push(h('button', { class: 'btn sm primary', type: 'button', onclick: async () => {
          const r = await act(() => post('/api/acc/docs/bulk-post', { ids: dr.map(x => x.id) }));
          if (!r) return;
          await dialog('Resultado', h('div', { class: 'list' }, h('div', { class: 'msg ok' }, `${r.ok.length} publicados.`), r.failed.map(f => h('div', { class: 'msg bad' }, `${f.label}: ${f.error}`))));
          render();
        } }, dr.length === rows.length ? 'Publicar' : `Publicar ${dr.length} borradores`),
        h('span', { class: 'muted' }, 'Cambiar cuenta a'), accSel,
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (!accSel.value) return toast('Elige una cuenta.', true); const r = await act(() => post('/api/acc/docs/bulk-account', { ids: dr.map(x => x.id), account: accSel.value })); if (r) { toast(`${r.updated} borradores actualizados.`); render(); } } }, 'Aplicar'));
      }
      parts.push(h('button', { class: 'btn sm quiet', type: 'button', onclick: () => { selected.clear(); render(); } }, 'Quitar selección'));
      add(selBar, parts);
    };
    const pickable = r => r.state === 'draft' || payable(r);
    const picks = data.rows.filter(pickable);
    const allBox = canEdit() && picks.length ? inp({ type: 'checkbox', title: 'Seleccionar todos (borradores y por pagar)', onchange: e => { picks.forEach(r => e.target.checked ? selected.add(r.id) : selected.delete(r.id)); document.querySelectorAll('input[data-sel]').forEach(b => { b.checked = e.target.checked; }); updateSel(); } }) : '';
    const cols = [
      ...(canEdit() ? [{ t: allBox, c: 1, f: r => pickable(r) ? inp({ type: 'checkbox', 'data-sel': r.id, 'aria-label': 'Seleccionar', onchange: e => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); updateSel(); } }) : '' }] : []),
      { t: 'Número', cls: 'nowrap', f: r => h('span', {}, r.number || h('span', { class: 'muted' }, 'Borrador'), r.type.endsWith('refund') ? h('div', { class: 'muted small' }, 'Nota de crédito') : null) },
      { t: 'Folio', cls: 'mono nowrap', f: r => h('span', {}, `${r.serie || ''}${r.folio || ''}`, r.plant ? [' ', badge('parcial', r.plant)] : null, r.test ? [' ', badge('draft', 'Prueba')] : null) },
      { t: side === 'ap' ? 'Proveedor' : 'Cliente', cls: 'w', f: r => r.partner || h('span', { class: 'warnmark' }, 'Sin contacto') },
      { t: 'Fecha', cls: 'nowrap', f: r => fd(r.date) },
      { t: 'Vence', cls: 'nowrap', f: r => fd(r.due) },
      { t: 'Total', n: 1, f: r => (r.type.endsWith('refund') ? -1 : 1) * r.totalMxn },
      { t: 'Saldo', n: 1, f: r => r.state === 'posted' ? r.residual : '' },
      { t: 'Estado', f: r => r.state === 'erased' ? h('span', { class: 'erased-note' }, `Eliminada por ${r.erasedBy || '—'} · ${fdt(r.erasedAt)}`) : h('span', {}, badge(r.state, STATE[r.state]), ' ', r.pay ? badge(r.pay, PAY[r.pay]) : null) },
      { t: '', cls: 'nowrap', f: r => h('span', { class: 'nowrap' }, r.portal ? [badge('parcial', 'Portal'), ' '] : null, r.warnings ? [h('span', { class: 'badge draft', title: 'Tiene avisos por revisar' }, 'Revisar'), ' '] : null, r.files ? h('span', { class: 'muted small', title: 'Archivos adjuntos' }, `${r.files} arch.`) : null) },
    ];
    const chips = (key, opts) => h('div', { class: 'chips' }, opts.map(([v, t]) => h('button', { class: 'chipb', type: 'button', 'aria-pressed': String(st[key] === v), onclick: () => { st[key] = v; render(); } }, t)));
    const search = inp({ class: 'search', type: 'search', placeholder: 'Buscar número, contacto, RFC, UUID o importe', value: st.q });
    search.addEventListener('keydown', e => { if (e.key === 'Enter') { st.q = search.value; render(); } });
    const fromI = inp({ type: 'date', value: st.from, 'aria-label': 'Desde', onchange: e => { st.from = e.target.value; render(); } });
    const toI = inp({ type: 'date', value: st.to, 'aria-label': 'Hasta', onchange: e => { st.to = e.target.value; render(); } });
    const drop = canEdit() ? dropZone() : null;
    return h('div', { class: 'stack' },
      phead(side === 'ap' ? 'Facturas de proveedores' : 'Facturas a clientes', side === 'ap' ? 'Compras: facturas y notas de crédito que recibimos.' : 'Ventas: facturas y notas de crédito que emitimos.',
        canEdit() ? [h('button', { class: 'btn', type: 'button', onclick: () => go('doc/new/' + (side === 'ap' ? 'in_refund' : 'out_refund')) }, 'Nota de crédito'),
          h('button', { class: 'btn', type: 'button', onclick: () => go('doc/new/' + (side === 'ap' ? 'in_invoice' : 'out_invoice')) }, 'Capturar factura'),
          h('button', { class: 'btn primary', type: 'button', onclick: () => pickFiles() }, 'Importar XML / PDF')] : []),
      drop,
      h('div', { class: 'filters' }, search, fromI, h('span', { class: 'muted' }, 'a'), toI,
        st.partner ? h('button', { class: 'chipb', type: 'button', 'aria-pressed': 'true', onclick: () => { st.partner = ''; go('docs/' + side); } }, 'Contacto filtrado ✕') : null),
      h('div', { class: 'filters' }, chips('state', [['', 'Todos'], ['draft', 'Borradores'], ['posted', 'Publicados'], ['cancelled', 'Cancelados'], ['erased', 'Eliminadas']]), chips('pay', [['', 'Cualquier pago'], ['abierto', 'Por pagar'], ['vencido', 'Vencidos'], ['pagado', 'Pagados']]), side === 'ap' ? chips('origin', [['', 'Cualquier origen'], ['portal', 'Del portal']]) : null),
      selBar,
      table(cols, data.rows, { tall: 1, onRow: r => { if (r.state !== 'erased') go('doc/' + r.id); }, rowClass: r => r.state === 'cancelled' ? 'cx' : r.state === 'erased' ? 'ghost' : '', empty: st.q || st.state || st.pay ? 'Ningún documento coincide con el filtro.' : 'Aún no hay documentos. Importa los XML del SAT para empezar.' }),
      h('div', { class: 'foot' }, h('span', {}, `${data.count} documentos${data.count > data.rows.length ? ` (se muestran ${data.rows.length})` : ''}`), h('span', {}, `Total ${money(data.sum.total)} · Saldo abierto ${money(data.sum.residual)}`)),
    );
  });

  /* ---------- import ---------- */
  function dropZone() {
    const z = h('div', { class: 'drop' }, 'Arrastra aquí los XML, PDF o el ZIP de descarga masiva del SAT. Se clasifican solos: compras, ventas, notas de crédito y complementos de pago.');
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('over'); });
    z.addEventListener('dragleave', () => z.classList.remove('over'));
    z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('over'); importFiles([...e.dataTransfer.files]); });
    return z;
  }
  const filePick = $('#filePick');
  const pickFiles = () => { filePick.value = ''; filePick.click(); };
  filePick.addEventListener('change', () => importFiles([...filePick.files]));
  async function importFiles(files) {
    files = files.filter(f => /\.(xml|pdf|zip|xlsx)$/i.test(f.name));
    if (!files.length) return toast('Elige archivos XML, PDF, ZIP o el Excel del SAT.', true);
    // XML first so PDFs find their invoice; batches keep each request small
    const lists = files.filter(f => /\.xlsx$/i.test(f.name)); files = files.filter(f => !/\.xlsx$/i.test(f.name));
    files.sort((a, b) => (/\.pdf$/i.test(a.name) ? 1 : 0) - (/\.pdf$/i.test(b.name) ? 1 : 0));
    const batches = []; let cur = [], size = 0;
    for (const f of files) { if (cur.length && (cur.length >= 40 || size + f.size > 40e6)) { batches.push(cur); cur = []; size = 0; } cur.push(f); size += f.size; }
    if (cur.length) batches.push(cur);
    const bar = h('i'), txt = h('span', {}, `0 de ${files.length}`);
    const total = { created: [], payments: [], duplicates: [], skipped: [], errors: [], attached: [], missing: [] };
    const box = clear($('#dlgBody'));
    add(box, [h('h2', {}, 'Importando…'), h('div', { class: 'progress' }, h('div', { class: 'bar2' }, bar), txt), h('p', { class: 'muted' }, 'No cierres esta página.')]);
    dlg.onclose = null; dlg.showModal();
    let done = 0;
    if (!files.length && lists.length) batches.push([]);
    for (const b of batches) {
      const fd2 = new FormData(); [...lists, ...b].forEach(f => fd2.append('files', f, f.name));
      try { const r = await api('POST', '/api/acc/import', fd2); for (const k in total) if (k !== 'missing') total[k].push(...(r[k] || [])); total.missing = r.missing || total.missing; }
      catch (e) { total.errors.push({ file: b.map(f => f.name).join(', ').slice(0, 120), error: e.message }); }
      done += b.length; bar.style.width = (done / files.length * 100) + '%'; txt.textContent = `${done} de ${files.length}`;
    }
    dlg.close();
    await refreshMeta();
    const pdfOnly = total.created.filter(c => c.pdfOnly).length, fromPdf = total.created.filter(c => c.fromPdf).length;
    const lines = [
      total.created.length - pdfOnly - fromPdf || total.payments.length ? h('div', { class: 'msg ok' }, `${total.created.length - pdfOnly - fromPdf} documentos creados desde XML como borrador${total.payments.length ? `, ${total.payments.length} pagos registrados desde complementos` : ''}.`) : null,
      fromPdf ? h('div', { class: 'msg ok' }, `${fromPdf} facturas leídas del PDF impreso (sin XML) como borrador: conceptos, IVA y total completos.`) : null,
      pdfOnly ? h('div', { class: 'msg' }, `${pdfOnly} PDF sin su XML: quedaron como borrador para capturar a mano o subir el XML.`) : null,
      total.attached.length ? h('div', { class: 'msg info' }, `${total.attached.length} PDF adjuntados a su factura.`) : null,
      total.duplicates.length ? h('div', { class: 'msg info' }, `${total.duplicates.length} ya estaban registrados (se ignoraron).`) : null,
      fromPdf ? h('div', { class: total.created.some(c => c.fromPdf && !c.ok) ? 'msg' : 'msg info' }, `${total.created.filter(c => c.fromPdf && c.ok).length} de ${fromPdf} leídas del PDF cuadran al centavo${lists.length ? ' con el Excel' : ''}; las demás quedan marcadas para revisar.`) : null,
      total.missing.length ? h('div', { class: 'msg' }, `${total.missing.length} facturas del Excel no venían en archivos: `, total.missing.map(m => `${m.name || m.rfc} $${m.total} (${m.fecha})`).join('; '), '. Pide el PDF o XML al proveedor.') : null,
      ...total.skipped.map(s => h('div', { class: 'msg info' }, `${s.file}: ${s.reason}`)),
      ...total.errors.map(s => h('div', { class: 'msg bad' }, `${s.file}: ${s.error}`)),
    ];
    await dialog('Importación terminada', h('div', { class: 'list' }, lines), [{ label: 'Listo', primary: true }]);
    const created = total.created[0];
    go(created && created.type.startsWith('out') ? 'docs/ar' : 'docs/ap', { state: 'draft' });
    render();
  }

  /* ================= DOCUMENT FORM ================= */
  route(/^doc\/new\/(in_invoice|in_refund|out_invoice|out_refund)$/, async (m, q) => {
    const type = m[1];
    const d = { id: null, type, state: 'draft', source: 'manual', partnerId: q.partner || '', date: today(), due: '', currency: 'MXN', rate: 1, serie: '', folio: '', ref: '', notes: '', appliesTo: q.applies || null,
      lines: [{ description: '', qty: 1, price: 0, discount: 0, account: type.startsWith('in') ? META.settings.accounts.expense : META.settings.accounts.sales, taxCodes: ['IVA16'] }], files: [], warnings: [] };
    return docForm({ doc: d, row: { pay: '' }, payments: [], journal: [], errors: [] });
  });
  route(/^doc\/([a-f0-9]+)$/, async m => docForm(await get('/api/acc/docs/' + m[1])));

  // Erase = remove from the books for good; the list keeps a crossed-out ghost saying who and when
  function eraseBtn(d, side) {
    return h('button', { class: 'btn danger quiet', type: 'button', onclick: async () => {
      const label = `${d.serie || ''}${d.folio || ''}` || d.number || 'este borrador';
      if (!(await confirmDlg(`¿Eliminar la factura ${label}?`, 'Sale de la contabilidad por completo: se borran sus conceptos, archivos y su UUID (se puede volver a importar). En la lista queda un registro tachado con quién la eliminó y cuándo. No se puede deshacer. Si el CFDI se canceló ante el SAT, usa Cancelar.', 'Eliminar factura', true))) return;
      const r = await act(() => post(`/api/acc/docs/${d.id}/erase`), 'Factura eliminada.');
      if (r) go('docs/' + side);
    } }, 'Eliminar');
  }

  function lineTotals(l) {
    const amount = r2((+l.qty || 0) * (+l.price || 0)), base = r2(amount - (+l.discount || 0));
    let tras = 0, ret = 0;
    for (const k of l.taxCodes || []) { const t = META.taxPresets[k]; if (!t || t.rate == null) continue; const v = r2(base * t.rate); if (t.kind === 'traslado') tras += v; else ret += v; }
    return { amount, base, tras: r2(tras), ret: r2(ret) };
  }
  function docForm(data) {
    const d = JSON.parse(JSON.stringify(data.doc));
    const T = d.type, side = T.startsWith('in') ? 'ap' : 'ar'; last.side = side;
    const isRefund = T.endsWith('refund');
    const editable = canEdit() && d.state === 'draft';
    const xml = d.source === 'xml' || d.source === 'pdfcfdi';
    const title = META.types[T];
    const kind = side === 'ap' ? 'supplier' : 'customer';

    /* header fields */
    const pSel = partnerSelect(d.partnerId, kind, { disabled: !editable, onchange: e => { d.partnerId = e.target.value; } });
    const newP = editable ? h('button', { class: 'btn sm quiet', type: 'button', onclick: async () => { const p = await partnerDialog(null, kind); if (p) { await refreshMeta(); d.partnerId = p.id; const ns = partnerSelect(d.partnerId, kind, { onchange: e => { d.partnerId = e.target.value; } }); pSel.replaceWith(ns); } } }, '+ Nuevo contacto') : null;
    // due dates stay editable after posting: they don't change the accounting
    const datesEditable = canEdit() && d.state === 'posted';
    const dateIn = k => inp({ type: 'date', value: (k === 'received' ? d.received || d.date : d[k]) || '', onchange: async e => {
      const body = k === 'received' ? { received: e.target.value } : { due: e.target.value };
      const r = await act(() => post(`/api/acc/docs/${d.id}/dates`, body), k === 'received' ? 'Fecha de recepción guardada; vencimiento recalculado.' : 'Vencimiento guardado.');
      if (r) render();
    } });
    const f = (k, type, attrs) => inp({ type: type || 'text', value: d[k] ?? '', disabled: !editable || (xml && ['date', 'serie', 'folio', 'currency', 'rate'].includes(k)), onchange: e => { d[k] = type === 'number' ? +e.target.value : e.target.value; }, ...(attrs || {}) });
    const form = h('div', { class: 'form' },
      field(side === 'ap' ? 'Proveedor' : 'Cliente', h('div', { class: 'acts' }, pSel, newP), 'span2'),
      field('Fecha', f('date', 'date')),
      field('Recibida', datesEditable ? dateIn('received') : f('received', 'date')),
      field('Vencimiento', datesEditable ? dateIn('due') : f('due', 'date')),
      field('Serie', f('serie')), field('Folio', f('folio')),
      field('Moneda', f('currency', 'text', { maxlength: 3 })), field('Tipo de cambio', f('rate', 'number', { step: '0.0001', min: '0' })),
      field('Referencia', f('ref'), 'span2'),
      field('Notas', h('textarea', { rows: 1, disabled: !editable, value: d.notes || '', onchange: e => { d.notes = e.target.value; } }), 'span2'),
    );

    /* lines */
    const linesBody = h('tbody');
    const totalsBox = h('div', { class: 'totals' });
    const accFilter = a => side === 'ap' ? !['IN', 'IO', 'EQ', 'EU', 'OB'].includes(a.type) : ['IN', 'IO', 'LU', 'AC'].includes(a.type) || a.type === 'IN';
    function recalc() {
      let sub = 0, disc = 0, tras = 0, ret = 0;
      for (const l of d.lines) {
        if (xml) { sub += +l.amount || 0; disc += +l.discount || 0; for (const t of l.taxes || []) { if (t.kind === 'traslado') tras += t.amount; else ret += t.amount; } }
        else { const x = lineTotals(l); sub += x.amount; disc += +l.discount || 0; tras += x.tras; ret += x.ret; }
      }
      const total = xml ? d.total : r2(sub - disc + tras - ret);
      clear(totalsBox);
      add(totalsBox, [h('span', {}, 'Subtotal'), h('span', {}, money(sub)), disc ? [h('span', {}, 'Descuento'), h('span', {}, money(-disc))] : null,
        h('span', {}, 'Impuestos trasladados'), h('span', {}, money(tras)), ret ? [h('span', {}, 'Retenciones'), h('span', {}, money(-ret))] : null,
        h('span', { class: 'big' }, `Total ${d.currency || 'MXN'}`), h('span', { class: 'big' }, money(total)),
        d.currency && d.currency !== 'MXN' ? [h('span', {}, 'Total en pesos'), h('span', {}, money(total * (d.rate || 1)))] : null]);
    }
    function taxPicker(l, tr) {
      const label = () => (l.taxCodes || []).map(k => (META.taxPresets[k] || {}).label || k).join(', ') || 'Sin impuestos';
      const sum = h('summary', {}, label());
      const box = h('div', { class: 'taxbox' }, Object.entries(META.taxPresets).map(([k, t]) => h('label', {}, inp({ type: 'checkbox', checked: (l.taxCodes || []).includes(k), onchange: e => {
        l.taxCodes = (l.taxCodes || []).filter(x => x !== k); if (e.target.checked) l.taxCodes.push(k);
        sum.textContent = label(); updLine(l, tr); recalc();
      } }), t.label)));
      return h('details', { class: 'taxpick' }, sum, box);
    }
    function updLine(l, tr) { const x = lineTotals(l); tr.querySelector('[data-amt]').textContent = money(x.base); }
    function drawLines() {
      clear(linesBody);
      d.lines.forEach((l, i) => {
        const tr = h('tr');
        const acc = editable ? accSelect(l.account, { onchange: e => { l.account = e.target.value; } }, accFilter) : h('span', { class: 'mono' }, l.account, ' ', h('span', { class: 'muted' }, accName(l.account)));
        if (xml) {
          add(tr, [h('td', { class: 'w' }, l.description, l.clave ? h('div', { class: 'muted small mono' }, `ClaveProdServ ${l.clave}${l.unidad ? ' · ' + l.unidad : ''}`) : null),
            h('td', {}, acc), h('td', { class: 'n' }, String(l.qty)), h('td', { class: 'n' }, money(l.price)), h('td', { class: 'n' }, l.discount ? money(l.discount) : ''),
            h('td', {}, h('span', { class: 'taxtxt' }, (l.taxes || []).map(t => `${t.kind === 'retencion' ? 'Ret. ' : ''}${t.tax} ${t.factor === 'Exento' ? 'exento' : Math.round(t.rate * 10000) / 100 + '%'}`).join(', ') || 'Sin impuestos')),
            h('td', { class: 'n' }, money(r2(l.amount - (l.discount || 0)))), h('td')]);
        } else if (editable) {
          const num = (k, step) => inp({ class: 'num', type: 'number', step: step || '0.01', value: l[k], onchange: e => { l[k] = +e.target.value; updLine(l, tr); recalc(); } });
          add(tr, [h('td', { class: 'w' }, inp({ value: l.description, placeholder: 'Concepto', onchange: e => { l.description = e.target.value; } })), h('td', {}, acc),
            h('td', {}, num('qty', '0.001')), h('td', {}, num('price', '0.000001')), h('td', {}, num('discount')), h('td', {}, taxPicker(l, tr)),
            h('td', { class: 'n', 'data-amt': '' }, ''), h('td', {}, h('button', { class: 'x', type: 'button', title: 'Quitar concepto', onclick: () => { d.lines.splice(i, 1); drawLines(); recalc(); } }, '×'))]);
          updLine(l, tr);
        } else {
          const x = lineTotals(l);
          add(tr, [h('td', { class: 'w' }, l.description), h('td', {}, acc), h('td', { class: 'n' }, String(l.qty)), h('td', { class: 'n' }, money(l.price)), h('td', { class: 'n' }, l.discount ? money(l.discount) : ''),
            h('td', {}, h('span', { class: 'taxtxt' }, (l.taxCodes || []).map(k => (META.taxPresets[k] || {}).label || k).join(', '))), h('td', { class: 'n' }, money(x.base)), h('td')]);
        }
        linesBody.append(tr);
      });
    }
    drawLines(); recalc();
    const linesTable = h('div', { class: 'tw' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Concepto', 'Cuenta contable', 'Cantidad', 'Precio', 'Descuento', 'Impuestos', 'Importe', ''].map((t, i) => h('th', { class: i >= 2 && i <= 4 || i === 6 ? 'n' : '' }, t)))), linesBody));
    const addLine = editable && !xml ? h('button', { class: 'btn sm', type: 'button', onclick: () => { d.lines.push({ description: '', qty: 1, price: 0, discount: 0, account: d.lines.length ? d.lines[d.lines.length - 1].account : '', taxCodes: ['IVA16'] }); drawLines(); recalc(); } }, '+ Agregar concepto') : null;

    /* actions */
    const payload = () => ({ partnerId: d.partnerId, date: d.date, due: d.due, serie: d.serie, folio: d.folio, currency: (d.currency || 'MXN').toUpperCase(), rate: d.rate, ref: d.ref, notes: d.notes, lines: d.lines, appliesTo: d.appliesTo });
    async function save(quiet) {
      if (!d.id) { const n = await post('/api/acc/docs', { type: T, ...payload() }); d.id = n.id; return n; }
      return put('/api/acc/docs/' + d.id, payload());
    }
    const actions = [];
    if (editable) {
      actions.push(h('button', { class: 'btn', type: 'button', onclick: async () => { const r = await act(() => save(), 'Guardado.'); if (r) { go('doc/' + r.id); render(); } } }, 'Guardar borrador'));
      actions.push(h('button', { class: 'btn primary', type: 'button', onclick: async () => { const r = await act(async () => { const s = await save(); return post(`/api/acc/docs/${s.id}/post`); }, 'Publicado.'); if (r) { go('doc/' + r.id); render(); } else if (d.id) { go('doc/' + d.id); render(); } } }, 'Publicar'));
      if (d.id) actions.push(eraseBtn(d, side));
    }
    if (canEdit() && d.state === 'posted') {
      const residual = data.row.residual;
      if (!isRefund && residual > 0.009) actions.push(h('button', { class: 'btn primary', type: 'button', onclick: () => go('pago/new/' + (side === 'ap' ? 'out' : 'in'), { partner: d.partnerId, doc: d.id }) }, side === 'ap' ? 'Registrar pago' : 'Registrar cobro'));
      if (!isRefund) actions.push(h('button', { class: 'btn', type: 'button', onclick: () => go('doc/new/' + (side === 'ap' ? 'in_refund' : 'out_refund'), { partner: d.partnerId, applies: d.id }) }, 'Nota de crédito'));
      actions.push(h('button', { class: 'btn', type: 'button', onclick: async () => { if (await confirmDlg('¿Regresar a borrador?', 'El documento deja de contar en la contabilidad hasta que lo publiques otra vez. Conserva su número.', 'Regresar a borrador')) { const r = await act(() => post(`/api/acc/docs/${d.id}/draft`), 'Ahora es borrador.'); if (r) render(); } } }, 'A borrador'));
      actions.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmDlg('¿Cancelar documento?', 'Queda registrado como cancelado y sale de la contabilidad. Úsalo cuando el CFDI se canceló ante el SAT.', 'Cancelar documento', true)) { const r = await act(() => post(`/api/acc/docs/${d.id}/cancel`), 'Cancelado.'); if (r) render(); } } }, 'Cancelar'));
      actions.push(eraseBtn(d, side));
    }
    if (canEdit() && d.state === 'cancelled' && d.id) actions.push(eraseBtn(d, side));
    if (canEdit() && d.state === 'cancelled' && d.id) actions.push(h('button', { class: 'btn', type: 'button', onclick: async () => { const r = await act(() => post(`/api/acc/docs/${d.id}/draft`), 'Ahora es borrador.'); if (r) render(); } }, 'Reabrir como borrador'));

    const msgs = h('div', { class: 'msgs' },
      (d.warnings || []).map(w => h('div', { class: 'msg' }, w)),
      d.state === 'draft' && d.id ? (data.errors || []).map(e => h('div', { class: 'msg bad' }, 'Para publicar: ' + e)) : null,
      xml && editable ? h('div', { class: 'msg info' }, 'Los importes vienen del XML timbrado y no se pueden cambiar. Solo elige la cuenta contable de cada concepto.') : null,
      !canEdit() ? h('div', { class: 'msg info' }, 'Tu usuario es de solo consulta.') : null);

    const status = d.id ? h('span', {}, badge(d.state, STATE[d.state]), ' ', data.row.pay ? badge(data.row.pay, PAY[data.row.pay]) : null, d.plant ? [' ', badge('parcial', 'Jabil ' + d.plant)] : null, d.test ? [' ', badge('draft', 'Prueba')] : null) : badge('draft', 'Nuevo');
    const head = phead(h('span', {}, d.number || (d.id ? 'Borrador' : title)), h('span', {}, d.number || d.id ? title + ' · ' : '', status), actions);

    /* side info */
    const extra = [];
    if (data.applies && data.applies.id) extra.push(h('div', { class: 'msg info' }, 'Aplica a la factura ', h('a', { href: '#/doc/' + data.applies.id }, data.applies.number || 'borrador'), ` (${data.applies.partner}).`));
    if (d.uuid || d.cfdi) extra.push(h('section', { class: 'panel' }, h('h2', {}, 'CFDI'), h('dl', { class: 'kv' },
      h('dt', {}, 'UUID'), h('dd', { class: 'mono' }, d.uuid || '—'),
      d.cfdi ? [h('dt', {}, 'Emisor'), h('dd', {}, `${d.cfdi.emisor.name || ''} · ${d.cfdi.emisor.rfc}`), h('dt', {}, 'Receptor'), h('dd', {}, `${d.cfdi.receptor.name || ''} · ${d.cfdi.receptor.rfc}`),
        h('dt', {}, 'Uso CFDI'), h('dd', {}, d.cfdi.uso || '—'), h('dt', {}, 'Método / forma'), h('dd', {}, `${d.metodoPago || '—'} / ${d.formaPago || '—'}`), h('dt', {}, 'Timbrado'), h('dd', {}, d.cfdi.fechaTimbrado || '—')] : null)));
    if ((d.files || []).length) {
      const imgs = d.files.filter(fl => fl.kind === 'img'), other = d.files.filter(fl => fl.kind !== 'img');
      extra.push(h('section', { class: 'panel' }, h('h2', {}, 'Archivos'),
        imgs.length ? h('div', { class: 'receipts' }, imgs.map(fl => h('a', { href: '/api/acc/file/' + fl.stored, target: '_blank', rel: 'noopener', title: fl.name }, h('img', { src: '/api/acc/file/' + fl.stored, alt: fl.receipt ? 'Foto del recibo de entrega' : fl.name, loading: 'lazy' }), h('span', {}, fl.receipt ? 'Recibo de entrega' : fl.name)))) : null,
        other.length ? h('div', { class: 'files' }, other.map(fl => h('a', { class: 'file', href: '/api/acc/file/' + fl.stored, target: '_blank', rel: 'noopener' }, h('b', {}, fl.kind), fl.name))) : null));
    }
    if ((data.payments || []).length) extra.push(h('section', { class: 'panel' }, h('h2', {}, 'Pagos y notas aplicados'), table([{ t: 'Número', k: 'number' }, { t: 'Fecha', f: r => fd(r.date) }, { t: 'Monto', k: 'amount', n: 1 }], data.payments, { onRow: r => go((r.kind === 'payment' ? 'pago/' : 'doc/') + r.id) }), h('div', { class: 'foot' }, h('span'), h('span', {}, `Saldo pendiente ${money(data.row.residual)}`))));
    if ((data.journal || []).length) extra.push(h('section', { class: 'panel' }, h('h2', {}, d.state === 'posted' ? 'Asiento contable' : 'Así quedará el asiento'),
      table([{ t: 'Cuenta', cls: 'mono nowrap', k: 'account' }, { t: 'Nombre', k: 'name' }, { t: 'Concepto', k: 'label' }, { t: 'Cargo', n: 1, tk: 'debit', f: r => r.debit || '' }, { t: 'Abono', n: 1, tk: 'credit', f: r => r.credit || '' }], data.journal,
        { total: { label: '', debit: r2(data.journal.reduce((a, l) => a + l.debit, 0)), credit: r2(data.journal.reduce((a, l) => a + l.credit, 0)) } }),
      h('div', { class: 'muted small' }, side === 'ap' ? 'El IVA se acredita cuando se paga la factura (flujo de efectivo); mientras tanto queda en IVA pendiente de pago.' : 'El IVA se traslada cuando se cobra la factura; mientras tanto queda en IVA pendiente de cobro.')));

    return h('div', { class: 'stack' }, h('a', { href: '#/docs/' + side, class: 'muted small' }, '← ' + (side === 'ap' ? 'Facturas de proveedores' : 'Facturas a clientes')), head, msgs,
      h('section', { class: 'panel' }, form),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Conceptos'), addLine), linesTable, totalsBox),
      extra);
  }

  /* ================= PAYMENTS ================= */
  const payState = { out: { q: '', from: '', to: '' }, in: { q: '', from: '', to: '' } };
  route(/^pagos\/(out|in)$/, async m => {
    const dir = m[1], st = payState[dir];
    const data = await get('/api/acc/payments?' + qs({ dir, ...st }));
    const search = inp({ class: 'search', type: 'search', placeholder: 'Buscar número, contacto, referencia o importe', value: st.q });
    search.addEventListener('keydown', e => { if (e.key === 'Enter') { st.q = search.value; render(); } });
    return h('div', { class: 'stack' },
      phead(dir === 'out' ? 'Pagos a proveedores' : 'Cobros a clientes', 'Cada pago se aplica a una o varias facturas y mueve el IVA de pendiente a pagado.',
        canEdit() ? [h('button', { class: 'btn primary', type: 'button', onclick: () => go('pago/new/' + dir) }, dir === 'out' ? 'Registrar pago' : 'Registrar cobro')] : []),
      h('div', { class: 'filters' }, search, inp({ type: 'date', value: st.from, 'aria-label': 'Desde', onchange: e => { st.from = e.target.value; render(); } }), h('span', { class: 'muted' }, 'a'), inp({ type: 'date', value: st.to, 'aria-label': 'Hasta', onchange: e => { st.to = e.target.value; render(); } })),
      table([{ t: 'Número', k: 'number', cls: 'nowrap' }, { t: 'Fecha', f: r => fd(r.date), cls: 'nowrap' }, { t: 'Contacto', k: 'partner', cls: 'w' }, { t: 'Cuenta', k: 'bank' }, { t: 'Forma', f: r => FORMAS[r.method] || r.method || '' }, { t: 'Referencia', k: 'ref' },
        { t: 'Monto', k: 'amount', n: 1 }, { t: 'Sin aplicar', n: 1, f: r => r.amount - r.applied > 0.009 ? r2(r.amount - r.applied) : '' }, { t: 'Estado', f: r => badge(r.state, STATE[r.state]) }],
      data.rows, { tall: 1, onRow: r => go('pago/' + r.id), rowClass: r => r.state === 'cancelled' ? 'cx' : '', empty: 'Aún no hay pagos registrados.' }),
      h('div', { class: 'foot' }, h('span', {}, `${data.rows.length} registros`), h('span', {}, `Total publicado ${money(data.sum)}`)));
  });

  route(/^pago\/new\/(out|in)$/, async (m, q) => {
    // One payment for several invoices of the same contact: pick them by quick filters or by hand, see the total live.
    const dir = m[1], kind = dir === 'out' ? 'supplier' : 'customer';
    if (!canEdit()) throw new Error('Tu usuario es de solo consulta.');
    const p = { dir, partnerId: q.partner || '', date: today(), bankId: META.banks[0] && META.banks[0].id, amount: 0, method: '03', ref: '', notes: '' };
    const alloc = {}; let open = [], manualAmount = false;
    const want = new Set(String(q.docs || q.doc || '').split(',').filter(Boolean));
    const amountI = inp({ type: 'number', step: '0.01', min: '0', value: '', onchange: e => { p.amount = r2(+e.target.value || 0); manualAmount = true; info(); } });
    const docsBox = h('div'), sumBox = h('div', { class: 'pay-sum' }), msgBox = h('div');
    const selTotal = () => r2(Object.values(alloc).reduce((a, v) => a + (+v || 0), 0));
    const selCount = () => Object.values(alloc).filter(v => +v > 0).length;
    function info() {
      const t = selTotal(), n = selCount();
      if (!manualAmount) { p.amount = t; amountI.value = t ? t.toFixed(2) : ''; }
      clear(sumBox);
      add(sumBox, [h('div', {}, h('span', { class: 'k' }, 'Facturas seleccionadas'), h('b', {}, String(n))),
        h('div', {}, h('span', { class: 'k' }, 'Total a pagar'), h('b', { class: 'big' }, money(t))),
        h('div', {}, h('span', { class: 'k' }, 'Monto del pago'), h('b', {}, money(p.amount || 0)))]);
      clear(msgBox);
      if (p.amount && p.amount < t - 0.009) add(msgBox, [h('div', { class: 'msg bad' }, `El monto del pago es ${money(r2(t - p.amount))} menor que lo seleccionado. Ajusta el monto o los importes a aplicar.`)]);
      else if (p.amount > t + 0.009 && n) add(msgBox, [h('div', { class: 'msg info' }, `Quedan ${money(r2(p.amount - t))} sin aplicar (saldo a favor / anticipo).`)]);
      docsBox.querySelectorAll('tbody tr[data-id]').forEach(tr => { const v = +alloc[tr.dataset.id] || 0; tr.classList.toggle('on', v > 0); tr.querySelector('input[type=checkbox]').checked = v > 0; const a = tr.querySelector('input.num'); if (document.activeElement !== a) a.value = v ? v.toFixed(2) : ''; });
      const all = docsBox.querySelector('input[data-all]'); if (all) { all.checked = open.length > 0 && n === open.length; all.indeterminate = n > 0 && n < open.length; }
    }
    const setSel = pred => { for (const d of open) alloc[d.id] = pred(d) ? d.residual : 0; manualAmount = false; info(); };
    // quick selectors
    const ymd = d => d.toISOString().slice(0, 10);
    const lastWeek = () => { const t = new Date(today() + 'T12:00:00'), dow = (t.getDay() + 6) % 7; const mon = new Date(t); mon.setDate(t.getDate() - dow - 7); const sun = new Date(mon); sun.setDate(mon.getDate() + 6); return [ymd(mon), ymd(sun)]; };
    const basis = sel([['date', 'Fecha de factura'], ['received', 'Fecha recibida'], ['due', 'Fecha de vencimiento']], 'date', {});
    const fromI = inp({ type: 'date', 'aria-label': 'Desde' }), toI = inp({ type: 'date', 'aria-label': 'Hasta' });
    const byRange = (f, t) => { const k = basis.value; setSel(d => { const v = d[k] || d.date; return (!f || v >= f) && (!t || v <= t); }); };
    const quick = h('div', { class: 'quick' },
      h('div', { class: 'chips' },
        h('button', { class: 'chipb', type: 'button', onclick: () => setSel(() => true) }, 'Todas sin pagar'),
        h('button', { class: 'chipb', type: 'button', onclick: () => { const [f, t] = lastWeek(); fromI.value = f; toI.value = t; byRange(f, t); } }, 'Semana pasada'),
        h('button', { class: 'chipb', type: 'button', onclick: () => setSel(d => d.pay === 'vencido') }, 'Vencidas'),
        h('button', { class: 'chipb', type: 'button', onclick: () => setSel(() => false) }, 'Ninguna')),
      h('div', { class: 'filters' }, h('span', { class: 'muted' }, 'Por días:'), basis, fromI, h('span', { class: 'muted' }, 'a'), toI,
        h('button', { class: 'btn sm', type: 'button', onclick: () => { if (!fromI.value && !toI.value) return toast('Elige al menos una fecha.', true); byRange(fromI.value, toI.value); } }, 'Seleccionar esas fechas')));
    async function loadDocs() {
      open = p.partnerId ? await get('/api/acc/open-docs?' + qs({ partner: p.partnerId, dir })) : [];
      for (const k of Object.keys(alloc)) delete alloc[k];
      for (const d of open) if (want.has(d.id)) alloc[d.id] = d.residual;
      want.clear(); manualAmount = false;
      clear(docsBox);
      if (!p.partnerId) { add(docsBox, [h('div', { class: 'empty2' }, `Elige el ${dir === 'out' ? 'proveedor' : 'cliente'} para ver sus facturas sin pagar.`)]); quick.hidden = true; info(); return; }
      quick.hidden = !open.length;
      const allBox = inp({ type: 'checkbox', 'data-all': '1', 'aria-label': 'Seleccionar todas', onchange: e => setSel(() => e.target.checked) });
      const rows = open.map(d => {
        const a = inp({ class: 'num', type: 'number', step: '0.01', min: '0', max: d.residual, 'aria-label': 'Importe a aplicar', onchange: e => { alloc[d.id] = r2(Math.min(+e.target.value || 0, d.residual)); manualAmount = false; info(); } });
        const ck = inp({ type: 'checkbox', 'aria-label': 'Incluir en el pago', onchange: e => { alloc[d.id] = e.target.checked ? d.residual : 0; manualAmount = false; info(); } });
        const tr = h('tr', { 'data-id': d.id, class: 'click' }, h('td', { class: 'c' }, ck), h('td', { class: 'nowrap' }, d.number), h('td', { class: 'mono' }, `${d.serie || ''}${d.folio || ''}`), h('td', { class: 'nowrap' }, fd(d.date)), h('td', { class: 'nowrap' }, fd(d.received)), h('td', { class: 'nowrap' }, fd(d.due), ' ', d.pay === 'vencido' ? badge('vencido', 'Vencida') : null), h('td', { class: 'n' }, money(d.totalMxn)), h('td', { class: 'n' }, money(d.residual)), h('td', {}, a));
        tr.addEventListener('click', e => { if (e.target.closest('input')) return; ck.checked = !ck.checked; ck.dispatchEvent(new Event('change')); });
        return tr;
      });
      add(docsBox, [h('div', { class: 'tw' }, h('table', { class: 't pay-pick' }, h('thead', {}, h('tr', {}, h('th', { class: 'c' }, allBox), ...['Número', 'Folio', 'Fecha', 'Recibida', 'Vence', 'Total', 'Saldo', 'Aplicar'].map((t, i) => h('th', { class: i >= 5 ? 'n' : '' }, t)))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 9, class: 'empty2' }, 'Este contacto no tiene facturas publicadas con saldo.')))))]);
      info();
    }
    const pSel = partnerSelect(p.partnerId, kind, { onchange: e => { p.partnerId = e.target.value; loadDocs(); } });
    const form = h('div', { class: 'form' },
      field(dir === 'out' ? 'Proveedor' : 'Cliente', pSel, 'span2'),
      field('Fecha del pago', inp({ type: 'date', value: p.date, onchange: e => { p.date = e.target.value; } })),
      field('Monto (MXN)', amountI),
      field('Cuenta', sel(META.banks.map(b => [b.id, b.name]), p.bankId, { onchange: e => { p.bankId = e.target.value; } })),
      field('Forma de pago', sel(Object.entries(FORMAS), p.method, { onchange: e => { p.method = e.target.value; } })),
      field('Referencia', inp({ value: '', placeholder: 'Folio de transferencia, cheque…', onchange: e => { p.ref = e.target.value; } }), 'span2'),
      field('Notas', inp({ value: '', onchange: e => { p.notes = e.target.value; } }), 'span4'));
    await loadDocs();
    const submit = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      const allocations = Object.entries(alloc).filter(([, v]) => v > 0).map(([docId, amount]) => ({ docId, amount }));
      if (!allocations.length && !(await confirmDlg('¿Pago sin facturas?', 'No seleccionaste facturas: se registra como anticipo / saldo a favor.', 'Registrar anticipo'))) return;
      const r = await act(() => post('/api/acc/payments', { ...p, allocations }), allocations.length > 1 ? `Pago registrado para ${allocations.length} facturas.` : 'Pago registrado.');
      if (r) go('pago/' + r.id);
    } }, 'Registrar pago');
    return h('div', { class: 'stack' }, h('a', { href: '#/pagos/' + dir, class: 'muted small' }, '← ' + (dir === 'out' ? 'Pagos a proveedores' : 'Cobros a clientes')),
      phead(dir === 'out' ? 'Registrar pago' : 'Registrar cobro', 'Junta varias facturas del mismo contacto en un solo pago. Si recibiste el complemento de pago (CFDI tipo P), mejor impórtalo: se registra y aplica solo.', [submit]),
      h('section', { class: 'panel' }, form),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Facturas sin pagar')), quick, docsBox),
      h('section', { class: 'panel pay-bar' }, sumBox, msgBox));
  });

  route(/^pago\/([a-f0-9]+)$/, async m => {
    const data = await get('/api/acc/payments/' + m[1]); const p = data.payment, r = data.row;
    const acts = canEdit() && p.state === 'posted' ? [h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmDlg('¿Cancelar pago?', 'Las facturas vuelven a quedar con saldo y el IVA regresa a pendiente.', 'Cancelar pago', true)) { const x = await act(() => post(`/api/acc/payments/${p.id}/cancel`), 'Pago cancelado.'); if (x) render(); } } }, 'Cancelar pago')] : [];
    return h('div', { class: 'stack' }, h('a', { href: '#/pagos/' + p.dir, class: 'muted small' }, '← ' + (p.dir === 'out' ? 'Pagos a proveedores' : 'Cobros a clientes')),
      phead(p.number, h('span', {}, p.dir === 'out' ? 'Pago a proveedor · ' : 'Cobro a cliente · ', badge(p.state, STATE[p.state])), acts),
      h('section', { class: 'panel' }, h('dl', { class: 'kv' }, h('dt', {}, 'Contacto'), h('dd', {}, r.partner), h('dt', {}, 'Fecha'), h('dd', {}, fd(p.date)), h('dt', {}, 'Monto'), h('dd', {}, money(p.amount)), h('dt', {}, 'Cuenta'), h('dd', {}, r.bank),
        h('dt', {}, 'Forma'), h('dd', {}, FORMAS[p.method] || p.method || '—'), h('dt', {}, 'Referencia'), h('dd', {}, p.ref || '—'), p.uuid ? [h('dt', {}, 'Complemento'), h('dd', { class: 'mono' }, p.uuid)] : null, p.notes ? [h('dt', {}, 'Notas'), h('dd', {}, p.notes)] : null, h('dt', {}, 'Registró'), h('dd', {}, `${p.createdBy} · ${fts(p.createdAt)}`))),
      (p.files || []).length ? h('section', { class: 'panel' }, h('h2', {}, 'Archivos'), h('div', { class: 'files' }, p.files.map(fl => h('a', { class: 'file', href: '/api/acc/file/' + fl.stored, target: '_blank', rel: 'noopener' }, h('b', {}, fl.kind), fl.name)))) : null,
      h('section', { class: 'panel' }, h('h2', {}, 'Facturas pagadas'), table([{ t: 'Número', f: a => a.doc ? a.doc.number : '—' }, { t: 'Folio', cls: 'mono', f: a => a.doc ? `${a.doc.serie || ''}${a.doc.folio || ''}` : '' }, { t: 'Fecha', f: a => a.doc ? fd(a.doc.date) : '' }, { t: 'Aplicado', k: 'amount', n: 1 }], data.allocations, { onRow: a => a.doc && go('doc/' + a.doc.id), empty: 'Pago sin aplicar a facturas (anticipo).' })),
      h('section', { class: 'panel' }, h('h2', {}, 'Asiento contable'), table([{ t: 'Cuenta', k: 'account', cls: 'mono nowrap' }, { t: 'Nombre', k: 'name' }, { t: 'Concepto', k: 'label' }, { t: 'Cargo', n: 1, f: l => l.debit || '' }, { t: 'Abono', n: 1, f: l => l.credit || '' }], data.journal)));
  });

  /* ================= CONTACTS ================= */
  const cState = { q: '', kind: '' };
  /* ================= SUPPLIER PORTAL ================= */
  route(/^portal$/, async () => {
    const data = await get('/api/acc/portal');
    const msg = v => `Hola, ${v.name}. Este es tu acceso al portal de proveedores de Grupo AVE para enviarnos tus facturas (XML y PDF) con la foto del recibo de entrega firmado o sellado: ${v.link}  Usuario: ${v.username || '(pídelo a Grupo AVE)'}. Importante: cada factura debe ser solo para Jabil B1 o solo para Jabil B3, nunca ambas en la misma factura. Tus días de crédito cuentan desde el día que la subes. Puedes cambiar tu contraseña dentro del portal.`;
    const copy = async (text, ok) => { try { await navigator.clipboard.writeText(text); toast(ok); } catch (e) { await dialog('Copia el texto', h('textarea', { class: 'inp', rows: 5, readOnly: true }, text)); } };
    const add = canEdit() ? (() => {
      const others = META.partners.filter(p => p.supplier && !data.vendors.some(v => v.id === p.id));
      const s = sel([['', '— Agregar proveedor al portal —'], ...others.map(p => [p.id, p.name])], '', {});
      return h('div', { class: 'filters' }, s, h('button', { class: 'btn', type: 'button', onclick: async () => { if (!s.value) return toast('Elige un proveedor.', true); if (await act(() => post(`/api/acc/portal/${s.value}/enable`, { region: 'Chihuahua' }), 'Proveedor agregado al portal.')) render(); } }, 'Agregar'));
    })() : null;
    return h('div', { class: 'stack' },
      phead('Portal de proveedores', 'Cada proveedor tiene su propio enlace para subir facturas con la foto del recibo de entrega. Por ahora: proveedores de Chihuahua.',
        data.pending ? [h('a', { class: 'btn primary', href: '#/docs/ap?origin=portal&state=draft' }, `${data.pending} facturas nuevas por revisar`)] : []),
      h('div', { class: 'msg info' }, 'Lo que suben llega a Facturas de proveedores como borrador (marcadas «Portal»), con la foto del recibo adjunta y la fecha de recepción de ese día; el vencimiento cuenta los días de crédito desde ahí. Revisa y publica como cualquier factura.'),
      add,
      table([
        { t: 'Proveedor', cls: 'w', f: v => h('span', {}, h('b', {}, v.name), v.test ? [' ', badge('draft', 'Prueba')] : null, h('div', { class: 'muted small' }, v.rfc || 'RFC pendiente: se toma de su primera factura')) },
        { t: 'Crédito', f: v => v.terms ? `${v.terms} días` : 'Contado' },
        { t: 'Usuario', f: v => v.username ? h('span', {}, h('span', { class: 'mono' }, v.username), h('div', { class: 'muted small' }, v.lastLogin ? 'Entró ' + fts(v.lastLogin) : 'Aún no entra', v.changedByVendor ? ' · cambió su contraseña' : '')) : h('span', { class: 'muted' }, 'Sin cuenta') },
        { t: 'Subidas', n: 1, f: v => String(v.uploads) },
        { t: 'Por revisar', n: 1, f: v => v.pending ? h('a', { href: '#/docs/ap?' + qs({ origin: 'portal', state: 'draft', partner: v.id }) }, String(v.pending)) : '0' },
        { t: 'Última', f: v => v.last ? fts(v.last) : '—' },
        { t: 'Estado', f: v => v.enabled ? badge('posted', 'Activo') : badge('cancelled', 'Pausado') },
        { t: 'Enlace', f: v => h('span', { class: 'acts' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => copy(v.link, 'Enlace copiado.') }, 'Copiar enlace'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => copy(msg(v), 'Mensaje copiado: pégalo en WhatsApp o correo.') }, 'Copiar mensaje'),
          h('a', { class: 'btn sm quiet', href: v.link, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir'),
          canEdit() ? h('button', { class: 'btn sm', type: 'button', onclick: async () => {
            if (v.hasPassword && !(await confirmDlg(`¿Nueva contraseña para ${v.name}?`, 'La contraseña actual deja de funcionar y su sesión se cierra. La nueva se muestra una sola vez.', 'Generar contraseña'))) return;
            const r = await act(() => post(`/api/acc/portal/${v.id}/credentials`, {}));
            if (!r) return;
            await dialog('Acceso del proveedor', h('div', { class: 'kv' }, h('dt', {}, 'Proveedor'), h('dd', {}, r.name), h('dt', {}, 'Portal'), h('dd', {}, v.login), h('dt', {}, 'Su enlace'), h('dd', {}, v.link), h('dt', {}, 'Usuario'), h('dd', { class: 'mono' }, r.username), h('dt', {}, 'Contraseña'), h('dd', { class: 'mono' }, r.password)),
              [{ label: 'Copiar todo', run: async () => { await copy(`Portal de proveedores Grupo AVE\n${v.link}\nUsuario: ${r.username}\nContraseña: ${r.password}\nCada factura debe ser solo para Jabil B1 o solo para Jabil B3, nunca ambas en la misma factura.`, 'Copiado.'); return false; } }, { label: 'Listo', primary: true }]);
            render();
          } }, v.hasPassword ? 'Nueva contraseña' : 'Crear acceso') : null,
          canEdit() ? h('button', { class: 'btn sm quiet', type: 'button', onclick: async () => { if (await confirmDlg('¿Cambiar el enlace?', 'El enlace anterior deja de funcionar. Úsalo si el proveedor lo compartió por error.', 'Cambiar enlace', true)) { if (await act(() => post(`/api/acc/portal/${v.id}/regenerate`), 'Enlace nuevo creado.')) render(); } } }, 'Nuevo enlace') : null,
          canEdit() ? h('button', { class: 'btn sm quiet', type: 'button', onclick: async () => { if (await act(() => post(`/api/acc/portal/${v.id}/${v.enabled ? 'disable' : 'enable'}`, { region: v.region }), v.enabled ? 'Acceso pausado.' : 'Acceso reactivado.')) render(); } }, v.enabled ? 'Pausar' : 'Reactivar') : null) },
      ], data.vendors, { empty: 'Aún no hay proveedores en el portal.' }));
  });

  route(/^contactos$/, async () => {
    const rows = await get('/api/acc/partners?' + qs(cState));
    const search = inp({ class: 'search', type: 'search', placeholder: 'Buscar nombre o RFC', value: cState.q });
    search.addEventListener('keydown', e => { if (e.key === 'Enter') { cState.q = search.value; render(); } });
    return h('div', { class: 'stack' },
      phead('Contactos', 'Proveedores y clientes. Se crean solos al importar XML.', canEdit() ? [h('button', { class: 'btn primary', type: 'button', onclick: async () => { if (await partnerDialog(null)) { await refreshMeta(); render(); } } }, 'Nuevo contacto')] : []),
      h('div', { class: 'filters' }, search, h('div', { class: 'chips' }, [['', 'Todos'], ['supplier', 'Proveedores'], ['customer', 'Clientes']].map(([v, t]) => h('button', { class: 'chipb', type: 'button', 'aria-pressed': String(cState.kind === v), onclick: () => { cState.kind = v; render(); } }, t)))),
      table([{ t: 'Nombre', k: 'name', cls: 'w' }, { t: 'RFC', k: 'rfc', cls: 'mono' }, { t: 'Tipo', f: r => [r.supplier ? 'Proveedor' : '', r.customer ? 'Cliente' : ''].filter(Boolean).join(' y ') }, { t: 'Cuenta por defecto', f: r => r.account ? `${r.account} ${accName(r.account)}` : '' },
        { t: 'Días crédito', n: 1, f: r => String(r.terms) }, { t: 'Docs', n: 1, f: r => String(r.docs) }, { t: 'Le debemos', n: 1, f: r => r.payable || '' }, { t: 'Nos debe', n: 1, f: r => r.receivable || '' },
        { t: '', f: r => h('span', { class: 'nowrap' }, h('a', { href: '#/reportes/statement?' + qs({ partner: r.id }) }, 'Estado de cuenta'), ' · ', h('a', { href: `#/docs/${r.supplier ? 'ap' : 'ar'}?` + qs({ partner: r.id, state: '' }) }, 'Facturas')) }],
      rows, { tall: 1, onRow: async r => { if (canEdit() && await partnerDialog(r)) { await refreshMeta(); render(); } }, empty: 'No hay contactos.' }));
  });
  async function partnerDialog(p, kind) {
    const v = p ? { ...p } : { name: '', rfc: '', supplier: kind !== 'customer', customer: kind === 'customer', terms: 30, account: '', email: '', phone: '', regimen: '', cp: '', notes: '' };
    const t = (k, label, attrs, cls) => field(label, inp({ value: v[k] ?? '', onchange: e => { v[k] = e.target.value; }, ...(attrs || {}) }), cls);
    const body = h('div', { class: 'form' },
      t('name', 'Nombre o razón social', { required: true }, 'span2'), t('rfc', 'RFC', { maxlength: 13, placeholder: 'XAXX010101000' }), t('terms', 'Días de crédito', { type: 'number', min: 0, max: 365 }),
      h('label', { class: 'check' }, inp({ type: 'checkbox', checked: v.supplier, onchange: e => { v.supplier = e.target.checked; } }), 'Proveedor'),
      h('label', { class: 'check' }, inp({ type: 'checkbox', checked: v.customer, onchange: e => { v.customer = e.target.checked; } }), 'Cliente'),
      field('Cuenta de gasto por defecto (proveedores)', accSelect(v.account || '', { onchange: e => { v.account = e.target.value; } }, a => !['IN', 'IO', 'EQ', 'EU', 'OB', 'LP', 'AR', 'BK'].includes(a.type)), 'span2'),
      t('email', 'Correo', { type: 'email' }), t('phone', 'Teléfono'), t('regimen', 'Régimen fiscal', { maxlength: 3 }), t('cp', 'C.P. fiscal', { maxlength: 5 }), t('notes', 'Notas', {}, 'span2'));
    return dialog(p ? 'Editar contacto' : 'Nuevo contacto', body, [{ label: 'Cancelar' }, { label: 'Guardar', primary: true, run: () => (p ? put('/api/acc/partners/' + p.id, v) : post('/api/acc/partners', v)) }]);
  }

  /* ================= JOURNAL ENTRIES ================= */
  route(/^polizas$/, async () => {
    const rows = await get('/api/acc/entries');
    return h('div', { class: 'stack' },
      phead('Pólizas', 'Asientos manuales: saldos iniciales, nómina, depreciación, ajustes. Las facturas y pagos generan su asiento solos.', canEdit() ? [h('button', { class: 'btn primary', type: 'button', onclick: () => go('poliza/new') }, 'Nueva póliza')] : []),
      table([{ t: 'Número', f: r => r.number || h('span', { class: 'muted' }, 'Borrador') }, { t: 'Fecha', f: r => fd(r.date) }, { t: 'Referencia', k: 'ref', cls: 'w' }, { t: 'Importe', k: 'total', n: 1 }, { t: 'Estado', f: r => badge(r.state, STATE[r.state]) }],
        rows, { tall: 1, onRow: r => go('poliza/' + r.id), rowClass: r => r.state === 'cancelled' ? 'cx' : '', empty: 'Sin pólizas manuales.' }));
  });
  route(/^poliza\/(new|[a-f0-9]+)$/, async m => {
    const e = m[1] === 'new' ? { id: null, state: 'draft', date: today(), ref: '', lines: [{ account: '', label: '', debit: 0, credit: 0 }, { account: '', label: '', debit: 0, credit: 0 }] } : await get('/api/acc/entries/' + m[1]);
    const editable = canEdit() && e.state === 'draft';
    const body = h('tbody'), tot = h('div', { class: 'foot' });
    const sums = () => { const dr = r2(e.lines.reduce((a, l) => a + (+l.debit || 0), 0)), cr = r2(e.lines.reduce((a, l) => a + (+l.credit || 0), 0)); clear(tot); add(tot, [h('span', {}, `Cargos ${money(dr)} · Abonos ${money(cr)}`), Math.abs(dr - cr) > 0.009 ? h('span', { class: 'diff' }, `No cuadra por ${money(r2(dr - cr))}`) : h('span', { class: 'okc' }, 'Cuadra')]); };
    function draw() {
      clear(body);
      e.lines.forEach((l, i) => {
        const num = k => editable ? inp({ class: 'num', type: 'number', step: '0.01', min: '0', value: l[k] || '', onchange: ev => { l[k] = +ev.target.value || 0; sums(); } }) : (l[k] ? money(l[k]) : '');
        body.append(h('tr', {}, h('td', {}, editable ? accSelect(l.account, { onchange: ev => { l.account = ev.target.value; } }) : `${l.account} ${accName(l.account)}`),
          h('td', {}, editable ? partnerSelect(l.partnerId || '', null, { onchange: ev => { l.partnerId = ev.target.value; } }) : ((META.partners.find(p => p.id === l.partnerId) || {}).name || '')),
          h('td', { class: 'w' }, editable ? inp({ value: l.label, onchange: ev => { l.label = ev.target.value; } }) : l.label),
          h('td', { class: 'n' }, num('debit')), h('td', { class: 'n' }, num('credit')),
          h('td', {}, editable ? h('button', { class: 'x', type: 'button', title: 'Quitar', onclick: () => { e.lines.splice(i, 1); draw(); sums(); } }, '×') : '')));
      });
    }
    draw(); sums();
    const save = () => post('/api/acc/entries', { id: e.id, date: e.date, ref: e.ref, lines: e.lines });
    const acts = [];
    if (editable) {
      acts.push(h('button', { class: 'btn', type: 'button', onclick: async () => { const r = await act(save, 'Guardada.'); if (r) go('poliza/' + r.id); } }, 'Guardar borrador'));
      acts.push(h('button', { class: 'btn primary', type: 'button', onclick: async () => { const r = await act(async () => { const s = await save(); e.id = s.id; return post(`/api/acc/entries/${s.id}/post`); }, 'Póliza publicada.'); if (r) { go('poliza/' + r.id); render(); } } }, 'Publicar'));
    }
    if (canEdit() && e.id && e.state !== 'cancelled') acts.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmDlg('¿Cancelar póliza?', 'Sale de la contabilidad. Queda en la bitácora.', 'Cancelar póliza', true)) { const r = await act(() => post(`/api/acc/entries/${e.id}/cancel`), 'Cancelada.'); if (r) render(); } } }, 'Cancelar'));
    return h('div', { class: 'stack' }, h('a', { href: '#/polizas', class: 'muted small' }, '← Pólizas'),
      phead(e.number || 'Póliza', h('span', {}, badge(e.state, STATE[e.state])), acts),
      h('section', { class: 'panel' }, h('div', { class: 'form' }, field('Fecha', inp({ type: 'date', value: e.date, disabled: !editable, onchange: ev => { e.date = ev.target.value; } })), field('Referencia', inp({ value: e.ref, disabled: !editable, onchange: ev => { e.ref = ev.target.value; } }), 'span2'))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Movimientos'), editable ? h('button', { class: 'btn sm', type: 'button', onclick: () => { e.lines.push({ account: '', label: '', debit: 0, credit: 0 }); draw(); } }, '+ Agregar movimiento') : null),
        h('div', { class: 'tw' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Cuenta', 'Contacto', 'Concepto', 'Cargo', 'Abono', ''].map((t, i) => h('th', { class: i === 3 || i === 4 ? 'n' : '' }, t)))), body)), tot));
  });

  /* ================= CHART OF ACCOUNTS ================= */
  const aState = { q: '', type: '' };
  route(/^cuentas$/, async () => {
    const tb = await get('/api/acc/reports/trial');
    const bal = Object.fromEntries(tb.rows.map(r => [r.code, r.close]));
    const ql = aState.q.toLowerCase();
    const rows = META.accounts.filter(a => (!aState.type || a.type === aState.type) && (!ql || (a.code + ' ' + a.name).toLowerCase().includes(ql)));
    const search = inp({ class: 'search', type: 'search', placeholder: 'Buscar código o nombre', value: aState.q });
    search.addEventListener('keydown', e => { if (e.key === 'Enter') { aState.q = search.value; render(); } });
    return h('div', { class: 'stack' },
      phead('Plan de cuentas', 'Catálogo basado en el código agrupador del SAT (el mismo que usaba Odoo).', canEdit() ? [h('button', { class: 'btn primary', type: 'button', onclick: async () => { if (await accountDialog(null)) { await refreshMeta(); render(); } } }, 'Nueva cuenta')] : []),
      h('div', { class: 'filters' }, search, sel([['', 'Todos los tipos'], ...Object.entries(META.accTypes)], aState.type, { onchange: e => { aState.type = e.target.value; render(); } })),
      table([{ t: 'Código', k: 'code', cls: 'mono nowrap' }, { t: 'Nombre', k: 'name', cls: 'w' }, { t: 'Tipo', f: a => META.accTypes[a.type] }, { t: 'Saldo', n: 1, f: a => bal[a.code] ?? '' }, { t: '', f: a => a.active === false ? badge('cancelled', 'Inactiva') : '' },
        { t: '', f: a => h('span', { class: 'nowrap' }, h('a', { href: '#/reportes/ledger?' + qs({ account: a.code }) }, 'Mayor'), canEdit() ? [' · ', h('button', { class: 'linkish', type: 'button', onclick: async () => { if (await accountDialog(a)) { await refreshMeta(); render(); } } }, 'Editar')] : null) }],
      rows, { tall: 1, rowClass: a => a.active === false ? 'dim' : '' }));
  });
  function accountDialog(a) {
    const v = a ? { ...a } : { code: '', name: '', type: 'EX', active: true };
    const body = h('div', { class: 'form' },
      field('Código', inp({ value: v.code, disabled: !!a, placeholder: '601.84.02', onchange: e => { v.code = e.target.value.trim(); } })),
      field('Tipo', sel(Object.entries(META.accTypes), v.type, { onchange: e => { v.type = e.target.value; } })),
      field('Nombre', inp({ value: v.name, onchange: e => { v.name = e.target.value; } }), 'span2'),
      a ? h('label', { class: 'check' }, inp({ type: 'checkbox', checked: v.active !== false, onchange: e => { v.active = e.target.checked; } }), 'Activa (se puede usar en documentos nuevos)') : null);
    return dialog(a ? 'Editar cuenta' : 'Nueva cuenta', body, [{ label: 'Cancelar' }, { label: 'Guardar', primary: true, run: () => (a ? put('/api/acc/accounts/' + encodeURIComponent(a.code), v) : post('/api/acc/accounts', v)) }]);
  }

  /* ================= REPORTS ================= */
  const REPORTS = [
    ['pnl', 'Estado de resultados'], ['balance', 'Balance general'], ['trial', 'Balanza'], ['ledger', 'Libro mayor'], ['journal', 'Libro diario'],
    ['schedule', 'Calendario de pagos'], ['aging', 'Antigüedad de saldos'], ['statement', 'Estado de cuenta'], ['tax', 'IVA y DIOT'], ['analysis', 'Análisis de facturas'], ['cashflow', 'Bancos y caja'],
  ];
  const defaults = name => ({ pnl: { from: firstOfYear(), to: today() }, trial: { from: firstOfMonth(), to: today() }, journal: { from: firstOfMonth(), to: today() }, ledger: { from: firstOfYear(), to: today() }, balance: { at: today() }, aging: { side: 'ap', at: today() }, statement: { from: firstOfYear(), to: today() }, tax: { month: today().slice(0, 7) }, analysis: { from: firstOfYear(), to: today(), side: 'ap', by: 'partner' }, cashflow: { from: firstOfMonth(), to: today() } }[name] || {});
  route(/^reportes\/([a-z]+)$/, async (m, q) => {
    const name = m[1];
    if (!REPORTS.some(r => r[0] === name)) throw new Error('Reporte no encontrado.');
    const p = { ...defaults(name), ...q };
    const tabs = h('nav', { class: 'tabs2' }, REPORTS.map(([k, t]) => h('a', { href: '#/reportes/' + k, class: k === name ? 'on' : '' }, t)));
    // parameter bar
    const set = (k, v) => { p[k] = v; go('reportes/' + name, p); };
    const dateF = (k, label) => field(label, inp({ type: 'date', value: p[k] || '', onchange: e => set(k, e.target.value) }), 'fl');
    const bar = h('div', { class: 'repbar' });
    if (['pnl', 'trial', 'journal', 'ledger', 'statement', 'analysis', 'cashflow'].includes(name)) add(bar, [dateF('from', 'Desde'), dateF('to', 'Hasta')]);
    if (['balance', 'aging'].includes(name)) add(bar, [dateF('at', 'Al día')]);
    if (name === 'tax') add(bar, [field('Mes', inp({ type: 'month', value: p.month, onchange: e => set('month', e.target.value) }), 'fl')]);
    if (['aging', 'analysis'].includes(name)) add(bar, [field('Lado', sel([['ap', 'Proveedores (por pagar)'], ['ar', 'Clientes (por cobrar)']], p.side, { onchange: e => set('side', e.target.value) }), 'fl')]);
    if (name === 'analysis') add(bar, [field('Agrupar por', sel([['partner', 'Contacto'], ['month', 'Mes'], ['account', 'Cuenta']], p.by, { onchange: e => set('by', e.target.value) }), 'fl')]);
    if (name === 'ledger') add(bar, [field('Cuenta', accSelect(p.account || '', { onchange: e => set('account', e.target.value) }), 'fl')]);
    if (name === 'statement') add(bar, [field('Contacto', partnerSelect(p.partner || '', null, { onchange: e => set('partner', e.target.value) }), 'fl')]);
    const need = (name === 'ledger' && !p.account) ? 'Elige una cuenta.' : (name === 'statement' && !p.partner) ? 'Elige un contacto.' : null;
    const presets = ['pnl', 'trial', 'journal', 'ledger', 'statement', 'analysis', 'cashflow'].includes(name) ? h('div', { class: 'chips' },
      [['Este mes', firstOfMonth(), today()], ['Mes anterior', prevMonth()[0], prevMonth()[1]], ['Este año', firstOfYear(), today()], ['Todo', '', '']].map(([t, f, to]) => h('button', { class: 'chipb', type: 'button', 'aria-pressed': String((p.from || '') === f && (p.to || '') === to), onclick: () => { p.from = f; p.to = to; go('reportes/' + name, p); } }, t))) : null;
    add(bar, [presets, h('span', { class: 'acts' }, need ? null : h('a', { class: 'btn sm', href: `/api/acc/export/${name}.xlsx?` + qs(p) }, 'Excel ↓'), h('button', { class: 'btn sm', type: 'button', onclick: () => window.print() }, 'Imprimir'))]);
    let body;
    if (need) body = h('div', { class: 'empty2' }, need);
    else { const r = await get(`/api/acc/reports/${name}?` + qs(p)); body = REPORT_VIEWS[name](r, p); }
    return h('div', { class: 'stack' }, phead('Reportes', META.company.name), tabs, bar, body);
  });
  function prevMonth() { const t = today(); const d = new Date(t.slice(0, 8) + '01T12:00:00Z'); d.setUTCDate(0); const end = d.toISOString().slice(0, 10); return [end.slice(0, 8) + '01', end]; }
  const toLedger = code => go('reportes/ledger', { account: code, from: '', to: '' });
  const srcLink = r => r.kind === 'doc' ? 'doc/' + r.id : r.kind === 'payment' ? 'pago/' + r.id : r.kind === 'entry' ? 'poliza/' + r.id : null;
  const accRows = list => list.map(x => ({ ...x }));
  function sectionTable(sections, totalLabel, total, extraRows) {
    const tb = h('tbody');
    for (const [title, rows, sum] of sections) {
      tb.append(h('tr', { class: 'sec' }, h('td', { colspan: 2 }, title), h('td', { class: 'n' }, money(sum))));
      for (const r of rows) { const tr = h('tr', { class: 'click' }, h('td', { class: 'mono nowrap' }, r.code), h('td', {}, r.name), h('td', { class: 'n' }, money(r.amount))); if (r.code !== '—') tr.addEventListener('click', () => toLedger(r.code)); tb.append(tr); }
    }
    for (const [l, v, cls] of extraRows || []) tb.append(h('tr', { class: 'tot' }, h('td', { colspan: 2, class: cls || '' }, l), h('td', { class: 'n ' + (cls || '') }, money(v))));
    return h('div', { class: 'tw' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Cuenta'), h('th', {}, 'Nombre'), h('th', { class: 'n' }, 'Importe'))), tb));
  }
  const REPORT_VIEWS = {
    pnl: r => sectionTable([['Ingresos', accRows(r.income), r.totals.income], ['Costo de venta', accRows(r.cost), r.totals.cost], ['Gastos', accRows(r.expense), r.totals.expense]], '', 0,
      [['Utilidad bruta', r.totals.gross], ['Utilidad neta', r.totals.net, r.totals.net < 0 ? 'diff' : '']]),
    balance: r => h('div', { class: 'stack' }, sectionTable([['Activo', r.assets, r.totals.assets], ['Pasivo', r.liabilities, r.totals.liabilities], ['Capital', r.equity, r.totals.equity]], '', 0, [['Pasivo + capital', r.totals.liabEquity]]),
      Math.abs(r.totals.diff) > 0.009 ? h('div', { class: 'msg bad' }, `Activo y pasivo + capital difieren por ${money(r.totals.diff)}.`) : h('div', { class: 'msg ok' }, 'El balance cuadra.')),
    trial: r => h('div', { class: 'stack' }, table([{ t: 'Cuenta', k: 'code', cls: 'mono nowrap' }, { t: 'Nombre', k: 'name', cls: 'w' }, { t: 'Saldo inicial', k: 'open', n: 1 }, { t: 'Cargos', k: 'debit', n: 1 }, { t: 'Abonos', k: 'credit', n: 1 }, { t: 'Saldo final', k: 'close', n: 1 }], r.rows, { tall: 1, onRow: x => toLedger(x.code), total: { name: 'Totales', ...r.totals }, empty: 'Sin movimientos en el periodo.' }),
      Math.abs(r.totals.debit - r.totals.credit) > 0.009 ? h('div', { class: 'msg bad' }, 'Cargos y abonos no coinciden.') : null),
    ledger: r => h('div', { class: 'stack' }, h('h2', {}, `${r.account.code} ${r.account.name}`),
      table([{ t: 'Fecha', f: x => fd(x.date), cls: 'nowrap' }, { t: 'Número', k: 'number', cls: 'nowrap' }, { t: 'Contacto', k: 'partner' }, { t: 'Concepto', k: 'label', cls: 'w' }, { t: 'Cargo', n: 1, f: x => x.debit || '' }, { t: 'Abono', n: 1, f: x => x.credit || '' }, { t: 'Saldo', k: 'balance', n: 1 }],
        [{ label: 'Saldo inicial', balance: r.open, number: '', partner: '' }, ...r.rows], { tall: 1, onRow: x => { const l = srcLink(x); if (l) go(l); }, rowClass: x => x.kind ? '' : 'dim' }),
      h('div', { class: 'foot' }, h('span', {}, `${r.rows.length} movimientos`), h('span', {}, `Saldo final ${money(r.close)}`))),
    journal: r => table([{ t: 'Fecha', f: x => fd(x.date), cls: 'nowrap' }, { t: 'Número', k: 'number', cls: 'nowrap' }, { t: 'Cuenta', k: 'account', cls: 'mono' }, { t: 'Nombre', k: 'name' }, { t: 'Contacto', k: 'partner' }, { t: 'Concepto', k: 'label', cls: 'w' }, { t: 'Cargo', n: 1, tk: 'debit', f: x => x.debit || '' }, { t: 'Abono', n: 1, tk: 'credit', f: x => x.credit || '' }], r.rows, { tall: 1, empty: 'Sin movimientos.', total: { label: '', debit: r2(r.rows.reduce((a, x) => a + x.debit, 0)), credit: r2(r.rows.reduce((a, x) => a + x.credit, 0)) } }),
    aging: r => h('div', { class: 'stack' },
      table([{ t: r.side === 'ar' ? 'Cliente' : 'Proveedor', k: 'partner', cls: 'w' }, { t: 'Por vencer', k: 'current', n: 1 }, { t: '1–30 días', k: 'd30', n: 1 }, { t: '31–60', k: 'd60', n: 1 }, { t: '61–90', k: 'd90', n: 1 }, { t: 'Más de 90', k: 'older', n: 1 }, { t: 'Total', k: 'total', n: 1 }], r.partners, { onRow: x => go('reportes/statement', { partner: x.partnerId }), total: { partner: 'Total', ...r.totals }, empty: 'Sin saldos abiertos.' }),
      h('h2', {}, 'Detalle por documento'),
      table([{ t: 'Número', k: 'number' }, { t: 'Contacto', k: 'partner', cls: 'w' }, { t: 'Fecha', f: x => fd(x.date) }, { t: 'Vence', f: x => fd(x.due) }, { t: 'Días vencido', n: 1, f: x => x.days ? String(x.days) : '' }, { t: 'Saldo', k: 'amount', n: 1 }], r.rows, { tall: 1, onRow: x => go('doc/' + x.id) })),
    statement: r => h('div', { class: 'stack' }, h('h2', {}, `${r.partner.name} · ${r.partner.rfc || 'sin RFC'}`),
      table([{ t: 'Fecha', f: x => fd(x.date), cls: 'nowrap' }, { t: 'Número', k: 'number' }, { t: 'Concepto', k: 'label', cls: 'w' }, { t: 'Cargo', n: 1, f: x => x.charge || '' }, { t: 'Abono', n: 1, f: x => x.credit || '' }, { t: 'Saldo', k: 'balance', n: 1 }],
        [{ label: 'Saldo inicial', balance: r.open }, ...r.rows], { tall: 1, onRow: x => { const l = srcLink(x); if (l) go(l); } }),
      h('div', { class: 'foot' }, h('span', {}, 'Saldo positivo: importe pendiente (lo que le debemos o nos debe).'), h('span', {}, `Saldo final ${money(r.close)}`))),
    tax: r => h('div', { class: 'stack' },
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('span', {}, 'IVA trasladado cobrado'), h('b', {}, money(r.ivaCollected))),
        h('div', { class: 'kpi' }, h('span', {}, 'IVA acreditable pagado'), h('b', {}, money(r.ivaPaid))),
        h('div', { class: 'kpi' }, h('span', {}, 'IVA que nos retuvieron'), h('b', {}, money(r.ivaRetByClients))),
        h('div', { class: 'kpi' }, h('span', {}, r.payable >= 0 ? 'IVA a cargo' : 'IVA a favor'), h('b', { class: r.payable > 0 ? 'diff' : 'okc' }, money(Math.abs(r.payable))))),
      h('div', { class: 'msg info' }, `Base flujo de efectivo: cuenta el IVA de las facturas cobradas y pagadas en ${monthName(r.month)}. Retenciones de IVA a enterar: ${money(r.retIvaPaid)}. Retenciones de ISR: ${money(r.retIsr)}. Confírmalo con tu contador antes de declarar.`),
      h('h2', {}, 'DIOT: pagos a proveedores del mes'),
      table([{ t: 'Proveedor', k: 'partner', cls: 'w' }, { t: 'RFC', k: 'rfc', cls: 'mono' }, { t: 'Base 16%', k: 'base16', n: 1 }, { t: 'Base 8%', k: 'base8', n: 1 }, { t: 'Base 0%', k: 'base0', n: 1 }, { t: 'Exento', k: 'exento', n: 1 }, { t: 'IVA pagado', k: 'iva', n: 1 }, { t: 'IVA retenido', k: 'ivaRet', n: 1 }, { t: 'Pagado', k: 'paid', n: 1 }], r.diot, { tall: 1, empty: 'No hubo pagos a proveedores este mes.' })),
    analysis: r => table([{ t: { partner: 'Contacto', month: 'Mes', account: 'Cuenta' }[r.by], f: x => r.by === 'month' ? monthName(x.label) : x.label, cls: 'w' }, { t: 'Documentos', n: 1, tk: 'count', f: x => String(x.count) }, { t: 'Subtotal', k: 'subtotal', n: 1 }, { t: r.by === 'account' ? '' : 'Total con impuestos', n: 1, tk: 'total', f: x => r.by === 'account' ? '' : x.total }],
      r.rows, { tall: 1, empty: 'Sin documentos publicados en el periodo.', total: { label: 'Total', count: String(r.totals.count), subtotal: r.totals.subtotal, total: r.by === 'account' ? '' : r.totals.total }, onRow: x => { if (r.by === 'partner') go(`docs/${r.side}`, { partner: x.key, state: '' }); else if (r.by === 'account') toLedger(x.key); } }),
    schedule: r => h('div', { class: 'stack' },
      h('div', { class: 'kpis' }, r.weeks.slice(0, 4).map(w => h('div', { class: 'kpi' }, h('span', {}, w.week === 'vencido' ? 'Ya vencido' : `Semana del ${fd(w.week)}`), h('b', { class: w.week === 'vencido' ? 'diff' : '' }, money(w.total)), h('small', {}, `${w.count} facturas`)))),
      table([{ t: 'Vence', f: x => h('span', { class: x.due < r.at ? 'diff' : '' }, fd(x.due)), cls: 'nowrap' }, { t: 'Proveedor', k: 'partner', cls: 'w' }, { t: 'Número', k: 'number', cls: 'nowrap' }, { t: 'Folio', k: 'folio', cls: 'mono' }, { t: 'Recibida', f: x => fd(x.received), cls: 'nowrap' }, { t: 'Crédito', f: x => x.pue ? 'Contado (PUE)' : x.terms ? `${x.terms} días` : 'Contado' }, { t: 'Saldo', k: 'amount', n: 1 }],
        r.rows, { tall: 1, onRow: x => go('doc/' + x.id), empty: 'No hay facturas de proveedores por pagar.', total: { partner: 'Total por pagar', amount: r.total } }),
      h('div', { class: 'muted small' }, 'El vencimiento cuenta los días de crédito del proveedor desde que recibimos la factura. Cambia la fecha de recepción en la factura si llegó después.')),
    cashflow: r => table([{ t: 'Cuenta', k: 'bank', cls: 'w' }, { t: 'Cuenta contable', k: 'account', cls: 'mono' }, { t: 'Saldo inicial', k: 'open', n: 1 }, { t: 'Entradas', k: 'inflow', n: 1 }, { t: 'Salidas', k: 'outflow', n: 1 }, { t: 'Saldo final', k: 'close', n: 1 }], r.rows, { onRow: x => toLedger(x.account), total: { bank: 'Total', ...r.totals } }),
  };

  /* ================= SETTINGS ================= */
  const ACC_LABELS = { payable: 'Proveedores', receivable: 'Clientes', sales: 'Ventas', expense: 'Gasto por defecto', salesReturns: 'Devoluciones sobre ventas', ivaPending: 'IVA acreditable pendiente de pago', ivaPaid: 'IVA acreditable pagado', ivaUncollected: 'IVA trasladado no cobrado', ivaCollected: 'IVA trasladado cobrado', iepsPending: 'IEPS acreditable pendiente', iepsPaid: 'IEPS acreditable pagado', iepsUncollected: 'IEPS trasladado no cobrado', iepsCollected: 'IEPS trasladado cobrado', retIvaPending: 'IVA retenido pendiente de pago', retIvaPaid: 'IVA retenido efectivamente pagado', retIsr: 'ISR retenido', clientRetIva: 'IVA que nos retienen clientes', clientRetIsr: 'ISR que nos retienen clientes', advSupplier: 'Anticipo a proveedores', advCustomer: 'Anticipo de clientes', result: 'Resultado del ejercicio' };
  route(/^config$/, async () => {
    const s = JSON.parse(JSON.stringify(META.settings)), c = { ...META.company };
    const ed = !canEdit();
    const saveBtn = (label, body) => canEdit() ? h('button', { class: 'btn primary', type: 'button', onclick: async () => { const r = await act(() => put('/api/acc/settings', body()), 'Guardado.'); if (r) { await refreshMeta(); render(); } } }, label) : null;
    const company = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Empresa'), saveBtn('Guardar', () => ({ company: c }))),
      h('div', { class: 'form' }, field('Razón social', inp({ value: c.name, disabled: ed, onchange: e => { c.name = e.target.value; } }), 'span2'), field('RFC', inp({ value: c.rfc, disabled: true })), field('Régimen fiscal', inp({ value: c.regimen, disabled: ed, maxlength: 3, onchange: e => { c.regimen = e.target.value; } })), field('C.P. fiscal', inp({ value: c.cp, disabled: ed, maxlength: 5, onchange: e => { c.cp = e.target.value; } }))),
      h('div', { class: 'muted small' }, 'El RFC decide qué XML son compras (somos receptor) y cuáles ventas (somos emisor). Se cambia con la variable COMPANY_RFC en Render.'));
    const lock = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Cierre de periodo'), saveBtn('Guardar', () => ({ lockDate: s.lockDate || null, iepsCreditable: s.iepsCreditable }))),
      h('div', { class: 'form' }, field('Bloquear movimientos hasta (inclusive)', inp({ type: 'date', value: s.lockDate || '', disabled: ed, onchange: e => { s.lockDate = e.target.value; } })),
        h('label', { class: 'check span2' }, inp({ type: 'checkbox', checked: !!s.iepsCreditable, disabled: ed, onchange: e => { s.iepsCreditable = e.target.checked; } }), 'El IEPS de compras es acreditable (si no, se suma al costo)')),
      h('div', { class: 'muted small' }, 'Después de declarar un mes, ciérralo: nadie podrá crear, publicar ni cancelar documentos, pagos o pólizas con fecha dentro del periodo cerrado.'));
    const accs = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Cuentas que usa el sistema'), saveBtn('Guardar cuentas', () => ({ accounts: s.accounts }))),
      h('div', { class: 'form' }, Object.keys(s.accounts).map(k => field(ACC_LABELS[k] || k, accSelect(s.accounts[k], { disabled: ed, onchange: e => { s.accounts[k] = e.target.value; } }), 'span2'))));
    const banks = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Bancos y caja'), canEdit() ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (await bankDialog(null)) { await refreshMeta(); render(); } } }, '+ Agregar cuenta') : null),
      table([{ t: 'Nombre', k: 'name', cls: 'w' }, { t: 'Número / CLABE', k: 'number', cls: 'mono' }, { t: 'Cuenta contable', f: b => `${b.account} ${accName(b.account)}` }], META.banks, { onRow: async b => { if (canEdit() && await bankDialog(b)) { await refreshMeta(); render(); } } }));
    const pw = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Mi contraseña'), h('button', { class: 'btn sm', type: 'button', onclick: () => passwordDialog() }, 'Cambiar contraseña')), h('div', { class: 'muted small' }, `Sesión: ${ME.name} (${ME.username}) · ${{ admin: 'Administrador', contador: 'Contador', consulta: 'Consulta' }[ME.role]}`));
    const usersBox = ME.isAdmin ? await usersPanel() : null;
    return h('div', { class: 'stack' }, phead('Configuración', ''), company, usersBox, lock, banks, accs, pw);
  });
  function bankDialog(b) {
    const v = b ? { ...b } : { name: '', number: '', account: '' };
    const body = h('div', { class: 'form' }, field('Nombre', inp({ value: v.name, placeholder: 'BBVA cuenta principal', onchange: e => { v.name = e.target.value; } }), 'span2'), field('Número o CLABE', inp({ value: v.number || '', onchange: e => { v.number = e.target.value; } }), 'span2'),
      field('Cuenta contable', accSelect(v.account, { onchange: e => { v.account = e.target.value; } }, a => ['BK', 'LC'].includes(a.type)), 'span2'));
    return dialog(b ? 'Editar cuenta bancaria' : 'Nueva cuenta bancaria', body, [{ label: 'Cancelar' }, { label: 'Guardar', primary: true, run: () => post('/api/acc/banks', v) }]);
  }
  function passwordDialog() {
    const v = { current: '', next: '', again: '' };
    const body = h('div', { class: 'form' }, field('Contraseña actual', inp({ type: 'password', autocomplete: 'current-password', onchange: e => { v.current = e.target.value; } }), 'span2'), field('Nueva (mínimo 10 caracteres)', inp({ type: 'password', autocomplete: 'new-password', onchange: e => { v.next = e.target.value; } })), field('Repite la nueva', inp({ type: 'password', autocomplete: 'new-password', onchange: e => { v.again = e.target.value; } })));
    return dialog('Cambiar contraseña', body, [{ label: 'Cancelar' }, { label: 'Cambiar', primary: true, run: async () => { if (v.next !== v.again) throw new Error('Las contraseñas nuevas no coinciden.'); await post('/api/password', { current: v.current, next: v.next }); toast('Contraseña cambiada.'); } }]);
  }
  async function usersPanel() {
    const u = await get('/api/acc/users');
    const roleTxt = { admin: 'Todo: expedientes, comidas, contabilidad y usuarios', contador: 'Contabilidad: capturar, publicar, pagar, cerrar', consulta: 'Contabilidad: solo ver y descargar reportes', personal: 'Solo expedientes del personal' };
    return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Usuarios'), h('button', { class: 'btn sm primary', type: 'button', onclick: async () => { if (await userDialog(null, u.roles)) render(); } }, '+ Nuevo usuario')),
      table([{ t: 'Nombre', k: 'name', cls: 'w' }, { t: 'Usuario', k: 'username', cls: 'mono' }, { t: 'Rol', f: x => h('span', {}, x.roleLabel, h('div', { class: 'muted small' }, roleTxt[x.role])) }, { t: 'Último acceso', f: x => x.lastLogin ? fts(x.lastLogin) : 'Nunca' }, { t: 'Estado', f: x => x.active ? badge('posted', 'Activo') : badge('cancelled', 'Desactivado') }],
        [{ id: null, name: u.owner + ' (dueño)', username: u.owner, roleLabel: 'Administrador', role: 'admin', active: true, lastLogin: null, owner: true }, ...u.users],
        { onRow: async x => { if (!x.owner && await userDialog(x, u.roles)) render(); } }),
      h('div', { class: 'muted small' }, 'Cada persona entra con su propio usuario; la bitácora registra quién hizo cada cambio. Al cambiar el rol o desactivar a alguien, su sesión se cierra.'));
  }
  function userDialog(x, roles) {
    const v = x ? { name: x.name, role: x.role, active: x.active, password: '' } : { username: '', name: '', role: 'contador', password: '' };
    const body = h('div', { class: 'form' },
      x ? field('Usuario', inp({ value: x.username, disabled: true })) : field('Usuario (para entrar)', inp({ value: '', autocomplete: 'off', placeholder: 'maria.lopez', onchange: e => { v.username = e.target.value; } })),
      field('Nombre', inp({ value: v.name, onchange: e => { v.name = e.target.value; } })),
      field('Rol', sel(Object.entries(roles), v.role, { onchange: e => { v.role = e.target.value; } }), 'span2'),
      field(x ? 'Nueva contraseña (déjala vacía para no cambiarla)' : 'Contraseña inicial (mínimo 10 caracteres)', inp({ type: 'password', autocomplete: 'new-password', onchange: e => { v.password = e.target.value; } }), 'span2'),
      x ? h('label', { class: 'check span2' }, inp({ type: 'checkbox', checked: v.active, onchange: e => { v.active = e.target.checked; } }), 'Activo (puede entrar)') : null);
    return dialog(x ? 'Editar usuario' : 'Nuevo usuario', body, [{ label: 'Cancelar' }, { label: 'Guardar', primary: true, run: () => (x ? put('/api/acc/users/' + x.id, v) : post('/api/acc/users', v)) }]);
  }

  /* ================= AUDIT ================= */
  route(/^auditoria$/, async () => {
    const rows = await get('/api/acc/audit?limit=1000');
    return h('div', { class: 'stack' }, phead('Bitácora', 'Quién hizo qué y cuándo. Los últimos 1,000 movimientos.'),
      table([{ t: 'Fecha', f: r => fts(r.ts), cls: 'nowrap' }, { t: 'Usuario', k: 'user' }, { t: 'Acción', f: r => `${r.action} ${r.kind}` }, { t: 'Detalle', k: 'detail', cls: 'w' }], rows, { tall: 1, empty: 'Sin movimientos.' }));
  });

  /* ---------- boot ---------- */
  $('#navToggle').addEventListener('click', () => { const n = $('#nav'); n.classList.toggle('open'); $('#navToggle').setAttribute('aria-expanded', String(n.classList.contains('open'))); });
  window.addEventListener('hashchange', render);
  (async () => {
    try { await refreshMeta(); }
    catch (e) { clear(main); add(main, [h('div', { class: 'msg bad' }, e.message)]); return; }
    add(clear($('#me')), [h('b', {}, ME.name), { admin: 'Administrador', contador: 'Contador', consulta: 'Consulta', personal: 'Personal' }[ME.role]]);
    render();
  })();
})();

'use strict';
/* Central dashboard: greeting, cross-tool attention items and one card per tool with live numbers. */
(() => {
  const $ = s => document.querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'class') el.className = v; else el.setAttribute(k, v); }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
    return el;
  }
  const SVG = 'http://www.w3.org/2000/svg';
  function icon(paths) {
    const s = document.createElementNS(SVG, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
    for (const d of paths) { const [tag, attrs] = d; const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); s.append(e); }
    return s;
  }
  const IC = {
    exp: [['circle', { cx: 9, cy: 8, r: 3.5 }], ['path', { d: 'M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5' }], ['path', { d: 'M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.7 2.6 3 5.2' }]],
    com: [['path', { d: 'M6 3v7a2 2 0 0 0 4 0V3M8 10v11' }], ['path', { d: 'M17 21V3c-2.2 1.3-3.5 3.8-3.5 7v3H17' }]],
    acc: [['path', { d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }]],
    go: [['path', { d: 'M5 12h14M13 6l6 6-6 6' }]],
  };
  const NF = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
  const num = n => NF.format(Math.round(n || 0));
  const money = n => { const a = Math.abs(n || 0), s = n < 0 ? '-' : ''; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)} M` : a >= 1e4 ? `${s}$${num(a / 1e3)} k` : `${s}$${num(a)}`; };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const shortD = s => s ? `${+s.slice(8, 10)} ${MES[+s.slice(5, 7) - 1]}` : '';
  const dayTxt = n => n < 0 ? `venció hace ${-n} d` : n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} d`;
  const PAL = ['#7041b8', '#d4511b', '#1d7f47', '#2f6fb3', '#9a6410', '#b42727', '#5b6470', '#0f8a8a'];

  const met = (value, label, cls, href) => h(href ? 'a' : 'div', { class: 'met ' + (cls || ''), href }, h('b', {}, value), h('span', {}, label));
  function card(key, cls, title, desc, href, body) {
    return h('article', { class: 'tool ' + cls },
      h('a', { class: 'tool-head', href }, h('div', { class: 'tool-ic' }, icon(IC[key])), h('div', {}, h('h2', {}, title), h('p', {}, desc))),
      h('div', { class: 'tool-body' }, body),
      h('a', { class: 'tool-go', href }, 'Abrir ' + title.toLowerCase(), icon(IC.go)));
  }
  function bars(series, keyA, keyB, labels) {
    const max = Math.max(1, ...series.map(s => Math.max(s[keyA] || 0, keyB ? s[keyB] || 0 : 0)));
    const wrap = h('div', { class: 'minibars' }, series.map(s => {
      const a = h('i', { title: `${s.label}: ${num(s[keyA])}` }); a.style.height = (s[keyA] || 0) / max * 100 + '%';
      const kids = [a];
      if (keyB) { const b = h('i', { class: 'alt' }); b.style.height = (s[keyB] || 0) / max * 100 + '%'; kids.unshift(b); }
      return h('div', { class: 'mb' }, kids);
    }));
    return [wrap, h('div', { class: 'minix' }, series.map(s => h('span', { title: s.label }, labels(s))))];
  }

  function expedientes(t) {
    const total = t.plants.reduce((a, p) => a + p.n, 0) || 1;
    const sb = h('div', { class: 'stackbar' }, t.plants.map((p, i) => { const e = h('i', { title: `${p.name}: ${p.n}` }); e.style.width = p.n / total * 100 + '%'; e.style.background = PAL[i % PAL.length]; return e; }));
    const keys = h('div', { class: 'keys' }, t.plants.slice(0, 6).map((p, i) => { const sw = h('i'); sw.style.background = PAL[i % PAL.length]; return h('span', {}, sw, `${p.name} ${p.n}`); }));
    const list = [...t.alerts.map(a => h('div', { class: 'item2' }, h('span', {}, `${a.name} · ${a.what}`), h('em', { class: a.days < 0 ? 'bad' : 'warn' }, dayTxt(a.days)))),
      ...t.nextBirthdays.slice(0, Math.max(1, 4 - t.alerts.length)).map(b => h('div', { class: 'item2' }, h('span', {}, `🎂 ${b.name}`), h('em', { class: 'bday' }, b.days === 0 ? 'hoy' : dayTxt(b.days))))];
    return card('exp', 't-exp', 'Expedientes', 'Personal, capacitaciones y cumpleaños.', '/expedientes', [
      h('div', { class: 'mets' }, met(num(t.total), 'Empleados activos', 'tc'), met(num(t.expired), 'Capacitaciones vencidas', t.expired ? 'bad' : 'good'), met(num(t.expiring), 'Vencen en 30 días', t.expiring ? 'warn' : ''), met(num(t.birthdays), 'Cumpleaños en 30 días')),
      h('div', { class: 'viz' }, h('div', { class: 'viz-h' }, h('span', {}, 'Plantilla por planta'), h('span', {}, `${t.plants.length} plantas`)), sb, keys),
      h('div', { class: 'viz' }, h('div', { class: 'viz-h' }, 'Próximos avisos'), list.length ? h('div', { class: 'items' }, list) : h('div', { class: 'none' }, 'Sin avisos en los próximos 30 días.')),
    ]);
  }
  function comidas(t) {
    const l = t.last;
    return card('com', 't-com', 'Comidas', 'Nuevos ingresos al reporte DELPHI.', '/comidas', [
      h('div', { class: 'mets' }, met(num(t.added30), 'Comidas agregadas, 30 días', 'tc'), met(num(t.runs30), 'Conciliaciones, 30 días'),
        met(l ? num(l.employees) : '—', 'Nuevos ingresos, última'), met(l && l.confFinal != null ? `${Math.round(l.confFinal)}%` : '—', 'Confianza de lectura', l && l.confFinal != null ? (l.confFinal >= 90 ? 'good' : 'warn') : '')),
      t.series.length ? h('div', { class: 'viz' }, h('div', { class: 'viz-h' }, h('span', {}, 'Comidas agregadas por semana'), h('span', {}, `${t.runs} en total`)), bars(t.series, 'added', null, s => String(s.label || '').replace(/^.*?(\d{1,2}\s*(al|-)\s*\d{1,2}).*$/i, '$1') || '·')) : null,
      h('div', { class: 'viz' }, h('div', { class: 'viz-h' }, 'Última conciliación'), l ? h('div', { class: 'items' },
        h('div', { class: 'item2' }, h('span', {}, l.label || 'Semana'), h('em', {}, shortD(String(l.at).slice(0, 10)))),
        h('div', { class: 'item2' }, h('span', {}, 'Comidas en el reporte'), h('em', {}, num(l.meals))),
        h('div', { class: 'item2' }, h('span', {}, 'Puntos por revisar'), h('em', { class: l.pending ? 'warn' : '' }, num(l.pending || 0)))) : h('div', { class: 'none' }, 'Aún no hay conciliaciones. Sube las fotos y el reporte DELPHI para empezar.')),
    ]);
  }
  function contabilidad(t) {
    const mm = s => MES[+s.month.slice(5, 7) - 1];
    return card('acc', 't-acc', 'Contabilidad', 'Facturas, pagos, IVA y reportes.', '/contabilidad', [
      h('div', { class: 'mets' }, met(money(t.payable), t.payableOverdue > 0 ? `Por pagar · ${money(t.payableOverdue)} vencido` : 'Por pagar a proveedores', t.payableOverdue > 0 ? 'bad' : '', '/contabilidad#/reportes/aging?side=ap'),
        met(money(t.receivable), t.receivableOverdue > 0 ? `Por cobrar · ${money(t.receivableOverdue)} vencido` : 'Por cobrar a clientes', 'tc', '/contabilidad#/reportes/aging?side=ar'),
        met(money(t.banks), 'Bancos y caja', '', '/contabilidad#/reportes/cashflow'), met(num(t.drafts), 'Borradores por revisar', t.drafts ? 'warn' : 'good', '/contabilidad#/docs/ap?state=draft')),
      h('div', { class: 'viz' }, h('div', { class: 'viz-h' }, h('span', {}, 'Ventas y compras'), h('span', {}, `Utilidad ${mm(t)}: ${money(t.pnl.net)}`)), bars(t.series.map(s => ({ ...s, label: s.month })), 'sales', 'purchases', mm),
        h('div', { class: 'keys' }, h('span', {}, h('i', { class: 'k-s' }), 'Ventas'), h('span', {}, h('i', { class: 'k-p' }), 'Compras'))),
      h('div', { class: 'viz' }, h('div', { class: 'viz-h' }, 'Pagos que vencen esta semana'), t.dueSoon.length ? h('div', { class: 'items' }, t.dueSoon.map(d => h('div', { class: 'item2' }, h('span', {}, `${d.partner} · ${shortD(d.due)}`), h('em', {}, money(d.amount))))) : h('div', { class: 'none' }, 'Nada vence en los próximos 7 días.')),
    ]);
  }

  function attention(T) {
    const out = [];
    const A = (href, txt, cls) => out.push(h('a', { href, class: cls || '' }, h('i'), txt));
    if (T.expedientes) {
      if (T.expedientes.expired) A('/expedientes', `${T.expedientes.expired} capacitaciones vencidas`, 'bad');
      if (T.expedientes.expiring) A('/expedientes', `${T.expedientes.expiring} vencen este mes`);
      const b = T.expedientes.nextBirthdays.filter(x => x.days <= 7);
      if (b.length) A('/expedientes', b.length === 1 ? `Cumpleaños: ${b[0].name.split(' ')[0]} ${b[0].days === 0 ? 'hoy' : dayTxt(b[0].days)}` : `${b.length} cumpleaños esta semana`, 'ok');
    }
    if (T.comidas && T.comidas.last && T.comidas.last.pending) A('/comidas', `${T.comidas.last.pending} lecturas de comidas por revisar`);
    if (T.contabilidad) {
      if (T.contabilidad.payableOverdue > 0) A('/contabilidad#/docs/ap?pay=vencido', `${money(T.contabilidad.payableOverdue)} vencido con proveedores`, 'bad');
      if (T.contabilidad.drafts) A('/contabilidad#/docs/ap?state=draft', `${T.contabilidad.drafts} facturas en borrador`);
    }
    if (!out.length) A('#', 'Todo al día', 'ok');
    return out;
  }

  const hr = +new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Ciudad_Juarez' });
  $('#today').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Ciudad_Juarez' }).replace(/^./, c => c.toUpperCase());
  fetch('/api/hub').then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('Sesión expirada.'); } if (!r.ok) throw new Error('No se pudo cargar el resumen.'); return r.json(); }).then(d => {
    const first = String(d.user.name || '').split(/\s+/)[0];
    $('#greet').textContent = `${hr < 12 ? 'Buenos días' : hr < 19 ? 'Buenas tardes' : 'Buenas noches'}${first ? ', ' + first.charAt(0).toUpperCase() + first.slice(1) : ''}`;
    const tools = $('#tools'); tools.replaceChildren();
    const cards = [d.tools.expedientes && expedientes(d.tools.expedientes), d.tools.comidas && comidas(d.tools.comidas), d.tools.contabilidad && contabilidad(d.tools.contabilidad)].filter(Boolean);
    tools.className = 'tools n' + cards.length; tools.append(...cards);
    $('#attn').replaceChildren(...attention(d.tools));
  }).catch(e => { $('#tools').replaceChildren(h('div', { class: 'loading' }, e.message)); });
})();

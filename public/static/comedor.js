'use strict';
/* Meal Counter: counts from the comedor PCs, stations, the client's card list and the billing report. */
(() => {
  const $ = s => document.querySelector(s);
  const F = (u, o) => (window.aveFetch || fetch)(u, o);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
    return el;
  }
  async function api(url, opt) {
    const r = await F(url, opt);
    if (r.status === 401) { location.href = '/login'; throw new Error('Sesión expirada.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }
  const DL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const dm = ymd => `${ymd.slice(8)}/${ymd.slice(5, 7)}`;
  const dow = ymd => DL[new Date(ymd + 'T12:00:00Z').getUTCDay()];
  const num = n => (n || 0).toLocaleString('es-MX');
  const money = n => (n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const when = iso => iso ? new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Ciudad_Juarez' }) : '';
  const ago = iso => { if (!iso) return 'nunca'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`; };
  const bar = (frac, cls) => { const i = h('i', { class: cls || '' }); i.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; return h('div', { class: 't' }, i); };

  let PLANT = (() => { try { return localStorage.getItem('comedorPlant') || ''; } catch (e) { return ''; } })();
  let S = null;
  const q = (u, extra) => `${u}?planta=${encodeURIComponent(PLANT)}${extra ? '&' + extra : ''}`;

  async function load() {
    S = await api(q('/api/comedor/state'));
    PLANT = S.plant.id;
    $('#plantTabs').replaceChildren(...S.plants.map(p => h('button', { type: 'button', role: 'tab', 'aria-selected': String(p.id === PLANT), onclick: () => { if (p.id === PLANT) return; PLANT = p.id; try { localStorage.setItem('comedorPlant', PLANT); } catch (e) { /* ok */ } load(); } }, `${p.client} · ${p.name}`)));
    $('#eyebrow').textContent = `Grupo AVE · Comedor ${S.plant.name}`;
    const live = S.stations.filter(s => !s.revoked);
    const fresh = live.some(s => s.lastSync && Date.now() - Date.parse(s.lastSync) < 3 * 3600e3);
    $('#mets').replaceChildren(
      h('div', { class: 'met' }, h('b', {}, num(S.todayTotal)), h('span', {}, 'comidas hoy (hasta la última sincronización)')),
      h('div', { class: 'met' + (S.todayUnknown ? ' warn' : '') }, h('b', {}, num(S.todayUnknown)), h('span', {}, 'hoy con tarjeta no registrada')),
      h('div', { class: 'met' }, h('b', {}, num(S.week.total)), h('span', {}, 'comidas esta semana')),
      h('div', { class: 'met' }, h('b', {}, S.settings.price ? money(S.week.amount) : '—'), h('span', {}, S.settings.price ? `a ${money(S.settings.price)} por comida` : 'falta el precio por comida')),
      h('div', { class: 'met' + (fresh ? ' ok' : ' warn') }, h('b', {}, live.length), h('span', {}, 'estaciones')));
    const warn = [];
    if (!S.cards.count) warn.push(h('div', { class: 'msg warn' }, 'Falta subir la lista de tarjetas del cliente (abajo, Configuración). Sin ella todas las comidas salen como "tarjeta no registrada".'));
    if (!live.length) warn.push(h('div', { class: 'msg warn' }, 'Todavía no hay estación. Crea una en Configuración, descarga el programa e instálalo en la PC del comedor.'));
    for (const s of live) {
      if (!s.lastSync) warn.push(h('div', { class: 'msg warn' }, `La estación "${s.name}" todavía no se conecta. Instala el programa en la PC del comedor y pega su código.`));
      else if (Date.now() - Date.parse(s.lastSync) > 3 * 3600e3) warn.push(h('div', { class: 'msg warn' }, `La estación "${s.name}" no se sincroniza desde ${when(s.lastSync)}. Puede ser el internet de la planta: sigue contando y manda todo cuando vuelva.`));
    }
    $('#warn').replaceChildren(...warn);
    // week
    const max = Math.max(1, ...S.week.days.map(d => d.total));
    $('#wkLabel').textContent = `del ${dm(S.week.from)}`;
    $('#week').replaceChildren(h('div', { class: 'wbars' }, S.week.days.map(d => h('div', { class: 'wbar' + (d.ymd === S.today ? ' today' : '') }, h('span', {}, `${dow(d.ymd)} ${dm(d.ymd)}`), bar(d.total / max), h('span', { class: 'n' }, num(d.total))))));
    const hm = Math.max(1, ...S.todayHours);
    $('#hours').replaceChildren(...S.todayHours.map((n, i) => { const b = h('i', { title: `${i}:00 · ${n} comidas` }); b.style.height = Math.round(n / hm * 100) + '%'; return h('div', { class: 'h' }, b, h('span', {}, i % 3 === 0 ? String(i) : '')); }));
    $('#last').replaceChildren(S.last.length ? h('table', { class: 'hist' }, h('thead', {}, h('tr', {}, ['Hora', 'Tarjeta', 'Nombre'].map(t => h('th', {}, t)))),
      h('tbody', {}, S.last.map(m => h('tr', {}, h('td', {}, m.time), h('td', {}, m.card || '—'), h('td', {}, m.known ? m.name : h('span', { class: 'unk' }, !m.card && !m.emp ? 'Manual, sin tarjeta' : `No registrada${m.src === 'manual' ? ' (manual)' : ''}`)))))) : h('p', { class: 'muted small' }, 'Sin comidas hoy todavía (o la PC no ha sincronizado).'));
    // stations
    $('#stations').replaceChildren(live.length ? h('table', { class: 'hist' }, h('thead', {}, h('tr', {}, ['Estación', 'Última sincronización', 'Pendientes en la PC', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, live.map(s => h('tr', {}, h('td', {}, h('b', {}, s.name), h('div', { class: 'muted small' }, `creada ${when(s.createdAt)}${s.version ? ' · v' + s.version : ''}`)),
        h('td', {}, s.lastSync ? `${when(s.lastSync)} (${ago(s.lastSync)})` : h('span', { class: 'pill warn' }, 'nunca')), h('td', { class: 'n' }, s.pending || 0),
        h('td', {}, h('button', { class: 'btn sm quiet', type: 'button', onclick: async () => { if (!confirm(`¿Desactivar la estación "${s.name}"? Su código deja de funcionar; la PC sigue contando pero no podrá enviar hasta que le pegues uno nuevo.`)) return; await api('/api/comedor/stations/' + s.id, { method: 'DELETE' }); load(); } }, 'Desactivar')))))) : h('p', { class: 'muted small' }, 'Sin estaciones.'));
    $('#cards').replaceChildren(h('div', {}, h('span', {}, 'Tarjetas activas'), h('b', {}, num(S.cards.count))), S.cards.file ? h('div', {}, h('span', {}, 'Último archivo'), h('b', {}, `${S.cards.file} (${when(S.cards.at)})`)) : null);
    $('#price').value = S.settings.price || ''; $('#deb').value = S.settings.debounceSec ?? 10;
    if (!$('#from').value) { $('#from').value = S.week.from; $('#to').value = S.today; }
    report();
  }

  async function report() {
    const from = $('#from').value, to = $('#to').value; if (!from || !to) return;
    $('#xls').href = q('/api/comedor/excel', `desde=${from}&hasta=${to}`);
    try {
      const r = await api(q('/api/comedor/report', `desde=${from}&hasta=${to}`));
      $('#rep').replaceChildren(
        h('div', { class: 'mets' }, h('div', { class: 'met' }, h('b', {}, num(r.total)), h('span', {}, 'comidas')), h('div', { class: 'met' }, h('b', {}, num(r.known)), h('span', {}, 'con tarjeta registrada')),
          h('div', { class: 'met' + (r.unknown ? ' warn' : '') }, h('b', {}, num(r.unknown)), h('span', {}, 'tarjeta no registrada')), h('div', { class: 'met' }, h('b', {}, r.price ? money(r.amount) : '—'), h('span', {}, 'importe'))),
        h('div', { class: 'cgrid' },
          h('div', {}, h('h3', { class: 'sub' }, 'Por día'), h('table', { class: 'hist' }, h('thead', {}, h('tr', {}, ['Día', 'Comidas', 'No registradas', 'Manuales'].map(t => h('th', {}, t)))),
            h('tbody', {}, r.days.map(d => h('tr', {}, h('td', {}, `${dow(d.ymd)} ${dm(d.ymd)}`), h('td', { class: 'n' }, num(d.total)), h('td', { class: 'n' }, d.unknown ? num(d.unknown) : ''), h('td', { class: 'n' }, d.manual ? num(d.manual) : '')))))),
          h('div', {}, h('h3', { class: 'sub' }, 'Tarjetas no registradas'), r.unknownCards.length ? h('table', { class: 'hist' }, h('thead', {}, h('tr', {}, ['Tarjeta', 'Comidas', 'Última'].map(t => h('th', {}, t)))),
            h('tbody', {}, r.unknownCards.slice(0, 60).map(u => h('tr', {}, h('td', {}, u.card || (u.emp ? `emp ${u.emp}` : 'sin tarjeta (manual)')), h('td', { class: 'n' }, u.count), h('td', {}, u.last.replace('T', ' ').slice(0, 16)))))) : h('p', { class: 'muted small' }, 'Ninguna.'),
            h('p', { class: 'muted small' }, 'Si una tarjeta es de alguien que sí trabaja en la planta, pide a seguridad el reporte de accesos actualizado y súbelo: sus comidas pasan a "registradas".'))));
    } catch (e) { $('#rep').replaceChildren(h('div', { class: 'msg bad' }, e.message)); }
  }
  $('#run').addEventListener('click', report);

  $('#newSt').addEventListener('click', async () => {
    const name = prompt('Nombre de la estación (ej. Comedor principal):', 'Comedor principal'); if (!name) return;
    try {
      const r = await api('/api/comedor/stations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planta: PLANT, name }) });
      const copy = h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(r.token); copy.textContent = 'Copiado'; } catch (e) { copy.textContent = 'Selecciónalo y cópialo'; } } }, 'Copiar');
      $('#token').replaceChildren(h('div', { class: 'tokenbox' }, h('b', {}, `Código de la estación "${r.station.name}"`), h('code', {}, r.token), copy, h('p', { class: 'muted small' }, 'Pégalo en el programa de la PC (Administración → Configuración). Solo se muestra esta vez: si se pierde, crea otra estación y desactiva esta.')));
      load();
    } catch (e) { $('#token').replaceChildren(h('div', { class: 'msg bad' }, e.message)); }
  });
  $('#cardFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('planta', PLANT); fd.append('file', f);
    $('#cardMsg').replaceChildren(h('div', { class: 'msg warn' }, 'Leyendo el Excel…'));
    try { const r = await api('/api/comedor/cards', { method: 'POST', body: fd }); $('#cardMsg').replaceChildren(h('div', { class: 'msg' }, `Listo: ${num(r.count)} tarjetas${r.added && r.added < r.count ? `, ${r.added} nuevas` : ''}${r.removed ? `, ${r.removed} ya no están` : ''}${r.externos ? ` (${r.externos} marcadas EXTERNO)` : ''}.`)); load(); }
    catch (err) { $('#cardMsg').replaceChildren(h('div', { class: 'msg bad' }, err.message)); }
    e.target.value = '';
  });
  $('#saveSet').addEventListener('click', async () => {
    try { await api('/api/comedor/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planta: PLANT, price: $('#price').value || 0, debounceSec: $('#deb').value }) }); $('#setMsg').textContent = 'Guardado.'; load(); }
    catch (e) { $('#setMsg').textContent = e.message; }
  });
  load().catch(e => $('#warn').replaceChildren(h('div', { class: 'msg bad' }, e.message)));
})();

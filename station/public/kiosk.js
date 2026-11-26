'use strict';
/* Screen next to the terminal: each new punch shows the person's name, so they know it registered. */
(() => {
  const $ = s => document.querySelector(s);
  const el = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const k of kids) if (k != null) e.append(k); return e; };
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const SRC = { face: '', manual: 'manual', import: 'archivo', finger: 'huella', card: 'tarjeta', pin: 'clave' };
  const ago = iso => { if (!iso) return 'nunca'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`; };
  const hm = iso => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  let seen = null, helloT = null;
  function tick() { const d = new Date(); $('#time').textContent = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); $('#date').textContent = `${DIAS[d.getDay()]} ${d.getDate()} de ${MES[d.getMonth()]}`; }
  async function load() {
    let s; try { s = await (await fetch('/api/live', { cache: 'no-store' })).json(); } catch (e) { return; }
    $('#where').textContent = [s.plant && s.plant.name, s.station && s.station.name].filter(Boolean).join(' · ') || 'Checador';
    const first = seen === null, ids = new Set(s.today.map(p => p.emp + p.time));
    const fresh = first ? [] : s.today.filter(p => !seen.has(p.emp + p.time));
    seen = ids;
    $('#count').textContent = `${s.todayCount} checadas`;
    $('#today').replaceChildren(...(s.today.length ? s.today.map((p, i) => el('li', fresh.includes(p) ? 'fresh' : '', el('span', 't', p.time), el('span', 'n', p.name || 'Sin nombre', el('span', 'id', `#${p.emp}`)), el('span', 'muted small', SRC[p.src] || ''))) : [el('li', '', el('span', 'muted', 'Todavía nadie ha checado hoy.'))]));
    $('#inCount').textContent = `${s.inside.length} personas`;
    $('#inside').replaceChildren(...s.inside.map(p => el('li', '', el('span', 't', p.since), el('span', 'n', p.name || 'Sin nombre', el('span', 'id', `#${p.emp}`)), el('span', 'muted small', p.shift || ''))));
    if (fresh.length) {
      const p = fresh[0];
      $('#hello').textContent = `${p.name || 'Empleado #' + p.emp} · ${p.time} · registrado`;
      $('#hello').hidden = false; clearTimeout(helloT); helloT = setTimeout(() => { $('#hello').hidden = true; }, 5000);
    }
    const d = s.device, kinds = { none: 'Sin terminal configurada', 'zk-pull': 'Terminal', 'zk-push': 'Terminal', hik: 'Terminal' };
    $('#dev').replaceChildren(el('span', 'dot ' + (d.kind === 'none' ? 'warn' : d.ok ? 'ok' : 'bad')), d.kind === 'none' ? kinds.none : d.ok ? `Terminal conectada · leída ${ago(d.lastRead)}` : `Terminal sin conexión${d.error ? ': ' + d.error : ''}`);
    const y = s.sync;
    $('#net').replaceChildren(el('span', 'dot ' + (!s.configured.token ? 'warn' : y.lastError ? 'warn' : 'ok')),
      !s.configured.token ? 'Falta configurar la sincronización' : y.lastError ? `Sin internet desde ${hm(y.offlineSince || y.lastTry)} · ${y.pending} checadas guardadas en esta PC, se envían al volver` : `Enviado a gpoave.com ${ago(y.lastSync)}${y.pending ? ` · ${y.pending} por enviar` : ''}`);
    const warn = s.clockWarning || (!s.configured.pin ? 'Falta configurar este checador: abre Administración.' : null);
    $('#banner').hidden = !warn; $('#banner').textContent = warn || '';
  }
  tick(); setInterval(tick, 1000); load(); setInterval(load, 3000);
})();

'use strict';
/* The pcProx Plus types the card number and Enter, like a very fast keyboard. This page listens to the keyboard,
   takes only input typed at reader speed (a person typing a number by hand is ignored), and registers the meal. */
(() => {
  const $ = s => document.querySelector(s);
  const el = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const k of kids) if (k != null) e.append(k); return e; };
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const ago = iso => { if (!iso) return 'nunca'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`; };
  const hm = iso => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  /* sound: one beep = OK, two low beeps = card not on the list */
  let ac = null;
  const beep = (freqs) => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); freqs.forEach((f, i) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; o.connect(g); g.connect(ac.destination); const t = ac.currentTime + i * 0.18; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15); o.start(t); o.stop(t + 0.16); }); } catch (e) { /* no sound */ } };

  let idleT = null;
  function show(kind, state, who, sub) {
    const h = $('#hero'); h.className = 'hero ' + kind;
    $('#state').textContent = state; $('#who').textContent = who || ''; $('#sub').textContent = sub || '';
    clearTimeout(idleT); idleT = setTimeout(() => show('', 'Pasa tu gafete por el lector', '', ''), 4000);
  }

  /* keyboard from the reader */
  let buf = '', lastKey = 0, slow = false, flushT = null;
  async function submit() {
    clearTimeout(flushT);
    const raw = buf; buf = '';
    if (!raw || slow) { slow = false; return; }
    try {
      const r = await (await fetch('/api/swipe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) })).json();
      if (!r.ok) return;
      $('#count').textContent = r.count;
      if (r.repeat) show('rep', 'Ya quedó registrada', r.name || `Tarjeta ${r.card}`, 'No se cuenta dos veces');
      else if (r.known) { beep([1320]); show('ok', 'Buen provecho', r.name, `Comida registrada · ${r.time}`); }
      else { beep([440, 440]); show('unk', 'Tarjeta no registrada', `#${r.card}`, 'La comida se registró y queda para revisión'); }
      load();
    } catch (e) { show('unk', 'Error al registrar', '', 'Vuelve a pasar el gafete'); }
  }
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const now = performance.now();
    if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
    if (e.key.length !== 1 || !/[0-9a-fA-F,:;\- ]/.test(e.key)) return;
    e.preventDefault();
    if (buf && now - lastKey > 80) slow = true; // a reader types much faster than a person
    if (!buf) slow = false;
    buf += e.key; lastKey = now;
    clearTimeout(flushT); flushT = setTimeout(submit, 250); // readers set without Enter
  });
  window.addEventListener('blur', () => { $('#focus').hidden = false; });
  window.addEventListener('focus', () => { $('#focus').hidden = true; });
  $('#focus').addEventListener('click', () => { $('#focus').hidden = true; window.focus(); });

  function tick() { const d = new Date(); $('#time').textContent = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); $('#date').textContent = `${DIAS[d.getDay()]} ${d.getDate()} de ${MES[d.getMonth()]}`; }
  async function load() {
    let s; try { s = await (await fetch('/api/live', { cache: 'no-store' })).json(); } catch (e) { return; }
    $('#where').textContent = [s.plant && s.plant.name, s.station && s.station.name].filter(Boolean).join(' · ') || 'Comedor';
    $('#count').textContent = s.count;
    $('#unk').textContent = s.unknown ? `${s.unknown} con tarjeta no registrada` : '';
    $('#last').replaceChildren(...s.last.map(m => el('li', m.known ? '' : 'u', el('b', '', m.time), el('span', '', m.known ? m.name : m.card ? `No registrada #${m.card}${m.src === 'manual' ? ' (manual)' : ''}` : 'Manual, sin tarjeta'))));
    const y = s.sync;
    $('#net').replaceChildren(el('span', 'dot ' + (!s.configured.token || y.lastError ? 'warn' : 'ok')),
      !s.configured.token ? 'Falta configurar la sincronización' : y.lastError ? `Sin internet desde ${hm(y.offlineSince || y.lastTry)} · ${y.pending} comidas guardadas en esta PC, se envían al volver` : `Enviado a gpoave.com ${ago(y.lastSync)}${y.pending ? ` · ${y.pending} por enviar` : ''}`);
    $('#cards').textContent = s.configured.cards ? `${s.configured.cards} tarjetas en la lista` : 'Sin lista de tarjetas: todas salen como no registradas hasta la primera sincronización';
    const warn = s.clockWarning || (!s.configured.pin ? 'Falta configurar este Meal Counter: abre Administración.' : null);
    $('#banner').hidden = !warn; $('#banner').textContent = warn || '';
  }
  tick(); setInterval(tick, 1000); load(); setInterval(load, 15000);
  setTimeout(() => { if (!document.hasFocus()) $('#focus').hidden = false; }, 1500);
})();

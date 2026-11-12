'use strict';
/* While the server restarts after an update (about a minute), Render answers 502/503.
   Reads wait and retry quietly with a small notice; writes get a clear message instead of "Error 502". */
(() => {
  const BUSY = [502, 503, 504];
  let note = null;
  function notice(on) {
    if (on && !note) {
      note = document.createElement('div');
      note.setAttribute('role', 'status');
      note.textContent = 'Actualizando el sistema… un momento, se reconecta solo.';
      Object.assign(note.style, { position: 'fixed', left: '50%', top: '14px', transform: 'translateX(-50%)', zIndex: '99', background: '#1F2328', color: '#fff', padding: '9px 16px', borderRadius: '999px', font: '600 14px/1.3 system-ui,sans-serif', boxShadow: '0 6px 20px rgba(0,0,0,.25)' });
      document.body.append(note);
    } else if (!on && note) { note.remove(); note = null; }
  }
  window.aveFetch = async function (url, opt = {}) {
    const read = !opt.method || opt.method === 'GET';
    for (let i = 0; ; i++) {
      let r = null;
      try { r = await fetch(url, opt); } catch (e) { if (!read || i >= 40) throw new Error('Sin conexión con el sistema. Revisa tu internet e intenta de nuevo.'); }
      if (r && !BUSY.includes(r.status)) { notice(false); return r; }
      if (!read) { notice(false); return new Response(JSON.stringify({ error: 'El sistema se está actualizando. Espera un minuto e intenta de nuevo; no se guardó nada.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }); }
      if (i >= 40) { notice(false); return r; }
      notice(true);
      await new Promise(res => setTimeout(res, 3000));
    }
  };
})();

(function () {
  const f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go');
  document.getElementById('u').focus();
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    err.hidden = true; go.disabled = true; go.textContent = 'Entrando…';
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: document.getElementById('u').value.trim(), password: document.getElementById('p').value }),
      });
      if (r.ok) { const j = await r.json().catch(() => ({})); location.href = j.home || '/app'; return; }
      const j = await r.json().catch(() => ({}));
      err.textContent = j.error || 'No se pudo iniciar sesión.'; err.hidden = false;
      document.getElementById('p').value = ''; document.getElementById('p').focus();
    } catch (e) {
      err.textContent = 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'; err.hidden = false;
    } finally { go.disabled = false; go.textContent = 'Iniciar sesión'; }
  });
})();

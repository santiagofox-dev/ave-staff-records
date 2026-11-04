(function () {
  const f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go');
  document.getElementById('u').focus();
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    err.hidden = true; go.disabled = true; go.textContent = 'Signing in…';
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: document.getElementById('u').value.trim(), password: document.getElementById('p').value }),
      });
      if (r.ok) { location.href = '/'; return; }
      const j = await r.json().catch(() => ({}));
      err.textContent = j.error || 'Could not sign in.'; err.hidden = false;
      document.getElementById('p').value = ''; document.getElementById('p').focus();
    } catch (e) {
      err.textContent = 'No connection to the server. Check your internet and try again.'; err.hidden = false;
    } finally { go.disabled = false; go.textContent = 'Sign in'; }
  });
})();

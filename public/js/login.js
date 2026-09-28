'use strict';

// Sign-in page: email + password, then an authenticator (or backup) code when
// two-factor is on. Talks to Better Auth's endpoints under /api/auth.

// Same theme as the dashboard, applied before first paint.
document.documentElement.setAttribute('data-theme', (() => {
  try { return localStorage.getItem('dash-theme') || 'light'; } catch (_) { return 'light'; }
})());

document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const errorBox = $('auth-error');
  let backupMode = false;

  // Only same-site paths: never redirect to another host after sign-in.
  const next = (() => {
    const n = new URLSearchParams(location.search).get('next') || '/';
    return /^\/(?![/\\])/.test(n) ? n : '/';
  })();

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = message ? 'block' : 'none';
  }

  async function post(path, body) {
    const r = await fetch('/api/auth' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }

  function busy(form, on) {
    form.querySelectorAll('button, input').forEach(el => { el.disabled = on; });
  }

  function failureMessage(res) {
    if (res.status === 429) return 'Too many attempts. Wait a minute and try again.';
    return res.data.message || 'Sign-in failed. Try again.';
  }

  $('password-step').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = $('email').value.trim(), password = $('password').value;
    if (!email || !password) return showError('Enter your email and password.');
    showError('');
    busy(form, true);
    const res = await post('/sign-in/email', { email, password }).catch(() => null);
    busy(form, false);
    if (!res) return showError('Could not reach the server. Check your connection.');
    if (!res.ok) { $('password').value = ''; return showError(res.status === 401 ? 'Wrong email or password.' : failureMessage(res)); }
    if (res.data.twoFactorRedirect) {
      form.hidden = true;
      $('code-step').hidden = false;
      $('code').focus();
      return;
    }
    location.replace(next);
  });

  $('use-backup').addEventListener('click', () => {
    backupMode = !backupMode;
    $('code-label').textContent = backupMode ? 'Backup code' : 'Authentication code';
    $('code').setAttribute('inputmode', backupMode ? 'text' : 'numeric');
    $('use-backup').textContent = backupMode ? 'Use your authenticator app instead' : 'Use a backup code instead';
    $('code').value = '';
    $('code').focus();
  });

  $('code-step').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const code = $('code').value.replace(/\s+/g, '');
    if (!code) return showError('Enter the code.');
    showError('');
    busy(form, true);
    const res = await post(backupMode ? '/two-factor/verify-backup-code' : '/two-factor/verify-totp',
      { code, trustDevice: $('trust-device').checked }).catch(() => null);
    busy(form, false);
    if (!res) return showError('Could not reach the server. Check your connection.');
    if (!res.ok) { $('code').value = ''; return showError(res.status === 401 ? 'That code didn’t work. Try the current one.' : failureMessage(res)); }
    location.replace(next);
  });
});

'use strict';

// Sign-in page. The password is always required. With two-factor on, a second
// step follows: Touch ID (a passkey on this computer), a code emailed to the
// account address, or the authenticator app / a backup code if set up.
// Talks to Better Auth's endpoints under /api/auth.

// Same theme as the dashboard, applied before first paint.
document.documentElement.setAttribute('data-theme', (() => {
  try { return localStorage.getItem('dash-theme') || 'light'; } catch (_) { return 'light'; }
})());

document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const errorBox = $('auth-error');
  let mode = null;    // 'email' | 'totp' | 'backup' while the code form is shown
  let methods = null; // what this account can use as a second step

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
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }

  function busy(el, on) {
    el.querySelectorAll('button, input').forEach(x => { x.disabled = on; });
  }

  function failureMessage(res) {
    if (res.status === 429) return 'Too many attempts. Wait a minute and try again.';
    return res.data.message || 'Sign-in failed. Try again.';
  }

  function show(step) {
    ['password-step', 'method-step', 'code-step'].forEach(id => { $(id).hidden = id !== step; });
  }

  // ── Step 1: password ──────────────────────────────────────────────────────
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
    if (res.data.twoFactorRedirect) return showMethods();
    location.replace(next);
  });

  // ── Step 2: choose how to confirm ─────────────────────────────────────────
  async function showMethods() {
    const res = await post('/second-factor/methods').catch(() => null);
    methods = res?.ok ? res.data : { email: '', totp: true, backupCodes: true, passkey: false };
    const canTouchId = methods.passkey && await passkeySupported();
    const options = [
      canTouchId && { id: 'passkey', icon: 'ph-fingerprint', label: 'Touch ID', sub: 'This computer’s fingerprint sensor', primary: true },
      methods.email && { id: 'email', icon: 'ph-envelope-simple', label: 'Email me a code', sub: `Sent to ${methods.email}`, primary: !canTouchId },
      methods.totp && { id: 'totp', icon: 'ph-device-mobile', label: 'Authenticator app', sub: 'A 6-digit code from the app' },
      methods.backupCodes && { id: 'backup', icon: 'ph-key', label: 'Backup code', sub: 'One of the codes you saved' },
    ].filter(Boolean);
    $('auth-methods').innerHTML = options.map(o => `
      <button type="button" class="auth-method${o.primary ? ' primary' : ''}" data-method="${o.id}">
        <i class="ph-bold ${o.icon}" aria-hidden="true"></i>
        <span class="auth-method-text"><span class="auth-method-label">${o.label}</span><span class="auth-method-sub">${o.sub}</span></span>
        <i class="ph-bold ph-caret-right auth-method-go" aria-hidden="true"></i>
      </button>`).join('');
    $('auth-methods').querySelectorAll('[data-method]').forEach(b => b.addEventListener('click', () => chooseMethod(b.dataset.method, b)));
    showError('');
    show('method-step');
    $('auth-methods').querySelector('button')?.focus();
  }

  async function chooseMethod(id, button) {
    showError('');
    if (id === 'passkey') return touchId(button);
    if (id === 'email') {
      busy($('method-step'), true);
      const res = await post('/two-factor/send-otp').catch(() => null);
      busy($('method-step'), false);
      if (!res?.ok) return showError(res ? failureMessage(res) : 'Could not reach the server.');
    }
    openCode(id);
  }

  async function touchId(button) {
    busy($('method-step'), true);
    button.classList.add('waiting');
    try {
      await passkeySecondFactor();
      location.replace(next);
    } catch (err) {
      const message = err.status ? err.message : passkeyErrorMessage(err);
      if (message) showError(message);
      if (err.status === 401 && /expired|password/i.test(err.message)) setTimeout(() => location.reload(), 1500);
    } finally {
      busy($('method-step'), false);
      button.classList.remove('waiting');
    }
  }

  // ── Step 3: a code (email, authenticator app, backup) ─────────────────────
  function openCode(which) {
    mode = which;
    const hints = {
      email: `We emailed a 6-digit code to ${methods.email}. It expires in 5 minutes.`,
      totp: 'Enter the 6-digit code from your authenticator app.',
      backup: 'Enter one of your backup codes. Each works once.',
    };
    $('code-hint').textContent = hints[which];
    $('code-label').textContent = which === 'backup' ? 'Backup code' : 'Code';
    $('code').setAttribute('inputmode', which === 'backup' ? 'text' : 'numeric');
    $('code').value = '';
    $('resend-code').hidden = which !== 'email';
    show('code-step');
    $('code').focus();
  }

  $('other-method').addEventListener('click', () => { showError(''); show('method-step'); });

  $('resend-code').addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    const res = await post('/two-factor/send-otp').catch(() => null);
    e.currentTarget.disabled = false;
    showError(res?.ok ? '' : (res ? failureMessage(res) : 'Could not reach the server.'));
  });

  $('code-step').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const code = $('code').value.replace(/\s+/g, '');
    if (!code) return showError('Enter the code.');
    showError('');
    busy(form, true);
    const path = { email: '/two-factor/verify-otp', totp: '/two-factor/verify-totp', backup: '/two-factor/verify-backup-code' }[mode];
    const res = await post(path, { code, trustDevice: $('trust-device').checked }).catch(() => null);
    busy(form, false);
    if (!res) return showError('Could not reach the server. Check your connection.');
    if (!res.ok) { $('code').value = ''; return showError(res.status === 401 ? 'That code didn’t work. Check it and try again.' : failureMessage(res)); }
    location.replace(next);
  });
});

'use strict';

// ─── account ──────────────────────────────────────────────────────────────────
// The signed-in account: sign out, and two-factor authentication (TOTP) setup.
// All actions go through Better Auth's endpoints under /api/auth.

async function authPost(path, body = {}) {
  const r = await fetch('/api/auth' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 429 ? 'Too many attempts. Wait a minute and try again.' : (data.message || `Request failed (${r.status})`));
  return data;
}

async function signOut() {
  await authPost('/sign-out').catch(() => {});
  location.replace('/login');
}

function accountMsg(text, ok = false) {
  const el = document.getElementById('acct-msg');
  if (!el) return;
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
  el.style.color = ok ? 'var(--success)' : 'var(--warn)';
  el.style.borderColor = ok ? 'var(--success)' : 'var(--warn)';
}

// QR code for the otpauth:// URI, drawn by qrcode-generator (loaded on demand).
function loadQrLib() {
  if (window.qrcode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    s.integrity = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
    s.crossOrigin = 'anonymous';
    s.onload = resolve; s.onerror = () => reject(new Error('QR library failed to load'));
    document.head.appendChild(s);
  });
}

async function renderAccountView() {
  const el = document.getElementById('account-content');
  const session = await fetch('/api/auth/get-session', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!session?.user) { location.replace('/login?next=' + encodeURIComponent('/#account')); return; }
  const u = session.user;
  const on = !!u.twoFactorEnabled;

  el.innerHTML = `
    <div style="display:grid;gap:16px;max-width:560px">
      <div class="ov-card">
        <div class="ov-card-hd">Signed in</div>
        <div style="font-size:14px;font-weight:600;color:var(--champagne)">${esc(u.name || u.email)}</div>
        <div style="font-size:13px;color:var(--muted);margin-top:2px">${esc(u.email)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button class="btn-ghost btn-sm" id="acct-signout"><i class="ph-bold ph-sign-out"></i> Sign out</button>
          <button class="btn-ghost btn-sm" id="acct-signout-others">Sign out other devices</button>
        </div>
      </div>

      <div class="ov-card">
        <div class="ov-card-hd">Two-factor authentication
          <span class="cur-badge ${on ? 'cur-badge-success' : 'cur-badge-neutral'}">${on ? 'On' : 'Off'}</span>
        </div>
        <p style="font-size:13px;color:var(--muted);margin:0 0 12px">
          ${on ? 'Sign-in asks for a code from your authenticator app.'
               : 'Add a second step to sign-in: a 6-digit code from an authenticator app.'}
        </p>
        <div id="acct-2fa">
          <label class="form-field" style="max-width:280px">
            <span class="form-label">Confirm your password</span>
            <input class="form-input" id="acct-pw" type="password" autocomplete="current-password">
          </label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            ${on
              ? `<button class="btn-ghost btn-sm" id="acct-2fa-codes">New backup codes</button>
                 <button class="btn-ghost btn-sm" id="acct-2fa-off">Turn off</button>`
              : `<button class="btn-primary btn-sm" id="acct-2fa-on">Turn on</button>`}
          </div>
        </div>
      </div>
      <div class="form-error" id="acct-msg" role="alert"></div>
    </div>`;

  document.getElementById('acct-signout').addEventListener('click', signOut);
  document.getElementById('acct-signout-others').addEventListener('click', async () => {
    try { await authPost('/revoke-other-sessions'); accountMsg('Every other device was signed out.', true); }
    catch (e) { accountMsg(e.message); }
  });

  const password = () => document.getElementById('acct-pw').value;
  const bind = (id, fn) => document.getElementById(id)?.addEventListener('click', async e => {
    accountMsg('');
    if (!password()) return accountMsg('Enter your password first.');
    e.currentTarget.disabled = true;
    try { await fn(); } catch (err) { accountMsg(err.message); e.currentTarget.disabled = false; }
  });

  bind('acct-2fa-on', async () => {
    const { totpURI, backupCodes } = await authPost('/two-factor/enable', { password: password() });
    showTotpEnrollment(totpURI, backupCodes);
  });
  bind('acct-2fa-off', async () => {
    await authPost('/two-factor/disable', { password: password() });
    renderAccountView();
  });
  bind('acct-2fa-codes', async () => {
    const { backupCodes } = await authPost('/two-factor/generate-backup-codes', { password: password() });
    document.getElementById('acct-2fa').innerHTML = backupCodesHTML(backupCodes, 'Your old backup codes no longer work.');
  });
}

function backupCodesHTML(codes, note) {
  return `
    <div class="form-label" style="margin-bottom:6px">Backup codes</div>
    <p style="font-size:12px;color:var(--muted);margin:0 0 8px">Each works once if you lose your authenticator. Store them somewhere safe. ${esc(note || '')}</p>
    <pre style="font-size:13px;line-height:1.7;background:var(--raised);border:1px solid var(--rule);border-radius:var(--r-sm);padding:10px 14px;margin:0;user-select:all">${codes.map(esc).join('\n')}</pre>`;
}

async function showTotpEnrollment(totpURI, backupCodes) {
  const secret = new URL(totpURI).searchParams.get('secret') || '';
  const box = document.getElementById('acct-2fa');
  box.innerHTML = `
    <ol style="font-size:13px;color:var(--body-text);padding-left:18px;margin:0 0 12px;display:grid;gap:10px">
      <li>Scan this code with an authenticator app (1Password, Google Authenticator, Authy…).
        <div id="acct-qr" style="margin-top:10px;background:#fff;display:block;width:max-content;padding:10px;border-radius:var(--r-sm)"></div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">Or enter this key: <code style="user-select:all;letter-spacing:.05em">${esc(secret)}</code></div>
      </li>
      <li>Save your backup codes.<div style="margin-top:8px">${backupCodesHTML(backupCodes)}</div></li>
      <li>Enter the 6-digit code the app shows to finish.
        <div style="display:flex;gap:8px;margin-top:8px;max-width:280px">
          <input class="form-input" id="acct-totp" inputmode="numeric" autocomplete="one-time-code" placeholder="123456">
          <button class="btn-primary btn-sm" id="acct-totp-verify">Verify</button>
        </div>
      </li>
    </ol>`;

  loadQrLib().then(() => {
    const qr = window.qrcode(0, 'M');
    qr.addData(totpURI);
    qr.make();
    document.getElementById('acct-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
  }).catch(() => { document.getElementById('acct-qr').style.display = 'none'; });

  document.getElementById('acct-totp-verify').addEventListener('click', async e => {
    const code = document.getElementById('acct-totp').value.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) return accountMsg('Enter the 6-digit code from your app.');
    e.currentTarget.disabled = true;
    try {
      await authPost('/two-factor/verify-totp', { code });
      await renderAccountView();
      accountMsg('Two-factor authentication is on.', true);
    } catch (err) { accountMsg(err.message); e.currentTarget.disabled = false; }
  });
}

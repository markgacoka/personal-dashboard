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

      <div class="ov-card" id="acct-passkeys"></div>

      <div class="ov-card">
        <div class="ov-card-hd">Two-factor authentication
          <span class="cur-badge ${on ? 'cur-badge-success' : 'cur-badge-neutral'}">${on ? 'On' : 'Off'}</span>
        </div>
        <p style="font-size:13px;color:var(--muted);margin:0 0 12px">
          ${on ? 'After your password, sign-in asks you to confirm it’s you: Touch ID (if you’ve added a passkey below), a code emailed to ' + esc(u.email) + ', your authenticator app, or a backup code.'
               : 'Add a second step after your password: Touch ID, a code emailed to ' + esc(u.email) + ', or an authenticator app.'}
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

  renderPasskeys();
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

// ─── passkeys ─────────────────────────────────────────────────────────────────
// Touch ID sign-in. Adding one needs a recent sign-in (Better Auth's "fresh
// session", under a day old); signing in with it skips the authenticator code.
async function renderPasskeys(message) {
  const box = document.getElementById('acct-passkeys');
  if (!box) return;
  const [supported, list] = await Promise.all([
    passkeySupported(),
    fetch('/api/auth/passkey/list-user-passkeys', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : []).catch(() => []),
  ]);
  const fmt = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  box.innerHTML = `
    <div class="ov-card-hd">Passkeys
      <span class="cur-badge ${list.length ? 'cur-badge-success' : 'cur-badge-neutral'}">${list.length ? 'On' : 'Off'}</span>
    </div>
    <p style="font-size:13px;color:var(--muted);margin:0 0 12px">After your password, confirm sign-in with this laptop's fingerprint (Touch ID) instead of typing a code. Used only when two-factor authentication is on.</p>
    ${list.length ? `<div class="acct-pk-list">${list.map(pk => `
      <div class="acct-pk" data-id="${esc(pk.id)}">
        <i class="ph-bold ph-fingerprint acct-pk-icon" aria-hidden="true"></i>
        <div class="acct-pk-main">
          <div class="acct-pk-name">${esc(pk.name || 'Passkey')}</div>
          <div class="acct-pk-meta">Added ${esc(fmt(pk.createdAt))}${pk.backedUp ? ' · synced across your devices' : ' · this computer only'}</div>
        </div>
        <button class="btn-ghost btn-sm" data-pk-rename>Rename</button>
        <button class="btn-ghost btn-sm" data-pk-remove>Remove</button>
      </div>`).join('')}</div>` : ''}
    ${supported
      ? `<button class="btn-primary btn-sm" id="acct-pk-add"><i class="ph-bold ph-fingerprint"></i> Add a passkey on this computer</button>`
      : `<p style="font-size:13px;color:var(--faint);margin:0">This browser or computer can't create passkeys. Use Safari or Chrome on a Mac with Touch ID.</p>`}
    <div class="acct-pk-msg" id="acct-pk-msg" role="status"></div>`;

  const say = (text, ok = false) => {
    const el = document.getElementById('acct-pk-msg');
    el.textContent = text || '';
    el.style.color = ok ? 'var(--success)' : 'var(--warn)';
  };
  if (message) say(message, true);

  document.getElementById('acct-pk-add')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true; say('');
    try {
      await passkeyRegister(passkeyDefaultName());
      await renderPasskeys('Passkey added. Next time, choose "Sign in with Touch ID".');
    } catch (err) {
      btn.disabled = false;
      if (err.status === 403 || /fresh/i.test(err.message)) return say('For security, adding a passkey needs a recent sign-in. Sign out, sign back in with your password, then add it.');
      const text = passkeyErrorMessage(err);
      if (text) say(text);
    }
  });

  box.querySelectorAll('[data-pk-remove]').forEach(b => b.addEventListener('click', () => {
    const row = b.closest('.acct-pk');
    const wrap = document.createElement('span');
    wrap.className = 'row-confirm';
    wrap.innerHTML = `<span class="row-confirm-label">Remove this passkey?</span><button class="btn-ghost btn-sm">Remove</button><button class="btn-link">Cancel</button>`;
    b.replaceWith(wrap);
    const [yes, no] = wrap.querySelectorAll('button');
    no.addEventListener('click', () => renderPasskeys());
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      const r = await fetch('/api/auth/passkey/delete-passkey', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.dataset.id }) }).catch(() => null);
      if (!r?.ok) { yes.disabled = false; return say('Could not remove the passkey. Try again.'); }
      renderPasskeys('Passkey removed. Also delete it from System Settings → Passwords on the Mac.');
    });
  }));

  box.querySelectorAll('[data-pk-rename]').forEach(b => b.addEventListener('click', () => {
    const row = b.closest('.acct-pk');
    const nameEl = row.querySelector('.acct-pk-name');
    const form = document.createElement('form');
    form.className = 'acct-pk-rename';
    form.innerHTML = `<input class="form-input" maxlength="60" aria-label="Passkey name"><button class="btn-primary btn-sm" type="submit">Save</button><button class="btn-link" type="button">Cancel</button>`;
    form.querySelector('input').value = nameEl.textContent;
    nameEl.replaceWith(form);
    row.querySelectorAll('[data-pk-rename],[data-pk-remove]').forEach(x => { x.hidden = true; });
    form.querySelector('input').focus();
    form.querySelector('[type=button]').addEventListener('click', () => renderPasskeys());
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const name = form.querySelector('input').value.trim();
      if (!name) return form.querySelector('input').focus();
      const r = await fetch('/api/auth/passkey/update-passkey', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.dataset.id, name }) }).catch(() => null);
      if (!r?.ok) return say('Could not rename the passkey.');
      renderPasskeys();
    });
  }));
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
    <p style="font-size:13px;color:var(--success);margin:0 0 10px">Two-factor is on. Sign-in will offer Touch ID (once you add a passkey) or an emailed code.</p>
    <ol style="font-size:13px;color:var(--body-text);padding-left:18px;margin:0 0 12px;display:grid;gap:10px">
      <li>Save your backup codes.<div style="margin-top:8px">${backupCodesHTML(backupCodes)}</div></li>
      <li>Optional: scan this with an authenticator app (1Password, Google Authenticator, Authy…) to use it as another way in.
        <div id="acct-qr" style="margin-top:10px;background:#fff;display:block;width:max-content;padding:10px;border-radius:var(--r-sm)"></div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">Or enter this key: <code style="user-select:all;letter-spacing:.05em">${esc(secret)}</code></div>
      </li>
      <li>If you scanned it, check a code from the app works.
        <div style="display:flex;gap:8px;margin-top:8px;max-width:280px">
          <input class="form-input" id="acct-totp" inputmode="numeric" autocomplete="one-time-code" placeholder="123456">
          <button class="btn-ghost btn-sm" id="acct-totp-verify">Check</button>
        </div>
      </li>
    </ol>
    <button class="btn-primary btn-sm" id="acct-2fa-done">Done</button>`;
  document.getElementById('acct-2fa-done').addEventListener('click', () => renderAccountView());

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
      accountMsg('That code works. Your authenticator app is set up.', true);
      e.currentTarget.disabled = false;
    } catch (err) { accountMsg(err.message); e.currentTarget.disabled = false; }
  });
}

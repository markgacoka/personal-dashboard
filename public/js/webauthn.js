'use strict';

// ─── passkeys (WebAuthn) ──────────────────────────────────────────────────────
// Shared by the sign-in page and the Account view. Converts between the JSON
// the server sends/expects (base64url binary fields) and the browser's
// WebAuthn API, and runs the two ceremonies against Better Auth's passkey
// endpoints. Loaded before sign-in, so it is on the gate's public allowlist.

function b64urlToBuf(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(s).length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function webauthnCreationOptions(json) {
  if (window.PublicKeyCredential?.parseCreationOptionsFromJSON) return PublicKeyCredential.parseCreationOptionsFromJSON(json);
  return {
    ...json,
    challenge: b64urlToBuf(json.challenge),
    user: { ...json.user, id: b64urlToBuf(json.user.id) },
    excludeCredentials: (json.excludeCredentials || []).map(c => ({ ...c, id: b64urlToBuf(c.id) })),
  };
}

function webauthnRequestOptions(json) {
  if (window.PublicKeyCredential?.parseRequestOptionsFromJSON) return PublicKeyCredential.parseRequestOptionsFromJSON(json);
  return {
    ...json,
    challenge: b64urlToBuf(json.challenge),
    allowCredentials: (json.allowCredentials || []).map(c => ({ ...c, id: b64urlToBuf(c.id) })),
  };
}

function webauthnCredentialJSON(cred) {
  try { if (typeof cred.toJSON === 'function') return cred.toJSON(); } catch (_) { /* fall through */ }
  const r = cred.response;
  const response = { clientDataJSON: bufToB64url(r.clientDataJSON) };
  if (r.attestationObject) {
    response.attestationObject = bufToB64url(r.attestationObject);
    response.transports = typeof r.getTransports === 'function' ? r.getTransports() : [];
  }
  if (r.authenticatorData) response.authenticatorData = bufToB64url(r.authenticatorData);
  if (r.signature) response.signature = bufToB64url(r.signature);
  if (r.userHandle) response.userHandle = bufToB64url(r.userHandle);
  return {
    id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type, response,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
  };
}

// True when this computer has a built-in authenticator that checks who you
// are (Touch ID, Windows Hello).
async function passkeySupported() {
  try {
    return !!window.PublicKeyCredential &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (_) { return false; }
}

async function passkeyAutofillSupported() {
  try { return !!(await PublicKeyCredential.isConditionalMediationAvailable?.()); } catch (_) { return false; }
}

// Human-readable reason a ceremony stopped; null when the person just cancelled.
function passkeyErrorMessage(err) {
  if (!err) return 'Something went wrong. Try again.';
  if (err.name === 'AbortError') return null;
  if (err.name === 'NotAllowedError') return null; // cancelled, timed out, or no passkey chosen
  if (err.name === 'InvalidStateError') return 'This computer already has a passkey for this site.';
  if (err.name === 'SecurityError') return 'Passkeys only work on the site’s own address (https://gacoka.com).';
  return err.message || 'Something went wrong. Try again.';
}

async function passkeyFetch(path, init) {
  const r = await fetch('/api/auth/passkey' + path, { credentials: 'same-origin', ...init });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(r.status === 429 ? 'Too many attempts. Wait a minute and try again.' : (data.message || `Request failed (${r.status})`));
    err.status = r.status; err.code = data.code;
    throw err;
  }
  return data;
}

// Sign in. `conditional` offers the passkey in the email field's autofill
// instead of opening a dialog; `signal` cancels a pending request.
async function passkeySignIn({ conditional = false, signal } = {}) {
  const options = await passkeyFetch('/generate-authenticate-options', { method: 'GET' });
  const cred = await navigator.credentials.get({
    publicKey: webauthnRequestOptions(options),
    ...(conditional ? { mediation: 'conditional' } : {}),
    ...(signal ? { signal } : {}),
  });
  return passkeyFetch('/verify-authentication', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: webauthnCredentialJSON(cred) }),
  });
}

// Add a passkey on this computer for the signed-in account.
async function passkeyRegister(name) {
  const q = new URLSearchParams({ authenticatorAttachment: 'platform', name });
  const options = await passkeyFetch('/generate-register-options?' + q, { method: 'GET' });
  const cred = await navigator.credentials.create({ publicKey: webauthnCreationOptions(options) });
  return passkeyFetch('/verify-registration', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: webauthnCredentialJSON(cred), name }),
  });
}

// A default name for this computer's passkey, e.g. "Mac (Touch ID)".
function passkeyDefaultName(ua = navigator.userAgent) {
  if (/Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) return 'Mac (Touch ID)';
  if (/Windows/.test(ua)) return 'Windows Hello';
  if (/iPhone/.test(ua)) return 'iPhone (Face ID)';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  return 'This computer';
}

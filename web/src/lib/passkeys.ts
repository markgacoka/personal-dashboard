// WebAuthn glue for adding a passkey from the Account page. Passkeys are only
// ever a second sign-in step after the password (see api/src/lib/passkeySecondFactor.js).

const toBuf = (s: string) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer
}
const toB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

type PKC = typeof PublicKeyCredential & { parseCreationOptionsFromJSON?: (j: unknown) => PublicKeyCredentialCreationOptions }

function creationOptions(json: Record<string, unknown> & { challenge: string; user: { id: string }; excludeCredentials?: { id: string }[] }): PublicKeyCredentialCreationOptions {
  const P = window.PublicKeyCredential as PKC
  if (P?.parseCreationOptionsFromJSON) return P.parseCreationOptionsFromJSON(json)
  return { ...json, challenge: toBuf(json.challenge), user: { ...json.user, id: toBuf(json.user.id) }, excludeCredentials: (json.excludeCredentials || []).map(c => ({ ...c, id: toBuf(c.id) })) } as unknown as PublicKeyCredentialCreationOptions
}

function credentialJSON(cred: PublicKeyCredential) {
  try { const j = (cred as unknown as { toJSON?: () => unknown }).toJSON?.(); if (j) return j } catch { /* fall through */ }
  const r = cred.response as AuthenticatorAttestationResponse
  return {
    id: cred.id, rawId: toB64(cred.rawId), type: cred.type,
    response: { clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject), transports: r.getTransports?.() || [] },
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
  }
}

export async function passkeySupported() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() } catch { return false }
}

export function passkeyError(err: unknown): string | null {
  const e = err as { name?: string; message?: string }
  if (!e) return 'Something went wrong. Try again.'
  if (e.name === 'AbortError' || e.name === 'NotAllowedError') return null
  if (e.name === 'InvalidStateError') return 'This computer already has a passkey for this site.'
  if (e.name === 'SecurityError') return 'Passkeys only work on the site’s own address (https://gacoka.com).'
  return e.message || 'Something went wrong. Try again.'
}

async function pk<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch('/api/auth/passkey' + path, { credentials: 'same-origin', ...init })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(r.status === 429 ? 'Too many attempts. Wait a minute and try again.' : (data.message || `Request failed (${r.status})`)), { status: r.status })
  return data
}

export async function registerPasskey(name: string) {
  const options = await pk<Parameters<typeof creationOptions>[0]>('/generate-register-options?' + new URLSearchParams({ authenticatorAttachment: 'platform', name }))
  const cred = await navigator.credentials.create({ publicKey: creationOptions(options) }) as PublicKeyCredential
  return pk('/verify-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: credentialJSON(cred), name }) })
}

export function defaultPasskeyName(ua = navigator.userAgent) {
  if (/Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) return 'Mac (Touch ID)'
  if (/Windows/.test(ua)) return 'Windows Hello'
  if (/iPhone/.test(ua)) return 'iPhone (Face ID)'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  return 'This computer'
}

export function describeDevice(ua?: string) {
  const s = String(ua || '')
  const browser = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'A browser'
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /Linux/.test(s) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

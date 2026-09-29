// Passkeys: the browser helpers (loaded from the file the browser runs) and
// the server's policy (built-in authenticator, fingerprint required, origin
// pinned, refusal when the device didn't verify the user).
// Run: npm test (no database or browser needed).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const fe = (() => {
  const ctx = vm.createContext({ atob, btoa, Uint8Array, String, Math, window: {}, navigator: { userAgent: '' } })
  vm.runInContext(readFileSync(new URL('../../../public/js/webauthn.js', import.meta.url), 'utf8') +
    '\n;globalThis.__exports = { b64urlToBuf, bufToB64url, webauthnCredentialJSON, passkeyErrorMessage, passkeyDefaultName, webauthnCreationOptions };', ctx)
  return ctx.__exports
})()

describe('passkey browser helpers', () => {
  test('base64url round-trips binary, without padding or +/', () => {
    const bytes = new Uint8Array([251, 255, 0, 1, 62, 63, 254])
    const s = fe.bufToB64url(bytes.buffer)
    assert.doesNotMatch(s, /[+/=]/)
    assert.deepEqual([...new Uint8Array(fe.b64urlToBuf(s))], [...bytes])
  })
  test('creation options decode the challenge and user id (fallback path)', () => {
    const o = fe.webauthnCreationOptions({ challenge: 'AQID', user: { id: 'BAU', name: 'x' }, excludeCredentials: [{ id: 'Bg', type: 'public-key' }] })
    assert.deepEqual([...new Uint8Array(o.challenge)], [1, 2, 3])
    assert.deepEqual([...new Uint8Array(o.user.id)], [4, 5])
    assert.deepEqual([...new Uint8Array(o.excludeCredentials[0].id)], [6])
  })
  test('an assertion serialises to the JSON the server verifies', () => {
    const buf = a => new Uint8Array(a).buffer
    const json = fe.webauthnCredentialJSON({
      id: 'abc', rawId: buf([1]), type: 'public-key', authenticatorAttachment: 'platform',
      response: { clientDataJSON: buf([2]), authenticatorData: buf([3]), signature: buf([4]), userHandle: buf([5]) },
      getClientExtensionResults: () => ({}),
    })
    assert.equal(json.rawId, 'AQ')
    assert.deepEqual({ ...json.response }, { clientDataJSON: 'Ag', authenticatorData: 'Aw', signature: 'BA', userHandle: 'BQ' })
  })
  test('cancelling says nothing; real problems explain themselves', () => {
    assert.equal(fe.passkeyErrorMessage({ name: 'NotAllowedError' }), null)
    assert.equal(fe.passkeyErrorMessage({ name: 'AbortError' }), null)
    assert.match(fe.passkeyErrorMessage({ name: 'InvalidStateError' }), /already has a passkey/)
    assert.match(fe.passkeyErrorMessage({ name: 'SecurityError' }), /gacoka\.com/)
  })
  test('default device names', () => {
    assert.equal(fe.passkeyDefaultName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)'), 'Mac (Touch ID)')
    assert.equal(fe.passkeyDefaultName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows Hello')
  })
})

describe('passkey server policy', async () => {
  process.env.BETTER_AUTH_URL ||= 'https://gacoka.com'
  process.env.BETTER_AUTH_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef'
  const { auth } = await import('../auth.js')
  const { maskEmail } = await import('../lib/passkeySecondFactor.js')
  const plugin = id => auth.options.plugins.find(p => p.id === id)
  const opts = plugin('passkey')?.options || {}

  test('passkeys are a second step only: password-less passkey sign-in is switched off', () => {
    assert.ok(auth.options.disabledPaths.includes('/passkey/verify-authentication'))
    assert.ok(auth.options.disabledPaths.includes('/passkey/generate-authenticate-options'))
    assert.ok(plugin('passkey-second-factor'))
    assert.equal(opts.authentication, undefined)
  })
  test('two-factor offers emailed codes and can be on without an authenticator app', () => {
    const tf = plugin('two-factor').options
    assert.equal(typeof tf.otpOptions.sendOTP, 'function')
    assert.equal(tf.otpOptions.storeOTP, 'hashed')
    assert.equal(tf.skipVerificationOnEnable, true)
  })
  test('only built-in authenticators, with user verification', () => {
    assert.equal(opts.authenticatorSelection.authenticatorAttachment, 'platform')
    assert.equal(opts.authenticatorSelection.userVerification, 'required')
  })
  test('relying party and origin are pinned to the site', () => {
    assert.equal(opts.rpID, new URL(process.env.BETTER_AUTH_URL).hostname)
    assert.equal(opts.origin, new URL(process.env.BETTER_AUTH_URL).origin)
  })
  test('adding a passkey is refused unless the device verified the user', () => {
    const reg = opts.registration.afterVerification
    assert.throws(() => reg({ verification: { registrationInfo: { userVerified: false } } }), /confirm it is you/)
    assert.doesNotThrow(() => reg({ verification: { registrationInfo: { userVerified: true } } }))
  })
  test('second-step endpoints and emailed codes are rate limited', () => {
    const rules = auth.options.rateLimit.customRules
    assert.ok(rules['/second-factor/*'].max <= 15)
    assert.ok(rules['/two-factor/send-otp'].max <= 3)
  })
  test('the email address is masked on the sign-in page', () => {
    assert.equal(maskEmail('markgacoka@gmail.com'), 'm••••••@gmail.com')
    assert.equal(maskEmail('ab@x.test'), 'a••@x.test')
    assert.equal(maskEmail('nope'), '')
  })
})

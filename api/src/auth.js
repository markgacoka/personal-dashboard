// Authentication (Better Auth): one owner account, email + password with
// optional TOTP two-factor, plus passkeys (Touch ID on the laptop). Sessions
// live in Postgres; public sign-up is off and the account is managed with
// api/src/cli/account.mjs.
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { pool } from './db/client.js'

const baseURL = process.env.BETTER_AUTH_URL || 'https://gacoka.com'

// A passkey stands in for password + second factor only when the device
// checked who is using it (fingerprint, or the device password as fallback),
// not mere presence. The plugin doesn't enforce that, so both ceremonies do.
function requireUserVerified(info) {
  if (!info?.userVerified) {
    throw new APIError('UNAUTHORIZED', { message: 'Your device must confirm it is you (fingerprint or device password)' })
  }
}
const secret = process.env.BETTER_AUTH_SECRET

if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
  throw new Error('BETTER_AUTH_SECRET must be set (32+ characters) in production')
}

export const auth = betterAuth({
  appName: 'gacoka.com',
  baseURL,
  basePath: '/api/auth',
  secret,
  database: pool,
  trustedOrigins: [baseURL],
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,     // extended at most once a day while in use
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/two-factor/*': { window: 60, max: 5 },
      '/passkey/verify-authentication': { window: 60, max: 10 },
    },
  },
  advanced: {
    useSecureCookies: baseURL.startsWith('https://'),
    // Traefik replaces any client-supplied X-Forwarded-For with the real
    // client address, so this header is safe to key rate limits on.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
  },
  telemetry: { enabled: false },
  plugins: [
    twoFactor({ issuer: 'gacoka.com' }),
    // Signing in with a passkey skips the TOTP step: the passkey is already
    // two factors (the device, and the fingerprint that unlocks it).
    passkey({
      rpID: new URL(baseURL).hostname,
      rpName: 'gacoka.com',
      origin: new URL(baseURL).origin, // never taken from the request
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // built into this computer (Touch ID), not a phone or key
        residentKey: 'required',             // sign in without typing an email
        userVerification: 'required',
      },
      registration: { afterVerification: ({ verification }) => requireUserVerified(verification.registrationInfo) },
      authentication: { afterVerification: ({ verification }) => requireUserVerified(verification.authenticationInfo) },
    }),
  ],
})

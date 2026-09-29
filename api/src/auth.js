// Authentication (Better Auth): one owner account. The password is always
// required; with two-factor on, sign-in then asks for a second step: Touch ID
// (a passkey on the laptop), a code emailed to the account address, or the
// authenticator app / a backup code if those are set up. Sessions live in
// Postgres; public sign-up is off and the account is managed with
// api/src/cli/account.mjs.
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { pool } from './db/client.js'
import { passkeySecondFactor } from './lib/passkeySecondFactor.js'
import { sendSystemEmail } from './services/mail.js'

const baseURL = process.env.BETTER_AUTH_URL || 'https://gacoka.com'
const rpID = new URL(baseURL).hostname
const origin = new URL(baseURL).origin // never taken from the request
const secret = process.env.BETTER_AUTH_SECRET

if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
  throw new Error('BETTER_AUTH_SECRET must be set (32+ characters) in production')
}

// A passkey only counts when the device checked who is using it (fingerprint,
// or the device password as fallback), not mere presence.
function requireUserVerified(info) {
  if (!info?.userVerified) {
    throw new APIError('UNAUTHORIZED', { message: 'Your device must confirm it is you (fingerprint or device password)' })
  }
}

async function emailSignInCode({ user, otp }) {
  await sendSystemEmail({
    to: user.email,
    subject: `${otp} is your gacoka.com sign-in code`,
    text: `Your sign-in code is ${otp}\n\nIt expires in 5 minutes. If you didn't just enter your password at gacoka.com, change it now: someone else knows it.`,
    html: `<p>Your gacoka.com sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:8px 0">${otp}</p>` +
      `<p style="color:#666">It expires in 5 minutes. If you didn't just enter your password at gacoka.com, change it now: someone else knows it.</p>`,
  })
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
  // Passkeys are a second step, never a replacement for the password: the
  // passkey plugin's own password-less sign-in is switched off.
  disabledPaths: ['/passkey/generate-authenticate-options', '/passkey/verify-authentication'],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/two-factor/*': { window: 60, max: 5 },
      '/two-factor/send-otp': { window: 60, max: 3 },
      '/second-factor/*': { window: 60, max: 15 },
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
    twoFactor({
      issuer: 'gacoka.com',
      // Turning two-factor on doesn't require an authenticator app: emailed
      // codes and Touch ID work without one. The app stays optional.
      skipVerificationOnEnable: true,
      otpOptions: { sendOTP: emailSignInCode, period: 5, storeOTP: 'hashed' },
    }),
    passkey({
      rpID,
      rpName: 'gacoka.com',
      origin,
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // built into this computer (Touch ID), not a phone or key
        residentKey: 'preferred',
        userVerification: 'required',
      },
      registration: { afterVerification: ({ verification }) => requireUserVerified(verification.registrationInfo) },
    }),
    passkeySecondFactor({ rpID, origin }),
  ],
})

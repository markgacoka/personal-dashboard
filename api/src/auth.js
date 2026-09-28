// Authentication (Better Auth): one owner account, email + password with
// optional TOTP two-factor. Sessions live in Postgres; public sign-up is off
// and the account is managed with api/scripts/account.mjs.
import { betterAuth } from 'better-auth'
import { twoFactor } from 'better-auth/plugins'
import { pool } from './db/client.js'

const baseURL = process.env.BETTER_AUTH_URL || 'https://gacoka.com'
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
    },
  },
  advanced: {
    useSecureCookies: baseURL.startsWith('https://'),
    // Traefik replaces any client-supplied X-Forwarded-For with the real
    // client address, so this header is safe to key rate limits on.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
  },
  telemetry: { enabled: false },
  plugins: [twoFactor({ issuer: 'gacoka.com' })],
})

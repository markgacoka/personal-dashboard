// Touch ID (a passkey) as the second step of sign-in, after the password.
//
// Better Auth's two-factor plugin offers TOTP, emailed codes and backup codes;
// it has no passkey option, and the passkey plugin's own sign-in replaces the
// password instead of following it. This plugin fills the gap: after
// /sign-in/email answers `twoFactorRedirect`, the pending sign-in lives in the
// signed `two_factor` cookie (a verification row holding the user id). These
// endpoints read it, check a passkey assertion from one of that user's
// passkeys (user verification required), and finish the sign-in exactly as
// the built-in verifiers do: consume the pending row, create the session,
// clear the cookie.
import { createAuthEndpoint, APIError, getSessionFromCtx } from 'better-auth/api'
import { setSessionCookie, expireCookie } from 'better-auth/cookies'
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server'

const TWO_FACTOR_COOKIE = 'two_factor' // better-auth/plugins/two-factor
const CHALLENGE_TTL_MS = 5 * 60_000

const fail = (message, status = 'UNAUTHORIZED') => new APIError(status, { message })

// The user whose password was just accepted, from the pending two-factor cookie.
async function pendingSignIn(ctx) {
  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE)
  const key = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
  if (!key) throw fail('Enter your password first.')
  const pending = await ctx.context.internalAdapter.findVerificationValue(key)
  if (!pending || new Date(pending.expiresAt) < new Date()) throw fail('This sign-in expired. Enter your password again.')
  const user = await ctx.context.internalAdapter.findUserById(pending.value)
  if (!user) throw fail('This sign-in expired. Enter your password again.')
  return { user, key, cookie }
}

const userPasskeys = (ctx, userId) =>
  ctx.context.adapter.findMany({ model: 'passkey', where: [{ field: 'userId', value: userId }] })

export function maskEmail(email) {
  const [local, domain] = String(email).split('@')
  if (!domain) return ''
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`
}

// options: { rpID, origin } — pinned to the site, never taken from the request.
export function passkeySecondFactor({ rpID, origin }) {
  return {
    id: 'passkey-second-factor',
    endpoints: {
      // Which second steps this account can use (shown after the password).
      secondFactorMethods: createAuthEndpoint('/second-factor/methods', { method: 'POST' }, async ctx => {
        const { user } = await pendingSignIn(ctx)
        const [passkeys, totp] = await Promise.all([
          userPasskeys(ctx, user.id),
          ctx.context.adapter.findOne({ model: 'twoFactor', where: [{ field: 'userId', value: user.id }] }),
        ])
        return ctx.json({ passkey: passkeys.length > 0, email: maskEmail(user.email), totp: !!totp?.secret, backupCodes: !!totp?.backupCodes })
      }),

      // The signed-in account's second steps, for the Account page.
      secondFactorStatus: createAuthEndpoint('/second-factor/status', { method: 'GET' }, async ctx => {
        const session = await getSessionFromCtx(ctx)
        if (!session) throw fail('Sign in first.')
        const [passkeys, totp] = await Promise.all([
          userPasskeys(ctx, session.user.id),
          ctx.context.adapter.findOne({ model: 'twoFactor', where: [{ field: 'userId', value: session.user.id }] }),
        ])
        return ctx.json({ enabled: !!session.user.twoFactorEnabled, passkeys: passkeys.length, email: session.user.email, totp: !!totp?.secret, backupCodes: !!totp?.backupCodes })
      }),

      secondFactorPasskeyOptions: createAuthEndpoint('/second-factor/passkey-options', { method: 'POST' }, async ctx => {
        const { user, key } = await pendingSignIn(ctx)
        const passkeys = await userPasskeys(ctx, user.id)
        if (!passkeys.length) throw fail('No passkey is set up for this account.', 'BAD_REQUEST')
        const options = await generateAuthenticationOptions({
          rpID,
          allowCredentials: passkeys.map(p => ({ id: p.credentialID, transports: p.transports ? p.transports.split(',') : undefined })),
          userVerification: 'required',
          timeout: 60_000,
        })
        const identifier = `second-factor-passkey-${key}`
        await ctx.context.internalAdapter.consumeVerificationValue(identifier).catch(() => null) // one challenge at a time
        await ctx.context.internalAdapter.createVerificationValue({
          identifier, value: JSON.stringify({ challenge: options.challenge, userId: user.id }),
          expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        })
        return ctx.json(options)
      }),

      secondFactorPasskeyVerify: createAuthEndpoint('/second-factor/passkey-verify', { method: 'POST' }, async ctx => {
        const { user, key, cookie } = await pendingSignIn(ctx)
        const response = ctx.body?.response
        if (!response || typeof response.id !== 'string') throw fail('Missing passkey response.', 'BAD_REQUEST')

        // The challenge is single-use and bound to this pending sign-in.
        const stored = await ctx.context.internalAdapter.consumeVerificationValue(`second-factor-passkey-${key}`)
        if (!stored || new Date(stored.expiresAt) < new Date()) throw fail('That request expired. Try Touch ID again.')
        const { challenge, userId } = JSON.parse(stored.value)
        if (userId !== user.id) throw fail('That request expired. Try Touch ID again.')

        const passkey = await ctx.context.adapter.findOne({ model: 'passkey', where: [{ field: 'credentialID', value: response.id }] })
        if (!passkey || passkey.userId !== user.id) throw fail('That passkey isn’t set up for this account.')

        let verification
        try {
          verification = await verifyAuthenticationResponse({
            response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID,
            credential: { id: passkey.credentialID, publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64')), counter: passkey.counter, transports: passkey.transports?.split(',') },
            requireUserVerification: true,
          })
        } catch (err) {
          ctx.context.logger.warn('second-factor passkey rejected', err?.message)
          throw fail('Your device must confirm it is you (fingerprint or device password).')
        }
        if (!verification.verified) throw fail('Your device must confirm it is you (fingerprint or device password).')
        await ctx.context.adapter.update({ model: 'passkey', where: [{ field: 'id', value: passkey.id }], update: { counter: verification.authenticationInfo.newCounter } })

        // Finish the sign-in the way the built-in two-factor verifiers do.
        const consumed = await ctx.context.internalAdapter.consumeVerificationValue(key)
        if (!consumed || consumed.value !== user.id) { expireCookie(ctx, cookie); throw fail('This sign-in expired. Enter your password again.') }
        const dontRememberMe = await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret)
        const session = await ctx.context.internalAdapter.createSession(user.id, !!dontRememberMe)
        if (!session) throw fail('Could not start a session.', 'INTERNAL_SERVER_ERROR')
        await setSessionCookie(ctx, { session, user })
        expireCookie(ctx, cookie)
        return ctx.json({ ok: true })
      }),
    },
  }
}

// Every page, asset, and API route requires a signed-in session, except the
// short public allowlist below. Also mounts Better Auth's endpoints under
// /api/auth/* and sets security headers on every response.
import fp from 'fastify-plugin'
import helmet from '@fastify/helmet'
import { fromNodeHeaders } from 'better-auth/node'
import { auth } from '../auth.js'

// Exact paths only (no prefixes, no normalization): an encoded or
// non-canonical path can never match, so it falls through to the session check.
const PUBLIC_PATHS = new Set(['/login', '/css/app.css', '/js/login.js', '/favicon.svg', '/health', '/api/health'])
const AUTH_PREFIX = '/api/auth/'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const allowedOrigin = new URL(process.env.BETTER_AUTH_URL || 'https://gacoka.com').origin

// A path to return to after sign-in: same-site absolute paths only (no //host).
export function safeNext(value) {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : '/'
}

// CSRF defence for cookie-authenticated writes (on top of SameSite=Lax):
// browsers send Origin on every cross-site and same-site non-GET request.
function fromOurOrigin(req) {
  const origin = req.headers.origin
  if (origin) return origin === allowedOrigin
  return req.headers['sec-fetch-site'] === 'same-origin'
}

const CSP = {
  useDefaults: false,
  directives: {
    'default-src': ["'self'"],
    // 'unsafe-inline' is required by the UI's inline onclick handlers.
    'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdn.plaid.com'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': ["'self'", 'https://*.basemaps.cartocdn.com', 'https://basemaps.cartocdn.com',
                    'https://server.arcgisonline.com', 'https://*.plaid.com', 'https://cdn.jsdelivr.net'],
    'worker-src': ["'self'", 'blob:'],
    'child-src': ["'self'", 'blob:'],
    'frame-src': ['https://cdn.plaid.com'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  },
}

async function authGate(fastify) {
  await fastify.register(helmet, {
    contentSecurityPolicy: CSP,
    crossOriginEmbedderPolicy: false, // map tiles and photos come from other origins
    hsts: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })

  fastify.decorateRequest('user', null)

  fastify.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]
    if (PUBLIC_PATHS.has(path) || path.startsWith(AUTH_PREFIX)) return

    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null)
    if (!session) {
      const wantsPage = req.method === 'GET' && !path.startsWith('/api/') && !path.startsWith('/auth/')
      if (wantsPage) return reply.redirect(`/login?next=${encodeURIComponent(safeNext(req.url))}`, 302)
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    if (!SAFE_METHODS.has(req.method) && !fromOurOrigin(req)) {
      return reply.status(403).send({ error: 'Cross-origin request refused' })
    }
    req.user = session.user
  })

  // Better Auth's endpoints: sign-in, sign-out, session, two-factor.
  fastify.route({
    method: ['GET', 'POST'],
    url: `${AUTH_PREFIX}*`,
    async handler(req, reply) {
      const url = new URL(req.url, allowedOrigin)
      const response = await auth.handler(new Request(url, {
        method: req.method,
        headers: fromNodeHeaders(req.headers),
        ...(req.body ? { body: JSON.stringify(req.body) } : {}),
      }))
      reply.status(response.status)
      response.headers.forEach((value, key) => { if (key !== 'set-cookie') reply.header(key, value) })
      // Multiple Set-Cookie headers must stay separate, not comma-joined.
      const cookies = response.headers.getSetCookie?.() ?? []
      if (cookies.length) reply.header('set-cookie', cookies)
      reply.header('Cache-Control', 'no-store')
      return reply.send(response.body ? await response.text() : null)
    },
  })

  fastify.get('/login', (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return reply.sendFile('login.html')
  })
}

// fastify-plugin: the hook and headers apply to every route in the app, not
// just routes inside this plugin.
export default fp(authGate, { name: 'auth-gate' })

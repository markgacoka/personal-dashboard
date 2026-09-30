import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import authGate from './routes/authGate.js'
import authRoutes from './routes/auth.js'
import athleteRoutes from './routes/athlete.js'
import activitiesRoutes from './routes/activities.js'
import statsRoutes from './routes/stats.js'
import sleepRoutes from './routes/sleep.js'
import flightRoutes from './routes/flights.js'
import importRoutes from './routes/import.js'
import aircraftRoutes from './routes/aircraft.js'
import aviationRoutes from './routes/aviation.js'
import trackRoutes from './routes/tracks.js'
import niceAirRoutes from './routes/niceAir.js'
import chessRoutes from './routes/chess.js'
import financeRoutes, { scheduleFinanceSync } from './routes/finance.js'
import mailRoutes from './routes/mail.js'
import { runMigrations } from './db/migrate.js'
import { importAcftref, isAcftrefEmpty } from './services/faa-registry.js'
import { scheduleFaaAirspaceRefresh } from './services/faaAirspace.js'
import { scheduleUsAirportsRefresh } from './services/usAirports.js'
import { scheduleNightSync } from './services/schedules.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Docker sets PUBLIC_DIR=/app/public; locally falls back relative to src/
const publicDir = process.env.PUBLIC_DIR || resolve(__dirname, '../../public')
// The 2026 redesign, built from web/ (docs/redesign-2026.md). UI=classic, or a
// missing build, serves the classic UI at / again; it is always at /classic.
const webDir = process.env.WEB_DIR || resolve(__dirname, '../../web/dist')
const useWeb = process.env.UI !== 'classic' && existsSync(join(webDir, 'index.html'))
const appDir = useWeb ? webDir : publicDir

// Build the app. `background: false` skips the scheduled jobs and first-boot
// downloads, for tests that exercise the routes in-process.
export async function buildApp({ logger = true, background = true, onRoute } = {}) {
  const fastify = Fastify({ logger })
  if (onRoute) fastify.addHook('onRoute', onRoute) // lets tests enumerate every route

  // Sign-in gate first, so its session check and security headers cover every
  // route and file registered after it.
  await fastify.register(authGate)
  await fastify.register(fastifyStatic, {
    root: useWeb ? [webDir, publicDir] : publicDir,
    prefix: '/',
    setHeaders(reply, path) {
      // Vite's hashed bundles never change; the page itself must always revalidate.
      if (path.startsWith(join(webDir, 'assets'))) reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      else if (path.endsWith('.html')) reply.header('Cache-Control', 'no-cache')
    },
  })
  fastify.get('/classic', (req, reply) => reply.header('Cache-Control', 'no-cache').sendFile('index.html', publicDir))

  fastify.get('/health', async () => ({ ok: true }))
  fastify.get('/api/health', async () => ({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() }))

  fastify.setErrorHandler((err, req, reply) => {
    fastify.log.error(err)
    reply.status(err.statusCode || 500).send({ error: err.message })
  })

  // Routes that work without the database (they degrade to external APIs only).
  for (const routes of [aircraftRoutes, aviationRoutes, trackRoutes, niceAirRoutes, chessRoutes,
                        authRoutes, athleteRoutes, activitiesRoutes, statsRoutes]) {
    await fastify.register(routes)
  }

  if (process.env.DATABASE_URL) {
    try {
      await runMigrations(fastify.log)
      fastify.log.info('DB migration complete')
      await fastify.register(flightRoutes)
      await fastify.register(importRoutes)
      await fastify.register(sleepRoutes)
      await fastify.register(mailRoutes, { background }) // answers "not configured" until MAIL_* is set
      if (process.env.PLAID_CLIENT_ID) {
        await fastify.register(financeRoutes)
        fastify.log.info('Finance routes enabled')
        if (background) scheduleFinanceSync(fastify.log) // daily balance snapshot
      }
      if (background) {
        scheduleFaaAirspaceRefresh(fastify.log) // first boot, then every 28-day AIRAC cycle
        scheduleUsAirportsRefresh(fastify.log)  // first boot, then every 28 days
        scheduleNightSync(fastify.log)          // block times from Gmail: first boot, then every 6 h

        // Seed the FAA ACFTREF table (~8K rows) on first boot, in the background.
        isAcftrefEmpty().then(empty => {
          if (!empty) return
          importAcftref(msg => fastify.log.info(msg))
            .then(n => fastify.log.info({ rows: n }, 'FAA ACFTREF import done'))
            .catch(err => fastify.log.warn({ err }, 'FAA ACFTREF import failed'))
        }).catch(() => {})
      }
    } catch (err) {
      fastify.log.warn({ err }, 'DB unavailable — flight routes disabled')
    }
  }

  // SPA fallback — serve index.html for any unmatched route
  fastify.setNotFoundHandler((req, reply) => {
    // A bundle from an older deploy is gone for good; answering with the page would break the module load.
    if (useWeb && req.url.startsWith('/assets/')) return reply.status(404).send({ error: 'Not found' })
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html', appDir)
  })

  return fastify
}

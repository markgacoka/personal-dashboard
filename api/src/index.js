import 'dotenv/config'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
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
import { runMigrations } from './db/migrate.js'
import { importAcftref, isAcftrefEmpty } from './services/faa-registry.js'
import { scheduleFaaAirspaceRefresh } from './services/faaAirspace.js'
import { scheduleUsAirportsRefresh } from './services/usAirports.js'
import { scheduleNightSync } from './services/schedules.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Docker sets PUBLIC_DIR=/app/public; locally falls back relative to src/
const publicDir = process.env.PUBLIC_DIR || resolve(__dirname, '../../public')

const fastify = Fastify({ logger: true })

await fastify.register(cors, { origin: process.env.CORS_ORIGIN || 'https://gacoka.com' })
await fastify.register(fastifyStatic, { root: publicDir, prefix: '/' })

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
    if (process.env.PLAID_CLIENT_ID) {
      await fastify.register(financeRoutes)
      fastify.log.info('Finance routes enabled')
      scheduleFinanceSync(fastify.log) // daily balance snapshot
    }
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
  } catch (err) {
    fastify.log.warn({ err }, 'DB unavailable — flight routes disabled')
  }
}

// SPA fallback — serve index.html for any unmatched route
fastify.setNotFoundHandler((req, reply) => reply.sendFile('index.html'))

const port = parseInt(process.env.PORT || '3000', 10)
const host = process.env.HOST || '127.0.0.1'
await fastify.listen({ port, host })

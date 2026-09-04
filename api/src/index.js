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
import flightRoutes from './routes/flights.js'
import importRoutes from './routes/import.js'
import proxyRoutes from './routes/proxy.js'
import { migrate, migrateV2, migrateV3, migrateV4, migrateV5, migrateV6, migrateV7 } from './db/migrate.js'
import { importAcftref, isAcftrefEmpty } from './services/faa-registry.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Docker sets PUBLIC_DIR=/app/public; locally falls back relative to src/
const publicDir = process.env.PUBLIC_DIR || resolve(__dirname, '../../public')

const fastify = Fastify({ logger: true })

await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || 'https://gacoka.com',
})

// Serve static frontend files
await fastify.register(fastifyStatic, {
  root: publicDir,
  prefix: '/',
})

await fastify.register(proxyRoutes)

fastify.get('/health', async () => ({ ok: true }))

fastify.get('/api/health', async () => ({
  ok: true,
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}))

fastify.setErrorHandler((err, req, reply) => {
  fastify.log.error(err)
  reply.status(err.statusCode || 500).send({ error: err.message })
})

await fastify.register(authRoutes)
await fastify.register(athleteRoutes)
await fastify.register(activitiesRoutes)
await fastify.register(statsRoutes)

if (process.env.DATABASE_URL) {
  try {
    await migrate()
    await migrateV2()
    await migrateV3()
    await migrateV4()
    await migrateV5()
    await migrateV6()
    await migrateV7()
    fastify.log.info('DB migration complete')
    await fastify.register(flightRoutes)
    await fastify.register(importRoutes)
    // Seed ACFTREF (8K rows) on first boot — runs in background, non-blocking
    isAcftrefEmpty().then(empty => {
      if (empty) {
        importAcftref(msg => fastify.log.info(msg))
          .then(n => fastify.log.info({ rows: n }, 'FAA ACFTREF import done'))
          .catch(err => fastify.log.warn({ err }, 'FAA ACFTREF import failed'))
      }
    }).catch(() => {})
  } catch (err) {
    fastify.log.warn({ err }, 'DB unavailable — flight routes disabled')
  }
}

// SPA fallback — serve index.html for any unmatched route
fastify.setNotFoundHandler((req, reply) => {
  reply.sendFile('index.html')
})

const port = parseInt(process.env.PORT || '3000', 10)
const host = process.env.HOST || '127.0.0.1'
await fastify.listen({ port, host })


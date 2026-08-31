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
import { migrate } from './db/migrate.js'

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
    fastify.log.info('DB migration complete')
    await fastify.register(flightRoutes)
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


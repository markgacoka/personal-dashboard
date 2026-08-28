import 'dotenv/config'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { loadTokens } from './services/garmin.js'
import athleteRoutes from './routes/athlete.js'
import activitiesRoutes from './routes/activities.js'
import statsRoutes from './routes/stats.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// api/src/index.js → ../../public resolves to the repo root public/
const publicDir = resolve(__dirname, '../../public')

const fastify = Fastify({ logger: true })

loadTokens()

await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || 'https://gacoka.com',
})

// Serve static frontend files
await fastify.register(fastifyStatic, {
  root: publicDir,
  prefix: '/',
  decorateReply: false,
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

await fastify.register(athleteRoutes)
await fastify.register(activitiesRoutes)
await fastify.register(statsRoutes)

// SPA fallback — serve index.html for any unmatched route
fastify.setNotFoundHandler((req, reply) => {
  reply.sendFile('index.html')
})

const port = parseInt(process.env.PORT || '3000', 10)
await fastify.listen({ port, host: '127.0.0.1' })

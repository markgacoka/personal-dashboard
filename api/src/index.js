import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { loadTokens } from './services/strava.js'
import authRoutes from './routes/auth.js'
import athleteRoutes from './routes/athlete.js'
import activitiesRoutes from './routes/activities.js'
import statsRoutes from './routes/stats.js'

const fastify = Fastify({ logger: true })

loadTokens()

await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || 'https://gacoka.com',
})

fastify.get('/api/health', async () => ({
  ok: true,
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}))

fastify.setErrorHandler((err, req, reply) => {
  fastify.log.error(err)
  const status = err.statusCode || 500
  reply.status(status).send({ error: err.message })
})

await fastify.register(authRoutes)
await fastify.register(athleteRoutes)
await fastify.register(activitiesRoutes)
await fastify.register(statsRoutes)

const port = parseInt(process.env.PORT || '3000', 10)
await fastify.listen({ port, host: '127.0.0.1' })

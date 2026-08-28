import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import athleteRoutes from './routes/athlete.js'
import activitiesRoutes from './routes/activities.js'
import statsRoutes from './routes/stats.js'

const fastify = Fastify({ logger: true })

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
  reply.status(err.statusCode || 500).send({ error: err.message })
})

await fastify.register(athleteRoutes)
await fastify.register(activitiesRoutes)
await fastify.register(statsRoutes)

const port = parseInt(process.env.PORT || '3000', 10)
await fastify.listen({ port, host: '127.0.0.1' })

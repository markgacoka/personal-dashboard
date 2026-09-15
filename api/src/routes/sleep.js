import { getLatestSleepDetail, getSleepTrend } from '../services/sleepData.js'

export default async function sleepRoutes(fastify) {
  // Full detail (stages timeline, vitals) for the most recent night with data
  fastify.get('/api/sleep/latest', async (req, reply) => {
    try {
      const detail = await getLatestSleepDetail(fastify.log)
      if (!detail) return reply.code(404).send({ error: 'No recent sleep data available' })
      return detail
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'Sleep latest fetch failed')
      return reply.code(503).send({ error: 'Sleep data unavailable', detail: e.message })
    }
  })

  // Per-night summaries for trend charts
  fastify.get('/api/sleep/trend', async (req, reply) => {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30))
    try {
      const trend = await getSleepTrend(days, fastify.log)
      return { days, trend }
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'Sleep trend fetch failed')
      return reply.code(503).send({ error: 'Sleep trend unavailable', detail: e.message })
    }
  })
}

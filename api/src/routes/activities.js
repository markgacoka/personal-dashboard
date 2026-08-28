import { stravaGet } from '../services/strava.js'

export default async function activitiesRoutes(fastify) {
  fastify.get('/api/activities', async (req) => {
    const { page = 1, per_page = 30, before, after, type } = req.query
    return stravaGet('/athlete/activities', { page, per_page, before, after, type })
  })

  fastify.get('/api/activities/recent', async () => {
    return stravaGet('/athlete/activities', { per_page: 10 })
  })

  fastify.get('/api/activities/:id', async (req) => {
    return stravaGet(`/activities/${req.params.id}`)
  })
}

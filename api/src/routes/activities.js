import { garmin } from '../services/garmin.js'

export default async function activitiesRoutes(fastify) {
  // GET /api/activities?start=0&limit=30&type=running
  fastify.get('/api/activities', async (req) => {
    const { start = 0, limit = 30, type } = req.query
    return garmin((gc) => gc.getActivities(Number(start), Number(limit), type))
  })

  // GET /api/activities/recent — last 10
  fastify.get('/api/activities/recent', async () => {
    return garmin((gc) => gc.getActivities(0, 10))
  })

  // GET /api/activities/:id — single activity with full detail
  fastify.get('/api/activities/:id', async (req) => {
    return garmin((gc) => gc.getActivity({ activityId: req.params.id }))
  })

  // GET /api/activities/:id/splits — lap/split data (downloads original FIT data)
  fastify.get('/api/activities/:id/splits', async (req) => {
    return garmin((gc) => gc.downloadOriginalActivityData({ activityId: req.params.id }))
  })
}

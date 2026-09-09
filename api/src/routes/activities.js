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

  // GET /api/activities/:id/gpx — GPS route as sampled [lon, lat, ele_m] points
  fastify.get('/api/activities/:id/gpx', async (req, reply) => {
    const id = req.params.id
    try {
      const raw = await garmin((gc) =>
        gc.client.get(`https://connectapi.garmin.com/download-service/export/gpx/activity/${id}`, {
          responseType: 'text',
        })
      )
      const xml = typeof raw === 'string' ? raw : JSON.stringify(raw)
      const points = []
      // Split on <trkpt and parse each segment independently — avoids [\s\S]*? on large strings
      const segs = xml.split('<trkpt').slice(1)
      for (const seg of segs) {
        const latM = seg.match(/lat="([\d.eE+\-]+)"/)
        const lonM = seg.match(/lon="([\d.eE+\-]+)"/)
        const eleM = seg.match(/<ele>([\d.eE+\-]+)<\/ele>/)
        if (latM && lonM) {
          points.push([
            parseFloat(lonM[1]),
            parseFloat(latM[1]),
            eleM ? parseFloat(eleM[1]) : null,
          ])
        }
      }
      // Sample down to ≤600 points to keep payload small
      const MAX = 600
      const step = Math.ceil(points.length / MAX)
      const sampled = step > 1 ? points.filter((_, i) => i % step === 0) : [...points]
      // Always include the final point so the track end is accurate
      if (sampled.length && points.length > 0 && sampled[sampled.length - 1] !== points[points.length - 1]) {
        sampled.push(points[points.length - 1])
      }
      return { count: points.length, points: sampled }
    } catch (err) {
      return reply.status(404).send({ error: 'GPS track not available', message: err.message })
    }
  })

  // GET /api/activities/:id/splits — lap/split data (downloads original FIT data)
  fastify.get('/api/activities/:id/splits', async (req) => {
    return garmin((gc) => gc.downloadOriginalActivityData({ activityId: req.params.id }))
  })
}

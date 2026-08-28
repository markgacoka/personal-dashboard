import { garmin } from '../services/garmin.js'

export default async function athleteRoutes(fastify) {
  fastify.get('/api/athlete', async () => {
    return garmin((gc) => gc.getUserProfile())
  })
}

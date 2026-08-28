import { stravaGet } from '../services/strava.js'

export default async function athleteRoutes(fastify) {
  fastify.get('/api/athlete', async () => {
    return stravaGet('/athlete')
  })

  fastify.get('/api/athlete/zones', async () => {
    const athlete = await stravaGet('/athlete')
    return stravaGet(`/athletes/${athlete.id}/zones`)
  })
}

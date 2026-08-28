import { stravaGet } from '../services/strava.js'

function startOfWeek() {
  const d = new Date()
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)) // roll back to Monday
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

function startOfMonth() {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

function aggregate(activities) {
  const totals = {}
  for (const act of activities) {
    const type = act.sport_type || act.type
    if (!totals[type]) {
      totals[type] = { count: 0, distance_m: 0, moving_time_s: 0, elevation_gain_m: 0 }
    }
    totals[type].count++
    totals[type].distance_m += act.distance
    totals[type].moving_time_s += act.moving_time
    totals[type].elevation_gain_m += act.total_elevation_gain
  }
  return totals
}

export default async function statsRoutes(fastify) {
  // Strava all-time + YTD + recent (4 weeks) stats
  fastify.get('/api/stats', async () => {
    const athlete = await stravaGet('/athlete')
    return stravaGet(`/athletes/${athlete.id}/stats`)
  })

  fastify.get('/api/stats/weekly', async () => {
    const after = startOfWeek()
    const activities = await stravaGet('/athlete/activities', { after, per_page: 200 })
    return {
      period: 'week',
      from: new Date(after * 1000).toISOString(),
      by_sport: aggregate(activities),
      total_count: activities.length,
    }
  })

  fastify.get('/api/stats/monthly', async () => {
    const after = startOfMonth()
    const activities = await stravaGet('/athlete/activities', { after, per_page: 200 })
    return {
      period: 'month',
      from: new Date(after * 1000).toISOString(),
      by_sport: aggregate(activities),
      total_count: activities.length,
    }
  })
}

import { garmin } from '../services/garmin.js'

function weekStart() {
  const d = new Date()
  d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1))
  d.setHours(0, 0, 0, 0)
  return d
}

function monthStart() {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

function aggregate(activities) {
  const by_sport = {}
  for (const act of activities) {
    const type = act.activityType?.typeKey ?? 'other'
    if (!by_sport[type]) {
      by_sport[type] = { count: 0, distance_m: 0, moving_time_s: 0, elevation_gain_m: 0, calories: 0 }
    }
    by_sport[type].count++
    by_sport[type].distance_m += act.distance ?? 0
    by_sport[type].moving_time_s += act.movingDuration ?? act.duration ?? 0
    by_sport[type].elevation_gain_m += act.elevationGain ?? 0
    by_sport[type].calories += act.calories ?? 0
  }
  return by_sport
}

function filterFrom(activities, since) {
  return activities.filter((a) => new Date(a.startTimeLocal) >= since)
}

export default async function statsRoutes(fastify) {
  // Garmin user profile with all-time stats
  fastify.get('/api/stats', async () => {
    return garmin((gc) => gc.getUserProfile())
  })

  fastify.get('/api/stats/weekly', async () => {
    const from = weekStart()
    const all = await garmin((gc) => gc.getActivities(0, 100))
    const activities = filterFrom(all, from)
    return { period: 'week', from: from.toISOString(), by_sport: aggregate(activities), total_count: activities.length }
  })

  fastify.get('/api/stats/monthly', async () => {
    const from = monthStart()
    const all = await garmin((gc) => gc.getActivities(0, 200))
    const activities = filterFrom(all, from)
    return { period: 'month', from: from.toISOString(), by_sport: aggregate(activities), total_count: activities.length }
  })

  // Daily wellness snapshot (steps, HR, sleep) — individual calls degrade gracefully
  fastify.get('/api/stats/daily', async (req) => {
    const date = req.query.date ?? new Date().toISOString().slice(0, 10)
    const [stepsR, hrR, sleepR] = await Promise.allSettled([
      garmin((gc) => gc.getSteps(new Date(date))),
      garmin((gc) => gc.getHeartRate(new Date(date))),
      garmin((gc) => gc.getSleepData(new Date(date))),
    ])
    return {
      date,
      steps:      stepsR.status === 'fulfilled' ? stepsR.value : null,
      heart_rate: hrR.status    === 'fulfilled' ? hrR.value    : null,
      sleep:      sleepR.status === 'fulfilled' ? sleepR.value : null,
    }
  })

  // HRV status (Garmin-specific, requires compatible device)
  fastify.get('/api/stats/hrv', async (req) => {
    const date = req.query.date ?? new Date().toISOString().slice(0, 10)
    return garmin((gc) => gc.getHrvData(new Date(date)))
  })
}

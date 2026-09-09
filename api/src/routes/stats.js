import { garmin } from '../services/garmin.js'

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
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

async function fetchVo2Max() {
  try {
    const acts = await garmin((gc) => gc.getActivities(0, 20))
    const withVo2 = acts.filter(a => a.vO2MaxValue != null)
    return withVo2.length ? parseFloat(withVo2[0].vO2MaxValue) : null
  } catch { return null }
}

// Cache the displayName (UUID) needed for per-user endpoints
let _displayName = null
async function getDisplayName() {
  if (_displayName) return _displayName
  try {
    const profile = await garmin((gc) => gc.getUserProfile())
    _displayName = profile.displayName ?? null
  } catch { _displayName = null }
  return _displayName
}

async function fetchDailyForDate(dateStr) {
  const d = new Date(dateStr)
  const displayName = await getDisplayName()

  const [stepsR, hrR, sleepR, vo2R, hrvR, summaryR] = await Promise.allSettled([
    garmin((gc) => gc.getSteps(d)),
    garmin((gc) => gc.getHeartRate(d)),
    garmin((gc) => gc.getSleepData(d)),
    fetchVo2Max(),
    garmin((gc) => gc.client.get(`https://connectapi.garmin.com/hrv-service/hrv/${dateStr}`)),
    displayName
      ? garmin((gc) => gc.client.get(
          `https://connectapi.garmin.com/usersummary-service/usersummary/daily/${displayName}?calendarDate=${dateStr}`
        ))
      : Promise.reject(new Error('no displayName')),
  ])

  return {
    date:          dateStr,
    steps:         stepsR.status   === 'fulfilled' ? stepsR.value   : null,
    heart_rate:    hrR.status      === 'fulfilled' ? hrR.value      : null,
    sleep:         sleepR.status   === 'fulfilled' ? sleepR.value   : null,
    vo2max:        vo2R.status     === 'fulfilled' ? vo2R.value     : null,
    hrv:           hrvR.status     === 'fulfilled' ? hrvR.value     : null,
    daily_summary: summaryR.status === 'fulfilled' ? summaryR.value : null,
  }
}

function hasData(daily) {
  return (
    daily.steps ||
    daily.heart_rate?.restingHeartRate ||
    daily.sleep?.dailySleepDTO?.sleepTimeSeconds ||
    daily.hrv?.hrvSummary?.lastNightAvg
  )
}

export default async function statsRoutes(fastify) {
  fastify.get('/api/stats', async () => {
    return garmin((gc) => gc.getUserProfile())
  })

  fastify.get('/api/stats/weekly', async () => {
    const from = daysAgo(7)
    const all = await garmin((gc) => gc.getActivities(0, 100))
    const activities = filterFrom(all, from)
    return { period: 'last_7_days', from: from.toISOString(), by_sport: aggregate(activities), total_count: activities.length }
  })

  fastify.get('/api/stats/monthly', async () => {
    const from = monthStart()
    const all = await garmin((gc) => gc.getActivities(0, 200))
    const activities = filterFrom(all, from)
    return { period: 'month', from: from.toISOString(), by_sport: aggregate(activities), total_count: activities.length }
  })

  // Auto-fallback: tries today, then yesterday, then day before
  fastify.get('/api/stats/daily', async (req) => {
    if (req.query.date) {
      return fetchDailyForDate(req.query.date)
    }
    for (let offset = 0; offset <= 2; offset++) {
      const dateStr = daysAgo(offset).toISOString().slice(0, 10)
      const result = await fetchDailyForDate(dateStr)
      if (hasData(result)) return result
    }
    return fetchDailyForDate(daysAgo(0).toISOString().slice(0, 10))
  })

  fastify.get('/api/stats/hrv', async (req) => {
    const date = req.query.date ?? new Date().toISOString().slice(0, 10)
    return garmin((gc) => gc.client.get(`https://connectapi.garmin.com/hrv-service/hrv/${date}`))
  })
}

// Winds and temperatures aloft from a weather model (Open-Meteo "best match":
// NOAA HRRR and GFS over the US). NWS ended the FB winds-aloft text forecast on
// 2026-11-03 with the NAM (SCN 26-47), so this is the planner's primary source.
// Sampled on a grid over the route at the FB levels, so the navlog reads it like
// an FB product; one product per 3-hour window.
import { fetchWithTimeout } from '../lib/http.js'
import { cached } from './awc.js'

const PRESSURE = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600]
export const LEVELS = [3000, 6000, 9000, 12000]
const SOURCE = 'NOAA HRRR/GFS model winds (Open-Meteo)'
const rad = d => (d * Math.PI) / 180

// One point and hour: pressure-level samples [{ zFt, dir, spd, temp }] → FB-style
// winds at each altitude, interpolated by height in u/v so direction wraps right.
export function toLevels(samples, levels = LEVELS) {
  const s = samples.filter(x => [x.zFt, x.dir, x.spd].every(Number.isFinite)).sort((a, b) => a.zFt - b.zFt)
  if (s.length < 2) return {}
  const out = {}
  for (const alt of levels) {
    let i = s.findIndex(x => x.zFt >= alt)
    if (i <= 0) i = i === 0 ? 1 : s.length - 1
    const a = s[i - 1], b = s[i]
    const f = Math.min(1, Math.max(0, (alt - a.zFt) / (b.zFt - a.zFt)))
    const uv = x => [x.spd * Math.sin(rad(x.dir)), x.spd * Math.cos(rad(x.dir))]
    const [ua, va] = uv(a), [ub, vb] = uv(b)
    const u = ua + (ub - ua) * f, v = va + (vb - va) * f
    const spd = Math.round(Math.hypot(u, v))
    const temp = Number.isFinite(a.temp) && Number.isFinite(b.temp) ? Math.round(a.temp + (b.temp - a.temp) * f) : null
    out[alt] = spd < 5 ? { dir: null, spd, temp, lv: true } : { dir: Math.round((((Math.atan2(u, v) * 180) / Math.PI) + 360) % 360) || 360, spd, temp }
  }
  return out
}

const pad = n => String(n).padStart(2, '0')

// Open-Meteo JSON (one object per location) → FB-shaped products by window,
// keyed by the FB station each location was sampled for.
export function toProducts(locations, now = Date.now(), sites = []) {
  const times = locations[0]?.hourly?.time || []
  const products = []
  for (let k = 0; k + 1 < times.length; k += 3) {
    const t0 = Date.parse(`${times[k]}:00Z`)
    if (!Number.isFinite(t0) || t0 + 3 * 3600_000 < now) continue
    const mid = k + 1, start = new Date(t0), end = new Date(t0 + 3 * 3600_000), valid = new Date(Date.parse(`${times[mid]}:00Z`))
    const stations = {}
    locations.forEach((loc, i) => {
      const h = loc.hourly
      const samples = PRESSURE.map(p => ({ zFt: h[`geopotential_height_${p}hPa`]?.[mid] * 3.28084, dir: h[`wind_direction_${p}hPa`]?.[mid], spd: h[`wind_speed_${p}hPa`]?.[mid], temp: h[`temperature_${p}hPa`]?.[mid] }))
      const site = sites[i]
      stations[site?.id ?? `M${i + 1}`] = { lat: site?.lat ?? loc.latitude, lon: site?.lon ?? loc.longitude, winds: toLevels(samples) }
    })
    products.push({
      basedOn: '', source: SOURCE, levels: LEVELS, stations,
      valid: `${pad(valid.getUTCDate())}${pad(valid.getUTCHours())}00`,
      forUse: [`${pad(start.getUTCHours())}00`, end.getUTCHours() === 0 ? '2400' : `${pad(end.getUTCHours())}00`],
    })
  }
  return products
}

// Forecast points over the route box: a grid at most 0.5° (≈30 nm) apart with a
// 0.3° margin, at most 12 points (Open-Meteo takes them in one request).
export function routeGrid(box) {
  const s = box.south - 0.3, n = box.north + 0.3, w = box.west - 0.3, e = box.east + 0.3
  let step = 0.5, rows, cols
  for (;;) {
    rows = Math.max(2, Math.ceil((n - s) / step) + 1); cols = Math.max(2, Math.ceil((e - w) / step) + 1)
    if (rows * cols <= 12) break
    step *= 1.25
  }
  const out = []
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const lat = Math.round((s + ((n - s) * i) / (rows - 1)) * 100) / 100, lon = Math.round((w + ((e - w) * j) / (cols - 1)) * 100) / 100
    out.push({ id: `${lat.toFixed(2)},${lon.toFixed(2)}`, lat, lon })
  }
  return out
}

// The last good answer per set of points: served (flagged stale) for up to 6 hours
// when Open-Meteo is unreachable, so a brief outage doesn't drop the winds.
const lastGood = new Map()
const STALE_MS = 6 * 3600_000

async function fetchModel(sites, vars) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${sites.map(s => s.lat.toFixed(3)).join(',')}&longitude=${sites.map(s => s.lon.toFixed(3)).join(',')}&hourly=${vars}&wind_speed_unit=kn&forecast_days=3&timezone=GMT`
  let err
  for (const ms of [15000, 25000]) {
    try {
      const r = await fetchWithTimeout(url, { ms })
      if (!r.ok) throw new Error(`Open-Meteo ${r.status}`)
      return await r.json()
    } catch (e) { err = e }
  }
  throw err
}

// sites: [{ id, lat, lon }] — forecast points around the route.
export async function modelWinds(sites) {
  const vars = PRESSURE.flatMap(p => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `temperature_${p}hPa`, `geopotential_height_${p}hPa`]).join(',')
  const key = `modelwinds:${sites.map(s => s.id).join(';')}`
  try {
    const out = await cached(key, 30 * 60_000, async () => {
      const j = await fetchModel(sites, vars)
      return toProducts(Array.isArray(j) ? j : [j], Date.now(), sites)
    })
    lastGood.set(key, out)
    if (lastGood.size > 200) lastGood.delete(lastGood.keys().next().value)
    return out
  } catch (e) {
    const prev = lastGood.get(key)
    if (prev && Date.now() - Date.parse(prev.fetchedAt) < STALE_MS) return { ...prev, stale: true, error: e.message }
    throw e
  }
}

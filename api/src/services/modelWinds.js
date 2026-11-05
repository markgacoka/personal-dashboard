// Winds and temperatures aloft from a weather model (Open-Meteo "best match":
// NOAA HRRR and GFS over the US) for when the NWS FB winds-aloft forecast isn't
// published (aviationweather.gov's windtemp answers 204 and the FBUS31 bulletin
// stopped on 2026-11-03). Sampled at the FB stations aviationweather.gov lists
// (SFO, SNS, …) at the FB levels, so the table and the navlog read exactly like
// an FB product; one product per 3-hour window.
import { fetchWithTimeout } from '../lib/http.js'
import { cached } from './awc.js'

const PRESSURE = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600]
export const LEVELS = [3000, 6000, 9000, 12000]
const SOURCE = 'Open-Meteo model winds (NOAA HRRR/GFS) at the AWC FB stations'
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

// sites: [{ id, lat, lon }] — FB stations around the route.
export function modelWinds(sites) {
  const vars = PRESSURE.flatMap(p => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `temperature_${p}hPa`, `geopotential_height_${p}hPa`]).join(',')
  return cached(`modelwinds:${sites.map(s => s.id).join(',')}`, 30 * 60_000, async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${sites.map(s => s.lat.toFixed(3)).join(',')}&longitude=${sites.map(s => s.lon.toFixed(3)).join(',')}&hourly=${vars}&wind_speed_unit=kn&forecast_days=3&timezone=GMT`
    const r = await fetchWithTimeout(url, { ms: 15000 })
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`)
    const j = await r.json()
    return toProducts(Array.isArray(j) ? j : [j], Date.now(), sites)
  })
}

// Iowa State Mesonet ASOS archive: historical METARs.
import { fetchWithTimeout } from '../lib/http.js'

// Rows of the archive's CSV reply as [{ valid: Date, metar }], oldest first.
// The service answers in CSV whatever format is requested, after '#DEBUG'
// comment lines. Rows: station,valid,metar with valid as UTC "YYYY-MM-DD HH:MM".
export function parseMesonetCsv(text) {
  const obs = []
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#') || line.startsWith('station')) continue
    const [, validStr, ...rest] = line.split(',')
    const metar = rest.join(',').trim()
    const valid = new Date(`${validStr?.trim().replace(' ', 'T')}:00Z`)
    if (metar && !isNaN(valid)) obs.push({ valid, metar })
  }
  return obs
}

// METARs for a station (identifier without the K prefix) between t0 and t1.
export async function fetchMesonetMetars(station, t0, t1) {
  const params = new URLSearchParams({
    station, data: 'metar',
    year1: t0.getUTCFullYear(), month1: t0.getUTCMonth() + 1, day1: t0.getUTCDate(), hour1: t0.getUTCHours(), minute1: 0,
    year2: t1.getUTCFullYear(), month2: t1.getUTCMonth() + 1, day2: t1.getUTCDate(), hour2: t1.getUTCHours(), minute2: 59,
    tz: 'UTC', format: 'onlycomma', latlon: 'no', elev: 'no', missing: 'empty', trace: 'empty', direct: 'no',
  })
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${params}`
  let res = await fetchWithTimeout(url, { ms: 15000 })
  if (res.status === 429) { // rate limited: one retry after the requested pause
    await new Promise(r => setTimeout(r, Math.min(10, parseInt(res.headers.get('Retry-After') || '3', 10)) * 1000))
    res = await fetchWithTimeout(url, { ms: 15000 })
  }
  if (!res.ok) throw new Error(`Mesonet ${res.status}`)
  return parseMesonetCsv(await res.text())
}

// The observation nearest to time t, or null.
export const closestTo = (obs, t) =>
  obs.reduce((best, o) => (!best || Math.abs(o.valid - t) < Math.abs(best.valid - t) ? o : best), null)

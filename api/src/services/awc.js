// aviationweather.gov Data API (NOAA Aviation Weather Center): the observations,
// forecasts and advisories the flight planner briefs. Each product is cached in
// memory for a few minutes so a plan with several airports doesn't refetch it;
// every result carries the time it was fetched.
import { fetchWithTimeout } from '../lib/http.js'

const BASE = 'https://aviationweather.gov/api/data'
const MIN = 60_000
const cache = new Map()

export async function cached(key, ttlMs, load) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return { data: hit.data, fetchedAt: new Date(hit.at).toISOString() }
  const data = await load()
  const at = Date.now()
  cache.set(key, { data, at })
  if (cache.size > 500) cache.delete(cache.keys().next().value)
  return { data, fetchedAt: new Date(at).toISOString() }
}

async function awc(path, { text = false } = {}) {
  const r = await fetchWithTimeout(`${BASE}/${path}`, { ms: 15000 })
  if (r.status === 204) return text ? '' : []
  if (!r.ok) throw new Error(`aviationweather.gov ${path.split('?')[0]} ${r.status}`)
  return text ? r.text() : r.json()
}

const bboxParam = b => [b.south, b.west, b.north, b.east].map(v => v.toFixed(2)).join(',')
const ids = list => [...new Set(list)].filter(Boolean).join(',')

export const metars = list => cached(`metar:${ids(list)}`, 5 * MIN, () => awc(`metar?ids=${ids(list)}&format=json&hours=3`))
export const metarsInBox = b => cached(`metarbox:${bboxParam(b)}`, 5 * MIN, () => awc(`metar?bbox=${bboxParam(b)}&format=json`))
export const tafs = list => cached(`taf:${ids(list)}`, 10 * MIN, () => awc(`taf?ids=${ids(list)}&format=json`))
export const tafsInBox = b => cached(`tafbox:${bboxParam(b)}`, 10 * MIN, () => awc(`taf?bbox=${bboxParam(b)}&format=json`))
export const pireps = b => cached(`pirep:${bboxParam(b)}`, 5 * MIN, () => awc(`pirep?bbox=${bboxParam(b)}&age=3&format=json`))
export const sigmets = () => cached('airsigmet', 5 * MIN, () => awc('airsigmet?format=json'))
export const gairmets = () => cached('gairmet', 10 * MIN, () => awc('gairmet?format=json'))
export const cwas = () => cached('cwa', 5 * MIN, () => awc('cwa?format=json'))
// The same FB bulletin from the NWS text-product feed (FD1/FD2/FD3 = 6/12/24 h).
const NWS = { '06': 'FD1', '12': 'FD2', '24': 'FD3' }
async function nwsFB(code) {
  const r = await fetchWithTimeout(`https://api.weather.gov/products/types/${code}/locations/US1/latest`, { ms: 15000, headers: { 'User-Agent': 'gacoka.com flight planner', Accept: 'application/ld+json' } })
  if (!r.ok) throw new Error(`api.weather.gov ${code} ${r.status}`)
  const j = await r.json()
  return { issued: Date.parse(j.issuanceTime), products: parseFB(j.productText || '') }
}
// Current NWS FB (issued in the last 9 hours) or null.
export const nwsWindsAloft = fcst => cached(`nwsfb:${fcst}`, 15 * MIN, async () => {
  const { issued, products } = await nwsFB(NWS[fcst])
  return Date.now() - issued < 9 * 3600_000 ? products : null
})
// The FB station identifiers (the list barely changes; from the latest bulletin, however old).
export const fbStationIds = () => cached('fbstations', 24 * 60 * MIN, async () => Object.keys((await nwsFB('FD1')).products[0]?.stations || {}))

export const windsAloft = fcst => cached(`fb:${fcst}`, 15 * MIN, async () => parseFB(await awc(`windtemp?region=us&level=low&fcst=${fcst}`, { text: true })))

// ── FB winds and temperatures aloft ──────────────────────────────────────────
// Each group is DDff[±TT]: direction in tens of degrees, speed in knots, temp
// in °C. 9900 is light and variable; a direction code of 51–86 means 100 kt
// was added to the speed (and 50 to the direction). Above 24,000 ft temps are
// printed without a sign and are negative. No temp is given at 3,000 ft or for
// a level within 2,500 ft of the station.
export function parseFB(text) {
  const products = []
  let cur = null
  for (const line of String(text).split('\n')) {
    const based = line.match(/DATA BASED ON (\d{6})Z/)
    if (based) { cur = { basedOn: based[1], levels: [], stations: {} }; products.push(cur); continue }
    const valid = line.match(/VALID (\d{6})Z\s+FOR USE (\d{4})-(\d{4})Z/)
    if (valid && cur) { cur.valid = valid[1]; cur.forUse = [valid[2], valid[3]]; continue }
    if (/^FT\s+3000/.test(line) && cur) {
      cur.levels = line.trim().split(/\s+/).slice(1).map(Number)
      // Column positions so blank groups (no data at a level) keep their place.
      let from = 0
      cur.cols = cur.levels.map(l => { const at = line.indexOf(String(l), from) + String(l).length; from = at; return at })
      continue
    }
    const m = cur?.cols && line.match(/^([A-Z0-9]{3})\s/)
    if (!m) continue
    const winds = {}
    cur.cols.forEach((end, i) => {
      const g = line.slice(i === 0 ? 4 : cur.cols[i - 1], end).trim()
      const w = decodeFbGroup(g, cur.levels[i])
      if (w) winds[cur.levels[i]] = w
    })
    cur.stations[m[1]] = winds
  }
  return products.map(({ cols, ...p }) => p)
}

export function decodeFbGroup(g, level) {
  if (!/^\d{4}/.test(g)) return null
  let dir = +g.slice(0, 2) * 10, spd = +g.slice(2, 4)
  let temp = null
  const t = g.slice(4)
  if (t) temp = level > 24000 && /^\d+$/.test(t) ? -Number(t) : Number(t)
  if (dir === 990 && spd === 0) return { dir: null, spd: 0, temp, lv: true }
  if (dir > 360) { dir -= 500; spd += 100 }
  return { dir, spd, temp }
}

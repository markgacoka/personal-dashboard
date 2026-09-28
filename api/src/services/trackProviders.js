// Backfilling a logged flight's GPS track from FlightAware AeroAPI or
// FlightRadar24: find the provider's flights for the tail in a window around
// the block times, score them against the logbook entry, fetch and merge every
// candidate's positions (multi-leg flights and schedule slips span several
// provider flights), and crop to the block-time window.
import { normalizeFr24Positions } from './flightTrack.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const HOUR = 3_600_000
const normIcao = ic => (ic || '').toUpperCase().replace(/^K/, '')

async function providerFetch(base, path, params, headers, { throwOnError }) {
  const url = new URL(base + path)
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v))
  const r = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(20000) })
  if (r.status === 429) {
    await sleep(parseInt(r.headers.get('Retry-After') || '5', 10) * 1000)
    return providerFetch(base, path, params, headers, { throwOnError })
  }
  if (!r.ok) {
    if (!throwOnError) return null
    const body = await r.json().catch(() => ({}))
    throw new Error(`FlightAware ${r.status}: ${body.detail || body.title || r.statusText}`)
  }
  return r.json()
}

// ── FlightAware AeroAPI v4 (FLIGHTAWARE_API_KEY; Standard plan, 5 req/s) ──────
function faFetch(path, params = {}) {
  const key = process.env.FLIGHTAWARE_API_KEY
  if (!key) throw new Error('FLIGHTAWARE_API_KEY not configured')
  return providerFetch('https://aeroapi.flightaware.com/aeroapi', path, params,
    { 'x-apikey': key, Accept: 'application/json; charset=UTF-8' }, { throwOnError: true })
}

export function normalizeFaPositions(positions) {
  return (positions || []).map(p => ({
    ts:              p.timestamp,
    lat:             p.latitude,
    lon:             p.longitude,
    altitude_ft:     p.altitude != null ? p.altitude * 100 : null,
    groundspeed_kts: p.groundspeed,
    track_deg:       p.heading,
    on_ground:       p.on_ground ?? false,
  })).filter(p => p.lat != null && p.lon != null)
}

// ── FlightRadar24 (FR24_API_TOKEN) ────────────────────────────────────────────
function fr24Fetch(path, params = {}) {
  const key = process.env.FR24_API_TOKEN
  if (!key) throw new Error('FR24_API_TOKEN not configured')
  return providerFetch('https://fr24api.flightradar24.com/api', path, params,
    { Authorization: `Bearer ${key}`, 'Accept-Version': 'v1', Accept: 'application/json' }, { throwOnError: false })
}

const fr24Time = d => d.toISOString().replace(/\.\d{3}Z$/, '')

// ── Shared track shaping ─────────────────────────────────────────────────────

// On the ground? Providers don't always flag it; fall back to altitude/speed.
export function isOnGround(p) {
  if (p.on_ground === true) return true
  if (p.altitude_ft != null && p.groundspeed_kts != null) return p.altitude_ft < 500 && p.groundspeed_kts < 50
  if (p.groundspeed_kts != null) return p.groundspeed_kts < 30
  if (p.altitude_ft != null)     return p.altitude_ft < 300
  return false
}

// Dedupe by timestamp and sort chronologically.
export function mergePositions(positions) {
  const seen = new Map()
  for (const p of positions) if (p.ts && !seen.has(p.ts)) seen.set(p.ts, p)
  return [...seen.values()].sort((a, b) => new Date(a.ts) - new Date(b.ts))
}

// Crop a chronological track to the block-time window (all times UTC). Points
// before time_out are dropped. At time_in the track is cut, unless the aircraft
// is still airborne, in which case it runs on until the first ground point.
export function boundTrack(positions, timeOut, timeIn) {
  if (!positions.length) return positions
  const t0 = timeOut ? new Date(timeOut).getTime() : -Infinity
  const t1 = timeIn  ? new Date(timeIn).getTime()  :  Infinity
  const at = p => new Date(p.ts).getTime()

  const fromStart = positions.filter(p => at(p) >= t0)
  if (!fromStart.length) return positions // window filtered everything: keep it all
  if (t1 === Infinity) return fromStart

  const inWindow = fromStart.filter(p => at(p) <= t1)
  const afterEnd = fromStart.filter(p => at(p) >  t1)
  const last = inWindow[inWindow.length - 1]
  if (!last || isOnGround(last) || !afterEnd.length) return inWindow

  const extended = [...inWindow]
  for (const p of afterEnd) {
    extended.push(p)
    if (isOnGround(p)) break
  }
  return extended
}

// Match of a provider flight's departure/arrival to the logbook's (K-prefix-insensitive).
function airportScore(flight, dep, arr) {
  let score = 0
  if (normIcao(flight.departure_icao) && normIcao(dep) === normIcao(flight.departure_icao)) score += 4
  if (normIcao(flight.arrival_icao)   && normIcao(arr) === normIcao(flight.arrival_icao))   score += 4
  return score
}
const loggedMinutes = f => f.total_duration ? parseFloat(f.total_duration) * 60 : null

export function scoreFaCandidate(flight, ff) {
  let score = airportScore(flight, ff.origin?.code, ff.destination?.code)
  const logMin = loggedMinutes(flight)
  if (logMin && ff.actual_off && ff.actual_on) {
    const durMin = (new Date(ff.actual_on) - new Date(ff.actual_off)) / 60000
    const ratio  = Math.min(logMin, durMin) / Math.max(logMin, durMin)
    score += ratio > 0.8 ? 5 : ratio > 0.55 ? 3 : ratio > 0.35 ? 1 : 0
  }
  return score
}

export function scoreFr24Candidate(flight, ff, timeOut) {
  let score = airportScore(flight, ff.orig_icao, ff.dest_icao_actual || ff.dest_icao)
  const deptTs = new Date(ff.datetime_takeoff || ff.first_seen || 0)
  if (timeOut && !isNaN(deptTs)) {
    const diffMin = Math.abs(new Date(timeOut) - deptTs) / 60000
    score += diffMin < 20 ? 5 : diffMin < 45 ? 3 : diffMin < 90 ? 1 : 0
  }
  const logMin = loggedMinutes(flight)
  if (logMin && ff.duration_min) {
    const ratio = Math.min(logMin, ff.duration_min) / Math.max(logMin, ff.duration_min)
    score += ratio > 0.85 ? 3 : ratio > 0.65 ? 1 : 0
  }
  return score
}

// Fetch each candidate's positions (best score first) and merge them.
async function collectPositions(scored, idOf, fetchPositions) {
  const all = [], ids = []
  for (const { ff } of scored) {
    const id = idOf(ff)
    if (!id) continue
    await sleep(300)
    try {
      const pts = await fetchPositions(id)
      if (pts.length) { all.push(...pts); ids.push(id) }
    } catch (_) {}
  }
  return { merged: mergePositions(all), ids }
}

// FlightAware search window: ±2 h around the block times, or up to 6 h after
// time_out when time_in is unknown.
export function flightAwareWindow(timeOut, timeIn) {
  const start = new Date(new Date(timeOut).getTime() - 2 * HOUR)
  const end = timeIn ? new Date(new Date(timeIn).getTime() + 2 * HOUR) : new Date(new Date(timeOut).getTime() + 6 * HOUR)
  return { start, end }
}

// Track for a logged flight from FlightAware. Requires timeOut.
// Returns { candidates, positions, ids, score }.
export async function findFlightAwareTrack(flight, { timeOut, timeIn }) {
  const { start, end } = flightAwareWindow(timeOut, timeIn)
  const data = await faFetch(`/history/flights/${encodeURIComponent(flight.tail_number)}`, {
    start: start.toISOString(), end: end.toISOString(), max_pages: 1,
  })
  const candidates = Array.isArray(data?.flights) ? data.flights : []
  if (!candidates.length) return { candidates: 0, positions: [], ids: [] }

  const scored = candidates.map(ff => ({ ff, score: scoreFaCandidate(flight, ff) })).sort((a, b) => b.score - a.score)
  const { merged, ids } = await collectPositions(scored, ff => ff.fa_flight_id, async id =>
    normalizeFaPositions((await faFetch(`/history/flights/${encodeURIComponent(id)}/track`))?.positions))
  return { candidates: candidates.length, positions: boundTrack(merged, timeOut, timeIn), ids, score: scored[0].score }
}

// Track for a logged flight from FR24, searching ±24 h around time_out (or
// 19:00Z on the flight date when no block time is known).
export async function findFr24Track(flight, { timeOut, timeIn }) {
  const anchor = timeOut ? new Date(timeOut) : new Date(String(flight.date).slice(0, 10) + 'T19:00:00Z')
  const data = await fr24Fetch('/flight-summary/full', {
    registrations:        flight.tail_number,
    flight_datetime_from: fr24Time(new Date(anchor.getTime() - 24 * HOUR)),
    flight_datetime_to:   fr24Time(new Date(anchor.getTime() + 24 * HOUR)),
    limit:                20,
  })
  const candidates = Array.isArray(data?.data) ? data.data : []
  if (!candidates.length) return { candidates: 0, positions: [], ids: [] }

  const scored = candidates.map(ff => ({ ff, score: scoreFr24Candidate(flight, ff, timeOut) })).sort((a, b) => b.score - a.score)
  const { merged, ids } = await collectPositions(scored, ff => ff.fr24_id, async id => {
    const t = await fr24Fetch('/flight-tracks', { flight_id: id })
    return normalizeFr24Positions(t?.[0]?.tracks).filter(p => p.lat != null && p.lon != null)
  })
  return { candidates: candidates.length, positions: boundTrack(merged, timeOut, timeIn), ids, score: scored[0].score }
}

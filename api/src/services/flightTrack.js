// Flight GPS tracks: normalization of provider data into the track_log_points
// schema, and persistence tagged with the provider the route came from.
//
// Normalized point: { ts, lat, lon, altitude_ft, groundspeed_kts, track_deg,
//                     vertical_speed_fpm, on_ground }
import { fetchOpenSkyTrack, normalizeIcao24, openSkyHeaders } from './opensky.js'
import { getAdsbLolTrace, normalizeAdsbLol, utcDatesBetween } from './adsblol.js'
import { recentTracePoints } from './recentTraces.js'
import { stitch } from './stitch.js'
import { loadSchedules, scheduleWindow } from './schedules.js'

const TRACK_SOURCES = ['opensky', 'fr24', 'aeroapi', 'foreflight_csv', 'adsblol', 'adsbfi', 'airplaneslive', 'theairtraffic', 'adsbexchange', 'upload']

// FR24 v1 /flight-tracks positions: ISO timestamp, alt ft, gspeed kt, vspeed fpm.
export function normalizeFr24Positions(positions) {
  return (positions || []).map(p => ({
    ts:               typeof p.timestamp === 'string' ? p.timestamp
                        : new Date((p.timestamp ?? p.ts) * 1000).toISOString(),
    lat:              p.lat ?? p.latitude,
    lon:              p.lon ?? p.longitude,
    altitude_ft:      p.alt ?? Math.round(p.altitude ?? 0),
    groundspeed_kts:  p.gspeed ?? p.spd ?? p.speed ?? p.groundspeed ?? null,
    track_deg:        p.track ?? p.hdg ?? p.heading ?? p.track_deg ?? null,
    vertical_speed_fpm: p.vspeed ?? null,
    on_ground:        (p.alt ?? p.altitude ?? 999) <= 200,
  }))
}

// Replace a flight's track with the airborne points, tagged with `source`
// (or each point's own `source`, for tracks merged from several providers).
// One statement (DELETE in a CTE + INSERT), so readers never see a half-written
// track. `db` is anything with pg's query(): the pool or a transaction client.
// `keepGround` keeps taxi and stop points too (stitched tracks), flagged on_ground.
export async function saveTrackPoints(db, flightId, points, source, { keepGround = false } = {}) {
  if (!TRACK_SOURCES.includes(source)) {
    throw new Error(`saveTrackPoints: invalid source '${source}' (must be one of ${TRACK_SOURCES.join(', ')})`)
  }
  const airborne = points.filter(p => p.lat != null && p.lon != null && (keepGround || !p.on_ground))
  const col = k => airborne.map(p => p[k] ?? null)
  await db.query(
    `WITH cleared AS (DELETE FROM track_log_points WHERE flight_id = $1)
     INSERT INTO track_log_points
       (flight_id, ts, lat, lon, altitude_ft, groundspeed_kts, track_deg, vertical_speed_fpm, source, on_ground)
     SELECT $1, t.ts, t.lat, t.lon, t.alt, t.gs, t.trk, t.vs, t.src, t.gnd
     FROM unnest($2::timestamptz[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::text[], $10::boolean[])
       AS t(ts, lat, lon, alt, gs, trk, vs, src, gnd)`,
    [flightId, col('ts'), col('lat'), col('lon'), col('altitude_ft'),
     col('groundspeed_kts'), col('track_deg'), col('vertical_speed_fpm'),
     airborne.map(p => (TRACK_SOURCES.includes(p.source) ? p.source : source)),
     airborne.map(p => !!p.on_ground)]
  )
  return airborne.length
}

// Fetch and save the OpenSky track for a logged flight, using its aircraft's
// Mode S hex and block-out time. Returns { success, points_saved, total_points }
// or { error }.
export async function autoFetchOpenSkyTrack(pool, flightId) {
  const { rows } = await pool.query(`
    SELECT f.id, f.date::text, f.time_out, ac.mode_s_hex
    FROM flights f
    JOIN aircraft ac ON ac.id = f.aircraft_id
    WHERE f.id = $1
  `, [flightId])

  if (!rows.length) return { error: 'Flight not found' }
  const f = rows[0]
  if (!f.mode_s_hex) return { error: 'No Mode S hex code for aircraft' }

  // Anchor: block-out time if known, else 18:00Z (late morning Pacific) on the flight date.
  const queryTs = f.time_out
    ? Math.floor(new Date(f.time_out).getTime() / 1000)
    : Math.floor(new Date(String(f.date).slice(0, 10) + 'T18:00:00Z').getTime() / 1000)

  const result = await fetchOpenSkyTrack(normalizeIcao24(f.mode_s_hex), queryTs)
  if (result.status) return { error: `OpenSky returned ${result.status}` }
  if (!result.path?.length) return { error: 'No track data from OpenSky', points_saved: 0 }

  const saved = await saveTrackPoints(pool, flightId, result.path, 'opensky')
  return { success: true, points_saved: saved, total_points: result.path.length }
}

// ── Multi-leg, multi-source tracks ──────────────────────────────────────────
// OpenSky splits a flight into one "flight" per landing, and /tracks/all only
// returns one of them. List every leg the aircraft flew in the window and fetch
// each one's track. Returns { legs, points, status }.
export async function openSkyTrack(hex, fromMs, toMs, log) {
  const begin = Math.floor(fromMs / 1000), end = Math.floor(toMs / 1000)
  const r = await fetch(`https://opensky-network.org/api/flights/aircraft?icao24=${hex}&begin=${begin}&end=${end}`,
    { headers: await openSkyHeaders(log), signal: AbortSignal.timeout(15000) }).catch(e => ({ ok: false, status: e.message }))
  if (r.status === 404) return { legs: [], points: [] }
  if (!r.ok) return { legs: [], points: [], status: r.status }
  const legs = (await r.json()).filter(l => l.firstSeen)
  const points = []
  for (const leg of legs) {
    const t = await fetchOpenSkyTrack(hex, leg.firstSeen).catch(() => null)
    for (const p of t?.path || []) points.push({ ...p, source: 'opensky' })
  }
  return { legs: legs.map(l => ({ from: l.estDepartureAirport, to: l.estArrivalAirport, firstSeen: l.firstSeen, lastSeen: l.lastSeen })), points }
}

export { mergeTracks } from './stitch.js'

// Airborne coverage of a track, for deciding whether a new one is better.
export function coverage(points) {
  const air = points.filter(p => !p.on_ground)
  if (!air.length) return { points: 0, seconds: 0 }
  return { points: air.length, seconds: (Date.parse(air.at(-1).ts) - Date.parse(air[0].ts)) / 1000 }
}

// Everything known about where an aircraft flew between fromMs and toMs.
// adsb.lol days that aren't published yet are listed in `pending`.
export async function collectTrack({ hex, flightId = null, fromMs, toMs, log, useAdsbLol = true }) {
  const os = await openSkyTrack(hex, fromMs, toMs, log).catch(e => { log?.warn({ err: e.message }, 'OpenSky track failed'); return { legs: [], points: [] } })
  const adsb = [], pending = []
  if (useAdsbLol) {
    for (const day of utcDatesBetween(fromMs, toMs)) {
      try {
        const r = await getAdsbLolTrace(hex, day, log)
        if (r.pending) pending.push(day)
        else adsb.push(...normalizeAdsbLol(r.trace))
      } catch (e) { log?.warn({ err: e.message, day }, 'adsb.lol lookup failed'); pending.push(day) }
    }
  }
  const recent = await recentTracePoints(hex, fromMs, toMs, log, flightId ? [`flight:${flightId}`] : []).catch(e => { log?.warn({ err: e.message }, 'Recent traces failed'); return [] })
  const inWindow = p => { const t = Date.parse(p.ts); return t >= fromMs && t <= toMs }
  const bySource = {}
  for (const p of [...os.points, ...adsb, ...recent]) if (inWindow(p)) (bySource[p.source] ||= []).push(p)
  const points = stitch(bySource)
  const counts = {}
  for (const p of points) counts[p.source] = (counts[p.source] || 0) + 1
  return { points, legs: os.legs, pending, counts }
}

// The window to search for a flight's track: its block times (or its NICE AIR
// booking's), widened for taxi and late landings; the whole Pacific day otherwise.
export function searchWindow({ timeOut, timeIn, date }) {
  if (timeOut) {
    const out = Date.parse(timeOut)
    const inn = timeIn ? Date.parse(timeIn) : out + 4 * 3600_000
    return { fromMs: out - 45 * 60_000, toMs: Math.max(inn, out + 30 * 60_000) + 60 * 60_000 }
  }
  const day = String(date).slice(0, 10)
  return { fromMs: Date.parse(day + 'T13:00:00Z'), toMs: Date.parse(day + 'T13:00:00Z') + 20 * 3600_000 }
}

// Where to look for a logged flight's track: the union of its logged block
// times, its NICE AIR booking, and its logged duration after block-out. Logged
// times alone can be one leg's (an ADS-B detection only sees the first leg).
export function flightSearchWindow(f, dateSchedules) {
  const iso = v => (v ? new Date(v).toISOString() : null)
  const spans = []
  if (f.time_out) spans.push(searchWindow({ timeOut: iso(f.time_out), timeIn: iso(f.time_in) }))
  const booked = scheduleWindow({ ...f, time_out: null, time_in: null }, dateSchedules)
  if (booked.timeOut) spans.push(searchWindow(booked))
  const hours = parseFloat(f.total_duration) || 0
  if (f.time_out && hours) spans.push(searchWindow({ timeOut: iso(f.time_out), timeIn: new Date(Date.parse(f.time_out) + hours * 3600_000).toISOString() }))
  if (!spans.length) return searchWindow({ date: String(f.date).slice(0, 10) })
  return { fromMs: Math.min(...spans.map(s => s.fromMs)), toMs: Math.max(...spans.map(s => s.toMs)) }
}

// Re-collect a logged flight's track from OpenSky and adsb.lol and save it
// when it covers more of the flight than the stored one. Paid providers
// (FlightAware, FR24) are never called here.
export async function refreshFlightTrack(pool, flightId, log) {
  const { rows: [f] } = await pool.query(`
    SELECT f.id, f.date::text, f.time_out, f.time_in, f.total_duration, ac.tail_number, ac.mode_s_hex
    FROM flights f JOIN aircraft ac ON ac.id = f.aircraft_id WHERE f.id = $1`, [flightId])
  if (!f) return { error: 'Flight not found' }
  if (!f.mode_s_hex) return { error: 'No Mode S hex code for aircraft' }
  const dateStr = String(f.date).slice(0, 10)
  const { fromMs, toMs } = flightSearchWindow(f, await loadSchedules(pool, dateStr).catch(() => []))
  const found = await collectTrack({ hex: normalizeIcao24(f.mode_s_hex), flightId, fromMs, toMs, log })

  const { rows: stored } = await pool.query(
    'SELECT ts, on_ground FROM track_log_points WHERE flight_id = $1 ORDER BY ts', [flightId])
  const before = coverage(stored.map(r => ({ ts: r.ts.toISOString(), on_ground: r.on_ground })))
  const after = coverage(found.points)
  // Ground points count too: a stitch that adds the taxi and stops is better.
  const better = after.seconds > before.seconds + 60 || (after.seconds >= before.seconds && found.points.length > stored.length)
  let saved = 0
  if (better && after.points) saved = await saveTrackPoints(pool, flightId, found.points, 'opensky', { keepGround: true })
  return { saved, replaced: better && !!after.points, before, after, counts: found.counts, legs: found.legs, pending: found.pending }
}

// Temporary FlightAware-vs-FlightRadar24 track comparison tool.
// For a given logged flight, fetches each source's best-matching ADS-B
// session (grouping raw legs the same way the one-off cross-check analysis
// did: a new session starts after 45+ min on the ground, and we pick the
// session starting closest to the flight's NICE AIR booking time / logged
// block-out), then fetches the actual position track for that session so it
// can be drawn on a map. Everything is cached in flight_track_compare_cache
// once fetched — these are immutable historical ADS-B records, so a flight
// is only ever fetched from the two APIs once.

import { pool } from '../db/client.js'

const FA_BASE = 'https://aeroapi.flightaware.com/aeroapi'
const FR24_BASE = 'https://fr24api.flightradar24.com/api'

async function faFetch(path) {
  const key = process.env.FLIGHTAWARE_API_KEY
  if (!key) throw new Error('FLIGHTAWARE_API_KEY not configured')
  const r = await fetch(FA_BASE + path, {
    headers: { 'x-apikey': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  if (r.status === 429) {
    await new Promise(res => setTimeout(res, 5000))
    return faFetch(path)
  }
  if (!r.ok) return null
  return r.json()
}

function fr24Fmt(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, '')
}

async function fr24Fetch(path) {
  const key = process.env.FR24_API_TOKEN
  if (!key) throw new Error('FR24_API_TOKEN not configured')
  const r = await fetch(FR24_BASE + path, {
    headers: { Authorization: `Bearer ${key}`, 'Accept-Version': 'v1', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  if (r.status === 429) {
    await new Promise(res => setTimeout(res, 5000))
    return fr24Fetch(path)
  }
  if (!r.ok) return null
  return r.json()
}

function buildSessions(legs, rangeFn, gapMinutes = 45) {
  const items = legs
    .map(leg => { const [s, e] = rangeFn(leg); return s || e ? { s: s || e, e: e || s, leg } : null })
    .filter(Boolean)
    .sort((a, b) => a.s - b.s)
  const sessions = []
  let cur = null
  for (const { s, e, leg } of items) {
    if (!cur) { cur = { start: s, end: e, legs: [leg] } }
    else if ((s - cur.end) / 60000 <= gapMinutes) { cur.end = e > cur.end ? e : cur.end; cur.legs.push(leg) }
    else { sessions.push(cur); cur = { start: s, end: e, legs: [leg] } }
  }
  if (cur) sessions.push(cur)
  return sessions
}

function pickBestSession(sessions, anchor, maxGapHours) {
  if (!sessions.length || !anchor) return { session: null, diffHours: null }
  let best = null, bestDiff = null
  for (const sess of sessions) {
    const diff = Math.abs(sess.start - anchor) / 3600000
    if (bestDiff === null || diff < bestDiff) { best = sess; bestDiff = diff }
  }
  if (bestDiff !== null && bestDiff <= maxGapHours) return { session: best, diffHours: bestDiff }
  return { session: null, diffHours: bestDiff }
}

function faRange(leg) {
  const s = leg.actual_off || leg.scheduled_off || leg.estimated_off
  const e = leg.actual_on || leg.scheduled_on || leg.estimated_on
  return [s ? new Date(s) : null, e ? new Date(e) : null]
}

function fr24Range(leg) {
  const s = leg.datetime_takeoff || leg.first_seen
  const e = leg.datetime_landed || leg.last_seen
  return [s ? new Date(s) : null, e ? new Date(e) : null]
}

async function getAnchor(tail, dateStr, timeOut) {
  const tailShort = tail.replace(/^N/, '')
  const { rows } = await pool.query(
    `SELECT start_unix, cfi FROM nice_air_schedules
     WHERE date_str = $1 AND type != 'cancelled' AND (tail = $2 OR tail = $3)
     ORDER BY received_at DESC NULLS LAST LIMIT 1`,
    [dateStr, tail, tailShort]
  )
  if (rows.length && rows[0].start_unix) {
    return { anchor: new Date(rows[0].start_unix * 1000), source: 'nice_air', cfi: rows[0].cfi }
  }
  if (timeOut) return { anchor: new Date(timeOut), source: 'time_out', cfi: null }
  return { anchor: new Date(dateStr + 'T19:00:00Z'), source: 'fallback', cfi: null }
}

function haversineNm(a, b) {
  const R = 3440.065 // nm
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function summarizeTrack(points) {
  if (!points.length) return { point_count: 0 }
  let peakAlt = 0, maxGs = 0, gsSum = 0, gsN = 0, dist = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.altitude_ft != null) peakAlt = Math.max(peakAlt, p.altitude_ft)
    if (p.groundspeed_kts != null) { maxGs = Math.max(maxGs, p.groundspeed_kts); gsSum += p.groundspeed_kts; gsN++ }
    if (i > 0) dist += haversineNm(points[i - 1], p)
  }
  return {
    point_count: points.length,
    peak_altitude_ft: peakAlt || null,
    max_groundspeed_kts: maxGs || null,
    avg_groundspeed_kts: gsN ? Math.round(gsSum / gsN) : null,
    track_distance_nm: Math.round(dist * 10) / 10,
    start_ts: points[0].ts,
    end_ts: points[points.length - 1].ts,
  }
}

async function fetchAeroApiComparison(tail, dateStr, anchor) {
  const win = new Date(anchor.getTime() - 24 * 3600 * 1000)
  const winEnd = new Date(anchor.getTime() + 24 * 3600 * 1000)
  const data = await faFetch(`/history/flights/${encodeURIComponent(tail)}?start=${win.toISOString()}&end=${winEnd.toISOString()}`)
  const legs = data?.flights || []
  const sessions = buildSessions(legs, faRange)
  const { session, diffHours } = pickBestSession(sessions, anchor, 6)
  if (!session) return { session: null, track: [], meta: { diff_hours: diffHours } }

  const airports = new Set()
  const flags = []
  for (const leg of session.legs) {
    if (leg.origin?.code_icao) airports.add(leg.origin.code_icao)
    if (leg.destination?.code_icao) airports.add(leg.destination.code_icao)
    if (leg.diverted) flags.push('diverted')
    if (leg.cancelled) flags.push('cancelled')
  }

  let track = []
  for (const leg of session.legs) {
    if (!leg.fa_flight_id) continue
    const t = await faFetch(`/history/flights/${encodeURIComponent(leg.fa_flight_id)}/track`)
    const positions = (t?.positions || []).map(p => ({
      ts: p.timestamp, lat: p.latitude, lon: p.longitude,
      altitude_ft: p.altitude != null ? p.altitude * 100 : null,
      groundspeed_kts: p.groundspeed ?? null,
      heading: p.heading ?? null,
    })).filter(p => p.lat != null && p.lon != null)
    track = track.concat(positions)
  }

  return {
    session: {
      start: session.start.toISOString(), end: session.end.toISOString(),
      leg_count: session.legs.length, airports: [...airports].sort(), flags,
    },
    track,
    meta: { diff_hours: Math.round(diffHours * 10) / 10 },
  }
}

async function fetchFr24Comparison(tail, dateStr, anchor) {
  const win = fr24Fmt(new Date(anchor.getTime() - 24 * 3600 * 1000))
  const winEnd = fr24Fmt(new Date(anchor.getTime() + 24 * 3600 * 1000))
  const data = await fr24Fetch(`/flight-summary/full?registrations=${encodeURIComponent(tail)}&flight_datetime_from=${encodeURIComponent(win)}&flight_datetime_to=${encodeURIComponent(winEnd)}`)
  const legs = data?.data || []
  const sessions = buildSessions(legs, fr24Range)
  const { session, diffHours } = pickBestSession(sessions, anchor, 6)
  if (!session) return { session: null, track: [], meta: { diff_hours: diffHours } }

  const airports = new Set()
  for (const leg of session.legs) {
    if (leg.orig_icao) airports.add(leg.orig_icao)
    const d = leg.dest_icao_actual || leg.dest_icao
    if (d) airports.add(d)
  }

  let track = []
  for (const leg of session.legs) {
    if (!leg.fr24_id) continue
    const t = await fr24Fetch(`/flight-tracks?flight_id=${encodeURIComponent(leg.fr24_id)}`)
    const positions = ((t?.[0]?.tracks) || []).map(p => ({
      ts: p.timestamp, lat: p.lat, lon: p.lon,
      altitude_ft: p.alt ?? null,
      groundspeed_kts: p.gspeed ?? null,
      heading: p.track ?? null,
    })).filter(p => p.lat != null && p.lon != null)
    track = track.concat(positions)
  }

  return {
    session: {
      start: session.start.toISOString(), end: session.end.toISOString(),
      leg_count: session.legs.length, airports: [...airports].sort(),
    },
    track,
    meta: { diff_hours: Math.round(diffHours * 10) / 10 },
  }
}

export async function getComparison(flightId, log) {
  const { rows: fRows } = await pool.query(`
    SELECT f.id, f.date::text, f.time_out, f.time_in, f.total_duration,
           f.departure_icao, f.arrival_icao, f.via,
           ac.tail_number
    FROM flights f
    LEFT JOIN aircraft ac ON ac.id = f.aircraft_id
    WHERE f.id = $1
  `, [flightId])
  if (!fRows.length) return { error: 'Flight not found' }
  const f = fRows[0]
  if (!f.tail_number) return { error: 'No aircraft on record for this flight' }

  const dateStr = f.date
  const { anchor, source: anchorSource, cfi } = await getAnchor(f.tail_number, dateStr, f.time_out)

  const result = { flight: f, anchor: anchor.toISOString(), anchor_source: anchorSource, cfi }

  for (const source of ['aeroapi', 'fr24']) {
    const { rows: cached } = await pool.query(
      'SELECT session_json, track_json FROM flight_track_compare_cache WHERE flight_id=$1 AND source=$2',
      [flightId, source]
    )
    if (cached.length) {
      const track = cached[0].track_json || []
      result[source] = { session: cached[0].session_json, track, summary: summarizeTrack(track) }
      continue
    }

    let fetched
    try {
      fetched = source === 'aeroapi'
        ? await fetchAeroApiComparison(f.tail_number, dateStr, anchor)
        : await fetchFr24Comparison(f.tail_number, dateStr, anchor)
    } catch (e) {
      log?.warn({ err: e.message, source, flightId }, 'Track compare fetch failed')
      fetched = { session: null, track: [], meta: { error: e.message } }
    }

    await pool.query(
      `INSERT INTO flight_track_compare_cache (flight_id, source, session_json, track_json)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (flight_id, source) DO UPDATE SET session_json=$3, track_json=$4, fetched_at=NOW()`,
      [flightId, source, JSON.stringify(fetched.session), JSON.stringify(fetched.track)]
    )

    result[source] = { session: fetched.session, track: fetched.track, summary: summarizeTrack(fetched.track), meta: fetched.meta }
  }

  return result
}

// Apply a flight's already-recorded choice to production: update the
// logged via-airports if the chosen session's airport set actually differs
// (an unchanged set never touches the existing array, so an already-correct
// via order is never regressed by a differently-sorted cache), and replace
// track_log_points with the chosen source's track. Does nothing (returns
// {skipped: reason}) if there's no choice or no usable cached track.
export async function applyChoice(flightId) {
  const { rows: choiceRows } = await pool.query(
    'SELECT chosen_source FROM flight_track_choice WHERE flight_id=$1', [flightId]
  )
  if (!choiceRows.length) return { skipped: 'no choice recorded' }
  const source = choiceRows[0].chosen_source
  if (source === 'neither') return { skipped: 'chosen as neither' }

  const { rows: fRows } = await pool.query(
    'SELECT departure_icao, arrival_icao, via FROM flights WHERE id=$1', [flightId]
  )
  if (!fRows.length) return { error: 'Flight not found' }
  const f = fRows[0]

  const { rows: cacheRows } = await pool.query(
    'SELECT session_json, track_json FROM flight_track_compare_cache WHERE flight_id=$1 AND source=$2',
    [flightId, source]
  )
  if (!cacheRows.length) return { skipped: `no cached comparison for ${source}` }
  const { session_json, track_json } = cacheRows[0]
  const track = track_json || []
  if (!track.length) return { skipped: `${source} has no track points for this flight` }

  let viaChanged = false
  const sessionAirports = session_json?.airports || []
  const computedVia = sessionAirports.filter(a => a !== f.departure_icao && a !== f.arrival_icao)
  const curSet = new Set(f.via || [])
  const newSet = new Set(computedVia)
  const sameSet = curSet.size === newSet.size && [...curSet].every(a => newSet.has(a))
  if (!sameSet) {
    await pool.query('UPDATE flights SET via=$1 WHERE id=$2', [computedVia, flightId])
    viaChanged = true
  }

  await pool.query('DELETE FROM track_log_points WHERE flight_id=$1', [flightId])
  const airborne = track.filter(p => p.lat != null && p.lon != null)
  if (airborne.length) {
    const rows = airborne.map(p =>
      `(${flightId}, '${p.ts}', ${p.lat}, ${p.lon}, ${p.altitude_ft ?? 'NULL'}, ` +
      `${p.groundspeed_kts ?? 'NULL'}, ${p.heading ?? 'NULL'}, NULL)`
    )
    await pool.query(
      `INSERT INTO track_log_points (flight_id, ts, lat, lon, altitude_ft, groundspeed_kts, track_deg, vertical_speed_fpm)
       VALUES ${rows.join(',')}`
    )
  }

  return { applied: true, source, via_changed: viaChanged, via: viaChanged ? computedVia : f.via, track_points: airborne.length }
}

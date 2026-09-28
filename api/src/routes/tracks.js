// Flight track endpoints: OpenSky departures/tracks, attaching a track to a
// logbook entry, and backfilling tracks from OpenSky, FR24, or FlightAware.
import { pool, queryRowsOrNull } from '../db/client.js'
import { openSkyHeaders, fetchOpenSkyTrack, normalizeIcao24 } from '../services/opensky.js'
import { saveTrackPoints, autoFetchOpenSkyTrack } from '../services/flightTrack.js'
import { loadSchedules, scheduleWindow } from '../services/schedules.js'
import { findFlightAwareTrack, findFr24Track, flightAwareWindow } from '../services/trackProviders.js'

const OPENSKY_NEEDS_AUTH = 'OpenSky historical tracks require credentials. Add OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET to .env.'

async function flightForTrack(flightId) {
  const { rows } = await pool.query(`
    SELECT f.id, f.date::text, f.departure_icao, f.arrival_icao,
           f.time_out, f.time_in, f.total_duration, ac.tail_number
    FROM flights f
    JOIN aircraft ac ON ac.id = f.aircraft_id
    WHERE f.id = $1
  `, [flightId])
  return rows[0] || null
}

async function windowFor(flight) {
  const dateSchedules = await loadSchedules(pool, String(flight.date).slice(0, 10)).catch(() => [])
  return scheduleWindow(flight, dateSchedules)
}

// ── FlightAware batch backfill ───────────────────────────────────────────────
const FA_FLIGHT_DELAY = 1000 // 1 s between flights (Standard plan: 5 req/s, ≥2 calls per flight)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function runFaBackfill(toProcess, job, log) {
  const emit = obj => { job.log.push(obj); if (job.maxLog && job.log.length > job.maxLog) job.log.shift() }
  const schedules = await loadSchedules(pool).catch(() => [])

  for (const f of toProcess) {
    const tail = f.tail_number
    const dateStr = String(f.date).slice(0, 10)
    const base = { id: f.id, date: dateStr, tail }
    try {
      const { timeOut, timeIn } = scheduleWindow(f, schedules.filter(s => s.date_str === dateStr))
      if (!timeOut) {
        emit({ ...base, status: 'no_window', reason: 'no time_out in DB or schedules' })
        job.counts.no_window++
      } else {
        const win = flightAwareWindow(timeOut, timeIn)
        emit({ ...base, status: 'searching', window_from: win.start.toISOString(), window_to: win.end.toISOString() })
        const t = await findFlightAwareTrack(f, { timeOut, timeIn })
        if (!t.candidates) {
          emit({ ...base, status: 'no_fa_flight' })
          job.counts.no_positions++
        } else if (!t.positions.length) {
          emit({ ...base, status: 'no_positions', fa_flight_ids: t.ids })
          job.counts.no_positions++
        } else {
          const saved = await saveTrackPoints(pool, f.id, t.positions, 'aeroapi')
          emit({ ...base, status: 'ok', points: saved, fa_flight_ids: t.ids, score: t.score })
          job.counts.ok++
        }
      }
    } catch (e) {
      emit({ ...base, status: 'error', reason: e.message })
      job.counts.errors++
    }
    await sleep(FA_FLIGHT_DELAY)
  }

  job.done = true
  job.counts.processed = toProcess.length
  log?.info({ counts: job.counts }, 'FlightAware backfill complete')
}

// maxLog bounds the in-memory log of a background job. The streaming mode reads
// the log by index, so it keeps every entry.
const newJob = (maxLog = null) => ({ started: new Date().toISOString(), done: false, counts: { ok: 0, no_window: 0, no_positions: 0, errors: 0 }, log: [], maxLog })

export default async function trackRoutes(fastify) {
  // ── OpenSky: flights seen departing an airport on a date ────────────────────
  // A completed day's list never changes, so it's cached in opensky_departures_cache.
  fastify.get('/api/external/flights-detected', async (req, reply) => {
    const { departure, date, icao24 } = req.query
    if (!departure || !date) return reply.status(400).send({ error: 'departure and date required' })

    const dep = departure.toUpperCase()
    // The whole Pacific day in UTC (UTC-8 worst case), over a 32-hour window
    // so late-evening local flights are caught.
    const begin = Math.floor(new Date(date + 'T07:00:00Z').getTime() / 1000)
    const end = begin + 115200
    const windowClosed = end < Math.floor(Date.now() / 1000) - 3600 // +1 h to settle
    const forAircraft = flights => icao24 ? flights.filter(f => f.icao24?.toLowerCase() === normalizeIcao24(icao24)) : flights

    if (windowClosed) {
      const cached = await queryRowsOrNull(
        'SELECT flights_json FROM opensky_departures_cache WHERE departure_icao=$1 AND date_str=$2', [dep, date])
      if (cached?.length) return { flights: forAircraft(cached[0].flights_json), needs_auth: false, source: 'opensky_cache' }
    }

    try {
      const r = await fetch(
        `https://opensky-network.org/api/flights/departure?airport=${encodeURIComponent(dep)}&begin=${begin}&end=${end}`,
        { headers: await openSkyHeaders(fastify.log), signal: AbortSignal.timeout(12000) }
      )
      if (r.status === 401 || r.status === 403) {
        return reply.status(200).send({
          flights: [],
          needs_auth: true,
          message: 'OpenSky historical data requires credentials. Add OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET to .env.',
        })
      }
      if (r.status === 404) return reply.status(200).send({ flights: [], needs_auth: false })
      if (!r.ok) throw new Error(`OpenSky returned ${r.status}`)

      let raw = await r.json()
      if (!Array.isArray(raw)) raw = []
      // Cache every flight unfiltered so any icao24 filter can be served from it.
      const shaped = raw.map(f => ({
        icao24:          f.icao24,
        callsign:        f.callsign?.trim() || null,
        departure_icao:  f.estDepartureAirport || dep,
        arrival_icao:    f.estArrivalAirport || null,
        departure_time:  f.firstSeen ? new Date(f.firstSeen * 1000).toISOString() : null,
        arrival_time:    f.lastSeen  ? new Date(f.lastSeen  * 1000).toISOString() : null,
        duration_min:    f.firstSeen && f.lastSeen ? Math.round((f.lastSeen - f.firstSeen) / 60) : null,
        first_seen_unix: f.firstSeen || null,
        last_seen_unix:  f.lastSeen  || null,
      }))
      if (windowClosed) {
        await queryRowsOrNull(
          `INSERT INTO opensky_departures_cache (departure_icao, date_str, flights_json)
           VALUES ($1, $2, $3)
           ON CONFLICT (departure_icao, date_str) DO UPDATE SET flights_json=$3, fetched_at=NOW()`,
          [dep, date, JSON.stringify(shaped)]
        )
      }
      return { flights: forAircraft(shaped), needs_auth: false, source: 'opensky' }
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'OpenSky flights-detected failed')
      return reply.status(502).send({ error: e.message })
    }
  })

  // ── OpenSky: GPS track for one aircraft near a time (cached forever) ────────
  fastify.get('/api/external/flight-track', async (req, reply) => {
    const { icao24, time } = req.query // time: Unix seconds near the flight's start
    if (!icao24 || !time) return reply.status(400).send({ error: 'icao24 and time required' })
    const hex = normalizeIcao24(icao24)
    try {
      const t = await fetchOpenSkyTrack(hex, parseInt(time))
      if (t.status === 401 || t.status === 403) return reply.status(200).send({ track: null, needs_auth: true })
      if (t.status) return reply.status(200).send({ track: null })
      return {
        track: { icao24: t.cached ? hex : t.icao24, callsign: t.callsign, path: t.path },
        source: t.cached ? 'opensky_cache' : 'opensky',
      }
    } catch (e) {
      return reply.status(200).send({ track: null })
    }
  })

  // ── Attach an OpenSky track to a logbook entry ──────────────────────────────
  fastify.post('/api/external/attach-track', async (req, reply) => {
    const { flight_id, icao24, first_seen_unix } = req.body || {}
    if (!flight_id || !icao24 || !first_seen_unix) {
      return reply.status(400).send({ error: 'flight_id, icao24, first_seen_unix required' })
    }
    const t = await fetchOpenSkyTrack(normalizeIcao24(icao24), parseInt(first_seen_unix))
    if (t.status === 401 || t.status === 403) return reply.status(200).send({ error: OPENSKY_NEEDS_AUTH })
    if (t.status) return reply.status(200).send({ error: `OpenSky returned ${t.status}` })
    if (!t.path?.length) {
      return reply.status(200).send({ error: 'No GPS track points available for this flight. OpenSky may not have retained this track.' })
    }
    const saved = await saveTrackPoints(pool, flight_id, t.path, 'opensky')
    return { success: true, points_saved: saved, total_points: t.path.length }
  })

  // ── OpenSky track for a logbook entry (Mode S hex + time_out from the DB) ───
  // Also runs automatically when a flight is logged via the UI.
  fastify.post('/api/external/auto-fetch-track/:flight_id', async (req, reply) => {
    const result = await autoFetchOpenSkyTrack(pool, parseInt(req.params.flight_id))
    if (result.error && !result.points_saved) {
      return reply.status(result.error === 'Flight not found' ? 404 : 200).send(result)
    }
    return result
  })

  // ── FR24 track for a logbook entry: the UI's "Find Route" backfill ─────────
  fastify.post('/api/external/auto-fetch-fr24-track/:flight_id', async (req, reply) => {
    const flightId = parseInt(req.params.flight_id)
    if (!process.env.FR24_API_TOKEN) return reply.status(503).send({ error: 'FR24_API_TOKEN not configured' })
    const fl = await flightForTrack(flightId)
    if (!fl) return reply.status(404).send({ error: 'Flight not found' })
    const window = await windowFor(fl)
    try {
      const t = await findFr24Track(fl, window)
      if (!t.candidates) return { success: false, points_saved: 0, message: 'No FR24 flights found in window' }
      if (!t.positions.length) return { success: false, points_saved: 0, message: 'No track positions from FR24' }
      const saved = await saveTrackPoints(pool, flightId, t.positions, 'fr24')
      fastify.log.info({ flightId, tail: fl.tail_number, saved, fr24_ids: t.ids }, 'FR24 track saved')
      return { success: true, points_saved: saved, fr24_ids: t.ids, score: t.score }
    } catch (e) {
      fastify.log.warn({ flightId, tail: fl.tail_number, err: e.message }, 'FR24 track fetch failed')
      return reply.status(502).send({ error: e.message })
    }
  })

  // ── FlightAware track for a logbook entry ───────────────────────────────────
  fastify.post('/api/external/auto-fetch-fa-track/:flight_id', async (req, reply) => {
    const flightId = parseInt(req.params.flight_id)
    if (!process.env.FLIGHTAWARE_API_KEY) return reply.status(503).send({ error: 'FLIGHTAWARE_API_KEY not configured' })
    const fl = await flightForTrack(flightId)
    if (!fl) return reply.status(404).send({ error: 'Flight not found' })
    const window = await windowFor(fl)
    if (!window.timeOut) return reply.status(400).send({ error: 'No time window found in DB or schedules' })
    try {
      const t = await findFlightAwareTrack(fl, window)
      if (!t.candidates) return { success: false, points_saved: 0, message: 'No FlightAware flights found in window' }
      if (!t.positions.length) return { success: false, points_saved: 0, message: 'No track positions from FlightAware' }
      const saved = await saveTrackPoints(pool, flightId, t.positions, 'aeroapi')
      fastify.log.info({ flightId, tail: fl.tail_number, saved, fa_flight_ids: t.ids }, 'FlightAware track saved')
      return { success: true, points_saved: saved, fa_flight_ids: t.ids, score: t.score }
    } catch (e) {
      fastify.log.warn({ flightId, tail: fl.tail_number, err: e.message }, 'FlightAware track fetch failed')
      return reply.status(502).send({ error: e.message })
    }
  })

  // ── FlightAware batch backfill: every flight without a track ────────────────
  let faJob = null

  fastify.get('/api/external/fa-backfill-status', async () => {
    if (!faJob) return { running: false, started: false }
    return { running: !faJob.done, done: faJob.done, started_at: faJob.started, counts: faJob.counts, recent: faJob.log.slice(-10) }
  })

  // POST /api/external/fa-backfill?overwrite=false[&limit=N][&async=true]
  // async=true runs in the background (poll fa-backfill-status); otherwise the
  // response streams NDJSON progress lines and a final summary line.
  fastify.post('/api/external/fa-backfill', async (req, reply) => {
    const overwrite = req.query.overwrite === 'true'
    const limitN    = req.query.limit ? parseInt(req.query.limit) : null
    const { rows: flights } = await pool.query(`
      SELECT f.id, f.date::text, f.departure_icao, f.arrival_icao,
             f.time_out, f.time_in, f.total_duration, ac.tail_number,
             EXISTS(SELECT 1 FROM track_log_points tlp WHERE tlp.flight_id = f.id) AS has_track
      FROM flights f
      JOIN aircraft ac ON ac.id = f.aircraft_id
      ORDER BY f.date ASC
    `)
    let toProcess = overwrite ? flights : flights.filter(f => !f.has_track)
    if (limitN) toProcess = toProcess.slice(0, limitN)

    if (req.query.async === 'true') {
      if (faJob && !faJob.done) return { started: false, error: 'backfill already running' }
      faJob = newJob(200)
      const job = faJob
      setImmediate(() => runFaBackfill(toProcess, job, fastify.log).catch(() => { job.done = true }))
      return { started: true, total: toProcess.length }
    }

    const job = newJob()
    reply.hijack() // the response is written to the raw socket below
    reply.raw.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'X-Accel-Buffering': 'no' })
    let sent = 0
    const flush = () => { while (sent < job.log.length) reply.raw.write(JSON.stringify(job.log[sent++]) + '\n') }
    const flushInterval = setInterval(flush, 500)
    await runFaBackfill(toProcess, job, fastify.log)
    clearInterval(flushInterval)
    flush()
    const summary = { type: 'summary', total: flights.length, processed: toProcess.length, ...job.counts }
    fastify.log.info(summary, 'FlightAware backfill complete')
    reply.raw.write(JSON.stringify(summary) + '\n')
    reply.raw.end()
  })
}

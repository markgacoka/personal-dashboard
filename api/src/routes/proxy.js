// External API proxy — avoids CORS issues and centralises external calls
import { lookupAircraft, importAcftref, isAcftrefEmpty } from '../services/faa-registry.js'
import { pool } from '../db/client.js'
import { fetchNotams } from '../services/notam-fetcher.js'
import { fetchNiceAirSchedules, syncNiceAirToDB } from '../services/gmail.js'
import { getOskyToken, normalizeOpenSkyPath, saveTrackPoints, autoFetchOpenSkyTrack } from '../services/flightTrack.js'

// ── OurAirports CSV parser ────────────────────────────────────────────────────
function parseCsvLine(line) {
  const fields = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ }
    else if (ch === ',' && !inQ) { fields.push(cur); cur = '' }
    else cur += ch
  }
  fields.push(cur)
  return fields
}

// Filter CSV text to rows matching a specific airport_ident.
// Avoids parsing the full 10 MB file — only parses lines containing the ICAO string.
function filterAirportCsv(text, icao) {
  const lines = text.split('\n')
  if (!lines.length) return []
  const headers = parseCsvLine(lines[0])
  const identIdx = headers.indexOf('airport_ident')
  if (identIdx < 0) return []
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.includes(icao)) continue  // fast string scan before full parse
    const vals = parseCsvLine(line)
    if (vals[identIdx] !== icao) continue
    rows.push(Object.fromEntries(headers.map((h, j) => [h, vals[j] ?? ''])))
  }
  return rows
}

async function dbQuery(sql, params) {
  try { return (await pool.query(sql, params)).rows } catch { return null }
}

// ── FlightAware AeroAPI v4 ────────────────────────────────────────────────────
// Env var: FLIGHTAWARE_API_KEY
// Standard plan: historical flight data, 5 result-sets/second
const FA_BASE = 'https://aeroapi.flightaware.com/aeroapi'

async function faFetch(path, params = {}) {
  const key = process.env.FLIGHTAWARE_API_KEY
  if (!key) throw new Error('FLIGHTAWARE_API_KEY not configured')
  const url = new URL(FA_BASE + path)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }
  const r = await fetch(url.toString(), {
    headers: { 'x-apikey': key, Accept: 'application/json; charset=UTF-8' },
    signal: AbortSignal.timeout(20000),
  })
  if (r.status === 429) {
    const wait = parseInt(r.headers.get('Retry-After') || '5', 10) * 1000
    await new Promise(res => setTimeout(res, wait))
    return faFetch(path, params)
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error(`FlightAware ${r.status}: ${body.detail || body.title || r.statusText}`)
  }
  return r.json()
}

function normalizeFaPositions(positions) {
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

// Proxy for "aircraft is on the ground" using FA track fields.
// FA does not always emit on_ground; fall back to altitude + speed thresholds.
function faOnGround(p) {
  if (p.on_ground === true) return true
  if (p.altitude_ft != null && p.groundspeed_kts != null) return p.altitude_ft < 500 && p.groundspeed_kts < 50
  if (p.groundspeed_kts != null) return p.groundspeed_kts < 30
  if (p.altitude_ft != null)     return p.altitude_ft < 300
  return false
}

// Bound a merged, chronologically-sorted track to the schedule window.
// Schedule times (time_out / time_in) are stored in UTC in the DB (the DB values
// come from nice_air_schedules which converts PT → Unix → ISO at insert time).
// FA timestamps are also UTC, so comparison is direct.
// Start: drop any point before time_out.
// End: crop at time_in, but extend past it until landing if the aircraft is still airborne.
function boundFaTrack(positions, timeOut, timeIn) {
  if (!positions.length) return positions
  const t0 = timeOut ? new Date(timeOut).getTime() : -Infinity
  const t1  = timeIn  ? new Date(timeIn).getTime()  :  Infinity

  const fromStart = positions.filter(p => new Date(p.ts).getTime() >= t0)
  if (!fromStart.length) return positions  // edge-case: keep all if window filter empties

  if (t1 === Infinity) return fromStart   // no end bound — return everything from start

  const inWindow  = fromStart.filter(p => new Date(p.ts).getTime() <= t1)
  const afterEnd  = fromStart.filter(p => new Date(p.ts).getTime() >  t1)

  const last = inWindow[inWindow.length - 1]
  // Already landed or nothing beyond window — stop here
  if (!last || faOnGround(last) || !afterEnd.length) return inWindow

  // Still airborne at time_in — extend until landing is detected
  const extended = [...inWindow]
  for (const p of afterEnd) {
    extended.push(p)
    if (faOnGround(p)) break
  }
  return extended
}

// ── FA backfill core ──────────────────────────────────────────────────────────
const FA_FLIGHT_DELAY = 1000  // 1s between flights (Standard = 5 req/s, 2 calls/flight)

async function runFaBackfill(toProcess, job, log) {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const emit  = obj => { if (job) { job.log.push(obj); if (job.log.length > 200) job.log.shift() } }

  let allDbScheds = []
  try {
    const { rows } = await pool.query(`SELECT date_str, tail, start_unix, end_unix FROM nice_air_schedules WHERE type != 'cancelled'`)
    allDbScheds = rows
  } catch (_) {}

  for (const f of toProcess) {
    const tail    = f.tail_number
    const dateStr = String(f.date).slice(0, 10)
    const tailShort = tail.replace(/^N/, '')


    let timeOut = f.time_out
    let timeIn  = f.time_in

    if (!timeOut || !timeIn) {
      const dbMatch = allDbScheds.find(s => s.date_str === dateStr && (s.tail === tail || s.tail?.replace(/^N/, '') === tailShort))
      if (dbMatch?.start_unix) timeOut = timeOut || new Date(dbMatch.start_unix * 1000).toISOString()
      if (dbMatch?.end_unix)   timeIn  = timeIn  || new Date(dbMatch.end_unix   * 1000).toISOString()
    }
    if (!timeOut) {
      const dateScheds = allDbScheds.filter(s => s.date_str === dateStr && s.start_unix)
      if (dateScheds.length) {
        let chosen = dateScheds[0]
        if (dateScheds.length > 1 && f.total_duration) {
          const logSec = parseFloat(f.total_duration) * 3600
          chosen = dateScheds.reduce((a, b) => Math.abs((a.end_unix - a.start_unix || 0) - logSec) <= Math.abs((b.end_unix - b.start_unix || 0) - logSec) ? a : b)
        }
        timeOut = new Date(chosen.start_unix * 1000).toISOString()
        if (chosen.end_unix) timeIn = new Date(chosen.end_unix * 1000).toISOString()
      }
    }

    if (!timeOut) {
      emit({ id: f.id, date: dateStr, tail, status: 'no_window', reason: 'no time_out in DB or schedules' })
      if (job) job.counts.no_window++
      await sleep(FA_FLIGHT_DELAY)
      continue
    }

    // Build a ±2h search window around departure time
    const winStart = new Date(new Date(timeOut).getTime() - 2 * 3_600_000)
    const winEnd   = timeIn
      ? new Date(new Date(timeIn).getTime() + 2 * 3_600_000)
      : new Date(new Date(timeOut).getTime() + 6 * 3_600_000)

    emit({ id: f.id, date: dateStr, tail, status: 'searching', window_from: winStart.toISOString(), window_to: winEnd.toISOString() })

    try {
      // 1. Find matching flight(s) in the window — /history/* covers Jan 2011 onward
      const flightsData = await faFetch(`/history/flights/${encodeURIComponent(tail)}`, {
        start: winStart.toISOString(),
        end:   winEnd.toISOString(),
        max_pages: 1,
      })
      const candidates = Array.isArray(flightsData?.flights) ? flightsData.flights : []

      if (!candidates.length) {
        emit({ id: f.id, date: dateStr, tail, status: 'no_fa_flight' })
        if (job) job.counts.no_positions++
        await sleep(FA_FLIGHT_DELAY)
        continue
      }

      // Score for metadata — multi-leg flights (e.g. KRHV→KLSN→KRHV) appear as separate
      // FA records. Fetch and merge tracks from ALL candidates so no leg is cut off.
      const norm   = ic => (ic || '').toUpperCase().replace(/^K/, '')
      const logDep = norm(f.departure_icao)
      const logArr = norm(f.arrival_icao)
      const logMin = f.total_duration ? parseFloat(f.total_duration) * 60 : null
      const scored = candidates.map(ff => {
        let score = 0
        if (logDep && norm(ff.origin?.code || '') === logDep)      score += 4
        if (logArr && norm(ff.destination?.code || '') === logArr)  score += 4
        if (logMin && ff.actual_off && ff.actual_on) {
          const durMin = (new Date(ff.actual_on) - new Date(ff.actual_off)) / 60000
          const ratio  = Math.min(logMin, durMin) / Math.max(logMin, durMin)
          score += ratio > 0.8 ? 5 : ratio > 0.55 ? 3 : ratio > 0.35 ? 1 : 0
        }
        return { ff, score }
      }).sort((a, b) => b.score - a.score)

      // Fetch track for every candidate and merge — captures all legs of the flight
      const allPositions = []
      const okFaIds = []
      for (const { ff } of scored) {
        if (!ff.fa_flight_id) continue
        await sleep(300)
        try {
          const td  = await faFetch(`/history/flights/${encodeURIComponent(ff.fa_flight_id)}/track`)
          const pts = normalizeFaPositions(td?.positions)
          if (pts.length) { allPositions.push(...pts); okFaIds.push(ff.fa_flight_id) }
        } catch (_) {}
      }

      // Deduplicate by timestamp, sort chronologically, then bound to schedule window
      const seen = new Map()
      for (const p of allPositions) { if (p.ts && !seen.has(p.ts)) seen.set(p.ts, p) }
      const merged  = [...seen.values()].sort((a, b) => new Date(a.ts) - new Date(b.ts))
      const bounded = boundFaTrack(merged, timeOut, timeIn)

      if (!bounded.length) {
        emit({ id: f.id, date: dateStr, tail, status: 'no_positions', fa_flight_ids: okFaIds })
        if (job) job.counts.no_positions++
        await sleep(FA_FLIGHT_DELAY)
        continue
      }

      const saved = await saveTrackPoints(pool, f.id, bounded)
      emit({ id: f.id, date: dateStr, tail, status: 'ok', points: saved, fa_flight_ids: okFaIds, score: scored[0].score })
      if (job) job.counts.ok++
    } catch (e) {
      emit({ id: f.id, date: dateStr, tail, status: 'error', reason: e.message })
      if (job) job.counts.errors++
    }
    await sleep(FA_FLIGHT_DELAY)
  }

  if (job) { job.done = true; job.counts.processed = toProcess.length }
  log?.info({ counts: job?.counts }, 'FlightAware backfill complete')
}

export default async function proxyRoutes(fastify) {
  const xfetch = (url, ms = 7000) => {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), ms)
    return fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'personal-dashboard/1.0' } })
      .finally(() => clearTimeout(tid))
  }

  // ── Aircraft registration: FAA HTML + adsbdb + ACFTREF seats ─────────────────
  fastify.get('/api/external/aircraft/:n', async (req, reply) => {
    const n = req.params.n.toUpperCase().replace(/[^A-Z0-9]/g, '')
    try {
      const data = await lookupAircraft(n)
      if (!data) return reply.status(404).send({ error: 'Not found in FAA registry' })
      return data
    } catch (e) {
      fastify.log.warn({ n, err: e.message }, 'Aircraft lookup failed')
      return reply.status(502).send({ error: 'Registry temporarily unavailable' })
    }
  })

  // ── Trigger ACFTREF re-sync (admin) ───────────────────────────────────────────
  fastify.post('/api/admin/faa-sync', async (req, reply) => {
    reply.status(202).send({ message: 'FAA ACFTREF sync started' })
    importAcftref(msg => fastify.log.info(msg))
      .then(n => fastify.log.info({ rows: n }, 'FAA ACFTREF manual sync done'))
      .catch(err => fastify.log.warn({ err }, 'FAA ACFTREF manual sync failed'))
  })

  // ── Aircraft POST — create new aircraft record ────────────────────────────────
  fastify.post('/api/aircraft', async (req, reply) => {
    const {
      tail_number, make, model, year = null, engine_type = null, engine_hp = null,
      seats = 4, ifr_equipped = false, glass_cockpit = false, notes = null,
      type_code = null, category = 'Airplane', aircraft_class = 'ASEL',
      gear_type = 'fixed_tricycle', is_complex = false, is_high_performance = false,
      mode_s_hex = null,
    } = req.body
    const { rows } = await pool.query(
      `INSERT INTO aircraft
         (tail_number,make,model,year,engine_type,engine_hp,seats,ifr_equipped,glass_cockpit,
          notes,type_code,category,aircraft_class,gear_type,is_complex,is_high_performance,mode_s_hex)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (tail_number) DO UPDATE SET
         make=EXCLUDED.make, model=EXCLUDED.model, year=COALESCE(EXCLUDED.year, aircraft.year),
         engine_type=COALESCE(EXCLUDED.engine_type, aircraft.engine_type),
         engine_hp=COALESCE(EXCLUDED.engine_hp, aircraft.engine_hp),
         seats=COALESCE(EXCLUDED.seats, aircraft.seats),
         ifr_equipped=EXCLUDED.ifr_equipped, glass_cockpit=EXCLUDED.glass_cockpit,
         type_code=COALESCE(EXCLUDED.type_code, aircraft.type_code),
         category=EXCLUDED.category, aircraft_class=EXCLUDED.aircraft_class,
         gear_type=EXCLUDED.gear_type, is_complex=EXCLUDED.is_complex,
         is_high_performance=EXCLUDED.is_high_performance,
         mode_s_hex=COALESCE(EXCLUDED.mode_s_hex, aircraft.mode_s_hex)
       RETURNING *`,
      [tail_number, make, model, year, engine_type, engine_hp, seats, ifr_equipped,
       glass_cockpit, notes, type_code, category, aircraft_class, gear_type,
       is_complex, is_high_performance, mode_s_hex]
    )
    return reply.status(201).send(rows[0])
  })

  // ── OpenSky Network: detected flights by departure airport + date ─────────────
  // Requires OPENSKY_CLIENT_ID + OPENSKY_CLIENT_SECRET in .env (free account).
  // Without credentials, only the last ~2 hours of data is accessible.
  // Results are cached in opensky_departures_cache for completed days (free of credits on repeat).
  fastify.get('/api/external/flights-detected', async (req, reply) => {
    const { departure, date, icao24 } = req.query
    if (!departure || !date) return reply.status(400).send({ error: 'departure and date required' })

    const dep = departure.toUpperCase()
    // Cover full Pacific day in UTC (UTC-8 worst case, +1h buffer each side)
    const dayStart = new Date(date + 'T07:00:00Z')
    const begin    = Math.floor(dayStart.getTime() / 1000)
    const end      = begin + 115200 // 32-hour window to catch late Pacific flights

    // A day's data is immutable once the window has fully closed (+ 1h settle buffer)
    const windowClosed = end < Math.floor(Date.now() / 1000) - 3600

    // ── Cache read ────────────────────────────────────────────────────────────
    if (windowClosed) {
      const cached = await dbQuery(
        'SELECT flights_json FROM opensky_departures_cache WHERE departure_icao=$1 AND date_str=$2',
        [dep, date]
      )
      if (cached?.length) {
        let flights = cached[0].flights_json
        if (icao24) {
          const hex = icao24.toLowerCase().replace(/[^0-9a-f]/g, '')
          flights = flights.filter(f => f.icao24?.toLowerCase() === hex)
        }
        return { flights, needs_auth: false, source: 'opensky_cache' }
      }
    }

    // ── Live OpenSky call ─────────────────────────────────────────────────────
    let token = null
    try { token = await getOskyToken() } catch (e) { fastify.log.warn({ err: e.message }, 'OpenSky token failed') }
    const headers = { 'User-Agent': 'personal-dashboard/1.0' }
    if (token) headers.Authorization = `Bearer ${token}`

    try {
      const url = `https://opensky-network.org/api/flights/departure?airport=${encodeURIComponent(dep)}&begin=${begin}&end=${end}`
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) })

      if (r.status === 401 || r.status === 403) {
        return reply.status(200).send({
          flights: [],
          needs_auth: true,
          message: 'OpenSky historical data requires credentials. Add OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET to .env.'
        })
      }
      if (r.status === 404) return reply.status(200).send({ flights: [], needs_auth: false })
      if (!r.ok) throw new Error(`OpenSky returned ${r.status}`)

      let raw = await r.json()
      if (!Array.isArray(raw)) raw = []

      // Shape all flights (store unfiltered so cache serves any icao24 filter)
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

      // ── Cache write (only for completed windows) ──────────────────────────
      if (windowClosed) {
        await dbQuery(
          `INSERT INTO opensky_departures_cache (departure_icao, date_str, flights_json)
           VALUES ($1, $2, $3)
           ON CONFLICT (departure_icao, date_str)
           DO UPDATE SET flights_json=$3, fetched_at=NOW()`,
          [dep, date, JSON.stringify(shaped)]
        )
      }

      let flights = shaped
      if (icao24) {
        const hex = icao24.toLowerCase().replace(/[^0-9a-f]/g, '')
        flights = shaped.filter(f => f.icao24?.toLowerCase() === hex)
      }
      return { flights, needs_auth: false, source: 'opensky' }
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'OpenSky flights-detected failed')
      return reply.status(502).send({ error: e.message })
    }
  })

  // ── OpenSky Network: GPS track for a specific flight ─────────────────────────
  // Tracks are immutable for completed flights — always cached after first fetch.
  fastify.get('/api/external/flight-track', async (req, reply) => {
    const { icao24, time } = req.query  // time = Unix timestamp near flight start
    if (!icao24 || !time) return reply.status(400).send({ error: 'icao24 and time required' })

    const hex = icao24.toLowerCase().replace(/[^0-9a-f]/g, '')
    const ts  = parseInt(time)

    // ── Cache read ────────────────────────────────────────────────────────────
    const cached = await dbQuery(
      'SELECT callsign, path_json FROM opensky_tracks_cache WHERE icao24=$1 AND first_seen_unix=$2',
      [hex, ts]
    )
    if (cached?.length) {
      return { track: { icao24: hex, callsign: cached[0].callsign, path: cached[0].path_json }, source: 'opensky_cache' }
    }

    // ── Live OpenSky call ─────────────────────────────────────────────────────
    let token = null
    try { token = await getOskyToken() } catch (_) {}
    const headers = { 'User-Agent': 'personal-dashboard/1.0' }
    if (token) headers.Authorization = `Bearer ${token}`

    try {
      const r = await fetch(
        `https://opensky-network.org/api/tracks/all?icao24=${encodeURIComponent(hex)}&time=${ts}`,
        { headers, signal: AbortSignal.timeout(12000) }
      )
      if (r.status === 401 || r.status === 403) return reply.status(200).send({ track: null, needs_auth: true })
      if (!r.ok) return reply.status(200).send({ track: null })
      const d = await r.json()
      const path = normalizeOpenSkyPath(d.path)
      const callsign = d.callsign?.trim() || null

      // ── Cache write ───────────────────────────────────────────────────────
      if (path.length) {
        await dbQuery(
          `INSERT INTO opensky_tracks_cache (icao24, first_seen_unix, callsign, path_json)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (icao24, first_seen_unix) DO NOTHING`,
          [hex, ts, callsign, JSON.stringify(path)]
        )
      }

      return { track: { icao24: d.icao24, callsign, path }, source: 'opensky' }
    } catch (e) {
      return reply.status(200).send({ track: null })
    }
  })

  // ── Airport detail: runways + frequencies from OurAirports ───────────────────
  // OurAirports publishes ACUK-licensed CSVs on GitHub. Data is static and cached in DB.
  fastify.get('/api/external/airport-detail/:icao', async (req, reply) => {
    const icao = req.params.icao.toUpperCase()

    // Cache hit — airport runway/frequency data is effectively static
    const cached = await dbQuery(
      'SELECT detail_json FROM airport_detail_cache WHERE icao=$1',
      [icao]
    )
    if (cached?.length) return cached[0].detail_json

    const OA = 'https://davidmegginson.github.io/ourairports-data'
    const [rwyRes, frqRes] = await Promise.allSettled([
      xfetch(`${OA}/runways.csv`, 25000).then(r => r.ok ? r.text() : ''),
      xfetch(`${OA}/airport-frequencies.csv`, 25000).then(r => r.ok ? r.text() : ''),
    ])

    const runways = []
    if (rwyRes.status === 'fulfilled' && rwyRes.value) {
      for (const row of filterAirportCsv(rwyRes.value, icao)) {
        if (row.closed === '1') continue
        const leId  = row.le_ident  || ''
        const heId  = row.he_ident  || ''
        const leNum = parseInt(leId.replace(/[LRC]/i, ''), 10)
        const heNum = parseInt(heId.replace(/[LRC]/i, ''), 10)
        if (!leNum || !heNum) continue
        runways.push({
          id:        `${leId}-${heId}`,
          length_ft: parseInt(row.length_ft) || null,
          width_ft:  parseInt(row.width_ft)  || null,
          surface:   row.surface || null,
          lighted:   row.lighted === '1',
          le_ident:  leId,
          le_hdg:    leNum * 10,   // magnetic heading from runway number
          he_ident:  heId,
          he_hdg:    heNum * 10,
        })
      }
    }

    const frequencies = []
    if (frqRes.status === 'fulfilled' && frqRes.value) {
      for (const row of filterAirportCsv(frqRes.value, icao)) {
        if (!row.frequency_mhz) continue
        frequencies.push({
          type:        row.type        || '',
          description: row.description || '',
          freq_mhz:    row.frequency_mhz,
        })
      }
    }

    const result = { icao, runways, frequencies }
    await dbQuery(
      `INSERT INTO airport_detail_cache (icao, detail_json)
       VALUES ($1, $2)
       ON CONFLICT (icao) DO UPDATE SET detail_json=$2, fetched_at=NOW()`,
      [icao, JSON.stringify(result)]
    )
    return result
  })

  // ── Airport info from Aviation Weather Center ─────────────────────────────────
  fastify.get('/api/external/airport/:icao', async (req, reply) => {
    const icao = req.params.icao.toUpperCase()
    try {
      const r = await xfetch(`https://aviationweather.gov/api/data/airport?ids=${icao}`)
      if (!r.ok) return reply.status(404).send({ error: 'Airport not found' })
      const d = await r.json()
      const apt = Array.isArray(d) ? d[0] : d
      if (!apt) return reply.status(404).send({ error: 'Airport not found' })
      return apt
    } catch (e) {
      fastify.log.warn({ icao, err: e.message }, 'Airport lookup failed')
      return reply.status(502).send({ error: 'Airport lookup unavailable' })
    }
  })

  // ── METAR — AWC for ≤48 h, Iowa State Mesonet for older ──────────────────────
  fastify.get('/api/external/metar/:icao', async (req, reply) => {
    const icao = req.params.icao.toUpperCase()
    const { time } = req.query // ISO-8601 UTC, e.g. "2026-05-10T14:30:00Z"
    try {
      if (time) {
        const ft = new Date(time)
        const ageH = (Date.now() - ft) / 3600000
        if (ageH <= 48) {
          const hours = Math.min(Math.ceil(ageH) + 3, 48)
          const r = await xfetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=${hours}`)
          const obs = (r.ok && r.status !== 204) ? await r.json() : []
          const list = Array.isArray(obs) ? obs : []
          const best = list.sort((a, b) =>
            Math.abs(new Date(a.obsTime) - ft) - Math.abs(new Date(b.obsTime) - ft)
          )[0] || null
          return { source: 'awc', metar: best, icao }
        }
        // Historical via Iowa State Mesonet (archives ASOS METARs)
        const station = icao.startsWith('K') && icao.length === 4 ? icao.slice(1) : icao
        const d1 = new Date(ft.getTime() - 3600000)
        const d2 = new Date(ft.getTime() + 3600000)
        const seg = d => `year1=${d.getUTCFullYear()}&month1=${d.getUTCMonth() + 1}&day1=${d.getUTCDate()}&hour1=${d.getUTCHours()}&min1=0`
        const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${station}&data=metar&${seg(d1)}&year2=${d2.getUTCFullYear()}&month2=${d2.getUTCMonth() + 1}&day2=${d2.getUTCDate()}&hour2=${d2.getUTCHours()}&min2=59&tz=UTC&format=json&latlon=no&elev=no&missing=empty&trace=T&direct=no&report_type=3`
        const r = await xfetch(url, 10000)
        if (!r.ok) throw new Error('Mesonet unavailable')
        const d = await r.json()
        const obs2 = (d?.data || []).filter(x => x.metar)
        const best2 = obs2.length ? obs2[obs2.length - 1] : null
        return { source: 'mesonet', metar: best2 ? { rawOb: best2.metar, obsTime: best2.valid } : null, icao }
      }
      // Current METAR — 4h window so we catch airports that close at night (tagged LAST)
      const r = await xfetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=4`)
      const obs = (r.ok && r.status !== 204) ? await r.json() : []
      return { source: 'awc', metar: (Array.isArray(obs) ? obs[0] : null) || null, icao }
    } catch (e) {
      fastify.log.warn({ icao, time, err: e.message }, 'METAR lookup failed')
      return reply.status(502).send({ error: e.message || 'METAR unavailable' })
    }
  })

  // ── NOTAMs via AIM NOTAM Search (Playwright + stealth to bypass Akamai)
  // Falls back to FAA API if FAA_NOTAM_CLIENT_ID / FAA_NOTAM_CLIENT_SECRET are set.
  fastify.get('/api/external/notam/:icao', async (req, reply) => {
    const icao = req.params.icao.toUpperCase()
    // NOTAM validity windows can be corrected/superseded; this route already
    // has its own 1h server-side cache, so tell browsers not to layer a
    // second (unmanaged, indefinitely stale) cache on top of it.
    reply.header('Cache-Control', 'no-store')

    // Fast path: FAA NOTAM API when credentials are available
    const clientId     = process.env.FAA_NOTAM_CLIENT_ID
    const clientSecret = process.env.FAA_NOTAM_CLIENT_SECRET
    if (clientId && clientSecret) {
      try {
        const ctrl = new AbortController()
        const tid  = setTimeout(() => ctrl.abort(), 12000)
        const r = await fetch(
          `https://external-api.faa.gov/notamapi/v2/notams?icaoLocation=${icao}&pageSize=50`,
          { signal: ctrl.signal, headers: { client_id: clientId, client_secret: clientSecret, 'User-Agent': 'personal-dashboard/1.0' } }
        ).finally(() => clearTimeout(tid))
        if (r.ok) {
          const data = await r.json()
          const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : [])
          return {
            notams: items.slice(0, 50).map(n => {
              const core = n.properties?.coreNOTAMData?.notam || n
              return { id: core.id || n.notamID, type: core.classification || n.type, text: core.text || n.traditionalMessage || '', startDate: core.effectiveStart, endDate: core.effectiveEnd }
            }),
            count: data?.totalCount ?? items.length,
            icao,
          }
        }
      } catch (_) {}
    }

    // Primary path: headless Chromium → AIM NOTAM Search (bypasses Akamai bot check)
    const notams = await fetchNotams(icao, fastify.log)
    if (notams === null) {
      return reply.status(200).send({ notams: [], count: 0, icao, unavailable: true })
    }
    return { notams, count: notams.length, icao }
  })

  // ── Aircraft photo via Planespotters.net ─────────────────────────────────────
  fastify.get('/api/external/aircraft-photo/:reg', async (req, reply) => {
    const reg = req.params.reg.toUpperCase().replace(/[^A-Z0-9]/g, '')
    try {
      const r = await xfetch(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`, 8000)
      if (!r.ok) return reply.status(404).send({ error: 'No photo found' })
      const d = await r.json()
      const photo = Array.isArray(d.photos) ? d.photos[0] : null
      if (!photo) return reply.status(404).send({ error: 'No photo found' })
      return {
        reg,
        thumbnail: photo.thumbnail?.src || null,
        thumbnail_large: photo.thumbnail_large?.src || null,
        link: photo.link || null,
        photographer: photo.photographer || null,
      }
    } catch (e) {
      return reply.status(502).send({ error: e.message })
    }
  })

  // ── Attach OpenSky GPS track to a flight record ───────────────────────────────
  fastify.post('/api/external/attach-track', async (req, reply) => {
    const { flight_id, icao24, first_seen_unix } = req.body || {}
    if (!flight_id || !icao24 || !first_seen_unix) {
      return reply.status(400).send({ error: 'flight_id, icao24, first_seen_unix required' })
    }
    const hex = String(icao24).toLowerCase().replace(/[^0-9a-f]/g, '')
    const ts  = parseInt(first_seen_unix)

    // Check cache first
    const cached = await dbQuery(
      'SELECT path_json FROM opensky_tracks_cache WHERE icao24=$1 AND first_seen_unix=$2',
      [hex, ts]
    )
    let path
    if (cached?.length) {
      path = cached[0].path_json
    } else {
      let token = null
      try { token = await getOskyToken() } catch (_) {}
      const headers = { 'User-Agent': 'personal-dashboard/1.0' }
      if (token) headers.Authorization = `Bearer ${token}`
      const r = await fetch(
        `https://opensky-network.org/api/tracks/all?icao24=${encodeURIComponent(hex)}&time=${ts}`,
        { headers, signal: AbortSignal.timeout(12000) }
      )
      if (r.status === 401 || r.status === 403) {
        return reply.status(200).send({ error: 'OpenSky historical tracks require credentials. Add OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET to .env.' })
      }
      if (!r.ok) return reply.status(200).send({ error: `OpenSky returned ${r.status}` })
      const d = await r.json()
      path = normalizeOpenSkyPath(d.path)
      if (path.length) {
        await dbQuery(
          `INSERT INTO opensky_tracks_cache (icao24, first_seen_unix, callsign, path_json)
           VALUES ($1, $2, $3, $4) ON CONFLICT (icao24, first_seen_unix) DO NOTHING`,
          [hex, ts, d.callsign?.trim() || null, JSON.stringify(path)]
        )
      }
    }

    if (!path?.length) {
      return reply.status(200).send({ error: 'No GPS track points available for this flight. OpenSky may not have retained this track.' })
    }

    const saved = await saveTrackPoints(pool, flight_id, path)
    return { success: true, points_saved: saved, total_points: path.length }
  })

  // ── OpenSky: auto-fetch track by flight_id (uses mode_s_hex + time_out from DB) ─
  // POST /api/external/auto-fetch-track/:flight_id
  // Used by the UI "Find Route" auto-loader and on new flight creation.
  fastify.post('/api/external/auto-fetch-track/:flight_id', async (req, reply) => {
    const flightId = parseInt(req.params.flight_id)
    const result = await autoFetchOpenSkyTrack(pool, flightId)
    if (result.error && !result.points_saved) {
      return reply.status(result.error === 'Flight not found' ? 404 : 200).send(result)
    }
    return result
  })

  // ── FlightAware: auto-fetch track for a single flight ────────────────────────
  // POST /api/external/auto-fetch-fa-track/:flight_id
  fastify.post('/api/external/auto-fetch-fa-track/:flight_id', async (req, reply) => {
    const flightId = parseInt(req.params.flight_id)
    if (!process.env.FLIGHTAWARE_API_KEY) {
      return reply.status(503).send({ error: 'FLIGHTAWARE_API_KEY not configured' })
    }

    const { rows } = await pool.query(`
      SELECT f.id, f.date::text, f.departure_icao, f.arrival_icao,
             f.time_out, f.time_in, f.total_duration,
             ac.tail_number
      FROM flights f
      JOIN aircraft ac ON ac.id = f.aircraft_id
      WHERE f.id = $1
    `, [flightId])
    if (!rows.length) return reply.status(404).send({ error: 'Flight not found' })
    const fl      = rows[0]
    const tail    = fl.tail_number
    const dateStr = String(fl.date).slice(0, 10)

    let timeOut = fl.time_out
    let timeIn  = fl.time_in
    if (!timeOut || !timeIn) {
      try {
        const tailShort = tail.replace(/^N/, '')
        const { rows: dbScheds } = await pool.query(`
          SELECT start_unix, end_unix FROM nice_air_schedules
          WHERE date_str = $1 AND type != 'cancelled'
            AND (tail = $2 OR tail = $3)
          ORDER BY start_unix ASC LIMIT 1
        `, [dateStr, tail, tailShort])
        if (dbScheds.length) {
          if (dbScheds[0].start_unix) timeOut = timeOut || new Date(dbScheds[0].start_unix * 1000).toISOString()
          if (dbScheds[0].end_unix)   timeIn  = timeIn  || new Date(dbScheds[0].end_unix   * 1000).toISOString()
        }
      } catch (_) {}
    }
    if (!timeOut) {
      try {
        const { rows: dateScheds } = await pool.query(`
          SELECT start_unix, end_unix FROM nice_air_schedules
          WHERE date_str = $1 AND type != 'cancelled' AND start_unix IS NOT NULL
          ORDER BY start_unix ASC
        `, [dateStr])
        const chosen = dateScheds[0]
        if (chosen?.start_unix) timeOut = new Date(chosen.start_unix * 1000).toISOString()
        if (chosen?.end_unix)   timeIn  = new Date(chosen.end_unix * 1000).toISOString()
      } catch (_) {}
    }
    if (!timeOut) {
      return reply.status(400).send({ error: 'No time window found in DB or schedules' })
    }

    const winStart = new Date(new Date(timeOut).getTime() - 2 * 3_600_000)
    const winEnd   = timeIn
      ? new Date(new Date(timeIn).getTime() + 2 * 3_600_000)
      : new Date(new Date(timeOut).getTime() + 6 * 3_600_000)

    try {
      const flightsData = await faFetch(`/history/flights/${encodeURIComponent(tail)}`, {
        start: winStart.toISOString(),
        end:   winEnd.toISOString(),
        max_pages: 1,
      })
      const candidates = Array.isArray(flightsData?.flights) ? flightsData.flights : []
      if (!candidates.length) {
        return { success: false, points_saved: 0, message: 'No FlightAware flights found in window' }
      }

      const norm   = ic => (ic || '').toUpperCase().replace(/^K/, '')
      const logDep = norm(fl.departure_icao)
      const logArr = norm(fl.arrival_icao)
      const logMin = fl.total_duration ? parseFloat(fl.total_duration) * 60 : null
      const scored = candidates.map(ff => {
        let score = 0
        if (logDep && norm(ff.origin?.code || '') === logDep)     score += 4
        if (logArr && norm(ff.destination?.code || '') === logArr) score += 4
        if (logMin && ff.actual_off && ff.actual_on) {
          const durMin = (new Date(ff.actual_on) - new Date(ff.actual_off)) / 60000
          const ratio  = Math.min(logMin, durMin) / Math.max(logMin, durMin)
          score += ratio > 0.8 ? 5 : ratio > 0.55 ? 3 : ratio > 0.35 ? 1 : 0
        }
        return { ff, score }
      }).sort((a, b) => b.score - a.score)

      // Fetch and merge all candidates — multi-leg flights split into separate FA records
      const allPositions = []
      const okFaIds = []
      for (const { ff } of scored) {
        if (!ff.fa_flight_id) continue
        await new Promise(r => setTimeout(r, 300))
        try {
          const td  = await faFetch(`/history/flights/${encodeURIComponent(ff.fa_flight_id)}/track`)
          const pts = normalizeFaPositions(td?.positions)
          if (pts.length) { allPositions.push(...pts); okFaIds.push(ff.fa_flight_id) }
        } catch (_) {}
      }
      const seen = new Map()
      for (const p of allPositions) { if (p.ts && !seen.has(p.ts)) seen.set(p.ts, p) }
      const merged  = [...seen.values()].sort((a, b) => new Date(a.ts) - new Date(b.ts))
      const bounded = boundFaTrack(merged, timeOut, timeIn)

      if (!bounded.length) {
        return { success: false, points_saved: 0, message: 'No track positions from FlightAware' }
      }

      const saved = await saveTrackPoints(pool, flightId, bounded)
      fastify.log.info({ flightId, tail, saved, fa_flight_ids: okFaIds }, 'FlightAware track saved')
      return { success: true, points_saved: saved, fa_flight_ids: okFaIds, score: scored[0].score }
    } catch (e) {
      fastify.log.warn({ flightId, tail, err: e.message }, 'FlightAware track fetch failed')
      return reply.status(502).send({ error: e.message })
    }
  })

  // ── FlightAware: backfill job state ──────────────────────────────────────────
  let _faJob = null // { started, done, counts, log[] }

  fastify.get('/api/external/fa-backfill-status', async (req, reply) => {
    if (!_faJob) return { running: false, started: false }
    return {
      running:    !_faJob.done,
      done:       _faJob.done,
      started_at: _faJob.started,
      counts:     _faJob.counts,
      recent:     _faJob.log.slice(-10),
    }
  })

  // ── FlightAware: batch backfill all flights without tracks ───────────────────
  // POST /api/external/fa-backfill?overwrite=false[&limit=N][&async=true]
  fastify.post('/api/external/fa-backfill', async (req, reply) => {
    const overwrite = req.query.overwrite === 'true'
    const limitN    = req.query.limit ? parseInt(req.query.limit) : null
    const asyncMode = req.query.async === 'true'

    const { rows: flights } = await pool.query(`
      SELECT f.id, f.date::text, f.departure_icao, f.arrival_icao,
             f.time_out, f.time_in, f.total_duration,
             ac.tail_number,
             EXISTS(SELECT 1 FROM track_log_points tlp WHERE tlp.flight_id = f.id) AS has_track
      FROM flights f
      JOIN aircraft ac ON ac.id = f.aircraft_id
      ORDER BY f.date ASC
    `)

    let toProcess = overwrite ? flights : flights.filter(f => !f.has_track)
    if (limitN) toProcess = toProcess.slice(0, limitN)

    if (asyncMode) {
      if (_faJob && !_faJob.done) return { started: false, error: 'backfill already running' }
      _faJob = { started: new Date().toISOString(), done: false, counts: { ok: 0, no_window: 0, no_positions: 0, errors: 0 }, log: [] }
      setImmediate(() => runFaBackfill(toProcess, _faJob, fastify.log).catch(() => { if (_faJob) _faJob.done = true }))
      return { started: true, total: toProcess.length }
    }

    // Streaming NDJSON mode
    const streamJob = { done: false, counts: { ok: 0, no_window: 0, no_positions: 0, errors: 0 }, log: [] }
    reply.raw.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'X-Accel-Buffering': 'no' })
    let logIdx = 0
    const flushInterval = setInterval(() => {
      while (logIdx < streamJob.log.length) reply.raw.write(JSON.stringify(streamJob.log[logIdx++]) + '\n')
    }, 500)
    await runFaBackfill(toProcess, streamJob, fastify.log)
    clearInterval(flushInterval)
    while (logIdx < streamJob.log.length) reply.raw.write(JSON.stringify(streamJob.log[logIdx++]) + '\n')
    const summary = { type: 'summary', total: flights.length, processed: toProcess.length, ...streamJob.counts }
    fastify.log.info(summary, 'FlightAware backfill complete')
    reply.raw.write(JSON.stringify(summary) + '\n')
    reply.raw.end()
  })


  // ── NICE AIR schedule emails from Gmail ──────────────────────────────────────
  // Reads all "NICE AIR" schedule emails and returns parsed reservations.
  // Cached in memory for 10 min to avoid hammering IMAP on repeated calls.
  let _niceAirCache = null // { ts, data }
  fastify.get('/api/gmail/nice-air', async (req, reply) => {
    try {
      if (_niceAirCache && Date.now() - _niceAirCache.ts < 600_000) {
        return { schedules: _niceAirCache.data, source: 'cache' }
      }
      const schedules = await fetchNiceAirSchedules()
      _niceAirCache = { ts: Date.now(), data: schedules }
      return { schedules, source: 'gmail' }
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'NICE AIR Gmail fetch failed')
      return reply.status(502).send({ error: e.message })
    }
  })

  // ── Bust the NICE AIR email cache ─────────────────────────────────────────────
  fastify.post('/api/gmail/nice-air/refresh', async (req, reply) => {
    _niceAirCache = null
    return { ok: true }
  })

  // ── Sync NICE AIR Gmail schedules → DB ────────────────────────────────────────
  // POST /api/gmail/nice-air/sync
  // Reads all "NICE AIR" emails from Gmail IMAP, upserts each into nice_air_schedules.
  // Idempotent — safe to call repeatedly. Invalidates in-memory cache.
  fastify.post('/api/gmail/nice-air/sync', async (req, reply) => {
    try {
      const result = await syncNiceAirToDB(pool)
      _niceAirCache = null // bust memory cache so next GET re-reads from DB
      fastify.log.info(result, 'NICE AIR Gmail sync complete')
      return { ok: true, ...result }
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'NICE AIR Gmail sync failed')
      return reply.status(502).send({ error: e.message })
    }
  })

  // ── TAF via Aviation Weather Center ───────────────────────────────────────────
  fastify.get('/api/external/taf/:icao', async (req, reply) => {
    const icao = req.params.icao.toUpperCase()
    try {
      const r = await xfetch(`https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`, 10000)
      if (!r.ok) return { taf: null, icao }
      const data = await r.json()
      const raw = Array.isArray(data) ? data[0] : null
      if (!raw) return { taf: null, icao }
      return {
        taf: {
          raw:       raw.rawTAF || raw.raw || '',
          issueTime: raw.issueTime || raw.bulletinTime || null,
          fcsts:     (raw.fcsts || []).map(f => ({
            type:    f.changeType || f.type || 'FM',
            from:    f.timeFrom   || f.fcstTimeFrom,
            to:      f.timeTo     || f.fcstTimeTo,
            wdir:    f.wdir,
            wspd:    f.wspd,
            wgst:    f.wgst,
            visib:   f.visib,
            fltcat:  f.fltcat || '',
            wx:      Array.isArray(f.wx) ? f.wx.join(' ') : (f.wx || ''),
            clouds:  (f.clouds || []).map(c => `${c.cover}${c.base!=null ? c.base : ''}`).join(' '),
          })),
        },
        icao,
      }
    } catch (e) {
      fastify.log.warn({ icao, err: e.message }, 'TAF lookup failed')
      return { taf: null, icao }
    }
  })

  // ── FAA Class Airspace B/C/D (AIRAC 28-day cycle, pre-downloaded by scheduler) ──
  // Data from: https://adds-faa.opendata.arcgis.com/datasets/c6a62360338e408cb1512366ad61559e_0
  // The faaAirspace service downloads + caches on first boot and every 28 days.
  fastify.get('/api/external/faa-airspace', async (req, reply) => {
    try {
      const { getFaaAirspace } = await import('../services/faaAirspace.js')
      const fc = await getFaaAirspace(fastify.log)
      // Send with long cache header — client can cache for 1 day; data refreshes server-side
      reply.header('Cache-Control', 'public, max-age=86400')
      return fc
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'FAA airspace serve error')
      return reply.code(503).send({ error: 'Airspace data unavailable', detail: e.message })
    }
  })

  // ── US public-use airports (nationwide, 28-day cycle, pre-downloaded) ──────
  fastify.get('/api/external/us-airports', async (req, reply) => {
    try {
      const { getUsAirports } = await import('../services/usAirports.js')
      const fc = await getUsAirports(fastify.log)
      reply.header('Cache-Control', 'public, max-age=86400')
      return fc
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'US airports serve error')
      return reply.code(503).send({ error: 'Airport data unavailable', detail: e.message })
    }
  })
}

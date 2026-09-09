// External API proxy — avoids CORS issues and centralises external calls
import { lookupAircraft, importAcftref, isAcftrefEmpty } from '../services/faa-registry.js'
import { pool } from '../db/client.js'
import { fetchNotams } from '../services/notam-fetcher.js'
import { fetchNiceAirSchedules } from '../services/gmail.js'
import { getOskyToken, normalizeFr24Positions, normalizeOpenSkyPath, saveTrackPoints, autoFetchOpenSkyTrack } from '../services/flightTrack.js'

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

// ── FlightRadar24 API v1 ──────────────────────────────────────────────────────
// Env var: FR24_API_TOKEN  (Bearer token from fr24api.flightradar24.com)
// Essential plan: historical flights up to 2 years.
// Docs: https://fr24api.flightradar24.com/docs
const FR24_BASE = 'https://fr24api.flightradar24.com'
const _fr24Cache = new Map() // key `tail/YYYY-MM-DD` → { ts, flights[] }

async function fr24Fetch(path, params = {}, _retries = 2) {
  const token = process.env.FR24_API_TOKEN
  if (!token) throw new Error('FR24_API_TOKEN not configured')
  const url = new URL(FR24_BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Accept-Version': 'v1',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  })
  if (r.status === 429 && _retries > 0) {
    const retryAfter = parseInt(r.headers.get('Retry-After') || '65', 10)
    const waitMs = Math.max(retryAfter * 1000, 65_000)
    console.log(`FR24 rate limited — waiting ${waitMs / 1000}s`)
    await new Promise(res => setTimeout(res, waitMs))
    return fr24Fetch(path, params, _retries - 1)
  }
  if (!r.ok) {
    const body = await r.text().catch(() => r.statusText)
    throw new Error(`FlightRadar24 ${r.status}: ${body}`)
  }
  return r.json()
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
         make=EXCLUDED.make, model=EXCLUDED.model,
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

  // ── FlightRadar24: raw diagnostic call (pass any params, see raw response) ───
  // GET /api/external/fr24-raw?path=/api/flight-summary/full&reg=N12345&...
  fastify.get('/api/external/fr24-raw', async (req, reply) => {
    const { path: apiPath = '/api/flight-summary/full', ...params } = req.query
    try {
      const data = await fr24Fetch(apiPath, params)
      return { ok: true, data }
    } catch (e) {
      return reply.status(200).send({ ok: false, error: e.message })
    }
  })

  // ── FlightRadar24: flights by tail + date ────────────────────────────────────
  // GET /api/external/fr24-flights/:tail?date=YYYY-MM-DD
  // Returns FR24 flights list for a Pacific-day window. Cached 1h in memory.
  fastify.get('/api/external/fr24-flights/:tail', async (req, reply) => {
    const tail = req.params.tail.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const date = req.query.date // YYYY-MM-DD
    if (!date) return reply.status(400).send({ error: 'date required (YYYY-MM-DD)' })

    const cacheKey = `${tail}/${date}`
    const hit = _fr24Cache.get(cacheKey)
    if (hit && Date.now() - hit.ts < 3_600_000) return { flights: hit.flights, source: 'cache' }

    // Pacific-day UTC window: PST is UTC-8, PDT is UTC-7.
    // Use UTC-8 worst case: day starts at 08:00 UTC, add 26h buffer for full coverage.
    const dayStart = new Date(date + 'T08:00:00Z')
    const dayEnd   = new Date(dayStart.getTime() + 26 * 3_600_000)

    try {
      const data = await fr24Fetch('/api/flight-summary/full', {
        registrations:        tail,
        flight_datetime_from: dayStart.toISOString(),
        flight_datetime_to:   dayEnd.toISOString(),
        limit:                20,
      })
      const raw  = Array.isArray(data?.data) ? data.data : []
      const flights = raw.map(f => ({
        fr24_id:        f.fr24_id || f.id || f.flight_id,
        ident:          f.callsign || f.flight || tail,
        departure_icao: f.orig_icao || f.origin_icao || null,
        arrival_icao:   f.dest_icao || f.destination_icao || null,
        departure_time: f.actual_departure  || f.scheduled_departure || null,
        arrival_time:   f.actual_arrival    || f.scheduled_arrival   || null,
        first_seen_unix: f.actual_departure
          ? Math.floor(new Date(f.actual_departure).getTime() / 1000) : null,
        duration_min: (f.actual_departure && f.actual_arrival)
          ? Math.round((new Date(f.actual_arrival) - new Date(f.actual_departure)) / 60000)
          : null,
      }))
      _fr24Cache.set(cacheKey, { ts: Date.now(), flights })
      return { flights, source: 'fr24' }
    } catch (e) {
      fastify.log.warn({ tail, date, err: e.message }, 'FR24 flights lookup failed')
      return reply.status(502).send({ error: e.message })
    }
  })

  // ── FlightRadar24: attach GPS track to a flight record ────────────────────────
  // POST /api/external/attach-fr24-track  body: { flight_id, fr24_id }
  fastify.post('/api/external/attach-fr24-track', async (req, reply) => {
    const { flight_id, fr24_id } = req.body || {}
    if (!flight_id || !fr24_id) {
      return reply.status(400).send({ error: 'flight_id and fr24_id required' })
    }

    try {
      const data = await fr24Fetch('/api/historic/flight-positions/full', {
        fr24_id,
      })
      // FR24 returns positions under data.positions or data.data.positions
      const posData = data?.data?.positions ?? data?.positions ?? data?.data ?? []
      const positions = Array.isArray(posData) ? posData : []
      if (!positions.length) {
        return { success: false, points_saved: 0, total_points: 0, message: 'No track positions from FR24' }
      }

      const normalized = normalizeFr24Positions(positions)
      const saved = await saveTrackPoints(pool, flight_id, normalized)
      fastify.log.info({ flight_id, fr24_id, saved }, 'FR24 track attached')
      return { success: true, points_saved: saved, total_points: positions.length }
    } catch (e) {
      fastify.log.warn({ flight_id, fr24_id, err: e.message }, 'FR24 track attach failed')
      return reply.status(502).send({ error: e.message })
    }
  })

  // ── FlightRadar24: batch backfill all flights without tracks ──────────────────
  // POST /api/external/fr24-backfill?overwrite=false
  // Iterates all DB flights, looks up FR24 by registration+date, saves tracks.
  // Runs sequentially with a short delay to respect rate limits.
  fastify.post('/api/external/fr24-backfill', async (req, reply) => {
    const overwrite = req.query.overwrite === 'true'

    // Load all flights (join aircraft for tail number)
    const { rows: flights } = await pool.query(`
      SELECT f.id, f.date::text, f.departure_icao, f.arrival_icao,
             f.time_out, f.time_in, f.total_duration,
             ac.tail_number,
             EXISTS(SELECT 1 FROM track_log_points tlp WHERE tlp.flight_id = f.id) AS has_track
      FROM flights f
      JOIN aircraft ac ON ac.id = f.aircraft_id
      ORDER BY f.date ASC
    `)

    const toProcess = overwrite ? flights : flights.filter(f => !f.has_track)
    const results = []
    // 2 s between each API call keeps us well under FR24 Essential rate limits.
    // fr24Fetch auto-retries on 429 with Retry-After header back-off.
    const sleep = ms => new Promise(res => setTimeout(res, ms))
    const CALL_DELAY = 2000

    for (const f of toProcess) {
      const tail    = f.tail_number
      const dateStr = String(f.date).slice(0, 10)

      // 1. Look up FR24 flights for this registration + date
      let fr24Flights = []
      try {
        const dayStart = new Date(dateStr + 'T08:00:00Z')
        const dayEnd   = new Date(dayStart.getTime() + 26 * 3_600_000)
        const data = await fr24Fetch('/api/flight-summary/full', {
          registrations:        tail,
          flight_datetime_from: dayStart.toISOString(),
          flight_datetime_to:   dayEnd.toISOString(),
          limit:                10,
        })
        fr24Flights = Array.isArray(data?.data) ? data.data : []
      } catch (e) {
        fastify.log.warn({ flight_id: f.id, tail, date: dateStr, err: e.message }, 'FR24 backfill lookup failed')
        results.push({ id: f.id, date: dateStr, tail, status: 'error', reason: e.message })
        await sleep(CALL_DELAY)
        continue
      }

      await sleep(CALL_DELAY)  // pace after summary call

      if (!fr24Flights.length) {
        results.push({ id: f.id, date: dateStr, tail, status: 'no_match' })
        continue
      }

      // 2. Pick best match: prefer flights where departure/arrival ICAO align with logbook
      const logDep = f.departure_icao?.slice(1) // strip K prefix for IATA comparison
      const logArr = f.arrival_icao?.slice(1)
      const scored = fr24Flights.map(ff => {
        let score = 0
        const dep = ff.orig_icao || ff.origin_icao || ''
        const arr = ff.dest_icao || ff.destination_icao || ''
        if (dep === f.departure_icao || dep === logDep) score += 2
        if (arr === f.arrival_icao   || arr === logArr)  score += 2
        if (f.time_out && ff.actual_departure) {
          const diffMin = Math.abs(
            new Date(f.time_out).getTime() - new Date(ff.actual_departure).getTime()
          ) / 60000
          if (diffMin < 30) score += 3
          else if (diffMin < 60) score += 1
        }
        return { ff, score }
      })
      scored.sort((a, b) => b.score - a.score)
      const best = scored[0].ff

      const fr24Id = best.fr24_id || best.id || best.flight_id
      if (!fr24Id) {
        results.push({ id: f.id, date: dateStr, tail, status: 'no_fr24_id' })
        continue
      }

      // 3. Fetch track positions
      try {
        const trackData = await fr24Fetch('/api/historic/flight-positions/full', { fr24_id: fr24Id })
        const posData   = trackData?.data?.positions ?? trackData?.positions ?? trackData?.data ?? []
        const positions = Array.isArray(posData) ? posData : []
        const normalized = normalizeFr24Positions(positions)
        const saved = await saveTrackPoints(pool, f.id, normalized)

        results.push(saved
          ? { id: f.id, date: dateStr, tail, fr24_id: fr24Id, status: 'ok', points: saved }
          : { id: f.id, date: dateStr, tail, fr24_id: fr24Id, status: 'no_positions' }
        )
      } catch (e) {
        fastify.log.warn({ flight_id: f.id, fr24Id, err: e.message }, 'FR24 track fetch failed')
        results.push({ id: f.id, date: dateStr, tail, fr24_id: fr24Id, status: 'track_error', reason: e.message })
      }

      await sleep(CALL_DELAY)  // pace after track call
    }

    const summary = {
      total: flights.length,
      processed: toProcess.length,
      ok:        results.filter(r => r.status === 'ok').length,
      no_match:  results.filter(r => r.status === 'no_match').length,
      errors:    results.filter(r => ['error', 'track_error'].includes(r.status)).length,
    }
    fastify.log.info(summary, 'FR24 backfill complete')
    return { summary, results }
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
}

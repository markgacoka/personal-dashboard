// External API proxy — avoids CORS issues and centralises external calls
import { lookupAircraft, importAcftref, isAcftrefEmpty } from '../services/faa-registry.js'
import { pool } from '../db/client.js'

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

// ── OpenSky OAuth token cache ─────────────────────────────────────────────────
// OpenSky v2 uses client_credentials (clientId + clientSecret → bearer token).
// Env vars: OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET
const OSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
let _oskyToken = null  // { value, expiresAt }

async function getOskyToken() {
  const id  = process.env.OPENSKY_CLIENT_ID
  const sec = process.env.OPENSKY_CLIENT_SECRET
  if (!id || !sec) return null
  if (_oskyToken && _oskyToken.expiresAt > Date.now() + 30_000) return _oskyToken.value
  const r = await fetch(OSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: sec }),
    signal: AbortSignal.timeout(10000),
  })
  if (!r.ok) throw new Error(`OpenSky token fetch failed: ${r.status}`)
  const d = await r.json()
  _oskyToken = { value: d.access_token, expiresAt: Date.now() + (d.expires_in ?? 3600) * 1000 }
  return _oskyToken.value
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
      // path: [[time, lat, lon, baro_alt_m, true_track, on_ground], ...]
      const path = (d.path || []).map(([t, lat, lon, alt, trk, grnd]) => ({
        ts:        new Date(t * 1000).toISOString(),
        lat,
        lon,
        alt_ft:    alt != null ? Math.round(alt * 3.28084) : null,
        track:     trk,
        on_ground: grnd,
      }))
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
          const obs = r.ok ? await r.json() : []
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
      // Current METAR
      const r = await xfetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=2`)
      const obs = r.ok ? await r.json() : []
      return { source: 'awc', metar: (Array.isArray(obs) ? obs[0] : null) || null, icao }
    } catch (e) {
      fastify.log.warn({ icao, time, err: e.message }, 'METAR lookup failed')
      return reply.status(502).send({ error: e.message || 'METAR unavailable' })
    }
  })

  // ── NOTAMs via Aviation Weather Center ────────────────────────────────────────
  fastify.get('/api/external/notam/:icao', async (req, reply) => {
    const icao = req.params.icao.toUpperCase()
    try {
      const r = await xfetch(`https://aviationweather.gov/api/data/notam?ids=${icao}&format=json`, 10000)
      if (!r.ok) return reply.status(200).send({ notams: [], count: 0, icao })
      const data = await r.json()
      const notams = Array.isArray(data) ? data : []
      // Return first 10 with key fields only
      return {
        notams: notams.slice(0, 10).map(n => ({
          id:       n.notamID || n.id,
          type:     n.type,
          text:     n.traditionalMessage || n.icaoMessage || n.text || '',
          startDate: n.effectiveStart || n.startDate,
          endDate:   n.effectiveEnd   || n.endDate,
        })),
        count: notams.length,
        icao,
      }
    } catch (e) {
      fastify.log.warn({ icao, err: e.message }, 'NOTAM lookup failed')
      return reply.status(200).send({ notams: [], count: 0, icao })
    }
  })
}

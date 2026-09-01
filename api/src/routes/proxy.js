// External API proxy — avoids CORS issues and centralises external calls
import { lookupAircraft, importAcftref, isAcftrefEmpty } from '../services/faa-registry.js'

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
    } = req.body
    const { rows } = await (await import('../db/client.js')).pool.query(
      `INSERT INTO aircraft
         (tail_number,make,model,year,engine_type,engine_hp,seats,ifr_equipped,glass_cockpit,
          notes,type_code,category,aircraft_class,gear_type,is_complex,is_high_performance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (tail_number) DO UPDATE SET
         make=EXCLUDED.make, model=EXCLUDED.model
       RETURNING *`,
      [tail_number, make, model, year, engine_type, engine_hp, seats, ifr_equipped,
       glass_cockpit, notes, type_code, category, aircraft_class, gear_type,
       is_complex, is_high_performance]
    )
    return reply.status(201).send(rows[0])
  })

  // ── OpenSky Network: detected flights by departure airport + date ─────────────
  // Requires OPENSKY_USER + OPENSKY_PASS in .env for historical data (free account).
  // Without credentials, only the last ~2 hours of data is accessible.
  fastify.get('/api/external/flights-detected', async (req, reply) => {
    const { departure, date, icao24 } = req.query
    if (!departure || !date) return reply.status(400).send({ error: 'departure and date required' })

    // Cover full Pacific day in UTC (UTC-8 worst case, +1h buffer each side)
    const dayStart = new Date(date + 'T07:00:00Z')
    const begin    = Math.floor(dayStart.getTime() / 1000)
    const end      = begin + 115200 // 32-hour window to catch late Pacific flights

    const user = process.env.OPENSKY_USER
    const pass = process.env.OPENSKY_PASS
    const authHeader = user && pass
      ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
      : null

    const headers = { 'User-Agent': 'personal-dashboard/1.0' }
    if (authHeader) headers.Authorization = authHeader

    try {
      const url = `https://opensky-network.org/api/flights/departure?airport=${encodeURIComponent(departure.toUpperCase())}&begin=${begin}&end=${end}`
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) })

      if (r.status === 403) {
        return reply.status(200).send({
          flights: [],
          needs_auth: true,
          message: 'OpenSky historical data requires a free account. Add OPENSKY_USER and OPENSKY_PASS to .env.'
        })
      }
      if (r.status === 404) return reply.status(200).send({ flights: [], needs_auth: false })
      if (!r.ok) throw new Error(`OpenSky returned ${r.status}`)

      let flights = await r.json()
      if (!Array.isArray(flights)) flights = []

      // Filter by aircraft icao24 (mode_s_hex) if provided
      if (icao24) {
        const hex = icao24.toLowerCase().replace(/[^0-9a-f]/g, '')
        flights = flights.filter(f => f.icao24?.toLowerCase() === hex)
      }

      // Enrich and shape the response
      const shaped = flights.map(f => ({
        icao24:           f.icao24,
        callsign:         f.callsign?.trim() || null,
        departure_icao:   f.estDepartureAirport || departure.toUpperCase(),
        arrival_icao:     f.estArrivalAirport || null,
        departure_time:   f.firstSeen ? new Date(f.firstSeen * 1000).toISOString() : null,
        arrival_time:     f.lastSeen  ? new Date(f.lastSeen  * 1000).toISOString() : null,
        duration_min:     f.firstSeen && f.lastSeen ? Math.round((f.lastSeen - f.firstSeen) / 60) : null,
        first_seen_unix:  f.firstSeen || null,
        last_seen_unix:   f.lastSeen || null,
      }))

      return { flights: shaped, needs_auth: false, source: 'opensky' }
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'OpenSky flights-detected failed')
      return reply.status(502).send({ error: e.message })
    }
  })

  // ── OpenSky Network: GPS track for a specific flight ─────────────────────────
  fastify.get('/api/external/flight-track', async (req, reply) => {
    const { icao24, time } = req.query  // time = Unix timestamp near flight start
    if (!icao24 || !time) return reply.status(400).send({ error: 'icao24 and time required' })

    const user = process.env.OPENSKY_USER
    const pass = process.env.OPENSKY_PASS
    const authHeader = user && pass
      ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
      : null

    const headers = { 'User-Agent': 'personal-dashboard/1.0' }
    if (authHeader) headers.Authorization = authHeader

    try {
      const r = await fetch(
        `https://opensky-network.org/api/tracks/all?icao24=${encodeURIComponent(icao24.toLowerCase())}&time=${parseInt(time)}`,
        { headers, signal: AbortSignal.timeout(12000) }
      )
      if (r.status === 403) return reply.status(200).send({ track: null, needs_auth: true })
      if (!r.ok) return reply.status(200).send({ track: null })
      const d = await r.json()
      // path: [[time, lat, lon, baro_alt_m, true_track, on_ground], ...]
      const path = (d.path || []).map(([ts, lat, lon, alt, trk, grnd]) => ({
        ts:    new Date(ts * 1000).toISOString(),
        lat:   lat,
        lon:   lon,
        alt_ft: alt != null ? Math.round(alt * 3.28084) : null,
        track: trk,
        on_ground: grnd,
      }))
      return { track: { icao24: d.icao24, callsign: d.callsign?.trim(), path }, source: 'opensky' }
    } catch (e) {
      return reply.status(200).send({ track: null })
    }
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
}

// External API proxy — avoids CORS issues and centralises external calls
export default async function proxyRoutes(fastify) {
  const xfetch = (url, ms = 7000) => {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), ms)
    return fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'personal-dashboard/1.0' } })
      .finally(() => clearTimeout(tid))
  }

  // ── Aircraft registration via AviationAPI (wraps FAA N-Number registry) ──────
  fastify.get('/api/external/aircraft/:n', async (req, reply) => {
    const n = req.params.n.toUpperCase().replace(/[^A-Z0-9]/g, '')
    try {
      const r = await xfetch(`https://api.aviationapi.com/v1/aircraft?nnumber=${encodeURIComponent(n)}`)
      if (!r.ok) return reply.status(404).send({ error: 'Not found in registry' })
      const d = await r.json()
      const keys = Object.keys(d)
      if (!keys.length) return reply.status(404).send({ error: 'Not found in registry' })
      return d[keys[0]] // unwrap keyed response
    } catch (e) {
      fastify.log.warn({ n, err: e.message }, 'Aircraft registry lookup failed')
      return reply.status(502).send({ error: 'Registry temporarily unavailable' })
    }
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

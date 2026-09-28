// Aviation weather and airport data: METAR, TAF, NOTAMs, airport info and
// runway/frequency detail, and the FAA airspace and US airport map layers.
import { queryRowsOrNull } from '../db/client.js'
import { fetchWithTimeout } from '../lib/http.js'
import { filterAirportCsv } from '../lib/csv.js'
import { fetchNotams } from '../services/notam-fetcher.js'
import { fetchMesonetMetars, closestTo } from '../services/mesonet.js'
import { sendFaaAirspace } from '../services/faaAirspace.js'
import { sendUsAirports } from '../services/usAirports.js'

// Past observations never change, so a found METAR is stored in metar_history
// and served from there afterwards (Mesonet rate-limits repeated lookups).
// Recent times aren't stored: late reports can still arrive. Without a
// database this falls through to the live lookup.
async function historicalMetar(kind, station, at, lookup) {
  const settled = Date.now() - at > 6 * 3_600_000
  if (settled) {
    const hit = await queryRowsOrNull('SELECT result FROM metar_history WHERE kind=$1 AND station=$2 AND at=$3', [kind, station, at])
    if (hit?.length) return hit[0].result
  }
  const result = await lookup()
  if (result && settled) {
    await queryRowsOrNull(
      'INSERT INTO metar_history (kind, station, at, result) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [kind, station, at, JSON.stringify(result)])
  }
  return result
}

export default async function aviationRoutes(fastify) {
  // ── METAR nearest a given time, from ISU Mesonet ─────────────────────────────
  // GET /api/metar?station=KRHV&time=2026-04-06T20:00:00Z
  fastify.get('/api/metar', async (req, reply) => {
    const { station: stationParam, time } = req.query
    if (!stationParam || !time) return reply.status(400).send({ error: 'station and time required' })

    const t = new Date(time)
    if (isNaN(t.getTime())) return reply.status(400).send({ error: 'invalid time' })

    try {
      const station = stationParam.toUpperCase().replace(/^K/, '')
      const best = await historicalMetar('nearest90', station, t, async () => {
        const o = closestTo(await fetchMesonetMetars(station, new Date(t - 90 * 60_000), new Date(+t + 90 * 60_000)), t)
        return o && { valid: o.valid.toISOString().replace('.000Z', 'Z'), metar: o.metar }
      })
      return best
        ? { station: stationParam.toUpperCase(), ...best }
        : { station: stationParam.toUpperCase(), time, metar: null }
    } catch (err) {
      fastify.log.warn({ err }, 'METAR fetch failed')
      return { station: stationParam.toUpperCase(), time, metar: null }
    }
  })

  // ── Airport detail: runways + frequencies from OurAirports ───────────────────
  // OurAirports publishes ACUK-licensed CSVs on GitHub. Data is static and cached in DB.
  fastify.get('/api/external/airport-detail/:icao', async (req, reply) => {
    const icao = req.params.icao.toUpperCase()

    // Cache hit — airport runway/frequency data is effectively static
    const cached = await queryRowsOrNull(
      'SELECT detail_json FROM airport_detail_cache WHERE icao=$1',
      [icao]
    )
    if (cached?.length) return cached[0].detail_json

    const OA = 'https://davidmegginson.github.io/ourairports-data'
    const [rwyRes, frqRes] = await Promise.allSettled([
      fetchWithTimeout(`${OA}/runways.csv`, { ms: 25000 }).then(r => r.ok ? r.text() : ''),
      fetchWithTimeout(`${OA}/airport-frequencies.csv`, { ms: 25000 }).then(r => r.ok ? r.text() : ''),
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
    await queryRowsOrNull(
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
      const r = await fetchWithTimeout(`https://aviationweather.gov/api/data/airport?ids=${icao}&format=json`)
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
          const r = await fetchWithTimeout(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=${hours}`)
          const obs = (r.ok && r.status !== 204) ? await r.json() : []
          const list = Array.isArray(obs) ? obs : []
          const best = list.sort((a, b) =>
            Math.abs(new Date(a.obsTime) - ft) - Math.abs(new Date(b.obsTime) - ft)
          )[0] || null
          return { source: 'awc', metar: best, icao }
        }
        // Older than 48 h: Iowa State Mesonet's ASOS archive, nearest observation within ±1 h.
        const station = icao.startsWith('K') && icao.length === 4 ? icao.slice(1) : icao
        const metar = await historicalMetar('nearest60', station, ft, async () => {
          const o = closestTo(await fetchMesonetMetars(station, new Date(ft - 3_600_000), new Date(+ft + 3_600_000)), ft)
          return o && { rawOb: o.metar, obsTime: o.valid.toISOString() }
        })
        return { source: 'mesonet', metar, icao }
      }
      // Current METAR — 4h window so we catch airports that close at night (tagged LAST)
      const r = await fetchWithTimeout(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=4`)
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
        const r = await fetchWithTimeout(
          `https://external-api.faa.gov/notamapi/v2/notams?icaoLocation=${icao}&pageSize=50`,
          { ms: 12000, headers: { client_id: clientId, client_secret: clientSecret } }
        )
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

  // ── TAF via Aviation Weather Center ───────────────────────────────────────────
  fastify.get('/api/external/taf/:icao', async (req, reply) => {
    const icao = req.params.icao.toUpperCase()
    try {
      const r = await fetchWithTimeout(`https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`, { ms: 10000 })
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

  // ── Map layers: FAA Class B/C/D airspace and US public-use airports ─────────
  // Stored gzip-compressed in map_layers, refreshed every 28-day AIRAC cycle.
  for (const [path, send, what] of [['/api/external/faa-airspace', sendFaaAirspace, 'Airspace'],
                                    ['/api/external/us-airports', sendUsAirports, 'Airport']]) {
    fastify.get(path, async (req, reply) => {
      try {
        return await send(req, reply, fastify.log)
      } catch (e) {
        fastify.log.warn({ err: e.message, path }, 'Map layer serve error')
        return reply.code(503).send({ error: `${what} data unavailable`, detail: e.message })
      }
    })
  }
}

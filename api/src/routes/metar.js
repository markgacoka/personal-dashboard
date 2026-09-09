// GET /api/metar?station=KRHV&time=2026-04-06T20:00:00Z
// Returns the closest METAR observation to the requested time from ISU Mesonet.
export default async function metarRoutes(fastify) {
  fastify.get('/api/metar', async (req, reply) => {
    const { station, time } = req.query
    if (!station || !time) return reply.status(400).send({ error: 'station and time required' })

    const t = new Date(time)
    if (isNaN(t.getTime())) return reply.status(400).send({ error: 'invalid time' })

    const t0 = new Date(t.getTime() - 90 * 60 * 1000)
    const t1 = new Date(t.getTime() + 90 * 60 * 1000)

    const params = new URLSearchParams({
      station:  station.toUpperCase().replace(/^K/, ''),
      data:     'metar',
      year1:    t0.getUTCFullYear(),
      month1:   t0.getUTCMonth() + 1,
      day1:     t0.getUTCDate(),
      hour1:    t0.getUTCHours(),
      minute1:  0,
      year2:    t1.getUTCFullYear(),
      month2:   t1.getUTCMonth() + 1,
      day2:     t1.getUTCDate(),
      hour2:    t1.getUTCHours(),
      minute2:  59,
      tz:       'UTC',
      format:   'onlycomma',
      latlon:   'no',
      elev:     'no',
      missing:  'empty',
      trace:    'empty',
      direct:   'no',
    })

    try {
      const res  = await fetch(`https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${params}`)
      const text = await res.text()

      // ISU Mesonet returns: station,valid,metar  (valid is UTC "YYYY-MM-DD HH:MM")
      const allLines = text.trim().split('\n')
        .filter(l => l && !l.startsWith('#') && !l.startsWith('station'))

      let best = null
      let bestDiff = Infinity

      for (const line of allLines) {
        const idx = line.indexOf(',')
        const idx2 = line.indexOf(',', idx + 1)
        if (idx < 0 || idx2 < 0) continue
        const validStr = line.slice(idx + 1, idx2).trim()
        const metarStr = line.slice(idx2 + 1).trim()
        if (!metarStr || !validStr) continue
        const validT = new Date(validStr.replace(' ', 'T') + ':00Z')
        if (isNaN(validT.getTime())) continue
        const diff = Math.abs(validT.getTime() - t.getTime())
        if (diff < bestDiff) {
          bestDiff = diff
          best = { station: station.toUpperCase(), valid: validStr.replace(' ', 'T') + ':00Z', metar: metarStr }
        }
      }

      return best || { station: station.toUpperCase(), time, metar: null }
    } catch (err) {
      fastify.log.warn({ err }, 'METAR fetch failed')
      return { station: station.toUpperCase(), time, metar: null }
    }
  })
}

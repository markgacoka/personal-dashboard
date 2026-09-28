// Aircraft: FAA registry lookup, the ACFTREF reference sync, creating an
// aircraft record, and a photo from Planespotters.
import { pool } from '../db/client.js'
import { fetchWithTimeout } from '../lib/http.js'
import { lookupAircraft, importAcftref } from '../services/faa-registry.js'

export default async function aircraftRoutes(fastify) {
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

  // ── Aircraft photo via Planespotters.net ─────────────────────────────────────
  fastify.get('/api/external/aircraft-photo/:reg', async (req, reply) => {
    const reg = req.params.reg.toUpperCase().replace(/[^A-Z0-9]/g, '')
    try {
      const r = await fetchWithTimeout(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`, { ms: 8000 })
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
}

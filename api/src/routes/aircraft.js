// Aircraft: FAA registry lookup, the ACFTREF reference sync, creating an
// aircraft record, and its photo (the owner's upload or a public source).
import { pool } from '../db/client.js'
import { fetchWithTimeout } from '../lib/http.js'
import { lookupAircraft, importAcftref } from '../services/faa-registry.js'
import { findPhoto, forgetPhoto, normTail, MAX_UPLOAD_BYTES, PHOTO_UA, UPLOAD_TYPES } from '../services/aircraftPhoto.js'

export default async function aircraftRoutes(fastify) {
  // Raw image bodies for photo uploads (encapsulated to these routes).
  for (const type of UPLOAD_TYPES) {
    fastify.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (req, body, done) => done(null, body))
  }

  // ── The owner's own photo of an aircraft ─────────────────────────────────────
  fastify.get('/api/aircraft/:tail/photo', async (req, reply) => {
    const { rows: [p] } = await pool.query('SELECT content_type, data FROM aircraft_photos WHERE tail_number = $1', [normTail(req.params.tail)])
    if (!p) return reply.status(404).send({ error: 'No photo' })
    // URLs carry ?v=<updated>, so a replaced photo gets a new URL.
    return reply.header('Cache-Control', 'private, max-age=31536000, immutable').type(p.content_type).send(p.data)
  })
  fastify.put('/api/aircraft/:tail/photo', async (req, reply) => {
    const type = String(req.headers['content-type'] || '').split(';')[0]
    if (!UPLOAD_TYPES.includes(type) || !Buffer.isBuffer(req.body) || !req.body.length) {
      return reply.status(415).send({ error: 'Send a JPEG, PNG or WebP image' })
    }
    const tail = normTail(req.params.tail)
    await pool.query(
      `INSERT INTO aircraft_photos (tail_number, content_type, data, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tail_number) DO UPDATE SET content_type = $2, data = $3, updated_at = NOW()`, [tail, type, req.body])
    forgetPhoto(tail)
    return findPhoto(tail)
  })
  fastify.delete('/api/aircraft/:tail/photo', async (req, reply) => {
    const tail = normTail(req.params.tail)
    await pool.query('DELETE FROM aircraft_photos WHERE tail_number = $1', [tail])
    forgetPhoto(tail)
    return reply.status(204).send()
  })

  // ── Aircraft registration: FAA HTML + adsbdb + ACFTREF seats ─────────────────
  fastify.get('/api/external/aircraft/:n', async (req, reply) => {
    const n = req.params.n.toUpperCase().replace(/[^A-Z0-9]/g, '')
    try {
      const data = await lookupAircraft(n)
      if (!data) return reply.status(404).send({ error: 'Not found in FAA registry' })
      const photo = await findPhoto(n, { hex: data.mode_s_hex, known: data.photo_url })
      return { ...data, photo_url: photo?.url || null, photo_credit: photo?.credit || null, photo_link: photo?.link || null, photo_source: photo?.source || null }
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
      const r = await fetchWithTimeout(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`, { ms: 8000, headers: { 'User-Agent': PHOTO_UA } })
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

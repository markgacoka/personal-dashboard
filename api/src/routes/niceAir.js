// NICE AIR booking emails from the Gmail inbox: the parsed list (cached in
// memory for 10 minutes) and a sync into the nice_air_schedules table.
import { pool } from '../db/client.js'
import { fetchNiceAirSchedules, syncNiceAirToDB } from '../services/gmail.js'

export default async function niceAirRoutes(fastify) {
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
}

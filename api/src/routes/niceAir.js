// NICE AIR bookings, parsed from the Gmail inbox and stored in
// nice_air_schedules. Reading ~200 emails over IMAP takes over 30 s, so the
// list is served from the table, and a Gmail sync runs in the background
// whenever the table hasn't been refreshed for 10 minutes.
import { pool } from '../db/client.js'
import { fetchNiceAirSchedules, syncNiceAirToDB } from '../services/gmail.js'

const STALE_MS = 10 * 60_000

// Stored bookings in the same shape fetchNiceAirSchedules() returns.
async function storedBookings() {
  const { rows } = await pool.query(`
    SELECT email_uid::float8 AS uid, type, subject, received_at, pilot, cfi, tail,
           start_local, end_local, start_unix::float8 AS start_unix, end_unix::float8 AS end_unix, date_str
    FROM nice_air_schedules WHERE email_uid IS NOT NULL ORDER BY email_uid`)
  return rows.map(({ received_at, ...r }) => ({ ...r, received: received_at ? received_at.toISOString() : null }))
}

export default async function niceAirRoutes(fastify) {
  let lastSync = 0
  let syncing = null
  let gmailCache = null // { ts, data } — used only when the table is unavailable

  function sync() {
    syncing ??= syncNiceAirToDB(pool)
      .then(result => { lastSync = Date.now(); fastify.log.info(result, 'NICE AIR Gmail sync complete'); return result })
      .finally(() => { syncing = null })
    return syncing
  }

  fastify.get('/api/gmail/nice-air', async (req, reply) => {
    const stored = await storedBookings().catch(() => [])
    if (stored.length) {
      if (Date.now() - lastSync > STALE_MS) {
        sync().catch(e => fastify.log.warn({ err: e.message }, 'NICE AIR background sync failed'))
      }
      return { schedules: stored, source: 'db' }
    }
    // Empty table or no database: read Gmail directly, cached for 10 minutes.
    try {
      if (gmailCache && Date.now() - gmailCache.ts < STALE_MS) return { schedules: gmailCache.data, source: 'cache' }
      const schedules = await fetchNiceAirSchedules()
      gmailCache = { ts: Date.now(), data: schedules }
      return { schedules, source: 'gmail' }
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'NICE AIR Gmail fetch failed')
      return reply.status(502).send({ error: e.message })
    }
  })

  // Mark the list stale: the next read triggers a Gmail sync.
  fastify.post('/api/gmail/nice-air/refresh', async () => {
    gmailCache = null
    lastSync = 0
    return { ok: true }
  })

  // Sync Gmail → nice_air_schedules now and report the counts. Idempotent.
  fastify.post('/api/gmail/nice-air/sync', async (req, reply) => {
    try {
      const result = await sync()
      gmailCache = null
      return { ok: true, ...result }
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'NICE AIR Gmail sync failed')
      return reply.status(502).send({ error: e.message })
    }
  })
}

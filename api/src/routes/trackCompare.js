// Temporary FlightAware-vs-FlightRadar24 comparison tool routes.
import { pool } from '../db/client.js'
import { getComparison, applyChoice } from '../services/trackCompare.js'

export default async function trackCompareRoutes(fastify) {
  // All flights, lightest shape needed for the comparison list.
  fastify.get('/api/track-compare/flights', async () => {
    const { rows } = await pool.query(`
      SELECT f.id, f.date::text, f.time_out, f.time_in, f.total_duration,
             f.departure_icao, f.arrival_icao, f.via,
             ac.tail_number
      FROM flights f
      LEFT JOIN aircraft ac ON ac.id = f.aircraft_id
      ORDER BY f.date DESC, f.id DESC
    `)
    return rows
  })

  // Existing choices, so the page can show what's already decided.
  fastify.get('/api/track-compare/choices', async () => {
    const { rows } = await pool.query('SELECT flight_id, chosen_source, chosen_at FROM flight_track_choice')
    return rows
  })

  // Fetch (and cache) both sources' matched session + track for one flight.
  fastify.get('/api/track-compare/:flightId', async (req, reply) => {
    const flightId = parseInt(req.params.flightId, 10)
    if (!Number.isInteger(flightId)) return reply.status(400).send({ error: 'Invalid flight id' })
    const result = await getComparison(flightId, fastify.log)
    if (result.error) return reply.status(404).send(result)
    return result
  })

  // Record which source the user judged more accurate. Does not touch
  // flights or track_log_points — just a record of intent for later.
  fastify.post('/api/track-compare/:flightId/choice', async (req, reply) => {
    const flightId = parseInt(req.params.flightId, 10)
    if (!Number.isInteger(flightId)) return reply.status(400).send({ error: 'Invalid flight id' })
    const { source } = req.body || {}
    if (!['aeroapi', 'fr24', 'neither'].includes(source)) {
      return reply.status(400).send({ error: "source must be 'aeroapi', 'fr24', or 'neither'" })
    }
    await pool.query(
      `INSERT INTO flight_track_choice (flight_id, chosen_source, chosen_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (flight_id) DO UPDATE SET chosen_source=$2, chosen_at=NOW()`,
      [flightId, source]
    )
    return { ok: true, flight_id: flightId, chosen_source: source }
  })

  // Undo a choice.
  fastify.delete('/api/track-compare/:flightId/choice', async (req, reply) => {
    const flightId = parseInt(req.params.flightId, 10)
    if (!Number.isInteger(flightId)) return reply.status(400).send({ error: 'Invalid flight id' })
    await pool.query('DELETE FROM flight_track_choice WHERE flight_id=$1', [flightId])
    return reply.status(204).send()
  })

  // Apply a flight's already-recorded choice to production: updates the
  // logged via-airports (only if the chosen session's airports actually
  // differ from what's logged) and replaces track_log_points with the
  // chosen source's track. This is the one write in this tool that reaches
  // outside its own tables — only fires when explicitly called per flight.
  fastify.post('/api/track-compare/:flightId/apply', async (req, reply) => {
    const flightId = parseInt(req.params.flightId, 10)
    if (!Number.isInteger(flightId)) return reply.status(400).send({ error: 'Invalid flight id' })
    const result = await applyChoice(flightId)
    if (result.error) return reply.status(404).send(result)
    return result
  })
}

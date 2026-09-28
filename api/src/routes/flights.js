import { pool } from '../db/client.js'
import { syncNiceAirToDB } from '../services/gmail.js'
import { autoFetchOpenSkyTrack } from '../services/flightTrack.js'
import { backfillNightTimes, syncSchedulesToTimes } from '../services/schedules.js'

const FLIGHT_SELECT = `
  SELECT
    f.id, f.date, f.via, f.training_type, f.total_duration,
    f.dual_given, f.dual_received, f.pic, f.sic, f.solo,
    f.cross_country, f.night, f.actual_instrument, f.instrument AS simulated_instrument,
    f.takeoffs, f.landings, f.day_takeoffs, f.day_landings_full_stop,
    f.night_takeoffs, f.night_landings, f.night_landings_full_stop,
    f.holds, f.distance_nm, f.hobbs_start, f.hobbs_end, f.tach_start, f.tach_end,
    f.time_out, f.time_in, f.flight_review, f.checkride, f.ipc,
    f.ground_training, f.simulated_flight, f.foreflight_source AS source,
    f.remarks, f.instructor_comments,
    f.instructor_id,
    EXISTS(SELECT 1 FROM track_log_points tlp WHERE tlp.flight_id = f.id) AS has_track,
    (SELECT source FROM track_log_points WHERE flight_id = f.id LIMIT 1) AS track_source,
    row_to_json(dep) AS departure,
    row_to_json(arr) AS arrival,
    json_build_object(
      'id', ac.id, 'tail_number', ac.tail_number,
      'make', ac.make, 'model', ac.model, 'year', ac.year,
      'type_code', ac.type_code, 'category', ac.category,
      'aircraft_class', ac.aircraft_class, 'gear_type', ac.gear_type,
      'engine_type', ac.engine_type, 'engine_hp', ac.engine_hp,
      'seats', ac.seats, 'ifr_equipped', ac.ifr_equipped,
      'is_complex', ac.is_complex, 'is_high_performance', ac.is_high_performance,
      'glass_cockpit', ac.glass_cockpit, 'notes', ac.notes,
      'mode_s_hex', ac.mode_s_hex
    ) AS aircraft,
    i.name AS instructor_name,
    COALESCE(
      (SELECT json_agg(json_build_object(
        'approach_type', ap.approach_type,
        'airport_icao', ap.airport_icao,
        'runway', ap.runway,
        'circle_to_land', ap.circle_to_land
      ) ORDER BY ap.id)
      FROM approaches ap WHERE ap.flight_id = f.id),
      '[]'::json
    ) AS approaches
  FROM flights f
  JOIN airports dep ON dep.icao = f.departure_icao
  JOIN airports arr ON arr.icao = f.arrival_icao
  JOIN aircraft ac  ON ac.id   = f.aircraft_id
  LEFT JOIN instructors i ON i.id = f.instructor_id
`

// Columns written by POST/PUT /api/flights, in parameter order, with the value
// used when the request omits the field (undefined, not null, falls back).
const FLIGHT_COLUMNS = [
  ['date'], ['aircraft_id'], ['departure_icao'], ['arrival_icao'], ['via', []], ['training_type'], ['total_duration'],
  ['dual_given', 0], ['dual_received', 0], ['pic', 0], ['sic', 0], ['solo', 0],
  ['cross_country', 0], ['night', 0], ['actual_instrument', 0], ['instrument', 0],
  ['takeoffs', 0], ['landings', 0], ['day_takeoffs', 0], ['day_landings_full_stop', 0],
  ['night_takeoffs', 0], ['night_landings', 0], ['night_landings_full_stop', 0],
  ['holds', 0], ['distance_nm', null], ['hobbs_start', null], ['hobbs_end', null], ['tach_start', null], ['tach_end', null],
  ['time_out', null], ['time_in', null], ['instructor_id'], ['remarks'],
]
const COLUMN_NAMES = FLIGHT_COLUMNS.map(([c]) => c)

function flightValues(body) {
  return FLIGHT_COLUMNS.map(([col, fallback]) => {
    if (col === 'instructor_id') return body.instructor_id || null
    return body[col] === undefined ? fallback : body[col]
  })
}

async function insertApproaches(flightId, approaches = []) {
  for (const ap of approaches) {
    if (!ap.approach_type || !ap.airport_icao) continue
    await pool.query(
      `INSERT INTO approaches (flight_id,approach_type,airport_icao,runway,circle_to_land) VALUES ($1,$2,$3,$4,$5)`,
      [flightId, ap.approach_type, ap.airport_icao.toUpperCase(), ap.runway || null, ap.circle_to_land || false]
    )
  }
}

// Add via_airports: the airports table row for each ICAO in flight.via.
async function withViaAirports(flights) {
  const icaos = [...new Set(flights.flatMap(f => f.via || []))]
  const byIcao = {}
  if (icaos.length) {
    const { rows } = await pool.query('SELECT * FROM airports WHERE icao = ANY($1)', [icaos])
    for (const a of rows) byIcao[a.icao] = a
  }
  return flights.map(f => ({ ...f, via_airports: (f.via || []).map(ic => byIcao[ic] || { icao: ic }) }))
}

export default async function flightRoutes(fastify) {
  fastify.get('/api/flights', async (req) => {
    const { date, tail, departure } = req.query
    const clauses = [], params = []
    if (date)      { params.push(date);                     clauses.push(`f.date = $${params.length}::date`) }
    if (tail)      { params.push(tail.toUpperCase());       clauses.push(`ac.tail_number = $${params.length}`) }
    if (departure) { params.push(departure.toUpperCase());  clauses.push(`f.departure_icao = $${params.length}`) }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
    const { rows } = await pool.query(FLIGHT_SELECT + where + ' ORDER BY f.date DESC', params)
    return withViaAirports(rows)
  })

  fastify.get('/api/flights/:id', async (req, reply) => {
    const { rows } = await pool.query(FLIGHT_SELECT + ' WHERE f.id = $1', [req.params.id])
    if (!rows.length) return reply.status(404).send({ error: 'Not found' })
    return (await withViaAirports(rows))[0]
  })

  fastify.post('/api/flights', async (req, reply) => {
    const placeholders = COLUMN_NAMES.map((_, i) => `$${i + 1}`).join(',')
    const { rows } = await pool.query(
      `INSERT INTO flights (${COLUMN_NAMES.join(',')},foreflight_source)
       VALUES (${placeholders},'manual') RETURNING id`,
      flightValues(req.body)
    )
    const flightId = rows[0].id

    // Background: refresh NICE AIR bookings so the new entry gets block times,
    // and fetch its OpenSky track (a no-op without a Mode S hex or data).
    syncNiceAirToDB(pool).catch(() => {})
    autoFetchOpenSkyTrack(pool, flightId).catch(() => {})

    await insertApproaches(flightId, req.body.approaches)
    return reply.status(201).send({ id: flightId })
  })

  fastify.put('/api/flights/:id', async (req, reply) => {
    const id = parseInt(req.params.id)
    const assignments = COLUMN_NAMES.map((c, i) => `${c}=$${i + 2}`).join(', ')
    const { rowCount } = await pool.query(`UPDATE flights SET ${assignments} WHERE id=$1`, [id, ...flightValues(req.body)])
    if (!rowCount) return reply.status(404).send({ error: 'Not found' })
    await pool.query('DELETE FROM approaches WHERE flight_id=$1', [id])
    await insertApproaches(id, req.body.approaches)
    return { id }
  })

  fastify.delete('/api/flights/:id', async (req, reply) => {
    const { rowCount } = await pool.query('DELETE FROM flights WHERE id=$1', [parseInt(req.params.id)])
    if (!rowCount) return reply.status(404).send({ error: 'Not found' })
    return reply.status(204).send()
  })

  fastify.get('/api/aircraft', async () => {
    const { rows } = await pool.query('SELECT * FROM aircraft ORDER BY make, model')
    return rows
  })

  fastify.get('/api/airports', async () => {
    const { rows } = await pool.query('SELECT * FROM airports ORDER BY icao')
    return rows
  })

  fastify.get('/api/instructors', async () => {
    const { rows } = await pool.query('SELECT * FROM instructors ORDER BY name')
    return rows
  })

  fastify.post('/api/instructors', async (req, reply) => {
    const { name, certificate = null, rating = null } = req.body || {}
    if (!name) return reply.status(400).send({ error: 'name required' })
    const trimmed = name.trim()
    const existing = await pool.query('SELECT * FROM instructors WHERE name = $1', [trimmed])
    if (existing.rows.length) return reply.status(201).send(existing.rows[0])
    const { rows } = await pool.query(
      `INSERT INTO instructors (name, certificate, rating) VALUES ($1, $2, $3) RETURNING *`,
      [trimmed, certificate, rating]
    )
    return reply.status(201).send(rows[0])
  })

  fastify.get('/api/airports/:icao', async (req, reply) => {
    const { rows } = await pool.query('SELECT * FROM airports WHERE icao = $1', [req.params.icao.toUpperCase()])
    if (!rows.length) return reply.status(404).send({ error: 'Airport not found' })
    return rows[0]
  })

  fastify.get('/api/stats/logbook', async () => {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int                                    AS total_flights,
        ROUND(SUM(total_duration)::numeric, 1)           AS total_hours,
        ROUND(SUM(dual_given)::numeric, 1)               AS dual_given,
        ROUND(COALESCE(SUM(dual_received),0)::numeric,1) AS dual_received,
        ROUND(SUM(pic)::numeric, 1)                      AS pic,
        ROUND(COALESCE(SUM(sic),0)::numeric, 1)          AS sic,
        ROUND(SUM(solo)::numeric, 1)                     AS solo,
        ROUND(SUM(cross_country)::numeric, 1)            AS cross_country,
        ROUND(SUM(night)::numeric, 1)                    AS night,
        ROUND(COALESCE(SUM(actual_instrument),0)::numeric,1) AS actual_instrument,
        ROUND(SUM(instrument)::numeric, 1)               AS simulated_instrument,
        ROUND(COALESCE(SUM(ground_training),0)::numeric,1)  AS ground_training,
        SUM(takeoffs)::int                               AS total_takeoffs,
        SUM(landings)::int                               AS total_landings,
        SUM(night_landings)::int                         AS night_landings,
        SUM(holds)::int                                  AS total_holds,
        (SELECT COUNT(*)::int FROM approaches)           AS total_approaches,
        (SELECT COUNT(*)::int FROM flights WHERE flight_review=true OR checkride=true) AS certificates
      FROM flights
    `)
    const { rows: visited } = await pool.query(`
      SELECT COUNT(DISTINCT icao)::int AS airports_visited
      FROM (
        SELECT departure_icao AS icao FROM flights
        UNION SELECT arrival_icao FROM flights
        UNION SELECT unnest(via) FROM flights
      ) t
    `)
    return { ...rows[0], airports_visited: visited[0].airports_visited }
  })

  // ── Block times from NICE AIR bookings ─────────────────────────────────────
  // From the Gmail inbox; also runs every 6 hours (scheduleNightSync).
  fastify.post('/api/flights/backfill-night', async () => backfillNightTimes(fastify.log))

  // ── Query nice_air_schedules for specific dates ───────────────────────────────
  fastify.get('/api/flights/schedules-by-date', async (req, reply) => {
    const dates = (req.query.dates || '').split(',').filter(Boolean)
    if (!dates.length) return reply.status(400).send({ error: 'dates param required' })
    const { rows } = await pool.query(
      `SELECT date_str, tail, type, start_unix, end_unix,
              to_timestamp(start_unix) AS time_out, to_timestamp(end_unix) AS time_in
       FROM nice_air_schedules
       WHERE date_str = ANY($1) ORDER BY date_str, start_unix`,
      [dates]
    )
    return rows
  })

  // From the nice_air_schedules table: flights without a time_out, or every
  // flight with ?overwrite=true.
  fastify.post('/api/flights/sync-schedules-to-times', async (req) =>
    syncSchedulesToTimes({ overwrite: req.query.overwrite === 'true' }))
}

import { pool } from '../db/client.js'

const FLIGHT_SELECT = `
  SELECT
    f.id, f.date, f.via, f.training_type, f.total_duration,
    f.dual_given, f.pic, f.solo, f.cross_country, f.night, f.instrument,
    f.takeoffs, f.landings, f.night_takeoffs, f.night_landings,
    f.remarks,
    row_to_json(dep) AS departure,
    row_to_json(arr) AS arrival,
    json_build_object(
      'id', ac.id, 'tail_number', ac.tail_number,
      'make', ac.make, 'model', ac.model, 'year', ac.year,
      'engine_type', ac.engine_type, 'engine_hp', ac.engine_hp,
      'seats', ac.seats, 'ifr_equipped', ac.ifr_equipped,
      'glass_cockpit', ac.glass_cockpit, 'notes', ac.notes
    ) AS aircraft,
    i.name AS instructor_name
  FROM flights f
  JOIN airports dep ON dep.icao = f.departure_icao
  JOIN airports arr ON arr.icao = f.arrival_icao
  JOIN aircraft ac  ON ac.id   = f.aircraft_id
  LEFT JOIN instructors i ON i.id = f.instructor_id
`

export default async function flightRoutes(fastify) {
  fastify.get('/api/flights', async () => {
    const { rows } = await pool.query(FLIGHT_SELECT + ' ORDER BY f.date DESC')
    // Attach via airport objects from the airports table
    const allIcaos = [...new Set(rows.flatMap(r => r.via || []))]
    const airportMap = {}
    if (allIcaos.length) {
      const { rows: apts } = await pool.query(
        'SELECT * FROM airports WHERE icao = ANY($1)',
        [allIcaos]
      )
      for (const a of apts) airportMap[a.icao] = a
    }
    return rows.map(r => ({ ...r, via_airports: (r.via || []).map(ic => airportMap[ic] || { icao: ic }) }))
  })

  fastify.get('/api/flights/:id', async (req, reply) => {
    const { rows } = await pool.query(FLIGHT_SELECT + ' WHERE f.id = $1', [req.params.id])
    if (!rows.length) return reply.status(404).send({ error: 'Not found' })
    const flight = rows[0]
    const allIcaos = flight.via || []
    const airportMap = {}
    if (allIcaos.length) {
      const { rows: apts } = await pool.query('SELECT * FROM airports WHERE icao = ANY($1)', [allIcaos])
      for (const a of apts) airportMap[a.icao] = a
    }
    return { ...flight, via_airports: allIcaos.map(ic => airportMap[ic] || { icao: ic }) }
  })

  fastify.post('/api/flights', async (req, reply) => {
    const {
      date, aircraft_id, departure_icao, arrival_icao,
      via = [], training_type, total_duration,
      dual_given = 0, pic = 0, solo = 0, cross_country = 0,
      night = 0, instrument = 0, takeoffs = 0, landings = 0,
      night_takeoffs = 0, night_landings = 0, instructor_id, remarks,
    } = req.body
    const { rows } = await pool.query(
      `INSERT INTO flights
       (date,aircraft_id,departure_icao,arrival_icao,via,training_type,total_duration,
        dual_given,pic,solo,cross_country,night,instrument,takeoffs,landings,
        night_takeoffs,night_landings,instructor_id,remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [date, aircraft_id, departure_icao, arrival_icao, via, training_type, total_duration,
       dual_given, pic, solo, cross_country, night, instrument, takeoffs, landings,
       night_takeoffs, night_landings, instructor_id || null, remarks]
    )
    return reply.status(201).send({ id: rows[0].id })
  })

  fastify.get('/api/aircraft', async () => {
    const { rows } = await pool.query('SELECT * FROM aircraft ORDER BY make, model')
    return rows
  })

  fastify.get('/api/airports', async () => {
    const { rows } = await pool.query('SELECT * FROM airports ORDER BY icao')
    return rows
  })

  fastify.get('/api/airports/:icao', async (req, reply) => {
    const { rows } = await pool.query('SELECT * FROM airports WHERE icao = $1', [req.params.icao.toUpperCase()])
    if (!rows.length) return reply.status(404).send({ error: 'Airport not found' })
    return rows[0]
  })

  fastify.get('/api/stats/logbook', async () => {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int                   AS total_flights,
        ROUND(SUM(total_duration)::numeric, 1)  AS total_hours,
        ROUND(SUM(dual_given)::numeric, 1)      AS dual_given,
        ROUND(SUM(pic)::numeric, 1)             AS pic,
        ROUND(SUM(solo)::numeric, 1)            AS solo,
        ROUND(SUM(cross_country)::numeric, 1)   AS cross_country,
        ROUND(SUM(night)::numeric, 1)           AS night,
        ROUND(SUM(instrument)::numeric, 1)      AS instrument,
        SUM(takeoffs)::int               AS total_takeoffs,
        SUM(landings)::int               AS total_landings,
        SUM(night_landings)::int         AS night_landings
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
}

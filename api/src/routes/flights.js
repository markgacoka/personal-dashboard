import { pool } from '../db/client.js'
import { fetchNiceAirSchedules, syncNiceAirToDB } from '../services/gmail.js'
import { autoFetchOpenSkyTrack } from '../services/flightTrack.js'

const FLIGHT_SELECT = `
  SELECT
    f.id, f.date, f.via, f.training_type, f.total_duration,
    f.dual_given, f.dual_received, f.pic, f.sic, f.solo,
    f.cross_country, f.night, f.actual_instrument, f.instrument AS simulated_instrument,
    f.takeoffs, f.landings, f.day_takeoffs, f.day_landings_full_stop,
    f.night_takeoffs, f.night_landings, f.night_landings_full_stop,
    f.holds, f.distance_nm, f.hobbs_start, f.hobbs_end, f.tach_start, f.tach_end,
    f.time_out, f.time_in, f.flight_review, f.checkride, f.ipc,
    f.ground_training, f.simulated_flight, f.foreflight_source,
    f.remarks, f.instructor_comments,
    f.instructor_id,
    EXISTS(SELECT 1 FROM track_log_points tlp WHERE tlp.flight_id = f.id) AS has_track,
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

export default async function flightRoutes(fastify) {
  fastify.get('/api/flights', async (req) => {
    const { date, tail, departure } = req.query
    const clauses = [], params = []
    if (date)      { clauses.push(`f.date = $${params.length+1}::date`);             params.push(date) }
    if (tail)      { clauses.push(`ac.tail_number = $${params.length+1}`);           params.push(tail.toUpperCase()) }
    if (departure) { clauses.push(`f.departure_icao = $${params.length+1}`);         params.push(departure.toUpperCase()) }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
    const { rows } = await pool.query(FLIGHT_SELECT + where + ' ORDER BY f.date DESC', params)
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
      dual_given = 0, dual_received = 0, pic = 0, sic = 0, solo = 0,
      cross_country = 0, night = 0, actual_instrument = 0, instrument = 0,
      takeoffs = 0, landings = 0, day_takeoffs = 0, day_landings_full_stop = 0,
      night_takeoffs = 0, night_landings = 0, night_landings_full_stop = 0,
      holds = 0, distance_nm = null,
      hobbs_start = null, hobbs_end = null, tach_start = null, tach_end = null,
      time_out = null, time_in = null,
      instructor_id, remarks,
      approaches = [],
    } = req.body
    const { rows } = await pool.query(
      `INSERT INTO flights
       (date,aircraft_id,departure_icao,arrival_icao,via,training_type,total_duration,
        dual_given,dual_received,pic,sic,solo,cross_country,night,actual_instrument,instrument,
        takeoffs,landings,day_takeoffs,day_landings_full_stop,
        night_takeoffs,night_landings,night_landings_full_stop,
        holds,distance_nm,hobbs_start,hobbs_end,tach_start,tach_end,
        time_out,time_in,instructor_id,remarks,foreflight_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,'manual')
       RETURNING id`,
      [date, aircraft_id, departure_icao, arrival_icao, via, training_type, total_duration,
       dual_given, dual_received, pic, sic, solo, cross_country, night, actual_instrument, instrument,
       takeoffs, landings, day_takeoffs, day_landings_full_stop,
       night_takeoffs, night_landings, night_landings_full_stop,
       holds, distance_nm, hobbs_start, hobbs_end, tach_start, tach_end,
       time_out, time_in, instructor_id || null, remarks]
    )
    const flightId = rows[0].id

    // Sync latest NICE AIR Gmail schedules to DB so new entries have accurate time windows
    syncNiceAirToDB(pool).catch(() => {})
    // Fire-and-forget OpenSky track fetch — fails silently if no Mode S hex or data unavailable
    autoFetchOpenSkyTrack(pool, flightId).catch(() => {})

    for (const ap of approaches) {
      if (!ap.approach_type || !ap.airport_icao) continue
      await pool.query(
        `INSERT INTO approaches (flight_id,approach_type,airport_icao,runway,circle_to_land) VALUES ($1,$2,$3,$4,$5)`,
        [flightId, ap.approach_type, ap.airport_icao.toUpperCase(), ap.runway || null, ap.circle_to_land || false]
      )
    }
    return reply.status(201).send({ id: flightId })
  })

  fastify.put('/api/flights/:id', async (req, reply) => {
    const id = parseInt(req.params.id)
    const {
      date, aircraft_id, departure_icao, arrival_icao,
      via = [], training_type, total_duration,
      dual_given = 0, dual_received = 0, pic = 0, sic = 0, solo = 0,
      cross_country = 0, night = 0, actual_instrument = 0, instrument = 0,
      takeoffs = 0, landings = 0, day_takeoffs = 0, day_landings_full_stop = 0,
      night_takeoffs = 0, night_landings = 0, night_landings_full_stop = 0,
      holds = 0, distance_nm = null,
      hobbs_start = null, hobbs_end = null, tach_start = null, tach_end = null,
      time_out = null, time_in = null,
      instructor_id, remarks,
      approaches = [],
    } = req.body
    const { rowCount } = await pool.query(
      `UPDATE flights SET
         date=$2, aircraft_id=$3, departure_icao=$4, arrival_icao=$5, via=$6,
         training_type=$7, total_duration=$8,
         dual_given=$9, dual_received=$10, pic=$11, sic=$12, solo=$13,
         cross_country=$14, night=$15, actual_instrument=$16, instrument=$17,
         takeoffs=$18, landings=$19, day_takeoffs=$20, day_landings_full_stop=$21,
         night_takeoffs=$22, night_landings=$23, night_landings_full_stop=$24,
         holds=$25, distance_nm=$26, hobbs_start=$27, hobbs_end=$28,
         tach_start=$29, tach_end=$30, time_out=$31, time_in=$32,
         instructor_id=$33, remarks=$34
       WHERE id=$1`,
      [id, date, aircraft_id, departure_icao, arrival_icao, via, training_type, total_duration,
       dual_given, dual_received, pic, sic, solo, cross_country, night, actual_instrument, instrument,
       takeoffs, landings, day_takeoffs, day_landings_full_stop,
       night_takeoffs, night_landings, night_landings_full_stop,
       holds, distance_nm, hobbs_start, hobbs_end, tach_start, tach_end,
       time_out, time_in, instructor_id || null, remarks]
    )
    if (!rowCount) return reply.status(404).send({ error: 'Not found' })
    await pool.query('DELETE FROM approaches WHERE flight_id=$1', [id])
    for (const ap of approaches) {
      if (!ap.approach_type || !ap.airport_icao) continue
      await pool.query(
        `INSERT INTO approaches (flight_id,approach_type,airport_icao,runway,circle_to_land) VALUES ($1,$2,$3,$4,$5)`,
        [id, ap.approach_type, ap.airport_icao.toUpperCase(), ap.runway || null, ap.circle_to_land || false]
      )
    }
    return { id }
  })

  fastify.delete('/api/flights/:id', async (req, reply) => {
    const id = parseInt(req.params.id)
    const { rowCount } = await pool.query('DELETE FROM flights WHERE id=$1', [id])
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

  // ── Sync schedule block times from Gmail ─────────────────────────────────────
  // Sets time_out (block out) and time_in (block in) from NICE AIR Gmail schedules.
  // Does not touch any logbook values — night, takeoffs, landings are source-of-truth.
  fastify.post('/api/flights/backfill-night', async (req, reply) => {
    const { rows: flights } = await pool.query(`
      SELECT f.id, f.date::text, f.time_out, f.time_in, ac.tail_number
      FROM flights f
      JOIN aircraft ac ON ac.id = f.aircraft_id
    `)

    let schedules = []
    try { schedules = await fetchNiceAirSchedules() } catch (e) {
      fastify.log.warn({ err: e.message }, 'Gmail fetch failed during schedule sync')
    }

    // Keep latest non-cancelled schedule per date+tail
    const schedMap = new Map()
    for (const s of schedules) {
      if (!s.date_str || !s.tail || s.type === 'cancelled' || !s.start_unix) continue
      const key = `${s.date_str}/${s.tail.replace(/^N/, '')}`
      const existing = schedMap.get(key)
      if (!existing || (s.received || '') > (existing.received || '')) schedMap.set(key, s)
    }

    const results = []
    for (const f of flights) {
      const dateStr   = String(f.date).slice(0, 10)
      const tailShort = (f.tail_number || '').replace(/^N/, '')
      const sched     = schedMap.get(`${dateStr}/${tailShort}`)
      if (!sched) continue

      // Only set if not already recorded (ForeFlight import takes precedence)
      const timeOut = f.time_out || new Date(sched.start_unix * 1000).toISOString()
      const timeIn  = f.time_in  || (sched.end_unix ? new Date(sched.end_unix * 1000).toISOString() : null)

      await pool.query(
        `UPDATE flights SET time_out = $2, time_in = $3 WHERE id = $1`,
        [f.id, timeOut, timeIn]
      )

      results.push({
        id:       f.id,
        date:     dateStr,
        tail:     f.tail_number,
        time_out: timeOut?.slice(0, 16),
        time_in:  timeIn?.slice(0, 16),
      })
    }

    return { updated: results.length, total: flights.length, results }
  })

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

  // ── Sync NICE AIR schedule times → flights.time_out / time_in ────────────────
  // For each flight (without time_out by default, or all with ?overwrite=true),
  // find the best matching non-cancelled schedule from nice_air_schedules:
  //   1. Exact tail match on same date
  //   2. Any schedule on same date (date-only fallback) — handles solo in N739HE
  //      while dual slot was booked as N227AN; duration used as tiebreaker.
  // Does NOT touch logbook values (night, takeoffs, landings, etc.).
  fastify.post('/api/flights/sync-schedules-to-times', async (req, reply) => {
    const overwrite = req.query.overwrite === 'true'

    const { rows: flights } = await pool.query(`
      SELECT f.id, f.date::text, f.time_out, f.time_in, f.total_duration, ac.tail_number
      FROM flights f
      JOIN aircraft ac ON ac.id = f.aircraft_id
      ${overwrite ? '' : 'WHERE f.time_out IS NULL'}
    `)

    const { rows: scheds } = await pool.query(`
      SELECT date_str, tail, start_unix, end_unix
      FROM nice_air_schedules
      WHERE type != 'cancelled' AND start_unix IS NOT NULL
    `)

    const results = []
    for (const f of flights) {
      const dateStr   = String(f.date).slice(0, 10)
      const tail      = f.tail_number
      const tailShort = tail.replace(/^N/, '')
      const dateScheds = scheds.filter(s => s.date_str === dateStr)
      if (!dateScheds.length) continue

      // 1. Prefer exact tail match
      let chosen = dateScheds.find(s =>
        s.tail === tail || s.tail?.replace(/^N/, '') === tailShort
      ) || null

      // 2. Date-only fallback: pick best duration match among remaining
      if (!chosen) {
        if (dateScheds.length === 1) {
          chosen = dateScheds[0]
        } else {
          const logSec = f.total_duration ? parseFloat(f.total_duration) * 3600 : null
          chosen = logSec
            ? dateScheds.reduce((a, b) =>
                Math.abs((a.end_unix - a.start_unix || 0) - logSec) <=
                Math.abs((b.end_unix - b.start_unix || 0) - logSec) ? a : b
              )
            : dateScheds[0]
        }
      }

      if (!chosen) continue

      const timeOut = new Date(chosen.start_unix * 1000).toISOString()
      const timeIn  = chosen.end_unix ? new Date(chosen.end_unix * 1000).toISOString() : null

      await pool.query(
        `UPDATE flights SET time_out = $2, time_in = $3 WHERE id = $1`,
        [f.id, timeOut, timeIn]
      )
      results.push({
        id:            f.id,
        date:          dateStr,
        tail,
        schedule_tail: chosen.tail,
        time_out:      timeOut.slice(0, 16),
        time_in:       timeIn?.slice(0, 16) ?? null,
      })
    }

    return { updated: results.length, total: flights.length, results }
  })
}

/**
 * ForeFlight import endpoints.
 *
 * POST /api/import/foreflight/logbook   — accepts raw ForeFlight logbook CSV text
 * POST /api/import/foreflight/track/:id — accepts ForeFlight track log CSV for a specific flight
 *
 * ForeFlight logbook CSV format (from the ForeFlight app: Logbook → ⋮ → Export):
 *   Line 0:  "ForeFlight Logbook Import,..."
 *   Line 2:  "Aircraft Table,..."
 *   Line 3:  aircraft column headers
 *   Lines 4+ aircraft rows (until blank)
 *   (blank)
 *   "Flights Table,..."
 *   column headers
 *   flight rows
 *
 * ForeFlight track log CSV format (More → Track Logs → share as CSV):
 *   Timestamp (UTC),Latitude,Longitude,Altitude,Speed,Course[,Vertical Speed]
 */

import { pool } from '../db/client.js'

// ─── CSV parser ────────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const parts = []
  let cur = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { parts.push(cur.trim()); cur = '' }
    else { cur += ch }
  }
  parts.push(cur.trim())
  return parts
}

function parseCSV(text) {
  return text.split('\n').map(l => parseCSVLine(l.replace(/\r$/, '')))
}

function fl(v) { return v ? parseFloat(v) || 0 : 0 }
function intv(v) { return v ? parseInt(v) || 0 : 0 }
function boolv(v) { return String(v).toLowerCase() === 'true' }

// ─── ForeFlight logbook format constants ───────────────────────────────────────
// Column indices for the Flights Table (50 columns total)
const F = {
  date: 0, aircraft_id: 1, from: 2, to: 3, route: 4,
  time_out: 5, time_in: 6, on_duty: 7, off_duty: 8,
  total_time: 9, pic: 10, sic: 11, night: 12, solo: 13,
  cross_country: 14, distance: 15,
  day_takeoffs: 16, day_landings_full_stop: 17,
  night_takeoffs: 18, night_landings_full_stop: 19, all_landings: 20,
  actual_instrument: 21, simulated_instrument: 22,
  hobbs_start: 23, hobbs_end: 24, tach_start: 25, tach_end: 26,
  holds: 27,
  // approaches: 28–33 (6 slots, semicolon-delimited per slot: "type;airport;runway;circle")
  dual_given: 34, dual_received: 35, simulated_flight: 36, ground_training: 37,
  instructor_name: 38, instructor_comments: 39,
  // people: 40–45
  flight_review: 46, checkride: 47, ipc: 48, comments: 49,
}

// Aircraft column indices (50 columns)
const A = {
  id: 0, type_code: 1, year: 2, make: 3, model: 4,
  category: 5, aircraft_class: 6, gear_type: 7, engine_type: 8,
  is_complex: 9, is_high_performance: 10, is_pressurized: 11,
}

// ─── Logbook import ────────────────────────────────────────────────────────────
export default async function importRoutes(fastify) {
  // Accept raw CSV body
  fastify.addContentTypeParser('text/csv', { parseAs: 'string' }, (req, body, done) => done(null, body))
  fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => done(null, body))

  fastify.post('/api/import/foreflight/logbook', async (req, reply) => {
    const csv = req.body
    if (!csv || !csv.startsWith('ForeFlight Logbook Import')) {
      return reply.status(400).send({ error: 'Not a ForeFlight logbook CSV. Export via Logbook → ⋮ → Export in ForeFlight.' })
    }

    const rows = parseCSV(csv)
    const summary = { aircraft_processed: 0, flights_imported: 0, flights_skipped: 0, errors: [] }

    // Find section start indices
    let aircraftHeaderIdx = -1, flightsHeaderIdx = -1
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === 'Aircraft Table') aircraftHeaderIdx = i + 1
      if (rows[i][0] === 'Flights Table') flightsHeaderIdx = i + 1
    }
    if (aircraftHeaderIdx < 0 || flightsHeaderIdx < 0) {
      return reply.status(400).send({ error: 'Could not find Aircraft Table or Flights Table sections.' })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Process aircraft
      for (let i = aircraftHeaderIdx + 1; i < rows.length; i++) {
        const r = rows[i]
        if (!r[A.id]) break
        await client.query(
          `INSERT INTO aircraft
             (tail_number, type_code, year, make, model, category, aircraft_class,
              gear_type, engine_type, is_complex, is_high_performance, is_pressurized)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (tail_number) DO UPDATE SET
             type_code=EXCLUDED.type_code, category=EXCLUDED.category,
             aircraft_class=EXCLUDED.aircraft_class, gear_type=EXCLUDED.gear_type,
             is_complex=EXCLUDED.is_complex, is_high_performance=EXCLUDED.is_high_performance,
             is_pressurized=EXCLUDED.is_pressurized`,
          [r[A.id], r[A.type_code], intv(r[A.year]) || null,
           r[A.make] || 'Unknown', r[A.model] || 'Unknown',
           r[A.category] || 'Airplane', r[A.aircraft_class] || 'ASEL',
           r[A.gear_type] || 'fixed_tricycle',
           r[A.engine_type] || 'Piston',
           boolv(r[A.is_complex]), boolv(r[A.is_high_performance]), boolv(r[A.is_pressurized])]
        )
        summary.aircraft_processed++
      }

      // Get aircraft id map: tail_number → id
      const { rows: acRows } = await client.query('SELECT id, tail_number FROM aircraft')
      const acMap = Object.fromEntries(acRows.map(a => [a.tail_number, a.id]))

      // Ensure instructor exists for any named instructor
      const instructorCache = {}
      async function ensureInstructor(name) {
        if (!name || instructorCache[name]) return instructorCache[name] || null
        const { rows: ins } = await client.query(
          `INSERT INTO instructors (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`, [name]
        )
        const id = ins[0]?.id ?? (await client.query('SELECT id FROM instructors WHERE name=$1', [name])).rows[0]?.id
        instructorCache[name] = id
        return id
      }

      // Ensure airport exists (stub row if unknown — user can enrich later)
      async function ensureAirport(icao) {
        if (!icao) return
        await client.query(
          `INSERT INTO airports (icao, name, lat, lon) VALUES ($1,$1,0,0) ON CONFLICT DO NOTHING`, [icao]
        )
      }

      // Process flights
      for (let i = flightsHeaderIdx + 1; i < rows.length; i++) {
        const r = rows[i]
        if (!r[F.date]) break
        const tail = r[F.aircraft_id]
        const aircraft_id = acMap[tail]
        if (!aircraft_id) {
          summary.errors.push(`Row ${i}: unknown aircraft ${tail}`)
          summary.flights_skipped++
          continue
        }

        const dep = r[F.from]?.toUpperCase()
        const arr = r[F.to]?.toUpperCase()
        await ensureAirport(dep)
        await ensureAirport(arr)
        const via = (r[F.route] || '').split(' ').map(s => s.trim().toUpperCase()).filter(Boolean)
        for (const ic of via) await ensureAirport(ic)

        const instructor_id = await ensureInstructor(r[F.instructor_name])

        const { rows: inserted } = await client.query(
          `INSERT INTO flights
             (date, aircraft_id, departure_icao, arrival_icao, via, training_type,
              total_duration, pic, sic, solo, cross_country, night, actual_instrument,
              instrument, dual_given, dual_received, simulated_flight, ground_training,
              takeoffs, landings, day_takeoffs, day_landings_full_stop,
              night_takeoffs, night_landings, night_landings_full_stop,
              holds, distance_nm, hobbs_start, hobbs_end, tach_start, tach_end,
              time_out, time_in, on_duty, off_duty,
              instructor_id, instructor_comments,
              flight_review, checkride, ipc, remarks, foreflight_source)
           VALUES
             ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
              $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,
              $36,$37,$38,$39,$40,$41,$42)
           RETURNING id`,
          [
            r[F.date], aircraft_id, dep, arr, via, null,
            fl(r[F.total_time]), fl(r[F.pic]), fl(r[F.sic]), fl(r[F.solo]),
            fl(r[F.cross_country]), fl(r[F.night]), fl(r[F.actual_instrument]),
            fl(r[F.simulated_instrument]),
            fl(r[F.dual_given]), fl(r[F.dual_received]),
            fl(r[F.simulated_flight]), fl(r[F.ground_training]),
            intv(r[F.day_takeoffs]) + intv(r[F.night_takeoffs]),
            intv(r[F.all_landings]),
            intv(r[F.day_takeoffs]), intv(r[F.day_landings_full_stop]),
            intv(r[F.night_takeoffs]), intv(r[F.night_landings_full_stop]),
            intv(r[F.night_landings_full_stop]),
            intv(r[F.holds]),
            fl(r[F.distance]) || null,
            fl(r[F.hobbs_start]) || null, fl(r[F.hobbs_end]) || null,
            fl(r[F.tach_start]) || null, fl(r[F.tach_end]) || null,
            r[F.time_out] || null, r[F.time_in] || null,
            r[F.on_duty] || null, r[F.off_duty] || null,
            instructor_id || null, r[F.instructor_comments] || null,
            boolv(r[F.flight_review]), boolv(r[F.checkride]), boolv(r[F.ipc]),
            r[F.comments] || null, 'foreflight',
          ]
        )

        const flight_id = inserted[0].id

        // Parse approaches (columns 28–33, format: "type;airport;runway;circle_to_land")
        for (let ai = 28; ai <= 33; ai++) {
          const apStr = r[ai]
          if (!apStr) continue
          const parts = apStr.split(';')
          if (parts[0]) {
            const apIcao = parts[1]?.toUpperCase()
            if (apIcao) await ensureAirport(apIcao)
            await client.query(
              `INSERT INTO approaches (flight_id, approach_type, airport_icao, runway, circle_to_land)
               VALUES ($1,$2,$3,$4,$5)`,
              [flight_id, parts[0], apIcao || null, parts[2] || null, boolv(parts[3])]
            )
          }
        }

        summary.flights_imported++
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    return summary
  })

  // ─── Track log import ────────────────────────────────────────────────────────
  // POST /api/flights/:id/track  — body: ForeFlight track log CSV text
  // Deletes existing track for this flight and replaces with new points.
  fastify.post('/api/flights/:id/track', async (req, reply) => {
    const flight_id = parseInt(req.params.id)
    const csv = req.body
    if (!csv) return reply.status(400).send({ error: 'Empty body' })

    const rows = parseCSV(csv).filter(r => r.length >= 4)
    if (!rows.length) return reply.status(400).send({ error: 'No data rows found' })

    // Detect header row and column indices
    const header = rows[0].map(h => h.toLowerCase().trim())
    const isHeader = header.some(h => h.includes('timestamp') || h.includes('latitude') || h.includes('lat'))
    const dataRows = isHeader ? rows.slice(1) : rows

    // Find column positions (handle ForeFlight's varying header names)
    const tsIdx  = isHeader ? header.findIndex(h => h.includes('timestamp') || h === 'time') : 0
    const latIdx = isHeader ? header.findIndex(h => h.includes('lat')) : 1
    const lonIdx = isHeader ? header.findIndex(h => h.includes('lon') || h.includes('lng')) : 2
    const altIdx = isHeader ? header.findIndex(h => h.includes('alt')) : 3
    const spdIdx = isHeader ? header.findIndex(h => h.includes('speed') || h.includes('spd')) : 4
    const trkIdx = isHeader ? header.findIndex(h => h.includes('course') || h.includes('track') || h.includes('heading')) : 5
    const vsIdx  = isHeader ? header.findIndex(h => h.includes('vertical')) : -1

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Verify flight exists
      const { rows: fl } = await client.query('SELECT id FROM flights WHERE id=$1', [flight_id])
      if (!fl.length) return reply.status(404).send({ error: 'Flight not found' })

      // Clear existing track
      await client.query('DELETE FROM track_log_points WHERE flight_id=$1', [flight_id])

      let inserted = 0
      for (const r of dataRows) {
        const lat = parseFloat(r[latIdx])
        const lon = parseFloat(r[lonIdx])
        if (isNaN(lat) || isNaN(lon)) continue

        const ts = r[tsIdx] || null
        const alt = altIdx >= 0 ? parseInt(r[altIdx]) || null : null
        const spd = spdIdx >= 0 ? parseInt(r[spdIdx]) || null : null
        const trk = trkIdx >= 0 ? parseInt(r[trkIdx]) || null : null
        const vs  = vsIdx  >= 0 ? parseInt(r[vsIdx])  || null : null

        await client.query(
          `INSERT INTO track_log_points (flight_id, ts, lat, lon, altitude_ft, groundspeed_kts, track_deg, vertical_speed_fpm)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [flight_id, ts, lat, lon, alt, spd, trk, vs]
        )
        inserted++
      }

      await client.query('COMMIT')
      return { flight_id, points_imported: inserted }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // ─── Track log retrieval ─────────────────────────────────────────────────────
  fastify.get('/api/flights/:id/track', async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT ts, lat, lon, altitude_ft, groundspeed_kts, track_deg, vertical_speed_fpm
       FROM track_log_points WHERE flight_id=$1 ORDER BY ts`,
      [req.params.id]
    )
    if (!rows.length) return reply.status(404).send({ error: 'No track data for this flight' })
    return rows
  })
}

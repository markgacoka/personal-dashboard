// Flight GPS tracks: normalization of provider data into the track_log_points
// schema, and persistence tagged with the provider the route came from.
//
// Normalized point: { ts, lat, lon, altitude_ft, groundspeed_kts, track_deg,
//                     vertical_speed_fpm, on_ground }
import { fetchOpenSkyTrack, normalizeIcao24 } from './opensky.js'

const TRACK_SOURCES = ['opensky', 'fr24', 'aeroapi', 'foreflight_csv']

// FR24 v1 /flight-tracks positions: ISO timestamp, alt ft, gspeed kt, vspeed fpm.
export function normalizeFr24Positions(positions) {
  return (positions || []).map(p => ({
    ts:               typeof p.timestamp === 'string' ? p.timestamp
                        : new Date((p.timestamp ?? p.ts) * 1000).toISOString(),
    lat:              p.lat ?? p.latitude,
    lon:              p.lon ?? p.longitude,
    altitude_ft:      p.alt ?? Math.round(p.altitude ?? 0),
    groundspeed_kts:  p.gspeed ?? p.spd ?? p.speed ?? p.groundspeed ?? null,
    track_deg:        p.track ?? p.hdg ?? p.heading ?? p.track_deg ?? null,
    vertical_speed_fpm: p.vspeed ?? null,
    on_ground:        (p.alt ?? p.altitude ?? 999) <= 200,
  }))
}

// Replace a flight's track with the airborne points, tagged with `source`.
// One statement (DELETE in a CTE + INSERT), so readers never see a half-written
// track. `db` is anything with pg's query(): the pool or a transaction client.
export async function saveTrackPoints(db, flightId, points, source) {
  if (!TRACK_SOURCES.includes(source)) {
    throw new Error(`saveTrackPoints: invalid source '${source}' (must be one of ${TRACK_SOURCES.join(', ')})`)
  }
  const airborne = points.filter(p => p.lat != null && p.lon != null && !p.on_ground)
  const col = k => airborne.map(p => p[k] ?? null)
  await db.query(
    `WITH cleared AS (DELETE FROM track_log_points WHERE flight_id = $1)
     INSERT INTO track_log_points
       (flight_id, ts, lat, lon, altitude_ft, groundspeed_kts, track_deg, vertical_speed_fpm, source)
     SELECT $1, t.ts, t.lat, t.lon, t.alt, t.gs, t.trk, t.vs, $9
     FROM unnest($2::timestamptz[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[])
       AS t(ts, lat, lon, alt, gs, trk, vs)`,
    [flightId, col('ts'), col('lat'), col('lon'), col('altitude_ft'),
     col('groundspeed_kts'), col('track_deg'), col('vertical_speed_fpm'), source]
  )
  return airborne.length
}

// Fetch and save the OpenSky track for a logged flight, using its aircraft's
// Mode S hex and block-out time. Returns { success, points_saved, total_points }
// or { error }.
export async function autoFetchOpenSkyTrack(pool, flightId) {
  const { rows } = await pool.query(`
    SELECT f.id, f.date::text, f.time_out, ac.mode_s_hex
    FROM flights f
    JOIN aircraft ac ON ac.id = f.aircraft_id
    WHERE f.id = $1
  `, [flightId])

  if (!rows.length) return { error: 'Flight not found' }
  const f = rows[0]
  if (!f.mode_s_hex) return { error: 'No Mode S hex code for aircraft' }

  // Anchor: block-out time if known, else 18:00Z (late morning Pacific) on the flight date.
  const queryTs = f.time_out
    ? Math.floor(new Date(f.time_out).getTime() / 1000)
    : Math.floor(new Date(String(f.date).slice(0, 10) + 'T18:00:00Z').getTime() / 1000)

  const result = await fetchOpenSkyTrack(normalizeIcao24(f.mode_s_hex), queryTs)
  if (result.status) return { error: `OpenSky returned ${result.status}` }
  if (!result.path?.length) return { error: 'No track data from OpenSky', points_saved: 0 }

  const saved = await saveTrackPoints(pool, flightId, result.path, 'opensky')
  return { success: true, points_saved: saved, total_points: result.path.length }
}

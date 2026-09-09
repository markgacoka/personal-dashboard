// Generic flight track service — normalizes ADS-B data into a common schema
// Compatible with OpenSky Network (ongoing default) and FlightRadar24 (legacy).
//
// Normalized track point schema (matches track_log_points table):
//   { ts, lat, lon, altitude_ft, groundspeed_kts, track_deg, vertical_speed_fpm }

const OSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
let _oskyToken = null

export async function getOskyToken() {
  const id  = process.env.OPENSKY_CLIENT_ID
  const sec = process.env.OPENSKY_CLIENT_SECRET
  if (!id || !sec) return null
  if (_oskyToken && _oskyToken.expiresAt > Date.now() + 30_000) return _oskyToken.value
  const r = await fetch(OSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: sec }),
    signal: AbortSignal.timeout(10000),
  })
  if (!r.ok) return null
  const d = await r.json()
  _oskyToken = { value: d.access_token, expiresAt: Date.now() + (d.expires_in ?? 3600) * 1000 }
  return _oskyToken.value
}

// Normalize OpenSky path array [[time, lat, lon, alt_m, track_deg, on_ground], ...]
export function normalizeOpenSkyPath(path) {
  return (path || []).map(([t, lat, lon, alt, trk, grnd]) => ({
    ts:               new Date(t * 1000).toISOString(),
    lat,
    lon,
    altitude_ft:      alt != null ? Math.round(alt * 3.28084) : null,
    groundspeed_kts:  null,
    track_deg:        trk ?? null,
    vertical_speed_fpm: null,
    on_ground:        !!grnd,
  }))
}

// Normalize FR24 v1 API position array (from /api/historic/flight-positions/full)
// timestamp is ISO string, alt in feet, gspeed in knots, vspeed in fpm
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

// Save normalized track points to track_log_points, replacing any existing track
export async function saveTrackPoints(pool, flightId, points) {
  const airborne = points.filter(p => p.lat != null && p.lon != null && !p.on_ground)
  await pool.query('DELETE FROM track_log_points WHERE flight_id=$1', [flightId])
  if (!airborne.length) return 0
  const rows = airborne.map(p =>
    `(${flightId}, '${p.ts}', ${p.lat}, ${p.lon}, ${p.altitude_ft ?? 'NULL'}, ` +
    `${p.groundspeed_kts ?? 'NULL'}, ${p.track_deg ?? 'NULL'}, ${p.vertical_speed_fpm ?? 'NULL'})`
  )
  await pool.query(
    `INSERT INTO track_log_points (flight_id, ts, lat, lon, altitude_ft, groundspeed_kts, track_deg, vertical_speed_fpm)
     VALUES ${rows.join(',')}`,
    []
  )
  return airborne.length
}

// Fetch OpenSky track for a flight by flight_id (reads mode_s_hex + time_out from DB)
// Returns { success, points_saved, total_points } or { error }
export async function autoFetchOpenSkyTrack(pool, flightId) {
  const { rows } = await pool.query(`
    SELECT f.id, f.date::text, f.time_out,
           ac.mode_s_hex, ac.tail_number
    FROM flights f
    JOIN aircraft ac ON ac.id = f.aircraft_id
    WHERE f.id = $1
  `, [flightId])

  if (!rows.length) return { error: 'Flight not found' }
  const f = rows[0]

  if (!f.mode_s_hex) return { error: 'No Mode S hex code for aircraft' }

  const hex = f.mode_s_hex.toLowerCase().replace(/[^0-9a-f]/g, '')

  // Anchor timestamp: use block-out time if known, else noon Pacific on the flight date
  const queryTs = f.time_out
    ? Math.floor(new Date(f.time_out).getTime() / 1000)
    : Math.floor(new Date(String(f.date).slice(0, 10) + 'T18:00:00Z').getTime() / 1000)

  // Check cache first — OpenSky tracks are immutable once a flight completes
  const { rows: cached } = await pool.query(
    'SELECT path_json FROM opensky_tracks_cache WHERE icao24=$1 AND first_seen_unix=$2',
    [hex, queryTs]
  )

  let path
  if (cached.length) {
    path = cached[0].path_json
  } else {
    let token = null
    try { token = await getOskyToken() } catch (_) {}
    const headers = { 'User-Agent': 'personal-dashboard/1.0' }
    if (token) headers.Authorization = `Bearer ${token}`

    const r = await fetch(
      `https://opensky-network.org/api/tracks/all?icao24=${encodeURIComponent(hex)}&time=${queryTs}`,
      { headers, signal: AbortSignal.timeout(12000) }
    )
    if (!r.ok) return { error: `OpenSky returned ${r.status}` }

    const d = await r.json()
    path = normalizeOpenSkyPath(d.path)

    if (path.length) {
      await pool.query(
        `INSERT INTO opensky_tracks_cache (icao24, first_seen_unix, callsign, path_json)
         VALUES ($1, $2, $3, $4) ON CONFLICT (icao24, first_seen_unix) DO NOTHING`,
        [hex, queryTs, d.callsign?.trim() || null, JSON.stringify(path)]
      )
    }
  }

  if (!path?.length) return { error: 'No track data from OpenSky', points_saved: 0 }

  const saved = await saveTrackPoints(pool, flightId, path)
  return { success: true, points_saved: saved, total_points: path.length }
}

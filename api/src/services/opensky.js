// OpenSky Network client: OAuth token, request headers, path normalization,
// and track lookup backed by opensky_tracks_cache (completed tracks never change).
import { pool } from '../db/client.js'
import { USER_AGENT } from '../lib/http.js'

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
let _token = null

export async function getOskyToken() {
  const id  = process.env.OPENSKY_CLIENT_ID
  const sec = process.env.OPENSKY_CLIENT_SECRET
  if (!id || !sec) return null
  if (_token && _token.expiresAt > Date.now() + 30_000) return _token.value
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: sec }),
    signal: AbortSignal.timeout(10000),
  })
  if (!r.ok) return null
  const d = await r.json()
  _token = { value: d.access_token, expiresAt: Date.now() + (d.expires_in ?? 3600) * 1000 }
  return _token.value
}

// Request headers, with a bearer token when credentials are configured.
// Without credentials OpenSky only serves roughly the last two hours.
export async function openSkyHeaders(log) {
  const headers = { 'User-Agent': USER_AGENT }
  try {
    const token = await getOskyToken()
    if (token) headers.Authorization = `Bearer ${token}`
  } catch (e) {
    log?.warn({ err: e.message }, 'OpenSky token failed')
  }
  return headers
}

export function normalizeIcao24(value) {
  return String(value).toLowerCase().replace(/[^0-9a-f]/g, '')
}

// OpenSky path rows are [time, lat, lon, baro_alt_m, track_deg, on_ground].
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

// The track for (icao24, anchor time), from cache or live. Returns
//   { path, callsign, icao24, cached }  on success (path may be empty), or
//   { status }                          when OpenSky answers with an HTTP error.
// Network failures throw.
export async function fetchOpenSkyTrack(hex, ts) {
  const { rows } = await pool.query(
    'SELECT callsign, path_json FROM opensky_tracks_cache WHERE icao24=$1 AND first_seen_unix=$2',
    [hex, ts]
  ).catch(() => ({ rows: [] }))
  if (rows.length) return { path: rows[0].path_json, callsign: rows[0].callsign, icao24: hex, cached: true }

  const r = await fetch(
    `https://opensky-network.org/api/tracks/all?icao24=${encodeURIComponent(hex)}&time=${ts}`,
    { headers: await openSkyHeaders(), signal: AbortSignal.timeout(12000) }
  )
  if (!r.ok) return { status: r.status }
  const d = await r.json()
  const path = normalizeOpenSkyPath(d.path)
  const callsign = d.callsign?.trim() || null
  if (path.length) {
    await pool.query(
      `INSERT INTO opensky_tracks_cache (icao24, first_seen_unix, callsign, path_json)
       VALUES ($1, $2, $3, $4) ON CONFLICT (icao24, first_seen_unix) DO NOTHING`,
      [hex, ts, callsign, JSON.stringify(path)]
    ).catch(() => {})
  }
  return { path, callsign, icao24: d.icao24, cached: false }
}

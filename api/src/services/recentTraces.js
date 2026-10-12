// Recent traces from community ADS-B networks that publish each aircraft's
// last day of positions as a readsb trace file (the same format as adsb.lol's
// archive): adsb.fi and airplanes.live, both free for non-commercial use. Their
// receivers reach places OpenSky's don't (e.g. the San Joaquin Valley at
// pattern altitude), but each file only covers about 24 hours, so every fetch
// is stored in ads_traces and reused by later refreshes.
import { gunzipSync, gzipSync } from 'zlib'
import { pool } from '../db/client.js'
import { USER_AGENT } from '../lib/http.js'
import { normalizeAdsbLol } from './adsblol.js'

export const RECENT_PROVIDERS = [
  { source: 'adsbfi', base: 'https://globe.adsb.fi' },
  { source: 'airplaneslive', base: 'https://globe.airplanes.live' },
]
const HORIZON_MS = 30 * 3600_000 // older than this, the files no longer reach back

async function fetchTrace({ source, base }, hex) {
  const r = await fetch(`${base}/data/traces/${hex.slice(-2)}/trace_full_${hex}.json`, {
    headers: { 'User-Agent': USER_AGENT, Referer: base + '/', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`${source} trace ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  return JSON.parse(buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf)
}

// Fetch and store the current trace from every provider (when the window is
// recent enough), then return stored points from all snapshots in the window.
export async function recentTracePoints(hex, fromMs, toMs, log) {
  if (toMs > Date.now() - HORIZON_MS) {
    for (const p of RECENT_PROVIDERS) {
      try {
        const trace = await fetchTrace(p, hex)
        if (!trace?.trace?.length) continue
        const startsAt = new Date(trace.timestamp * 1000)
        const endsAt = new Date((trace.timestamp + trace.trace.at(-1)[0]) * 1000)
        await pool.query(
          `INSERT INTO ads_traces (source, icao24, starts_at, ends_at, trace_gzip) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (source, icao24, starts_at) DO UPDATE SET ends_at = $4, trace_gzip = $5, fetched_at = NOW()`,
          [p.source, hex, startsAt, endsAt, gzipSync(JSON.stringify(trace))])
      } catch (e) { log?.warn({ err: e.message, source: p.source }, 'Recent trace fetch failed') }
    }
  }
  const { rows } = await pool.query(
    `SELECT source, trace_gzip FROM ads_traces WHERE icao24 = $1 AND starts_at <= $3 AND ends_at >= $2`,
    [hex, new Date(fromMs), new Date(toMs)])
  return rows.flatMap(r => normalizeAdsbLol(JSON.parse(gunzipSync(r.trace_gzip)), r.source))
}

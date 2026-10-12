// adsb.lol daily history: every aircraft's full-day ADS-B trace, published to
// GitHub releases (adsblol/globe_history_<year>) roughly 3–4 hours after each
// UTC day ends, as a tar split into ~2 GB parts. No API key or rate limit.
//
// One aircraft's file is pulled by streaming the parts through a minimal tar
// reader and stopping as soon as the member is found, so nothing is written to
// disk and, on average, half a day's archive is downloaded. Results (including
// "not in that day's archive") are cached in adsblol_traces: a published day
// never changes.
import { gunzipSync, gzipSync } from 'zlib'
import { pool } from '../db/client.js'
import { USER_AGENT } from '../lib/http.js'

const releaseTag = utcDate => `v${utcDate.replace(/-/g, '.')}-planes-readsb-prod-0`
const repoFor = utcDate => `adsblol/globe_history_${utcDate.slice(0, 4)}`

// Download URLs of a day's archive parts in order, or null if not published yet.
export async function releaseParts(utcDate) {
  const r = await fetch(`https://api.github.com/repos/${repoFor(utcDate)}/releases/tags/${releaseTag(utcDate)}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`GitHub releases ${r.status}`)
  const { assets = [] } = await r.json()
  const parts = assets.filter(a => /\.tar(\.[a-z]{2})?$/.test(a.name)).sort((a, b) => a.name.localeCompare(b.name))
  return parts.length ? parts.map(a => a.browser_download_url) : null
}

// Bytes from the archive parts, concatenated, as one async stream of chunks.
export async function* concatenated(urls, signal) {
  for (const url of urls) {
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal, redirect: 'follow' })
    if (!r.ok || !r.body) throw new Error(`archive part ${r.status}`)
    for await (const chunk of r.body) yield chunk
  }
}

// Read tar members from a byte stream and return the contents of the first
// member whose name ends with `suffix`, or null at the end of the archive.
// Handles ustar names (prefix + name) and GNU long names ('L' records).
export async function findTarMember(chunks, suffix) {
  let buf = Buffer.alloc(0)
  let longName = null
  const it = chunks[Symbol.asyncIterator]()
  const need = async n => {
    while (buf.length < n) {
      const { value, done } = await it.next()
      if (done) return false
      buf = buf.length ? Buffer.concat([buf, Buffer.from(value)]) : Buffer.from(value)
    }
    return true
  }
  const skip = async n => {
    while (n > 0) {
      if (!buf.length && !(await need(1))) return false
      const take = Math.min(n, buf.length)
      buf = buf.subarray(take)
      n -= take
    }
    return true
  }
  try {
    while (await need(512)) {
      const header = buf.subarray(0, 512)
      if (header.every(b => b === 0)) return null // end-of-archive block
      const str = (off, len) => header.subarray(off, off + len).toString('utf8').replace(/\0.*$/s, '')
      const size = parseInt(str(124, 12).trim() || '0', 8)
      const type = String.fromCharCode(header[156] || 48)
      const name = longName ?? [str(345, 155), str(0, 100)].filter(Boolean).join('/')
      longName = null
      buf = buf.subarray(512)
      const padded = Math.ceil(size / 512) * 512
      if (type === 'L') {
        if (!(await need(padded))) return null
        longName = buf.subarray(0, size).toString('utf8').replace(/\0.*$/s, '')
        buf = buf.subarray(padded)
        continue
      }
      if ((type === '0' || type === '\0') && name.endsWith(suffix)) {
        if (!(await need(size))) return null
        return Buffer.from(buf.subarray(0, size))
      }
      if (!(await skip(padded))) return null
    }
    return null
  } finally {
    await it.return?.()
  }
}

// The raw readsb trace object for one aircraft and UTC day:
//   { trace }               found (cached),
//   { trace: null }         the day is published but the aircraft isn't in it,
//   { pending: true }       the day's archive isn't published yet.
export async function getAdsbLolTrace(icao24, utcDate, log) {
  const hex = icao24.toLowerCase()
  const { rows } = await pool.query('SELECT found, trace_gzip FROM adsblol_traces WHERE icao24 = $1 AND utc_date = $2', [hex, utcDate])
  if (rows.length) return { trace: rows[0].found ? JSON.parse(gunzipSync(rows[0].trace_gzip)) : null }

  const parts = await releaseParts(utcDate)
  if (!parts) return { pending: true }
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20 * 60 * 1000)
  let member
  try {
    member = await findTarMember(concatenated(parts, controller.signal), `traces/${hex.slice(-2)}/trace_full_${hex}.json`)
  } finally {
    clearTimeout(timer)
    controller.abort() // stop any part still downloading
  }
  // Trace files are gzip-compressed JSON despite the .json name.
  const json = member ? (member[0] === 0x1f && member[1] === 0x8b ? gunzipSync(member) : member) : null
  await pool.query(
    `INSERT INTO adsblol_traces (icao24, utc_date, found, trace_gzip) VALUES ($1, $2, $3, $4)
     ON CONFLICT (icao24, utc_date) DO UPDATE SET found = $3, trace_gzip = $4, fetched_at = NOW()`,
    [hex, utcDate, !!json, json ? gzipSync(json) : null])
  log?.info({ icao24: hex, utcDate, found: !!json, seconds: Math.round((Date.now() - started) / 1000) }, 'adsb.lol trace lookup')
  return { trace: json ? JSON.parse(json) : null }
}

// readsb trace rows (adsb.lol, adsb.fi and airplanes.live all run readsb): [secondsAfterTimestamp, lat, lon, alt_ft | 'ground',
// groundspeed_kt, track_deg, flags, baro_rate_fpm, ...].
export function normalizeAdsbLol(trace, source = 'adsblol') {
  if (!trace?.trace) return []
  const t0 = trace.timestamp
  return trace.trace.map(p => ({
    ts:                 new Date((t0 + p[0]) * 1000).toISOString(),
    lat:                p[1],
    lon:                p[2],
    altitude_ft:        p[3] === 'ground' ? null : p[3],
    groundspeed_kts:    p[4] ?? null,
    track_deg:          p[5] ?? null,
    vertical_speed_fpm: p[7] ?? null,
    on_ground:          p[3] === 'ground',
    source,
  })).filter(p => p.lat != null && p.lon != null)
}

// UTC calendar dates (YYYY-MM-DD) touched by [fromMs, toMs].
export function utcDatesBetween(fromMs, toMs) {
  const out = []
  for (let d = new Date(new Date(fromMs).toISOString().slice(0, 10) + 'T00:00:00Z'); d.getTime() <= toMs; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

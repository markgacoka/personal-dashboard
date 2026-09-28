// A GeoJSON layer downloaded page by page from an ArcGIS FeatureServer and
// stored gzip-compressed in the map_layers table, refreshed on a fixed cadence
// (the FAA publishes on the 28-day AIRAC cycle). Only the compressed bytes are
// kept in memory and they're served as-is, so a request never re-serializes
// the layer (the airspace layer is 88 MB of JSON, 22 MB compressed).
import { gzip, gunzip } from 'zlib'
import { promisify } from 'util'
import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { pool } from '../db/client.js'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)
const DAY_MS = 24 * 60 * 60 * 1000

export function createFeatureLayer({ name, label, baseUrl, fields, where, pageSize, extraParams = '', timeoutMs, legacyFile, refreshMs = 28 * DAY_MS }) {
  async function fetchPage(offset, attempt = 1) {
    const url =
      `${baseUrl}/query?where=${encodeURIComponent(where)}` +
      `&outFields=${encodeURIComponent(fields)}` +
      `${extraParams}&f=geojson` +
      `&resultOffset=${offset}` +
      `&resultRecordCount=${pageSize}`
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!r.ok) throw new Error(`ArcGIS feature service ${r.status}`)
      return await r.json()
    } catch (e) {
      // The service occasionally drops a connection or 504s mid-pagination;
      // two short retries clear most of those without risking a runaway loop.
      if (attempt >= 3) throw e
      await new Promise(res => setTimeout(res, 500 * attempt))
      return fetchPage(offset, attempt + 1)
    }
  }

  async function store(json, featureCount, fetchedAt = new Date()) {
    const gz = await gzipAsync(json)
    await pool.query(
      `INSERT INTO map_layers (name, geojson_gzip, feature_count, fetched_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET geojson_gzip = $2, feature_count = $3, fetched_at = $4`,
      [name, gz, featureCount, fetchedAt])
    return { gz, featureCount, fetchedAt: fetchedAt.getTime() }
  }

  async function download(log) {
    log?.info(`Downloading ${label} via feature service (paginated)…`)
    const features = []
    let offset = 0
    while (true) {
      const page = await fetchPage(offset)
      const got = page.features ?? []
      features.push(...got)
      // A short page is the reliable end signal: exceededTransferLimit only fires
      // when the service's own cap truncates a request, and pageSize stays under it.
      if (got.length < pageSize) break
      offset += pageSize
      await new Promise(r => setTimeout(r, 200))
    }
    // Never store an empty layer for a whole cycle: fail so the next request retries.
    if (!features.length) throw new Error(`${label} feature service returned zero features`)
    const stored = await store(JSON.stringify({ type: 'FeatureCollection', features }), features.length)
    log?.info({ features: features.length }, `${label} downloaded and stored`)
    return stored
  }

  // One-time move of the layer from its old disk cache file into the table,
  // keeping the file's age so the refresh schedule is unchanged.
  async function importLegacyFile(log) {
    const file = legacyFile && resolve(process.env.DATA_DIR || '/app/data', legacyFile)
    if (!file || !existsSync(file)) return null
    const [json, s] = await Promise.all([readFile(file, 'utf8'), stat(file)])
    const featureCount = JSON.parse(json).features?.length || 0
    if (!featureCount) return null
    const stored = await store(json, featureCount, s.mtime)
    log?.info({ features: featureCount }, `${label} imported from ${legacyFile} into the database`)
    return stored
  }

  let cached = null // { gz, featureCount, fetchedAt }
  let inFlight = null

  async function load(log) {
    const { rows } = await pool.query(
      'SELECT geojson_gzip, feature_count, fetched_at FROM map_layers WHERE name = $1', [name])
    if (rows.length) return { gz: rows[0].geojson_gzip, featureCount: rows[0].feature_count, fetchedAt: rows[0].fetched_at.getTime() }
    return importLegacyFile(log)
  }

  // The layer's gzip bytes, from memory, the table, or a fresh download.
  async function getGzip(log) {
    if (cached && Date.now() - cached.fetchedAt < refreshMs) return cached.gz
    inFlight ??= (async () => {
      const stored = await load(log)
      if (stored && Date.now() - stored.fetchedAt < refreshMs) {
        log?.info({ features: stored.featureCount }, `${label} loaded from the database`)
        return stored
      }
      try {
        return await download(log)
      } catch (e) {
        // Serve a stale layer rather than none while the service is down.
        if (stored) { log?.warn({ err: e.message }, `${label} refresh failed; serving stored copy`); return stored }
        throw e
      }
    })().finally(() => { inFlight = null })
    cached = await inFlight
    return cached.gz
  }

  // Load on startup, then check daily. A single setInterval(refreshMs) would
  // overflow Node's 32-bit timer limit (~24.8 days) and fire continuously.
  function scheduleRefresh(log) {
    getGzip(log).catch(e => log?.warn({ err: e.message }, `${label} initial load failed`))
    setInterval(() => {
      if (cached && Date.now() - cached.fetchedAt < refreshMs) return
      getGzip(log).catch(e => log?.warn({ err: e.message }, `${label} scheduled refresh failed`))
    }, DAY_MS)
  }

  // Send the layer: pre-compressed when the client accepts gzip (every browser).
  async function send(req, reply, log) {
    const gz = await getGzip(log)
    reply.header('Content-Type', 'application/json; charset=utf-8')
    reply.header('Cache-Control', 'private, max-age=86400') // behind login
    reply.header('Vary', 'Accept-Encoding')
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      reply.header('Content-Encoding', 'gzip')
      return reply.send(gz)
    }
    return reply.send(await gunzipAsync(gz))
  }

  return { getGzip, send, scheduleRefresh }
}

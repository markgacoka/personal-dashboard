// A GeoJSON layer downloaded page by page from an ArcGIS FeatureServer and
// cached in memory and on disk, refreshed on a fixed cadence (the FAA
// publishes on the 28-day AIRAC cycle).
import { writeFile, readFile, stat, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'

const DAY_MS = 24 * 60 * 60 * 1000

export function createFeatureLayer({ label, baseUrl, fields, where, pageSize, extraParams = '', timeoutMs, fileName, refreshMs = 28 * DAY_MS }) {
  const dataDir = () => process.env.DATA_DIR || '/app/data'
  const cacheFile = () => resolve(dataDir(), fileName)

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

  async function download(log) {
    await mkdir(dataDir(), { recursive: true })
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
    // Never lock in an empty layer for a whole cycle: fail so the next request retries.
    if (!features.length) throw new Error(`${label} feature service returned zero features`)
    const fc = { type: 'FeatureCollection', features }
    await writeFile(cacheFile(), JSON.stringify(fc))
    log?.info({ features: features.length }, `${label} cached from feature service`)
    return fc
  }

  let memCache = null
  let memCacheAt = 0
  let inFlight = null

  async function get(log) {
    const now = Date.now()
    if (memCache && now - memCacheAt < refreshMs) return memCache
    // Concurrent first requests share one download.
    if (inFlight) return inFlight

    if (existsSync(cacheFile())) {
      try {
        const s = await stat(cacheFile())
        const cached = JSON.parse(await readFile(cacheFile(), 'utf8'))
        if (now - s.mtimeMs < refreshMs && cached.features?.length) {
          memCache = cached
          memCacheAt = s.mtimeMs
          log?.info({ features: memCache.features.length }, `${label} loaded from disk cache`)
          return memCache
        }
      } catch (e) {
        log?.warn({ err: e.message }, `${label} disk cache read error`)
      }
    }

    inFlight = download(log).finally(() => { inFlight = null })
    memCache = await inFlight
    memCacheAt = now
    return memCache
  }

  // Load on startup, then check daily. A single setInterval(refreshMs) would
  // overflow Node's 32-bit timer limit (~24.8 days) and fire continuously.
  function scheduleRefresh(log) {
    get(log).catch(e => log?.warn({ err: e.message }, `${label} initial download failed`))
    setInterval(() => {
      if (Date.now() - memCacheAt < refreshMs) return
      memCache = null
      get(log).catch(e => log?.warn({ err: e.message }, `${label} scheduled refresh failed`))
    }, DAY_MS)
  }

  return { get, scheduleRefresh }
}

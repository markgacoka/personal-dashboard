// FAA Class Airspace (B/C/D) — AIRAC 28-day cycle download + disk cache
// Source: https://adds-faa.opendata.arcgis.com/datasets/c6a62360338e408cb1512366ad61559e_0
// (Not the "Airspace Boundary" dataset — that one covers ARTCC/FIR/enroute
// boundaries and has no Class B/C/D polygons. "Class Airspace" is the
// sectional-chart layer that actually has them.)
// The FAA publishes updates on a 28-day AIRAC cycle; we re-download on the same cadence.
import { writeFile, readFile, stat, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || '/app/data'
const CACHE_FILE = resolve(DATA_DIR, 'faa-airspace.json')
const AIRAC_MS = 28 * 24 * 60 * 60 * 1000 // 28 days

// ArcGIS feature service for FAA class airspace — paginated REST query
const FS_BASE =
  'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0'

// Fields we care about for rendering + popups
const FIELDS = 'NAME,LOWER_VAL,UPPER_VAL,TYPE_CODE,LOCAL_TYPE,CLASS'
// Only the classes we render (B/C/D) — Class A is a single nationwide shell
// above FL180 and isn't useful on a local flight map.
const WHERE = "CLASS IN ('B','C','D')"

async function fetchFeatureServicePage(offset, pageSize = 1000) {
  const url =
    `${FS_BASE}/query?where=${encodeURIComponent(WHERE)}` +
    `&outFields=${encodeURIComponent(FIELDS)}` +
    `&outSR=4326&f=geojson` +
    `&resultOffset=${offset}` +
    `&resultRecordCount=${pageSize}`
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`ArcGIS feature service ${r.status}`)
  return r.json()
}

export async function downloadFaaAirspace(log) {
  await mkdir(DATA_DIR, { recursive: true })

  log?.info('Downloading FAA class airspace via feature service (paginated)…')
  const features = []
  let offset = 0
  while (true) {
    const page = await fetchFeatureServicePage(offset)
    features.push(...(page.features ?? []))
    if (!page.exceededTransferLimit) break
    offset += 1000
    // Throttle slightly to avoid overwhelming the service
    await new Promise(r => setTimeout(r, 200))
  }
  if (!features.length) {
    // Don't lock in an empty result for 28 days — surface the failure instead
    // so the next request retries rather than serving a permanently blank layer.
    throw new Error('FAA feature service returned zero features')
  }
  const fc = { type: 'FeatureCollection', features }
  await writeFile(CACHE_FILE, JSON.stringify(fc))
  log?.info({ features: features.length }, 'FAA class airspace cached from feature service')
  return fc
}

let _memCache = null
let _memCacheAt = 0

export async function getFaaAirspace(log) {
  const now = Date.now()

  // Memory cache still fresh
  if (_memCache && now - _memCacheAt < AIRAC_MS) return _memCache

  // Disk cache fresh enough (and non-empty — an empty cache is treated as invalid)
  if (existsSync(CACHE_FILE)) {
    try {
      const s = await stat(CACHE_FILE)
      const cached = JSON.parse(await readFile(CACHE_FILE, 'utf8'))
      if (now - s.mtimeMs < AIRAC_MS && cached.features?.length) {
        _memCache = cached
        _memCacheAt = s.mtimeMs
        log?.info({ features: _memCache.features?.length }, 'FAA airspace loaded from disk cache')
        return _memCache
      }
    } catch (e) {
      log?.warn({ err: e.message }, 'FAA airspace disk cache read error')
    }
  }

  // Need a fresh download
  _memCache = await downloadFaaAirspace(log)
  _memCacheAt = now
  return _memCache
}

const CHECK_MS = 24 * 60 * 60 * 1000 // 1 day

export function scheduleFaaAirspaceRefresh(log) {
  // Download on startup (non-blocking)
  getFaaAirspace(log).catch(e =>
    log?.warn({ err: e.message }, 'FAA airspace initial download failed')
  )
  // Check daily whether a refresh is due, rather than scheduling a single
  // 28-day setInterval directly: Node's timer delay is a 32-bit signed int
  // (max ~24.8 days), so AIRAC_MS (28 days) overflows it and the interval
  // fires immediately and repeatedly instead of once every 28 days.
  setInterval(() => {
    if (Date.now() - _memCacheAt < AIRAC_MS) return // not due yet
    _memCache = null // force re-download
    getFaaAirspace(log).catch(e =>
      log?.warn({ err: e.message }, 'FAA airspace scheduled refresh failed')
    )
  }, CHECK_MS)
}

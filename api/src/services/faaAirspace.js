// FAA Airspace Boundary — AIRAC 28-day cycle download + disk cache
// Source: https://adds-faa.opendata.arcgis.com/datasets/faa::airspace-boundary-1/about
// The FAA publishes updates on a 28-day AIRAC cycle; we re-download on the same cadence.
import { writeFile, readFile, stat, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || '/app/data'
const CACHE_FILE = resolve(DATA_DIR, 'faa-airspace.json')
const AIRAC_MS = 28 * 24 * 60 * 60 * 1000 // 28 days

// ArcGIS feature service for FAA airspace — paginated REST query
const FS_BASE =
  'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Airspace_Boundary/FeatureServer/0'

// Fields we care about for rendering + popups
const FIELDS = 'NAME,LOWER_VAL,UPPER_VAL,TYPE_CODE,LOCAL_TYPE,CLASS,EXCLUSION'

async function fetchFeatureServicePage(offset, pageSize = 1000) {
  const url =
    `${FS_BASE}/query?where=1%3D1` +
    `&outFields=${encodeURIComponent(FIELDS)}` +
    `&f=geojson` +
    `&resultOffset=${offset}` +
    `&resultRecordCount=${pageSize}`
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`ArcGIS feature service ${r.status}`)
  return r.json()
}

export async function downloadFaaAirspace(log) {
  await mkdir(DATA_DIR, { recursive: true })

  // Try the ArcGIS Hub direct GeoJSON export first (no pagination needed)
  const hubUrl =
    'https://adds-faa.opendata.arcgis.com/datasets/faa::airspace-boundary-1.geojson'
  try {
    log?.info('Downloading FAA airspace from Hub GeoJSON export…')
    const r = await fetch(hubUrl, { signal: AbortSignal.timeout(120_000) })
    if (r.ok) {
      const text = await r.text()
      // Validate it's actually GeoJSON
      const fc = JSON.parse(text)
      if (fc.type === 'FeatureCollection' && Array.isArray(fc.features)) {
        await writeFile(CACHE_FILE, text)
        log?.info({ features: fc.features.length }, 'FAA airspace cached from Hub export')
        return fc
      }
    }
    log?.warn({ status: r.status }, 'Hub GeoJSON export returned non-OK; falling back to feature service')
  } catch (e) {
    log?.warn({ err: e.message }, 'Hub GeoJSON export failed; falling back to feature service')
  }

  // Fallback: paginate the ArcGIS feature service
  log?.info('Downloading FAA airspace via feature service (paginated)…')
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
  const fc = { type: 'FeatureCollection', features }
  await writeFile(CACHE_FILE, JSON.stringify(fc))
  log?.info({ features: features.length }, 'FAA airspace cached from feature service')
  return fc
}

let _memCache = null
let _memCacheAt = 0

export async function getFaaAirspace(log) {
  const now = Date.now()

  // Memory cache still fresh
  if (_memCache && now - _memCacheAt < AIRAC_MS) return _memCache

  // Disk cache fresh enough
  if (existsSync(CACHE_FILE)) {
    try {
      const s = await stat(CACHE_FILE)
      if (now - s.mtimeMs < AIRAC_MS) {
        _memCache = JSON.parse(await readFile(CACHE_FILE, 'utf8'))
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

export function scheduleFaaAirspaceRefresh(log) {
  // Download on startup (non-blocking)
  getFaaAirspace(log).catch(e =>
    log?.warn({ err: e.message }, 'FAA airspace initial download failed')
  )
  // Refresh every 28 days
  setInterval(() => {
    _memCache = null // force re-download even if disk cache is fresh
    getFaaAirspace(log).catch(e =>
      log?.warn({ err: e.message }, 'FAA airspace scheduled refresh failed')
    )
  }, AIRAC_MS)
}

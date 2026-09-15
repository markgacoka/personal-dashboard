// US public-use airports — nationwide reference layer for flight maps.
// Source: FAA ArcGIS US_Airport FeatureServer (same org as the Class
// Airspace / Airspace Boundary services already used by faaAirspace.js).
// Cached like AIRAC-cycle airspace data since the underlying NASR data
// only changes on the same ~28-day publication cadence.
import { writeFile, readFile, stat, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || '/app/data'
const CACHE_FILE = resolve(DATA_DIR, 'us-airports.json')
const REFRESH_MS = 28 * 24 * 60 * 60 * 1000 // 28 days

const FS_BASE =
  'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0'

const FIELDS = 'IDENT,ICAO_ID,NAME,SERVCITY,STATE'
// Fixed-wing, public-use, currently-operational airports only — excludes
// heliports/balloonports/gliderports/ultralight strips and closed/private
// facilities, which would just be noise on a GA flight-log map.
const WHERE = "TYPE_CODE='AD' AND PRIVATEUSE=0 AND OPERSTATUS='OPERATIONAL'"
const PAGE_SIZE = 1000

async function fetchPage(offset, attempt = 1) {
  const url =
    `${FS_BASE}/query?where=${encodeURIComponent(WHERE)}` +
    `&outFields=${encodeURIComponent(FIELDS)}` +
    `&geometryPrecision=4&f=geojson` +
    `&resultOffset=${offset}` +
    `&resultRecordCount=${PAGE_SIZE}`
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) throw new Error(`ArcGIS feature service ${r.status}`)
    return await r.json()
  } catch (e) {
    if (attempt >= 3) throw e
    await new Promise(res => setTimeout(res, 500 * attempt))
    return fetchPage(offset, attempt + 1)
  }
}

export async function downloadUsAirports(log) {
  await mkdir(DATA_DIR, { recursive: true })

  log?.info('Downloading US airports via feature service (paginated)…')
  const features = []
  let offset = 0
  while (true) {
    const page = await fetchPage(offset)
    const got = page.features ?? []
    features.push(...got)
    // A short page (fewer than PAGE_SIZE) is the reliable "no more records"
    // signal — exceededTransferLimit only fires when the service's own cap
    // truncates a larger ask, which never happens when we request exactly
    // PAGE_SIZE at a time.
    if (got.length < PAGE_SIZE) break
    offset += PAGE_SIZE
    await new Promise(r => setTimeout(r, 200))
  }
  if (!features.length) {
    throw new Error('US airports feature service returned zero features')
  }
  const fc = { type: 'FeatureCollection', features }
  await writeFile(CACHE_FILE, JSON.stringify(fc))
  log?.info({ features: features.length }, 'US airports cached from feature service')
  return fc
}

let _memCache = null
let _memCacheAt = 0
let _inFlight = null

export async function getUsAirports(log) {
  const now = Date.now()

  if (_memCache && now - _memCacheAt < REFRESH_MS) return _memCache
  if (_inFlight) return _inFlight

  if (existsSync(CACHE_FILE)) {
    try {
      const s = await stat(CACHE_FILE)
      const cached = JSON.parse(await readFile(CACHE_FILE, 'utf8'))
      if (now - s.mtimeMs < REFRESH_MS && cached.features?.length) {
        _memCache = cached
        _memCacheAt = s.mtimeMs
        log?.info({ features: _memCache.features?.length }, 'US airports loaded from disk cache')
        return _memCache
      }
    } catch (e) {
      log?.warn({ err: e.message }, 'US airports disk cache read error')
    }
  }

  _inFlight = downloadUsAirports(log).finally(() => { _inFlight = null })
  _memCache = await _inFlight
  _memCacheAt = now
  return _memCache
}

const CHECK_MS = 24 * 60 * 60 * 1000 // 1 day

export function scheduleUsAirportsRefresh(log) {
  getUsAirports(log).catch(e =>
    log?.warn({ err: e.message }, 'US airports initial download failed')
  )
  // Daily check that only refreshes once REFRESH_MS has actually elapsed —
  // not a single setInterval(fn, REFRESH_MS) directly, since Node's timer
  // delay is a 32-bit signed int (max ~24.8 days) and 28 days overflows it.
  setInterval(() => {
    if (Date.now() - _memCacheAt < REFRESH_MS) return
    _memCache = null
    getUsAirports(log).catch(e =>
      log?.warn({ err: e.message }, 'US airports scheduled refresh failed')
    )
  }, CHECK_MS)
}

// A photo for an aircraft card. The owner's own upload wins; otherwise the
// first public source that has the aircraft: airport-data (also what adsbdb
// links to), then Planespotters by registration and by Mode S code. Flight
// school aircraft are often in none of them, hence the upload.
import { pool } from '../db/client.js'
import { fetchWithTimeout } from '../lib/http.js'

// Planespotters refuses server requests whose User-Agent has no contact URL.
export const PHOTO_UA = 'gacoka.com-logbook/1.0 (+https://gacoka.com)'
const CACHE_MS = 24 * 3600_000
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const cache = new Map() // tail → { at, photo }

export const normTail = t => 'N' + String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^N/, '')

// airport-data thumbnails (…/thumbnails/001/841/001841543.jpg) have a full-size
// original at image.airport-data.com/aircraft/001841543.jpg.
export function airportDataFullSize(url) {
  const m = String(url || '').match(/airport-data\.com\/images\/aircraft\/thumbnails\/(?:\d+\/)*(\d+\.\w+)$/)
  return m ? `https://image.airport-data.com/aircraft/${m[1]}` : url || null
}

async function getJson(url) {
  const r = await fetchWithTimeout(url, { ms: 8000, headers: { 'User-Agent': PHOTO_UA } })
  return r.ok ? r.json() : null
}

async function fromAirportData(tail) {
  const d = await getJson(`https://airport-data.com/api/ac_thumb.json?r=${encodeURIComponent(tail)}&n=1`)
  const p = d?.data?.[0]
  return p?.image ? { url: airportDataFullSize(p.image), credit: p.photographer || null, link: p.link || null, source: 'airport-data.com' } : null
}

async function fromPlanespotters(kind, id) {
  const d = await getJson(`https://api.planespotters.net/pub/photos/${kind}/${encodeURIComponent(id)}`)
  const p = d?.photos?.[0]
  const src = p?.thumbnail_large?.src || p?.thumbnail?.src
  return src ? { url: src, credit: p.photographer || null, link: p.link || null, source: 'Planespotters.net' } : null
}

// The owner's choice: their own upload, or a link to a photo picked by hand.
export async function uploadedPhoto(tail) {
  const { rows: [r] } = await pool.query(
    'SELECT extract(epoch FROM updated_at)::bigint AS v, url, credit, link, source FROM aircraft_photos WHERE tail_number = $1', [normTail(tail)])
  if (!r) return null
  if (r.url) return { url: r.url, credit: r.credit, link: r.link, source: r.source }
  return { url: `/api/aircraft/${normTail(tail)}/photo?v=${r.v}`, credit: null, link: null, source: 'upload' }
}

// { url, credit, link, source } or null. `known` is a photo URL the registry
// lookup already found (adsbdb's), tried before asking anyone else.
export async function findPhoto(tail, { hex = null, known = null } = {}) {
  const n = normTail(tail)
  const own = await uploadedPhoto(n).catch(() => null)
  if (own) return own
  const hit = cache.get(n)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.photo
  const tries = [
    () => fromAirportData(n),
    () => (known ? { url: airportDataFullSize(known), credit: null, link: null, source: 'airport-data.com' } : null),
    () => fromPlanespotters('reg', n),
    () => (hex ? fromPlanespotters('hex', hex.toUpperCase()) : null),
  ]
  let photo = null
  for (const t of tries) {
    photo = await Promise.resolve().then(t).catch(() => null)
    if (photo) break
  }
  cache.set(n, { at: Date.now(), photo })
  return photo
}

export function forgetPhoto(tail) {
  cache.delete(normTail(tail))
}

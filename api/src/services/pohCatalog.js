// Publicly posted POH / Information Manual PDFs, matched to an aircraft by make,
// model and year. The best match is downloaded once into planner_documents so
// the planner can show it beside every step and serve it for download.
import { pool } from '../db/client.js'
import { fetchWithTimeout } from '../lib/http.js'

// profile: the transcribed performance profile in web/src/features/planner/poh.ts
// that uses this document's tables (null when only the PDF is available).
export const CATALOG = [
  {
    key: 'C172P-1982', make: 'CESSNA', family: '172', variant: '172P', years: [1981, 1986], units: 'US',
    title: 'Cessna 172P Skyhawk POH (1982, N54829 copy)', profile: 'C172P',
    url: 'https://www.glasscockpitaviation.com/wp-content/uploads/2022/07/cessna-n54829-poh.pdf',
    pageMap: { limits: 18, airspeed: 19, weights: 21, cg: 22, fuel: 24, emergency: 31, glide: 38, speeds: 48, checklist: 50, beforeTakeoff: 53, landingChecklist: 54, stall: 80, takeoff: 82, climb: 85, cruise: 86, landing: 94, wb: 102 },
  },
  {
    key: 'C172S-NAVIII', make: 'CESSNA', family: '172', variant: '172S', years: [1998, 2030], units: 'US',
    title: 'Cessna 172S Skyhawk SP Information Manual (G1000 NAV III)', profile: null,
    url: 'https://umaine.edu/flyingclub/wp-content/uploads/sites/382/2016/10/CessnaAIM_172SNAVIII_SkyhawkSP172SIMAUS.pdf',
    pageMap: null,
  },
]

const variantOf = model => String(model || '').toUpperCase().replace(/[\s-]/g, '').match(/(\d{3})([A-Z])?/)

// Best catalog entry for an aircraft, with how close it is. Pure.
export function matchPoh({ make, model, year }) {
  const m = variantOf(model)
  if (!m) return null
  const fam = m[1], variant = `${m[1]}${m[2] || ''}`
  const mk = String(make || '').toUpperCase()
  const scored = CATALOG.filter(e => !mk || mk.includes(e.make) || e.make.includes(mk.split(' ')[0])).map(e => {
    let s = 0
    if (e.family === fam) s += 10
    if (e.variant === variant) s += 20
    if (year && year >= e.years[0] && year <= e.years[1]) s += 5
    else if (year) s -= Math.min(Math.abs(year - e.years[0]), Math.abs(year - e.years[1])) / 10
    return { e, s }
  }).filter(x => x.e.family === fam).sort((a, b) => b.s - a.s)
  if (!scored.length) return null
  const best = scored[0]
  return { entry: best.e, exact: best.e.variant === variant, sameYears: !!year && year >= best.e.years[0] && year <= best.e.years[1] }
}

const COLS = 'id, kind, title, model, tail_number, route, filename, size, page_map, source, source_ref, created_at'
const inflight = new Map()

// Stored copy of a catalog entry, downloading it the first time.
export async function ensurePoh(entry, log) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM planner_documents WHERE source = 'catalog' AND source_ref = $1`, [entry.url])
  if (rows[0]) return rows[0]
  if (inflight.has(entry.url)) return inflight.get(entry.url)
  const p = (async () => {
    log?.info({ url: entry.url }, 'POH download')
    const r = await fetchWithTimeout(entry.url, { ms: 240_000 })
    if (!r.ok) throw new Error(`POH download failed (${r.status})`)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('POH source did not return a PDF')
    const filename = entry.url.split('/').pop()
    const { rows: [doc] } = await pool.query(
      `INSERT INTO planner_documents (kind, title, model, filename, bytes, size, page_map, source, source_ref)
       VALUES ('poh', $1, $2, $3, $4, $5, $6, 'catalog', $7)
       ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET title = EXCLUDED.title
       RETURNING ${COLS}`,
      [entry.title, entry.variant, filename, buf, buf.length, entry.pageMap ? JSON.stringify(entry.pageMap) : null, entry.url])
    return doc
  })().finally(() => inflight.delete(entry.url))
  inflight.set(entry.url, p)
  return p
}

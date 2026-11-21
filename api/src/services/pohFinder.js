// A public POH for an aircraft the curated catalog (pohCatalog.js) doesn't cover,
// found by make and model in Sprinkle's aircraft manual library
// (sprinkle.com/aircraft/manuals, allowed by its robots.txt): make index → the
// make's models → each matching model's POH list, with direct PDF links. A
// candidate is kept only when its own first pages name the model (listings are
// sometimes mislabelled), then stored once in planner_documents with a page map
// read from its headings.
import { pool } from '../db/client.js'
import { fetchWithTimeout } from '../lib/http.js'
import { firstPagesText, mapScanLater, pohPageMap } from './pohPages.js'

const BASE = 'https://sprinkle.com'
const DAY = 86_400_000
const MAX_BYTES = 60 * 1024 * 1024
const pages = new Map() // path → { at, html }
const misses = new Map() // make|model → time a search found nothing
const inflight = new Map()

export const alnum = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const decode = s => s.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')

// "piper-pa-28-161-warrior-ii-412" holds PA-28-161 as consecutive tokens; "cessna-172-skyhawk-18" doesn't hold 172M.
export function slugHasModel(slug, model) {
  const want = alnum(model), toks = slug.toUpperCase().split('-')
  if (!want) return false
  for (let i = 0; i < toks.length; i++) {
    let acc = ''
    for (let j = i; j < toks.length; j++) {
      acc += toks[j]
      if (acc === want) return true
      if (!want.startsWith(acc)) break
    }
  }
  return false
}

// Make slugs on the library index for a registry make ("CESSNA", "PIPER AIRCRAFT INC", "BEECH").
export function makeSlugs(indexHtml, make) {
  const word = String(make || '').toLowerCase().match(/[a-z]+/)?.[0]
  if (!word) return []
  const slugs = [...new Set([...indexHtml.matchAll(/href="\/aircraft\/manuals\/([a-z0-9-]+)"/g)].map(m => m[1]))]
  return slugs.filter(s => s === word || s.startsWith(word)).sort((a, b) => a.length - b.length)
}

// Type designations the library files under their names ("PA-28-161" → "PA-28 Warrior II").
const NAMES = {
  'PA28140': ['cherokee-140'], 'PA28150': ['cherokee-150'], 'PA28160': ['cherokee-160'], 'PA28180': ['cherokee-180'], 'PA28235': ['cherokee-235'],
  'PA28151': ['warrior'], 'PA28161': ['warrior', 'cadet'], 'PA28181': ['archer'], 'PA28236': ['dakota'],
  'PA28R180': ['arrow'], 'PA28R200': ['arrow'], 'PA28R201': ['arrow'], 'PA28RT201': ['arrow-iv'], 'PA28RT201T': ['arrow-iv-turbo'],
  'PA32300': ['cherokee-six', 'six'], 'PA32301': ['saratoga'], 'PA32R301': ['saratoga'], 'PA34200T': ['seneca-ii'], 'PA38112': ['tomahawk'], 'PA44180': ['seminole'],
}

// Model pages on a make's page that are this model. Exact designation first; failing
// that, the base type with the suffix or a known name ("piper-pa-28-warrior-ii" for PA-28-161).
export function modelPaths(makeHtml, model) {
  const links = [...makeHtml.matchAll(/href="(\/aircraft\/manuals\/[a-z0-9-]+\/([a-z0-9-]+?)(?:-\d+)?)"/g)].map(m => ({ path: m[1], slug: m[2] }))
  const exact = [...new Set(links.filter(l => slugHasModel(l.slug, model)).map(l => l.path))]
  if (exact.length) return exact
  const m = String(model || '').toUpperCase().match(/^([A-Z]+-?\d+[A-Z]*)-(\d+[A-Z]*)$/)
  if (!m) return []
  const names = NAMES[alnum(model)] ?? []
  return [...new Set(links.filter(l => slugHasModel(l.slug, m[1]) && (l.slug.split('-').includes(m[2].toLowerCase()) || names.some(n => l.slug.includes(n)))).map(l => l.path))]
}

// POH listings on a model's handbook page: [{ url, title, year, pages }].
export function pohListings(listHtml) {
  const out = []
  for (const m of listHtml.matchAll(/https:\/\/cdn\.sprinkle\.com\/library\/pdfs\/[0-9a-f-]+\.pdf/g)) {
    if (out.some(x => x.url === m[0])) continue
    const text = decode(listHtml.slice(Math.max(0, m.index - 2500), m.index).replace(/<[^>]+>/g, '|').replace(/\s+/g, ' '))
    const meta = [...text.matchAll(/(?:\|\s*((?:19|20)\d\d)\s*)?[|\s]*PDF · (\d+) pages · ([\d.]+) (KB|MB)[|\s]*of[|\s]*([^|]+)/g)].at(-1)
    out.push({ url: m[0], year: meta?.[1] ? Number(meta[1]) : null, pages: meta ? Number(meta[2]) : null, mb: meta ? Number(meta[3]) / (meta[4] === 'KB' ? 1024 : 1) : null, title: meta?.[5]?.trim() ?? null })
  }
  return out
}

// Best first: names the model, near the airplane's year, a whole handbook (not a supplement).
export function rankListings(list, model, year) {
  const want = alnum(model)
  const score = x => (alnum(x.title).includes(want) ? 10 : 0) + (x.pages >= 60 ? 3 : x.pages != null && x.pages < 20 ? -10 : 0) - (year && x.year ? Math.abs(year - x.year) / 5 : 0)
  return list.filter(x => x.mb == null || x.mb * 1024 * 1024 <= MAX_BYTES).sort((a, b) => score(b) - score(a))
}

async function page(path) {
  const hit = pages.get(path)
  if (hit && Date.now() - hit.at < 7 * DAY) return hit.html
  const r = await fetchWithTimeout(BASE + path, { ms: 20_000 })
  if (!r.ok) throw new Error(`Manual library ${r.status} for ${path}`)
  const html = await r.text()
  pages.set(path, { at: Date.now(), html })
  return html
}

export const savePageMap = (id, map) => pool.query('UPDATE planner_documents SET page_map = $2 WHERE id = $1', [id, JSON.stringify(map)])

const COLS = 'id, kind, title, model, tail_number, route, filename, size, page_map, source, source_ref, created_at'
const titleCase = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())

// A POH found earlier for this model.
export async function storedLibraryPoh(model) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM planner_documents WHERE kind = 'poh' AND source = 'library' AND model = $1 ORDER BY created_at DESC LIMIT 1`, [String(model).toUpperCase()])
  return rows[0] ?? null
}

// Search, check and store; null when the library has nothing that verifiably is this model.
export async function findLibraryPoh({ make, model, year }, log) {
  if (!make || !alnum(model)) return null
  const stored = await storedLibraryPoh(model)
  if (stored) return stored
  const key = `${alnum(make)}|${alnum(model)}`
  if (Date.now() - (misses.get(key) ?? 0) < DAY) return null
  if (inflight.has(key)) return inflight.get(key)
  const p = (async () => {
    try {
      const index = await page('/aircraft/manuals')
      const paths = []
      for (const slug of makeSlugs(index, make).slice(0, 2)) paths.push(...modelPaths(await page(`/aircraft/manuals/${slug}`), model))
      const list = []
      for (const path of paths.slice(0, 4)) {
        try { list.push(...pohListings(await page(`${path}/pilots-operating-handbook`)).map(x => ({ ...x, listing: BASE + path }))) } catch { /* no handbook page for this model */ }
      }
      for (const c of rankListings(list, model, year).slice(0, 3)) {
        const r = await fetchWithTimeout(c.url, { ms: 240_000 })
        if (!r.ok) continue
        const bytes = Buffer.from(await r.arrayBuffer())
        if (bytes.subarray(0, 5).toString() !== '%PDF-' || bytes.length > MAX_BYTES) continue
        if (!alnum(await firstPagesText(bytes)).includes(alnum(model))) { log?.info({ url: c.url, model }, 'POH candidate is not this model'); continue }
        const pageMap = await pohPageMap(bytes)
        const title = `${titleCase(String(make).split(/\s+/)[0])} ${String(model).toUpperCase()} POH${c.year ? ` (${c.year})` : ''}`
        log?.info({ url: c.url, model, pages: Object.keys(pageMap).length }, 'POH found in the manual library')
        const { rows: [doc] } = await pool.query(
          `INSERT INTO planner_documents (kind, title, model, filename, bytes, size, page_map, source, source_ref)
           VALUES ('poh', $1, $2, $3, $4, $5, $6, 'library', $7)
           ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET model = EXCLUDED.model
           RETURNING ${COLS}`,
          [title, String(model).toUpperCase(), `${alnum(model)}-poh.pdf`, bytes, bytes.length, JSON.stringify(pageMap), c.url])
        if (!Object.keys(pageMap).length) mapScanLater(doc.id, bytes, savePageMap, log)
        return doc
      }
      misses.set(key, Date.now())
      return null
    } catch (e) {
      log?.warn({ err: e.message, make, model }, 'POH library search failed')
      return null
    }
  })().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

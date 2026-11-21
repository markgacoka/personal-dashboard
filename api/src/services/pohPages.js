// A POH's page map, read from the PDF itself: which page holds the takeoff chart,
// the climb table, the checklists and so on, found by the section and figure
// headings every GAMA-format handbook uses. Text-layer PDFs only (scans → {}).
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const opts = { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }

// Each key: its heading as printed, and where to look first: a chart or table
// is found by its figure caption ("FIGURE 5-4. TAKEOFF DISTANCE"), a section by
// its heading on a line of its own. Contents lines (ending in a page reference)
// and mentions in running text never count.
const RULES = [
  ['limits', ['LIMITATIONS'], 'section', null, null, true],
  ['airspeed', ['AIRSPEED LIMITATIONS'], 'section'],
  ['weights', ['WEIGHT LIMITS'], 'section'],
  ['cg', ['CENTER OF GRAVITY LIMITS'], 'section'],
  ['fuel', ['FUEL LIMITATIONS'], 'section'],
  ['emergency', ['EMERGENCY PROCEDURES'], 'section', null, null, true],
  ['glide', ['MAXIMUM GLIDE'], 'figure', null, 3],
  ['speeds', ['SPEEDS FOR NORMAL OPERATION'], 'section'],
  ['checklist', ['PREFLIGHT INSPECTION'], 'section'],
  ['beforeTakeoff', ['BEFORE TAKEOFF'], 'section', 'checklist'],
  ['landingChecklist', ['BEFORE LANDING'], 'section', 'beforeTakeoff'],
  ['stall', ['STALL SPEEDS'], 'figure', null, 5],
  ['takeoff', ['TAKEOFF DISTANCE', 'TAKEOFF PERFORMANCE', 'TAKEOFF GROUND ROLL'], 'figure', null, 5],
  ['climb', ['TIME FUEL AND DISTANCE TO CLIMB', 'FUEL TIME AND DISTANCE TO CLIMB'], 'figure', null, 5],
  ['cruise', ['CRUISE PERFORMANCE'], 'figure', null, 5],
  ['landing', ['LANDING DISTANCE', 'LANDING PERFORMANCE', 'LANDING GROUND ROLL'], 'figure', null, 5],
  ['wb', ['LOADING GRAPH', 'SAMPLE LOADING PROBLEM', 'WEIGHT AND BALANCE LOADING FORM'], 'figure', null, 6],
  ['cgEnvelope', ['CENTER OF GRAVITY MOMENT ENVELOPE', 'CENTER OF GRAVITY ENVELOPE', 'C G RANGE AND WEIGHT'], 'figure', null, 6],
]

// Upper case, punctuation to spaces, OCR's stray dots inside words ("Ta.keoff") dropped.
const clean = l => l.toUpperCase().replace(/([A-Z])\.([A-Z])/g, '$1$2').replace(/[^A-Z0-9]+/g, ' ').trim()
// "AIRSPEED LIMITATIONS . . . . 2-4", "EMERGENCY PROCEDURES 3": a contents entry
// (two-column contents pages put the leader mid-line).
const isRef = l => /(\d+\s*-\s*\S{1,3}|\.\s*\d+|\s\d{1,3})\s*$/.test(l.trim()) || /\.\s?\.\s?\.\s?\./.test(l)
// The heading alone: running heads ("MODEL 172P", "SECTION 2") and 1–2 letter scan specks removed.
const strip = c => c.replace(/\bMODEL \d+\w*\b/g, ' ').replace(/\bSECTION \d+\b/g, ' ').replace(/^(\d+[A-Z]? )+/, '').split(' ').filter(w => w.length > 2 || /\d/.test(w)).join(' ').trim()
const standalone = (c, name) => { const s = strip(c), n = strip(name); return s === n || (s.startsWith(n) && s.length - n.length <= 3) }
// "FIGURE 5-4. TAKEOFF DISTANCE (SHORT FIELD)" → section 5; older books number figures without a section.
const caption = sec => (c, name) => {
  const m = c.match(new RegExp(`\\bFIGURE (\\d+)(?: (\\d+))?\\b.{0,20}\\b${name}\\b`))
  return !!m && (!sec || m[2] == null || Number(m[1]) === sec)
}

// Pure: page texts (index 0 = page 1) → { key: pageNumber }.
export function pageMapFromText(pages) {
  const lines = pages.map(p => p.split('\n').filter(l => !isRef(l)).map(clean))
  // OCR splits a contents page's columns onto their own lines, so those pages only count for a section's start.
  const toc = pages.map(p => /TABLE OF CONTENTS|LIST OF (FIGURES|ILLUSTRATIONS|TABLES)/i.test(p))
  // The first page with any of the names (a chart's sheet 1 before sheet 2).
  const find = (names, test, from, tocOk) => {
    for (let i = from; i < lines.length; i++) if ((tocOk || !toc[i]) && names.some(name => lines[i].some(c => test(c, name)))) return i + 1
    return null
  }
  const map = {}
  for (const [key, names, kind, after, sec, tocOk] of RULES) {
    const from = after && map[after] ? map[after] - 1 : 0
    const [a, b] = kind === 'figure' ? [caption(sec), standalone] : [standalone, caption(sec)]
    const page = find(names, a, from, tocOk) ?? find(names, b, from, tocOk)
    if (page) map[key] = page
  }
  return map
}

// Every page's text, or null when the PDF has no usable text layer (a scan).
export async function pdfPages(bytes, { first, last } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pohpages-'))
  try {
    const pdf = join(dir, 'in.pdf')
    await writeFile(pdf, bytes)
    const args = ['-layout', ...(first ? ['-f', String(first)] : []), ...(last ? ['-l', String(last)] : []), pdf, '-']
    const { stdout } = await run('pdftotext', args, opts)
    const pages = stdout.split('\f')
    if (pages.at(-1) === '') pages.pop()
    return stdout.replace(/\s/g, '').length > 60 * Math.max(pages.length, 1) ? pages : null
  } catch {
    return null // no poppler, or a PDF it can't read: no page map rather than a failed request
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export async function pohPageMap(bytes) {
  const pages = await pdfPages(bytes)
  return pages ? pageMapFromText(pages) : {}
}

// The first pages' text, OCR'd when the PDF is a scan: enough to check what airplane a book is for.
export async function firstPagesText(bytes, n = 6) {
  const pages = await pdfPages(bytes, { first: 1, last: n })
  if (pages) return pages.join('\n')
  const dir = await mkdtemp(join(tmpdir(), 'pohocr-'))
  try {
    const pdf = join(dir, 'in.pdf')
    await writeFile(pdf, bytes)
    await run('pdftoppm', ['-r', '150', '-gray', '-png', '-l', '2', pdf, join(dir, 'p')], opts)
    const out = []
    for (const f of ['p-1.png', 'p-01.png', 'p-001.png', 'p-2.png', 'p-02.png', 'p-002.png']) {
      try { out.push((await run('tesseract', [join(dir, f), '-', '--psm', '3'], opts)).stdout) } catch { /* not this page name */ }
    }
    return out.join('\n')
  } catch {
    return ''
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Every page OCR'd (a scanned book): slow, so run once per book in the background.
export async function ocrPages(bytes, { maxPages = 200, dpi = 150 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pohocr-'))
  try {
    const pdf = join(dir, 'in.pdf')
    await writeFile(pdf, bytes)
    const out = []
    for (let i = 1; i <= maxPages; i++) {
      const base = join(dir, `p${i}`)
      try { await run('pdftoppm', ['-r', String(dpi), '-gray', '-png', '-singlefile', '-f', String(i), '-l', String(i), pdf, base], opts) } catch { break }
      try { out.push((await run('tesseract', [`${base}.png`, '-', '--psm', '3'], opts)).stdout) } catch { out.push('') }
      await rm(`${base}.png`, { force: true })
    }
    return out
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// A scanned book's page map, OCR'd in the background (minutes) and saved; one book at a time.
let queue = Promise.resolve()
export function mapScanLater(id, bytes, save, log) {
  queue = queue.then(async () => {
    const t = Date.now()
    const map = pageMapFromText(await ocrPages(bytes))
    await save(id, map)
    log?.info({ id, sections: Object.keys(map).length, s: Math.round((Date.now() - t) / 1000) }, 'POH page map from OCR')
  }).catch(e => log?.warn({ id, err: e.message }, 'POH OCR page map failed'))
  return queue
}

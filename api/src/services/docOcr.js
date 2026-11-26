// OCR for scanned documents (POHs without a text layer, checklist scans and
// photos), done once and kept. A book's page text is saved to
// planner_documents.ocr as it is read, so a restart or deploy resumes where it
// stopped instead of starting over; pages are read in parallel, one Tesseract
// process per CPU. When a scanned POH is finished, its page map, spec sheet
// and performance tables are read from that text, with the table pages read a
// second time at higher resolution in layout mode (columns kept apart).
import { execFile } from 'node:child_process'
import { cpus } from 'node:os'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { pool } from '../db/client.js'

const run = promisify(execFile)
const WORKERS = Math.max(1, Math.min(4, cpus().length))
// One thread per Tesseract process: parallel processes beat one multi-threaded one.
const env = { ...process.env, OMP_THREAD_LIMIT: '1' }
const opts = { timeout: 180_000, maxBuffer: 64 * 1024 * 1024, env }
export const OCR_VERSION = 1
const MAX_PAGES = 400

export async function pdfPageCount(pdf) {
  const { stdout } = await run('pdfinfo', [pdf], opts)
  return Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0)
}

// One page: rendered by poppler, read by Tesseract. `layout` keeps spacing (tables, checklists).
async function ocrPage(pdf, page, dir, { dpi = 150, layout = false } = {}) {
  const base = join(dir, `p${page}-${dpi}`)
  await run('nice', ['-n', '10', 'pdftoppm', '-r', String(dpi), '-gray', '-png', '-singlefile', '-f', String(page), '-l', String(page), pdf, base], opts)
  try {
    const args = [`${base}.png`, '-', '--psm', layout ? '6' : '3', ...(layout ? ['-c', 'preserve_interword_spaces=1'] : [])]
    // At a lower priority, so the site stays quick while a book is read.
    return (await run('nice', ['-n', '10', 'tesseract', ...args], opts)).stdout
  } finally { await rm(`${base}.png`, { force: true }) }
}

// Several pages at once, WORKERS at a time; results in the order asked.
export async function ocrPdf(pdf, pages, dir, o = {}, onPage) {
  const out = new Array(pages.length)
  let next = 0
  const worker = async () => {
    while (next < pages.length) {
      const k = next++
      try { out[k] = await ocrPage(pdf, pages[k], dir, o) } catch { out[k] = '' }
      await onPage?.(pages[k], out[k])
    }
  }
  await Promise.all(Array.from({ length: Math.min(WORKERS, pages.length) }, worker))
  return out
}

// A photo (PNG/JPEG; HEIC from a phone is converted first) read as one page.
export async function ocrImage(bytes, { layout = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ocrimg-'))
  try {
    let img = join(dir, 'in.img')
    await writeFile(img, bytes)
    if (isHeic(bytes)) { const jpg = join(dir, 'in.jpg'); await run('heif-convert', [img, jpg], opts); img = jpg }
    const args = [img, '-', '--psm', layout ? '6' : '3', ...(layout ? ['-c', 'preserve_interword_spaces=1'] : [])]
    return (await run('tesseract', args, opts)).stdout
  } finally { await rm(dir, { recursive: true, force: true }) }
}
export const isHeic = b => b.length > 12 && b.subarray(4, 8).toString() === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(b.subarray(8, 12).toString())

/* ── The durable book job ── */

const queue = []
let busy = false
const finishers = new Map() // document kind → what to do with the finished text

// What a document's reading looks like now: { state, done, total } or null.
export async function ocrStatus(id) {
  const { rows: [r] } = await pool.query("SELECT ocr->>'state' AS state, (ocr->>'done')::int AS done, (ocr->>'total')::int AS total FROM planner_documents WHERE id = $1", [id])
  return r?.state ? r : null
}
export const ocrMessage = s => (s?.state === 'running' ? `Reading the scanned book (OCR): ${s.done ?? 0} of ${s.total || '…'} pages` : 'Reading the scanned book (OCR)')

export function onOcrDone(kind, fn) { finishers.set(kind, fn) }

// Ask for a document to be read (no-op when it is done, queued or reading).
export async function readLater(id, log) {
  const s = await ocrStatus(id)
  if (s?.state === 'done' || queue.includes(id)) return
  if (!s) await pool.query("UPDATE planner_documents SET ocr = jsonb_build_object('v', $2::int, 'state', 'running', 'done', 0, 'total', 0, 'pages', '[]'::jsonb) WHERE id = $1", [id, OCR_VERSION])
  queue.push(id)
  drain(log)
}

// After a restart: carry on with any book that was being read.
export async function resumeReading(log) {
  const { rows } = await pool.query("SELECT id FROM planner_documents WHERE ocr->>'state' = 'running'")
  for (const r of rows) if (!queue.includes(r.id)) queue.push(r.id)
  if (rows.length) log?.info({ ids: rows.map(r => r.id) }, 'Resuming OCR')
  drain(log)
}

async function drain(log) {
  if (busy) return
  busy = true
  try {
    while (queue.length) {
      const id = queue[0]
      try { await readBook(id, log) } catch (e) {
        log?.warn({ id, err: e.message }, 'OCR failed')
        await pool.query("UPDATE planner_documents SET ocr = ocr || jsonb_build_object('state', 'failed', 'error', $2::text) WHERE id = $1", [id, e.message.slice(0, 300)]).catch(() => {})
        await finishers.get('failed')?.(id, e, log)
      }
      queue.shift()
    }
  } finally { busy = false }
}

async function readBook(id, log) {
  const { rows: [d] } = await pool.query('SELECT kind, bytes, ocr FROM planner_documents WHERE id = $1', [id])
  if (!d) return
  const dir = await mkdtemp(join(tmpdir(), 'ocrbook-'))
  const t0 = Date.now()
  try {
    const pdf = join(dir, 'in.pdf')
    await writeFile(pdf, d.bytes)
    const total = Math.min(MAX_PAGES, await pdfPageCount(pdf))
    const pages = Array.isArray(d.ocr?.pages) ? d.ocr.pages.slice(0, total) : []
    while (pages.length < total) pages.push(null)
    const todo = pages.map((p, i) => (p == null ? i + 1 : 0)).filter(Boolean)
    let done = total - todo.length, saved = Date.now()
    const save = state => pool.query("UPDATE planner_documents SET ocr = jsonb_build_object('v', $2::int, 'state', $3::text, 'done', $4::int, 'total', $5::int, 'pages', $6::jsonb) WHERE id = $1",
      [id, OCR_VERSION, state, done, total, JSON.stringify(pages)])
    await save('running')
    await ocrPdf(pdf, todo, dir, { dpi: 150 }, async (page, text) => {
      pages[page - 1] = text
      done++
      // Progress is saved every few seconds, so a restart loses little.
      if (Date.now() - saved > 5000) { saved = Date.now(); await save('running') }
    })
    await save('done')
    log?.info({ id, pages: total, s: Math.round((Date.now() - t0) / 1000) }, 'OCR done')
    await finishers.get(d.kind)?.(id, pages, { pdf, dir, log })
  } finally { await rm(dir, { recursive: true, force: true }) }
}

// The finished text of a document read before (or null).
export async function ocrText(id) {
  const { rows: [r] } = await pool.query("SELECT ocr FROM planner_documents WHERE id = $1 AND ocr->>'state' = 'done'", [id])
  return r?.ocr?.pages ?? null
}

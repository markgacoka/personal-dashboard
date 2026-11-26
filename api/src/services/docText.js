// Text out of an uploaded document, for turning a checklist into steps: the PDF's
// own text layer (pdftotext -layout keeps "Item ..... ACTION" on one line), or
// OCR for scans and photos: 300 dpi, Tesseract in layout mode so a two-column
// checklist and right-aligned actions keep their spacing, pages read in
// parallel (docOcr.js). Needs poppler-utils, tesseract-ocr and libheif-examples.
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isHeic, ocrImage, ocrPdf, pdfPageCount } from './docOcr.js'

const run = promisify(execFile)
const MAX_PAGES = 30 // a text layer
const MAX_OCR_PAGES = 12 // a scanned checklist is a few pages; this keeps a read under a minute
const opts = { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 }

export const isPdf = b => b.subarray(0, 5).toString() === '%PDF-'
export const imageType = b => (b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG' ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : isHeic(b) ? 'image/heic' : null)

// A phone photo in HEIC becomes a JPEG (every browser can show it; Tesseract can read it).
export async function heicToJpeg(bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'heic-'))
  try {
    await writeFile(join(dir, 'in.heic'), bytes)
    await run('heif-convert', ['-q', '90', join(dir, 'in.heic'), join(dir, 'out.jpg')], opts)
    return await readFile(join(dir, 'out.jpg'))
  } catch (e) {
    if (e.code === 'ENOENT') throw Object.assign(new Error('HEIC photos can\'t be converted on this server; send a JPEG or PDF'), { statusCode: 415 })
    throw e
  } finally { await rm(dir, { recursive: true, force: true }) }
}

export async function documentText(bytes) {
  try {
    if (isPdf(bytes)) {
      const dir = await mkdtemp(join(tmpdir(), 'doctext-'))
      try {
        const pdf = join(dir, 'in.pdf')
        await writeFile(pdf, bytes)
        const { stdout } = await run('pdftotext', ['-layout', '-l', String(MAX_PAGES), pdf, '-'], opts)
        const pages = stdout.split('\f').filter(p => p.trim())
        // A text layer worth using has words on most pages; otherwise it's a scan.
        if (pages.length && stdout.replace(/\s/g, '').length > 80 * pages.length) return { text: stdout, method: 'text' }
        const n = Math.min(MAX_OCR_PAGES, await pdfPageCount(pdf))
        const text = await ocrPdf(pdf, Array.from({ length: n }, (_, i) => i + 1), dir, { dpi: 300, layout: true })
        return { text: text.join('\f'), method: 'ocr' }
      } finally { await rm(dir, { recursive: true, force: true }) }
    }
    if (!imageType(bytes)) throw Object.assign(new Error('Send a PDF, PNG, JPEG or HEIC'), { statusCode: 400 })
    return { text: await ocrImage(bytes, { layout: true }), method: 'ocr' }
  } catch (e) {
    if (e.code === 'ENOENT') throw Object.assign(new Error('Text extraction tools (poppler-utils, tesseract-ocr) are not installed on the server'), { statusCode: 503 })
    throw e
  }
}

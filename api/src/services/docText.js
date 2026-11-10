// Text out of an uploaded document, for turning a checklist into steps: the PDF's
// own text layer (pdftotext -layout keeps "Item ..... ACTION" on one line), or
// OCR with Tesseract for scans and photos. Needs poppler-utils and tesseract-ocr.
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const MAX_PAGES = 30
const opts = { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 }

export const isPdf = b => b.subarray(0, 5).toString() === '%PDF-'
export const imageType = b => (b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG' ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : null)

const ocr = async file => (await run('tesseract', [file, '-', '--psm', '3', '-c', 'preserve_interword_spaces=1'], opts)).stdout

export async function documentText(bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'doctext-'))
  try {
    if (isPdf(bytes)) {
      const pdf = join(dir, 'in.pdf')
      await writeFile(pdf, bytes)
      const { stdout } = await run('pdftotext', ['-layout', '-l', String(MAX_PAGES), pdf, '-'], opts)
      const pages = stdout.split('\f').filter(p => p.trim())
      // A text layer worth using has words on most pages; otherwise it's a scan.
      if (pages.length && stdout.replace(/\s/g, '').length > 80 * pages.length) return { text: stdout, method: 'text' }
      await run('pdftoppm', ['-r', '200', '-gray', '-png', '-l', String(MAX_PAGES), pdf, join(dir, 'p')], opts)
      const imgs = (await readdir(dir)).filter(f => /^p-\d+\.png$/.test(f)).sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)))
      const out = []
      for (const f of imgs) out.push(await ocr(join(dir, f)))
      return { text: out.join('\f'), method: 'ocr' }
    }
    if (!imageType(bytes)) throw Object.assign(new Error('Send a PDF, PNG or JPEG'), { statusCode: 400 })
    const img = join(dir, 'in.img')
    await writeFile(img, bytes)
    return { text: await ocr(img), method: 'ocr' }
  } catch (e) {
    if (e.code === 'ENOENT') throw Object.assign(new Error('Text extraction tools (poppler-utils, tesseract-ocr) are not installed on the server'), { statusCode: 503 })
    throw e
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

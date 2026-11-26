// A scanned POH, once its pages are OCR'd (docOcr.js): the page map, the spec
// sheet and the performance tables, read from that text. The table pages are
// read again at 300 dpi in layout mode first, so their columns stay apart.
import { pool } from '../db/client.js'
import { ocrPdf, onOcrDone } from './docOcr.js'
import { pageMapFromText } from './pohPages.js'
import { SPECS_VERSION, specsFromText } from './pohSpecs.js'
import { TABLES_VERSION, ocrClean, tablesFromText } from './pohTables.js'

onOcrDone('poh', async (id, pages, { pdf, dir, log }) => {
  const { rows: [r] } = await pool.query('SELECT page_map FROM planner_documents WHERE id = $1', [id])
  const map = Object.keys(r?.page_map ?? {}).length ? r.page_map : pageMapFromText(pages)
  const specs = { ...specsFromText(pages), ocr: true }
  const want = [...new Set(['takeoff', 'landing', 'climb', 'cruise'].flatMap(k => (map[k] ? [map[k], map[k] + 1, map[k] + 2] : [])))].filter(p => p <= pages.length)
  const sharp = [...pages]
  if (want.length) (await ocrPdf(pdf, want, dir, { dpi: 300, layout: true })).forEach((t, i) => { if (t?.trim()) sharp[want[i] - 1] = t })
  const tables = { ...tablesFromText(sharp.map(ocrClean), map), ocr: true }
  await pool.query('UPDATE planner_documents SET page_map = $2, specs = $3, tables = $4 WHERE id = $1', [id, JSON.stringify(map), JSON.stringify(specs), JSON.stringify(tables)])
  log?.info({ id, sections: Object.keys(map).length, specs: specs.found, takeoff: tables.takeoff?.length ?? 0, landing: tables.landing?.length ?? 0, climb: tables.climb?.length ?? 0, cruise: tables.cruise?.length ?? 0 }, 'Scanned POH read')
})

// A book that couldn't be read: say so instead of "reading" forever.
onOcrDone('failed', async (id, e) => {
  await pool.query('UPDATE planner_documents SET specs = $2, tables = COALESCE(tables, $3) WHERE id = $1 AND kind = $4',
    [id, JSON.stringify({ v: SPECS_VERSION, failed: `The scan couldn't be read (${e.message.slice(0, 120)})` }), JSON.stringify({ v: TABLES_VERSION, none: 'no text layer' }), 'poh'])
})

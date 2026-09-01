#!/usr/bin/env node
/**
 * Quick smoke test: extract ACFTREF.txt from FAA zip via range requests
 * and verify we can parse it correctly.
 *
 * Usage: node scripts/test-acftref-extract.mjs
 */
import { createInflateRaw } from 'zlib'

const FAA_ZIP_URL = 'https://registry.faa.gov/database/ReleasableAircraft.zip'
const UA = 'Mozilla/5.0 (compatible; personal-dashboard/1.0)'

async function fetchBytes(start, end) {
  const r = await fetch(FAA_ZIP_URL, {
    headers: { 'User-Agent': UA, Range: `bytes=${start}-${end}` },
    signal: AbortSignal.timeout(30000)
  })
  if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

// 1. EOCD
const eocd = await fetchBytes(-22, -1).catch(() => null)
  || await (async () => {
    const r = await fetch(FAA_ZIP_URL, { headers: { 'User-Agent': UA, Range: 'bytes=-22' }, signal: AbortSignal.timeout(15000) })
    return Buffer.from(await r.arrayBuffer())
  })()

console.log('EOCD sig:', eocd.slice(0,4).toString('hex'))
const cdSize   = eocd.readUInt32LE(12)
const cdOffset = eocd.readUInt32LE(16)
console.log(`CD: offset=${cdOffset} size=${cdSize}`)

// 2. Central directory
const cd = await fetchBytes(cdOffset, cdOffset + cdSize - 1)
console.log(`Central directory fetched: ${cd.length} bytes`)

// 3. Find ACFTREF.txt
let pos = 0
let acftrefEntry = null
while (pos < cd.length - 46) {
  if (cd.readUInt32LE(pos) !== 0x02014b50) break
  const compSize     = cd.readUInt32LE(pos + 20)
  const fnLen        = cd.readUInt16LE(pos + 28)
  const extraLen     = cd.readUInt16LE(pos + 30)
  const commentLen   = cd.readUInt16LE(pos + 32)
  const localHdrOff  = cd.readUInt32LE(pos + 42)
  const method       = cd.readUInt16LE(pos + 10)
  const fn           = cd.slice(pos + 46, pos + 46 + fnLen).toString('utf8')
  console.log(`  Entry: ${fn} (${compSize} bytes compressed, method=${method}, localOffset=${localHdrOff})`)
  if (fn === 'ACFTREF.txt') acftrefEntry = { compSize, localHdrOff, method }
  pos += 46 + fnLen + extraLen + commentLen
}

if (!acftrefEntry) throw new Error('ACFTREF.txt not found in central directory')

// 4. Local file header
const lh = await fetchBytes(acftrefEntry.localHdrOff, acftrefEntry.localHdrOff + 30)
const lfnLen  = lh.readUInt16LE(26)
const lextraLen = lh.readUInt16LE(28)
const dataStart = acftrefEntry.localHdrOff + 30 + lfnLen + lextraLen
const dataEnd   = dataStart + acftrefEntry.compSize - 1
console.log(`\nACFTREF.txt data: bytes ${dataStart}–${dataEnd} (${acftrefEntry.compSize} compressed)`)

// 5. Fetch + decompress
console.log('Fetching compressed data…')
const compressed = await fetchBytes(dataStart, dataEnd)
console.log(`Got ${compressed.length} bytes, decompressing…`)
const content = await new Promise((res, rej) => {
  const inflate = createInflateRaw()
  const chunks = []
  inflate.on('data', c => chunks.push(c))
  inflate.on('end',  () => res(Buffer.concat(chunks).toString('latin1')))
  inflate.on('error', rej)
  inflate.end(compressed)
})
const lines = content.split('\n')
console.log(`\nDecompressed: ${content.length} chars, ${lines.length} lines`)
console.log('Header:', lines[0].slice(0,100))
const cessnaLines = lines.filter(l => l.includes('CESSNA') && l.includes('172'))
console.log(`\nC172 entries: ${cessnaLines.length}`)
cessnaLines.slice(0,5).forEach(l => console.log(' ', l.slice(0,100)))

/**
 * FAA aircraft data service.
 *
 * Three-source hybrid:
 *  1. FAA Registry HTML   — authoritative make/model/year/engine/status for all US aircraft
 *  2. adsbdb.com          — ICAO type code (C172, PA28, etc.) for ADS-B equipped aircraft
 *  3. faa_acftref table   — seat count, engine count, speed from FAA ACFTREF.txt (loaded once)
 *
 * No API keys required for any source.
 */

import { createInflateRaw } from 'zlib'
import { pool } from '../db/client.js'

const FAA_ZIP_URL = 'https://registry.faa.gov/database/ReleasableAircraft.zip'
const UA = 'Mozilla/5.0 (compatible; personal-dashboard/1.0)'

function xfetch(url, opts = {}) {
  const { ms = 10000, ...rest } = opts
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA }, ...rest })
    .finally(() => clearTimeout(tid))
}

// ─── Range-request ZIP extractor ─────────────────────────────────────────────

async function fetchBytes(url, start, end) {
  const r = await xfetch(url, { ms: 30000, headers: { 'User-Agent': UA, Range: `bytes=${start}-${end}` } })
  if (r.status !== 206 && r.status !== 200) throw new Error(`Range fetch failed: ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

async function extractFileFromZip(url, filename) {
  // 1. Fetch last 22 bytes → EOCD → locate central directory
  const headR = await xfetch(url, { ms: 15000, headers: { 'User-Agent': UA, Range: 'bytes=-22' } })
  const totalSize = parseInt(headR.headers.get('content-range')?.split('/')[1] || '0')
  const eocd = Buffer.from(await headR.arrayBuffer())
  if (eocd.readUInt32LE(0) !== 0x06054b50) throw new Error('Invalid EOCD signature')
  const cdSize   = eocd.readUInt32LE(12)
  const cdOffset = eocd.readUInt32LE(16)

  // 2. Fetch central directory
  const cd = await fetchBytes(url, cdOffset, cdOffset + cdSize - 1)

  // 3. Parse CD entries to find our file
  let pos = 0
  while (pos < cd.length - 46) {
    if (cd.readUInt32LE(pos) !== 0x02014b50) break
    const compressedSize  = cd.readUInt32LE(pos + 20)
    const fnLen           = cd.readUInt16LE(pos + 28)
    const extraLen        = cd.readUInt16LE(pos + 30)
    const commentLen      = cd.readUInt16LE(pos + 32)
    const localHeaderOff  = cd.readUInt32LE(pos + 42)
    const fn              = cd.slice(pos + 46, pos + 46 + fnLen).toString('utf8')
    if (fn === filename) {
      // 4. Fetch local header to determine data offset
      const lh = await fetchBytes(url, localHeaderOff, localHeaderOff + 30)
      const lfnLen   = lh.readUInt16LE(26)
      const lextraLen = lh.readUInt16LE(28)
      const dataStart = localHeaderOff + 30 + lfnLen + lextraLen
      const dataEnd   = dataStart + compressedSize - 1

      // 5. Fetch compressed data
      const compressed = await fetchBytes(url, dataStart, dataEnd)

      // 6. Decompress (DEFLATE)
      const compressionMethod = cd.readUInt16LE(pos + 10)
      if (compressionMethod === 0) return compressed.toString('latin1')
      if (compressionMethod !== 8) throw new Error(`Unsupported compression: ${compressionMethod}`)
      return await new Promise((resolve, reject) => {
        const inflate = createInflateRaw()
        const chunks = []
        inflate.on('data', c => chunks.push(c))
        inflate.on('end',  () => resolve(Buffer.concat(chunks).toString('latin1')))
        inflate.on('error', reject)
        inflate.end(compressed)
      })
    }
    pos += 46 + fnLen + extraLen + commentLen
  }
  throw new Error(`${filename} not found in zip`)
}

// ─── ACFTREF import ───────────────────────────────────────────────────────────

function parseAcftrefLine(line) {
  const f = line.split(',')
  if (f.length < 11) return null
  const code = f[0].trim().replace(/^﻿/, '')
  if (!code || code === 'CODE') return null
  const noSeats = parseInt(f[8].trim()) || null
  const speed   = parseInt(f[10].trim()) || null
  const noEng   = parseInt(f[7].trim()) || null
  return {
    code,
    mfr:           f[1].trim() || null,
    model:         f[2].trim() || null,
    type_aircraft: f[3].trim() || null,
    type_engine:   f[4].trim() || null,
    no_engines:    noEng,
    no_seats:      noSeats,
    speed_kt:      speed || null,
  }
}

export async function importAcftref(log = console.log) {
  log('Fetching FAA ACFTREF.txt via range requests…')
  const content = await extractFileFromZip(FAA_ZIP_URL, 'ACFTREF.txt')
  const lines = content.split('\n')
  const rows = lines.map(parseAcftrefLine).filter(Boolean)
  log(`Parsed ${rows.length} ACFTREF rows, inserting…`)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('TRUNCATE faa_acftref')
    // Batch insert
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200)
      const vals = []
      const ph = batch.map((r, j) => {
        const o = j * 8
        vals.push(r.code, r.mfr, r.model, r.type_aircraft, r.type_engine,
                  r.no_engines, r.no_seats, r.speed_kt)
        return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8})`
      }).join(',')
      await client.query(
        `INSERT INTO faa_acftref
           (code,mfr,model,type_aircraft,type_engine,no_engines,no_seats,speed_kt)
         VALUES ${ph} ON CONFLICT (code) DO NOTHING`,
        vals
      )
    }
    await client.query('COMMIT')
    log(`ACFTREF import complete (${rows.length} rows)`)
    return rows.length
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function isAcftrefEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*) FROM faa_acftref')
  return parseInt(rows[0].count) === 0
}

// ─── Engine type normalizer ───────────────────────────────────────────────────

function normalizeEngineType(raw) {
  const t = (raw || '').toLowerCase()
  if (!t || t === 'none') return null
  if (t.includes('reciprocating') || t.includes('4 cycle') || t.includes('2 cycle') || t.includes('rotary')) return 'Reciprocating'
  if (t.includes('turbo-prop') || t.includes('turboprop') || t.includes('turbo prop')) return 'Turboprop'
  if (t.includes('turbo-shaft') || t.includes('turboshaft')) return 'Turboshaft'
  if (t.includes('turbo-jet') || t.includes('turbojet')) return 'Turbojet'
  if (t.includes('turbo-fan') || t.includes('turbofan')) return 'Turbofan'
  if (t.includes('electric')) return 'Electric'
  return raw
}

// ─── FAA Registry HTML lookup ─────────────────────────────────────────────────

function extractDataLabel(html, label) {
  const re = new RegExp(`data-label="${label.replace(/[()]/g, '\\$&')}"[^>]*>([^<]+)`, 'i')
  const m = html.match(re)
  return m ? m[1].trim() : null
}

export async function lookupFaaHtml(nNumber) {
  const n = nNumber.replace(/^N/i, '').toUpperCase()
  const url = `https://registry.faa.gov/aircraftinquiry/Search/NNumberResult?nNumberTxt=N${n}`
  try {
    const r = await xfetch(url, { ms: 12000 })
    if (!r.ok) return null
    const html = await r.text()
    if (!html.includes('Manufacturer Name')) return null

    const typeAircraftRaw = extractDataLabel(html, 'Aircraft Type') || ''
    const typeEngineRaw   = extractDataLabel(html, 'Engine Type') || ''

    const yearRaw = extractDataLabel(html, 'Mfr Year')
    const year = yearRaw && yearRaw !== 'None' ? parseInt(yearRaw) || null : null

    return {
      n_number:       `N${n}`,
      serial:         extractDataLabel(html, 'Serial Number'),
      make:           extractDataLabel(html, 'Manufacturer Name'),
      model:          extractDataLabel(html, 'Model'),
      year,
      engine_type:    normalizeEngineType(typeEngineRaw),
      type_aircraft:  typeAircraftRaw,
      mode_s_hex:     (extractDataLabel(html, 'Mode S Code (Base 16 / Hex)') || '').toLowerCase() || null,
      status:         extractDataLabel(html, 'Status'),
      owner:          extractDataLabel(html, 'Name'),
      source:         'faa_html',
    }
  } catch { return null }
}

// ─── adsbdb lookup ────────────────────────────────────────────────────────────

export async function lookupAdsbdb(nNumber) {
  const n = nNumber.replace(/^N/i, '').toUpperCase()
  try {
    const r = await xfetch(`https://api.adsbdb.com/v0/aircraft/N${n}`, { ms: 8000 })
    if (!r.ok) return null
    const d = await r.json()
    const a = d?.response?.aircraft
    if (!a || typeof a === 'string') return null
    return {
      type_code: a.icao_type || null,
      make:      a.manufacturer || null,
      model:     a.type || null,
      mode_s_hex: a.mode_s?.toLowerCase() || null,
      owner:     a.registered_owner || null,
      photo_url: a.url_photo_thumbnail || null,
    }
  } catch { return null }
}

// ─── Field derivation helpers ─────────────────────────────────────────────────

function deriveCategory(typeAircraft) {
  const t = (typeAircraft || '').toLowerCase()
  if (t.includes('fixed wing')) return 'Airplane'
  if (t.includes('rotorcraft') || t.includes('helicopter')) return 'Rotorcraft'
  if (t.includes('glider')) return 'Glider'
  if (t.includes('balloon')) return 'Balloon'
  if (t.includes('weight-shift')) return 'Weight-Shift-Control'
  if (t.includes('powered parachute')) return 'Powered Parachute'
  return 'Airplane'
}

function deriveAircraftClass(typeAircraft, noEngines) {
  const t = (typeAircraft || '').toLowerCase()
  const multi = (noEngines || 1) > 1 || t.includes('multi')
  const single = t.includes('single') || (noEngines || 1) === 1
  if (t.includes('rotorcraft') || t.includes('helicopter')) return 'RH'
  if (t.includes('glider')) return 'Glider'
  if (multi) return 'AMEL'
  return 'ASEL'
}

function deriveGearType(model, typeCode) {
  const m = (model || '').toUpperCase()
  const tc = (typeCode || '').toUpperCase()
  if (m.includes('RG') || tc.includes('RG')) return 'retractable_tricycle'
  if (/\bBONANZA\b|\bBEECH\s*33\b|\bBEECH\s*35\b|\bBEECH\s*36\b/.test(m)) return 'retractable_tricycle'
  if (/ARROW|CHEROKEE SIX|PA-32RT|PA-24|COMANCHE/.test(m)) return 'retractable_tricycle'
  if (/(T-)?210|T-182|T210|T182/.test(m)) return 'retractable_tricycle'
  return 'fixed_tricycle'
}

function deriveIsComplex(model, gearType) {
  return gearType === 'retractable_tricycle'
}

// ─── Combined lookup ──────────────────────────────────────────────────────────

export async function lookupAircraft(nNumber) {
  const [faa, ads] = await Promise.all([lookupFaaHtml(nNumber), lookupAdsbdb(nNumber)])
  if (!faa && !ads) return null

  const make      = faa?.make  || ads?.make  || null
  const model     = faa?.model || ads?.model || null
  const typeCode  = ads?.type_code || null
  const modeS     = faa?.mode_s_hex || ads?.mode_s_hex || null

  // Look up seat count from local ACFTREF table (keyed by modeS or infer from type)
  let seats = null
  if (faa?.model && make) {
    try {
      const { rows } = await pool.query(
        `SELECT no_seats, no_engines FROM faa_acftref
          WHERE mfr ILIKE $1 AND model ILIKE $2 LIMIT 1`,
        [`%${(make.split(' ')[0])}%`, `%${model}%`]
      )
      if (rows.length) {
        seats = rows[0].no_seats
      }
    } catch { /* table may not exist yet */ }
  }

  const typeAircraft = faa?.type_aircraft || ''
  const gearType = deriveGearType(model, typeCode)

  return {
    n_number:       faa?.n_number || `N${nNumber.replace(/^N/i, '').toUpperCase()}`,
    make:           make,
    model:          model,
    year:           faa?.year || null,
    serial:         faa?.serial || null,
    engine_type:    faa?.engine_type || null,
    type_code:      typeCode,
    category:       deriveCategory(typeAircraft),
    aircraft_class: deriveAircraftClass(typeAircraft, null),
    gear_type:      gearType,
    is_complex:     deriveIsComplex(model, gearType),
    is_high_performance: false,  // HP not in any registry — user must confirm
    seats:          seats,
    mode_s_hex:     modeS,
    status:         faa?.status || null,
    owner:          faa?.owner || ads?.owner || null,
    photo_url:      ads?.photo_url || null,
    // Fields not available from registry (user must fill):
    engine_hp:      null,
    ifr_equipped:   null,
    glass_cockpit:  null,
    notes:          null,
    sources:        [faa ? 'faa_html' : null, ads ? 'adsbdb' : null].filter(Boolean),
  }
}

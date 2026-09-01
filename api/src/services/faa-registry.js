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

// ─── Static POH performance reference ────────────────────────────────────────
// Keyed by ICAO type code. Data from current AFM/POH (public aviation reference).
// mtow_lbs, cruise_ktas, service_ceiling_ft, range_nm, vne_kts, vno_kts,
// vx_kts, vy_kts, vs0_kts, vs1_kts, va_kts, fuel_gal, fuel_burn_gph, engine_hp
export const TYPE_PERFORMANCE = {
  // Cessna singles
  C150: { mtow_lbs:1600, cruise_ktas:107, service_ceiling_ft:14000, range_nm:350,  vne_kts:149, vno_kts:112, vx_kts:61, vy_kts:68, vs0_kts:42, vs1_kts:48, va_kts:96,  fuel_gal:22,  fuel_burn_gph:5.8,  engine_hp:100 },
  C152: { mtow_lbs:1670, cruise_ktas:107, service_ceiling_ft:14700, range_nm:415,  vne_kts:149, vno_kts:112, vx_kts:54, vy_kts:67, vs0_kts:40, vs1_kts:47, va_kts:90,  fuel_gal:24,  fuel_burn_gph:6.1,  engine_hp:110 },
  C172: { mtow_lbs:2550, cruise_ktas:122, service_ceiling_ft:14000, range_nm:640,  vne_kts:163, vno_kts:129, vx_kts:62, vy_kts:74, vs0_kts:40, vs1_kts:48, va_kts:105, fuel_gal:53,  fuel_burn_gph:8.4,  engine_hp:180 },
  C182: { mtow_lbs:3100, cruise_ktas:145, service_ceiling_ft:18100, range_nm:915,  vne_kts:175, vno_kts:140, vx_kts:65, vy_kts:80, vs0_kts:44, vs1_kts:54, va_kts:111, fuel_gal:88,  fuel_burn_gph:12.0, engine_hp:230 },
  C205: { mtow_lbs:3600, cruise_ktas:148, service_ceiling_ft:14800, range_nm:880,  vne_kts:182, vno_kts:145, vx_kts:75, vy_kts:87, vs0_kts:51, vs1_kts:60, va_kts:128, fuel_gal:84,  fuel_burn_gph:13.5, engine_hp:260 },
  C206: { mtow_lbs:3600, cruise_ktas:148, service_ceiling_ft:14800, range_nm:830,  vne_kts:182, vno_kts:145, vx_kts:66, vy_kts:87, vs0_kts:55, vs1_kts:58, va_kts:131, fuel_gal:92,  fuel_burn_gph:14.0, engine_hp:300 },
  C177: { mtow_lbs:2500, cruise_ktas:130, service_ceiling_ft:14600, range_nm:625,  vne_kts:168, vno_kts:135, vx_kts:63, vy_kts:80, vs0_kts:44, vs1_kts:51, va_kts:112, fuel_gal:50,  fuel_burn_gph:9.5,  engine_hp:180 },
  C210: { mtow_lbs:3800, cruise_ktas:175, service_ceiling_ft:17300, range_nm:930,  vne_kts:195, vno_kts:165, vx_kts:78, vy_kts:96, vs0_kts:57, vs1_kts:64, va_kts:140, fuel_gal:90,  fuel_burn_gph:14.5, engine_hp:310 },
  // Cessna twins
  C310: { mtow_lbs:5500, cruise_ktas:195, service_ceiling_ft:20000, range_nm:1000, vne_kts:230, vno_kts:195, vx_kts:90, vy_kts:107,vs0_kts:65, vs1_kts:75, va_kts:165, fuel_gal:142, fuel_burn_gph:22.0, engine_hp:285 },
  // Piper singles
  PA15: { mtow_lbs:1100, cruise_ktas:87,  service_ceiling_ft:12500, range_nm:200,  vne_kts:115, vno_kts:90,  vx_kts:55, vy_kts:63, vs0_kts:38, vs1_kts:45, va_kts:80,  fuel_gal:12,  fuel_burn_gph:4.5,  engine_hp:65  },
  PA28: { mtow_lbs:2325, cruise_ktas:119, service_ceiling_ft:11000, range_nm:465,  vne_kts:154, vno_kts:125, vx_kts:65, vy_kts:79, vs0_kts:44, vs1_kts:50, va_kts:111, fuel_gal:50,  fuel_burn_gph:8.0,  engine_hp:160 },
  P28A: { mtow_lbs:2550, cruise_ktas:128, service_ceiling_ft:14100, range_nm:565,  vne_kts:160, vno_kts:125, vx_kts:68, vy_kts:76, vs0_kts:43, vs1_kts:51, va_kts:111, fuel_gal:50,  fuel_burn_gph:9.0,  engine_hp:180 },
  P28B: { mtow_lbs:2750, cruise_ktas:138, service_ceiling_ft:14100, range_nm:522,  vne_kts:166, vno_kts:129, vx_kts:70, vy_kts:80, vs0_kts:47, vs1_kts:57, va_kts:116, fuel_gal:72,  fuel_burn_gph:10.5, engine_hp:200 },
  P28R: { mtow_lbs:2750, cruise_ktas:149, service_ceiling_ft:16000, range_nm:620,  vne_kts:182, vno_kts:140, vx_kts:74, vy_kts:87, vs0_kts:49, vs1_kts:60, va_kts:129, fuel_gal:72,  fuel_burn_gph:11.0, engine_hp:200 },
  PA24: { mtow_lbs:3100, cruise_ktas:160, service_ceiling_ft:20000, range_nm:1000, vne_kts:190, vno_kts:152, vx_kts:82, vy_kts:97, vs0_kts:55, vs1_kts:65, va_kts:141, fuel_gal:90,  fuel_burn_gph:13.0, engine_hp:260 },
  PA32: { mtow_lbs:3400, cruise_ktas:148, service_ceiling_ft:17500, range_nm:840,  vne_kts:182, vno_kts:145, vx_kts:76, vy_kts:90, vs0_kts:50, vs1_kts:60, va_kts:131, fuel_gal:84,  fuel_burn_gph:13.0, engine_hp:260 },
  PA34: { mtow_lbs:4570, cruise_ktas:178, service_ceiling_ft:25000, range_nm:780,  vne_kts:195, vno_kts:169, vx_kts:85, vy_kts:99, vs0_kts:62, vs1_kts:72, va_kts:140, fuel_gal:123, fuel_burn_gph:22.0, engine_hp:200 },
  PA44: { mtow_lbs:3800, cruise_ktas:168, service_ceiling_ft:16000, range_nm:830,  vne_kts:196, vno_kts:169, vx_kts:82, vy_kts:99, vs0_kts:59, vs1_kts:69, va_kts:137, fuel_gal:108, fuel_burn_gph:20.0, engine_hp:180 },
  // Beechcraft
  BE33: { mtow_lbs:3000, cruise_ktas:174, service_ceiling_ft:16600, range_nm:870,  vne_kts:190, vno_kts:165, vx_kts:77, vy_kts:95, vs0_kts:54, vs1_kts:66, va_kts:144, fuel_gal:74,  fuel_burn_gph:13.5, engine_hp:225 },
  BE35: { mtow_lbs:3400, cruise_ktas:174, service_ceiling_ft:18500, range_nm:1000, vne_kts:190, vno_kts:165, vx_kts:75, vy_kts:95, vs0_kts:52, vs1_kts:64, va_kts:152, fuel_gal:80,  fuel_burn_gph:14.0, engine_hp:285 },
  BE36: { mtow_lbs:3600, cruise_ktas:175, service_ceiling_ft:18500, range_nm:920,  vne_kts:190, vno_kts:165, vx_kts:80, vy_kts:96, vs0_kts:53, vs1_kts:65, va_kts:152, fuel_gal:102, fuel_burn_gph:14.5, engine_hp:300 },
  BE55: { mtow_lbs:5100, cruise_ktas:190, service_ceiling_ft:19000, range_nm:960,  vne_kts:223, vno_kts:190, vx_kts:90, vy_kts:103,vs0_kts:71, vs1_kts:82, va_kts:164, fuel_gal:136, fuel_burn_gph:22.0, engine_hp:260 },
  BE58: { mtow_lbs:5524, cruise_ktas:200, service_ceiling_ft:20000, range_nm:1000, vne_kts:223, vno_kts:190, vx_kts:90, vy_kts:103,vs0_kts:71, vs1_kts:82, va_kts:166, fuel_gal:166, fuel_burn_gph:24.0, engine_hp:300 },
  // Diamond
  DA40: { mtow_lbs:2535, cruise_ktas:147, service_ceiling_ft:16400, range_nm:720,  vne_kts:178, vno_kts:148, vx_kts:67, vy_kts:80, vs0_kts:48, vs1_kts:52, va_kts:122, fuel_gal:37,  fuel_burn_gph:8.5,  engine_hp:180 },
  DA42: { mtow_lbs:3935, cruise_ktas:178, service_ceiling_ft:18000, range_nm:1180, vne_kts:196, vno_kts:178, vx_kts:79, vy_kts:93, vs0_kts:58, vs1_kts:68, va_kts:139, fuel_gal:64,  fuel_burn_gph:12.0, engine_hp:135 },
  DA20: { mtow_lbs:1764, cruise_ktas:130, service_ceiling_ft:13000, range_nm:520,  vne_kts:154, vno_kts:130, vx_kts:59, vy_kts:73, vs0_kts:44, vs1_kts:52, va_kts:110, fuel_gal:24,  fuel_burn_gph:7.0,  engine_hp:125 },
  // Cirrus
  SR20: { mtow_lbs:3150, cruise_ktas:155, service_ceiling_ft:17500, range_nm:800,  vne_kts:178, vno_kts:150, vx_kts:74, vy_kts:88, vs0_kts:52, vs1_kts:61, va_kts:133, fuel_gal:56,  fuel_burn_gph:11.0, engine_hp:200 },
  SR22: { mtow_lbs:3600, cruise_ktas:183, service_ceiling_ft:17500, range_nm:1100, vne_kts:201, vno_kts:178, vx_kts:78, vy_kts:96, vs0_kts:56, vs1_kts:65, va_kts:154, fuel_gal:92,  fuel_burn_gph:14.0, engine_hp:310 },
  // Mooney
  M20P: { mtow_lbs:2900, cruise_ktas:175, service_ceiling_ft:20000, range_nm:1000, vne_kts:195, vno_kts:165, vx_kts:80, vy_kts:95, vs0_kts:55, vs1_kts:64, va_kts:148, fuel_gal:64,  fuel_burn_gph:11.5, engine_hp:200 },
  M20J: { mtow_lbs:2900, cruise_ktas:175, service_ceiling_ft:20000, range_nm:1000, vne_kts:195, vno_kts:165, vx_kts:80, vy_kts:95, vs0_kts:55, vs1_kts:64, va_kts:148, fuel_gal:64,  fuel_burn_gph:11.5, engine_hp:200 },
  // Grumman
  AA1:  { mtow_lbs:1600, cruise_ktas:122, service_ceiling_ft:12650, range_nm:450,  vne_kts:153, vno_kts:125, vx_kts:60, vy_kts:72, vs0_kts:47, vs1_kts:55, va_kts:107, fuel_gal:22,  fuel_burn_gph:7.5,  engine_hp:108 },
  AA5:  { mtow_lbs:2200, cruise_ktas:145, service_ceiling_ft:14500, range_nm:700,  vne_kts:182, vno_kts:148, vx_kts:68, vy_kts:84, vs0_kts:50, vs1_kts:56, va_kts:119, fuel_gal:38,  fuel_burn_gph:9.0,  engine_hp:150 },
  // Socata
  TB20: { mtow_lbs:3086, cruise_ktas:165, service_ceiling_ft:20000, range_nm:960,  vne_kts:185, vno_kts:155, vx_kts:75, vy_kts:90, vs0_kts:55, vs1_kts:64, va_kts:140, fuel_gal:80,  fuel_burn_gph:12.0, engine_hp:250 },
  // Rotorcraft
  R22:  { mtow_lbs:1370, cruise_ktas:96,  service_ceiling_ft:14000, range_nm:215,  vne_kts:102, vno_kts:97,  vx_kts:null,vy_kts:null,vs0_kts:null,vs1_kts:null,va_kts:null,fuel_gal:19,  fuel_burn_gph:8.0,  engine_hp:131 },
  R44:  { mtow_lbs:2500, cruise_ktas:113, service_ceiling_ft:14000, range_nm:300,  vne_kts:130, vno_kts:110, vx_kts:null,vy_kts:null,vs0_kts:null,vs1_kts:null,va_kts:null,fuel_gal:29,  fuel_burn_gph:11.0, engine_hp:245 },
}

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

  // Look up seat count from local ACFTREF table
  let seats = null
  let acftrefData = null
  if (faa?.model && make) {
    try {
      const { rows } = await pool.query(
        `SELECT no_seats, no_engines, speed_kt FROM faa_acftref
          WHERE mfr ILIKE $1 AND model ILIKE $2 LIMIT 1`,
        [`%${(make.split(' ')[0])}%`, `%${model}%`]
      )
      if (rows.length) {
        seats = rows[0].no_seats
        acftrefData = rows[0]
      }
    } catch { /* table may not exist yet */ }
  }

  const typeAircraft = faa?.type_aircraft || ''
  const gearType = deriveGearType(model, typeCode)

  // Performance reference from static POH table
  const perf = typeCode ? TYPE_PERFORMANCE[typeCode.toUpperCase()] || null : null
  // Infer high-performance from HP or cruise speed
  const hp = perf?.engine_hp || null
  const isHighPerf = hp != null ? hp > 200 : false

  return {
    n_number:       faa?.n_number || `N${nNumber.replace(/^N/i, '').toUpperCase()}`,
    make,
    model,
    year:           faa?.year || null,
    serial:         faa?.serial || null,
    engine_type:    faa?.engine_type || null,
    engine_hp:      hp,
    type_code:      typeCode,
    category:       deriveCategory(typeAircraft),
    aircraft_class: deriveAircraftClass(typeAircraft, acftrefData?.no_engines || null),
    gear_type:      gearType,
    is_complex:     deriveIsComplex(model, gearType),
    is_high_performance: isHighPerf,
    seats,
    mode_s_hex:     modeS,
    status:         faa?.status || null,
    owner:          faa?.owner || ads?.owner || null,
    photo_url:      ads?.photo_url || null,
    photo_thumbnail: ads?.photo_url
      ? ads.photo_url.replace('image.airport-data.com/aircraft/', 'airport-data.com/images/aircraft/thumbnails/').replace(/(\.\w+)$/, (_, ext) => {
          // airport-data thumbnail path needs folder restructuring — use adsbdb thumbnail
          return ext
        })
      : null,
    // Performance data from static POH reference
    performance:    perf ? {
      mtow_lbs:           perf.mtow_lbs,
      cruise_ktas:        perf.cruise_ktas,
      service_ceiling_ft: perf.service_ceiling_ft,
      range_nm:           perf.range_nm,
      fuel_gal:           perf.fuel_gal,
      fuel_burn_gph:      perf.fuel_burn_gph,
      vne_kts:            perf.vne_kts,
      vno_kts:            perf.vno_kts,
      vx_kts:             perf.vx_kts,
      vy_kts:             perf.vy_kts,
      vs0_kts:            perf.vs0_kts,
      vs1_kts:            perf.vs1_kts,
      va_kts:             perf.va_kts,
    } : null,
    // Fields not available from registry (user must fill):
    ifr_equipped:   null,
    glass_cockpit:  null,
    notes:          null,
    sources:        [faa ? 'faa_html' : null, ads ? 'adsbdb' : null].filter(Boolean),
  }
}

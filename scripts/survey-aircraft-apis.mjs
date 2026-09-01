#!/usr/bin/env node
/**
 * Aircraft data source survey.
 * Tests multiple free public sources against known aircraft and
 * scores them on completeness, accuracy, and reliability.
 *
 * Usage: node scripts/survey-aircraft-apis.mjs
 */

const TEST_AIRCRAFT = [
  { n: 'N172SP', expect: { make: 'CESSNA', model: '172S' } },
  { n: 'N5342P', expect: { make: 'PIPER', model: 'PA-24' } },
  { n: 'N61686', expect: { make: 'CESSNA', model: '172' } },
  { n: 'N733YV', expect: { make: 'CESSNA', model: '172S' } },
]

const TIMEOUT_MS = 8000
function xfetch(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, {
    signal: ctrl.signal,
    headers: { 'User-Agent': 'personal-dashboard-survey/1.0', Accept: 'application/json' },
  }).finally(() => clearTimeout(tid))
}

// ─── Source definitions ───────────────────────────────────────────────────────
const SOURCES = {

  // 1. AviationAPI.com — free FAA N-number wrapper
  aviationapi: {
    name: 'AviationAPI.com',
    url: (n) => `https://api.aviationapi.com/v1/aircraft?nnumber=${encodeURIComponent(n)}`,
    extract: async (n) => {
      const r = await xfetch(`https://api.aviationapi.com/v1/aircraft?nnumber=${encodeURIComponent(n)}`)
      if (!r.ok) return null
      const d = await r.json()
      const keys = Object.keys(d)
      if (!keys.length) return null
      const a = d[keys[0]]
      return {
        raw: a,
        make: a.manufacturer?.trim() || null,
        model: a.model?.trim() || null,
        year: a.year_mfr ? parseInt(a.year_mfr) : null,
        serial: a.serial_number || null,
        engine_count: null,
        engine_type_code: a.type_engine || null,    // FAA numeric code
        engine_type: decodeEngineType(a.type_engine),
        status: a.status_code || null,
        owner: a.name || null,
        type_aircraft: decodeAircraftType(a.type_aircraft),
        mode_s_hex: a.mode_s_code_hex || null,
        // Not provided by source:
        hp: null, seats: null, ifr: null, complex: null, high_perf: null, glass: null,
        category: null, aircraft_class: null, gear_type: null, type_code: null,
      }
    },
  },

  // 2. FAA Registry direct (releasable data download — subset via N-number lookup)
  faa_direct: {
    name: 'FAA Registry (direct HTML scrape)',
    extract: async (n) => {
      const nClean = n.replace(/^N/i, '')
      const url = `https://registry.faa.gov/aircraftinquiry/Search/NNumberResult?nNumberTxt=${encodeURIComponent(n)}`
      const r = await xfetch(url, 10000)
      if (!r.ok) return null
      const html = await r.text()
      // Extract key table fields with simple regex (structure is stable)
      const get = (label) => {
        const re = new RegExp(`${label}[^<]*</th>\\s*<td[^>]*>([^<]+)`, 'i')
        const m = html.match(re)
        return m ? m[1].trim() : null
      }
      return {
        raw: { html_snippet: html.slice(0, 200) },
        make: get('Manufacturer Name'),
        model: get('Model'),
        year: get('Year Manufacturer') ? parseInt(get('Year Manufacturer')) : null,
        serial: get('Serial Number'),
        status: get('Certificate Issue Date') ? 'active' : null,
        owner: get('Name'),
        // FAA registry page doesn't expose all fields cleanly
        hp: null, seats: null, ifr: null, complex: null, high_perf: null, glass: null,
        category: null, aircraft_class: null, gear_type: null, type_code: null,
        engine_type: null, mode_s_hex: null,
      }
    },
  },

  // 3. OpenSky Network — ICAO hex metadata
  opensky: {
    name: 'OpenSky Network (ICAO hex metadata)',
    extract: async (n) => {
      // First get hex from AviationAPI, then look up in OpenSky
      try {
        const r1 = await xfetch(`https://api.aviationapi.com/v1/aircraft?nnumber=${encodeURIComponent(n)}`)
        if (!r1.ok) return null
        const d1 = await r1.json()
        const keys = Object.keys(d1)
        if (!keys.length) return null
        const hex = d1[keys[0]]?.mode_s_code_hex?.toLowerCase()
        if (!hex) return null

        const r2 = await xfetch(`https://opensky-network.org/api/metadata/aircraft/icao/${hex}`)
        if (!r2.ok) return null
        const a = await r2.json()
        return {
          raw: a,
          make: a.manufacturerName || null,
          model: a.model || null,
          year: null,
          serial: a.serialNumber || null,
          type_code: a.typecode || null,
          category: a.categoryDescription || null,
          owner: a.owner || null,
          // Not provided:
          hp: null, seats: null, ifr: null, complex: null, high_perf: null, glass: null,
          aircraft_class: null, gear_type: null, engine_type: null, mode_s_hex: hex,
        }
      } catch { return null }
    },
  },

  // 4. airplanes.live — community ADS-B database
  airplanes_live: {
    name: 'airplanes.live (ADS-B community)',
    extract: async (n) => {
      try {
        const r = await xfetch(`https://api.airplanes.live/v2/reg/${encodeURIComponent(n)}`)
        if (!r.ok) return null
        const d = await r.json()
        const a = d?.ac?.[0] || d
        if (!a) return null
        return {
          raw: a,
          make: a.ownOp || null,        // often operator not manufacturer
          model: a.t || null,            // type code
          type_code: a.t || null,
          category: a.category || null,
          mode_s_hex: a.hex || null,
          // Not registration-level detail:
          year: null, serial: null, hp: null, seats: null,
          ifr: null, complex: null, high_perf: null, glass: null,
          aircraft_class: null, gear_type: null, engine_type: null,
        }
      } catch { return null }
    },
  },

  // 5. HexDB.io — maps ICAO hex to aircraft type info
  hexdb: {
    name: 'HexDB.io',
    extract: async (n) => {
      try {
        // Need hex first
        const r1 = await xfetch(`https://api.aviationapi.com/v1/aircraft?nnumber=${encodeURIComponent(n)}`)
        if (!r1.ok) return null
        const d1 = await r1.json()
        const keys = Object.keys(d1)
        if (!keys.length) return null
        const hex = d1[keys[0]]?.mode_s_code_hex?.toLowerCase()
        if (!hex) return null

        const r = await xfetch(`https://hexdb.io/api/v1/aircraft/${hex}`)
        if (!r.ok) return null
        const a = await r.json()
        return {
          raw: a,
          make: a.Manufacturer || null,
          model: a.Type || null,
          type_code: a.ICAOTypeCode || null,
          owner: a.RegisteredOwners || null,
          mode_s_hex: hex,
          year: null, serial: null, hp: null, seats: null,
          ifr: null, complex: null, high_perf: null, glass: null,
          category: null, aircraft_class: null, gear_type: null, engine_type: null,
        }
      } catch { return null }
    },
  },

  // 6. adsbdb.com — ADS-B database
  adsbdb: {
    name: 'adsbdb.com',
    extract: async (n) => {
      try {
        const r = await xfetch(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(n)}`)
        if (!r.ok) return null
        const d = await r.json()
        const a = d?.response?.aircraft
        if (!a) return null
        return {
          raw: a,
          make: a.manufacturer || null,
          model: a.aircraft_type || null,
          type_code: a.aircraft_type || null,
          mode_s_hex: a.mode_s || null,
          owner: a.registered_owner || null,
          year: null, serial: null, hp: null, seats: null,
          ifr: null, complex: null, high_perf: null, glass: null,
          category: null, aircraft_class: null, gear_type: null, engine_type: null,
        }
      } catch { return null }
    },
  },
}

// ─── FAA code lookup tables ───────────────────────────────────────────────────
function decodeEngineType(code) {
  const map = { '0':'None','1':'Reciprocating','2':'Turbo-prop','3':'Turbo-shaft',
    '4':'Turbo-jet','5':'Turbo-fan','6':'Ramjet','7':'2 Cycle','8':'4 Cycle',
    '9':'Unknown','10':'Electric','11':'Rotary' }
  return map[String(code)] || null
}
function decodeAircraftType(code) {
  const map = { '1':'Glider','2':'Balloon','3':'Blimp/Dirigible','4':'Fixed Wing Single Engine',
    '5':'Fixed Wing Multi Engine','6':'Rotorcraft','7':'Weight-Shift-Control',
    '8':'Powered Parachute','9':'Gyroplane','H':'Hybrid Lift','O':'Other' }
  return map[String(code)] || null
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
const FIELDS = ['make','model','year','serial','type_code','category','aircraft_class',
  'gear_type','engine_type','hp','seats','ifr','complex','high_perf','glass','mode_s_hex','owner']

function score(result) {
  if (!result) return 0
  return FIELDS.filter(f => result[f] != null).length
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log('\n=== Aircraft Data Source Survey ===\n')
console.log(`Testing ${TEST_AIRCRAFT.length} aircraft × ${Object.keys(SOURCES).length} sources\n`)

const results = {}
for (const [srcKey, src] of Object.entries(SOURCES)) {
  results[srcKey] = { name: src.name, aircraft: {}, totalScore: 0, errors: 0, latencies: [] }
}

for (const { n, expect } of TEST_AIRCRAFT) {
  console.log(`\n── ${n} (expected: ${expect.make} ${expect.model}) ──`)

  for (const [srcKey, src] of Object.entries(SOURCES)) {
    const t0 = Date.now()
    try {
      const data = await src.extract(n)
      const latency = Date.now() - t0
      results[srcKey].latencies.push(latency)
      const s = score(data)
      results[srcKey].totalScore += s
      results[srcKey].aircraft[n] = data

      const makeOk = data?.make?.toUpperCase().includes(expect.make.split(' ')[0]) ? '✓' : '✗'
      const modelOk = data?.model?.toUpperCase().includes(expect.model.split('-')[0]) ? '✓' : '✗'
      console.log(`  ${src.name.padEnd(32)} ${latency}ms  score:${s}/${FIELDS.length}  make:${makeOk}  model:${modelOk}`)
      if (data) {
        const filled = FIELDS.filter(f => data[f] != null)
        console.log(`    filled: ${filled.join(', ')}`)
      } else {
        console.log(`    → returned null`)
      }
    } catch (e) {
      results[srcKey].errors++
      results[srcKey].latencies.push(Date.now() - t0)
      console.log(`  ${src.name.padEnd(32)} ERROR: ${e.message}`)
    }
  }
}

// ─── Summary table ────────────────────────────────────────────────────────────
console.log('\n\n=== SUMMARY ===\n')
console.log('Source'.padEnd(34) + 'Avg Score'.padEnd(12) + 'Avg Latency'.padEnd(14) + 'Errors'.padEnd(8) + 'Needs Auth')
console.log('─'.repeat(78))

const ranked = Object.entries(results).map(([k, v]) => {
  const avg = v.totalScore / TEST_AIRCRAFT.length
  const avgLat = v.latencies.reduce((a,b)=>a+b,0) / v.latencies.length
  return { key: k, name: v.name, avg, avgLat, errors: v.errors }
}).sort((a,b) => b.avg - a.avg)

for (const r of ranked) {
  console.log(
    r.name.padEnd(34) +
    `${r.avg.toFixed(1)}/${FIELDS.length}`.padEnd(12) +
    `${Math.round(r.avgLat)}ms`.padEnd(14) +
    `${r.errors}/${TEST_AIRCRAFT.length}`.padEnd(8) +
    'No'
  )
}

console.log('\n=== FIELD COVERAGE (across all aircraft) ===\n')
for (const [srcKey, v] of Object.entries(results)) {
  const fieldCounts = {}
  for (const f of FIELDS) {
    fieldCounts[f] = Object.values(v.aircraft).filter(a => a?.[f] != null).length
  }
  console.log(`\n${v.name}:`)
  for (const [f, count] of Object.entries(fieldCounts)) {
    if (count > 0) console.log(`  ${f.padEnd(16)} ${count}/${TEST_AIRCRAFT.length}`)
  }
}

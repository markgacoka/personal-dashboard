// Flight planner adapters: FB winds aloft and NAS status parsing.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseFB, decodeFbGroup } from '../services/awc.js'
import { parseNasStatus } from '../services/faaStatus.js'
import { sunEvent } from '../services/twilight.js'

const FB = `(Extracted from FBUS31 KWNO 030801)
FD1US1
DATA BASED ON 030600Z
VALID 031200Z   FOR USE 0800-1500Z. TEMPS NEG ABV 24000

FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
BIH      9900    2014+08 2320+05 2533-12 2640-23 257239 751045 762356
SFO 1916 2222+07 2134+04 2142+00 2257-12 2370-25 248341 740249 750755
IMB              2015+02 2222-03 2233-17 2136-28 193644 225152 214460
`

describe('FB winds aloft', () => {
  const [p] = parseFB(FB)
  test('header: basis, validity and levels', () => {
    assert.equal(p.basedOn, '030600'); assert.equal(p.valid, '031200'); assert.deepEqual(p.forUse, ['0800', '1500'])
    assert.equal(p.levels.length, 9)
  })
  test('groups keep their column even when lower levels are blank', () => {
    assert.equal(p.stations.BIH[3000], undefined)
    assert.deepEqual(p.stations.BIH[6000], { dir: null, spd: 0, temp: null, lv: true })
    assert.equal(p.stations.IMB[6000], undefined)
    assert.deepEqual(p.stations.IMB[9000], { dir: 200, spd: 15, temp: 2 })
  })
  test('3,000 ft has no temperature; above 24,000 ft temps are negative', () => {
    assert.deepEqual(p.stations.SFO[3000], { dir: 190, spd: 16, temp: null })
    assert.deepEqual(p.stations.SFO[30000], { dir: 240, spd: 83, temp: -41 })
  })
  test('direction codes above 36 add 100 kt', () => {
    assert.deepEqual(decodeFbGroup('740249', 34000), { dir: 240, spd: 102, temp: -49 })
    assert.deepEqual(p.stations.SFO[39000], { dir: 250, spd: 107, temp: -55 })
  })
})

test('NAS status: ground delay, departure delay and closures by airport', () => {
  const xml = `<AIRPORT_STATUS_INFORMATION><Update_Time>Wed Nov 4 04:14:16 2026 GMT</Update_Time>
  <Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>SFO</ARPT><Reason>wind</Reason><Avg>1 hour</Avg><Max>2 hours</Max></Ground_Delay></Ground_Delay_List></Delay_type>
  <Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List><Delay><ARPT>FLL</ARPT><Reason>WX</Reason><Arrival_Departure Type="Departure"><Min>46 minutes</Min><Max>1 hour</Max><Trend>Increasing</Trend></Arrival_Departure></Delay></Arrival_Departure_Delay_List></Delay_type>
  <Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>SNA</ARPT><Reason>!SNA 11/003 AD AP CLSD</Reason><Start>Nov 03 at 07:30 UTC.</Start><Reopen>Nov 08 at 14:15 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>`
  const s = parseNasStatus(xml)
  assert.equal(s.updated, 'Wed Nov 4 04:14:16 2026 GMT')
  assert.deepEqual(s.items.map(i => [i.airport, i.kind]), [['SFO', 'Ground delay'], ['FLL', 'Departure delay'], ['SNA', 'Closure']])
  assert.match(s.items[1].detail, /46 minutes–1 hour, increasing/)
})

test('sunrise and sunset at Reid-Hillview (NOAA, within 2 minutes)', () => {
  const s = sunEvent('2026-06-21', 37.333, -121.82)
  // NOAA solar calculator: 12:48 UTC sunrise, 03:32 UTC (next day) sunset.
  assert.ok(Math.abs(s.rise - Date.parse('2026-06-21T12:48:00Z')) < 2 * 60_000, s.rise.toISOString())
  assert.ok(Math.abs(s.set - Date.parse('2026-06-22T03:32:00Z')) < 3 * 60_000, s.set.toISOString())
})

test('Leidos briefing email names its route (quoted-printable soft breaks)', async () => {
  const { simpleRoute } = await import('../services/briefingText.js')
  assert.deepEqual(simpleRoute('Your Leidos Flight Service Route Standard Briefing Email from KRHV to KCVH is attached'), ['KRHV', 'KCVH'])
  assert.deepEqual(simpleRoute('Briefing Email fr=\r\nom KRHV to KSNS is'), ['KRHV', 'KSNS'])
  assert.deepEqual(simpleRoute('nothing here'), [])
})

describe('route tokens (SkyVector / ForeFlight)', async () => {
  const { parseCoord, classify, project } = await import('../services/waypoints.js')
  test('coordinate formats', () => {
    assert.deepEqual(parseCoord('3720N12150W'), { lat: 37.333333, lon: -121.833333 })
    assert.deepEqual(parseCoord('372030N1215015W'), { lat: 37.341667, lon: -121.8375 })
    assert.deepEqual(parseCoord('37.34/-121.83'), { lat: 37.34, lon: -121.83 })
    assert.deepEqual(parseCoord('37.34,-121.83'), { lat: 37.34, lon: -121.83 })
    assert.deepEqual(parseCoord('N37.34/W121.83'), { lat: 37.34, lon: -121.83 })
    assert.deepEqual(parseCoord('37N122W'), { lat: 37, lon: -122 })
    assert.equal(parseCoord('KRHV'), null)
    assert.equal(parseCoord('95.1/10'), null)
  })
  test('idents are classified by shape', () => {
    assert.equal(classify('KRHV').kind, 'airport')
    assert.equal(classify('E16').kind, 'airport')
    assert.equal(classify('SJC').kind, 'navaid-or-airport')
    assert.equal(classify('VPCOY').kind, 'fix')
    assert.deepEqual(classify('SJC090020'), { token: 'SJC090020', overfly: false, kind: 'radial', navaid: 'SJC', radial: 90, dist: 20 })
    assert.equal(classify('OSI/270/15').dist, 15)
    assert.equal(classify('KCVH*').overfly, true)
  })
  test('radial/distance projection', () => {
    const p = project({ lat: 37, lon: -122 }, 90, 60)
    assert.ok(Math.abs(p.lat - 36.99) < 0.02 && Math.abs(p.lon - -120.75) < 0.02, JSON.stringify(p))
  })
})

describe('POH catalog matching', async () => {
  const { matchPoh } = await import('../services/pohCatalog.js')
  test('exact variant and years', () => {
    const m = matchPoh({ make: 'CESSNA', model: '172P', year: 1982 })
    assert.equal(m.entry.key, 'C172P-1982'); assert.equal(m.exact, true); assert.equal(m.sameYears, true)
  })
  test('same family falls back to the nearest variant', () => {
    const m = matchPoh({ make: 'CESSNA', model: '172N', year: 1978 })
    assert.equal(m.entry.family, '172'); assert.equal(m.exact, false)
    assert.equal(matchPoh({ make: 'CESSNA', model: '172S', year: 2005 }).entry.key, 'C172S-NAVIII')
    assert.equal(m.entry.key, 'C172P-1982')
    assert.equal(matchPoh({ make: 'CESSNA', model: '172L', year: 1972 }).entry.key, 'C172M-1976')
  })
  test('172M gets its own POH', () => {
    const m = matchPoh({ make: 'CESSNA', model: '172M', year: 1975 })
    assert.equal(m.entry.key, 'C172M-1976'); assert.equal(m.exact, true); assert.equal(m.sameYears, true)
  })
  test('no match for other types', () => {
    assert.equal(matchPoh({ make: 'PIPER', model: 'PA-28-161', year: 1979 }), null)
  })
})

describe('NASR navaids and fixes', async () => {
  const { buildPoints } = await import('../services/nasr.js')
  test('VOR with variation, VFR waypoint flagged', () => {
    const pts = buildPoints({
      NAV_BASE: [{ NAV_ID: 'SJC', NAV_TYPE: 'VOR/DME', NAME: 'SAN JOSE', CITY: 'SAN JOSE', STATE_CODE: 'CA', NAV_STATUS: 'OPERATIONAL IFR', LAT_DECIMAL: '37.37', LONG_DECIMAL: '-121.94', ELEV: '58', MAG_VARN: '17', MAG_VARN_HEMIS: 'E', FREQ: '114.1' }],
      FIX_BASE: [{ FIX_ID: 'VPCOY', STATE_CODE: 'CA', LAT_DECIMAL: '37.54', LONG_DECIMAL: '-122.08', FIX_USE_CODE: 'VFR  ' }],
    })
    assert.equal(pts[0].magVar, 17); assert.equal(pts[0].freq, '114.1')
    assert.equal(pts[1].vfr, true); assert.equal(pts[1].type, 'VFR-WP')
  })
})

import { routeGrid, toLevels, toProducts } from '../services/modelWinds.js'
describe('model winds aloft', () => {
  test('interpolates pressure levels to FB altitudes by height, wrapping direction through north', () => {
    const w = toLevels([{ zFt: 1000, dir: 350, spd: 10, temp: 14 }, { zFt: 5000, dir: 10, spd: 10, temp: 6 }], [3000])
    assert.equal(w[3000].dir, 360); assert.equal(w[3000].spd, 10); assert.equal(w[3000].temp, 10)
  })
  test('one FB-shaped product per 3-hour window', () => {
    const hourly = { time: ['2026-11-05T06:00', '2026-11-05T07:00', '2026-11-05T08:00', '2026-11-05T09:00', '2026-11-05T10:00'] }
    for (const p of [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600]) {
      const z = { 1000: 100, 975: 330, 950: 550, 925: 780, 900: 1000, 850: 1460, 800: 1950, 750: 2460, 700: 3010, 650: 3590, 600: 4200 }[p]
      Object.assign(hourly, { [`geopotential_height_${p}hPa`]: Array(5).fill(z), [`wind_direction_${p}hPa`]: Array(5).fill(270), [`wind_speed_${p}hPa`]: Array(5).fill(20), [`temperature_${p}hPa`]: Array(5).fill(5) })
    }
    const prods = toProducts([{ latitude: 37, longitude: -121.7, hourly }], Date.parse('2026-11-05T06:30:00Z'))
    assert.equal(prods.length, 2)
    assert.deepEqual(prods[0].forUse, ['0600', '0900']); assert.equal(prods[0].valid, '050700')
    assert.deepEqual(prods[0].stations.M1.winds[3000], { dir: 270, spd: 20, temp: 5 })
  })
})

describe('model winds grid over the route', () => {
  test('covers the box with a margin, at most 12 points', () => {
    const g = routeGrid({ south: 37.0, west: -122.0, north: 37.4, east: -121.6 })
    assert.ok(g.length >= 4 && g.length <= 12)
    assert.ok(Math.min(...g.map(p => p.lat)) <= 36.7 && Math.max(...g.map(p => p.lat)) >= 37.7)
    assert.ok(Math.min(...g.map(p => p.lon)) <= -122.3 && Math.max(...g.map(p => p.lon)) >= -121.3)
    assert.equal(new Set(g.map(p => p.id)).size, g.length)
  })
  test('a long route spreads its points instead of exceeding the cap', () => {
    const g = routeGrid({ south: 33.9, west: -122.4, north: 37.6, east: -118.2 })
    assert.ok(g.length <= 12)
  })
})

describe('FB stations for model winds', () => {
  test('keeps the station ids and coordinates it was sampled for', () => {
    const hourly = { time: ['2026-11-05T06:00', '2026-11-05T07:00', '2026-11-05T08:00'] }
    for (const p of [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600]) Object.assign(hourly, { [`geopotential_height_${p}hPa`]: [0, (1100 - p) * 30, 0], [`wind_direction_${p}hPa`]: [0, 250, 0], [`wind_speed_${p}hPa`]: [0, 15, 0], [`temperature_${p}hPa`]: [0, 0, 0] })
    const prods = toProducts([{ latitude: 37.6, longitude: -122.4, hourly }], Date.parse('2026-11-05T06:30:00Z'), [{ id: 'SFO', lat: 37.62, lon: -122.37 }])
    assert.deepEqual(Object.keys(prods[0].stations), ['SFO'])
    assert.equal(prods[0].stations.SFO.lat, 37.62)
    assert.deepEqual(Object.keys(prods[0].stations.SFO.winds).map(Number), [3000, 6000, 9000, 12000])
  })
})

describe('POH page map from headings', async () => {
  const { pageMapFromText } = await import('../services/pohPages.js')
  const pages = [
    'TABLE OF CONTENTS\nLIMITATIONS . . . . . . . . 2\nPERFORMANCE . . . . . . . 5',
    'SECTION 2 LIMITATIONS\nAIRSPEED LIMITATIONS . . . . 2-4\nWEIGHT LIMITS 2-7',
    'MODEL 172P              SECTION 2 LIMITATIONS\n         AIRSPEED LIMITATIONS\nThe airspeeds listed in the Airspeed Limitations chart',
    'Refer to the takeoff distance chart (Figure 5-5) for the sample problem.',
    "'f'             TAKEOFF DISTANCE\nCONDITIONS: Flaps 10°\nFigure 5-5. Ta.keoff Distance (Sheet 1 of 2)",
    'TAKEOFF DISTANCE\nFigure 5-5. Takeoff Distance (Sheet 2 of 2)',
    '2.11 WEIGHT LIMITS\n(a) Maximum Weight 2440 LBS',
  ]
  test('captions and standalone headings, not contents lines or running text', () => {
    const m = pageMapFromText(pages)
    assert.equal(m.airspeed, 3) // not the contents line on page 2, not the sentence on page 3
    assert.equal(m.takeoff, 5) // sheet 1, OCR's "Ta.keoff", not the reference on page 4
    assert.equal(m.weights, 7) // Piper-style numbered heading
    assert.equal(m.limits, 2)
    assert.equal(m.landing, undefined)
  })
})

describe('POH library search', async () => {
  const { slugHasModel, makeSlugs, modelPaths, pohListings, rankListings } = await import('../services/pohFinder.js')
  test('model in a slug as whole tokens', () => {
    assert.ok(slugHasModel('cessna-172m-skyhawk', '172M'))
    assert.ok(!slugHasModel('cessna-172-skyhawk', '172M'))
    assert.ok(slugHasModel('piper-pa-28-161', 'PA-28-161'))
    assert.ok(!slugHasModel('piper-pa-28-1610', 'PA-28-161'))
  })
  test('make and model pages', () => {
    assert.deepEqual(makeSlugs('<a href="/aircraft/manuals/beechcraft"></a><a href="/aircraft/manuals/cessna"></a>', 'BEECH AIRCRAFT CORP'), ['beechcraft'])
    const make = ['cessna-1/cessna-172m-426', 'cessna-1/cessna-172m-skyhawk-333', 'cessna-1/cessna-172-skyhawk-18', 'piper-12/piper-pa-28-warrior-ii-142', 'piper-12/piper-pa-28-archer-ii-145']
      .map(p => `<a href="/aircraft/manuals/${p}">`).join('')
    assert.deepEqual(modelPaths(make, '172M'), ['/aircraft/manuals/cessna-1/cessna-172m-426', '/aircraft/manuals/cessna-1/cessna-172m-skyhawk-333'])
    assert.deepEqual(modelPaths(make, 'PA-28-161'), ['/aircraft/manuals/piper-12/piper-pa-28-warrior-ii-142'])
  })
  test('listings parsed and ranked: this model, near the year, a whole book', () => {
    const html = '<div><span>1976</span><span>PDF · 144 pages · 16 MB</span><span>of</span><span>PILOT&#x27;S OPERATING HANDBOOK CESSNA MODEL 172M</span><a href="https://cdn.sprinkle.com/library/pdfs/aaaa-1.pdf">x</a></div>'
      + '<div><span>PDF · 12 pages · 1 MB</span><span>of</span><span>172M supplement</span><a href="https://cdn.sprinkle.com/library/pdfs/bbbb-2.pdf">x</a></div>'
    const l = pohListings(html)
    assert.deepEqual(l[0], { url: 'https://cdn.sprinkle.com/library/pdfs/aaaa-1.pdf', year: 1976, pages: 144, mb: 16, title: "PILOT'S OPERATING HANDBOOK CESSNA MODEL 172M" })
    assert.equal(rankListings(l, '172M', 1975)[0].url, l[0].url)
  })
})

describe('POH performance tables from the text layer', async () => {
  const { readFileSync } = await import('node:fs')
  const { tablesFromText, corrections, cruiseTable, distanceTables } = await import('../services/pohTables.js')
  const page = n => readFileSync(new URL(`./fixtures/poh172m-p${n}.txt`, import.meta.url), 'utf8').replace(/\f$/, '')
  // 1976 Cessna 172M (OCR'd scan): pages 72–73 takeoff, 75 climb, 76 cruise, 81 landing.
  const pages = Array(90).fill('')
  for (const n of [72, 73, 75, 76, 81]) pages[n - 1] = page(n)
  const t = tablesFromText(pages, { takeoff: 72, climb: 75, cruise: 76, landing: 81 })

  test('takeoff: all three weight sheets, with speeds and the deleted cells', () => {
    assert.deepEqual(t.takeoff.map(x => x.weight), [2300, 2100, 1900])
    assert.deepEqual(t.takeoff[0].speeds, { liftoff: 52, at50: 59 })
    assert.deepEqual(t.takeoff[0].temps, [0, 10, 20, 30, 40])
    assert.deepEqual(t.takeoff[0].rows[0], [[775, 1380], [835, 1475], [895, 1575], [960, 1685], [1030, 1795]])
    assert.deepEqual(t.takeoff[0].rows[8], [[1665, 3065], [1800, 3320], null, null, null])
    assert.deepEqual(t.takeoff[2].rows[4], [[725, 1290], [775, 1380], [835, 1475], [895, 1575], [955, 1680]])
  })
  test('landing: rows OCR split across lines are joined by column', () => {
    const l = t.landing[0]
    assert.equal(l.weight, 2300); assert.equal(l.speeds.at50, 60)
    assert.deepEqual(l.pa, [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000])
    assert.deepEqual(l.rows[6], [[615, 1415], [640, 1455], [660, 1490], [685, 1535], [705, 1570]])
    assert.deepEqual(l.rows[7], [[640, 1455], [660, 1495], [685, 1535], [710, 1575], [730, 1615]])
  })
  test('climb from sea level and the start/taxi allowance', () => {
    assert.equal(t.climb.length, 13)
    assert.deepEqual(t.climb[4], { pa: 4000, temp: 7, kias: 74, fpm: 480, min: 7, gal: 1.5, nm: 9 })
    assert.equal(t.climbStartFuelGal, 1.1)
  })
  test('cruise: misread cells become blanks, the rest is kept', () => {
    const r = t.cruise.find(x => x.pa === 10000 && x.rpm === 2400)
    assert.deepEqual(r.cols, [[57, 104, 6.6], [54, 102, 6.4], null]) // "5'" in the book scan
    assert.deepEqual(t.cruise.find(x => x.pa === 8000 && x.rpm === 2600).cols[1], [68, 115, 7.5]) // "7. 5"
    assert.equal(t.cruise.length, 34)
  })
  test('notes and figure captions', () => {
    assert.deepEqual(t.takeoffNotes, { headwindPer9kt: 0.1, tailwindPer2kt: 0.1, grassGroundRoll: 0.15 })
    assert.equal(t.landingNotes.grassGroundRoll, 0.45)
    assert.equal(t.figures.takeoff, 'Figure 5-4, Takeoff Distance'); assert.equal(t.figures.landing, 'Figure 5-10, Landing Distance')
  })
  test('a misread out of line with its row is rejected', () => {
    const fmt = (lead, pa, cells) => `${lead.padEnd(12)}${pa.padStart(6)}${cells.map(c => String(c).padStart(7)).join('')}`
    const rows = [fmt('2400 51 56', 'S.L.', [795, 1460, 860, 1570, 925, 1685, 995, 1810, 1065, 1945]), fmt('', '1000', [875, 1605, 940, 1725, 1015, 1860, 1090, 2000, 1170, 2155]),
      fmt('', '2000', [960, 1770, 1035, 1910, 1115, 2060, 1200, 2220, 1290, 2395]), fmt('', '3000', [1055, 1960, 1140, 2120, 1230, 2295, 1325, 2480, 1425, 2685]),
      fmt('', '4000', [1165, 2185, 1260, 2365, 1855, 2570, 1465, 2790, 1575, 3030]), fmt('', '5000', [1285, 2445, 1390, 2660, 1500, 2895, 1620, 3160, 1745, 3455]),
      fmt('', '6000', [1425, 2755, 1540, 3015, 1665, 3300, 1800, 3620, 1940, 3990])]
    const [x] = distanceTables([['0°C 10°C 20°C 30°C 40°C', ...rows].join('\n')])
    assert.deepEqual(x.pa, [0, 1000, 2000, 3000, 5000, 6000]); assert.deepEqual(x.missing, [4000])
  })
  test('cruise columns out of order with the rest of the row are dropped', () => {
    const row = (pa, rpm, cells) => `${pa.padStart(6)}${String(rpm).padStart(6)}${cells.map(c => String(c).padStart(6)).join('')}`
    const lines = [row('2000', 2400, [72, 110, '8.1', 69, 109, '7.7', 65, 108, '7.3']), row('', 2300, [65, 104, '7.3', 62, 103, '6.9', 69, 102, '6.6']), row('', 2200, [58, 99, '6.6', 55, 97, '6.3', 53, 96, '6']),
      row('4000', 2400, [69, 109, '7.8', 65, 108, '7.3', 62, 107, '7.0']), row('', 2300, [62, 104, '7.0', 59, 102, '6.6', 57, 101, '6.4']), row('', 2200, [56, 98, '6.3', 54, 96, '6.1', 51, 94, '5.9'])]
    const c = cruiseTable([lines.join('\n')]).rows
    assert.equal(c[1].cols[2], null) // 69 %BHP hotter than standard: misread
    assert.equal(c[2].cols[2], null) // "6" with no decimal
    assert.deepEqual(c[4].cols[1], [59, 102, 6.6])
  })
  test('wind and grass corrections from the notes, OCR spacing and all', () => {
    assert.deepEqual(corrections('2. Decrease distances 10% for each 9 knots head wind . For operation with tailwinds up to 10 knots, increase distances by 10% for each 2 knot s. 3. For operati on on a dry, grass runway, increase distances by 45% of the "ground roll" figure.'), { headwindPer9kt: 0.1, tailwindPer2kt: 0.1, grassGroundRoll: 0.45 })
  })
})

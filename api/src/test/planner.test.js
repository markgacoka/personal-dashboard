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

import { toLevels, toProducts } from '../services/modelWinds.js'
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

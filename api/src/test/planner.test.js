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

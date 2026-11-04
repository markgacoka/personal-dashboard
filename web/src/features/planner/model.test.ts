import { describe, expect, test } from 'vitest'
import { derive, DEFAULT_MINIMUMS, type Airport, type Inputs, type Plan, type WeatherBundle } from './model'
import { profileFor } from './poh'

const NOW = Date.parse('2026-11-04T20:00:00Z')
const rwy = (id: string, len: number, a: [string, number], b: [string, number]) => ({
  id, len, wid: 75, surface: 'ASPH', cond: 'GOOD', lights: 'MED',
  ends: [a, b].map(([eid, hdg]) => ({ id: eid, trueHdg: hdg, right: false, lat: null, lon: null, elev: null, displaced: 0, vgsi: null, lda: null })),
})
const apt = (id: string, lat: number, lon: number, elev: number, runways: Airport['runways']): Airport => ({
  id, icao: `K${id}`, name: id, city: '', state: 'CA', lat, lon, elev, tpaAgl: 1000, magVar: 13, use: 'PU', towered: true, towerCall: id, towerHrs: '0700-2200',
  segCircle: true, windIndicator: null, lights: null, frequencies: [], wx: null, runways, remarks: [], airspace: null, cycle: '2026-10-29', approach: null,
  sun: { rise: '2026-11-04T14:40:00Z', set: '2026-11-05T01:05:00Z', civilDawn: '2026-11-04T14:13:00Z', civilDusk: '2026-11-05T01:32:00Z', date: '2026-11-04' },
})
const RHV = apt('RHV', 37.333, -121.82, 135, [rwy('13L/31R', 3100, ['13L', 143], ['31R', 323])])
const SNS = apt('SNS', 36.663, -121.606, 85, [rwy('8/26', 4825, ['08', 98], ['26', 278])])

const ok = <T,>(data: T) => ({ data, fetchedAt: '2026-11-04T19:58:00Z' })
const metar = (id: string, a: Airport, wdir: number, wspd: number) => ({ icaoId: id, obsTime: NOW / 1000 - 600, temp: 20, dewp: 10, wdir, wspd, wgst: null, visib: '10+', altim: 1013.2, clouds: [{ cover: 'SCT', base: 5000 }], rawOb: `${id} …`, lat: a.lat, lon: a.lon, elev: a.elev })
const weather = (over: Partial<WeatherBundle> = {}): WeatherBundle => ({
  metars: ok([metar('KRHV', RHV, 320, 10), metar('KSNS', SNS, 280, 12)]), tafs: ok([]), pireps: ok([]), sigmets: ok([]), gairmets: ok([]), cwas: ok([]),
  winds: [{ fcst: '06', fetchedAt: '', data: [{ basedOn: '041200', valid: '041800', forUse: ['1700', '2400'], levels: [3000, 6000], stations: { SFO: { lat: 37.62, lon: -122.37, winds: { 3000: { dir: 300, spd: 10, temp: null }, 6000: { dir: 300, spd: 20, temp: 8 } } } } }] }],
  nas: ok({ updated: '', total: 0, items: [] }), tfrs: ok([]), ...over,
})
const plan = (over: Partial<Plan> = {}): Plan => ({
  name: 'test', route: ['KRHV', 'KSNS'], alternate: null, departLocal: '2026-11-04T21:00:00Z', cruiseAlt: 4500, rpm: 2400, tail: 'N227AN',
  loads: { front: 340, rear: 0, bag1: 20, bag2: 0 }, fuelGal: 40, stopMinutes: 15,
  imsafe: { illness: true, medication: true, stress: true, alcohol: true, fatigue: true, emotion: true },
  pave: { pilot: 'ok', aircraft: 'ok', environment: 'ok', external: 'ok' }, equipment: { airspeed: true }, phases: {}, night: false, ...over,
})
const inputs = (over: Partial<Inputs> = {}): Inputs => ({
  airports: [RHV, SNS], weather: weather(), match: profileFor('172P'), planning: { emptyWeight: 1500, emptyMoment: 58.5, inspections: { annual: '2026-06-01', transponder: '2025-12-01', elt: '2026-03-01', hundredHoursLeft: 40, ad: 'yes' } },
  minimums: DEFAULT_MINIMUMS, terrain: null, currency: [], airspace: null, now: NOW, ...over,
})

describe('derive: KRHV → KSNS', () => {
  const d = derive(plan(), inputs())
  test('one leg with distance, course, wind correction and ETE', () => {
    expect(d.legs).toHaveLength(1)
    const l = d.legs[0]
    expect(l.distNm).toBeGreaterThan(40); expect(l.distNm).toBeLessThan(44)
    expect(l.tc).toBeGreaterThan(160); expect(l.tc).toBeLessThan(170)
    expect(l.mc).toBeCloseTo(l.tc - 13, 5)
    expect(l.wind?.dir).toBe(300)
    expect(l.gs).toBeGreaterThan(l.tas) // northwesterly wind, southbound leg
    expect(l.eteMin).toBeGreaterThan(15); expect(l.eteMin).toBeLessThan(35)
  })
  test('weights: ramp − 7 lb taxi = takeoff; landing subtracts trip fuel', () => {
    expect(d.wb.ramp.weight).toBe(1500 + 240 + 340 + 20)
    expect(d.wb.takeoff.weight).toBe(d.wb.ramp.weight - 7)
    expect(d.wb.landing.weight).toBeCloseTo(d.wb.takeoff.weight - d.totals.tripFuel * 6, 5)
  })
  test('performance: takeoff at RHV into the wind on 31R, landing at SNS on 26', () => {
    expect(d.perf.map(p => `${p.airport.id} ${p.kind} ${p.runway?.end.id}`)).toEqual(['RHV takeoff 31R', 'SNS landing 26'])
    expect(d.perf[0].runway!.head).toBeGreaterThan(0)
    expect(d.perf[0].dist!.ground).toBeLessThan(3100)
  })
  test('a clean plan has no no-go checks', () => {
    expect(d.checks.filter(c => c.status === 'nogo')).toEqual([])
    expect(d.sections.loading).toBe('ok')
  })
})

describe('derive: what turns it into a no-go', () => {
  test('IMSAFE item failed', () => {
    const d = derive(plan({ imsafe: { illness: false } }), inputs())
    expect(d.sections.pilot).toBe('nogo')
  })
  test('IFR at the destination ETA from the TAF', () => {
    const taf = { icaoId: 'KSNS', rawTAF: '', issueTime: '', lat: SNS.lat, lon: SNS.lon, fcsts: [{ timeFrom: NOW / 1000, timeTo: NOW / 1000 + 86400, fcstChange: null, probability: null, wdir: 280, wspd: 8, wgst: null, visib: '2', vertVis: null, wxString: 'BR', clouds: [{ cover: 'OVC', base: 800 }] }] }
    const d = derive(plan(), inputs({ weather: weather({ tafs: ok([taf]) }) }))
    expect(d.checks.some(c => c.status === 'nogo' && /KSNS.*IFR/.test(c.title))).toBe(true)
  })
  test('over max takeoff weight, with how much to remove', () => {
    const d = derive(plan({ loads: { front: 400, rear: 300, bag1: 50, bag2: 0 } }), inputs())
    const c = d.checks.find(x => /Takeoff weight .* over/.test(x.title))
    expect(c?.status).toBe('nogo'); expect(c?.detail).toMatch(/Remove \d+ lb/)
  })
  test('a TFR on the line', () => {
    const tfr = { type: 'Feature' as const, geometry: { type: 'Polygon', coordinates: [[[-121.75, 36.95], [-121.65, 36.95], [-121.65, 37.05], [-121.75, 37.05], [-121.75, 36.95]]] }, properties: { id: '6/1234', kind: 'SECURITY', title: 'VIP', description: '' } }
    const d = derive(plan(), inputs({ weather: weather({ tfrs: ok([tfr]) }) }))
    expect(d.checks.some(c => c.status === 'nogo' && /TFR/.test(c.title))).toBe(true)
  })
  test('fuel below the §91.151 reserve', () => {
    const d = derive(plan({ fuelGal: 4 }), inputs())
    expect(d.checks.find(c => /legal reserve/.test(c.title))?.status).toBe('nogo')
  })
  test('annual inspection overdue', () => {
    const d = derive(plan(), inputs({ planning: { emptyWeight: 1500, emptyMoment: 58.5, inspections: { annual: '2025-09-15', transponder: '2025-12-01', elt: '2026-03-01', hundredHoursLeft: 40, ad: 'yes' } } }))
    expect(d.checks.find(c => /Annual inspection overdue/.test(c.title))?.status).toBe('nogo')
  })
})

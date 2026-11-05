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
  name: 'test', route: ['KRHV', 'KSNS'], alternate: null, departLocal: '2026-11-04T21:00:00Z', rpm: 2400, tail: 'N227AN',
  loads: { front: 340, rear: 0, bag1: 20, bag2: 0 }, fuelGal: 40, stopMinutes: 15, night: false, ...over,
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
    expect(l.varEast).toBeGreaterThan(12); expect(l.varEast).toBeLessThan(13.2) // WMM 2025, ~12.6°E (NASR still says 16°E for RHV)
    expect(l.mc).toBeCloseTo(l.tc - l.varEast, 5)
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

describe('derive: navlog rows', () => {
  const CVH = { id: 'CVH', icao: 'KCVH', name: 'Hollister', lat: 36.893, lon: -121.41, elev: 230, magVar: 13, freq: '123.05', towered: false }
  const MID = { id: 'MID', icao: null, name: 'Mid-line field', lat: 36.998, lon: -121.713, elev: 200, magVar: 13, freq: '122.9', towered: false }
  const E16 = { id: 'E16', icao: null, name: 'San Martin', lat: 37.0816, lon: -121.597, elev: 281, magVar: 13, freq: '122.7', towered: false }
  test('departure → TOC → checkpoint → TOD → destination, distances add up, ETAs and fuel run in order', () => {
    const d = derive(plan({ route: ['KRHV', 'KSNS'] }), inputs({ checkpoints: [MID, E16, CVH] }))
    const kinds = d.navlog.map(r => r.to.kind)
    expect(kinds[0]).toBe('toc'); expect(kinds.at(-2)).toBe('tod'); expect(kinds.at(-1)).toBe('airport')
    expect(d.navlog.map(r => r.to.label)).toContain('MID') // on the RHV–SNS line
    expect(d.navlog.map(r => r.to.label)).not.toContain('E16') // ~7 nm off
    expect(d.navlog.map(r => r.to.label)).not.toContain('KCVH') // ~16 nm off
    const sum = d.navlog.reduce((s, r) => s + r.distNm, 0)
    expect(sum).toBeCloseTo(d.legs[0].distNm, 0)
    for (let i = 1; i < d.navlog.length; i++) {
      expect(+d.navlog[i].eta).toBeGreaterThan(+d.navlog[i - 1].eta)
      expect(d.navlog[i].fuelRem).toBeLessThan(d.navlog[i - 1].fuelRem)
    }
    expect(d.navlog[0].phase).toBe('climb'); expect(d.navlog.at(-1)!.phase).toBe('descent')
    expect(d.navlog.at(-1)!.remNm).toBe(0)
  })
  test('a stop adds ground time and taxi fuel; an overfly point does neither and gets no landing', () => {
    const stop = derive(plan({ route: ['KRHV', 'KSNS', 'KRHV'] }), inputs())
    const over = derive(plan({ route: ['KRHV', 'KSNS*', 'KRHV'] }), inputs())
    expect(stop.totals.taxiFuel).toBeCloseTo(2.2, 5)
    expect(over.totals.taxiFuel).toBeCloseTo(1.1, 5)
    expect(stop.perf.map(p => `${p.airport.id} ${p.kind}`)).toEqual(['RHV takeoff', 'SNS landing', 'SNS takeoff', 'RHV landing'])
    expect(over.perf.map(p => `${p.airport.id} ${p.kind}`)).toEqual(['RHV takeoff', 'RHV landing'])
    expect(over.navlog.filter(r => r.phase === 'climb')).toHaveLength(1)
    expect(+stop.legs[1].departAt - +stop.legs[0].arriveAt).toBe(15 * 60_000)
  })
})

describe('derive: waypoints and E6B row overrides', () => {
  const points: Inputs['points'] = [
    { token: 'KRHV', overfly: false, kind: 'airport', id: 'RHV', label: 'KRHV' },
    { token: 'SNS090010', overfly: false, kind: 'radial', id: 'SNS090010', label: 'SNS090010', name: 'SNS radial', lat: 37.0, lon: -121.6, magVar: 15, freq: '117.3', type: 'Radial/DME' },
    { token: 'KSNS', overfly: false, kind: 'airport', id: 'SNS', label: 'KSNS' },
  ]
  const d = derive(plan({ route: ['KRHV', 'SNS090010', 'KSNS'] }), inputs({ points }))
  test('a non-airport point is flown over: two legs, one landing', () => {
    expect(d.legs).toHaveLength(2)
    expect(d.legs[0].stop).toBe(false)
    expect(d.navlog.find(r => r.to.id === 'SNS090010')?.to.kind).toBe('waypoint')
    expect(d.wx.filter(w => w.role !== 'alternate')).toHaveLength(2)
    expect(d.checks.filter(c => c.status === 'nogo')).toEqual([])
  })
  test('the waypoint carries its own variation and frequency', () => {
    const r = d.navlog.find(x => x.to.id === 'SNS090010')!
    expect(r.to.freq).toBe('117.3')
  })
  test('typed wind and CAS replace the forecast for that row only', () => {
    const base = derive(plan(), inputs())
    const row = base.navlog.find(r => r.phase === 'cruise')!
    const o = derive(plan({ overrides: { [row.key]: { wdir: 160, wspd: 30, cas: 100 } } }), inputs())
    const r2 = o.navlog.find(r => r.key === row.key)!
    expect(r2.wind?.dir).toBe(160); expect(r2.wind?.spd).toBe(30)
    expect(r2.tas).toBeGreaterThan(100) // TAS > CAS at altitude
    expect(r2.gs).toBeLessThan(r2.tas) // headwind on a southbound leg
    expect(r2.overridden.sort()).toEqual(['cas', 'wdir', 'wspd'])
    expect(o.navlog.filter(r => r.key !== row.key).every(r => r.overridden.length === 0)).toBe(true)
  })
  test('a route that ends at a waypoint is rejected', () => {
    const bad = derive(plan({ route: ['KRHV', 'SNS090010'] }), inputs({ points }))
    expect(bad.checks.some(c => c.status === 'nogo' && /end at an airport/.test(c.title))).toBe(true)
  })
})

describe('derive: flights, automatic altitude and the W&B sheet', () => {
  const d = derive(plan({ route: ['KRHV', 'KSNS', 'KRHV'], seats: { pilot: 150, front: 140, rearL: 155, rearR: 0 } }), inputs())
  test('a round trip is two flights, each with its own NavLog rows', () => {
    expect(d.flights.map(f => `${f.from.id}-${f.to.id}`)).toEqual(['RHV-SNS', 'SNS-RHV'])
    expect(d.flights.every(f => f.rows.length > 2 && f.rows.every(r => r.flight === f.n))).toBe(true)
  })
  test('lowest VFR cruising altitude: 3,500 southeast-bound, 4,500 back northwest', () => {
    expect(d.flights.map(f => f.alt)).toEqual([3500, 4500])
    expect(d.flights.every(f => !f.altSet && f.hemispheric)).toBe(true)
    expect(d.checks.some(c => /hemispheric/.test(c.title))).toBe(false)
  })
  test('your altitude replaces the automatic one for that flight only', () => {
    const o = derive(plan({ route: ['KRHV', 'KSNS', 'KRHV'], altitudes: { 0: 5500 } }), inputs())
    expect(o.flights.map(f => [f.alt, f.altSet])).toEqual([[5500, true], [4500, false]])
  })
  test('terrain raises the altitude to 1,000 ft above it', () => {
    const t = derive(plan(), inputs({ terrain: Array(40).fill(3482) }))
    expect(t.flights[0].alt).toBe(5500)
  })
  test('seats feed the stations; the sheet runs ramp → run-up → takeoff → burn → landing per flight', () => {
    expect(d.wb.items[2].weight).toBe(290); expect(d.wb.items[3].weight).toBe(155)
    expect(d.wb.steps.map(s => s.label)).toEqual(['Basic empty weight', 'Fuel 40 gal', 'Pilot and front passenger', 'Rear passengers', 'Baggage area 1', 'Ramp',
      'Run-up fuel', 'Takeoff KRHV', 'Flight burn', 'Landing KSNS', 'Run-up fuel', 'Takeoff KSNS', 'Flight burn', 'Landing KRHV'])
    const last = d.wb.steps.at(-1)!
    expect(last.weight).toBeCloseTo(d.wb.landing.weight, 6)
    expect(last.weight).toBeCloseTo(d.wb.ramp.weight - 14 - d.totals.tripFuel * 6, 6)
    expect(d.wb.steps.filter(s => s.total).every(s => !s.over)).toBe(true)
  })
  test('fuel left unset means full usable tanks', () => {
    const f = derive(plan({ fuelGal: null }), inputs())
    expect(f.totals.usableFuel).toBe(40)
    expect(f.flights[0].fuelStart).toBeCloseTo(40, 6)
  })
})

describe('derive: wizard automation', () => {
  test('start and taxi time moves takeoff and every ETA', () => {
    const a = derive(plan({ taxiMin: 0 }), inputs()), b = derive(plan({ taxiMin: 12 }), inputs())
    expect(b.takeoffAt!.getTime() - b.departAt!.getTime()).toBe(12 * 60_000)
    expect(b.legs[0].arriveAt.getTime() - a.legs[0].arriveAt.getTime()).toBe(12 * 60_000)
    expect(derive(plan(), inputs()).takeoffAt!.getTime() - Date.parse('2026-11-04T21:00:00Z')).toBe(10 * 60_000)
  })
  test('checkpoints: a VFR waypoint beats an RNAV fix nearby; far fixes and dropped points are left out', () => {
    const mid = { lat: (RHV.lat + SNS.lat) / 2, lon: (RHV.lon + SNS.lon) / 2 }
    const cp = (id: string, kind: 'vfr' | 'fix', dLat = 0, dLon = 0) => ({ id, icao: null, name: id, lat: mid.lat + dLat, lon: mid.lon + dLon, elev: null, magVar: null, freq: null, towered: false, kind })
    const cps = [cp('ANDER', 'fix', 0.01), cp('VPXYZ', 'vfr', 0.02, 0.03), cp('FARFX', 'fix', 0.2, 0.2)]
    const ids = (p: Plan) => derive(p, inputs({ checkpoints: cps })).navlog.filter(r => r.to.kind === 'checkpoint').map(r => r.to.id)
    expect(ids(plan())).toEqual(['VPXYZ'])
    expect(ids(plan({ skipFixes: ['VPXYZ'] }))).toEqual(['ANDER'])
  })
  test('checklists: unanswered is to do, a "not fit" is a no-go, all answered passes', () => {
    const open = derive(plan(), inputs())
    expect(open.checks.find(c => c.title.startsWith('IMSAFE'))?.status).toBe('todo')
    expect(open.checks.find(c => c.title.startsWith('Maintenance and documents'))?.status).toBe('todo')
    const sick = derive(plan({ checklist: { 'imsafe.illness': false } }), inputs())
    expect(sick.checks.find(c => c.title.startsWith('Not fit to fly'))?.status).toBe('nogo')
    const keys = ['imsafe.illness', 'imsafe.medication', 'imsafe.stress', 'imsafe.alcohol', 'imsafe.fatigue', 'imsafe.eating']
    const fit = derive(plan({ checklist: Object.fromEntries(keys.map(k => [k, true])) }), inputs())
    expect(fit.checks.find(c => c.title === 'IMSAFE: fit to fly')?.status).toBe('ok')
  })
})

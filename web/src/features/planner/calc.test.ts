import { describe, expect, test } from 'vitest'
import { C172P, profileFor } from './poh'
import {
  category, ceilingOf, climbBetween, corrected, cruiseAt, densityAltitude, distanceAt, fbFor, freezingLevel, hemispheric, inEnvelope,
  parseVisib, pressureAltitude, tableAt, tafAt, tafCategory, touchesCorridor, sampleRoute, windAt, windComponents, windTriangle, wbTotal,
  type FbProduct, type TafPeriod,
} from './calc'

describe('POH distance tables', () => {
  const to2400 = C172P.takeoff[0]
  test('an exact cell is the POH number (Fig. 5-5, 2400 lb, S.L., 20 °C)', () => {
    expect(tableAt(to2400, 0, 20)).toMatchObject({ ground: 925, total: 1685 })
  })
  test('between rows and columns: bilinear', () => {
    const r = tableAt(to2400, 500, 15)!
    expect(r.ground).toBeCloseTo((860 + 925 + 940 + 1015) / 4, 5)
    expect(r.total).toBeCloseTo((1570 + 1685 + 1725 + 1860) / 4, 5)
  })
  test('a blank cell or beyond the chart has no answer', () => {
    expect(tableAt(to2400, 8000, 35)).toBeNull()
    expect(tableAt(to2400, 9000, 10)).toBeNull()
    expect(tableAt(to2400, 0, 45)).toBeNull()
  })
  test('weight: linear between sheets; below the lightest sheet uses it; above the heaviest is flagged', () => {
    expect(distanceAt(C172P.takeoff, 2300, 0, 20)!.ground).toBeCloseTo((925 + 750) / 2, 5)
    expect(distanceAt(C172P.takeoff, 1800, 0, 20)!.ground).toBe(605)
    expect(distanceAt(C172P.takeoff, 2450, 0, 20)!.clamped).toContain('weight above the 2400 lb chart')
  })
  test('landing (Fig. 5-11): 2400 lb, 3000 ft, 10 °C', () => {
    expect(distanceAt(C172P.landing, 2200, 3000, 10)).toMatchObject({ ground: 590, total: 1360 })
  })
  test('wind and grass corrections from the POH notes', () => {
    const r = { ground: 1000, total: 2000, clamped: [] }
    expect(corrected(r, 9, false, C172P.takeoffNotes)).toMatchObject({ ground: 900, total: 1800 })
    expect(corrected(r, -2, false, C172P.takeoffNotes)).toMatchObject({ ground: 1100, total: 2200 })
    expect(corrected(r, 0, true, C172P.takeoffNotes)).toMatchObject({ ground: 1150, total: 2150 })
    expect(corrected(r, -12, false, C172P.landingNotes).tailwindOverLimit).toBe(true)
  })
})

describe('atmosphere and wind', () => {
  test('pressure and density altitude', () => {
    expect(pressureAltitude(135, 30.12)).toBe(-65)
    expect(pressureAltitude(5000, 29.42)).toBe(5500)
    expect(densityAltitude(5000, 25)).toBe(7400) // ISA 5 °C, +20 °C × 120 ft
  })
  test('runway components: headwind +, crosswind + from the right', () => {
    expect(windComponents(360, 10, 90)).toEqual({ head: 0, cross: -10 })
    expect(windComponents(310, 12, 310)).toEqual({ head: 12, cross: 0 })
    expect(windComponents(130, 10, 310)).toEqual({ head: -10, cross: 0 })
  })
  test('wind triangle (E6B): TC 090, TAS 100, wind 360/20', () => {
    const w = windTriangle(90, 100, 360, 20)
    expect(w.wca).toBeCloseTo(-11.54, 1)
    expect(w.th).toBeCloseTo(78.46, 1)
    expect(w.gs).toBeCloseTo(98, 0)
  })
  test('direct headwind and tailwind', () => {
    expect(windTriangle(0, 100, 0, 20).gs).toBeCloseTo(80, 5)
    expect(windTriangle(0, 100, 180, 20).gs).toBeCloseTo(120, 5)
  })
})

describe('cruise and climb (Figs. 5-7, 5-8)', () => {
  test('table point: 4000 ft, standard, 2400 RPM', () => {
    expect(cruiseAt(C172P, 4000, 0, 2400)).toMatchObject({ ktas: 108, gph: 7.3, bhp: 65 })
  })
  test('between altitudes and temperatures', () => {
    expect(cruiseAt(C172P, 3000, 0, 2400)!.ktas).toBe(Math.round((109 + 108) / 2))
    expect(cruiseAt(C172P, 4000, 10, 2400)!.ktas).toBe(Math.round((108 + 107) / 2))
  })
  test('climb is the difference from sea level, +10 % per 10 °C above standard', () => {
    expect(climbBetween(C172P, 0, 4000, 0)).toMatchObject({ min: 7, gal: 1.4, nm: 9 })
    const hot = climbBetween(C172P, 2000, 6000, 10)
    expect(hot.min).toBeCloseTo((11 - 3) * 1.1, 5)
    expect(hot.gal).toBeCloseTo((2.2 - 0.6) * 1.1, 5)
  })
})

describe('weight and balance', () => {
  test('the POH sample loading problem (Fig. 6-5) is 2400 lb at 107.8 moment, in the envelope', () => {
    const t = wbTotal([
      { label: 'Basic empty', weight: 1467, arm: 57300 / 1467 },
      { label: 'Fuel 40 gal', weight: 240, arm: 48 },
      { label: 'Front', weight: 340, arm: 37 },
      { label: 'Rear', weight: 340, arm: 73 },
      { label: 'Baggage 1', weight: 20, arm: 95 },
      { label: 'Taxi fuel', weight: -7, arm: 48 },
    ])
    expect(t.weight).toBe(2400)
    expect(t.moment / 1000).toBeCloseTo(107.8, 0)
    expect(inEnvelope(C172P.envelope.normal, t.cg, t.weight)).toBe(true)
  })
  test('envelope edges: forward limit slopes from 35.0 at 1950 lb to 39.5 at 2400 lb; aft 47.3', () => {
    expect(inEnvelope(C172P.envelope.normal, 37.0, 2400)).toBe(false)
    expect(inEnvelope(C172P.envelope.normal, 40.0, 2400 - 1)).toBe(true)
    expect(inEnvelope(C172P.envelope.normal, 47.5, 2000)).toBe(false)
    expect(inEnvelope(C172P.envelope.normal, 45, 2450)).toBe(false)
  })
  test('172N uses its own limits with the 172P tables, and says so', () => {
    const m = profileFor('172N')
    expect(m.exact).toBe(false)
    expect(m.profile.limits.maxTakeoff).toBe(2300)
    expect(m.note).toMatch(/No 172N POH on file/)
    expect(profileFor('172P').exact).toBe(true)
  })
})

describe('VFR rules and weather', () => {
  test('§91.159 hemispheric altitudes above 3,000 ft AGL', () => {
    expect(hemispheric(90, 5500, 100).ok).toBe(true)
    expect(hemispheric(90, 4500, 100)).toMatchObject({ ok: false, suggest: 3500 })
    expect(hemispheric(270, 4500, 100).ok).toBe(true)
    expect(hemispheric(270, 2500, 100).applies).toBe(false)
  })
  test('flight category from ceiling and visibility', () => {
    expect(category(4000, 10)).toBe('VFR')
    expect(category(3000, 10)).toBe('MVFR')
    expect(category(800, 10)).toBe('IFR')
    expect(category(null, 0.5)).toBe('LIFR')
    expect(parseVisib('6+')).toBe(6)
    expect(parseVisib('1 1/2')).toBe(1.5)
    expect(ceilingOf([{ cover: 'FEW', base: 1000 }, { cover: 'BKN', base: 4000 }])).toBe(4000)
  })
  test('TAF at a time: prevailing group plus TEMPO', () => {
    const g = (from: number, to: number, change: string | null, base: number, visib = '6+'): TafPeriod =>
      ({ timeFrom: from, timeTo: to, fcstChange: change, probability: null, wdir: 180, wspd: 5, wgst: null, visib, vertVis: null, wxString: null, clouds: [{ cover: 'BKN', base }] })
    const f = [g(0, 100, null, 5000), g(100, 200, 'FM', 2500), g(120, 150, 'TEMPO', 800, '2')]
    expect(tafAt(f, 50).prevailing?.clouds[0].base).toBe(5000)
    const m = tafAt(f, 130)
    expect(m.prevailing?.clouds[0].base).toBe(2500)
    expect(m.temporary).toHaveLength(1)
    expect(tafCategory(m)).toBe('IFR')
  })
})

describe('winds aloft', () => {
  const prod: FbProduct = {
    basedOn: '030600', valid: '031200', forUse: ['2100', '0600'], levels: [3000, 6000, 9000],
    stations: { SFO: { lat: 37.62, lon: -122.37, winds: { 3000: { dir: 270, spd: 10, temp: null }, 6000: { dir: 270, spd: 20, temp: 7 }, 9000: { dir: 270, spd: 30, temp: 1 } } } },
  }
  test('the product whose for-use window covers the time (window wraps midnight)', () => {
    // FB 06 valid 04 1200Z for use 0800–1500Z; FB 12 valid 05 0000Z for use 2100–0600Z (wraps midnight).
    const p = [{ fcst: '06', data: [{ ...prod, valid: '041200', forUse: ['0800', '1500'] as [string, string] }] }, { fcst: '12', data: [{ ...prod, valid: '050000', forUse: ['2100', '0600'] as [string, string] }] }]
    expect(fbFor(p, new Date('2026-11-04T23:30:00Z'))?.fcst).toBe('12')
    expect(fbFor(p, new Date('2026-11-05T03:00:00Z'))?.fcst).toBe('12')
    expect(fbFor(p, new Date('2026-11-04T09:00:00Z'))?.fcst).toBe('06')
  })
  test('a time on another day is outside every window and says so', () => {
    const p = [{ fcst: '06', data: [{ ...prod, valid: '031200', forUse: ['0800', '1500'] as [string, string] }] }]
    expect(fbFor(p, new Date('2026-11-04T10:00:00Z'))).toMatchObject({ fcst: '06', outside: true })
  })
  test('interpolated between levels; temperature by lapse rate below the lowest temp level', () => {
    const w = windAt(prod, { lat: 37.33, lon: -121.82 }, 4500)!
    expect(w).toMatchObject({ dir: 270, spd: 15 })
    expect(w.temp).toBe(10) // 7 °C at 6000 + 2 °C/1000 ft × 1.5
  })
  test('freezing level where the temperature crosses zero between levels (7 °C at 6,000, −2 °C at 9,000)', () => {
    const p2 = { ...prod, stations: { SFO: { ...prod.stations.SFO, winds: { ...prod.stations.SFO.winds, 9000: { dir: 270, spd: 30, temp: -2 } } } } }
    expect(freezingLevel(p2, { lat: 37.3, lon: -121.8 })?.altFt).toBe(8300)
  })
})

test('corridor: a polygon on the line touches; one 30 nm away does not', () => {
  const s = sampleRoute([{ lat: 37.33, lon: -121.82 }, { lat: 36.66, lon: -121.6 }])
  const box = (lat: number, lon: number): [number, number][] => [[lon - 0.05, lat - 0.05], [lon + 0.05, lat - 0.05], [lon + 0.05, lat + 0.05], [lon - 0.05, lat + 0.05], [lon - 0.05, lat - 0.05]]
  expect(touchesCorridor(s, box(37.0, -121.7), 5)).toBe(true)
  expect(touchesCorridor(s, box(37.0, -121.1), 5)).toBe(false)
})

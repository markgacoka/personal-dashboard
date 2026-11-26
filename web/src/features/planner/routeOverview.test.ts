import { describe, expect, test } from 'vitest'
import type { Airport, RunwayCalc } from './model'
import { patternEntry } from './RouteOverview'

// A north–south runway 18/36 at the origin; landing 36 (heading north).
const end36 = { id: '36', trueHdg: 0, right: false, lat: 37.0, lon: -121.5, elev: 100, displaced: 0, vgsi: null, lda: null }
const end18 = { id: '18', trueHdg: 180, right: true, lat: 37.01, lon: -121.5, elev: 100, displaced: 0, vgsi: null, lda: null }
const runway = { id: '18/36', len: 3600, wid: 75, surface: 'ASPH', cond: null, lights: null, ends: [end18, end36] }
const apt = { id: 'TST', icao: 'KTST', elev: 100, tpaAgl: 1000, towered: false, runways: [runway] } as unknown as Airport
const rc = (end: typeof end36): RunwayCalc => ({ runway, end, magHdg: 0, head: 5, cross: 0, toraFt: 3600, ldaFt: 3600 })

describe('patternEntry', () => {
  test('from the pattern side: a 45° entry to downwind, ending at the threshold', () => {
    // Left traffic for 36 is on the west side; arriving from the west.
    const e = patternEntry(apt, rc(end36), { lat: 37.005, lon: -121.8 })!
    expect(e.kind).toBe('45')
    expect(e.text).toMatch(/45° entry to left downwind for RWY 36 at 1,100 ft/)
    expect(e.path.at(-1)).toEqual({ lat: 37.0, lon: -121.5 })
    // The downwind leg (path[1]) is west of the runway.
    expect(e.path[1].lon).toBeLessThan(-121.5)
  })
  test('from the other side: cross midfield 500 ft above pattern altitude', () => {
    const e = patternEntry(apt, rc(end36), { lat: 37.005, lon: -121.2 })!
    expect(e.kind).toBe('crossover')
    expect(e.text).toMatch(/Cross midfield at 1,600 ft/)
    expect(e.path[0].lon).toBeGreaterThan(-121.5) // starts on the east side
  })
  test('towered fields defer to ATC; no end coordinates, no entry', () => {
    expect(patternEntry({ ...apt, towered: true } as Airport, rc(end36), null)!.text).toMatch(/^Towered: expect ATC instructions/)
    expect(patternEntry(apt, rc({ ...end36, lat: null as unknown as number }), null)).toBeNull()
  })
})

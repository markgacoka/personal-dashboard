import { describe, expect, test } from 'vitest'
import type { Airport, RunwayCalc } from './model'
import { arrivalProcedure, departureProcedure } from './procedures'

// A north–south runway 18/36 at 37°N 121.5°W, 0.6 nm long; magnetic variation 0 for simple numbers.
const end36 = { id: '36', trueHdg: 0, right: false, lat: 37.0, lon: -121.5, elev: 100, displaced: 0, vgsi: null, lda: null }
const end18 = { id: '18', trueHdg: 180, right: true, lat: 37.01, lon: -121.5, elev: 100, displaced: 0, vgsi: null, lda: null }
const runway = { id: '18/36', len: 3600, wid: 75, surface: 'ASPH', cond: null, lights: null, ends: [end18, end36] }
const apt = { id: 'TST', icao: 'KTST', lat: 37.005, lon: -121.5, elev: 100, tpaAgl: 1000, magVar: 0, towered: false, runways: [runway] } as unknown as Airport
const rc = (end: typeof end36, right = end.right): RunwayCalc => ({ runway: { ...runway, ends: [end18, end36].map(e => (e.id === end.id ? { ...e, right } : e)) }, end: { ...end, right }, magHdg: end.trueHdg, head: 5, cross: 0, toraFt: 3600, ldaFt: 3600 })
const at = (brg: number, nm = 8) => ({ lat: 37.005 + (nm * Math.cos((brg * Math.PI) / 180)) / 60, lon: -121.5 + (nm * Math.sin((brg * Math.PI) / 180)) / (60 * Math.cos((37 * Math.PI) / 180)) })

describe('arrival: join the pattern from where you come from', () => {
  test('left traffic for 36 (west side): from the west, a 45° entry; the path ends at the threshold', () => {
    const p = arrivalProcedure(apt, rc(end36), at(270))!
    expect(p.kind).toBe('45')
    expect(p.text).toMatch(/45° entry to left downwind RWY 36 at 1,100 ft/)
    expect(p.join.lon).toBeLessThan(-121.5) // the entry starts on the west (pattern) side
    const last = p.path.at(-1)!
    expect(last.lat).toBeCloseTo(37.0, 3); expect(last.lon).toBeCloseTo(-121.5, 3)
  })
  test('from the non-pattern side: overfly midfield 500 ft above pattern altitude, teardrop to the 45°', () => {
    const p = arrivalProcedure(apt, rc(end36), at(90))!
    expect(p.kind).toBe('overfly')
    expect(p.text).toMatch(/Overfly midfield at 1,600 ft.*teardrop to a 45° entry to left downwind RWY 36/)
  })
  test('right traffic flips the sides', () => {
    expect(arrivalProcedure(apt, rc(end36, true), at(90))!.kind).toBe('45')
    expect(arrivalProcedure(apt, rc(end36, true), at(270))!.kind).toBe('overfly')
  })
  test('towered fields defer to the tower; no end coordinates, no procedure', () => {
    expect(arrivalProcedure({ ...apt, towered: true } as Airport, rc(end36), at(270))!.text).toMatch(/^Towered: follow the tower/)
    expect(arrivalProcedure(apt, { ...rc(end36), end: { ...end36, lat: null as unknown as number } }, null)).toBeNull()
  })
})

describe('departure: leave toward the next waypoint', () => {
  // Departing 36 (heading north) with left traffic: the pattern is on the west side.
  const kind = (brg: number, right = false) => departureProcedure(apt, rc(end36, right), at(brg, 20))!.kind
  test('course within 35° of the runway: straight out', () => { expect(kind(10)).toBe('straight'); expect(kind(330)).toBe('straight') })
  test('course toward the pattern side: a 45° turn out', () => { expect(kind(280)).toBe('45'); expect(kind(80, true)).toBe('45') })
  test('course toward the other side: straight out past the pattern, then turn', () => { expect(kind(80)).toBe('straight-turn'); expect(kind(280, true)).toBe('straight-turn') })
  test('course behind: a downwind departure', () => { expect(kind(180)).toBe('downwind'); expect(kind(200, true)).toBe('downwind') })
  test('the path leaves from the takeoff end and the en-route line starts at its end', () => {
    const p = departureProcedure(apt, rc(end36), at(280, 20))!
    expect(p.path[0].lat).toBeCloseTo(37.0, 3)
    expect(p.join).toEqual(p.path.at(-1))
    expect(p.text).toMatch(/45° left turn out of the pattern, then on course 2\d\d°/)
  })
})

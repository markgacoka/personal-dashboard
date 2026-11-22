import { describe, expect, test } from 'vitest'
import { cruiseAt } from './calc'
import { applyAirportProfile, type Airport } from './model'
import { applyEdits, editCount, profileFor } from './poh'

describe('aircraft profile edits', () => {
  test('blank edits keep the POH profile', () => {
    const m = profileFor('172P')
    expect(applyEdits(m, {})).toBe(m)
    expect(applyEdits(m, { vy: null, engine: ' ' })).toBe(m)
  })
  test('your values replace the POH ones and say so', () => {
    const m = applyEdits(profileFor('172N'), { maxTakeoff: 2300, fuelUsable: 38, vy: 74, arms: { bag1: 96 }, crosswindDemo: 12 })
    const p = m.profile
    expect(p.limits.maxTakeoff).toBe(2300)
    expect(p.fuel).toEqual([{ key: 'yours', label: 'Your tanks', usable: 38, total: 38 }])
    expect(p.vspeeds.vy).toBe(74)
    expect(p.stations.find(s => s.key === 'bag1')?.arm).toBe(96)
    expect(p.crosswindDemo).toBe(12)
    expect(p.source).toMatch(/5 values from your aircraft profile/)
    expect(editCount({ maxTakeoff: 2300, arms: { bag1: 96, rear: null }, oil: '' })).toBe(2)
  })
  test('cruise TAS and burn replace the cruise table', () => {
    const base = cruiseAt(profileFor('172P').profile, 4000, 0, 2400)!
    const mine = cruiseAt(applyEdits(profileFor('172P'), { cruiseKtas: 100, cruiseGph: 8.2 }).profile, 4000, 0, 2400)!
    expect(mine.ktas).toBe(100)
    expect(mine.gph).toBe(8.2)
    expect(mine.bhp).toBe(base.bhp)
  })
})

describe('airport profile', () => {
  const a = { id: 'RHV', icao: 'KRHV', elev: 135, tpaAgl: null, runways: [{ id: '13L/31R', len: 3100, wid: 75, surface: 'ASPH', cond: null, lights: null, ends: [{ id: '13L', right: false }, { id: '31R', right: true }] }] } as unknown as Airport
  test('pattern altitude, sides and notes apply', () => {
    const b = applyAirportProfile(a, { tpaMsl: 1135, pattern: { '13L': 'R' }, notes: ' Call over the reservoir ' })
    expect(b.tpaAgl).toBe(1000)
    expect(b.runways[0].ends.map(e => e.right)).toEqual([true, true])
    expect(b.notes).toBe('Call over the reservoir')
    expect(b.profiled).toBe(true)
  })
  test('no profile, no change', () => {
    expect(applyAirportProfile(a, null)).toBe(a)
    expect(applyAirportProfile(a, { tpaMsl: 100 }).tpaAgl).toBeNull() // below the field: ignored
  })
})

describe('tables read from a POH PDF', async () => {
  const { withTables, profileFor } = await import('./poh')
  const { cruiseAt, climbBetween, distanceAt } = await import('./calc')
  const tables = (await import('./fixtures/c172m-tables.json')).default as import('./poh').PohTables
  const m = withTables(profileFor('172M'), tables, 'Cessna 172M Skyhawk POH (1976)')
  test('a 172M with every table read is exact and keeps its TCDS limits', () => {
    expect(m.exact).toBe(true); expect(m.note).toBeNull()
    expect(m.profile.limits.maxTakeoff).toBe(2300)
    expect(m.profile.read?.sections).toEqual(['takeoff', 'climb', 'cruise', 'landing'])
    expect(m.profile.figures.takeoff).toBe('Figure 5-4, Takeoff Distance')
  })
  test('the numbers are the 172M book\'s', () => {
    expect(cruiseAt(m.profile, 4000, 0, 2400)).toMatchObject({ ktas: 106, gph: 6.9, bhp: 61 })
    expect(climbBetween(m.profile, 0, 4000, 0)).toEqual({ min: 7, gal: 1.5, nm: 9 })
    expect(distanceAt(m.profile.takeoff, 2300, 0, 0)).toMatchObject({ ground: 775, total: 1380 })
    expect(distanceAt(m.profile.landing, 2300, 6000, 40)).toMatchObject({ ground: 705, total: 1570 })
  })
  test('what couldn\'t be read stays the 172P\'s and is named', () => {
    const p = withTables(profileFor('172M'), { ...tables, landing: null }, 'Cessna 172M POH')
    expect(p.exact).toBe(false)
    expect(p.profile.landing).toBe(profileFor('172P').profile.landing)
    expect(p.note).toMatch(/Landing distance couldn't be read/)
  })
  test('another model: its tables, the chart\'s heaviest weight as the maximum, and a note', () => {
    const p = withTables(profileFor('152'), tables, 'Cessna 152 POH')
    expect(p.exact).toBe(false)
    expect(p.profile.limits.maxTakeoff).toBe(2300)
    expect(p.note).toMatch(/CG envelope and loading stations are still the 172P's/)
  })
  test('a scan with no text keeps the 172P and says why', () => {
    const p = withTables(profileFor('172M'), { v: 1, none: 'no text layer' }, 'Cessna 172M POH')
    expect(p.profile.read).toMatchObject({ sections: [], reason: 'no text layer' })
    expect(p.exact).toBe(false)
  })
})

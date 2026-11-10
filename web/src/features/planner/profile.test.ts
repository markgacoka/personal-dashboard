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

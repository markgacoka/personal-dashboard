import { describe, expect, test } from 'vitest'
import { profileFor, withSpecs } from './poh'
import { hasSpecs, specOverrides, type PohSpecs } from './specs'

// What the API reads from the 1995 PA-28-161 POH (api/src/test/pohSpecs.test.js).
const pa28: PohSpecs = {
  v: 1, found: 12,
  engine: { make: 'Lycoming', model: 'O-320-D3G', hp: 160, rpm: 2700, type: null, displacement: null },
  fuel: { tanks: [{ key: 'standard', label: 'Two wing tanks', total: 50, each: 25, usable: 48, unusable: 2 }], grades: [{ grade: '100LL', color: 'Blue' }], system: null, selector: null },
  arcs: { white: [44, 103], green: [50, 126], yellow: [126, 160], red: 160 },
  limits: { vne: 160, vno: 126, va: [[1531, 88]], vfe: [{ label: 'Flaps extended', kias: 103 }], windowOpen: null },
  speeds: { vy: 79, vx: 63, vy10: null, vx10: null, climb: null, approachUp: null, approach: null, finalApproach: 63, shortApproach: null, glide: null, crosswind: 17 },
  oil: { sumpQt: 8, totalQt: null, minQt: 2, extendedQt: null, pressurePsi: null, maxTempF: null, spec: null, viscosity: [] },
}

describe('spec sheet read from the POH', () => {
  test('a pending or thin read is not a sheet', () => {
    expect(hasSpecs({ v: 1, pending: 'OCR' })).toBe(false)
    expect(hasSpecs({ v: 1, found: 2 })).toBe(false)
    expect(hasSpecs(pa28)).toBe(true)
  })
  test('another make flies its own book\'s speeds, tanks, oil and crosswind', () => {
    const p = withSpecs(profileFor('PA-28-161'), pa28, 'Piper PA-28-161 POH').profile
    expect([p.vspeeds.vso, p.vspeeds.vs1, p.vspeeds.vx, p.vspeeds.vy, p.vspeeds.vno, p.vspeeds.vne, p.vspeeds.vfe]).toEqual([44, 50, 63, 79, 126, 160, '103'])
    expect(p.fuel).toEqual([{ key: 'standard', label: 'Two wing tanks', usable: 48, total: 50 }])
    expect(p.crosswindDemo).toBe(17)
    expect(p.engine).toBe('Lycoming O-320-D3G, 160 hp')
    expect(p.oil).toBe('Not less than 2 qt (sump 8 qt)')
    expect(p.specsFrom).toBe('Piper PA-28-161 POH')
  })
  test('the hand-checked 172P profile is left alone', () => {
    const m = profileFor('172P')
    expect(withSpecs(m, pa28, 'x')).toBe(m)
  })
  test('implausible values are ignored, not used', () => {
    const o = specOverrides({ ...pa28, arcs: { white: [4, 103], green: [50, 1260], yellow: null, red: null }, limits: null })
    expect(o.vspeeds.vso).toBeUndefined()
    expect(o.vspeeds.vno).toBeUndefined()
  })
})

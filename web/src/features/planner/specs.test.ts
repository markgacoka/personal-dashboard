import { describe, expect, test } from 'vitest'
import { profileFor } from './poh'
import { SPECS, specsFor } from './specs'

describe('POH spec sheets', () => {
  test.each(['172M', '172P'])('the %s sheet agrees with the profile the planner flies', v => {
    const s = SPECS[v], p = profileFor(v).profile
    expect(p.vspeeds.vso).toBe(s.arcs.white[0])
    expect(p.vspeeds.vs1).toBe(s.arcs.green[0])
    expect(p.vspeeds.vno).toBe(s.arcs.green[1])
    expect(p.vspeeds.vne).toBe(s.arcs.red)
    expect(p.fuel.map(f => [f.key, f.usable, f.total])).toEqual(s.fuel.tanks.map(t => [t.key, t.usable, t.total]))
    for (const t of s.fuel.tanks) expect(t.total - t.unusable).toBe(t.usable)
    expect(p.limits.maxTakeoff).toBe(s.loadFactors.normal.weight)
  })
  test('the 172M flies its own book, not the 172P\'s', () => {
    const p = profileFor('172M').profile
    expect(p.fuel[0].usable).toBe(38)
    expect(p.vspeeds.vy).toBe(78)
  })
  test('lookup by registry model string', () => {
    expect(specsFor('172M')?.electrical.volts).toBe(14)
    expect(specsFor('CESSNA 172P')?.electrical.volts).toBe(28)
    expect(specsFor('PA-28-161')).toBeNull()
  })
})

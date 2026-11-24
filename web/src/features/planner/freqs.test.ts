import { describe, expect, test } from 'vitest'
import { freqUse } from './freqs'
import type { Airport } from './model'

const twr = { towered: true, towerHrs: '0700-2200' } as Airport, uncontrolled = { towered: false, towerHrs: null } as Airport
describe('when to use a frequency', () => {
  test('tower: hold-short on departure, 10 nm out on arrival, with its hours', () => {
    expect(freqUse('LCL/P', twr, 'departure')).toBe('At the hold-short line, after the run-up (tower 0700-2200).')
    expect(freqUse('LCL/P', twr, 'arrival')).toMatch(/^About 10 nm out/)
  })
  test('CTAF at a towered field is for when the tower is closed', () => {
    expect(freqUse('CTAF', twr, 'departure')).toMatch(/^When the tower is closed \(tower 0700-2200\)/)
    expect(freqUse('CTAF', uncontrolled, 'arrival')).toMatch(/inbound 10 nm out/)
  })
  test('clearance delivery is departure-only', () => expect(freqUse('CD/P', twr, 'arrival')).toBeNull())
})

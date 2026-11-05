import { describe, expect, test } from 'vitest'
import { atisRunways } from './AirportsStep'

describe('atisRunways', () => {
  test('reads landing and departing runways from D-ATIS text', () => {
    expect(atisRunways('SJC ATIS INFO K 1853Z. 30010KT 10SM. LANDING AND DEPARTING RWY 30L, 30R. NOTAMS...')).toEqual(['30L', '30R'])
    expect(atisRunways('OAK INFO A. LDG RWY 30, DEPG RWY 28R.')).toEqual(['30', '28R'])
    expect(atisRunways('SIMUL VISUAL APCHS IN USE RWYS 28L AND 28R')).toEqual(['28L', '28R'])
    expect(atisRunways('WIND CALM')).toEqual([])
  })
})

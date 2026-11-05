import { describe, expect, test } from 'vitest'
import { notamDigest, notamHighlights } from './brief'

describe('NOTAM notes', () => {
  test('shortens the E) line', () => {
    expect(notamDigest('A1234/26 NOTAMN\nQ) ZOA/QMRLC\nA) KSNS B) 2610221500 C) 2610232300\nE) RWY 08/26 VASI U/S')).toBe('RWY 08/26 VASI out')
    expect(notamDigest('!SNS 10/045 SNS TWY P, D CLSD 2610221500-2610232300')).toBe('TWY P, D closed')
    expect(notamDigest('!SNS 10/050 SNS AIRSPACE UAS WI AN AREA DEFINED AS 7.5NM RADIUS OF SNS SFC-1000FT AGL 2610221500-2610232300')).toBe('UAS area 7.5NM around SNS, SFC–1000FT AGL')
  })
  test('keeps runway, airspace and taxiway items; drops IFR procedures and obstacle lights', () => {
    const r = notamHighlights([
      '!SNS 10/001 SNS IAP SALINAS MUNI RNAV (GPS) RWY 31 AMDT 3 ... NA',
      '!SNS 10/002 SNS OBST TOWER LGT (ASR 1234) 364500N1213800W OUT OF SERVICE',
      '!SNS 10/003 SNS TWY P CLSD',
      '!SNS 10/004 SNS RWY 08/26 VASI U/S',
      '!SNS 10/005 SNS AD AP BCN OUT OF SERVICE',
    ])
    expect(r.shown).toEqual(['RWY 08/26 VASI out', 'TWY P closed'])
  })
})

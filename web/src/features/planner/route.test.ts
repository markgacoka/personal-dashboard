import { describe, expect, test } from 'vitest'
import { routeToText, textToRoute, tokenize } from './route'
import { casFromTas, tasFromCas } from './calc'
import { fromW, toF, unitsForTail } from './units'

describe('route text', () => {
  test('tokenizes SkyVector / ForeFlight strings', () => {
    expect(tokenize('krhv  vpcoy DCT sjc090020 3720N12150W 37.3/-121.8 khaf')).toEqual(['KRHV', 'VPCOY', 'SJC090020', '3720N12150W', '37.3/-121.8', 'KHAF'])
  })
  test('middle airports are stops unless marked with *', () => {
    const isApt = (t: string) => t !== 'VPCOY'
    expect(textToRoute('KRHV E16* VPCOY KSNS KRHV', isApt)).toEqual(['KRHV', 'E16*', 'VPCOY', 'KSNS', 'KRHV'])
    expect(textToRoute('KRHV* VPCOY* KSNS*', isApt)).toEqual(['KRHV', 'VPCOY', 'KSNS'])
    expect(routeToText(['KRHV', 'KCVH*', 'KSNS'])).toBe('KRHV KCVH* KSNS')
  })
})

describe('airspeed and units', () => {
  test('TAS from CAS matches the E6B (~2 % per 1,000 ft)', () => {
    expect(tasFromCas(100, 0, 15)).toBeCloseTo(100, 1)
    const tas = tasFromCas(100, 6000, 3)
    expect(tas).toBeGreaterThan(108); expect(tas).toBeLessThan(111)
    expect(casFromTas(tas, 6000, 3)).toBeCloseTo(100, 6)
  })
  test('units follow the registration country', () => {
    expect(unitsForTail('N54829').weight).toBe('lb')
    expect(unitsForTail('G-ABCD').weight).toBe('kg')
    expect(unitsForTail('C-GABC').fuel).toBe('L')
    expect(fromW(100, unitsForTail('VH-ABC'))).toBeCloseTo(220.46, 1)
    expect(toF(10, unitsForTail('D-EABC'))).toBeCloseTo(37.85, 1)
  })
})

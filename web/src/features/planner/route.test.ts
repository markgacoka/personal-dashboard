import { describe, expect, test } from 'vitest'
import { bestInsert, coordToken, joinRoute, routeToText, splitRoute, tokenize } from './route'
import { suggest } from './suggest'
import { casFromTas, tasFromCas } from './calc'
import { fromW, toF, unitsForTail } from './units'

describe('route text', () => {
  test('tokenizes SkyVector / ForeFlight strings and drops the old "*" overfly mark', () => {
    expect(tokenize('krhv  vpcoy DCT sjc090020 3720N12150W 37.3/-121.8 e16* khaf')).toEqual(['KRHV', 'VPCOY', 'SJC090020', '3720N12150W', '37.3/-121.8', 'E16', 'KHAF'])
  })
  test('departure, points flown over, arrival', () => {
    expect(splitRoute(['KRHV', 'E16*', 'VPCOY', 'KSNS'])).toEqual({ dep: 'KRHV', via: ['E16', 'VPCOY'], arr: 'KSNS' })
    expect(splitRoute(['KRHV'])).toEqual({ dep: 'KRHV', via: [], arr: '' })
    expect(joinRoute('krhv', ['E16'], 'KSNS')).toEqual(['KRHV', 'E16', 'KSNS'])
    expect(joinRoute('KRHV', ['E16'], '')).toEqual(['KRHV'])
    expect(routeToText(['KRHV', 'KCVH*', 'KSNS'])).toBe('KRHV KCVH KSNS')
  })
  test('a new point goes where it adds the least distance', () => {
    const pts = [{ lat: 37.33, lon: -121.82 }, { lat: 36.98, lon: -121.6 }, { lat: 36.66, lon: -121.6 }]
    expect(bestInsert(pts, { lat: 37.15, lon: -121.7 })).toBe(1)
    expect(bestInsert(pts, { lat: 36.8, lon: -121.62 })).toBe(2)
    expect(coordToken({ lat: 37.123456, lon: -121.5 })).toBe('37.12346/-121.50000')
  })
})

describe('suggested points', () => {
  const route = [{ id: 'RHV', lat: 37.333, lon: -121.82 }, { id: 'SNS', lat: 36.663, lon: -121.608 }]
  const cp = [
    { id: 'E16', icao: null, name: 'San Martin', lat: 37.082, lon: -121.70, elev: 281, magVar: null, freq: null, towered: false, kind: 'airport' as const },
    { id: 'FAR', icao: null, name: 'Far away', lat: 37.0, lon: -120.9, elev: 0, magVar: null, freq: null, towered: false, kind: 'vfr' as const },
  ]
  const lm = {
    points: [{ kind: 'town' as const, name: 'Gilroy', lat: 37.006, lon: -121.68 }],
    lines: [{ kind: 'road' as const, name: 'Hwy 152', coords: [[-122.0, 37.0], [-121.3, 36.95]] as [number, number][] }],
    errors: [], source: '',
  }
  const s = suggest(route, cp, lm)
  test('points within 5 nm of the line, ordered along it, with the side they are on', () => {
    expect(s.map(x => x.label)).toEqual(['E16', 'Gilroy', 'Hwy 152'])
    expect(s[0].offNm).toBeLessThan(0) // east of a south-southeast course is the left
    expect(s[0].token).toBe('E16'); expect(s[1].token).toBe('37.00600/-121.68000')
  })
  test('a highway the line crosses becomes a point on the line', () => {
    const x = s.find(p => p.kind === 'road')!
    expect(x.offNm).toBe(0)
    expect(x.lat).toBeGreaterThan(36.95); expect(x.lat).toBeLessThan(37.0)
    expect(x.detail).toBe('Highway crossing')
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

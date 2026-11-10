import { describe, expect, it } from 'vitest'
import { C172P } from './poh'
import { aircraftClass, medicalExpiry, pilotChecks, type PilotInput } from './pilot'
import { byAirport, wxDiff } from './WeatherSection'
import type { WxAt } from './model'

const base = (over: Partial<PilotInput> = {}): PilotInput => ({
  certs: { certificate: 'student', medical: { kind: 'third', date: '2026-01-10', under40: true }, endorsements: { solo: '2026-10-20', soloModel: '172P' } },
  crew: { role: 'pic' }, passengers: 0, night: false, depart: new Date('2026-11-10T10:00:00'), aircraft: aircraftClass(C172P), model: '172P',
  worstVisib: 10, lowestCeiling: null, cruiseAlt: 3500, maxFromHomeNm: 12, landsAway: false, home: 'KRHV', classB: [], controlled: [], airports: ['KRHV'],
  xcEndorsedForFlight: false, currency: [], ...over,
})
const titles = (x: PilotInput) => pilotChecks(x).filter(c => c.status === 'nogo').map(c => c.title)

describe('pilot privileges', () => {
  it('reads the 172P as 160 hp, four seats, not LSA', () => {
    expect(aircraftClass(C172P)).toMatchObject({ hp: 160, seats: 4, lsa: false, complex: false })
  })
  it('clears a local student solo with a current endorsement', () => {
    expect(titles(base())).toEqual([])
  })
  it('student solo: passengers, night, expired endorsement, XC and Class B', () => {
    const t = titles(base({ passengers: 1, night: true, depart: new Date('2027-02-01T10:00:00'), maxFromHomeNm: 40, classB: ['SAN FRANCISCO'] }))
    expect(t).toEqual(expect.arrayContaining([
      'Student pilots can\'t carry passengers', 'Part of the flight is at night', expect.stringMatching(/^Solo endorsement expired/),
      expect.stringMatching(/a solo cross-country$/), 'Class B (SAN FRANCISCO) as a student solo',
    ]))
  })
  it('needs the per-flight XC endorsement ticked', () => {
    const c = pilotChecks(base({ certs: { certificate: 'student', medical: { kind: 'third', date: '2026-01-10', under40: true }, endorsements: { solo: '2026-10-20', soloXc: true } }, maxFromHomeNm: 40 }))
    expect(c.find(x => /cross-country/.test(x.title) && x.status === 'todo')).toBeTruthy()
  })
  it('student solo visibility limits are 3 SM day, 5 SM night', () => {
    expect(titles(base({ worstVisib: 4 }))).toEqual([])
    expect(titles(base({ worstVisib: 4, night: true, certs: { certificate: 'student', medical: { kind: 'third', date: '2026-01-10' }, endorsements: { solo: '2026-10-20', soloNight: true } } }))).toContain('Visibility 4 SM, under the student-solo 5 SM')
  })
  it('dual: the instructor is PIC, so no solo rules apply', () => {
    const c = pilotChecks(base({ crew: { role: 'dual', instructor: 'Sam' }, passengers: 0, night: true, maxFromHomeNm: 80, certs: { certificate: 'student' } }))
    expect(c.filter(x => x.status === 'nogo')).toEqual([])
    expect(c[0].title).toBe('Dual with Sam')
  })
  it('private pilot: ASEL, flight review and passenger currency', () => {
    const t = titles(base({ certs: { certificate: 'private', medical: { kind: 'third', date: '2026-01-10', under40: true }, flightReview: '2023-01-01' }, passengers: 2,
      currency: [{ key: 'day', name: 'Passengers', state: 'lapsed', detail: '1 landing in 90 days' }] }))
    expect(t).toEqual(expect.arrayContaining(['No airplane single-engine land rating', 'No flight review in the last 24 calendar months', 'Not current to carry passengers']))
  })
  it('high-performance and tailwheel airplanes need endorsements', () => {
    const t = titles(base({ certs: { certificate: 'private', ratings: { asel: true }, medical: { kind: 'basicmed', date: '2025-06-01', course: '2025-06-01' }, flightReview: '2026-05-01' }, aircraft: { ...aircraftClass(C172P), hp: 230, tailwheel: true } }))
    expect(t).toEqual(['This airplane needs a high-performance (over 200 hp) endorsement', 'This airplane needs a tailwheel endorsement'])
  })
  it('sport pilot: LSA only, day only', () => {
    const t = titles(base({ certs: { certificate: 'sport', medical: { kind: 'license' }, flightReview: '2026-05-01' }, night: true }))
    expect(t).toEqual(expect.arrayContaining(['No night flight on a sport pilot certificate', 'Not a light-sport aircraft']))
  })
  it('medical expiry follows §61.23(d) calendar months', () => {
    expect(medicalExpiry({ kind: 'third', date: '2026-01-10', under40: true })?.toDateString()).toBe(new Date(2031, 0, 31).toDateString())
    expect(medicalExpiry({ kind: 'third', date: '2026-01-10', under40: false })?.toDateString()).toBe(new Date(2028, 0, 31).toDateString())
    expect(medicalExpiry({ kind: 'basicmed', date: '2025-03-02', course: '2026-05-01' })?.toDateString()).toBe(new Date(2028, 4, 31).toDateString())
  })
})

describe('weather cards for a round trip', () => {
  const w = (role: WxAt['role'], at: string, spd: number, id = 'KRHV') => ({
    airport: { id, icao: id }, at: new Date(at), role, category: 'VFR', wind: { dir: 300, spd, gust: null, from: 'taf' }, ceiling: 25000, visib: 6, altimInHg: 30.15, tempC: 17, da: 122, night: true,
  }) as unknown as WxAt
  it('puts departure and destination at one airport on one card and lists only what changed', () => {
    const g = byAirport([w('departure', '2026-11-10T19:00', 7), w('destination', '2026-11-10T19:32', 12), w('alternate', '2026-11-10T20:00', 7, 'KSJC')])
    expect(g.map(x => x.length)).toEqual([2, 1])
    expect(wxDiff(g[0][0], g[0][1])).toEqual([{ k: 'Wind', from: '300° 7 kt', to: '300° 12 kt' }])
    expect(wxDiff(g[0][0], w('destination', '2026-11-10T19:32', 7))).toEqual([])
  })
})

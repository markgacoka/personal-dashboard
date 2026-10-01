import { describe, expect, test } from 'vitest'
import { computeCurrency, route } from './flying'
import { sportOf } from './sports'
import type { Flight } from './types'

const asOf = new Date('2026-09-08T12:00:00').getTime()
const flight = (date: string, extra: Partial<Flight> = {}) => ({ date, approaches: [], ...extra }) as unknown as Flight
const cur = (flights: Flight[]) => Object.fromEntries(computeCurrency(flights, asOf).map(c => [c.key, c]))

describe('computeCurrency — §61.57 / §61.56', () => {
  test('recent day take-offs and full-stop landings → day VFR current', () => {
    expect(cur([flight('2026-08-26T00:00:00.000Z', { day_takeoffs: 4, day_landings_full_stop: 4 })]).day.state).toBe('current')
  })
  test('ISO timestamps and date-only strings are the same calendar day', () => {
    const a = cur([flight('2026-08-26T00:00:00.000Z', { day_takeoffs: 3, day_landings_full_stop: 3 })]).day
    const b = cur([flight('2026-08-26', { day_takeoffs: 3, day_landings_full_stop: 3 })]).day
    expect(a).toEqual(b)
  })
  test('falls back to the generic take-off and landing columns', () => {
    expect(cur([flight('2026-08-26', { takeoffs: 3, landings: 3 })]).day.state).toBe('current')
  })
  test('older than 90 days does not count; 89 days does', () => {
    expect(cur([flight('2026-06-07', { day_takeoffs: 3, day_landings_full_stop: 3 })]).day.state).toBe('lapsed')
    const d = new Date(asOf); d.setDate(d.getDate() - 89)
    expect(cur([flight(d.toISOString(), { day_takeoffs: 3, day_landings_full_stop: 3 })]).day.state).not.toBe('lapsed')
  })
  test('two of each is not enough', () => {
    expect(cur([flight('2026-08-26', { day_takeoffs: 2, day_landings_full_stop: 2 })]).day.state).toBe('lapsed')
  })
  test('days until lapse count from the operation that completes 3 + 3', () => {
    // Aug 26 + 90 days = Nov 24; from Sep 8 that is 77 days.
    expect(cur([flight('2026-08-26', { day_takeoffs: 3, day_landings_full_stop: 3 })]).day.daysLeft).toBe(77)
  })
  test('night currency uses the night columns only', () => {
    expect(cur([flight('2026-08-26', { day_takeoffs: 5, day_landings_full_stop: 5 })]).night.state).toBe('lapsed')
    expect(cur([flight('2026-08-26', { night_takeoffs: 3, night_landings_full_stop: 3 })]).night.state).toBe('current')
  })
  test('6 approaches in 6 months → instrument current; the next 6 months are a grace period', () => {
    const six = Array.from({ length: 6 }, () => ({ approach_type: 'RNAV', airport_icao: 'KRHV' }))
    expect(cur([flight('2026-08-01', { approaches: six })]).ifr.state).toBe('current')
    expect(cur([flight('2026-01-15', { approaches: six })]).ifr.state).toBe('grace')
    expect(cur([]).ifr.state).toBe('na')
  })
  test('flight review every 24 calendar months', () => {
    expect(cur([flight('2025-09-10', { flight_review: true })]).review.state).toBe('current')
    expect(cur([flight('2024-01-01', { flight_review: true })]).review.state).toBe('lapsed')
    expect(cur([]).review.daysLeft).toBeNull()
  })
})

describe('route', () => {
  const a = (icao: string) => ({ icao })
  test('direct, via stops and local patterns', () => {
    expect(route({ departure: a('KSQL'), arrival: a('KLVK'), via: [] }).join(' → ')).toBe('KSQL → KLVK')
    expect(route({ departure: a('KSQL'), arrival: a('KSQL'), via: ['KLVK', 'KRHV'] }).join(' → ')).toBe('KSQL → KLVK → KRHV → KSQL')
    expect(route({ departure: a('KSQL'), arrival: a('KSQL'), via: null }).join(' → ')).toBe('KSQL → KSQL')
  })
})

describe('sportOf', () => {
  const s = (typeKey?: string | null) => sportOf({ activityType: typeKey == null ? undefined : { typeKey } })
  test('Garmin type keys map to sports', () => {
    expect(['running', 'treadmill_running', 'trail_running'].map(s)).toEqual(['running', 'running', 'running'])
    expect(['cycling', 'road_biking', 'indoor_cycling'].map(s)).toEqual(['cycling', 'cycling', 'cycling'])
    expect([s('lap_swimming'), s('indoor_rowing'), s('yoga'), s('strength_training'), s('hiking')]).toEqual(['swimming', 'rowing', 'yoga', 'strength', 'hiking'])
  })
  test('unknown falls back to other', () => { expect(s('bogus_activity')).toBe('other'); expect(s('')).toBe('other'); expect(s(null)).toBe('other') })
})

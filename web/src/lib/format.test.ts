import { describe, expect, test } from 'vitest'
import { bytes, duration, hours, mailDate, miles, pace } from './format'

describe('miles', () => {
  test('nothing for zero or missing', () => { expect(miles(0)).toBeNull(); expect(miles(null)).toBeNull() })
  test('marathon in miles', () => expect(miles(42195)).toMatch(/^26\.\d+ mi$/))
  test('5 km is about 3.11 mi', () => expect(miles(5000)).toMatch(/^3\.1\d mi$/))
  test('very short distances fall back to metres', () => expect(miles(10)).toBe('10 m'))
})

describe('duration', () => {
  test('nothing for zero', () => expect(duration(0)).toBeNull())
  test('seconds only', () => expect(duration(45)).toBe('45s'))
  test('minutes and seconds', () => expect(duration(90)).toBe('1m 30s'))
  test('hours and minutes', () => { expect(duration(3660)).toBe('1h 01m'); expect(duration(14400)).toBe('4h 00m') })
})

describe('pace', () => {
  test('nothing for zero', () => expect(pace(0)).toBeNull())
  test('8 min/mi and 6 min/mi', () => { expect(pace(3.355)).toMatch(/^7:\d\d \/mi$/); expect(pace(4.47)).toMatch(/^6:\d\d \/mi$/) })
})

describe('hours', () => {
  test('nothing for zero or missing', () => { expect(hours(0)).toBeNull(); expect(hours(null)).toBeNull() })
  test('one decimal, string input from Postgres numerics', () => { expect(hours(1.5)).toBe('1.5'); expect(hours('3.2')).toBe('3.2'); expect(hours(1.05)).toBe('1.1') })
})

describe('mail formatting', () => {
  test('list dates: time today, month/day this year, with year before', () => {
    const now = new Date(2026, 8, 28, 15, 0)
    expect(mailDate(new Date(2026, 8, 28, 9, 5).toISOString(), now)).toMatch(/9:05\s?AM/)
    expect(mailDate(new Date(2026, 1, 3).toISOString(), now)).toBe('Feb 3')
    expect(mailDate(new Date(2025, 1, 3).toISOString(), now)).toBe('Feb 3, 2025')
    expect(mailDate('garbage', now)).toBe('')
  })
  test('sizes', () => { expect(bytes(0)).toBe('0 B'); expect(bytes(2048)).toBe('2 KB'); expect(bytes(3.5 * 1024 * 1024)).toBe('3.5 MB') })
})

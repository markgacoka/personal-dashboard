import { describe, expect, test } from 'vitest'
import { parseToken, schedulePresets } from './compose-utils'

describe('composer helpers', () => {
  test('recipient tokens', () => {
    expect(parseToken('Ana Lee <ana@x.test>,')).toEqual({ name: 'Ana Lee', email: 'ana@x.test' })
    expect(parseToken('bob@y.test')).toEqual({ name: null, email: 'bob@y.test' })
    expect(parseToken('not an email')).toBeNull()
  })
  test('send-later presets are in the future and Monday is next Monday', () => {
    const now = new Date(2026, 8, 28, 10, 0) // a Monday morning
    const presets = schedulePresets(now)
    expect(presets.every(p => p.at > now)).toBe(true)
    const monday = presets.find(p => p.label === 'Monday morning')!.at
    expect(monday.getDay()).toBe(1)
    expect(monday.getDate()).toBe(5)
    expect(presets.some(p => p.label === 'This evening')).toBe(true)
    expect(schedulePresets(new Date(2026, 8, 28, 18, 0)).some(p => p.label === 'This evening')).toBe(false)
  })
})

import { describe, expect, test } from 'vitest'
import { seatPerson, usedBy } from './profiles'

const base = { seats: { pilot: 170, front: 0, rearL: 0, rearR: 0 }, seatPeople: { pilot: 'self' }, crew: { role: 'pic' as const } }

describe('seatPerson', () => {
  test('copies the profile weight into the seat and names who sits there', () => {
    const out = seatPerson(base, 'rearL', { id: 'a', weightLb: 140, role: 'passenger' })
    expect(out.seats?.rearL).toBe(140)
    expect(out.seatPeople).toEqual({ pilot: 'self', rearL: 'a' })
  })
  test('a profile without a weight keeps the weight already typed', () => {
    const out = seatPerson({ ...base, seats: { ...base.seats, rearR: 155 } }, 'rearR', { id: 'b', weightLb: null })
    expect(out.seats?.rearR).toBe(155)
  })
  test('moving someone empties the seat they left', () => {
    const p = { ...base, seats: { ...base.seats, rearL: 140 }, seatPeople: { pilot: 'self', rearL: 'a' } }
    const out = seatPerson(p, 'rearR', { id: 'a', weightLb: 140 })
    expect(out.seats).toEqual({ pilot: 170, front: 0, rearL: 0, rearR: 140 })
    expect(out.seatPeople).toEqual({ pilot: 'self', rearR: 'a' })
  })
  test('an instructor in the right seat makes the flight dual with them', () => {
    const out = seatPerson(base, 'front', { id: 'c', weightLb: 180, name: 'Sam Lee', role: 'instructor' })
    expect(out.crew).toEqual({ role: 'dual', instructor: 'Sam Lee' })
  })
  test('clearing a seat forgets who sat there but keeps the weight', () => {
    const out = seatPerson(base, 'pilot', null)
    expect(out.seatPeople).toEqual({})
    expect(out.seats).toBeUndefined()
  })
})

describe('usedBy', () => {
  const plans = [
    { data: { route: ['KRHV', 'KSNS'], tail: 'N739HE', crew: { pilotId: 'p1' }, seatPeople: { front: 'p2' } } },
    { data: { route: ['KPAO', 'KRHV*', 'KMRY'], tail: 'N227AN', alternate: 'KSNS', crew: { instructorId: 'p2' } } },
  ] as unknown as Parameters<typeof usedBy>[0]
  test('counts flights that load an aircraft, airport or person', () => {
    expect(usedBy(plans, 'aircraft', 'N739HE')).toBe(1)
    expect(usedBy(plans, 'airports', 'KRHV')).toBe(2)
    expect(usedBy(plans, 'airports', 'KSNS')).toBe(2)
    expect(usedBy(plans, 'pilots', 'p2')).toBe(2)
    expect(usedBy(plans, 'pilots', 'p9')).toBe(0)
    expect(usedBy(undefined, 'pilots', 'p1')).toBe(0)
  })
})

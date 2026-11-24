import { describe, expect, test } from 'vitest'
import type { Check, Derived, Plan } from './model'
import { readiness, sectionOf, sectionState } from './readiness'

const d = (checks: Check[]) => ({ checks }) as unknown as Derived
const plan = { route: ['KRHV', 'KSNS'], checklist: {} } as unknown as Plan
const ctx = { tail: 'N739HE', profileSaved: true, checklistSteps: 12, pohExact: true, inspections: true, certsSaved: true, briefed: true }

describe('readiness', () => {
  test('open checks become tasks in their section, worst first; passes and notes do not', () => {
    const t = readiness(d([
      { section: 'loading', status: 'todo', title: 'Enter the pilot\'s weight' },
      { section: 'pilot', status: 'nogo', title: 'No solo endorsement recorded', fix: 'Enter its date' },
      { section: 'weather', status: 'note', title: 'No METAR or TAF within 25 nm of KRHV' },
      { section: 'navlog', status: 'ok', title: 'Fuel covers the trip and reserve' },
    ]), plan, ctx)
    expect(t.map(x => [x.section, x.kind])).toEqual([['pilot', 'nogo'], ['loading', 'todo']])
    expect(t[0].detail).toBe('Enter its date')
  })
  test('missing context is recommended, never a verdict item', () => {
    const t = readiness(d([]), plan, { ...ctx, checklistSteps: 0, pohExact: false, briefed: false })
    expect(t.map(x => x.id).sort()).toEqual(['briefing', 'checklist', 'poh'])
    expect(t.every(x => x.kind === 'recommended')).toBe(true)
  })
  test('runway data and the FAA cycle belong to airports; distances to weight and performance', () => {
    expect(sectionOf({ section: 'performance', status: 'note', title: 'KXYZ: no runway data' })).toBe('airports')
    expect(sectionOf({ section: 'performance', status: 'caution', title: 'KRHV takeoff RWY 31R: less than the ASI +50 % margin' })).toBe('loading')
    expect(sectionOf({ section: 'trip', status: 'todo', title: 'Set the departure time' })).toBe('route')
    expect(sectionOf({ section: 'loading', status: 'todo', title: 'Enter N739HE\'s empty weight' })).toBe('aircraft')
  })
  test('a section is done when nothing is open, else its worst task', () => {
    const t = readiness(d([{ section: 'aircraft', status: 'todo', title: 'x' }, { section: 'aircraft', status: 'caution', title: 'y' }]), plan, ctx)
    expect(sectionState(t, 'aircraft')).toBe('caution')
    expect(sectionState(t, 'pilot')).toBe('done')
  })
})

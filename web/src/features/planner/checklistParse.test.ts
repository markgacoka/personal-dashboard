import { describe, expect, it } from 'vitest'
import { formatChecklist, parseChecklist, stepCount } from './checklistParse'

describe('checklist text → steps', () => {
  it('reads POH style with notes, sub-steps, OCR digits and wrapped lines', () => {
    const s = parseChecklist(`BEFORE STARTING ENGINE
   1.   Preflight Inspection -- COMPLETE.
   5.   Avionics Power Switch -- OFF.

                               CAUTION
        The avionics power switch must be OFF during engine
        start to prevent possible damage to avionics.

   B.   Fuel Selector Valve -- BOTH.

BEFORE TAKEOFF
  10.      Throttle -- 1700 RPM.
           a. Magnetos -- CHECK (RPM drop should not exceed 125 RPM on
               either magneto or 50 RPM differential between magnetos).
           b. Carburetor Heat -- CHECK (for RPM drop).
      1.   Wing Flaps -- 0' - 10'.`)
    expect(s.map(x => x.title)).toEqual(['BEFORE STARTING ENGINE', 'BEFORE TAKEOFF'])
    expect(s[0].items).toEqual([
      { item: 'Preflight Inspection', action: 'COMPLETE' },
      { item: 'Avionics Power Switch', action: 'OFF' },
      { item: 'CAUTION: The avionics power switch must be OFF during engine start to prevent possible damage to avionics.' },
      { item: 'Fuel Selector Valve', action: 'BOTH' },
    ])
    expect(s[1].items[1]).toEqual({ item: 'Magnetos', action: 'CHECK (RPM drop should not exceed 125 RPM on either magneto or 50 RPM differential between magnetos)', sub: true })
    expect(s[1].items[3]).toEqual({ item: 'Wing Flaps', action: "0' - 10'" })
  })

  it('reads leader dots and right-aligned actions, and drops page furniture', () => {
    const page = (n: number, body: string) => `N227AN CHECKLIST\n${body}\n\nRev 2          Page ${n}`
    const s = parseChecklist([
      page(1, 'Run-up:\nParking brake ............ SET\nMixture . . . . . . RICH\nThrottle                 1700 RPM'),
      page(2, 'Before landing:\nFuel selector ..... BOTH'),
      page(3, 'Shutdown:\nMagnetos ..... OFF'),
    ].join('\f'))
    expect(s.map(x => x.title)).toEqual(['Run-up', 'Before landing', 'Shutdown'])
    expect(s[0].items).toEqual([{ item: 'Parking brake', action: 'SET' }, { item: 'Mixture', action: 'RICH' }, { item: 'Throttle', action: '1700 RPM' }])
    expect(stepCount(s)).toBe(5)
  })

  it('splits a two-column page into left then right', () => {
    const L = ['BEFORE TAKEOFF', 'Parking Brake -- SET and HOLD', 'Flight Controls -- FREE and CORRECT', 'Fuel Selector -- BOTH positions', 'Mixture -- RICH below 3000 ft']
    const R = ['AFTER LANDING', 'Wing Flaps -- UP after clearing', 'Carburetor Heat -- COLD position', 'Transponder -- STANDBY or GND', 'Lights -- AS REQUIRED for taxi']
    const text = L.map((l, i) => l.padEnd(44) + R[i]).join('\n')
    expect(parseChecklist(text).map(x => [x.title, x.items.length])).toEqual([['BEFORE TAKEOFF', 4], ['AFTER LANDING', 4]])
  })

  it('round-trips through the editable text form', () => {
    const s = parseChecklist('# Run-up\nThrottle -- 1700 RPM\n  a. Magnetos -- CHECK\n  b. Carb heat -- CHECK\n\n# Takeoff\nFlaps -- 0-10')
    expect(parseChecklist(formatChecklist(s))).toEqual(s)
    expect(s[0].items[2]).toEqual({ item: 'Carb heat', action: 'CHECK', sub: true })
  })
})

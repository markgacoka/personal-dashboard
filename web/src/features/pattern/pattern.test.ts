import { describe, expect, test } from 'vitest'
import { AIRPORTS } from './airports'
import { angleDiff, bearing, components, findEnd, legAt, legPoint, polar, rankEnds, descentPlan, smooth, sampleAt, compass8 } from './geo'
import { spoken } from './radio'
import { makeDrill, whereRelative } from './drill'
import { SCENARIOS } from './scenarios'
import { atPoint, flyTrack, grade } from './model'

const near = (a: number, b: number, tol = 0.15) => expect(Math.abs(a - b)).toBeLessThan(tol)

describe('wind components', () => {
  test('210 at 12 on runway 20 (198°): ~11.7 head, ~2.5 from the right', () => {
    const c = components({ dir: 210, spd: 12 }, 198)
    near(c.head, 11.74); near(c.cross, 2.49)
  })
  test('crosswind from the left is negative', () => expect(components({ dir: 280, spd: 16 }, 297).cross).toBeLessThan(0))
  test('Tracy 280 at 16 favours runway 30 over 26', () => expect(rankEnds(AIRPORTS.KTCY.runways, { dir: 280, spd: 16 })[0].e.ident).toBe('30'))
  test('closed runways are skipped', () => expect(rankEnds(AIRPORTS.KTCY.runways, { dir: 280, spd: 16 }, ['30'])[0].e.ident).toBe('26'))
})

describe('pattern sides', () => {
  test('left traffic runway 20 at WVI: downwind east of the field', () => expect(legPoint(findEnd(AIRPORTS.KWVI.runways, '20'), 'mid')[0]).toBeGreaterThan(0.5))
  test('right traffic 31R at RHV: downwind northeast', () => { const p = legPoint(findEnd(AIRPORTS.KRHV.runways, '31R'), 'mid'); expect(compass8(bearing([0, 0], p))).toBe('northeast') })
  test('left traffic 31L at RHV: downwind southwest', () => { const p = legPoint(findEnd(AIRPORTS.KRHV.runways, '31L'), 'mid'); expect(compass8(bearing([0, 0], p))).toBe('southwest') })
  test('right traffic 30 at HAF stays inland (northeast)', () => expect(legPoint(findEnd(AIRPORTS.KHAF.runways, '30'), 'mid')[1]).toBeGreaterThan(0.3))
})

describe('navigation helpers', () => {
  test('polar and bearing round-trip', () => { near(bearing([0, 0], polar(33, 10)), 33, 0.01); near(bearing(polar(33, 10), [0, 0]), 213, 0.01) })
  test('descent: 2,335 ft at 500 fpm and 105 kt is ~8.2 nm', () => near(descentPlan(3500, 1165, 105).nm, 8.17, 0.05))
  test('smoothed track passes through its waypoints and heads the right way', () => {
    const t = smooth([{ p: [0, 0], alt: 1000 }, { p: [0, 1], alt: 1000 }, { p: [1, 1], alt: 500 }])
    expect(t[0].p).toEqual([0, 0]); expect(t.at(-1)!.p).toEqual([1, 1]); expect(t.at(-1)!.alt).toBe(500)
    near(angleDiff(sampleAt(t, 0.1).hdg, 0), 0, 12); near(angleDiff(sampleAt(t, 0.95).hdg, 90), 0, 12)
  })
})

describe('spoken phraseology', () => {
  test('call sign letters are phonetic', () => expect(spoken('Cessna 6512K')).toBe('Cessna six five one two kilo'))
  test('wind and runway', () => expect(spoken('Wind 210 at 12, runway 31R')).toBe('Wind two one zero at one two, runway three one right'))
  test('altitudes in thousands and hundreds', () => { expect(spoken('3,500')).toBe('three thousand five hundred'); expect(spoken('3,000')).toBe('three thousand'); expect(spoken('1,165')).toBe('one one six five') })
  test('frequency and altimeter', () => { expect(spoken('122.8')).toBe('one two two point eight'); expect(spoken('Altimeter 30.02')).toBe('Altimeter three zero zero two') })
  test('time and niner', () => expect(spoken('1955Z')).toBe('one niner five five zulu'))
  test('distances stay natural', () => expect(spoken('10 miles northeast')).toBe('10 miles northeast'))
})

describe('scenario integrity', () => {
  for (const sc of SCENARIOS) {
    const ap = AIRPORTS[sc.airport]
    test(`${sc.id}: airport, answers, runways and paths resolve`, () => {
      expect(ap).toBeTruthy()
      for (const st of sc.steps) {
        const from = { p: atPoint(ap, st.at), alt: st.alt }
        const q = st.q
        if (q.kind === 'choice') expect(q.options.map(o => o.id)).toContain(q.answer)
        if (q.kind === 'multi') for (const a of q.answer) expect(q.options.map(o => o.id)).toContain(a)
        if (q.kind === 'order') expect(new Set(q.items.map(i => i.id)).size).toBe(q.items.length)
        if (q.kind !== 'order') for (const o of q.options) {
          if (o.rwy) expect(() => findEnd(ap.runways, o.rwy!)).not.toThrow()
          if (o.fly) expect(flyTrack(ap, o.fly, from).length).toBeGreaterThan(2)
        }
        if (st.after?.fly) expect(flyTrack(ap, st.after.fly, from).length).toBeGreaterThan(2)
        if (st.scene?.pattern) expect(() => findEnd(ap.runways, st.scene!.pattern!)).not.toThrow()
      }
    })
  }
  test('runway-choice answers match the wind', () => {
    for (const sc of SCENARIOS) for (const st of sc.steps) {
      const q = st.q
      if (q.kind !== 'choice' || !q.options.every(o => o.rwy) || (st.wind ?? sc.wind).spd === 0) continue
      expect(rankEnds(AIRPORTS[sc.airport].runways, st.wind ?? sc.wind)[0].e.ident).toBe(q.answer)
    }
  })
})

describe('drill', () => {
  let seed = 7
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  test('every generated drill has a valid answer for every question', () => {
    for (let i = 0; i < 200; i++) {
      const d = makeDrill(rng)
      for (const st of d.steps) {
        const q = st.q
        if (q.kind === 'choice') {
          expect(q.options.map(o => o.id)).toContain(q.answer)
          expect(new Set(q.options.map(o => o.id)).size).toBe(q.options.length)
        }
      }
    }
  })
  test('position relative to the pattern', () => {
    const e = findEnd(AIRPORTS.KWVI.runways, '20')
    expect(whereRelative(e, polar(90, 5)).patternSide).toBe(true)
    expect(whereRelative(e, polar(270, 5)).patternSide).toBe(false)
    expect(whereRelative(e, polar(0, 6)).end).toBe('approach')
  })
})

describe('grading', () => {
  test('multi needs exactly the right set, order needs the exact sequence', () => {
    const multi = { kind: 'multi' as const, prompt: '', why: '', options: [], answer: ['a', 'b'] }
    expect(grade(multi, ['b', 'a'])).toBe(true)
    expect(grade(multi, ['a', 'b', 'c'])).toBe(false)
    const order = { kind: 'order' as const, prompt: '', why: '', items: [{ id: 'x', label: '' }, { id: 'y', label: '' }] }
    expect(grade(order, ['x', 'y'])).toBe(true)
    expect(grade(order, ['y', 'x'])).toBe(false)
  })
})

describe('leg narration', () => {
  const e = findEnd(AIRPORTS.KWVI.runways, '20')
  const legOf = (leg: Parameters<typeof legPoint>[1]) => {
    const tr = flyTrack(AIRPORTS.KWVI, { circuit: '20' }, { p: [0, 0], alt: 1165 })
    const p = legPoint(e, leg)
    const s = tr.reduce((a, b) => (Math.hypot(b.p[0] - p[0], b.p[1] - p[1]) < Math.hypot(a.p[0] - p[0], a.p[1] - p[1]) ? b : a))
    return legAt(e, s, AIRPORTS.KWVI.elev)
  }
  test('downwind', () => expect(legOf('mid')).toBe('Left downwind'))
  test('base', () => expect(legOf('baseMid')).toBe('Left base'))
  test('final', () => expect(legOf('final')).toBe('Final'))
  test('crosswind', () => expect(legOf('crosswind')).toBe('Left crosswind'))
  test('a 45 entry is named', () => {
    const tr = flyTrack(AIRPORTS.KWVI, { entry: '45', rwy: '20' }, { p: atPoint(AIRPORTS.KWVI, { entry45: '20' }), alt: 1165 })
    expect(legAt(e, sampleAt(tr, 0.3), AIRPORTS.KWVI.elev)).toBe('45° entry to downwind')
  })
})

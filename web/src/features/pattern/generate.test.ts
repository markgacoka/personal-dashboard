import { describe, expect, test } from 'vitest'
import fixture from './nasr.fixture.json'
import { bearing, findEnd, runwayEnds } from './geo'
import { assessEnds, calmWindRunway, chooseRunway, generateConditions, liveConditions, makeArrival, type Conditions } from './generate'
import { flyTrack, atPoint } from './model'
import { spokenName, toAirport, type NasrAirport } from './nasr'

const recs = fixture as unknown as NasrAirport[]
const rec = (id: string) => recs.find(r => r.id === id)!
const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const cond = (r: NasrAirport, over: Partial<Conditions>): Conditions => ({ ...generateConditions(r, seeded(3)), ...over })

describe('FAA record → map geometry', () => {
  test('RHV: 31R is right traffic and lies northeast of 31L', () => {
    const ap = toAirport(rec('RHV'))
    const r31R = findEnd(ap.runways, '31R'), r31L = findEnd(ap.runways, '31L')
    expect(r31R.side).toBe('R'); expect(r31L.side).toBe('L')
    const d: [number, number] = [r31R.threshold[0] - r31L.threshold[0], r31R.threshold[1] - r31L.threshold[1]]
    const right: [number, number] = [r31R.dir[1], -r31R.dir[0]]
    expect(d[0] * right[0] + d[1] * right[1]).toBeGreaterThan(0)
  })
  test('WVI runway 02 is ~018° magnetic (032° true, 14° E variation)', () => {
    expect(Math.abs(findEnd(toAirport(rec('WVI')).runways, '02').hdg - 18)).toBeLessThanOrEqual(2)
  })
  test('pattern altitude: published AGL value, else 1,000 AGL', () => {
    expect(toAirport(rec('TCY')).tpa).toBe(Math.round(rec('TCY').elev + 800))
    expect(toAirport(rec('WVI')).tpa).toBe(Math.round(rec('WVI').elev + 1000))
  })
  test('spoken names', () => {
    expect(spokenName(rec('RHV'))).toBe('Reid-Hillview')
    expect(spokenName(rec('WVI'))).toBe('Watsonville')
    expect(spokenName(rec('SFO'))).toBe('San Francisco')
  })
})

describe('runway choice', () => {
  test('Tracy 280 at 16 → 30', () => {
    const r = rec('TCY'), c = cond(r, { wind: { dir: 280, spd: 16 }, closures: [] })
    expect(chooseRunway(r, assessEnds(r, toAirport(r), c), c.wind)!.end.e.ident).toBe('30')
  })
  test('published calm-wind runway in light wind', () => {
    expect(calmWindRunway(rec('WVI'))).toBe('20')
    const r = rec('WVI'), c = cond(r, { wind: { dir: 90, spd: 3 }, closures: [] })
    expect(chooseRunway(r, assessEnds(r, toAirport(r), c), c.wind)!.end.e.ident).toBe('20')
  })
  test('a closed runway is never chosen', () => {
    const r = rec('TCY'), c = cond(r, { wind: { dir: 280, spd: 16 }, closures: ['12/30'] })
    expect(chooseRunway(r, assessEnds(r, toAirport(r), c), c.wind)!.end.e.ident).toBe('26')
  })
  test('live METAR wind is converted from true to magnetic; NOTAM closures parsed', () => {
    const r = rec('WVI')
    const c = liveConditions(r, { wdir: 224, wspd: 12, visib: '10+', temp: 19, dewp: 11, altim: 1016.6, clouds: [] }, 'KWVI', ['RWY 09/27 CLSD 2610161400-2610162300', 'RWY 02/20 CLSD MON-FRI 0700-1500'], 12, seeded(1))
    expect(c.wind.dir).toBe(210)
    expect(c.closures).toEqual(['09/27'])
    expect(c.altimInHg).toBeCloseTo(30.02, 2)
  })
})

describe('generated arrivals', () => {
  test('every question has a valid answer and every path resolves, for every fixture airport and many seeds', () => {
    for (const r of recs) for (let s = 1; s < 60; s++) {
      const rng = seeded(s * 7919)
      const sc = makeArrival(r, generateConditions(r, rng), rng)
      const ap = sc.ap!
      expect(sc.steps.length).toBeGreaterThan(1)
      for (const st of sc.steps) {
        const from = { p: atPoint(ap, st.at), alt: st.alt }
        const q = st.q
        if (q.kind === 'choice') expect(q.options.map(o => o.id)).toContain(q.answer)
        if (q.kind === 'multi') { expect(q.answer.length).toBeGreaterThan(0); for (const a of q.answer) expect(q.options.map(o => o.id)).toContain(a) }
        if (q.kind !== 'order') for (const o of q.options) if (o.fly) expect(flyTrack(ap, o.fly, from).length).toBeGreaterThan(2)
        if (st.after?.fly) expect(flyTrack(ap, st.after.fly, from).length).toBeGreaterThan(2)
      }
    }
  })
  test('traffic-direction answers follow the FAA right-traffic flag', () => {
    const r = rec('RHV')
    for (let s = 1; s < 40; s++) {
      const sc = makeArrival(r, generateConditions(r, seeded(s * 31)), seeded(s))
      const st = sc.steps.find(x => x.title === 'Traffic direction')
      if (!st || st.q.kind !== 'choice') continue
      const rwy = st.q.prompt.match(/runway (\S+),/)![1]
      const ok = st.q.options.find(o => o.id === 'ok')!.label
      expect(ok.startsWith(findEnd(sc.ap!.runways, rwy).side === 'R' ? 'Right' : 'Left')).toBe(true)
    }
  })
  test('high fields get a density-altitude step', () => {
    const r = rec('LXV')
    const sc = makeArrival(r, cond(r, { wind: { dir: rec('LXV').runways[0].ends[0].trueHdg! - r.magVar, spd: 8 }, ceilingAgl: null, visSm: 10, closures: [] }), seeded(5))
    expect(sc.steps.some(s => s.title === 'High and hot')).toBe(true)
  })
  test('the runway-choice answer is the most headwind usable runway', () => {
    for (const r of recs) for (let s = 1; s < 30; s++) {
      const c = generateConditions(r, seeded(s * 101))
      const sc = makeArrival(r, c, seeded(s))
      const st = sc.steps.find(x => x.phase === 'Weather')
      if (!st || st.q.kind !== 'choice' || c.wind.spd <= 4) continue
      const ends = assessEnds(r, sc.ap!, c).filter(x => x.ok)
      const bestHead = Math.max(...ends.map(x => x.head))
      expect(ends.find(x => x.e.ident === (st.q as { answer: string }).answer)!.head).toBeCloseTo(bestHead, 5)
    }
  })
  test('runway ends are drawn where the FAA puts them', () => {
    const ap = toAirport(rec('SFO'))
    const e = ap.runways.flatMap(runwayEnds)
    expect(e.length).toBeGreaterThanOrEqual(8)
    expect(Math.abs(bearing(findEnd(ap.runways, '28L').threshold, findEnd(ap.runways, '28L').departureEnd) - findEnd(ap.runways, '28L').hdg)).toBeLessThan(1)
  })
})

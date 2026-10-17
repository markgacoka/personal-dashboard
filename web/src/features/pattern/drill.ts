import { AIRPORTS } from './airports'
import { add, bearing, compass8, components, dist, fmtHdg, norm360, polar, rankEnds, runwayEnds, PATTERN_OFFSET, type Pt, type RunwayEnd, type Wind } from './geo'
import type { Opt, Scenario, Step } from './model'

type Rng = () => number
const pick = <T,>(rng: Rng, xs: T[]) => xs[Math.floor(rng() * xs.length)]
const shuffle = <T,>(rng: Rng, xs: T[]) => xs.map(x => [rng(), x] as const).sort((a, b) => a[0] - b[0]).map(x => x[1])
const r5 = (h: number) => Math.round(h / 5) * 5

export function whereRelative(e: RunwayEnd, pos: Pt) {
  const M = add(e.threshold, e.dir, e.lengthNm / 2)
  const v: Pt = [pos[0] - M[0], pos[1] - M[1]]
  const s = v[0] * e.out[0] + v[1] * e.out[1]
  const u = v[0] * e.dir[0] + v[1] * e.dir[1]
  const end = u > e.lengthNm / 2 + 0.5 ? 'departure' : u < -e.lengthNm / 2 - 0.5 ? 'approach' : 'abeam'
  return { patternSide: s > 0, end: end as 'departure' | 'approach' | 'abeam' }
}

const describe = (end: 'departure' | 'approach' | 'abeam', patternSide: boolean, rwy: string) =>
  `${end === 'abeam' ? 'Abeam the runway' : `Off the ${end} end of ${rwy}`}, on the ${patternSide ? 'pattern' : 'non-pattern'} side`

export function makeDrill(rng: Rng = Math.random): Scenario {
  const ap = AIRPORTS[pick(rng, Object.keys(AIRPORTS))]
  const wind: Wind = { dir: Math.round((rng() * 360) / 10) * 10 || 360, spd: 5 + Math.floor(rng() * 12) }
  const best = rankEnds(ap.runways, wind)[0].e
  const brgFrom = Math.round(rng() * 360)
  const nm = Math.round((6 + rng() * 4) * 10) / 10
  const pos = polar(brgFrom, nm)
  const alt = 3000 + Math.floor(rng() * 4) * 500
  const hdg = r5(bearing(pos, [0, 0]))
  const at = { polar: [brgFrom, nm] as [number, number] }
  const base = { at, alt, hdg, gs: 105 }
  const wtxt = `${fmtHdg(wind.dir)} at ${wind.spd}`
  const traffic = `${best.side === 'L' ? 'left' : 'right'} traffic`

  const ends = ap.runways.flatMap(runwayEnds)
  const rwyOpts: Opt[] = ends.map(e => {
    const c = components(wind, e.hdg)
    const hw = Math.round(c.head), xw = Math.round(Math.abs(c.cross))
    return { id: e.ident, rwy: e.ident, label: `Runway ${e.ident}`, why: `${hw >= 0 ? `${hw} kt headwind` : `${-hw} kt tailwind`}, ${xw} kt crosswind${xw ? ` from the ${c.cross > 0 ? 'right' : 'left'}` : ''}.` }
  })

  const sideBrg = bearing([0, 0], best.out)
  const sides = shuffle(rng, [0, 90, 180, 270].map(d => compass8(sideBrg + d)))
  const correctSide = compass8(sideBrg)

  const rel = whereRelative(best, pos)
  const relOpts = shuffle(rng, [
    { id: 'ok', end: rel.end, side: rel.patternSide },
    { id: 's', end: rel.end, side: !rel.patternSide },
    { id: 'e', end: rel.end === 'approach' ? 'departure' : 'approach', side: rel.patternSide },
    { id: 'es', end: rel.end === 'approach' ? 'departure' : 'approach', side: !rel.patternSide },
  ] as const)

  const entry = rel.patternSide ? '45' : 'overfly'
  const M = add(best.threshold, best.dir, best.lengthNm / 2)
  const p45 = add(add(M, best.out, PATTERN_OFFSET + 1.5), best.dir, 1.5)
  const h45 = r5(bearing(pos, p45))
  const hdgOpts = shuffle(rng, [...new Set([h45, norm360(h45 + 180), norm360(h45 + 60), norm360(h45 - 60)].map(r5))])

  const steps: Step[] = [
    {
      ...base, phase: 'Weather', title: 'Pick the runway',
      situation: `${ap.name} (${ap.icao}) reports wind ${wtxt}. You are ${nm} nm ${compass8(brgFrom)} of the field at ${alt.toLocaleString()} ft.`,
      radio: [{ from: `${ap.icao} ${ap.wx?.kind ?? "weather"}`, text: `${ap.name} automated weather. Wind ${wtxt}. Visibility 10. Sky clear. Altimeter 30.01.`, voice: 2 }],
      info: [{ kind: 'supplement', title: `Chart Supplement · ${ap.icao}` }],
      q: { kind: 'choice', prompt: `Wind ${wtxt}. Which runway?`, options: rwyOpts, answer: best.ident, why: `Runway ${best.ident} (${fmtHdg(best.hdg)}°) is most closely aligned with the wind.`, refs: ['AIM 4-3-3'] },
    },
    {
      ...base, phase: 'Entry', title: 'Which side is the downwind?',
      situation: `Runway ${best.ident}, ${traffic} per the Chart Supplement.`,
      q: {
        kind: 'choice', prompt: `For runway ${best.ident} with ${traffic}, the downwind leg is on which side of the runway?`,
        options: sides.map(s => ({ id: s, label: `${s[0].toUpperCase()}${s.slice(1)} of the runway`, why: s === correctSide ? 'Correct.' : `The downwind for ${best.ident} is ${correctSide} of the runway.` })),
        answer: correctSide,
        why: `Landing heading ${fmtHdg(best.hdg)}° with ${best.side === 'L' ? 'left' : 'right'} turns puts the downwind to your ${best.side === 'L' ? 'left' : 'right'} as you land, which is ${correctSide}.`,
        refs: ['14 CFR 91.126(b)'],
      },
    },
    {
      ...base, phase: 'Position', title: 'Where are you?', hideOwnship: true, scene: { pattern: best.ident },
      situation: `Your airplane is hidden. ForeFlight: ${ap.icao} ${nm} nm, bearing to ${fmtHdg(bearing(pos, [0, 0]))}°.`,
      q: {
        kind: 'choice', prompt: `Relative to the runway ${best.ident} pattern, where are you?`,
        options: relOpts.map(o => ({ id: o.id, label: describe(o.end, o.side, best.ident), why: o.id === 'ok' ? 'Correct.' : `You are ${describe(rel.end, rel.patternSide, best.ident).toLowerCase()}.` })),
        answer: 'ok',
        why: `Bearing to the field ${fmtHdg(bearing(pos, [0, 0]))}° means you are ${fmtHdg(brgFrom)}° from it: ${compass8(brgFrom)}.`,
      },
    },
    {
      ...base, phase: 'Entry', title: 'Choose the entry', scene: { pattern: best.ident },
      situation: `You are on the ${rel.patternSide ? 'pattern' : 'non-pattern'} side of runway ${best.ident}.`,
      q: {
        kind: 'choice', prompt: 'Which entry do you fly?',
        options: [
          { id: '45', label: '45° to downwind', fly: { entry: '45', rwy: best.ident }, why: rel.patternSide ? 'Correct. You are on the pattern side.' : 'From the non-pattern side you would first need to cross the field.' },
          { id: 'overfly', label: 'Overfly midfield 500 ft above, teardrop to the 45', fly: { entry: 'overfly', rwy: best.ident }, why: rel.patternSide ? 'Unnecessary from the pattern side.' : 'Correct. This is the AC 90-66 method from the non-pattern side.' },
          { id: 'straight', label: 'Straight-in', fly: { entry: 'straight', rwy: best.ident }, why: 'Allowed, but not preferred. It bypasses the traffic flow.' },
          { id: 'base', label: 'Join on base', fly: { entry: 'base', rwy: best.ident }, why: 'Allowed, but not preferred. It skips the downwind sequence.' },
        ],
        answer: entry,
        why: 'Pattern side: fly the 45 to downwind. Non-pattern side: cross midfield 500 ft above pattern altitude, descend clear of the pattern, and teardrop onto the 45.',
        refs: ['AC 90-66', 'AIM 4-3-3'],
      },
      after: { fly: { entry, rwy: best.ident, then: 'land' } },
    },
  ]
  if (rel.patternSide && dist(pos, p45) > 1) steps.splice(3, 0, {
    ...base, phase: 'Position', title: 'Heading to the 45 entry point', scene: { pattern: best.ident },
    situation: 'You want to reach a point about 2 nm out on the 45° entry line, level at pattern altitude.',
    q: {
      kind: 'choice', prompt: 'Roughly what heading takes you to the 45° entry point?',
      options: hdgOpts.map(h => ({ id: String(h), label: `${fmtHdg(h)}°`, why: h === h45 ? 'Correct.' : `The entry point is at ${fmtHdg(h45)}° from you.` })),
      answer: String(h45),
      why: `Put the entry point on your mental picture: the downwind is ${correctSide} of the runway and the 45 begins about 2 nm upwind of midfield. From here that is about ${fmtHdg(h45)}°.`,
    },
  })
  return { id: 'drill', title: `Drill · ${ap.icao}`, airport: ap.icao, blurb: '', tags: [], wind, steps }
}

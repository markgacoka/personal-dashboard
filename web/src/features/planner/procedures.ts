import { add, angleDiff, bearing, entryPath, legPoint, norm360, patternPath, smooth, unit, NM_FT, type Pt, type RunwayEnd, type WP } from '@/features/pattern/geo'
import type { Airport, RunwayCalc } from './model'
import { deg3 } from './ui'

// How to leave the departure airport and how to join the arrival's pattern,
// using the pattern trainer's geometry (AIM 4-3-3, AC 90-66C): the traffic
// pattern is flown at pattern altitude on the published side, the 45° entry
// joins downwind abeam midfield from the pattern side, and from the other side
// you overfly midfield 500 ft above pattern altitude and teardrop back to the
// 45°. Which way to leave or join follows the course to the next waypoint (or
// from the previous one). Positions are true; courses shown are magnetic.

export type LL = { lat: number; lon: number }
export interface Procedure { kind: string; text: string; path: LL[]; join: LL } // join: where the en-route line meets it

// A flat frame around the airport: nautical miles east and north of its reference point.
function frame(a: Airport) {
  const k = Math.cos((a.lat * Math.PI) / 180)
  return {
    pt: (p: LL): Pt => [(p.lon - a.lon) * 60 * k, (p.lat - a.lat) * 60],
    ll: (p: Pt): LL => ({ lat: a.lat + p[1] / 60, lon: a.lon + p[0] / (60 * k) }),
  }
}

// The runway in use as the trainer models it: threshold of the end in use, its departure end, the side of its pattern.
function runwayEnd(rc: RunwayCalc, f: ReturnType<typeof frame>): RunwayEnd | null {
  const t = rc.end, o = rc.runway.ends.find(e => e !== t)
  if (t.lat == null || t.lon == null || o?.lat == null || o.lon == null) return null
  const threshold = f.pt({ lat: t.lat, lon: t.lon }), departureEnd = f.pt({ lat: o.lat, lon: o.lon })
  const hdg = bearing(threshold, departureEnd), dir = unit(hdg)
  const side = t.right ? 'R' : 'L'
  const lengthNm = Math.hypot(departureEnd[0] - threshold[0], departureEnd[1] - threshold[1])
  return { ident: t.id, hdg, lengthFt: lengthNm * NM_FT, lengthNm, side, threshold, departureEnd, dir, out: side === 'L' ? [-dir[1], dir[0]] : [dir[1], -dir[0]], displacedNm: (t.displaced || 0) / NM_FT }
}

export const tpaOf = (a: Airport) => Math.round((a.elev + (a.tpaAgl || 1000)) / 10) * 10
const mag = (trueDeg: number, a: Airport) => deg3(norm360(trueDeg - (a.magVar || 0)))
const sideWord = (e: RunwayEnd) => (e.side === 'L' ? 'left' : 'right')
const curve = (wps: WP[], f: ReturnType<typeof frame>) => smooth(wps, 0.08).map(s => f.ll(s.p))

// Joining the arrival's pattern from the previous waypoint.
export function arrivalProcedure(a: Airport, rc: RunwayCalc, from: LL | null): Procedure | null {
  const f = frame(a), e = runwayEnd(rc, f)
  if (!e) return null
  const tpa = tpaOf(a), M = add(e.threshold, e.dir, e.lengthNm / 2)
  const src = from ? f.pt(from) : add(M, e.out, 6)
  // The pattern side is the side of the runway its downwind is on.
  const patternSide = (src[0] - M[0]) * e.out[0] + (src[1] - M[1]) * e.out[1] > 0
  const kind = patternSide ? '45' : 'overfly'
  const entry = entryPath(e, kind, { p: src, alt: tpa + 1000 }, tpa, a.elev).slice(1)
  const land = patternPath(e, 'mid', 'land', tpa, a.elev).slice(1, -2) // through the threshold, not the rollout
  const path = curve([...entry, ...land], f)
  const atc = a.towered ? 'Towered: follow the tower’s instructions; plan on ' : ''
  const text = kind === '45'
    ? `${atc}${atc ? 'a' : 'A'} 45° entry to ${sideWord(e)} downwind RWY ${e.ident} at ${tpa.toLocaleString()} ft, abeam midfield`
    : `${atc}${atc ? 'o' : 'O'}verfly midfield at ${(tpa + 500).toLocaleString()} ft, continue to the ${sideWord(e)}-pattern side, descend to ${tpa.toLocaleString()} ft and teardrop to a 45° entry to ${sideWord(e)} downwind RWY ${e.ident}`
  return { kind, text, path, join: f.ll(entry[0].p) }
}

// Leaving the departure airport toward the next waypoint.
export function departureProcedure(a: Airport, rc: RunwayCalc, next: LL | null): Procedure | null {
  const f = frame(a), e = runwayEnd(rc, f)
  if (!e) return null
  const tpa = tpaOf(a)
  const at = (p: Pt): WP => ({ p, alt: tpa })
  const D = e.departureEnd
  const course = next ? bearing(D, f.pt(next)) : e.hdg
  const turn = angleDiff(course, e.hdg) // + right of the runway heading
  const toPattern = (e.side === 'R' ? 1 : -1) * turn > 0
  const crs = `${mag(course, a)}°`
  const onCourse = (p: Pt) => at(add(p, unit(course), 2.5))
  const atc = a.towered ? ', or as the tower instructs' : ''
  let kind: string, wps: WP[], text: string
  if (Math.abs(turn) <= 35) {
    kind = 'straight'
    const climb = add(D, e.dir, 1.2)
    wps = [at(e.threshold), at(D), at(climb), onCourse(climb)]
    text = `Take off RWY ${e.ident}, depart straight out and climb through ${tpa.toLocaleString()} ft on course ${crs}${atc}`
  } else if (Math.abs(turn) <= 135 && toPattern) {
    kind = '45'
    const up = legPoint(e, 'upwind'), turnOut = add(up, unit(e.hdg + (e.side === 'R' ? 45 : -45)), 1.2)
    wps = [at(e.threshold), at(D), at(up), at(turnOut), onCourse(turnOut)]
    text = `Take off RWY ${e.ident}, past the departure end at ${tpa.toLocaleString()} ft make a 45° ${sideWord(e)} turn out of the pattern, then on course ${crs}${atc}`
  } else if (Math.abs(turn) <= 135) {
    kind = 'straight-turn'
    const clear = add(D, e.dir, 1.8)
    wps = [at(e.threshold), at(D), at(clear), onCourse(clear)]
    text = `Take off RWY ${e.ident}, climb straight out past the pattern to above ${tpa.toLocaleString()} ft, then turn ${turn > 0 ? 'right' : 'left'} on course ${crs} (away from the ${sideWord(e)} pattern)${atc}`
  } else {
    kind = 'downwind'
    const mid = legPoint(e, 'mid')
    wps = [at(e.threshold), at(D), at(legPoint(e, 'upwind')), at(legPoint(e, 'crosswind')), at(legPoint(e, 'downwindStart')), at(mid), onCourse(mid)]
    text = `Take off RWY ${e.ident}, turn ${sideWord(e)} crosswind and ${sideWord(e)} downwind at ${tpa.toLocaleString()} ft, then leave the downwind on course ${crs}${toPatternSideBehind(turn, e) ? '' : ', climbing above pattern altitude before you cross back over the field'}${atc}`
  }
  const path = curve(wps, f)
  return { kind, text, path, join: path[path.length - 1] }
}
// A course behind you on the pattern side is flown straight off the downwind; on the other side you cross the field.
const toPatternSideBehind = (turn: number, e: RunwayEnd) => (e.side === 'R' ? 1 : -1) * turn > 0

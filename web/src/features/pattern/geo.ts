// Flat-earth geometry around one airport. Positions are nautical miles from the
// airport reference point (x east, y north); headings and bearings are magnetic.

export type Pt = [number, number]
export type Side = 'L' | 'R'
export interface WP { p: Pt; alt: number }
export interface Sample extends WP { hdg: number; s: number }
export interface Wind { dir: number; spd: number; gust?: number }

export const NM_FT = 6076.12
export const PATTERN_OFFSET = 0.7

const rad = (d: number) => (d * Math.PI) / 180
export const norm360 = (d: number) => ((d % 360) + 360) % 360
export const unit = (hdg: number): Pt => [Math.sin(rad(hdg)), Math.cos(rad(hdg))]
export const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + b[0] * k, a[1] + b[1] * k]
export const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1])
export const bearing = (from: Pt, to: Pt) => norm360((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI)
export const polar = (bearingFromField: number, nm: number): Pt => { const u = unit(bearingFromField); return [u[0] * nm, u[1] * nm] }
export const angleDiff = (a: number, b: number) => { const d = norm360(a - b); return d > 180 ? d - 360 : d }

export interface RunwayDef {
  ends: [string, string]
  hdg: number // landing heading of ends[0]
  lengthFt: number
  widthFt: number
  center: Pt
  traffic: [Side, Side]
  displacedFt?: [number, number]
}

export interface RunwayEnd {
  ident: string
  hdg: number
  lengthFt: number
  lengthNm: number
  side: Side
  threshold: Pt
  departureEnd: Pt
  dir: Pt // landing direction
  out: Pt // toward the downwind leg
  displacedNm: number
}

export function runwayEnds(r: RunwayDef): RunwayEnd[] {
  return [0, 1].map(i => {
    const hdg = i ? norm360(r.hdg + 180) : r.hdg
    const dir = unit(hdg)
    const lengthNm = r.lengthFt / NM_FT
    const side = r.traffic[i]
    return {
      ident: r.ends[i], hdg, lengthFt: r.lengthFt, lengthNm, side,
      threshold: add(r.center, dir, -lengthNm / 2),
      departureEnd: add(r.center, dir, lengthNm / 2),
      dir,
      out: side === 'L' ? [-dir[1], dir[0]] : [dir[1], -dir[0]],
      displacedNm: (r.displacedFt?.[i] ?? 0) / NM_FT,
    }
  })
}

export function findEnd(runways: RunwayDef[], ident: string): RunwayEnd {
  const e = runways.flatMap(runwayEnds).find(e => e.ident === ident)
  if (!e) throw new Error(`No runway ${ident}`)
  return e
}

// Headwind (negative = tailwind) and crosswind (positive = from the right).
export function components(w: Wind, rwyHdg: number) {
  const a = rad(w.dir - rwyHdg)
  return { head: w.spd * Math.cos(a), cross: w.spd * Math.sin(a) }
}

export function rankEnds(runways: RunwayDef[], w: Wind, closed: string[] = []) {
  return runways.flatMap(runwayEnds).filter(e => !closed.includes(e.ident))
    .map(e => ({ e, ...components(w, e.hdg) }))
    .sort((a, b) => b.head - a.head || Math.abs(a.cross) - Math.abs(b.cross))
}

export type Leg = 'upwind' | 'crosswind' | 'downwindStart' | 'mid' | 'abeam' | 'base' | 'baseMid' | 'final' | 'short' | 'threshold' | 'touchdown' | 'rollout'
const CIRCUIT: Leg[] = ['downwindStart', 'mid', 'abeam', 'base', 'baseMid', 'final', 'short', 'threshold', 'touchdown', 'rollout']

export function legPoint(e: RunwayEnd, leg: Leg, w = PATTERN_OFFSET): Pt {
  const T = e.threshold, D = e.departureEnd
  const along = (p: Pt, k: number, s = 0) => add(add(p, e.dir, k), e.out, s)
  switch (leg) {
    case 'upwind': return along(D, 0.45)
    case 'crosswind': return along(D, 0.6, w * 0.5)
    case 'downwindStart': return along(D, 0.6, w)
    case 'mid': return along(T, e.lengthNm / 2, w)
    case 'abeam': return along(T, e.displacedNm, w)
    case 'base': return along(T, -0.75, w)
    case 'baseMid': return along(T, -1.05, w * 0.45)
    case 'final': return along(T, -1.1)
    case 'short': return along(T, -0.35 + e.displacedNm)
    case 'threshold': return along(T, e.displacedNm)
    case 'touchdown': return along(T, e.displacedNm + 0.1)
    case 'rollout': return along(T, e.displacedNm + Math.min(e.lengthNm * 0.55, 0.38))
  }
}

export function legHeading(e: RunwayEnd, leg: Leg) {
  if (leg === 'upwind' || leg === 'final' || leg === 'short' || leg === 'threshold' || leg === 'touchdown' || leg === 'rollout') return e.hdg
  if (leg === 'crosswind') return norm360(e.hdg + (e.side === 'L' ? -90 : 90))
  if (leg === 'base' || leg === 'baseMid') return norm360(e.hdg + (e.side === 'L' ? 90 : -90))
  return norm360(e.hdg + 180)
}

// Altitude on a leg: pattern altitude on downwind, then a 3° glidepath to the threshold.
function legAlt(leg: Leg, tpa: number, elev: number) {
  const glide = (nm: number) => Math.min(tpa, elev + 50 + nm * 318)
  switch (leg) {
    case 'base': return tpa - 120
    case 'baseMid': return Math.min(tpa - 250, glide(1.25))
    case 'final': return glide(1.1)
    case 'short': return glide(0.35)
    case 'threshold': return elev + 40
    case 'touchdown': case 'rollout': return elev
    case 'upwind': return elev + 500
    case 'crosswind': return tpa - 200
    default: return tpa
  }
}

export type EntryKind = '45' | 'midfield' | 'overfly' | 'straight' | 'base' | 'upwind'

export function entryPath(e: RunwayEnd, kind: EntryKind, from: WP, tpa: number, elev: number, w = PATTERN_OFFSET): WP[] {
  const M = add(e.threshold, e.dir, e.lengthNm / 2)
  const P = (s: number, u: number): Pt => add(add(M, e.out, s), e.dir, u)
  const at = (p: Pt, alt = tpa): WP => ({ p, alt })
  const land = (legs: Leg[]) => legs.map(l => at(legPoint(e, l, w), legAlt(l, tpa, elev)))
  switch (kind) {
    case '45': return [from, at(P(w + 1.5, 1.5)), at(P(w, 0))]
    case 'midfield': return [from, at(P(-1.8, 0)), at(M), at(P(w * 0.85, -0.2)), at(P(w, -0.55))]
    case 'overfly': return [from, at(M, tpa + 500), at(P(w + 1.7, 2.6), tpa + 400), at(P(w + 2.7, 2.6), tpa + 150), at(P(w + 2.3, 2.3)), at(P(w + 1.4, 1.4)), at(P(w, 0))]
    case 'upwind': return [from, at(add(e.departureEnd, e.out, -0.9)), at(add(e.departureEnd, e.dir, 0.25)), at(legPoint(e, 'crosswind', w)), at(legPoint(e, 'downwindStart', w))]
    case 'straight': return [from, at(add(e.threshold, e.dir, -4), Math.min(from.alt, elev + 50 + 4 * 318)), ...land(['final', 'short', 'threshold', 'touchdown', 'rollout'])]
    case 'base': {
      const B = add(add(e.threshold, e.dir, -1.05), e.out, w + 1.8)
      return [from, at(B), ...land(['baseMid', 'final', 'short', 'threshold', 'touchdown', 'rollout'])]
    }
  }
}

export type Outcome = 'land' | 'goaround' | Leg

export function patternPath(e: RunwayEnd, from: Leg, outcome: Outcome, tpa: number, elev: number, w = PATTERN_OFFSET): WP[] {
  const pt = (l: Leg): WP => ({ p: legPoint(e, l, w), alt: legAlt(l, tpa, elev) })
  const start = Math.max(0, CIRCUIT.indexOf(from))
  if (outcome === 'goaround') {
    const before = CIRCUIT.slice(start, CIRCUIT.indexOf('short') + 1).map(pt)
    return [...before,
      { p: add(add(e.threshold, e.dir, e.displacedNm + 0.15), e.out, 0.06), alt: elev + 150 },
      { p: add(e.departureEnd, e.out, 0.1), alt: elev + 450 },
      { p: add(legPoint(e, 'upwind', w), e.out, 0.1), alt: elev + 650 },
      pt('crosswind'), pt('downwindStart'), pt('mid')]
  }
  const end = outcome === 'land' ? CIRCUIT.length - 1 : CIRCUIT.indexOf(outcome)
  return CIRCUIT.slice(start, end + 1).map(pt)
}

// A closed circuit for traffic doing touch-and-goes.
export function circuit(e: RunwayEnd, tpa: number, elev: number, w = PATTERN_OFFSET): WP[] {
  const pt = (l: Leg): WP => ({ p: legPoint(e, l, w), alt: legAlt(l, tpa, elev) })
  return [...(['downwindStart', 'mid', 'abeam', 'base', 'baseMid', 'final', 'short', 'touchdown'] as Leg[]).map(pt),
    { p: add(e.departureEnd, e.dir, -0.05), alt: elev + 300 }, pt('upwind'), pt('crosswind'), pt('downwindStart')]
}

// Catmull-Rom through the waypoints, sampled every `spacing` nm.
export function smooth(wps: WP[], spacing = 0.03): Sample[] {
  const pts = wps.filter((w, i) => i === 0 || dist(w.p, wps[i - 1].p) > 1e-6)
  if (pts.length < 2) return pts.map(w => ({ ...w, hdg: 0, s: 0 }))
  const raw: WP[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)].p, p1 = pts[i].p, p2 = pts[i + 1].p, p3 = pts[Math.min(pts.length - 1, i + 2)].p
    const n = Math.max(2, Math.ceil(dist(p1, p2) / spacing))
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t
      const c = (k: 0 | 1) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
      raw.push({ p: [c(0), c(1)], alt: pts[i].alt + (pts[i + 1].alt - pts[i].alt) * t })
    }
  }
  raw.push(pts[pts.length - 1])
  let s = 0
  return raw.map((w, i) => {
    if (i) s += dist(raw[i - 1].p, w.p)
    const a = raw[Math.max(0, i - 1)].p, b = raw[Math.min(raw.length - 1, i + 1)].p
    return { ...w, hdg: dist(a, b) > 1e-9 ? bearing(a, b) : 0, s }
  })
}

export function sampleAt(track: Sample[], frac: number): Sample {
  if (!track.length) return { p: [0, 0], alt: 0, hdg: 0, s: 0 }
  const target = Math.max(0, Math.min(1, frac)) * track[track.length - 1].s
  let lo = 0, hi = track.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (track[m].s < target) lo = m; else hi = m }
  const a = track[lo], b = track[hi]
  const t = b.s > a.s ? (target - a.s) / (b.s - a.s) : 0
  const dh = angleDiff(b.hdg, a.hdg)
  return { p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t], alt: a.alt + (b.alt - a.alt) * t, hdg: norm360(a.hdg + dh * t), s: target }
}

export function descentPlan(fromAlt: number, toAlt: number, gs: number, fpm = 500) {
  const minutes = Math.max(0, fromAlt - toAlt) / fpm
  return { minutes, nm: (minutes * gs) / 60 }
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
export const compass8 = (brg: number) => COMPASS[Math.round(norm360(brg) / 45) % 8]
export const clock = (hdg: number, brgTo: number) => { const h = Math.round(norm360(brgTo - hdg) / 30) % 12; return h === 0 ? 12 : h }
export const fmtHdg = (h: number) => String(Math.round(norm360(h)) % 360 || 360).padStart(3, '0')

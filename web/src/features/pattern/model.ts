import type { Airport } from './airports'
import type { Tx } from './radio'
import { add, bearing, circuit, entryPath, findEnd, legHeading, legPoint, patternPath, polar, smooth, PATTERN_OFFSET, type EntryKind, type Leg, type Outcome, type Pt, type Sample, type WP, type Wind } from './geo'

export type Phase = 'Preflight' | 'Weather' | 'Position' | 'Descent' | 'Radio' | 'Entry' | 'Traffic' | 'Pattern' | 'Landing' | 'Decision'

export type At = { polar: [number, number] } | { leg: Leg; rwy: string } | { entry45: string } | { pt: Pt }

export type Fly =
  | { entry: EntryKind; rwy: string; then?: Outcome; flip?: boolean }
  | { pattern: Outcome; rwy: string; from: Leg }
  | { direct: At[]; alt: number[] }
  | { circuit: string }

export interface Zone { kind: 'tfr' | 'jump' | 'obstacle' | 'avoid'; at: At; r: number; label: string }

export interface TrafficDef {
  id: string
  label: string
  icon?: 'plane' | 'canopy' | 'balloon'
  fly?: Fly
  from?: At
  alt?: number
  hdg?: number
  period?: number
  phase?: number
}

export interface Info {
  kind: 'supplement' | 'notam' | 'foreflight' | 'weather' | 'profile' | 'note' | 'checklist'
  title: string
  lines?: string[]
  profile?: { alt: number; tpa: number; gs: number; fpm: number; nowNm: number; atTpaNm: number }
}

// PAPI: four lights, outermost first. VASI: two bars, far (upper) then near.
export interface Lights { kind: 'PAPI' | 'VASI'; colors: ('W' | 'R')[] }

export interface Opt { id: string; label: string; why: string; fly?: Fly; rwy?: string }

export type Question =
  | { kind: 'choice'; prompt: string; options: Opt[]; answer: string; why: string; refs?: string[] }
  | { kind: 'multi'; prompt: string; options: Opt[]; answer: string[]; why: string; refs?: string[] }
  | { kind: 'order'; prompt: string; items: { id: string; label: string }[]; distractors?: { id: string; label: string; why: string }[]; why: string; refs?: string[] }

export interface Step {
  phase: Phase
  title: string
  situation: string
  at: At
  alt: number
  hdg?: number
  gs: number
  com?: [string, string]
  time?: string
  wind?: Wind
  sock?: Wind
  hideOwnship?: boolean
  lights?: Lights // what the PAPI/VASI shows out the window
  info?: Info[]
  radio?: Tx[]
  scene?: { pattern?: string; zones?: Zone[]; traffic?: TrafficDef[]; closed?: string[] }
  q: Question
  after?: { fly?: Fly; radio?: Tx[] }
}

export interface Scenario {
  id: string
  title: string
  airport: string
  ap?: Airport // generated scenarios carry their own airport
  source?: string
  blurb: string
  tags: string[]
  wind: Wind
  steps: Step[]
}

export function atPoint(ap: Airport, at: At): Pt {
  if ('polar' in at) return polar(at.polar[0], at.polar[1])
  if ('pt' in at) return at.pt
  if ('leg' in at) return legPoint(findEnd(ap.runways, at.rwy), at.leg)
  const e = findEnd(ap.runways, at.entry45)
  const M = add(e.threshold, e.dir, e.lengthNm / 2)
  return add(add(M, e.out, PATTERN_OFFSET + 1.5), e.dir, 1.5)
}

export function atHeading(ap: Airport, step: Pick<Step, 'at' | 'hdg'>): number {
  if (step.hdg != null) return step.hdg
  if ('leg' in step.at) return legHeading(findEnd(ap.runways, step.at.rwy), step.at.leg)
  return bearing(atPoint(ap, step.at), [0, 0])
}

export function flyPath(ap: Airport, fly: Fly, from: WP): WP[] {
  if ('direct' in fly) return [from, ...fly.direct.map((a, i) => ({ p: atPoint(ap, a), alt: fly.alt[i] ?? from.alt }))]
  if ('circuit' in fly) return circuit(findEnd(ap.runways, fly.circuit), ap.tpa, ap.elev)
  const e0 = findEnd(ap.runways, fly.rwy)
  const e = 'flip' in fly && fly.flip ? { ...e0, side: e0.side === 'L' ? 'R' as const : 'L' as const, out: [-e0.out[0], -e0.out[1]] as Pt } : e0
  if ('pattern' in fly) return [from, ...patternPath(e, fly.from, fly.pattern, ap.tpa, ap.elev).slice(1)]
  const entry = entryPath(e, fly.entry, from, ap.tpa, ap.elev)
  if (!fly.then || fly.entry === 'straight' || fly.entry === 'base') return entry
  const joined: Leg = fly.entry === 'midfield' ? 'abeam' : fly.entry === 'upwind' ? 'downwindStart' : 'mid'
  return [...entry, ...patternPath(e, joined, fly.then, ap.tpa, ap.elev).slice(1)]
}

export const flyTrack = (ap: Airport, fly: Fly, from: WP): Sample[] => smooth(flyPath(ap, fly, from))

export function trafficTrack(ap: Airport, t: TrafficDef): Sample[] {
  const from: WP = { p: t.from ? atPoint(ap, t.from) : [0, 0], alt: t.alt ?? ap.tpa }
  if (!t.fly) return smooth([from, from])
  return smooth(flyPath(ap, t.fly, from))
}

export function grade(q: Question, picked: string[]): boolean {
  if (q.kind === 'choice') return picked[0] === q.answer
  if (q.kind === 'multi') return picked.length === q.answer.length && q.answer.every(a => picked.includes(a))
  return picked.length === q.items.length && q.items.every((it, i) => picked[i] === it.id)
}

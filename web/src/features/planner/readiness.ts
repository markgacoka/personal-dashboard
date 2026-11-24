import type { Check, Derived, Plan } from './model'

// The flight file's sections, in the order a pilot works through them (PAVE,
// then the numbers), ending with the NavLog that goes into the cockpit.
export type SectionKey = 'overview' | 'pilot' | 'aircraft' | 'weather' | 'airports' | 'route' | 'loading' | 'navlog'
export const SECTIONS: { key: SectionKey; label: string; short: string; rail?: string }[] = [
  { key: 'overview', label: 'Overview', short: 'Overview' },
  { key: 'pilot', label: 'Pilot', short: 'Pilot' },
  { key: 'aircraft', label: 'Aircraft', short: 'Aircraft' },
  { key: 'weather', label: 'Weather', short: 'Weather' },
  { key: 'airports', label: 'Airports', short: 'Airports' },
  { key: 'route', label: 'Route and fuel', short: 'Route' },
  { key: 'loading', label: 'Weight and performance', short: 'Weight', rail: 'Weight & performance' },
  { key: 'navlog', label: 'NavLog', short: 'NavLog' },
]
export const SECTION_LABEL = Object.fromEntries(SECTIONS.map(s => [s.key, s.label])) as Record<SectionKey, string>

export function sectionOf(c: Check): SectionKey {
  // The airplane's empty weight is entered with the airplane, though it's a W&B input.
  if (c.section === 'loading' && /'s empty weight$/.test(c.title)) return 'aircraft'
  if (c.section === 'performance') return /no runway data|airport data cycle/.test(c.title) ? 'airports' : 'loading'
  return ({ trip: 'route', pilot: 'pilot', aircraft: 'aircraft', weather: 'weather', navlog: 'route', loading: 'loading' } as const)[c.section]
}

// nogo / caution / todo come from the checks and decide the verdict;
// recommended completes the context (the airplane's own POH and checklist, a
// standard briefing) without changing it.
export type TaskKind = 'nogo' | 'caution' | 'todo' | 'recommended'
export interface Task { id: string; section: SectionKey; kind: TaskKind; title: string; detail?: string }
export interface ReadinessCtx { tail: string | null; profileSaved: boolean; checklistSteps: number; pohExact: boolean; inspections: boolean; certsSaved: boolean; briefed: boolean }

const RANK: TaskKind[] = ['nogo', 'caution', 'todo', 'recommended']

export function readiness(d: Derived, plan: Plan, x: ReadinessCtx): Task[] {
  const out: Task[] = d.checks
    .filter(c => c.status === 'nogo' || c.status === 'caution' || c.status === 'todo')
    .map((c, i) => ({ id: `c${i}`, section: sectionOf(c), kind: c.status as TaskKind, title: c.title, detail: c.fix ?? c.detail }))
  const rec = (section: SectionKey, id: string, title: string, detail: string) => out.push({ id, section, kind: 'recommended', title, detail })
  if (x.tail) {
    if (!x.pohExact) rec('aircraft', 'poh', `Upload ${x.tail}'s own POH`, 'The numbers come from the closest public book until this airplane\'s own is uploaded.')
    if (!x.checklistSteps) rec('aircraft', 'checklist', `Write ${x.tail}'s checklist`, 'Type or paste it once; it\'s part of every brief and prints with the NavLog.')
    if (!x.inspections) rec('aircraft', 'inspections', `Enter ${x.tail}'s inspection dates`, 'Annual, transponder, ELT and 100-hour: the airworthiness checks need them.')
  }
  if (plan.route.length > 1 && !x.briefed) rec('weather', 'briefing', 'Get a standard briefing', '1800wxbrief.com or 1-800-WX-BRIEF (§91.103), then tick it here.')
  return out.sort((a, b) => RANK.indexOf(a.kind) - RANK.indexOf(b.kind))
}

// A section's state for the rail: its worst open task, or done.
export function sectionState(tasks: Task[], k: SectionKey): TaskKind | 'done' {
  const own = tasks.filter(t => t.section === k)
  return own.length ? own.reduce((w, t) => (RANK.indexOf(t.kind) < RANK.indexOf(w) ? t.kind : w), 'recommended' as TaskKind) : 'done'
}

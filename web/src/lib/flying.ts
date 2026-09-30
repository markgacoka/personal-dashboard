import type { Flight } from './types'
import { num, sum } from './utils'

export const TRAINING_TYPES: Record<string, string> = {
  discovery: 'Discovery',
  dual: 'Dual',
  maneuvers: 'Maneuvers',
  pattern: 'Traffic patterns',
  uncontrolled: 'Uncontrolled airport',
  soft_short: 'Soft/short field',
  'x-country': 'Cross-country',
  night: 'Night',
  instrument: 'Instrument',
  pre_solo: 'Pre-solo',
  solo: 'Solo',
  solo_xc: 'Solo cross-country',
  checkride_prep: 'Checkride prep',
}

export const trainingLabel = (t?: string | null) => (t && TRAINING_TYPES[t]) || (t ? t : 'Flight')

export const APPROACH_TYPES = ['ILS', 'RNAV (GPS)', 'VOR', 'NDB', 'LOC', 'LOC/BC', 'LDA', 'SDF', 'Visual']

export function route(f: Pick<Flight, 'departure' | 'arrival' | 'via'>) {
  return [f.departure?.icao, ...(f.via || []), f.arrival?.icao].filter(Boolean) as string[]
}

export const isSolo = (f: Flight) => num(f.solo) > 0 && !(num(f.dual_received) > 0)
export const isDual = (f: Flight) => num(f.dual_received) > 0
export const isNight = (f: Flight) => num(f.night) > 0
export const isXC = (f: Flight) => num(f.cross_country) > 0

// ── FAA currency (§61.56, §61.57) ────────────────────────────────────────────
const DAY = 86_400_000
const fDate = (d: string) => new Date(String(d).slice(0, 10) + 'T12:00:00').getTime()

export type CurrencyState = 'current' | 'expiring' | 'grace' | 'lapsed' | 'na'

export interface CurrencyItem {
  key: string
  name: string
  rule: string
  requirement: string
  state: CurrencyState
  detail: string
  daysLeft: number | null
  progress?: { have: number; need: number; label: string }[]
}

export function computeCurrency(flights: Flight[], now = Date.now()): CurrencyItem[] {
  const within = (ms: number) => flights.filter(f => now - fDate(f.date) < ms)
  const tally = (list: Flight[], to: keyof Flight, ld: keyof Flight) =>
    list.reduce((a, f) => ({ to: a.to + num(f[to]), ld: a.ld + num(f[ld]) }), { to: 0, ld: 0 })
  const apps = (list: Flight[]) => sum(list.map(f => (Array.isArray(f.approaches) ? f.approaches.length : 0)))

  // Days until the latest 3 take-offs + 3 landings age past 90 days.
  const lapseIn = (to: keyof Flight, ld: keyof Flight) => {
    const ops = flights.map(f => ({ t: fDate(f.date), n: num(f[to]) + num(f[ld]) })).filter(o => o.n > 0).sort((a, b) => b.t - a.t)
    let c = 0
    for (const o of ops) { c += o.n; if (c >= 6) return Math.floor((o.t + 90 * DAY - now) / DAY) }
    return null
  }

  const d90 = within(90 * DAY)
  const dayT = tally(d90, 'day_takeoffs', 'day_landings_full_stop')
  const genT = tally(d90, 'takeoffs', 'landings')
  const day = { to: dayT.to || genT.to, ld: dayT.ld || genT.ld }
  const dayCur = day.to >= 3 && day.ld >= 3
  const dayLeft = dayCur ? lapseIn('day_takeoffs', 'day_landings_full_stop') ?? lapseIn('takeoffs', 'landings') : null

  const night = tally(d90, 'night_takeoffs', 'night_landings_full_stop')
  const nightCur = night.to >= 3 && night.ld >= 3

  const a6 = apps(within(183 * DAY)), a12 = apps(within(365 * DAY)), aAll = apps(flights)
  const ifrCur = a6 >= 6

  const review = flights.filter(f => f.flight_review).sort((a, b) => fDate(b.date) - fDate(a.date))[0]
  const reviewAge = review ? now - fDate(review.date) : null
  const reviewLeft = reviewAge != null ? Math.floor((730 * DAY - reviewAge) / DAY) : null

  const stateFor = (cur: boolean, left: number | null, soon = 30): CurrencyState =>
    !cur ? 'lapsed' : left != null && left <= soon ? 'expiring' : 'current'

  return [
    {
      key: 'day', name: 'Day VFR', rule: '§61.57(a)', requirement: '3 take-offs and 3 full-stop landings in 90 days',
      state: stateFor(dayCur, dayLeft), daysLeft: dayLeft,
      detail: dayCur ? (dayLeft != null ? `${dayLeft} days until it lapses` : 'Current') : `${day.to} take-offs · ${day.ld} landings in 90 days`,
      progress: [{ have: day.to, need: 3, label: 'Take-offs' }, { have: day.ld, need: 3, label: 'Landings' }],
    },
    {
      key: 'night', name: 'Night VFR', rule: '§61.57(b)', requirement: '3 night take-offs and full-stop landings in 90 days',
      state: nightCur ? 'current' : 'lapsed', daysLeft: null,
      detail: nightCur ? 'Current' : `${night.to} take-offs · ${night.ld} landings in 90 days`,
      progress: [{ have: night.to, need: 3, label: 'Take-offs' }, { have: night.ld, need: 3, label: 'Landings' }],
    },
    {
      key: 'ifr', name: 'Instrument', rule: '§61.57(c)', requirement: '6 approaches, holding and intercepting in 6 months',
      state: aAll === 0 && a12 === 0 ? 'na' : ifrCur ? 'current' : a12 >= 6 ? 'grace' : 'lapsed', daysLeft: null,
      detail: aAll === 0 ? 'No approaches logged' : `${a6} approaches in 6 months`,
      progress: [{ have: a6, need: 6, label: 'Approaches' }],
    },
    {
      key: 'review', name: 'Flight review', rule: '§61.56', requirement: 'Every 24 calendar months',
      state: reviewAge == null ? 'lapsed' : stateFor(reviewAge < 730 * DAY, reviewLeft, 60), daysLeft: reviewLeft,
      detail: reviewLeft == null ? 'None logged' : reviewLeft >= 0 ? `${reviewLeft} days until it lapses` : `${-reviewLeft} days overdue`,
    },
  ]
}

// ── Medical certificate (§61.23). Stored per browser, same keys as the classic UI.
export type MedClass = '1' | '2' | '3' | 'basicmed'
export const MED_LABEL: Record<MedClass, string> = { '1': 'First class', '2': 'Second class', '3': 'Third class', basicmed: 'BasicMed' }

export interface Medical { cls: MedClass; under40: boolean; date: string }

export function readMedical(): Medical {
  const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
  return {
    cls: (read('med-cls') as MedClass) || '3',
    under40: read('med-under40') !== 'false',
    date: read('med-date') || '2025-08-22',
  }
}

export function saveMedical(m: Medical) {
  try {
    localStorage.setItem('med-cls', m.cls)
    localStorage.setItem('med-under40', String(m.under40))
    localStorage.setItem('med-date', m.date)
    localStorage.setItem('med-seeded', '1')
  } catch { /* per-browser convenience */ }
}

export function medicalExpiry(m: Medical): Date | null {
  if (!m.date) return null
  const months = m.cls === '1' ? (m.under40 ? 12 : 6) : m.cls === '2' ? 12 : m.cls === '3' ? (m.under40 ? 60 : 24) : 48
  const d = new Date(m.date + 'T12:00:00')
  return new Date(d.getFullYear(), d.getMonth() + months + 1, 0) // last day of the calendar month
}

// ── Private pilot aeronautical experience, §61.109(a) ────────────────────────
// Derived from logbook columns. Dual and solo cross-country time are taken as
// the cross-country hours on dual and solo flights respectively.
export interface Requirement { label: string; have: number; need: number; unit: 'h' | '' }

export function pplProgress(flights: Flight[]): Requirement[] {
  const dual = flights.filter(isDual)
  const solo = flights.filter(f => num(f.solo) > 0)
  const s = (list: Flight[], f: (x: Flight) => number) => sum(list.map(f))
  return [
    { label: 'Total time', have: s(flights, f => num(f.total_duration)), need: 40, unit: 'h' },
    { label: 'Dual instruction', have: s(flights, f => num(f.dual_received)), need: 20, unit: 'h' },
    { label: 'Solo', have: s(flights, f => num(f.solo)), need: 10, unit: 'h' },
    { label: 'Dual cross-country', have: s(dual, f => Math.min(num(f.cross_country), num(f.dual_received))), need: 3, unit: 'h' },
    { label: 'Solo cross-country', have: s(solo, f => Math.min(num(f.cross_country), num(f.solo))), need: 5, unit: 'h' },
    { label: 'Night dual', have: s(dual, f => Math.min(num(f.night), num(f.dual_received))), need: 3, unit: 'h' },
    { label: 'Night landings', have: s(flights, f => num(f.night_landings_full_stop) || num(f.night_landings)), need: 10, unit: '' },
    { label: 'Instrument', have: s(flights, f => num(f.simulated_instrument) + num(f.actual_instrument)), need: 3, unit: 'h' },
  ]
}

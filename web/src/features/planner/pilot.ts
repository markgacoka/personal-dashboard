// Who flies and under what privileges: your certificates, ratings, medical and
// endorsements (saved once, settings key "certificates") against this flight's
// role (you as PIC, or dual with an instructor), passengers, airplane, airspace,
// distance, night and weather. Pure; derive() adds what this returns to the checks.
import type { AircraftProfile, ProfileEdits } from './poh'
import type { Check, Status } from './model'

export type Certificate = 'student' | 'sport' | 'recreational' | 'private' | 'commercial' | 'atp'
export const CERTIFICATES: { key: Certificate; label: string }[] = [
  { key: 'student', label: 'Student pilot' }, { key: 'sport', label: 'Sport pilot' }, { key: 'recreational', label: 'Recreational pilot' },
  { key: 'private', label: 'Private pilot' }, { key: 'commercial', label: 'Commercial pilot' }, { key: 'atp', label: 'Airline transport pilot' },
]
export type MedicalKind = 'first' | 'second' | 'third' | 'basicmed' | 'license' | 'none'

export interface PilotCerts {
  certificate?: Certificate
  ratings?: { asel?: boolean; amel?: boolean; ases?: boolean; instrument?: boolean; cfi?: boolean }
  medical?: { kind?: MedicalKind; date?: string; under40?: boolean; course?: string }
  // Dates are the endorsement's date in your logbook (ISO yyyy-mm-dd).
  endorsements?: {
    solo?: string; soloModel?: string // §61.87(n), 90 days, make and model
    soloNight?: boolean // §61.87(o)
    soloNearby?: boolean // §61.93(b)(1): solo to another airport within 25 nm
    soloXc?: boolean // §61.93(c)(1): solo cross-country, this category
    classB?: string; classBAirport?: string // §61.95, 90 days
    towered?: boolean // sport §61.325 / recreational §61.101(d): B, C, D and towered airports
    recreationalXc?: boolean // §61.101(c): beyond 50 nm
    highPerformance?: boolean; complex?: boolean; tailwheel?: boolean // §61.31(f), (e), (i)
  }
  flightReview?: string // date of your last flight review or checkride (§61.56)
  home?: string // the airport you train from (student 25 nm radius)
  updatedAt?: string
}

export type Role = 'pic' | 'dual'
export interface Crew { role?: Role; instructor?: string }
// Unset: a student flies dual, anyone else as PIC.
export const roleOf = (crew: Crew | undefined, certs: PilotCerts | null | undefined): Role => crew?.role ?? (certs?.certificate && certs.certificate !== 'student' ? 'pic' : 'dual')

// What the airplane demands of its pilot.
export interface AircraftClass { engines: number; hp: number | null; complex: boolean; tailwheel: boolean; seats: number; lsa: boolean }
export function aircraftClass(p: AircraftProfile | null, e?: ProfileEdits): AircraftClass {
  const hpText = (e?.engine || p?.engine || '').match(/(\d{2,3})\s*(?:B?HP|horsepower)/i)
  return {
    engines: 1,
    hp: e?.hp ?? (hpText ? Number(hpText[1]) : null),
    complex: !!e?.complex, tailwheel: !!e?.tailwheel,
    seats: 2 + (p?.stations.some(s => s.key === 'rear') ? 2 : 0),
    lsa: (p?.limits.maxTakeoff ?? 9999) <= 1320,
  }
}

export interface PilotInput {
  certs: PilotCerts | null
  crew: Crew
  passengers: number
  night: boolean
  depart: Date | null
  aircraft: AircraftClass
  model: string | null
  worstVisib: number | null
  lowestCeiling: number | null
  cruiseAlt: number
  // Farthest any route point is from your home field, and whether you land somewhere else.
  maxFromHomeNm: number
  landsAway: boolean
  home: string
  classB: string[] // Class B airspace on the line at your altitude, or B airports you use
  controlled: string[] // B, C or D airspace / towered airports you use
  airports: string[] // airports you take off or land at
  xcEndorsedForFlight: boolean // the per-flight §61.93(c)(2) endorsement, ticked on the plan
  currency: { key: string; name: string; state: string; detail: string }[]
}

// 14 CFR 91 Appendix D, Section 4: no student solo takeoffs or landings.
export const NO_STUDENT_SOLO = ['KATL', 'KBOS', 'KORD', 'KDFW', 'KLAX', 'KMIA', 'KEWR', 'KJFK', 'KLGA', 'KSFO', 'KDCA', 'KADW']

const DAY = 86_400_000
const endOfMonth = (d: Date, months: number) => new Date(d.getFullYear(), d.getMonth() + months + 1, 0, 23, 59)
const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const parse = (s?: string) => { if (!s) return null; const d = new Date(`${s}T12:00:00`); return Number.isNaN(+d) ? null : d }

// When the medical stops covering the privileges you'll use (private-level or
// below; §61.23(d)). BasicMed: course every 24, exam every 48 calendar months.
export function medicalExpiry(m: PilotCerts['medical']): Date | null {
  const d = parse(m?.date)
  if (!d || !m?.kind) return null
  if (m.kind === 'basicmed') {
    const course = parse(m.course)
    const exam = endOfMonth(d, 48)
    return course ? new Date(Math.min(+exam, +endOfMonth(course, 24))) : exam
  }
  if (m.kind === 'first' || m.kind === 'second' || m.kind === 'third') return endOfMonth(d, m.under40 ? 60 : 24)
  return null
}

type Add = (status: Status, title: string, detail?: string, fix?: string) => void

export function pilotChecks(x: PilotInput): Check[] {
  const out: Check[] = []
  const add: Add = (status, title, detail, fix) => out.push({ section: 'pilot', status, title, detail, fix })
  const c = x.certs ?? {}
  const cert: Certificate = c.certificate ?? 'student'
  const en = c.endorsements ?? {}
  const role = roleOf(x.crew, x.certs)
  const when = x.depart ?? new Date()
  const certLabel = CERTIFICATES.find(k => k.key === cert)!.label.toLowerCase()

  if (!x.certs?.certificate) add('todo', 'Add your pilot certificate', 'Until then the checks assume a student pilot.', 'Pilot step → Your certificates: save your certificate, ratings, medical and endorsements.')

  if (role === 'dual') {
    add('ok', `Dual with ${x.crew.instructor?.trim() || 'your instructor'}`, 'The instructor is pilot in command: solo limits, §61.57 recency and your personal minimums don\'t bind (minimum breaches show as cautions to talk through). The instructor needs a current CFI certificate, flight review, medical and passenger currency for anyone in the back.')
    if (x.passengers > 0 && cert === 'student') add('caution', `${x.passengers} passenger${x.passengers > 1 ? 's' : ''} on a lesson`, 'Allowed with the instructor as PIC, but check your school\'s rules; their weight is in the W&B.')
    return out
  }

  // ── You are pilot in command ──
  const solo = cert === 'student'
  const label = solo ? 'Student solo' : `PIC on your ${certLabel} certificate`
  add('ok', label, solo ? 'You fly alone under §61.87–§61.95; the endorsements below must be in your logbook.' : `${x.passengers ? `${x.passengers} passenger${x.passengers > 1 ? 's' : ''}` : 'No passengers'}.`)

  // Medical (§61.23).
  const med = c.medical ?? {}
  const exp = medicalExpiry(med)
  if (cert === 'sport') {
    if (med.kind === 'none') add('nogo', 'Sport pilot needs a driver\'s license or a medical', '§61.23(c)(2).', 'Record your medical status under Your certificates.')
  } else if (!med.kind || med.kind === 'none' || med.kind === 'license') {
    add(med.kind ? 'nogo' : 'todo', med.kind ? `A ${certLabel} acting as PIC needs a medical certificate or BasicMed` : 'Medical not recorded', '§61.23(a).', 'Record the medical class and exam date under Your certificates.')
  } else if (exp && exp.getTime() < when.getTime()) {
    add('nogo', `${med.kind === 'basicmed' ? 'BasicMed' : 'Medical'} expired ${fmt(exp)}`, med.kind === 'basicmed' ? 'Course every 24 calendar months, exam every 48 (§61.113(i), §68).' : `${med.under40 ? 'Under 40 at the exam: 60' : '24'} calendar months for private and student privileges (§61.23(d)).`, 'Renew with an AME (or the BasicMed course and exam) before flying as PIC; fly dual meanwhile.')
  } else if (exp) {
    add(exp.getTime() - when.getTime() < 30 * DAY ? 'caution' : 'ok', `${med.kind === 'basicmed' ? 'BasicMed' : `${med.kind[0].toUpperCase()}${med.kind.slice(1)}-class medical`} valid until ${fmt(exp)}`, undefined, exp.getTime() - when.getTime() < 30 * DAY ? 'Book the renewal now.' : undefined)
  } else add('todo', 'Medical date not recorded', undefined, 'Enter the exam date under Your certificates so the planner can check it.')

  // Category and class (§61.31(d)); airplane-specific endorsements (§61.31(e), (f), (i)).
  if (!solo && cert !== 'sport' && !c.ratings?.asel && x.aircraft.engines === 1) add('nogo', 'No airplane single-engine land rating', '§61.31(d): your certificate must carry the category and class.', 'Tick ASEL under Your certificates if you hold it.')
  const need: [boolean, boolean | undefined, string, string][] = [
    [(x.aircraft.hp ?? 0) > 200, en.highPerformance, 'high-performance (over 200 hp)', '§61.31(f)'],
    [x.aircraft.complex, en.complex, 'complex', '§61.31(e)'],
    [x.aircraft.tailwheel, en.tailwheel, 'tailwheel', '§61.31(i)'],
  ]
  for (const [req, has, what, rule] of need) if (req) add(has ? 'ok' : 'nogo', has ? `${what[0].toUpperCase()}${what.slice(1)} endorsement` : `This airplane needs a ${what} endorsement`, rule, has ? undefined : 'Get the ground and flight training and the endorsement from a CFI, or fly it dual.')

  if (solo) {
    if (x.passengers > 0) add('nogo', 'Student pilots can\'t carry passengers', '§61.89(a)(1).', 'Leave the other seats empty, or set the flight to Dual with your instructor.')
    const s = parse(en.solo)
    if (!s) add('nogo', 'No solo endorsement recorded', '§61.87(n): your CFI\'s endorsement for this make and model, within the last 90 days.', 'Enter its date under Your certificates once it\'s in your logbook.')
    else {
      const until = new Date(s.getTime() + 90 * DAY)
      if (until < when) add('nogo', `Solo endorsement expired ${fmt(until)}`, '§61.87(n): 90 days.', 'Fly with your CFI to get it renewed.')
      else add(until.getTime() - when.getTime() < 14 * DAY ? 'caution' : 'ok', `Solo endorsement valid until ${fmt(until)}`, '§61.87(n).')
      if (en.soloModel && x.model && !x.model.toUpperCase().includes(en.soloModel.toUpperCase().replace(/^C(ESSNA)?\s*/, '')) && !en.soloModel.toUpperCase().includes(x.model.toUpperCase())) add('nogo', `Solo endorsement is for the ${en.soloModel}, not the ${x.model}`, '§61.87(n): make and model.', 'Get a solo endorsement for this model, or fly the airplane you\'re endorsed in.')
    }
    if (x.night) add(en.soloNight ? 'ok' : 'nogo', en.soloNight ? 'Night solo endorsement' : 'Part of the flight is at night', '§61.87(o): student solo at night needs night training and an endorsement.', en.soloNight ? undefined : 'Leave earlier so you land before civil twilight ends, or fly dual.')
    const visMin = x.night ? 5 : 3
    if (x.worstVisib != null && x.worstVisib < visMin) add('nogo', `Visibility ${x.worstVisib} SM, under the student-solo ${visMin} SM`, `§61.89(a)(${x.night ? 7 : 6}).`, 'Wait for better visibility or fly dual.')
    if (x.lowestCeiling != null && x.lowestCeiling < x.cruiseAlt + 500) add('caution', `Ceiling ${x.lowestCeiling.toLocaleString()} ft near your ${x.cruiseAlt.toLocaleString()} ft cruise`, '§61.89(a)(8): a student must keep visual reference to the surface.', 'Plan a lower altitude well clear of the clouds, or wait.')
    if (x.maxFromHomeNm > 25) {
      add(en.soloXc ? 'ok' : 'nogo', en.soloXc ? 'Solo cross-country endorsement' : `Goes ${Math.round(x.maxFromHomeNm)} nm from ${x.home}: a solo cross-country`, '§61.93(c)(1): beyond 25 nm needs the cross-country training endorsement for airplanes.', en.soloXc ? undefined : 'Keep within 25 nm, or finish the cross-country training and get the endorsement.')
      add(x.xcEndorsedForFlight ? 'ok' : 'todo', x.xcEndorsedForFlight ? 'Instructor endorsed this cross-country' : 'Instructor\'s endorsement for this cross-country', '§61.93(c)(2): your CFI reviews this plan and endorses this flight in your logbook.', x.xcEndorsedForFlight ? undefined : 'Show your CFI this plan; tick it under Who\'s flying in step 1 once endorsed.')
    } else if (x.landsAway) add(en.soloNearby || en.soloXc ? 'ok' : 'nogo', en.soloNearby || en.soloXc ? 'Endorsed to solo to a nearby airport' : 'Landing at another airport within 25 nm', '§61.93(b)(1): needs your CFI\'s endorsement for that airport.', en.soloNearby || en.soloXc ? undefined : 'Get the endorsement, or fly back to where you departed.')
    for (const a of x.airports.filter(a => NO_STUDENT_SOLO.includes(a))) add('nogo', `No student solo at ${a}`, '14 CFR 91 Appendix D, Section 4.', 'Choose another airport.')
    if (x.classB.length) {
      const b = parse(en.classB)
      const ok = b && b.getTime() + 90 * DAY >= when.getTime()
      add(ok ? 'ok' : 'nogo', ok ? `Class B endorsement (${en.classBAirport || 'on file'})` : `Class B (${x.classB.join(', ')}) as a student solo`, '§61.95: ground and flight training for that Class B, endorsed within 90 days.', ok ? undefined : 'Stay below or around the shelves (Route step altitude), or get the endorsement.')
    }
  } else {
    // Certificated pilots: certificate limits.
    if (cert === 'sport' || cert === 'recreational') {
      const maxPax = 1
      if (x.passengers > maxPax) add('nogo', `A ${certLabel} may carry one passenger`, cert === 'sport' ? '§61.315(c)(1).' : '§61.101(b).', 'Fewer passengers.')
      if (x.night) add('nogo', `No night flight on a ${certLabel} certificate`, cert === 'sport' ? '§61.315(c)(5).' : '§61.101(e)(8).', 'Land before the end of civil twilight.')
      if (x.cruiseAlt > 10000) add('nogo', 'Above 10,000 ft MSL', cert === 'sport' ? '§61.315(c)(12).' : '§61.101(e)(11).', 'Lower the cruise altitude in the Route step.')
      if (x.controlled.length && !en.towered) add('nogo', `Class B, C or D airspace / towered airport: ${x.controlled.join(', ')}`, cert === 'sport' ? '§61.325 endorsement required.' : '§61.101(d) endorsement required.', 'Get the endorsement, or route to non-towered fields outside B, C and D.')
    }
    if (cert === 'sport') {
      if (!x.aircraft.lsa) add('nogo', 'Not a light-sport aircraft', '§61.315(a): a sport pilot flies only LSA (max takeoff 1,320 lb, two seats).', 'Pick an LSA, or fly with a CFI.')
      if (x.worstVisib != null && x.worstVisib < 3) add('nogo', 'Visibility under 3 SM', '§61.315(c)(13).', 'Wait for better visibility.')
    }
    if (cert === 'recreational') {
      if ((x.aircraft.hp ?? 0) > 180 || x.aircraft.seats > 4) add('nogo', 'Airplane over 180 hp or four seats', '§61.101(e)(1)–(2).', 'Pick a smaller airplane.')
      if (x.maxFromHomeNm > 50 && !en.recreationalXc) add('nogo', 'More than 50 nm from the departure airport', '§61.101(c): needs the cross-country endorsement.', 'Stay within 50 nm or get the endorsement.')
    }
    if (cert === 'private' && x.passengers) add('ok', 'Private pilot: share costs only', '§61.113(c): passengers may pay no more than their pro rata share of fuel, oil, airport and rental costs.')

    // Flight review (§61.56): the logbook's flag, or the date you saved (a checkride counts).
    const review = x.currency.find(k => k.key === 'review')
    const saved = parse(c.flightReview)
    const savedOk = saved ? endOfMonth(saved, 24) >= when : false
    if (savedOk) add('ok', `Flight review current until ${fmt(endOfMonth(saved!, 24))}`, '§61.56.')
    else if (review?.state === 'current' || review?.state === 'expiring') add(review.state === 'current' ? 'ok' : 'caution', `Flight review: ${review.state}`, review.detail)
    else add(review?.state === 'lapsed' || saved ? 'nogo' : 'caution', review?.state === 'lapsed' || saved ? 'No flight review in the last 24 calendar months' : 'No flight review found', '§61.56: a review or a checkride within 24 calendar months to act as PIC.', 'Enter your last review or checkride date under Your certificates, or fly the review with a CFI (set this flight to Dual).')

    // Passenger currency (§61.57).
    if (x.passengers) {
      const day = x.currency.find(k => k.key === 'day'), nt = x.currency.find(k => k.key === 'night')
      if (day?.state === 'lapsed') add('nogo', 'Not current to carry passengers', `§61.57(a): 3 takeoffs and landings in 90 days. ${day.detail}`, 'Fly 3 takeoffs and landings solo (or with a CFI) first.')
      else if (day) add('ok', 'Passenger currency (day)', day.detail)
      if (x.night && nt?.state === 'lapsed') add('nogo', 'Not night current to carry passengers', `§61.57(b): 3 full-stop landings at night in 90 days. ${nt.detail}`, 'Fly 3 night full-stop landings first, or land by one hour after sunset.')
      else if (x.night && nt) add('ok', 'Passenger currency (night)', nt.detail)
    }
  }
  return out
}

// With an instructor on board, your personal minimums are talking points, not limits.
export const MINIMUMS_CHECK = /your .*(minimum|maximum)|below your minimums|ETA is after civil twilight/

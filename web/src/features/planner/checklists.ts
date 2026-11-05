// Inspections an airplane needs to be airworthy (AV1ATES); the planner checks
// the ones recorded for the tail.

export interface CheckItem { key: string; label: string; detail: string }

export const AV1ATES: (CheckItem & { months?: number; hours?: number; ifrOnly?: boolean })[] = [
  { key: 'annual', label: 'Annual inspection', detail: '§91.409(a): within the preceding 12 calendar months.', months: 12 },
  { key: 'vor', label: 'VOR check', detail: '§91.171: within 30 days — IFR only.', ifrOnly: true },
  { key: 'hundred', label: '100-hour inspection', detail: '§91.409(b): required when the airplane is used for hire or flight instruction (NICE AIR rentals).', hours: 100 },
  { key: 'ad', label: 'Airworthiness directives', detail: 'Recurring ADs complied with (aircraft maintenance records).' },
  { key: 'transponder', label: 'Transponder', detail: '§91.413: tested within 24 calendar months.', months: 24 },
  { key: 'elt', label: 'ELT', detail: '§91.207: inspected within 12 calendar months; battery replaced at 1 hour cumulative use or 50 % of its life.', months: 12 },
  { key: 'static', label: 'Altimeter / static system', detail: '§91.411: within 24 calendar months — IFR in controlled airspace.', months: 24, ifrOnly: true },
]

// Pilot condition (AIM 8-1-1).
export const IMSAFE: CheckItem[] = [
  { key: 'illness', label: 'Illness', detail: 'No symptoms: cold, congestion, fever, nausea.' },
  { key: 'medication', label: 'Medication', detail: 'Nothing that impairs (FAA "Do Not Issue / Do Not Fly" list: antihistamines, sleep aids).' },
  { key: 'stress', label: 'Stress', detail: 'No pressure from work, family or the schedule crowding out attention.' },
  { key: 'alcohol', label: 'Alcohol', detail: '8 hours bottle to throttle, under 0.04 % BAC (§91.17), no hangover.' },
  { key: 'fatigue', label: 'Fatigue', detail: 'Slept enough and not at the end of a long day.' },
  { key: 'eating', label: 'Emotion / Eating', detail: 'Emotionally settled, hydrated and fed.' },
]

// Maintenance and documents to look at before the flight: the inspections
// (AV1ATES, VFR items) in the aircraft logbooks or the school's dispatch board,
// and the documents on board (ARROW).
export const MX_DOCS: CheckItem[] = [
  { key: 'annual', label: 'Annual inspection', detail: '§91.409(a): within the preceding 12 calendar months.' },
  { key: 'hundred', label: '100-hour inspection', detail: '§91.409(b): the airplane is used for hire or instruction; hours left cover this flight.' },
  { key: 'ad', label: 'Airworthiness directives', detail: 'Recurring ADs complied with.' },
  { key: 'transponder', label: 'Transponder check', detail: '§91.413: within 24 calendar months.' },
  { key: 'elt', label: 'ELT inspection and battery', detail: '§91.207: within 12 calendar months; battery date not passed.' },
  { key: 'squawks', label: 'Open squawks', detail: 'None that ground the airplane; inoperative items placarded (§91.213).' },
  { key: 'arrow', label: 'Documents on board (ARROW)', detail: 'Airworthiness certificate, registration (not expired), radio licence if abroad, POH/operating limitations, weight and balance.' },
]

// §91.205(b) day VFR required equipment (ATOMATOFLAMES), items a 172 has.
export const EQUIPMENT_DAY: CheckItem[] = [
  { key: 'airspeed', label: 'Airspeed indicator', detail: '' },
  { key: 'tach', label: 'Tachometer', detail: '' },
  { key: 'oilpress', label: 'Oil pressure gauge', detail: '' },
  { key: 'altimeter', label: 'Altimeter', detail: '' },
  { key: 'oiltemp', label: 'Oil temperature gauge', detail: '' },
  { key: 'fuelgauge', label: 'Fuel gauges', detail: 'Each tank.' },
  { key: 'anticoll', label: 'Anti-collision lights', detail: 'Beacon / strobes.' },
  { key: 'compass', label: 'Magnetic compass', detail: '' },
  { key: 'elt', label: 'ELT', detail: '' },
  { key: 'belts', label: 'Seat belts and shoulder harnesses', detail: '' },
]

// §91.205(c) night VFR, in addition (FLAPS).
export const EQUIPMENT_NIGHT: CheckItem[] = [
  { key: 'fuses', label: 'Fuses or circuit breakers', detail: '' },
  { key: 'landinglight', label: 'Landing light', detail: 'Required for hire.' },
  { key: 'position', label: 'Position lights', detail: '' },
  { key: 'power', label: 'Source of electricity', detail: 'Alternator and battery.' },
]

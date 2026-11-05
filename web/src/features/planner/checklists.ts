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

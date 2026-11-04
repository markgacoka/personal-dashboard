// Display units by the aircraft's country of registration (ICAO nationality
// prefix): the US flies lb / US gal / inHg; most others kg / litres / hPa.
export interface Units { country: string; weight: 'lb' | 'kg'; fuel: 'gal' | 'L'; pressure: 'inHg' | 'hPa' }
export const US: Units = { country: 'United States', weight: 'lb', fuel: 'gal', pressure: 'inHg' }

const PREFIXES: [RegExp, Units][] = [
  [/^N[0-9A-Z]/, US],
  [/^C-?[FGI]/, { country: 'Canada', weight: 'lb', fuel: 'L', pressure: 'inHg' }],
  [/^G-/, { country: 'United Kingdom', weight: 'kg', fuel: 'L', pressure: 'hPa' }],
  [/^VH-/, { country: 'Australia', weight: 'kg', fuel: 'L', pressure: 'hPa' }],
  [/^ZK-/, { country: 'New Zealand', weight: 'kg', fuel: 'L', pressure: 'hPa' }],
  [/^EI-/, { country: 'Ireland', weight: 'kg', fuel: 'L', pressure: 'hPa' }],
  [/^D-/, { country: 'Germany', weight: 'kg', fuel: 'L', pressure: 'hPa' }],
  [/^F-/, { country: 'France', weight: 'kg', fuel: 'L', pressure: 'hPa' }],
  [/^XA-|^XB-|^XC-/, { country: 'Mexico', weight: 'kg', fuel: 'L', pressure: 'inHg' }],
  [/^ZS-/, { country: 'South Africa', weight: 'kg', fuel: 'L', pressure: 'hPa' }],
  [/^5Y-/, { country: 'Kenya', weight: 'kg', fuel: 'L', pressure: 'hPa' }],
  [/^JA/, { country: 'Japan', weight: 'kg', fuel: 'L', pressure: 'inHg' }],
]
export function unitsForTail(tail: string | null | undefined): Units {
  const t = String(tail || '').toUpperCase().trim()
  if (!t) return US
  for (const [re, u] of PREFIXES) if (re.test(t)) return u
  if (/^[A-Z0-9]{1,2}-/.test(t)) return { country: 'Outside the US', weight: 'kg', fuel: 'L', pressure: 'hPa' }
  return US
}
export const isUsTail = (tail: string | null | undefined) => unitsForTail(tail) === US

export const LB_PER_KG = 2.20462, L_PER_GAL = 3.78541
export const toW = (lb: number, u: Units) => (u.weight === 'kg' ? lb / LB_PER_KG : lb)
export const fromW = (v: number, u: Units) => (u.weight === 'kg' ? v * LB_PER_KG : v)
export const toF = (gal: number, u: Units) => (u.fuel === 'L' ? gal * L_PER_GAL : gal)
export const fromF = (v: number, u: Units) => (u.fuel === 'L' ? v / L_PER_GAL : v)
export const fmtW = (lb: number, u: Units) => `${Math.round(toW(lb, u)).toLocaleString()} ${u.weight}`
export const fmtF = (gal: number, u: Units, dp = 1) => `${toF(gal, u).toFixed(u.fuel === 'L' ? 0 : dp)} ${u.fuel}`
export const fmtP = (inHg: number | null, u: Units) => (inHg == null ? '—' : u.pressure === 'hPa' ? `${Math.round(inHg / 0.02953)} hPa` : `${inHg.toFixed(2)} inHg`)

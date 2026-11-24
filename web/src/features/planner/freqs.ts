// When to use each frequency an airport lists (NASR), the way the AIM and the
// Chart Supplement lay out a VFR departure and arrival.
import type { Airport } from './model'

export type FreqRole = 'departure' | 'arrival' | 'both'
const hrs = (a: Airport) => (a.towerHrs ? ` (tower ${a.towerHrs})` : '')

export function freqUse(use: string, a: Airport, role: FreqRole): string | null {
  const u = use.toUpperCase()
  const dep = role !== 'arrival', arr = role !== 'departure'
  if (u === 'ATIS' || u === 'D-ATIS') return [dep && 'Before start-up', arr && 'about 20 nm out, before the first call'].filter(Boolean).join('; ') + ': note the letter and altimeter (AIM 4-1-13).'
  if (u.startsWith('CD')) return dep ? 'Before taxi, for flight following or a Class B/C departure clearance.' : null
  if (u.startsWith('GND')) return [dep && 'Taxi out: call with the ATIS letter and where you are parked', arr && 'Taxi in, after tower says "contact ground"'].filter(Boolean).join('; ') + '.'
  if (u.startsWith('LCL')) return [dep && 'At the hold-short line, after the run-up', arr && 'About 10 nm out, before entering the Class D'].filter(Boolean).join('; ') + `${hrs(a)}.`
  if (u === 'CTAF') return `${a.towered ? `When the tower is closed${hrs(a)}: ` : ''}self-announce taxi, takeoff and departure${arr ? '; inbound 10 nm out, then each leg of the pattern' : ''} (AIM 4-1-9).`
  if (u === 'UNICOM') return 'Fuel and services, or as CTAF where no other is listed.'
  if (u.startsWith('DEP')) return dep ? 'After takeoff when told "contact departure", or for flight following.' : null
  if (u.startsWith('APCH') || u === 'CLASS C' || u === 'CLASS B') return arr ? 'Inbound, before the Class B/C boundary or for flight following; you need a clearance (B) or two-way contact (C).' : 'For flight following after departure.'
  return null
}

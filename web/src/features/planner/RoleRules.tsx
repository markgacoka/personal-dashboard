import { cn } from '@/lib/utils'
import { SubHead } from './ui'

type Col = 'solo' | 'dual' | 'private'
const COLS: { key: Col; label: string; sub: string }[] = [
  { key: 'solo', label: 'Student solo', sub: 'You are PIC, alone' },
  { key: 'dual', label: 'Dual', sub: 'Your CFI is PIC' },
  { key: 'private', label: 'Private pilot', sub: 'You are PIC' },
]
// What each kind of flight asks of you, as the checks under "This flight under
// the FAA rules" apply it (pilot.ts).
const ROWS: [string, Record<Col, string>][] = [
  ['Pilot in command', { solo: 'You', dual: 'The instructor', private: 'You' }],
  ['Passengers', { solo: 'None (§61.89(a)(1))', dual: 'Allowed (school rules)', private: 'Allowed; share costs only (§61.113(c)); 3 landings in 90 days to carry them (§61.57)' }],
  ['Endorsements', { solo: 'Solo within 90 days, this make and model (§61.87(n)); night (§61.87(o)); nearby airport or cross-country (§61.93); each Class B (§61.95)', dual: 'None for you', private: 'Complex, high performance or tailwheel if the airplane is (§61.31)' }],
  ['Cross-country', { solo: 'Over 25 nm needs the XC endorsement and your CFI\'s sign-off for this flight, in your logbook (§61.93(c))', dual: 'Counts as dual cross-country training', private: 'No limit' }],
  ['Weather', { solo: '3 SM day / 5 SM night, keep the ground in sight (§61.89(a)); your minimums', dual: 'Your minimums are talking points, not limits', private: 'VFR minimums (§91.155) and your personal minimums' }],
  ['Medical', { solo: 'Third class or better, current (§61.23)', dual: 'Not needed to log dual', private: 'Current medical or BasicMed (§61.23)' }],
  ['Carry', { solo: 'Student certificate, medical, photo ID, logbook with endorsements (§61.3, §61.51(i))', dual: 'Photo ID; CFI carries theirs', private: 'Pilot certificate, medical, photo ID (§61.3)' }],
  ['Flight review', { solo: 'Not required', dual: 'Instructor\'s must be current', private: 'Within 24 calendar months (§61.56)' }],
]

export function RoleRules({ current }: { current: Col }) {
  return (
    <div>
      <SubHead right={<span className="text-[13px] text-fg-3">Change it under Who's flying above</span>}>Solo, dual or private: what changes</SubHead>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-left align-bottom">
              <th className="w-28 pb-2" />
              {COLS.map(c => (
                <th key={c.key} className={cn('px-2 pb-2 font-medium', c.key === current ? 'text-accent' : 'text-fg-2')}>
                  {c.label}{c.key === current && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[12px]">this flight</span>}
                  <div className="text-[13px] font-normal text-fg-3">{c.sub}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([k, v]) => (
              <tr key={k} className="border-t border-border align-top">
                <td className="py-2 pr-2 text-fg-3">{k}</td>
                {COLS.map(c => <td key={c.key} className={cn('px-2 py-2', c.key === current ? 'bg-accent-soft/40 text-fg' : 'text-fg-2')}>{v[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

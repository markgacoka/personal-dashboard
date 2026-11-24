import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import type { Plan } from './model'
import { AircraftSetup, PersonForm } from './ProfileForms'
import { seatPerson, useAircraftProfiles, type Person } from './profiles'
import { CERTIFICATES } from './pilot'
import { useFlight } from './useFlight'

const Card = ({ on, onClick, title, sub, className }: { on: boolean; onClick: () => void; title: React.ReactNode; sub: React.ReactNode; className?: string }) => (
  <button type="button" onClick={onClick} aria-pressed={on}
    className={cn('min-w-0 rounded-lg px-3 py-2.5 text-left ring-1 ring-inset transition-colors', on ? 'bg-accent-soft ring-accent/50' : 'ring-border hover:bg-hover', className)}>
    <div className={cn('num truncate text-sm', on ? 'font-medium text-accent' : 'text-fg')}>{title}</div>
    <div className="truncate text-[13px] text-fg-3">{sub}</div>
  </button>
)

// The airplane: one of your aircraft profiles, a tail from your logbook, or a new one set up here.
export function AircraftPicker() {
  const f = useFlight()
  const ac = useAircraftProfiles()
  const [adding, setAdding] = useState<string | null>(null)
  const saved = ac.data ?? []
  const tails = [...saved.map(a => a.tail), ...f.fleet.map(a => a.tail_number).filter(t => !saved.some(a => a.tail === t))]
  const pick = (t: string) => f.set({ tail: t, aircraft: undefined })
  if (adding != null) return <AircraftSetup initialTail={adding || undefined} onCancel={() => setAdding(null)} onDone={t => { pick(t); setAdding(null) }} />
  const current = f.plan.tail
  const hasProfile = (t: string) => saved.some(a => a.tail === t)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {tails.map(t => {
          const s = saved.find(a => a.tail === t), fl = f.fleet.find(a => a.tail_number === t)
          return <Card key={t} on={t === current} onClick={() => pick(t)} title={t} sub={[s?.profile?.model || fl?.model, s ? (s.emptyWeight ? `${Math.round(s.emptyWeight)} lb empty` : 'empty weight needed') : 'no profile yet'].filter(Boolean).join(' · ')} />
        })}
        <button type="button" onClick={() => setAdding('')} className="flex min-h-14 items-center justify-center gap-1.5 rounded-lg text-sm text-accent border border-dashed border-border-strong hover:bg-hover"><Plus className="size-4" />Add an aircraft</button>
      </div>
      {current && !hasProfile(current) && (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-fg-3">{current} has no profile yet: its empty weight, equipment, inspections and checklist aren't known.
          <Button size="sm" variant="secondary" onClick={() => setAdding(current)}>Set up {current}</Button></p>
      )}
    </div>
  )
}

// Who's flying: a pilot profile (student, private and up) as the pilot, and
// for a dual flight an instructor profile, who is then PIC and sits front
// right. Both are loaded, or created here when they don't exist yet.
export function CrewPicker() {
  const f = useFlight()
  const [adding, setAdding] = useState<'pilot' | 'instructor' | null>(null)
  const role = f.role
  const cert = f.certs?.certificate ?? 'student'
  const pickPilot = (p: Person) => f.set({ ...seatPerson(f.plan as Plan, 'pilot', p), crew: { ...f.plan.crew, pilotId: p.id } })
  const pickCfi = (p: Person) => f.set({ ...seatPerson(f.plan as Plan, 'front', p), crew: { ...f.plan.crew, role: 'dual', instructor: p.name, instructorId: p.id } })
  const xc = f.d.checks.some(c => /Instructor('s)? endorse/.test(c.title))
  const certLabel = (p: Person) => (p.certs?.certificate ? CERTIFICATES.find(c => c.key === p.certs!.certificate)?.label : 'certificate not entered')
  return (
    <div className="space-y-5">
      <div>
        <h4 className="mb-2 text-sm text-fg-2">Pilot</h4>
        {adding === 'pilot' ? <PersonForm role="pilot" onCancel={() => setAdding(null)} onDone={p => { pickPilot(p); setAdding(null) }} /> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {f.crew.pilots.map(p => <Card key={p.id} on={f.pilot?.id === p.id} onClick={() => pickPilot(p)} title={p.name} sub={[certLabel(p), p.weightLb ? `${p.weightLb} lb` : null].filter(Boolean).join(' · ')} />)}
            <button type="button" onClick={() => setAdding('pilot')} className="flex min-h-14 items-center justify-center gap-1.5 rounded-lg text-sm text-accent border border-dashed border-border-strong hover:bg-hover"><Plus className="size-4" />Add a pilot</button>
          </div>
        )}
        {!f.crew.isLoading && !f.crew.pilots.length && adding !== 'pilot' && <p className="mt-2 text-[13px] text-fg-3">No pilot profiles yet. Add one: its certificate, medical and endorsements decide what this flight is allowed to be.</p>}
      </div>
      {f.pilot && (
        <div className="space-y-3">
          <Segmented value={role} onChange={r => f.set({ crew: { ...f.plan.crew, role: r } })}
            options={[{ value: 'pic', label: cert === 'student' ? 'Solo' : `${f.pilot.name.split(' ')[0]} as pilot in command` }, { value: 'dual', label: 'Dual with an instructor' }]} />
          <p className="text-[13px] text-fg-3">{role === 'dual' ? 'The instructor is pilot in command and sits front right.' : cert === 'student' ? 'Student solo: no passengers (§61.89), within the endorsements.' : 'Other seats are passengers.'}</p>
          {xc && (
            <label className="flex items-center gap-2 text-[13px] text-fg-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.plan.checklist?.['crew.xcEndorsed'] === true} onChange={e => f.set({ checklist: { ...f.plan.checklist, 'crew.xcEndorsed': e.target.checked } })} />
              The instructor endorsed this cross-country in the logbook (§61.93(c)(2))
            </label>
          )}
          {role === 'dual' && (adding === 'instructor'
            ? <PersonForm role="instructor" onCancel={() => setAdding(null)} onDone={p => { pickCfi(p); setAdding(null) }} />
            : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {f.crew.instructors.map(p => <Card key={p.id} on={f.plan.crew?.instructorId === p.id || (!f.plan.crew?.instructorId && f.plan.crew?.instructor === p.name)} onClick={() => pickCfi(p)} title={p.name} sub={[p.cfi ? `CFI ${p.cfi}` : 'CFI', p.weightLb ? `${p.weightLb} lb` : 'weight not entered'].join(' · ')} />)}
                <button type="button" onClick={() => setAdding('instructor')} className="flex min-h-14 items-center justify-center gap-1.5 rounded-lg text-sm text-accent border border-dashed border-border-strong hover:bg-hover"><Plus className="size-4" />Add an instructor</button>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

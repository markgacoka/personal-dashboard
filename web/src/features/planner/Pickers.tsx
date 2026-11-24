import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import { usePilotInfo } from './api'
import type { Plan } from './model'
import { roleOf } from './pilot'
import { AircraftSetup, PersonForm, PilotSetup } from './ProfileForms'
import { seatPerson, useAircraftProfiles, usePeople } from './profiles'
import { useFlight } from './useFlight'

const Card = ({ on, onClick, title, sub, className }: { on: boolean; onClick: () => void; title: React.ReactNode; sub: React.ReactNode; className?: string }) => (
  <button type="button" onClick={onClick} aria-pressed={on}
    className={cn('min-w-0 rounded-lg px-3 py-2.5 text-left ring-1 ring-inset transition-colors', on ? 'bg-accent-soft ring-accent/50' : 'ring-border hover:bg-hover', className)}>
    <div className={cn('num truncate text-sm', on ? 'font-medium text-accent' : 'text-fg')}>{title}</div>
    <div className="truncate text-[13px] text-fg-3">{sub}</div>
  </button>
)

// Your pilot profile, asked for once: shown where it's first needed until it exists.
export function NeedsPilotProfile() {
  const info = usePilotInfo()
  const f = useFlight()
  const [done, setDone] = useState(false)
  if (done || info.isLoading || (info.data?.name && info.data?.weightLb && f.certs?.certificate)) return null
  return (
    <section className="rounded-xl px-4 py-4 ring-1 ring-inset ring-accent/40 sm:px-5">
      <h3 className="text-[15px] font-medium text-fg">First, about you</h3>
      <p className="mb-3 mt-0.5 text-[13px] text-fg-3">Asked once and kept in your pilot profile for every flight.</p>
      <PilotSetup onDone={() => setDone(true)} />
    </section>
  )
}

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

// Who's flying: you as pilot in command, or dual with one of your instructors
// (they sit front right, with their weight in the W&B).
export function CrewPicker() {
  const f = useFlight()
  const people = usePeople()
  const [adding, setAdding] = useState(false)
  const role = roleOf(f.plan.crew, f.certs)
  const cert = f.certs?.certificate ?? 'student'
  const cfis = people.list.filter(p => p.role === 'instructor')
  const seat = (p: (typeof cfis)[number]) => f.set({ ...seatPerson(f.plan as Plan, 'front', p), crew: { ...f.plan.crew, role: 'dual', instructor: p.name } })
  const current = f.plan.seatPeople?.front
  const xc = f.d.checks.some(c => /Instructor('s)? endorse/.test(c.title))
  return (
    <div className="space-y-3">
      <Segmented value={role} onChange={r => f.set({ crew: { ...f.plan.crew, role: r } })}
        options={[{ value: 'pic', label: cert === 'student' ? 'Solo' : 'Me as pilot in command' }, { value: 'dual', label: 'Dual with an instructor' }]} />
      <p className="text-[13px] text-fg-3">{role === 'dual' ? 'Your instructor is pilot in command and sits front right.' : cert === 'student' ? 'Student solo: no passengers (§61.89), within your endorsements.' : 'You are pilot in command; other seats are passengers.'}</p>
      {xc && (
        <label className="flex items-center gap-2 text-[13px] text-fg-2">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.plan.checklist?.['crew.xcEndorsed'] === true} onChange={e => f.set({ checklist: { ...f.plan.checklist, 'crew.xcEndorsed': e.target.checked } })} />
          My instructor endorsed this cross-country in my logbook (§61.93(c)(2))
        </label>
      )}
      {role === 'dual' && (adding
        ? <PersonForm role="instructor" initial={{ name: f.plan.crew?.instructor && !cfis.some(c => c.name === f.plan.crew?.instructor) ? f.plan.crew.instructor : '' }} onCancel={() => setAdding(false)} onDone={p => { seat(p); setAdding(false) }} />
        : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {cfis.map(p => <Card key={p.id} on={current === p.id || (!current && f.plan.crew?.instructor === p.name)} onClick={() => seat(p)} title={p.name} sub={p.weightLb ? `${p.weightLb} lb` : 'weight not entered'} />)}
            <button type="button" onClick={() => setAdding(true)} className="flex min-h-14 items-center justify-center gap-1.5 rounded-lg text-sm text-accent border border-dashed border-border-strong hover:bg-hover"><Plus className="size-4" />Add an instructor</button>
          </div>
        ))}
    </div>
  )
}

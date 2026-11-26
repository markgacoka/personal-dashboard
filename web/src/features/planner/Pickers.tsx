import { useState } from 'react'
import { GraduationCap, MapPin, Pencil, Plane, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Segmented } from '@/components/ui/misc'
import { Dialog, DialogContent, useConfirm } from '@/components/ui/overlay'
import { useRegistry } from '@/lib/queries'
import { titleCase } from '@/lib/format'
import { cn } from '@/lib/utils'
import { usePlans } from './api'
import { AirportProfileForm } from './AirportsStep'
import { isWaypoint, type Airport, type Plan } from './model'
import { AircraftDialog, PersonDialog } from './ProfileForms'
import { SELF, seatPerson, useAircraftProfiles, useHiddenAircraft, usedBy, type Person, type PersonRole } from './profiles'
import { CERTIFICATES } from './pilot'
import { useFlight } from './useFlight'

// One profile as a card: what it is at a glance, selected or not, and its own
// edit and delete (delete asks first and says how many flights use it).
function Tile({ on, onPick, visual, title, sub, onEdit, onDelete, onRestore, label }: {
  on: boolean; onPick: () => void; visual: React.ReactNode; title: React.ReactNode; sub: React.ReactNode; onEdit?: () => void; onDelete?: () => void; onRestore?: () => void; label: string
}) {
  return (
    <div className={cn('group relative flex min-w-0 items-center gap-3 rounded-xl p-2.5 pr-2 ring-1 ring-inset transition-colors', on ? 'bg-accent-soft ring-accent/50' : 'ring-border hover:bg-hover')}>
      <button type="button" onClick={onPick} aria-pressed={on} aria-label={`Use ${label}`} className="absolute inset-0 rounded-xl" />
      <span className="pointer-events-none shrink-0">{visual}</span>
      <span className="pointer-events-none min-w-0 flex-1">
        <span className={cn('num block truncate text-sm', on ? 'font-medium text-accent' : 'text-fg')}>{title}</span>
        <span className="block truncate text-[13px] text-fg-3">{sub}</span>
      </span>
      {(onEdit || onDelete || onRestore) && (
        <span className="relative flex shrink-0 gap-0.5 rounded-full [@media(hover:hover)]:absolute [@media(hover:hover)]:right-1.5 [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:-translate-y-1/2 [@media(hover:hover)]:bg-card [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:shadow-pop group-hover:opacity-100 group-focus-within:opacity-100">
          {onEdit && <button type="button" onClick={onEdit} aria-label={`Edit ${label}`} title="Edit" className="grid size-8 place-items-center rounded-full text-fg-3 hover:bg-pill hover:text-fg"><Pencil className="size-3.5" /></button>}
          {onDelete && <button type="button" onClick={onDelete} aria-label={`Delete ${label}`} title="Delete" className="grid size-8 place-items-center rounded-full text-fg-3 hover:bg-bad-soft hover:text-bad"><Trash2 className="size-3.5" /></button>}
          {onRestore && <button type="button" onClick={onRestore} aria-label={`Show ${label} again`} title="Show again" className="grid size-8 place-items-center rounded-full text-fg-3 hover:bg-pill hover:text-fg"><RotateCcw className="size-3.5" /></button>}
        </span>
      )}
    </div>
  )
}

const AddTile = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="flex min-h-[3.75rem] items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong text-sm text-accent hover:bg-hover"><Plus className="size-4" />{children}</button>
)
const GRID = 'grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]'

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
const Avatar = ({ name, role }: { name: string; role: PersonRole }) => (
  <span className={cn('grid size-10 place-items-center rounded-full text-[13px] font-semibold', role === 'instructor' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent')}>
    {role === 'instructor' ? <GraduationCap className="size-4.5" /> : initials(name)}
  </span>
)
function AircraftThumb({ tail }: { tail: string }) {
  const reg = useRegistry(tail)
  const src = reg.data?.photo_url
  return src
    ? <img src={src} alt="" className="h-10 w-14 rounded-md object-cover ring-1 ring-border" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} />
    : <span className="grid h-10 w-14 place-items-center rounded-md bg-pill text-fg-3"><Plane className="size-4.5" /></span>
}

// The airplane: one of your aircraft profiles or a tail from your logbook; add,
// edit (its setup) or delete a profile here.
export function AircraftPicker() {
  const f = useFlight()
  const ac = useAircraftProfiles()
  const hidden = useHiddenAircraft()
  const plans = usePlans()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState<{ tail?: string } | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const saved = ac.data ?? []
  const all = [...saved.map(a => a.tail), ...f.fleet.map(a => a.tail_number).filter(t => !saved.some(a => a.tail === t))]
  // The flight's own aircraft always shows, hidden or not.
  const isHidden = (t: string) => hidden.tails.includes(t) && t !== f.plan.tail
  const tails = all.filter(t => showHidden || !isHidden(t))
  const nHidden = all.filter(isHidden).length
  const pick = (t: string) => f.set({ tail: t, aircraft: undefined })
  // Delete: a profile is deleted; a logbook tail is only taken off this list (the logbook keeps it).
  const remove = async (t: string) => {
    const s = saved.find(a => a.tail === t), n = usedBy(plans.data, 'aircraft', t)
    const ok = await confirm({
      title: s ? `Delete ${t}?` : `Remove ${t} from this list?`,
      body: s ? `Its profile (empty weight, equipment, inspections, checklist) is deleted and it leaves this list. ${n ? `${n} flight${n > 1 ? 's use' : ' uses'} it and will use the POH sample airplane.` : ''} Your logbook keeps its flights.`
        : `${t} comes from your logbook and stays there; it just won't be offered here. You can show it again below the list.`,
      confirm: s ? 'Delete' : 'Remove', danger: true,
    })
    if (!ok) return
    try {
      if (s) await ac.remove.mutateAsync(t)
      if (f.fleet.some(x => x.tail_number === t)) await hidden.hide(t)
      toast.success(s ? `${t} deleted` : `${t} removed from the list`)
    } catch (e) { toast.error((e as Error).message) }
  }
  return (
    <>
      <div className={GRID}>
        {tails.map(t => {
          const s = saved.find(a => a.tail === t), fl = f.fleet.find(a => a.tail_number === t)
          return <Tile key={t} label={t} on={t === f.plan.tail} onPick={() => pick(t)} visual={<AircraftThumb tail={t} />} title={t}
            sub={isHidden(t) ? 'hidden' : [s?.profile?.model || fl?.model, s ? (s.emptyWeight ? `${Math.round(s.emptyWeight).toLocaleString()} lb` : 'no empty weight') : 'no profile'].filter(Boolean).join(' · ')}
            onEdit={() => setDialog({ tail: t })} onDelete={isHidden(t) ? undefined : () => remove(t)} onRestore={isHidden(t) ? () => hidden.show(t) : undefined} />
        })}
        <AddTile onClick={() => setDialog({})}>Add an aircraft</AddTile>
      </div>
      {nHidden > 0 && (
        <button type="button" onClick={() => setShowHidden(v => !v)} className="mt-2 text-[13px] text-fg-3 hover:text-fg">
          {showHidden ? 'Hide removed aircraft' : `${nHidden} removed from this list · show`}
        </button>
      )}
      <AircraftDialog open={!!dialog} onOpenChange={o => !o && setDialog(null)} initialTail={dialog?.tail} onDone={t => { pick(t); hidden.show(t).catch(() => {}) }} />
    </>
  )
}

// Who's flying: a pilot profile as the pilot and, for a dual flight, an
// instructor's, who is then PIC and sits front right. Added, edited or deleted here.
export function CrewPicker() {
  const f = useFlight()
  const plans = usePlans()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState<{ role: PersonRole; p?: Person } | null>(null)
  const role = f.role
  const cert = f.certs?.certificate ?? 'student'
  const pickPilot = (p: Person) => f.set({ ...seatPerson(f.plan as Plan, 'pilot', p), crew: { ...f.plan.crew, pilotId: p.id } })
  const pickCfi = (p: Person) => f.set({ ...seatPerson(f.plan as Plan, 'front', p), crew: { ...f.plan.crew, role: 'dual', instructor: p.name, instructorId: p.id } })
  const xc = f.d.checks.some(c => /Instructor('s)? endorse/.test(c.title))
  const certLabel = (p: Person) => (p.certs?.certificate ? CERTIFICATES.find(c => c.key === p.certs!.certificate)?.label : 'no certificate')
  const remove = async (p: Person) => {
    const n = usedBy(plans.data, 'pilots', p.id)
    if (!await confirm({ title: `Delete ${p.name}?`, body: n ? `${n} flight${n > 1 ? 's use' : ' uses'} this profile; they keep the seat weight it gave them.` : 'This removes the profile.', confirm: 'Delete', danger: true })) return
    await f.crew.remove(p.id)
    if (f.plan.crew?.pilotId === p.id) f.set({ crew: { ...f.plan.crew, pilotId: undefined } })
    if (f.plan.crew?.instructorId === p.id) f.set({ crew: { ...f.plan.crew, instructorId: undefined } })
    toast.success(`${p.name} deleted`)
  }
  const picked = (p: Person) => (p.role === 'instructor' ? pickCfi(p) : pickPilot(p))
  return (
    <div className="space-y-5">
      <div className={GRID}>
        {f.crew.pilots.map(p => <Tile key={p.id} label={p.name} on={f.pilot?.id === p.id} onPick={() => pickPilot(p)} visual={<Avatar name={p.name} role="pilot" />} title={p.name}
          sub={[certLabel(p), p.weightLb ? `${p.weightLb} lb` : null].filter(Boolean).join(' · ')} onEdit={() => setDialog({ role: 'pilot', p })} onDelete={p.id === SELF ? undefined : () => remove(p)} />)}
        <AddTile onClick={() => setDialog({ role: 'pilot' })}>Add a pilot</AddTile>
      </div>
      {f.pilot && (
        <div className="space-y-3">
          <Segmented value={role} onChange={r => f.set({ crew: { ...f.plan.crew, role: r } })}
            options={[{ value: 'pic', label: cert === 'student' ? 'Solo' : 'Pilot in command' }, { value: 'dual', label: 'Dual' }]} />
          {xc && (
            <label className="flex items-center gap-2 text-[13px] text-fg-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.plan.checklist?.['crew.xcEndorsed'] === true} onChange={e => f.set({ checklist: { ...f.plan.checklist, 'crew.xcEndorsed': e.target.checked } })} />
              Cross-country endorsed in the logbook <span className="text-fg-3">§61.93(c)(2)</span>
            </label>
          )}
          {role === 'dual' && (
            <div className={GRID}>
              {f.crew.instructors.map(p => <Tile key={p.id} label={p.name} on={f.plan.crew?.instructorId === p.id || (!f.plan.crew?.instructorId && f.plan.crew?.instructor === p.name)} onPick={() => pickCfi(p)}
                visual={<Avatar name={p.name} role="instructor" />} title={p.name} sub={[p.cfi ? `CFI ${p.cfi}` : 'CFI', p.weightLb ? `${p.weightLb} lb` : 'no weight'].join(' · ')}
                onEdit={() => setDialog({ role: 'instructor', p })} onDelete={() => remove(p)} />)}
              <AddTile onClick={() => setDialog({ role: 'instructor' })}>Add an instructor</AddTile>
            </div>
          )}
        </div>
      )}
      <PersonDialog open={!!dialog} onOpenChange={o => !o && setDialog(null)} role={dialog?.role ?? 'pilot'} initial={dialog?.p} exists={!!dialog?.p}
        onDone={p => { if (!dialog?.p) picked(p); else if (f.pilot?.id === p.id || f.plan.crew?.instructorId === p.id) picked(p) }} />
    </div>
  )
}

// The airports on the route, each with your profile for it (pattern altitude,
// pattern sides, notes): add or edit it in a modal, or delete it.
export function RouteAirportProfiles() {
  const f = useFlight()
  const confirm = useConfirm()
  const [edit, setEdit] = useState<Airport | null>(null)
  const ids = [...new Set(f.routePts.filter(p => !isWaypoint(p)).map(p => p.icao || p.id))]
  const nasrOf = (id: string) => f.nasr.find(a => a.icao === id || a.id === id)
  const profiles = f.aptProfiles.data ?? {}
  if (!ids.length) return null
  const save = (id: string, p: Parameters<typeof f.aptProfiles.save.mutate>[0]['profile']) => f.aptProfiles.save.mutate({ id, profile: p }, { onSuccess: () => toast.success(p ? `${id} profile saved` : `${id} profile deleted`), onError: e => toast.error(e.message) })
  return (
    <>
      <div className={GRID}>
        {ids.map(id => {
          const a = nasrOf(id), pr = profiles[id]
          const sub = pr ? [pr.tpaMsl ? `TPA ${pr.tpaMsl.toLocaleString()}` : null, Object.keys(pr.pattern ?? {}).length ? 'pattern sides' : null, pr.notes ? 'notes' : null].filter(Boolean).join(' · ') || 'Profile saved' : 'No profile'
          return <Tile key={id} label={id} on={!!pr} onPick={() => a && setEdit(a)} visual={<span className="grid size-10 place-items-center rounded-full bg-pill text-fg-3"><MapPin className="size-4.5" /></span>}
            title={<>{id}{a && <span className="font-sans font-normal text-fg-3"> · {titleCase(a.name)}</span>}</>} sub={sub}
            onEdit={a ? () => setEdit(a) : undefined}
            onDelete={pr ? async () => { if (await confirm({ title: `Delete your ${id} profile?`, body: 'Its pattern altitude, pattern sides and notes go back to the Chart Supplement\'s.', confirm: 'Delete', danger: true })) save(id, null) } : undefined} />
        })}
      </div>
      <Dialog open={!!edit} onOpenChange={o => !o && setEdit(null)}>
        {edit && <DialogContent title={`${edit.icao || edit.id} profile`} description={titleCase(edit.name)}>
          <AirportProfileForm bare a={edit} profile={profiles[edit.icao || edit.id] ?? null} saving={f.aptProfiles.save.isPending} onCancel={() => setEdit(null)} onSave={p => { save(edit.icao || edit.id, p); setEdit(null) }} />
        </DialogContent>}
      </Dialog>
    </>
  )
}

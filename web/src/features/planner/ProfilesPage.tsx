import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { PageHeader } from '@/components/data/stat'
import { useAircraftList, useInstructors, useRegistry } from '@/lib/queries'
import { titleCase } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAirports, useCertificates, useMinimums, usePilotInfo, usePlanning, usePlans, usePohFind } from './api'
import { AircraftDocs, ProfileEditor } from './AircraftProfile'
import { ChecklistEditor } from './AircraftChecklist'
import { AircraftSetup, EquipmentForm, PohReport } from './ProfileForms'
import { InspectionDates } from './AircraftStep'
import { AirportProfileForm } from './AirportsStep'
import { CertificatesEditor } from './Certificates'
import { EmptyWeight, OptNum } from './FlightInputs'
import { MinimumsEditor } from './Minimums'
import { DEFAULT_MINIMUMS, parseRouteItem } from './model'
import { CERTIFICATES } from './pilot'
import { SELF, newId, useAircraftProfiles, useAllAirportProfiles, usePeople, type Person } from './profiles'
import { RecordsList } from './RecordsList'
import { AIRCRAFT_RECORDS, PILOT_RECORDS } from './records'
import { KV, SubHead, Synced } from './ui'
import { unitsForTail } from './units'

type Kind = 'pilots' | 'aircraft' | 'airports'
interface Item { id: string; title: string; sub: string; draft?: boolean }

// Profiles: the people, aircraft and airports plans load, each created, read,
// changed and deleted here without opening a plan (docs/planner-ux.md).
export default function ProfilesPage() {
  const [params, setParams] = useSearchParams()
  const tab = (['pilots', 'aircraft', 'airports'].includes(params.get('tab') ?? '') ? params.get('tab') : 'pilots') as Kind
  const id = params.get('id')
  const pick = (t: Kind, next?: string | null) => setParams(next ? { tab: t, id: next } : { tab: t }, { replace: true })

  const self = usePilotInfo(), certs = useCertificates(), people = usePeople(), cfis = useInstructors()
  const aircraft = useAircraftProfiles(), fleet = useAircraftList()
  const airports = useAllAirportProfiles()
  const plans = usePlans()

  // What each saved plan loads, so deleting says what keeps its copy.
  const usedBy = (kind: Kind, key: string) => (plans.data ?? []).filter(p => kind === 'aircraft' ? p.data.tail === key
    : kind === 'airports' ? p.data.route.some(r => parseRouteItem(r).id === key) || p.data.alternate === key
      : Object.values(p.data.seatPeople ?? {}).includes(key) || p.data.crew?.pilotId === key || p.data.crew?.instructorId === key).length

  const [draft, setDraft] = useState<string | null>(null) // a new profile's key until it's saved
  const lists: Record<Kind, Item[]> = useMemo(() => {
    const ppl = people.list
    const fromLog = (cfis.data ?? []).filter(c => !ppl.some(p => p.name.toLowerCase() === c.name.toLowerCase()))
    const saved = aircraft.data ?? []
    return {
      pilots: [
        { id: SELF, title: self.data?.name || 'You', sub: [certs.data?.certificate ? CERTIFICATES.find(c => c.key === certs.data!.certificate)?.label : 'Certificate not saved', self.data?.weightLb ? `${self.data.weightLb} lb` : null].filter(Boolean).join(' · ') },
        ...ppl.map(p => ({ id: p.id, title: p.name || 'Unnamed', sub: [p.role === 'pilot' ? (CERTIFICATES.find(c => c.key === p.certs?.certificate)?.label ?? 'Pilot') : p.role === 'instructor' ? 'Instructor' : 'Passenger', p.weightLb ? `${p.weightLb} lb` : 'no weight'].join(' · ') })),
        ...fromLog.map(c => ({ id: `log:${c.name}`, title: c.name, sub: 'Instructor in your logbook · no profile yet', draft: true })),
      ],
      aircraft: [
        ...saved.map(a => ({ id: a.tail, title: a.tail, sub: [a.profile?.model || fleet.data?.find(f => f.tail_number === a.tail)?.model, a.emptyWeight ? `${Math.round(a.emptyWeight)} lb empty` : 'empty weight not entered'].filter(Boolean).join(' · ') })),
        ...(fleet.data ?? []).filter(f => !saved.some(a => a.tail === f.tail_number)).map(f => ({ id: f.tail_number, title: f.tail_number, sub: `${[f.make && titleCase(f.make), f.model].filter(Boolean).join(' ')} · in your logbook, no profile yet`, draft: true })),
      ],
      airports: Object.entries(airports.data ?? {}).map(([k, p]) => ({ id: k, title: k, sub: [p.tpaMsl ? `Pattern ${p.tpaMsl.toLocaleString()} ft` : null, Object.keys(p.pattern ?? {}).length ? 'pattern sides' : null, p.notes ? 'notes' : null].filter(Boolean).join(' · ') || 'Saved' })),
    }
  }, [people.list, cfis.data, aircraft.data, fleet.data, airports.data, self.data, certs.data])

  const items = lists[tab]
  const current = id ?? (tab === 'pilots' ? SELF : items[0]?.id ?? null)
  useEffect(() => setDraft(null), [tab])

  const add = (key: string) => { setDraft(key); pick(tab, key) }
  return (
    <div className="planner">
      <PageHeader title="Profiles"
        actions={<Button asChild variant="ghost"><Link to="/flying/plan"><ChevronLeft />Flight planner</Link></Button>} />
      <Segmented value={tab} onChange={t => pick(t)} options={[
        { value: 'pilots', label: 'People', count: lists.pilots.filter(i => !i.draft).length },
        { value: 'aircraft', label: 'Aircraft', count: (aircraft.data ?? []).length },
        { value: 'airports', label: 'Airports', count: lists.airports.length },
      ]} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <Card className={cn('h-fit p-2', id && 'max-lg:hidden')}>
          <NewItem kind={tab} onAdd={add} existing={items.map(i => i.id)} />
          <ul className="mt-1 space-y-0.5">
            {items.map(i => (
              <li key={i.id}>
                <button onClick={() => pick(tab, i.id)} aria-current={i.id === current ? 'true' : undefined}
                  className={cn('w-full rounded-lg px-3 py-2 text-left ring-1 ring-inset', i.id === current ? 'bg-accent-soft ring-accent/40' : 'ring-transparent hover:bg-hover')}>
                  <div className={cn('num truncate text-sm', i.id === current ? 'font-medium text-accent' : i.draft ? 'text-fg-2' : 'text-fg')}>{i.title}</div>
                  <div className="truncate text-[13px] text-fg-3">{i.sub}</div>
                </button>
              </li>
            ))}
            {!items.length && <li className="px-3 py-3 text-[13px] text-fg-3">None yet.</li>}
          </ul>
        </Card>

        <Card className={cn('@container min-w-0 px-4 py-5 sm:px-6', !id && 'max-lg:hidden')}>
          {id && <Button variant="ghost" size="sm" className="-ml-2 mb-3 lg:hidden" onClick={() => pick(tab)}><ChevronLeft />{tab === 'pilots' ? 'Pilots' : tab === 'aircraft' ? 'Aircraft' : 'Airports'}</Button>}
          {!current && <p className="text-sm text-fg-3">Choose one from the list, or add one.</p>}
          {current && tab === 'pilots' && (current === SELF ? <SelfProfile />
            : <PersonProfile key={current} person={people.list.find(p => p.id === current) ?? (current.startsWith('log:') ? { id: newId(), name: current.slice(4), role: 'instructor', weightLb: null } : draft === current ? { id: current, name: '', role: 'passenger', weightLb: null } : null)}
              exists={people.list.some(p => p.id === current)} used={usedBy('pilots', current)} saving={people.save.isPending}
              onSave={async p => { await people.upsert(p); toast.success(`${p.name} saved`); setDraft(null); pick('pilots', p.id) }}
              onDelete={async p => { await people.remove(p.id); toast.success(`${p.name} deleted`); pick('pilots') }} />)}
          {current && tab === 'aircraft' && !(aircraft.data ?? []).some(a => a.tail === current) && (draft === current || lists.aircraft.some(i => i.id === current && i.draft))
            ? <div><Lead title={<>New aircraft{current ? <> · <span className="num">{current}</span></> : ''}</>} />
                <AircraftSetup key={current} initialTail={current} onCancel={() => { setDraft(null); pick('aircraft') }} onDone={t => { setDraft(null); pick('aircraft', t) }} /></div>
            : current && tab === 'aircraft' && <AircraftProfileView key={current} tail={current} used={usedBy('aircraft', current)} saved={(aircraft.data ?? []).some(a => a.tail === current)}
            onDelete={async () => { await aircraft.remove.mutateAsync(current); toast.success(`${current} profile deleted`); pick('aircraft') }} />}
          {current && tab === 'airports' && <AirportProfileView key={current} id={current} profile={airports.data?.[current] ?? null} used={usedBy('airports', current)} saving={airports.save.isPending}
            onSave={p => airports.save.mutate({ id: current, profile: p }, { onSuccess: () => { toast.success(p ? `${current} saved` : `${current} profile deleted`); if (!p) pick('airports') }, onError: e => toast.error(e.message) })} />}
        </Card>
      </div>
    </div>
  )
}

// The list's "add" row: a person by name later, an aircraft by tail, an airport by ident.
function NewItem({ kind, onAdd, existing }: { kind: Kind; onAdd: (key: string) => void; existing: string[] }) {
  const [v, setV] = useState('')
  useEffect(() => setV(''), [kind])
  if (kind === 'pilots') return <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => onAdd(newId())}><Plus />Add a pilot, instructor or passenger</Button>
  const ok = kind === 'aircraft' ? /^N?[0-9][0-9A-Z]{0,4}$/.test(v) : /^[A-Z0-9]{3,4}$/.test(v)
  const key = kind === 'aircraft' && ok && !v.startsWith('N') ? `N${v}` : v
  const submit = () => { if (ok) { onAdd(key); setV('') } }
  return (
    <form className="flex gap-2 p-1" onSubmit={e => { e.preventDefault(); submit() }}>
      <Input value={v} onChange={e => setV(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder={kind === 'aircraft' ? 'Tail number, e.g. N227AN' : 'Airport, e.g. KRHV'} className="num uppercase placeholder:normal-case" aria-label={kind === 'aircraft' ? 'Tail number' : 'Airport identifier'} />
      <Button type="submit" variant="secondary" disabled={!ok}>{existing.includes(key) ? 'Open' : 'Add'}</Button>
    </form>
  )
}

// Delete with what it affects, then a second press: nothing is removed on one click.
function DeleteRow({ what, used, onDelete, note, after }: { what: string; used: number; onDelete: () => void; note?: string; after: string }) {
  const [sure, setSure] = useState(false)
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-[13px] text-fg-3">
      <span className="min-w-0 flex-1">{note}{used ? ` ${used} saved plan${used > 1 ? 's use' : ' uses'} it; ${after}` : ''}</span>
      {sure
        ? <><span className="text-fg-2">Delete {what}?</span><Button size="sm" variant="danger" onClick={onDelete}>Delete</Button><Button size="sm" variant="ghost" onClick={() => setSure(false)}>Keep</Button></>
        : <Button size="sm" variant="danger-ghost" onClick={() => setSure(true)}>Delete profile</Button>}
    </div>
  )
}

function Lead({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return <div className="mb-6"><h2 className="text-lg font-medium tracking-[-0.011em] text-fg">{title}</h2>{children && <p className="mt-1 text-[13px] text-fg-3">{children}</p>}</div>
}

/* ── You ── */
function SelfProfile() {
  const info = usePilotInfo(), certs = useCertificates(), mins = useMinimums()
  const [f, setF] = useState(info.data ?? {})
  useEffect(() => setF(info.data ?? {}), [info.data])
  const dirty = JSON.stringify({ ...info.data, updatedAt: undefined }) !== JSON.stringify({ ...f, updatedAt: undefined })
  const txt = (k: 'name' | 'phone' | 'base' | 'address', label: string, ph: string) => (
    <label className="block min-w-0"><span className="mb-1 block text-sm text-fg-2">{label}</span><Input value={f[k] ?? ''} placeholder={ph} onChange={e => setF(x => ({ ...x, [k]: k === 'base' ? e.target.value.toUpperCase() : e.target.value }))} /></label>
  )
  return (
    <div>
      <Lead title={info.data?.name || 'You'} />
      <section>
        <SubHead right={<Synced at={info.data?.updatedAt} label="Saved" />}>Pilot</SubHead>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {txt('name', 'Name', 'As on your certificate')}
          <label className="block min-w-0"><span className="mb-1 block text-sm text-fg-2">Weight</span><OptNum value={f.weightLb ?? null} placeholder="lb, dressed" unit="lb" onChange={v => setF(x => ({ ...x, weightLb: v }))} label="Your weight" /></label>
          {txt('phone', 'Phone', 'For the flight plan')}
          {txt('base', 'Home base', 'KRHV')}
          <div className="sm:col-span-2 xl:col-span-4">{txt('address', 'Address', 'For the flight plan')}</div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="primary" disabled={!dirty} loading={info.save.isPending} onClick={() => info.save.mutate(f, { onSuccess: () => toast.success('Saved') })}>Save</Button>
          {dirty && <Button size="sm" variant="ghost" onClick={() => setF(info.data ?? {})}>Discard</Button>}
        </div>
      </section>
      <div className="mt-8 grid gap-8 2xl:grid-cols-2">
        <CertificatesEditor certs={certs.data?.certificate ? certs.data : null} saving={certs.save.isPending} onSave={c => certs.save.mutate(c, { onSuccess: () => toast.success('Certificates saved'), onError: e => toast.error(e.message) })} />
        <MinimumsEditor minimums={{ ...DEFAULT_MINIMUMS, ...(mins.data || {}) }} savedAt={mins.data?.updatedAt} saving={mins.save.isPending} onSave={m => mins.save.mutate(m, { onSuccess: () => toast.success('Minimums saved') })} />
      </div>
      <div className="mt-8"><RecordsList title="Documents" person={SELF} records={PILOT_RECORDS.filter(r => !r.when || !certs.data?.certificate || (r.when === 'student') === (certs.data.certificate === 'student'))} /></div>
    </div>
  )
}

/* ── Instructors and passengers ── */
function PersonProfile({ person, exists, used, saving, onSave, onDelete }: { person: Person | null; exists: boolean; used: number; saving: boolean; onSave: (p: Person) => void; onDelete: (p: Person) => void }) {
  const [p, setP] = useState<Person | null>(person)
  if (!p) return <p className="text-sm text-fg-3">This profile was deleted.</p>
  const isNew = !exists
  const valid = p.name.trim().length > 0 && (p.weightLb == null || (p.weightLb > 20 && p.weightLb < 400))
  return (
    <div>
      <Lead title={p.name || 'New person'} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="block min-w-0"><span className="mb-1 block text-sm text-fg-2">Name</span><Input value={p.name} onChange={e => setP({ ...p, name: e.target.value.slice(0, 60) })} placeholder="Full name" autoFocus={!p.name} /></label>
        <label className="block min-w-0"><span className="mb-1 block text-sm text-fg-2">Role</span>
          <Select value={p.role} onChange={e => setP({ ...p, role: e.target.value as Person['role'] })}><option value="pilot">Pilot (student, private and up)</option><option value="instructor">Instructor (CFI)</option><option value="passenger">Passenger</option></Select></label>
        <label className="block min-w-0"><span className="mb-1 block text-sm text-fg-2">Weight</span><OptNum value={p.weightLb} placeholder="lb, dressed" unit="lb" onChange={v => setP({ ...p, weightLb: v })} label="Weight" /></label>
        <label className="block min-w-0"><span className="mb-1 block text-sm text-fg-2">Phone</span><Input value={p.phone ?? ''} onChange={e => setP({ ...p, phone: e.target.value.slice(0, 30) })} placeholder="Optional" /></label>
        {p.role === 'instructor' && <label className="block min-w-0"><span className="mb-1 block text-sm text-fg-2">CFI certificate number</span><Input value={p.cfi ?? ''} onChange={e => setP({ ...p, cfi: e.target.value.slice(0, 20) })} placeholder="Optional" className="num" /></label>}
        <label className="block min-w-0 sm:col-span-2 xl:col-span-4"><span className="mb-1 block text-sm text-fg-2">Notes</span><Textarea rows={2} value={p.notes ?? ''} onChange={e => setP({ ...p, notes: e.target.value.slice(0, 500) })} placeholder="Optional" /></label>
      </div>
      {p.weightLb != null && !(p.weightLb > 20 && p.weightLb < 400) && <p className="mt-2 text-[13px] text-bad">Enter a weight between 20 and 400 lb.</p>}
      {p.role === 'pilot' && exists && <div className="mt-6"><RecordsList title="Documents" person={p.id} records={PILOT_RECORDS.filter(r => !r.when || (r.when === 'student') === ((p.certs?.certificate ?? 'student') === 'student'))} /></div>}
      {p.role === 'pilot' && <div className="mt-6"><CertificatesEditor title="Certificate, medical and endorsements" certs={p.certs ?? null} saving={saving} onSave={c => { const x = { ...p, certs: c }; setP(x); if (exists) onSave(x) }} /></div>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" disabled={!valid || (!isNew && JSON.stringify(p) === JSON.stringify(person))} loading={saving} onClick={() => onSave({ ...p, name: p.name.trim() })}>{isNew ? 'Create profile' : 'Save'}</Button>
        {!isNew && person && JSON.stringify(p) !== JSON.stringify(person) && <Button size="sm" variant="ghost" onClick={() => setP(person)}>Discard</Button>}
      </div>
      {!isNew && <DeleteRow what={p.name} used={used} onDelete={() => onDelete(p)} after="they keep the seat weight it gave them." />}
    </div>
  )
}

/* ── Aircraft ── */
function AircraftProfileView({ tail, used, saved, onDelete }: { tail: string; used: number; saved: boolean; onDelete: () => void }) {
  const registry = useRegistry(tail)
  const planningQ = usePlanning(tail)
  const planning = planningQ.data ?? {}
  const ident = { make: planning.profile?.make || registry.data?.make, model: planning.profile?.model || registry.data?.model, year: planning.profile?.year ?? registry.data?.year }
  const poh = usePohFind(ident.model ? { ...ident, tail } : null)
  const save = (p: typeof planning) => planningQ.save.mutate(p, { onSuccess: () => toast.success(`${tail} saved`), onError: e => toast.error(e.message) })
  const u = unitsForTail(tail)
  const name = [ident.make && titleCase(ident.make), ident.model, ident.year].filter(Boolean).join(' ')
  return (
    <div>
      <Lead title={<span className="num">{tail}</span>}>{name || (registry.isLoading ? 'Looking up the FAA registry…' : 'Not in the FAA registry: enter make and model under "Your values" below.')}</Lead>
      {!saved && <p className="-mt-3 mb-6 text-[13px] text-fg-3">No profile yet: saving any value below creates it.</p>}
      {registry.data && <KV className="mb-8" items={[['Registry', registry.data.status], ['Engine', registry.data.engine_type ? `${registry.data.engine_type}${registry.data.engine_hp ? `, ${registry.data.engine_hp} hp` : ''}` : null], ['Seats', registry.data.seats], ]} />}
      <section className="mb-8"><SubHead>POH and what was read from it</SubHead><PohReport match={poh.data?.match} doc={poh.data?.doc} uploaded={poh.data?.uploaded} loading={poh.isLoading} model={ident.model} /></section>
      <div className="grid gap-8 xl:grid-cols-2">
        <div className="space-y-8">
          <EmptyWeight tail={tail} planning={planning} save={save} u={u} />
          <InspectionDates tail={tail} planning={planning} save={save} />
        </div>
        <div className="space-y-8">
          <AircraftDocs tail={tail} model={ident.model ?? null} poh={poh.data?.doc} pohUploaded={!!poh.data?.uploaded} />
          <RecordsList title={<>Aircraft records · <span className="num">{tail}</span></>} records={AIRCRAFT_RECORDS} tail={tail} />
        </div>
      </div>
      <div className="mt-8"><EquipmentForm eq={planning.equipment ?? {}} setEq={x => save({ ...planning, equipment: { ...planning.equipment, ...x } })} /></div>
      <section className="mt-8">
        <SubHead>Checklist</SubHead>
        <ChecklistEditor tail={tail} value={planning.checklist} saving={planningQ.save.isPending} onSave={c => save({ ...planning, checklist: c })} />
      </section>
      <div className="mt-8"><ProfileEditor tail={tail} planning={planning} save={save} saving={planningQ.save.isPending} registry={{ make: registry.data?.make, model: registry.data?.model, year: registry.data?.year }} /></div>
      {saved && <DeleteRow what={`${tail}'s profile`} used={used} onDelete={onDelete} after="they fall back to the POH sample airplane's empty weight." note="Deletes your values for this airplane (empty weight, inspections, overrides); its registry entry, POH and uploaded records stay." />}
    </div>
  )
}

/* ── Airports ── */
function AirportProfileView({ id, profile, used, saving, onSave }: { id: string; profile: import('./model').AirportProfile | null; used: number; saving: boolean; onSave: (p: import('./model').AirportProfile | null) => void }) {
  const q = useAirports([id], new Date().toISOString().slice(0, 10))
  const a = q.data?.airports.find(x => x.id === id || x.icao === id)
  if (q.isLoading) return <p className="text-sm text-fg-3">Looking up {id} in FAA NASR…</p>
  if (!a) return <p className="text-sm text-fg-3"><span className="num">{id}</span> isn't in the FAA airport data (NASR). Check the identifier: US airports use their FAA ident or the K-prefixed ICAO code.</p>
  return (
    <div>
      <Lead title={<><span className="num">{a.icao || a.id}</span> · {titleCase(a.name)}</>} />
      <KV className="mb-6" items={[
        ['Elevation', `${Math.round(a.elev).toLocaleString()} ft`],
        ['Published pattern', a.tpaAgl ? `${Math.round(a.elev + a.tpaAgl).toLocaleString()} ft MSL` : 'None published (1,000 ft AGL assumed)'],
        ['Runways', a.runways.map(r => `${r.id} · ${r.len.toLocaleString()} ft`).join(', ') || '—'],
      ]} />
      <AirportProfileForm bare a={a} profile={profile} saving={saving} onSave={onSave} />
      {used > 0 && profile && <p className="mt-4 text-[13px] text-fg-3">{used} saved plan{used > 1 ? 's use' : ' uses'} {id}; they pick up a change the next time they're opened.</p>}
    </div>
  )
}

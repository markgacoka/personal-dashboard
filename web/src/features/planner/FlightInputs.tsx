import { useDeferredValue, useEffect, useState } from 'react'
import { BookOpen, CircleDashed, Info, Loader2, MapPin, Navigation, Plane, Radio, XCircle } from 'lucide-react'
import { Input, Select } from '@/components/ui/input'
import { titleCase } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AircraftRef, AircraftRegistry } from '@/lib/types'
import { useResolve, type PlannerDoc, type PohMatch } from './api'
import type { AircraftPlanning, Derived, Plan, RoutePoint } from './model'
import { loadsOf } from './model'
import { SECTION_LABEL, TABLE_SECTIONS, type AircraftProfile } from './poh'
import { joinRoute, splitRoute, tokenize } from './route'
import { CERTIFICATES, roleOf, type PilotCerts } from './pilot'
import { Segmented, Tooltip } from '@/components/ui/misc'
import { useRefs } from './RefPanel'
import { NumField, SubHead } from './ui'
import { fromF, fromW, toF, toW, type Units } from './units'

const KIND_ICON = { airport: Plane, navaid: Radio, fix: Navigation, vfr: MapPin, gps: MapPin, radial: Radio, unknown: XCircle } as const
const KIND_LABEL: Record<RoutePoint['kind'], string> = { airport: 'Airport', navaid: 'Navaid', fix: 'Fix', vfr: 'VFR waypoint', gps: 'Coordinates', radial: 'Radial/DME', unknown: 'Not found' }

// What you type: tail, route, engine-start time, cruise power, who sits where,
// fuel and taxi time. Everything else is looked up or computed in the later
// steps, each of which shows its sources and takes an override where one makes sense.
export function FlightInputs({ plan, set, d, fleet, registry, registryLoading, poh, pohUploaded, pohLoading, pohError, u, aircraft, profile, certs, step = null }: {
  plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; fleet: AircraftRef[]; registry: AircraftRegistry | null | undefined; registryLoading: boolean
  poh: PohMatch | null | undefined; pohUploaded?: PlannerDoc | null; pohLoading: boolean; pohError: string | null; u: Units; aircraft: { make?: string | null; model?: string | null; year?: number | null }
  profile: AircraftProfile | null; certs: PilotCerts | null
  // Guided setup: only this group (0 who, 1 aircraft, 2 route, 3 time and power, 4 load).
  step?: number | null
}) {
  const show = (i: number) => step == null || step === i
  const [tail, setTail] = useState(plan.tail ?? '')
  useEffect(() => setTail(plan.tail ?? ''), [plan.tail])
  const commitTail = () => { const t = tail.toUpperCase().replace(/\s+/g, '').trim(); if (t !== (plan.tail ?? '')) set({ tail: t || null, aircraft: undefined }) }

  // Departure, the points flown over, arrival: one flight, one navlog.
  const parts = splitRoute(plan.route)
  const [dep, setDep] = useState(parts.dep), [via, setVia] = useState(parts.via.join(' ')), [arr, setArr] = useState(parts.arr)
  useEffect(() => { const p = splitRoute(plan.route); setDep(p.dep); setArr(p.arr); if (plan.route.length > 1) setVia(p.via.join(' ')) }, [plan.route])
  const tokens = useDeferredValue([...tokenize(dep).slice(0, 1), ...tokenize(via), ...tokenize(arr).slice(0, 1)].join(' ')).split(' ').filter(Boolean)
  const resolved = useResolve(tokens)
  const pts = resolved.data?.points ?? []
  const pointFor = (t: string) => pts.find(x => x.token.replace(/\*$/, '') === t)
  const commitRoute = () => {
    // A whole route pasted into Departure ("KRHV E16 VPCOY KSNS") fills all three.
    const d = tokenize(dep)
    const next = d.length > 1 ? d : joinRoute(d[0] ?? '', tokenize(via), tokenize(arr)[0] ?? '')
    if (next.join(' ') === plan.route.join(' ')) return
    const labels = Object.fromEntries(Object.entries(plan.labels ?? {}).filter(([k]) => next.includes(k)))
    set({ route: next, labels })
  }
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') commitRoute() }
  const noRegistry = !!plan.tail && !registryLoading && !registry?.model

  const loads = loadsOf(plan)
  const seats = plan.seats ?? { pilot: loads.front, front: 0, rearL: loads.rear, rearR: 0 }
  const setSeat = (k: keyof typeof seats) => (v: number) => set({ seats: { ...seats, [k]: fromW(v, u) } })
  const w = (lb: number) => (lb ? Math.round(toW(lb, u)) : '')
  const rpms = profile ? [...new Set(profile.cruise.map(r => r.rpm))].sort((a, b) => b - a) : [2600, 2500, 2400, 2300, 2200, 2100]
  const f0 = d.flights[0]

  return (
    <div className="@container divide-y divide-border">
      {show(0) && (
      <Group title="Who's flying" hint={certs?.certificate ? CERTIFICATES.find(c => c.key === certs.certificate)!.label : <>Certificate not saved · student assumed</>}>
        <Crew plan={plan} set={set} d={d} certs={certs} />
      </Group>
      )}

      {show(1) && (
      <Group title="Aircraft" hint="Tail number; the registry and POH are looked up.">
        <div className="grid gap-4 @md:grid-cols-[minmax(0,11rem)_1fr] @md:items-end">
          <Field label="Tail number">
            <Input value={tail} onChange={e => setTail(e.target.value.toUpperCase())} onBlur={commitTail} onKeyDown={e => { if (e.key === 'Enter') commitTail() }}
              placeholder="N227AN" list="planner-fleet" className="num uppercase" autoCapitalize="characters" spellCheck={false} />
            <datalist id="planner-fleet">{fleet.map(a => <option key={a.id} value={a.tail_number}>{a.make} {a.model}{a.year ? ` (${a.year})` : ''}</option>)}</datalist>
          </Field>
          <div className="min-w-0 text-sm">
            {registryLoading && plan.tail && <p className="flex h-10 items-center gap-2 text-fg-3"><Loader2 className="size-4 animate-spin" />Looking up {plan.tail}…</p>}
            {registry?.model && (
              <div className="flex items-center gap-3">
                {registry.photo_url && <img src={registry.photo_url} alt="" className="h-10 w-16 shrink-0 rounded-md object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />}
                <div className="min-w-0"><div className="truncate text-fg-2">{titleCase(registry.make ?? '')} {registry.model}{registry.year ? ` · ${registry.year}` : ''}</div><div className="text-[13px] text-fg-3">FAA registry</div></div>
              </div>
            )}
            {noRegistry && <p className="text-[13px] text-fg-3">Not in the FAA registry: enter make, model and year.</p>}
          </div>
        </div>
        {(noRegistry || plan.aircraft) && (
          <div className="mt-4 grid grid-cols-3 gap-4">
            <Field label="Make"><Input value={plan.aircraft?.make ?? aircraft.make ?? ''} onChange={e => set({ aircraft: { ...plan.aircraft, make: e.target.value } })} placeholder="Cessna" /></Field>
            <Field label="Model"><Input value={plan.aircraft?.model ?? aircraft.model ?? ''} onChange={e => set({ aircraft: { ...plan.aircraft, model: e.target.value.toUpperCase() } })} placeholder="172P" className="uppercase" /></Field>
            <NumField label="Year" value={plan.aircraft?.year ?? aircraft.year ?? ''} onChange={v => set({ aircraft: { ...plan.aircraft, year: v || null } })} />
          </div>
        )}
        <PohStatus poh={poh} loading={pohLoading} error={pohError} model={aircraft.model} uploaded={pohUploaded} read={profile?.read} />
      </Group>
      )}

      {show(2) && (
      <Group title="Route" hint="Start and end at airports; everything between is flown over."
        aside={<Tooltip content="Navaids (SJC), fixes and VFR waypoints (VPCOY), airports (E16), radial/distance (SJC090020), coordinates (3651N12131W or 36.85/-121.53). SkyVector and ForeFlight route strings paste in whole."><span className="mt-2 inline-flex cursor-help items-center gap-1 text-[13px] text-fg-3 hover:text-fg-2"><Info className="size-3.5" />Formats</span></Tooltip>}>
        <div className="grid grid-cols-2 gap-4 @md:grid-cols-[7rem_minmax(0,1fr)_7rem]">
          <Field label="From"><Input value={dep} onChange={e => setDep(e.target.value.toUpperCase())} onBlur={commitRoute} onKeyDown={enter} placeholder="KRHV" className="num uppercase" spellCheck={false} autoCapitalize="characters" /></Field>
          <Field label="Via (optional)" className="order-last col-span-2 @md:order-none @md:col-span-1"><Input value={via} onChange={e => setVia(e.target.value.toUpperCase())} onBlur={commitRoute} onKeyDown={enter} placeholder="E16 VPCOY" className="num uppercase" spellCheck={false} autoCapitalize="characters" /></Field>
          <Field label="To"><Input value={arr} onChange={e => setArr(e.target.value.toUpperCase())} onBlur={commitRoute} onKeyDown={enter} placeholder="KSNS" className="num uppercase" spellCheck={false} autoCapitalize="characters" /></Field>
        </div>
        {tokens.length > 0 && (
          <ol className="mt-4 space-y-1.5">
            {tokens.map((t, i) => {
              const p = pointFor(t)
              const Icon = p ? KIND_ICON[p.kind] : CircleDashed
              const end = i === 0 || (i === tokens.length - 1 && tokenize(arr).length > 0)
              const bad = end && p && p.kind !== 'airport' && p.kind !== 'unknown'
              const label = plan.labels?.[t]?.name
              return (
                <li key={`${t}-${i}`} className="flex items-center gap-2.5 text-[13px]">
                  <Icon className={cn('size-3.5 shrink-0', !p ? 'text-fg-3' : p.kind === 'unknown' || bad ? 'text-bad' : 'text-fg-3')} />
                  <span className="num w-24 shrink-0 truncate text-fg-2" title={t}>{label ?? t}</span>
                  <span className={cn('min-w-0 flex-1 truncate', bad || p?.kind === 'unknown' ? 'text-bad' : 'text-fg-3')}>{bad ? 'Not an airport: flights start and end at airports' : p ? (p.kind === 'unknown' ? p.error : `${KIND_LABEL[p.kind]}${p.type && p.kind === 'navaid' ? ` (${p.type})` : ''}${p.kind === 'gps' ? '' : ` · ${p.kind === 'airport' ? titleCase(p.name ?? '') : p.name ?? ''}`}${p.freq ? ` · ${p.freq}` : ''}`) : resolved.isFetching ? 'Looking up…' : ''}</span>
                </li>
              )
            })}
          </ol>
        )}
        {!tokenize(arr).length && tokenize(dep).length > 0 && <p className="mt-3 text-[13px] text-fg-3">Add the arrival airport (the departure again for a local flight).</p>}
      </Group>
      )}

      {show(3) && (
      <Group title="Time and power" hint="Local engine-start time and cruise RPM.">
        <div className="grid gap-4 @md:grid-cols-2">
          <Field label="Engine start"><Input type="datetime-local" value={plan.departLocal} onChange={e => set({ departLocal: e.target.value })} className="num" /></Field>
          <Field label="Cruise power" note={f0?.cruise ? `${f0.cruise.ktas} KTAS · ${f0.cruise.gph} GPH · ${f0.cruise.bhp}% at ${f0.alt.toLocaleString()} ft` : undefined}>
            <Select value={plan.rpm} onChange={e => set({ rpm: Number(e.target.value) })} className="num">{rpms.map(r => <option key={r} value={r}>{r} RPM</option>)}</Select>
          </Field>
        </div>
      </Group>
      )}

      {show(4) && (
      <Group title="Load" hint={`People and bags in ${u.weight}, fuel and taxi time.`}>
        <div className="grid grid-cols-2 gap-4 @md:grid-cols-4">
          <NumField label="Pilot" value={w(seats.pilot)} onChange={setSeat('pilot')} />
          <NumField label={roleOf(plan.crew, certs) === 'dual' ? 'Instructor' : 'Front right'} value={w(seats.front)} onChange={setSeat('front')} />
          <NumField label="Rear left" value={w(seats.rearL)} onChange={setSeat('rearL')} />
          <NumField label="Rear right" value={w(seats.rearR)} onChange={setSeat('rearR')} />
          <NumField label="Baggage 1" value={w(plan.loads.bag1)} onChange={v => set({ loads: { ...plan.loads, bag1: fromW(v, u) } })} />
          <NumField label="Baggage 2" value={w(plan.loads.bag2)} onChange={v => set({ loads: { ...plan.loads, bag2: fromW(v, u) } })} />
          <Field label="Fuel" note="Blank: full usable">
            <OptNum value={plan.fuelGal == null ? null : Math.round(toF(plan.fuelGal, u) * 10) / 10} placeholder={profile ? Math.round(toF(d.totals.usableFuel, u)) : 40} unit={u.fuel} onChange={v => set({ fuelGal: v == null ? null : fromF(v, u) })} label="Fuel on board" />
          </Field>
          <Field label="Start and taxi" note={d.takeoffAt ? `Takeoff ${d.takeoffAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}` : undefined}>
            <OptNum value={plan.taxiMin ?? null} placeholder={10} unit="min" onChange={v => set({ taxiMin: v ?? undefined })} label="Start and taxi minutes" />
          </Field>
        </div>
      </Group>
      )}
    </div>
  )
}

// One input group: what it is on the left, its fields on the right (stacked when narrow).
function Group({ title, hint, aside, children }: { title: string; hint?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 py-7 first:pt-1 last:pb-1 @3xl:grid-cols-[12rem_minmax(0,1fr)] @3xl:gap-10">
      <div>
        <h3 className="text-[15px] font-medium text-fg">{title}</h3>
        {hint && <p className="mt-1 text-[13px] leading-snug text-fg-3">{hint}</p>}
        {aside}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function Field({ label, note, className, children }: { label: string; note?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="mb-1.5 block text-[13px] text-fg-3">{label}</span>
      {children}
      {note && <span className="num mt-1.5 block text-[13px] text-fg-3">{note}</span>}
    </label>
  )
}

export function OptNum({ value, placeholder, onChange, unit, step, label }: { value: number | null; placeholder: number | string; onChange: (v: number | null) => void; unit?: string; step?: number; label: string }) {
  return (
    <span className="relative block">
      <Input type="number" inputMode="decimal" aria-label={label} value={value ?? ''} placeholder={String(placeholder)} step={step} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} onWheel={e => e.currentTarget.blur()} className={cn('num', unit && 'pr-10')} />
      {unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-3">{unit}</span>}
    </span>
  )
}

// This airplane's basic empty weight and moment (its W&B record), saved per tail.
export function EmptyWeight({ tail, planning, save, u }: { tail: string; planning: AircraftPlanning; save: (p: AircraftPlanning) => void; u: Units }) {
  const [ew, setEw] = useState(planning.emptyWeight ?? null)
  const [em, setEm] = useState(planning.emptyMoment ?? null)
  useEffect(() => { setEw(planning.emptyWeight ?? null); setEm(planning.emptyMoment ?? null) }, [planning.emptyWeight, planning.emptyMoment])
  const commit = () => { if (ew !== (planning.emptyWeight ?? null) || em !== (planning.emptyMoment ?? null)) save({ ...planning, emptyWeight: ew ?? undefined, emptyMoment: em ?? undefined }) }
  return (
    <div>
      <SubHead right={<span className="text-xs text-fg-3">Blank = POH sample airplane (1,467 lb, 57.3)</span>}>{tail} basic empty weight</SubHead>
      <div className="grid max-w-md grid-cols-2 gap-3" onBlur={commit}>
        <label className="block"><span className="mb-1 block text-sm text-fg-2">Weight</span><OptNum value={ew == null ? null : Math.round(toW(ew, u) * 10) / 10} placeholder={Math.round(toW(1467, u))} unit={u.weight} onChange={v => setEw(v == null ? null : fromW(v, u))} label="Empty weight" /></label>
        <label className="block"><span className="mb-1 block text-sm text-fg-2">Moment / 1000</span><OptNum value={em} placeholder={57.3} onChange={setEm} label="Empty moment" /></label>
      </div>
    </div>
  )
}

export function PohStatus({ poh, loading, error, model, uploaded, read }: { poh: PohMatch | null | undefined; loading: boolean; error: string | null; model?: string | null; uploaded?: PlannerDoc | null; read?: AircraftProfile['read'] }) {
  const refs = useRefs()
  const open = <button type="button" onClick={() => refs?.show('poh')} className="shrink-0 text-accent hover:underline">Open</button>
  const all = read && read.sections.length === TABLE_SECTIONS.length
  if (uploaded && (all || !read)) return <p className="mt-4 flex items-center gap-2 text-[13px] text-fg-3"><BookOpen className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate"><span className="text-fg-2">{uploaded.title}</span> · your upload{all ? ', tables read from it' : ''}</span>{open}</p>
  if (!model) return null
  if (loading) return <p className="mt-4 flex items-center gap-2 text-[13px] text-fg-3"><Loader2 className="size-3.5 animate-spin" />Finding the {model} POH…</p>
  if (error) return <p className="mt-4 text-[13px] text-bad">{error}</p>
  if (poh?.exact && all && /^172/.test(model)) return <p className="mt-4 flex items-center gap-2 text-[13px] text-fg-3"><BookOpen className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate"><span className="text-fg-2">{poh.title}</span> · tables read from the book drive the numbers</span>{open}</p>
  if (poh?.exact && poh.profile) return <p className="mt-4 flex items-center gap-2 text-[13px] text-fg-3"><BookOpen className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate"><span className="text-fg-2">{poh.title}</span> · drives the numbers</span>{open}</p>
  return (
    <p className="mt-4 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
      <BookOpen className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{!poh && !uploaded ? `No public POH for the ${model}; upload it in the POH tab.` : !poh?.exact && !uploaded ? `${poh!.title}: closest public POH to the ${model}.${poh!.profile ? '' : ' Numbers use the closest transcribed one.'}` : tablesLine(uploaded?.title ?? poh!.title, model, read)}</span>
      {(poh || uploaded) && open}
    </p>
  )
}

// What the book's own tables cover, and what still comes from the 172P.
function tablesLine(title: string, model: string, read?: AircraftProfile['read']) {
  const other = /^172/.test(model) ? 'the 172P\'s' : 'the 172P\'s, which don\'t apply to this airplane'
  if (!read?.sections.length) return `${title}. ${read?.reason === 'no text layer' ? 'This copy is a scan with no text, so its tables can\'t be read' : 'Its performance tables couldn\'t be read'}; the numbers are ${other}.`
  return `${title}. Read its ${read.sections.map(k => SECTION_LABEL[k]).join(', ')} tables; ${read.missing.map(k => SECTION_LABEL[k]).join(', ')} ${read.missing.length > 1 ? 'are' : 'is'} ${other}.`
}

// Who flies: you as pilot in command, or dual with an instructor (who is then PIC).
// The Pilot step and Review apply the FAA rules for that role and your certificate.
function Crew({ plan, set, d, certs }: { plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; certs: PilotCerts | null }) {
  const role = roleOf(plan.crew, certs)
  const cert = certs?.certificate ?? 'student'
  const xc = d.checks.some(c => /Instructor('s)? endorse/.test(c.title))
  const ck = plan.checklist ?? {}
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <Segmented value={role} onChange={r => set({ crew: { ...plan.crew, role: r } })}
          options={[{ value: 'pic', label: cert === 'student' ? 'Solo' : 'Me as PIC' }, { value: 'dual', label: 'Dual with a CFI' }]} />
        {role === 'dual' && (
          <label className="block w-full max-w-60"><span className="mb-1.5 block text-[13px] text-fg-3">Instructor</span>
            <Input value={plan.crew?.instructor ?? ''} onChange={e => set({ crew: { ...plan.crew, role, instructor: e.target.value } })} placeholder="CFI's name" maxLength={60} /></label>
        )}
      </div>
      <p className="mt-2.5 text-[13px] text-fg-3">{role === 'dual' ? 'Your instructor is pilot in command; seat them front right.' : cert === 'student' ? 'Student solo: no passengers (§61.89).' : 'You are pilot in command; other seats are passengers.'}</p>
      {xc && (
        <label className="mt-3 flex items-center gap-2 text-[13px] text-fg-2">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={ck['crew.xcEndorsed'] === true} onChange={e => set({ checklist: { ...ck, 'crew.xcEndorsed': e.target.checked } })} />
          My instructor endorsed this cross-country in my logbook (§61.93(c)(2))
        </label>
      )}
    </div>
  )
}

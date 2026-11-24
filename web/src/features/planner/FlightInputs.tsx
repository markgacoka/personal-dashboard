import { createContext, useContext, useDeferredValue, useEffect, useState } from 'react'
import { CircleDashed, Info, MapPin, Navigation, Plane, Radio, XCircle } from 'lucide-react'
import { Input, Select } from '@/components/ui/input'
import { titleCase } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Link } from 'react-router'
import { usePilotInfo, useResolve } from './api'
import { SELF, seatPerson, usePeople, type Person, type Seat } from './profiles'
import type { AircraftPlanning, Derived, Plan, RoutePoint } from './model'
import { loadsOf } from './model'
import type { AircraftProfile } from './poh'
import { joinRoute, splitRoute, tokenize } from './route'
import { roleOf, type PilotCerts } from './pilot'
import { Tooltip } from '@/components/ui/misc'
import { NumField, SubHead } from './ui'
import { fromF, fromW, toF, toW, type Units } from './units'

const KIND_ICON = { airport: Plane, navaid: Radio, fix: Navigation, vfr: MapPin, gps: MapPin, radial: Radio, unknown: XCircle } as const
const KIND_LABEL: Record<RoutePoint['kind'], string> = { airport: 'Airport', navaid: 'Navaid', fix: 'Fix', vfr: 'VFR waypoint', gps: 'Coordinates', radial: 'Radial/DME', unknown: 'Not found' }

// What only the pilot knows about the flight: the route, engine-start time and
// cruise power, who sits where, bags, fuel and taxi time. Each section shows
// the group it needs (2 route, 3 time and power, 4 load).
export function FlightInputs({ bare = false, ...p }: Props) {
  return <Bare.Provider value={bare}><Inputs {...p} /></Bare.Provider>
}
interface Props { plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; u: Units; profile: AircraftProfile | null; certs: PilotCerts | null; step: 2 | 3 | 4; bare?: boolean }
function Inputs({ plan, set, d, u, profile, certs, step }: Props) {
  const show = (i: number) => step === i

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

  const loads = loadsOf(plan)
  const seats = plan.seats ?? { pilot: loads.front, front: 0, rearL: loads.rear, rearR: 0 }
  const setSeat = (k: keyof typeof seats) => (v: number) => set({ seats: { ...seats, [k]: fromW(v, u) } })
  const w = (lb: number) => (lb ? Math.round(toW(lb, u)) : '')
  const rpms = profile ? [...new Set(profile.cruise.map(r => r.rpm))].sort((a, b) => b - a) : [2600, 2500, 2400, 2300, 2200, 2100]
  const f0 = d.flights[0]

  return (
    <div className="@container divide-y divide-border">
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
      <Group title="Load" hint={<>People and bags in {u.weight}, fuel and taxi time. <Link to="/flying/plan/profiles?tab=pilots" className="text-accent hover:underline">People</Link></>}>
        <div className="grid grid-cols-2 gap-4 @md:grid-cols-4">
          {(['pilot', 'front', 'rearL', 'rearR'] as Seat[]).map(k => (
            <SeatField key={k} seat={k} label={k === 'pilot' ? 'Pilot' : k === 'front' ? (roleOf(plan.crew, certs) === 'dual' ? 'Instructor' : 'Front right') : k === 'rearL' ? 'Rear left' : 'Rear right'}
              value={w(seats[k])} onChange={setSeat(k)} plan={plan} set={set} />
          ))}
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
// In the new-flight setup the step supplies the heading, so the group is just its fields.
const Bare = createContext(false)
function Group({ title, aside, children }: { title: string; hint?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  if (useContext(Bare)) return <section className="py-3 first:pt-0">{children}{aside && <div className="mt-1">{aside}</div>}</section>
  return (
    <section className="grid gap-4 py-7 first:pt-1 last:pb-1 @3xl:grid-cols-[12rem_minmax(0,1fr)] @3xl:gap-10">
      <div>
        <h3 className="text-[15px] font-medium text-fg">{title}</h3>
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

// A seat's weight, and who sits there: picking a profile copies their weight in
// (seatPerson); a weight typed afterwards is this flight's own.
function SeatField({ seat, label, value, onChange, plan, set }: { seat: Seat; label: string; value: number | ''; onChange: (v: number) => void; plan: Plan; set: (p: Partial<Plan>) => void }) {
  const people = usePeople().list, self = usePilotInfo().data
  const options: (Pick<Person, 'id' | 'name' | 'weightLb'> & { role?: Person['role'] })[] = [{ id: SELF, name: self?.name ? `${self.name} (you)` : 'You', weightLb: self?.weightLb ?? null }, ...people]
  const who = plan.seatPeople?.[seat] ?? ''
  const pick = (id: string) => set(seatPerson(plan, seat, options.find(o => o.id === id) ?? null))
  return (
    <div>
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-fg-3">{label}</span>
        {(people.length > 0 || self?.weightLb) && (
          <select aria-label={`Who sits ${label.toLowerCase()}`} value={who} onChange={e => pick(e.target.value)}
            className="min-w-0 max-w-[60%] cursor-pointer truncate bg-transparent text-right text-[13px] text-accent outline-none hover:underline">
            <option value="">{who ? 'Someone else' : 'Who?'}</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}{o.weightLb ? ` · ${o.weightLb} lb` : ''}</option>)}
          </select>
        )}
      </span>
      <NumField label="" value={value} onChange={onChange} className="[&>span:first-child]:hidden" />
    </div>
  )
}

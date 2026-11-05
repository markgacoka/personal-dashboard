import { useDeferredValue, useEffect, useState } from 'react'
import { BookOpen, CircleDashed, Loader2, MapPin, Navigation, Plane, Radio, XCircle } from 'lucide-react'
import { Input, Select } from '@/components/ui/input'
import { titleCase } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AircraftRef, AircraftRegistry } from '@/lib/types'
import { useResolve, type PohMatch } from './api'
import type { AircraftPlanning, Derived, Plan, RoutePoint } from './model'
import { loadsOf } from './model'
import type { AircraftProfile } from './poh'
import { joinRoute, splitRoute, tokenize } from './route'
import { kindName } from './suggest'
import { NumField, SubHead } from './ui'
import { fromF, fromW, toF, toW, type Units } from './units'

const KIND_ICON = { airport: Plane, navaid: Radio, fix: Navigation, vfr: MapPin, gps: MapPin, radial: Radio, unknown: XCircle } as const
const KIND_LABEL: Record<RoutePoint['kind'], string> = { airport: 'Airport', navaid: 'Navaid', fix: 'Fix', vfr: 'VFR waypoint', gps: 'Coordinates', radial: 'Radial/DME', unknown: 'Not found' }

// What you type: tail, route, engine-start time, cruise power, who sits where,
// fuel and taxi time. Everything else is looked up or computed in the later
// steps, each of which shows its sources and takes an override where one makes sense.
export function FlightInputs({ plan, set, d, fleet, registry, registryLoading, poh, pohLoading, pohError, u, aircraft, profile }: {
  plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; fleet: AircraftRef[]; registry: AircraftRegistry | null | undefined; registryLoading: boolean
  poh: PohMatch | null | undefined; pohLoading: boolean; pohError: string | null; u: Units; aircraft: { make?: string | null; model?: string | null; year?: number | null }
  profile: AircraftProfile | null
}) {
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
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-5">
          <div>
            <SubHead>1 · Aircraft</SubHead>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
              <label className="block">
                <span className="mb-1 block text-sm text-fg-2">Tail number</span>
                <Input value={tail} onChange={e => setTail(e.target.value.toUpperCase())} onBlur={commitTail} onKeyDown={e => { if (e.key === 'Enter') commitTail() }}
                  placeholder="N227AN" list="planner-fleet" className="num uppercase" autoCapitalize="characters" spellCheck={false} />
                <datalist id="planner-fleet">{fleet.map(a => <option key={a.id} value={a.tail_number}>{a.make} {a.model}{a.year ? ` (${a.year})` : ''}</option>)}</datalist>
              </label>
              <div className="min-w-0 self-end text-sm">
                {registryLoading && plan.tail && <p className="flex items-center gap-2 text-fg-3"><Loader2 className="size-4 animate-spin" />Looking up {plan.tail}…</p>}
                {registry?.model && (
                  <div className="flex items-center gap-3">
                    {registry.photo_url && <img src={registry.photo_url} alt="" className="h-12 w-18 shrink-0 rounded-md object-cover ring-1 ring-border" onError={e => { e.currentTarget.style.display = 'none' }} />}
                    <div className="min-w-0"><div className="font-medium text-fg">{titleCase(registry.make ?? '')} {registry.model}{registry.year ? ` · ${registry.year}` : ''}</div><div className="text-xs text-fg-3">FAA registry · {u.weight} / {u.fuel} / {u.pressure}</div></div>
                  </div>
                )}
                {noRegistry && <p className="text-fg-3">Not in the FAA registry — enter the make, model and year.</p>}
              </div>
            </div>
            {(noRegistry || plan.aircraft) && (
              <div className="mt-3 grid grid-cols-3 gap-3">
                <label className="block"><span className="mb-1 block text-sm text-fg-2">Make</span><Input value={plan.aircraft?.make ?? aircraft.make ?? ''} onChange={e => set({ aircraft: { ...plan.aircraft, make: e.target.value } })} placeholder="Cessna" /></label>
                <label className="block"><span className="mb-1 block text-sm text-fg-2">Model</span><Input value={plan.aircraft?.model ?? aircraft.model ?? ''} onChange={e => set({ aircraft: { ...plan.aircraft, model: e.target.value.toUpperCase() } })} placeholder="172P" className="uppercase" /></label>
                <NumField label="Year" value={plan.aircraft?.year ?? aircraft.year ?? ''} onChange={v => set({ aircraft: { ...plan.aircraft, year: v || null } })} />
              </div>
            )}
            <PohStatus poh={poh} loading={pohLoading} error={pohError} model={aircraft.model} />
          </div>

          <div>
            <SubHead right={<span className="text-xs text-fg-3">SkyVector / ForeFlight format</span>}>2 · Departure, route and arrival</SubHead>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_8rem]">
              <label className="block"><span className="mb-1 block text-sm text-fg-2">Departure</span>
                <Input value={dep} onChange={e => setDep(e.target.value.toUpperCase())} onBlur={commitRoute} onKeyDown={enter} placeholder="KRHV" className="num uppercase" spellCheck={false} autoCapitalize="characters" /></label>
              <label className="order-last col-span-2 block sm:order-none sm:col-span-1"><span className="mb-1 block text-sm text-fg-2">Route (flown over)</span>
                <Input value={via} onChange={e => setVia(e.target.value.toUpperCase())} onBlur={commitRoute} onKeyDown={enter} placeholder="E16 VPCOY SNS" className="num uppercase" spellCheck={false} autoCapitalize="characters" /></label>
              <label className="block"><span className="mb-1 block text-sm text-fg-2">Arrival</span>
                <Input value={arr} onChange={e => setArr(e.target.value.toUpperCase())} onBlur={commitRoute} onKeyDown={enter} placeholder="KSNS" className="num uppercase" spellCheck={false} autoCapitalize="characters" /></label>
            </div>
            <p className="mt-1 text-xs text-fg-3">You land only at the arrival airport; everything in Route is flown over, airports included. Points: navaids (SJC), fixes and VFR waypoints (VPCOY), airports (E16), radial/distance (SJC090020), coordinates (3651N12131W, 36.85/-121.53). The Route step suggests points and lets you drag the line on the chart.</p>
            {tokens.length > 0 && (
              <ol className="mt-3 space-y-1">
                {tokens.map((t, i) => {
                  const p = pointFor(t)
                  const Icon = p ? KIND_ICON[p.kind] : CircleDashed
                  const role = i === 0 ? 'Depart' : i === tokens.length - 1 && tokenize(arr).length ? 'Land' : 'Fly over'
                  const end = role !== 'Fly over'
                  const bad = end && p && p.kind !== 'airport' && p.kind !== 'unknown'
                  const label = plan.labels?.[t]?.name
                  return (
                    <li key={`${t}-${i}`} className="flex items-center gap-2 text-sm">
                      <Icon className={cn('size-4 shrink-0', !p ? 'text-fg-3' : p.kind === 'unknown' || bad ? 'text-bad' : 'text-fg-2')} />
                      <span className="num w-28 shrink-0 truncate font-medium text-fg" title={t}>{label ?? t}</span>
                      <span className={cn('w-16 shrink-0 text-xs', end ? 'text-accent' : 'text-fg-3')}>{role}</span>
                      <span className={cn('min-w-0 flex-1 truncate', bad ? 'text-bad' : 'text-fg-3')}>{bad ? 'Not an airport: the flight starts and ends at airports' : p ? (p.kind === 'unknown' ? p.error : `${label ? `${kindName(plan.labels![t].kind)} · ` : ''}${KIND_LABEL[p.kind]}${p.type && p.kind === 'navaid' ? ` (${p.type})` : ''}${p.kind === 'gps' ? '' : ` · ${p.kind === 'airport' ? titleCase(p.name ?? '') : p.name ?? ''}`}${p.freq ? ` · ${p.freq}` : ''}`) : resolved.isFetching ? 'Looking up…' : ''}</span>
                    </li>
                  )
                })}
              </ol>
            )}
            {!tokenize(arr).length && tokenize(dep).length > 0 && <p className="mt-2 text-sm text-fg-3">Add the arrival airport (the departure again for a local flight).</p>}
            {resolved.data?.cycle && <p className="mt-2 text-xs text-fg-3">FAA NASR cycle {resolved.data.cycle}</p>}
          </div>
        </div>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <SubHead>3 · Engine start (local)</SubHead>
              <Input type="datetime-local" value={plan.departLocal} onChange={e => set({ departLocal: e.target.value })} className="num" />
            </label>
            <label className="block">
              <SubHead>4 · Cruise power</SubHead>
              <Select value={plan.rpm} onChange={e => set({ rpm: Number(e.target.value) })} className="num">{rpms.map(r => <option key={r} value={r}>{r} RPM</option>)}</Select>
              {f0?.cruise && <span className="num mt-1 block text-xs text-fg-3">{f0.cruise.bhp}% BHP · {f0.cruise.ktas} KTAS · {f0.cruise.gph} GPH at {f0.alt.toLocaleString()} ft</span>}
            </label>
          </div>
          <div>
            <SubHead right={<span className="text-xs text-fg-3">{u.weight}</span>}>5 · Occupants and baggage</SubHead>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <NumField label="Pilot (L)" value={w(seats.pilot)} onChange={setSeat('pilot')} />
              <NumField label="Front (R)" value={w(seats.front)} onChange={setSeat('front')} />
              <NumField label="Rear left" value={w(seats.rearL)} onChange={setSeat('rearL')} />
              <NumField label="Rear right" value={w(seats.rearR)} onChange={setSeat('rearR')} />
              <NumField label="Baggage area 1" value={w(plan.loads.bag1)} onChange={v => set({ loads: { ...plan.loads, bag1: fromW(v, u) } })} />
              <NumField label="Baggage area 2" value={w(plan.loads.bag2)} onChange={v => set({ loads: { ...plan.loads, bag2: fromW(v, u) } })} />
            </div>
          </div>
          <div>
            <SubHead>6 · Fuel and taxi</SubHead>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-sm text-fg-2">Fuel on board</span>
                <OptNum value={plan.fuelGal == null ? null : Math.round(toF(plan.fuelGal, u) * 10) / 10} placeholder={profile ? Math.round(toF(d.totals.usableFuel, u)) : 40} unit={u.fuel} onChange={v => set({ fuelGal: v == null ? null : fromF(v, u) })} label="Fuel on board" />
                <span className="mt-1 block text-xs text-fg-3">Blank: full usable</span>
              </label>
              <label className="block"><span className="mb-1 block text-sm text-fg-2">Start and taxi</span>
                <OptNum value={plan.taxiMin ?? null} placeholder={10} unit="min" onChange={v => set({ taxiMin: v ?? undefined })} label="Start and taxi minutes" />
                <span className="num mt-1 block text-xs text-fg-3">{d.takeoffAt ? `Takeoff ${d.takeoffAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}` : 'Engine start to takeoff'}</span>
              </label>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

export function OptNum({ value, placeholder, onChange, unit, step, label }: { value: number | null; placeholder: number; onChange: (v: number | null) => void; unit?: string; step?: number; label: string }) {
  return (
    <span className="relative block">
      <Input type="number" inputMode="decimal" aria-label={label} value={value ?? ''} placeholder={String(placeholder)} step={step} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} className={cn('num', unit && 'pr-10')} />
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

export function PohStatus({ poh, loading, error, model }: { poh: PohMatch | null | undefined; loading: boolean; error: string | null; model?: string | null }) {
  if (!model) return null
  return (
    <div className={cn('mt-3 flex gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset', poh && poh.exact ? 'ring-border' : 'bg-warn-soft text-warn ring-warn/30')}>
      {loading ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : <BookOpen className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0">
        {loading && <span>Finding and downloading the {model} POH…</span>}
        {!loading && poh && <span className={poh.exact ? 'text-fg' : ''}>{poh.title}{poh.exact ? '' : ` — closest public POH to the ${model}`}. {poh.profile ? 'Its tables drive every number below.' : 'Reference only; numbers use the closest transcribed POH.'} <span className="opacity-80">Open it with "POH &amp; briefing".</span></span>}
        {!loading && !poh && !error && <span>No public POH found for the {model}; upload one in "POH &amp; briefing". Numbers use the closest transcribed POH.</span>}
        {error && <span>{error}</span>}
      </div>
    </div>
  )
}

import { useDeferredValue, useEffect, useState } from 'react'
import { BookOpen, ChevronDown, CircleDashed, Loader2, MapPin, Navigation, Plane, Radio, XCircle } from 'lucide-react'
import { Input, Select } from '@/components/ui/input'
import { titleCase } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AircraftRef, AircraftRegistry } from '@/lib/types'
import { useResolve, type PohMatch } from './api'
import type { AircraftPlanning, Derived, Minimums, Plan, RoutePoint } from './model'
import { loadsOf } from './model'
import { MinimumsEditor } from './Minimums'
import type { AircraftProfile } from './poh'
import { routeToText, textToRoute, tokenize } from './route'
import { NumField, SubHead } from './ui'
import { fromF, fromW, toF, toW, type Units } from './units'

const KIND_ICON = { airport: Plane, navaid: Radio, fix: Navigation, vfr: MapPin, gps: MapPin, radial: Radio, unknown: XCircle } as const
const KIND_LABEL: Record<RoutePoint['kind'], string> = { airport: 'Airport', navaid: 'Navaid', fix: 'Fix', vfr: 'VFR waypoint', gps: 'Coordinates', radial: 'Radial/DME', unknown: 'Not found' }

// The five things you type: tail, route, departure time, cruise power and who
// sits where. Everything else is looked up or computed; the "Automatic values"
// panel shows what was chosen (altitude, fuel, ground time…) and lets you change it.
export function FlightInputs({ plan, set, d, fleet, registry, registryLoading, poh, pohLoading, pohError, u, aircraft, profile, planning, savePlanning, minimums, minimumsSavedAt, saveMinimums, savingMinimums }: {
  plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; fleet: AircraftRef[]; registry: AircraftRegistry | null | undefined; registryLoading: boolean
  poh: PohMatch | null | undefined; pohLoading: boolean; pohError: string | null; u: Units; aircraft: { make?: string | null; model?: string | null; year?: number | null }
  profile: AircraftProfile | null; planning: AircraftPlanning; savePlanning: (p: AircraftPlanning) => void
  minimums: Minimums; minimumsSavedAt?: string; saveMinimums: (m: Minimums) => void; savingMinimums: boolean
}) {
  const [tail, setTail] = useState(plan.tail ?? '')
  useEffect(() => setTail(plan.tail ?? ''), [plan.tail])
  const commitTail = () => { const t = tail.toUpperCase().replace(/\s+/g, '').trim(); if (t !== (plan.tail ?? '')) set({ tail: t || null, aircraft: undefined }) }

  const [text, setText] = useState(routeToText(plan.route))
  useEffect(() => setText(routeToText(plan.route)), [plan.route])
  const tokens = tokenize(useDeferredValue(text))
  const resolved = useResolve(tokens.map(t => t.replace(/\*$/, '')))
  const pts = resolved.data?.points ?? []
  const pointFor = (t: string) => pts.find(x => x.token.replace(/\*$/, '') === t.replace(/\*$/, ''))
  const commitRoute = () => {
    const next = textToRoute(text, t => { const p = pointFor(t); return p ? p.kind === 'airport' : undefined })
    if (next.join(' ') !== plan.route.join(' ')) set({ route: next })
  }
  const toggleStop = (i: number) => set({ route: plan.route.map((t, k) => (k === i ? (t.endsWith('*') ? t.slice(0, -1) : `${t}*`) : t)) })
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
            <SubHead right={<span className="text-xs text-fg-3">SkyVector / ForeFlight format</span>}>2 · Airports and route points</SubHead>
            <Input value={text} onChange={e => setText(e.target.value.toUpperCase())} onBlur={commitRoute} onKeyDown={e => { if (e.key === 'Enter') commitRoute() }}
              placeholder="KRHV E16* VPCOY KSNS KRHV" className="num uppercase" spellCheck={false} autoCapitalize="characters" aria-label="Route" />
            <p className="mt-1 text-xs text-fg-3">Airports are stops; add * to fly over one (E16*). Points: navaids (SJC), fixes and VFR waypoints (VPCOY), radial/distance (SJC090020), coordinates (3651N12131W, 36.85/-121.53).</p>
            {tokens.length > 0 && (
              <ol className="mt-3 space-y-1">
                {tokens.map((t, i) => {
                  const p = pointFor(t)
                  const Icon = p ? KIND_ICON[p.kind] : CircleDashed
                  const middleAirport = p?.kind === 'airport' && i > 0 && i < tokens.length - 1 && plan.route[i]?.replace(/\*$/, '') === t.replace(/\*$/, '')
                  const over = plan.route[i]?.endsWith('*')
                  return (
                    <li key={`${t}-${i}`} className="flex items-center gap-2 text-sm">
                      <Icon className={cn('size-4 shrink-0', !p ? 'text-fg-3' : p.kind === 'unknown' ? 'text-bad' : 'text-fg-2')} />
                      <span className="num w-28 shrink-0 font-medium text-fg">{t.replace(/\*$/, '')}</span>
                      <span className="min-w-0 flex-1 truncate text-fg-3">{p ? (p.kind === 'unknown' ? p.error : `${KIND_LABEL[p.kind]}${p.type && p.kind === 'navaid' ? ` (${p.type})` : ''} · ${p.kind === 'airport' ? titleCase(p.name ?? '') : p.name ?? ''}${p.freq ? ` · ${p.freq}` : ''}`) : resolved.isFetching ? 'Looking up…' : ''}</span>
                      {middleAirport && <button onClick={() => toggleStop(i)} className={cn('press h-6 shrink-0 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset', over ? 'text-fg-3 ring-border' : 'bg-accent-soft text-accent ring-accent/30')}>{over ? 'Fly over' : 'Land'}</button>}
                    </li>
                  )
                })}
              </ol>
            )}
            {resolved.data?.cycle && <p className="mt-2 text-xs text-fg-3">FAA NASR cycle {resolved.data.cycle}</p>}
          </div>
        </div>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <SubHead>3 · Departure (local)</SubHead>
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <NumField label="Pilot (L)" value={w(seats.pilot)} onChange={setSeat('pilot')} />
              <NumField label="Front (R)" value={w(seats.front)} onChange={setSeat('front')} />
              <NumField label="Rear left" value={w(seats.rearL)} onChange={setSeat('rearL')} />
              <NumField label="Rear right" value={w(seats.rearR)} onChange={setSeat('rearR')} />
              <NumField label="Baggage" value={w(plan.loads.bag1)} onChange={v => set({ loads: { ...plan.loads, bag1: fromW(v, u) } })} />
            </div>
          </div>
        </div>
      </div>

      <details className="group rounded-lg ring-1 ring-inset ring-border">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-fg-2 hover:text-fg">
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          <span className="font-medium">Automatic values</span>
          <span className="num min-w-0 truncate text-fg-3">· {d.flights.map(f => `${f.alt.toLocaleString()} ft`).join(' / ') || 'altitude'} · fuel {plan.fuelGal == null ? 'full' : `${Math.round(toF(plan.fuelGal, u))} ${u.fuel}`} · {plan.stopMinutes} min per stop{plan.alternate ? ` · alternate ${plan.alternate}` : ''}</span>
        </summary>
        <div className="space-y-6 border-t border-border px-4 py-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <SubHead>Cruise altitude</SubHead>
              {d.flights.map(f => (
                <div key={f.n} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3 text-sm">
                  <div className="min-w-0"><span className="num font-medium text-fg">{f.from.icao || f.from.id} → {f.to.icao || f.to.id}</span>
                    <div className="text-xs text-fg-3">{f.altSet ? `Set by you (automatic: ${f.altAuto.toLocaleString()} ft)` : `${f.hemispheric ? `Lowest VFR altitude for ${Math.round(f.mc)}° magnetic (${f.mc < 180 ? 'odd' : 'even'} + 500)` : 'Short hop: below 3,000 ft AGL'}, ≥ 1,000 ft above terrain${f.terrainMax != null ? ` (${Math.round(f.terrainMax).toLocaleString()} ft)` : ''}`}</div>
                  </div>
                  <OptNum value={f.altSet ? f.alt : null} placeholder={f.altAuto} unit="ft" step={500} onChange={v => set({ altitudes: { ...plan.altitudes, [f.n]: v ?? 0 } })} label={`Cruise altitude ${f.from.id} to ${f.to.id}`} />
                </div>
              ))}
              {!d.flights.length && <p className="text-sm text-fg-3">Chosen per flight once the route resolves.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 self-start">
              <label className="block"><span className="mb-1 block text-sm text-fg-2">Fuel on board</span>
                <OptNum value={plan.fuelGal == null ? null : Math.round(toF(plan.fuelGal, u) * 10) / 10} placeholder={profile ? Math.round(toF(d.totals.usableFuel, u)) : 40} unit={u.fuel} onChange={v => set({ fuelGal: v == null ? null : fromF(v, u) })} label="Fuel on board" />
                <span className="mt-1 block text-xs text-fg-3">Blank = full usable fuel</span>
              </label>
              <NumField label="Ground time per stop" value={plan.stopMinutes} onChange={v => set({ stopMinutes: v })} unit="min" step={5} min={0} />
              <label className="block"><span className="mb-1 block text-sm text-fg-2">Alternate (optional)</span>
                <Input value={plan.alternate ?? ''} onChange={e => set({ alternate: e.target.value.toUpperCase().trim() || null })} placeholder="KWVI" className="num uppercase" />
              </label>
              <label className="block"><span className="mb-1 block text-sm text-fg-2">Rear baggage area 2</span>
                <Input type="number" value={w(plan.loads.bag2)} onChange={e => set({ loads: { ...plan.loads, bag2: fromW(Number(e.target.value) || 0, u) } })} className="num" />
              </label>
            </div>
          </div>
          {plan.tail && <EmptyWeight tail={plan.tail} planning={planning} save={savePlanning} u={u} />}
          <MinimumsEditor minimums={minimums} savedAt={minimumsSavedAt} onSave={saveMinimums} saving={savingMinimums} />
        </div>
      </details>
    </div>
  )
}

function OptNum({ value, placeholder, onChange, unit, step, label }: { value: number | null; placeholder: number; onChange: (v: number | null) => void; unit?: string; step?: number; label: string }) {
  return (
    <span className="relative block">
      <Input type="number" inputMode="decimal" aria-label={label} value={value ?? ''} placeholder={String(placeholder)} step={step} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} className={cn('num', unit && 'pr-10')} />
      {unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-3">{unit}</span>}
    </span>
  )
}

// This airplane's basic empty weight and moment (its W&B record), saved per tail.
function EmptyWeight({ tail, planning, save, u }: { tail: string; planning: AircraftPlanning; save: (p: AircraftPlanning) => void; u: Units }) {
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

function PohStatus({ poh, loading, error, model }: { poh: PohMatch | null | undefined; loading: boolean; error: string | null; model?: string | null }) {
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

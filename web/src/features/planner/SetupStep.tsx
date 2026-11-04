import { useDeferredValue, useEffect, useState } from 'react'
import { BookOpen, CheckCircle2, CircleDashed, Loader2, MapPin, Navigation, Plane, Radio, XCircle } from 'lucide-react'
import { Input, Select } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { titleCase } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AircraftRef, AircraftRegistry } from '@/lib/types'
import { useResolve, type PilotInfo, type PohMatch } from './api'
import type { AircraftPlanning, Derived, Plan, RoutePoint } from './model'
import { routeToText, textToRoute, tokenize } from './route'
import { NumField, SubHead } from './ui'
import type { Units } from './units'

const KIND_ICON = { airport: Plane, navaid: Radio, fix: Navigation, vfr: MapPin, gps: MapPin, radial: Radio, unknown: XCircle } as const
const KIND_LABEL: Record<RoutePoint['kind'], string> = { airport: 'Airport', navaid: 'Navaid', fix: 'Fix', vfr: 'VFR waypoint', gps: 'Coordinates', radial: 'Radial/DME', unknown: 'Not found' }

// Step 0: the few things everything else is built from — the aircraft and the
// route. Tail → registry → make/model/year → POH (found and downloaded) → the
// performance numbers every later step uses; route text → resolved points.
export function SetupStep({ plan, set, fleet, registry, registryLoading, poh, pohLoading, pohError, units, aircraft }: {
  plan: Plan; set: (p: Partial<Plan>) => void; fleet: AircraftRef[]; registry: AircraftRegistry | null | undefined; registryLoading: boolean
  poh: PohMatch | null | undefined; pohLoading: boolean; pohError: string | null; units: Units; aircraft: { make?: string | null; model?: string | null; year?: number | null }
}) {
  const [tail, setTail] = useState(plan.tail ?? '')
  useEffect(() => setTail(plan.tail ?? ''), [plan.tail])
  const commitTail = () => { const t = tail.toUpperCase().replace(/\s+/g, '').trim(); if (t !== (plan.tail ?? '')) set({ tail: t || null, aircraft: undefined }) }

  const [text, setText] = useState(routeToText(plan.route))
  useEffect(() => setText(routeToText(plan.route)), [plan.route])
  const draft = useDeferredValue(text)
  const tokens = tokenize(draft)
  const resolved = useResolve(tokens)
  const pts = resolved.data?.points ?? []
  const commitRoute = () => {
    const next = textToRoute(text, plan.route, t => { const p = pts.find(x => x.token.replace(/\*$/, '') === t); return p ? p.kind === 'airport' : undefined })
    if (next.join(' ') !== plan.route.join(' ')) set({ route: next })
  }
  const noRegistry = !!plan.tail && !registryLoading && !registry?.model

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-5">
        <div>
          <SubHead>Aircraft</SubHead>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
            <label className="block">
              <span className="mb-1 block text-sm text-fg-2">Tail number</span>
              <Input value={tail} onChange={e => setTail(e.target.value.toUpperCase())} onBlur={commitTail} onKeyDown={e => { if (e.key === 'Enter') commitTail() }}
                placeholder="N54829, C-GABC, G-ABCD" list="planner-fleet" className="num uppercase" autoCapitalize="characters" spellCheck={false} />
              <datalist id="planner-fleet">{fleet.map(a => <option key={a.id} value={a.tail_number}>{a.make} {a.model}{a.year ? ` (${a.year})` : ''}</option>)}</datalist>
              <span className="mt-1 block text-xs text-fg-3">Registered in {units.country} · {units.weight} / {units.fuel} / {units.pressure}</span>
            </label>
            <div className="min-w-0 text-sm">
              {registryLoading && plan.tail && <p className="flex items-center gap-2 text-fg-3"><Loader2 className="size-4 animate-spin" />Looking up {plan.tail} in the FAA registry…</p>}
              {registry?.model && (
                <div className="flex gap-3">
                  {registry.photo_url && <img src={registry.photo_url} alt="" className="h-16 w-24 shrink-0 rounded-md object-cover ring-1 ring-border" onError={e => { e.currentTarget.style.display = 'none' }} />}
                  <div className="min-w-0">
                    <div className="font-medium text-fg">{titleCase(registry.make ?? '')} {registry.model}{registry.year ? ` · ${registry.year}` : ''}</div>
                    <div className="text-fg-3">{[registry.engine_type, registry.engine_hp && `${registry.engine_hp} hp`, registry.seats && `${registry.seats} seats`].filter(Boolean).join(' · ')}</div>
                    <div className="text-xs text-fg-3">FAA aircraft registry</div>
                  </div>
                </div>
              )}
              {noRegistry && <p className="text-fg-3">{units.country === 'United States' ? `${plan.tail} isn't in the FAA registry.` : 'Outside the FAA registry.'} Enter the make, model and year:</p>}
            </div>
          </div>
          {(noRegistry || plan.aircraft) && (
            <div className="mt-3 grid grid-cols-3 gap-3">
              <label className="block"><span className="mb-1 block text-sm text-fg-2">Make</span><Input value={plan.aircraft?.make ?? aircraft.make ?? ''} onChange={e => set({ aircraft: { ...plan.aircraft, make: e.target.value } })} placeholder="Cessna" /></label>
              <label className="block"><span className="mb-1 block text-sm text-fg-2">Model</span><Input value={plan.aircraft?.model ?? aircraft.model ?? ''} onChange={e => set({ aircraft: { ...plan.aircraft, model: e.target.value.toUpperCase() } })} placeholder="172P" className="uppercase" /></label>
              <NumField label="Year" value={plan.aircraft?.year ?? aircraft.year ?? ''} onChange={v => set({ aircraft: { ...plan.aircraft, year: v || null } })} />
            </div>
          )}
          {registry?.model && !plan.aircraft && <button className="mt-1 text-xs text-accent hover:underline" onClick={() => set({ aircraft: { make: registry.make, model: registry.model, year: registry.year ?? null } })}>Correct the make or model</button>}
          <PohStatus poh={poh} loading={pohLoading} error={pohError} model={aircraft.model} />
        </div>

        <div>
          <SubHead right={<span className="text-xs text-fg-3">SkyVector / ForeFlight format</span>}>Route</SubHead>
          <Input value={text} onChange={e => setText(e.target.value.toUpperCase())} onBlur={commitRoute} onKeyDown={e => { if (e.key === 'Enter') commitRoute() }}
            placeholder="KRHV VPCOY SJC090020 3720N12150W KHAF" className="num uppercase" spellCheck={false} autoCapitalize="characters" aria-label="Route" />
          <p className="mt-1 text-xs text-fg-3">Space-separated: airports (KRHV, E16), navaids (SJC, OSI), fixes and VFR waypoints (VPCOY), radial/distance (SJC090020 or SJC/090/20), coordinates (3720N12150W, 372030N1215015W, 37.33/-121.83). Start and end at an airport; middle airports are flown over until you mark them as stops on the Trip step.</p>
          {tokens.length > 0 && (
            <ol className="mt-3 space-y-1">
              {tokens.map((t, i) => {
                const p = pts.find(x => x.token.replace(/\*$/, '') === t)
                const Icon = p ? KIND_ICON[p.kind] : CircleDashed
                return (
                  <li key={`${t}-${i}`} className="flex items-center gap-2 text-sm">
                    <Icon className={cn('size-4 shrink-0', !p ? 'text-fg-3' : p.kind === 'unknown' ? 'text-bad' : 'text-fg-2')} />
                    <span className="num w-28 shrink-0 font-medium text-fg">{t}</span>
                    <span className="min-w-0 flex-1 truncate text-fg-3">{p ? (p.kind === 'unknown' ? p.error : `${KIND_LABEL[p.kind]}${p.type && p.kind === 'navaid' ? ` (${p.type})` : ''} · ${p.kind === 'airport' ? titleCase(p.name ?? '') : p.name ?? ''}${p.freq ? ` · ${p.freq}` : ''}`) : resolved.isFetching ? 'Looking up…' : ''}</span>
                    {p?.lat != null && <span className="num hidden shrink-0 text-xs text-fg-3 sm:inline">{p.lat.toFixed(3)}, {p.lon!.toFixed(3)}</span>}
                  </li>
                )
              })}
            </ol>
          )}
          {resolved.data?.cycle && <p className="mt-2 text-xs text-fg-3">FAA NASR cycle {resolved.data.cycle}</p>}
        </div>
      </div>

      <div className="space-y-5">
        <div>
          <SubHead>When and how high</SubHead>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-3">
              <span className="mb-1 block text-sm text-fg-2">Departure (local)</span>
              <Input type="datetime-local" value={plan.departLocal} onChange={e => set({ departLocal: e.target.value })} className="num" />
            </label>
            <NumField label="Cruise altitude" value={plan.cruiseAlt} onChange={v => set({ cruiseAlt: v })} unit="ft" step={500} min={1000} />
            <label className="block">
              <span className="mb-1 block text-sm text-fg-2">Cruise power</span>
              <Select value={plan.rpm} onChange={e => set({ rpm: Number(e.target.value) })} className="num">{[2600, 2500, 2400, 2300, 2200].map(r => <option key={r} value={r}>{r} RPM</option>)}</Select>
            </label>
            <NumField label="Ground time per stop" value={plan.stopMinutes} onChange={v => set({ stopMinutes: v })} unit="min" step={5} min={0} />
          </div>
        </div>
      </div>
    </div>
  )
}

function PohStatus({ poh, loading, error, model }: { poh: PohMatch | null | undefined; loading: boolean; error: string | null; model?: string | null }) {
  if (!model) return null
  return (
    <div className={cn('mt-3 flex gap-2 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset', poh && poh.exact ? 'ring-border' : 'bg-warn-soft text-warn ring-warn/30')}>
      {loading ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : <BookOpen className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0">
        {loading && <span>Finding the POH for the {model} and downloading it…</span>}
        {!loading && poh && (
          <>
            <div className={cn(poh.exact ? 'text-fg' : '')}>{poh.title}{poh.exact ? '' : ` — closest public POH to the ${model}`}</div>
            <div className="text-xs opacity-80">{poh.profile ? 'Its performance tables drive weight & balance, takeoff, climb, cruise, fuel and landing in every step.' : 'Shown for reference; its tables aren\'t transcribed yet, so performance uses the closest transcribed POH (flagged on each step).'} Open it any time with "POH &amp; briefing" (view or download).</div>
          </>
        )}
        {!loading && !poh && !error && <span>No publicly posted POH found for the {model}. Upload this airplane's POH in "POH &amp; briefing"; calculations use the closest transcribed POH and say so.</span>}
        {error && <span>{error}</span>}
      </div>
    </div>
  )
}

// Every input a complete VFR flight plan and navlog needs: what you type and what the page derives.
export function InputsChecklist({ plan, d, planning, registry, poh, pilot, onJump }: {
  plan: Plan; d: Derived; planning: AircraftPlanning; registry: AircraftRegistry | null | undefined; poh: PohMatch | null | undefined; pilot: PilotInfo | undefined
  onJump?: (step: number) => void
}) {
  const yes = (v: unknown) => v != null && v !== '' && v !== 0 && v !== false
  const you: [string, boolean, number, string?][] = [
    ['Tail number', yes(plan.tail), 0],
    ['Route: departure, waypoints, destination', plan.route.length >= 2, 0],
    ['Departure date and time', yes(plan.departLocal), 0],
    ['Cruise altitude and power', yes(plan.cruiseAlt) && yes(plan.rpm), 0],
    ['Alternate airport', yes(plan.alternate), 1],
    ['Fit to fly (IMSAFE) and risks (PAVE)', d.sections.pilot !== 'todo', 2],
    ['Aircraft empty weight and moment (its W&B record)', yes(planning.emptyWeight), 3, 'POH sample airplane until entered'],
    ['Inspections (AV1ATES) and required equipment', d.sections.aircraft !== 'todo', 3],
    ['Pilot, passengers and baggage by station', plan.loads.front > 0, 4],
    ['Fuel on board', plan.fuelGal > 0, 4],
    ['Compass deviation card (per heading)', Object.values(plan.actuals || {}).some(a => a.dev), 6, 'optional; CH = MH'],
    ['Pilot name, phone, home base · aircraft color (flight plan 14, 16)', yes(pilot?.name) && yes(planning.color), 9, 'needed only to file'],
  ]
  const derived: [string, boolean, string][] = [
    ['Make, model, year, engine', yes(registry?.model ?? plan.aircraft?.model), 'FAA registry'],
    ['POH (downloadable) and its performance tables', !!poh && !!d.profile, poh ? poh.title : 'POH catalog'],
    ['V-speeds, limits, fuel capacity, CG envelope', !!d.profile, 'POH sec. 2, 6'],
    ['Takeoff / landing distance at each airport', d.perf.length > 0, 'POH Fig. 5-5, 5-11'],
    ['Climb time, fuel, distance', d.legs.some(l => l.climb), 'POH Fig. 5-7'],
    ['Cruise TAS and fuel flow', d.legs.length > 0, 'POH Fig. 5-8'],
    ['True course and distance per leg', d.navlog.length > 0, 'great circle'],
    ['Magnetic variation per checkpoint', d.navlog.length > 0, 'FAA NASR'],
    ['Winds and temperatures aloft', !!d.fb, 'NOAA FB forecast'],
    ['WCA, TH, MH, CH, GS, ETE, ETA, fuel per row', d.navlog.length > 0, 'E6B wind triangle'],
    ['METAR/TAF at each ETA, hazards on the route', d.wx.length > 0, 'aviationweather.gov'],
    ['Runways, frequencies, pattern altitude, tower hours', d.legs.length > 0, 'FAA NASR / Chart Supplement'],
    ['Terrain, airspace, sunset / civil twilight', d.samples.length > 0, 'Open-Meteo, FAA'],
  ]
  const Mark = ({ ok }: { ok: boolean }) => ok ? <CheckCircle2 className="size-4 shrink-0 text-good" /> : <CircleDashed className="size-4 shrink-0 text-fg-3" />
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <SubHead right={<Badge tone="outline">{you.filter(x => x[1]).length} / {you.length}</Badge>}>You enter</SubHead>
        <ul className="space-y-1.5 text-sm">{you.map(([l, ok, step, note]) => (
          <li key={l} className="flex items-start gap-2"><Mark ok={ok} /><button className="min-w-0 flex-1 text-left text-fg hover:underline" onClick={() => onJump?.(step)}>{l}</button>{note && !ok && <span className="shrink-0 text-xs text-fg-3">{note}</span>}</li>
        ))}</ul>
      </div>
      <div>
        <SubHead right={<Badge tone="outline">{derived.filter(x => x[1]).length} / {derived.length}</Badge>}>The planner derives</SubHead>
        <ul className="space-y-1.5 text-sm">{derived.map(([l, ok, src]) => (
          <li key={l} className="flex items-start gap-2"><Mark ok={ok} /><span className="min-w-0 flex-1 text-fg">{l}</span><span className="shrink-0 text-xs text-fg-3">{src}</span></li>
        ))}</ul>
      </div>
    </div>
  )
}

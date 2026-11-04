import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { AircraftRegistry } from '@/lib/types'
import type { AircraftPlanning, Airport, Derived, Plan } from './model'
import { freqLabel } from './TripSection'
import { NavlogTable } from './NavlogTable'
import { SubHead, Synced, fmtMin, fmtZ } from './ui'
import { isWaypoint } from './model'
import { toF, type Units, US } from './units'

export function NavlogSection({ plan, set, d, airports, terrainAt, planning, registry, readOnly, u = US }: { readOnly?: boolean; u?: Units; plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; airports: Airport[]; terrainAt?: string; planning: AircraftPlanning; registry: AircraftRegistry | null | undefined }) {
  if (!d.legs.length) return <p className="text-sm text-fg-3">Add a route that starts and ends at an airport, a departure time and the aircraft to build the navlog.</p>
  const alt = plan.alternate ? airports.find(a => a.icao === plan.alternate || a.id === plan.alternate) : null
  return (
    <>
      <NavlogTable plan={plan} set={set} d={d} readOnly={readOnly} u={u} />
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <Synced at={d.fb ? undefined : null} source={d.fb ? `Winds aloft: FB ${d.fb.fcst}-hour forecast based on ${d.fb.product.basedOn}Z, for use ${d.fb.product.forUse.join('–')}Z (NOAA AWC)` : 'No winds aloft'} />
        <Synced at={terrainAt} label="Terrain" source="highest point within the sampled line (Open-Meteo, Copernicus 90 m) — obstacles not included" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div>
          <SubHead>Fuel</SubHead>
          <dl className="num grid grid-cols-[1fr_auto] gap-y-1 text-sm">
            {[
              ['Start, taxi, takeoff (Fig. 5-7)', d.totals.taxiFuel],
              ['Trip (climb + cruise)', d.totals.tripFuel],
              [`Legal reserve (${plan.night ? 45 : 30} min, §91.151)`, d.totals.reserveFuel],
              ['Your reserve (personal minimums)', d.totals.personalReserveFuel],
            ].map(([k, v]) => <div key={k as string} className="contents"><dt className="font-sans text-fg-3">{k}</dt><dd className="text-right">{toF(v as number, u).toFixed(1)} {u.fuel}</dd></div>)}
            <dt className="border-t border-border pt-1 font-sans font-medium">Required</dt><dd className="border-t border-border pt-1 text-right font-medium">{toF(d.totals.requiredFuel, u).toFixed(1)} {u.fuel}</dd>
            <dt className="font-sans font-medium">Usable on board</dt><dd className="text-right font-medium">{toF(d.totals.usableFuel, u).toFixed(1)} {u.fuel}</dd>
            <dt className="font-sans text-fg-3">Endurance at cruise</dt><dd className="text-right">{fmtMin(d.totals.enduranceMin)}</dd>
            <dt className="font-sans text-fg-3">Fuel at destination</dt><dd className="text-right">{toF(d.totals.usableFuel - d.totals.taxiFuel - d.totals.tripFuel, u).toFixed(1)} {u.fuel}</dd>
          </dl>
        </div>
        <div>
          <SubHead>Airspace on the line</SubHead>
          {d.crossings.length ? (
            <ul className="space-y-1.5 text-sm">{d.crossings.map((c, i) => (
              <li key={i} className="flex items-baseline gap-2"><Badge tone={c.cls === 'B' ? 'accent' : c.cls === 'C' ? 'warn' : 'neutral'}>Class {c.cls}</Badge><span className="text-fg">{c.name}</span><span className="num ml-auto text-fg-3">{c.floor ? c.floor.toLocaleString() : 'SFC'}–{c.ceiling?.toLocaleString() ?? '?'}</span>{c.atCruise && <span className="text-xs text-warn">at cruise</span>}</li>
            ))}</ul>
          ) : <p className="text-sm text-fg-3">No Class B, C or D airspace on the direct line (Class E/G and special-use airspace aren't shown).</p>}
          <p className="mt-2 text-xs text-fg-3">Class B: clearance required. Class C: two-way radio before entering. Class D: two-way radio. Check the sectional for MOAs, restricted areas and TRSA.</p>
        </div>
        <FlightPlanText plan={plan} d={d} alt={alt ?? null} planning={planning} registry={registry} />
      </div>

      <div>
        <SubHead>Frequencies</SubHead>
        <div className="grid gap-4 md:grid-cols-2 3xl:grid-cols-4">
          {[...new Map([...d.legs.flatMap(l => [l.from, l.to]).filter(a => !isWaypoint(a)), ...(alt ? [alt] : [])].map(a => [a.id, a])).values()].map(a => (
            <div key={a.id} className="rounded-lg p-3 ring-1 ring-inset ring-border">
              <div className="mb-1.5 flex items-baseline justify-between"><span className="num font-medium">{a.icao || a.id}</span><span className="text-xs text-fg-3">{a.towered ? `TWR ${a.towerHrs ?? ''}` : 'CTAF'}</span></div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                {a.wx && <><dt className="text-fg-3">{a.wx.type}{a.wx.id !== a.id ? ` ${a.wx.id}` : ''}</dt><dd className="num">{a.wx.freq ?? a.wx.phone ?? '—'}</dd></>}
                {[...a.frequencies, ...(a.approach?.frequencies.map(f => ({ ...f, use: `${f.use}` })) ?? [])].map((f, i) => <div key={i} className="contents"><dt className="text-fg-3">{freqLabel(f.use)}</dt><dd className="num">{f.freq}{f.sector ? <span className="font-sans text-xs text-fg-3"> {f.sector}</span> : null}</dd></div>)}
                <dt className="text-fg-3">FSS</dt><dd className="num">122.2</dd>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function FlightPlanText({ plan, d, alt, planning, registry }: { plan: Plan; d: Derived; alt: Airport | null; planning: AircraftPlanning; registry: AircraftRegistry | null | undefined }) {
  const r = d.legs.map(l => l.from).concat(d.legs.at(-1)!.to)
  const souls = (plan.loads.front > 250 ? 2 : 1) + (plan.loads.rear > 0 ? Math.max(1, Math.round(plan.loads.rear / 170)) : 0)
  const endurance = d.totals.enduranceMin
  const text = [
    `1 TYPE        VFR`,
    `2 AIRCRAFT    ${plan.tail ?? ''}`,
    `3 TYPE/EQUIP  C172/${planning.equipment?.equipCode || (planning.equipment?.gps?.includes('IFR') ? 'G' : planning.equipment?.transponder === 'Mode S' ? 'S' : 'U')}`,
    `4 TAS         ${d.legs[0]?.tas ?? ''} KT`,
    `5 DEPARTURE   ${r[0].icao || r[0].id}`,
    `6 DEP TIME    ${fmtZ(d.departAt)}`,
    `7 ALTITUDE    ${plan.cruiseAlt}`,
    `8 ROUTE       ${r.slice(1, -1).map(a => (isWaypoint(a) ? a.id : a.icao || a.id)).join(' ') || 'DCT'}`,
    `9 DESTINATION ${r[r.length - 1].icao || r[r.length - 1].id}`,
    `10 ETE        ${fmtMin(d.totals.eteMin).replace(':', '+')}`,
    `11 REMARKS    ${plan.route.slice(1, -1).some(t => !t.endsWith('*') && !r.find(a => a.id === t && isWaypoint(a))) ? 'STOPS ' + plan.route.slice(1, -1).filter(t => !t.endsWith('*') && !r.find(a => a.id === t && isWaypoint(a))).join(' ') : ''}`,
    `12 FUEL       ${fmtMin(endurance).replace(':', '+')}`,
    `13 ALTERNATE  ${alt ? alt.icao || alt.id : ''}`,
    `15 ON BOARD   ${souls}`,
    `16 COLOR      ${''}`,
  ].join('\n')
  return (
    <div>
      <SubHead right={<Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(text).then(() => toast.success('Copied'))}><Copy />Copy</Button>}>VFR flight plan (FAA 7233-1 fields)</SubHead>
      <pre className="overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-2">{text}</pre>
      <p className="mt-1 text-xs text-fg-3">File with 1-800-WX-BRIEF or 1800wxbrief.com; open it with FSS on 122.2 after departure. Pilot's name, phone and aircraft color are left for you{registry?.make ? '' : ''}.</p>
    </div>
  )
}

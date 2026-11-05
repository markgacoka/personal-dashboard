import { RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { OptNum } from './FlightInputs'
import type { Airport, Derived, NavFix, Plan, WeatherBundle } from './model'
import { PlannerMap, type MapNotams, type MapRadar } from './PlannerMap'
import { SubHead, deg3 } from './ui'

const KIND: Record<string, string> = { airport: 'Airport', vfr: 'VFR waypoint', navaid: 'VOR', fix: 'RNAV fix' }
const fixType = (f: NavFix) =>
  f.kind === 'toc' ? 'Top of climb' : f.kind === 'tod' ? 'Top of descent' : f.kind === 'checkpoint' ? `${KIND[f.cpKind ?? 'airport']}${f.navType && f.cpKind === 'navaid' ? ` (${f.navType})` : ''} · automatic`
    : f.kind === 'airport' ? 'Airport, land' : f.kind === 'overfly' ? 'Airport, fly over' : f.navType === 'VFR-WP' ? 'VFR waypoint' : f.navType || 'Route point'

// 37°20.1′N 121°49.2′W, the way SkyVector shows a point.
export function fmtLatLon(lat?: number, lon?: number) {
  if (lat == null || lon == null) return ''
  const one = (v: number, p: string, n: string, w: number) => { const a = Math.abs(v), d = Math.floor(a); return `${String(d).padStart(w, '0')}°${((a - d) * 60).toFixed(1).padStart(4, '0')}′${v >= 0 ? p : n}` }
  return `${one(lat, 'N', 'S', 2)} ${one(lon, 'E', 'W', 3)}`
}

// Step 3: the route as flown — each flight's cruise altitude and why, then
// every navlog point (TOC, checkpoints, TOD) with its position, magnetic
// course, altitude, distance and the terrain under it; airspace and TFRs on
// the line. Automatic checkpoints can be dropped.
export function RouteStep({ plan, set, d, routePts, alternate, weather, airspace, radar, notams }: {
  plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; routePts: Airport[]; alternate: Airport | null; weather: WeatherBundle | null; airspace: unknown; radar?: MapRadar | null; notams: MapNotams[]
}) {
  const skip = plan.skipFixes || []
  return (
    <div className="space-y-8">
      {routePts.length > 1 && <PlannerMap className="h-[26rem] print:hidden" route={routePts} alternate={alternate} weather={weather} d={d} airspace={airspace} radar={radar} notams={notams} />}
      {!d.flights.length && <p className="text-sm text-fg-3">The route fills in once the airports resolve and the aircraft's POH is known.</p>}
      {d.flights.map(f => {
        const start = f.rows[0]
        return (
          <div key={f.n}>
            <SubHead right={<span className="num text-xs text-fg-3">{f.distNm.toFixed(1)} nm · {Math.round(f.eteMin)} min · {f.fuelGal.toFixed(2)} gal</span>}>
              {d.flights.length > 1 ? `Flight ${f.n + 1} · ` : ''}<span className="num">{f.from.icao || f.from.id} → {f.to.icao || f.to.id}</span>
            </SubHead>
            <div className="mb-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center">
              <div className="text-sm">
                <span className="num font-medium text-fg">Cruise {f.alt.toLocaleString()} ft MSL</span>
                <span className="text-fg-3"> · {f.altSet ? `set by you (automatic ${f.altAuto.toLocaleString()} ft)` : `${f.hemispheric ? `lowest VFR altitude for ${Math.round(f.mc)}° magnetic (${f.mc < 180 ? 'odd' : 'even'} thousands + 500)` : 'short hop: below 3,000 ft AGL'}, at least 1,000 ft above the highest terrain${f.terrainMax != null ? ` (${Math.round(f.terrainMax).toLocaleString()} ft)` : ''}`}</span>
              </div>
              <OptNum value={f.altSet ? f.alt : null} placeholder={f.altAuto} unit="ft" step={500} onChange={v => set({ altitudes: { ...plan.altitudes, [f.n]: v ?? 0 } })} label={`Cruise altitude ${f.from.id} to ${f.to.id}`} />
            </div>
            <div className="overflow-x-auto">
              <table className="num w-full min-w-[46rem] text-sm">
                <thead><tr className="text-left text-xs text-fg-3">
                  <th className="pb-1.5 font-medium">Point</th><th className="pb-1.5 font-medium">Type</th><th className="pb-1.5 font-medium">Position</th>
                  <th className="pb-1.5 text-right font-medium">MC</th><th className="pb-1.5 text-right font-medium">Altitude</th><th className="pb-1.5 text-right font-medium">Leg nm</th>
                  <th className="pb-1.5 text-right font-medium">Terrain</th><th className="w-8 pb-1.5" />
                </tr></thead>
                <tbody>
                  {start && (
                    <tr className="border-t border-border"><td className="py-1.5 font-medium">{start.from}</td><td className="py-1.5 font-sans text-fg-3">Airport, depart</td>
                      <td className="py-1.5 text-fg-2">{fmtLatLon(f.from.lat, f.from.lon)}</td><td /><td className="py-1.5 text-right">{Math.round(f.from.elev).toLocaleString()}</td><td /><td /><td /></tr>
                  )}
                  {f.rows.map(r => (
                    <tr key={r.key} className={cn('border-t border-border', (r.to.kind === 'toc' || r.to.kind === 'tod') && 'text-fg-2')}>
                      <td className="py-1.5 font-medium">{r.to.label}</td>
                      <td className="py-1.5 font-sans text-fg-3">{fixType(r.to)}{r.to.freq ? <span className="num"> · {r.to.freq}</span> : null}</td>
                      <td className="py-1.5 text-fg-2">{fmtLatLon(r.to.lat, r.to.lon)}</td>
                      <td className="py-1.5 text-right">{deg3(r.mc)}°</td>
                      <td className="py-1.5 text-right">{r.alt}</td>
                      <td className="py-1.5 text-right">{r.distNm.toFixed(1)}</td>
                      <td className="py-1.5 text-right">{r.terrainMax != null ? Math.round(r.terrainMax).toLocaleString() : ''}</td>
                      <td className="py-1.5 text-right">{r.to.kind === 'checkpoint' && <button className="text-fg-3 hover:text-bad" aria-label={`Drop ${r.to.label}`} title="Drop this checkpoint" onClick={() => set({ skipFixes: [...skip, r.to.id] })}><X className="size-4" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      {d.flights.length > 0 && (
        <p className="text-sm text-fg-3">
          Courses are great-circle from FAA NASR coordinates, magnetic with the WMM 2025 variation for the flight date. TOC from the POH climb table (+10 % per 10 °C above standard), TOD at 500 fpm to pattern altitude. Checkpoints on legs over 20 nm: airports and VFR waypoints within 5 nm, VORs within 4, RNAV fixes within 2, 8 nm apart. Terrain: Copernicus GLO-90 along the line. Add your own with the route text (e.g. <span className="num">KRHV ANDER E16* KSNS</span>).
          {skip.length > 0 && <> Dropped: <span className="num">{skip.join(', ')}</span> <button className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => set({ skipFixes: [] })}><RotateCcw className="size-3.5" />restore</button></>}
        </p>
      )}

      {(d.crossings.length > 0 || (d.hazards.tfrs?.length ?? 0) > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {d.crossings.length > 0 && (
            <div>
              <SubHead>Airspace on the line</SubHead>
              <ul className="divide-y divide-border rounded-lg text-sm ring-1 ring-inset ring-border">
                {d.crossings.map((c, i) => (
                  <li key={i} className="flex items-baseline gap-3 px-3 py-2"><span className="num w-14 shrink-0 font-medium">Class {c.cls}</span><span className="min-w-0 flex-1 text-fg-2">{c.name}</span>
                    <span className="num shrink-0 text-fg-3">{c.floor ? c.floor.toLocaleString() : 'SFC'}–{c.ceiling?.toLocaleString() ?? ''}{c.atCruise ? ' · at cruise' : ''}</span></li>
                ))}
              </ul>
            </div>
          )}
          {(d.hazards.tfrs?.length ?? 0) > 0 && (
            <div>
              <SubHead>TFRs near the line</SubHead>
              <ul className="divide-y divide-border rounded-lg text-sm ring-1 ring-inset ring-border">
                {d.hazards.tfrs!.map(t => <li key={t.properties.id} className="px-3 py-2"><div className="font-medium text-bad">{t.properties.title}</div><div className="text-fg-3">{t.properties.kind} {t.properties.id} · tfr.faa.gov</div></li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

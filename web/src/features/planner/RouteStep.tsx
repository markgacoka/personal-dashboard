import { useMemo, useState } from 'react'
import { ArrowRight, Loader2, Plus, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { OptNum } from './FlightInputs'
import type { Airport, Checkpoint, Derived, NavFix, Plan, WeatherBundle } from './model'
import { PlannerMap, type MapNotams, type MapRadar, type RouteEdit } from './PlannerMap'
import { SUGGEST_KIND, candidates, kindName, suggest, type Landmarks, type SuggestKind } from './suggest'
import { SubHead, deg3 } from './ui'

const KIND: Record<string, string> = { airport: 'Airport', vfr: 'VFR waypoint', navaid: 'VOR', fix: 'RNAV fix' }
const fixType = (f: NavFix) =>
  f.kind === 'toc' ? 'Top of climb' : f.kind === 'tod' ? 'Top of descent' : f.kind === 'checkpoint' ? `${KIND[f.cpKind ?? 'airport']}${f.navType && f.cpKind === 'navaid' ? ` (${f.navType})` : ''} · automatic`
    : f.kind === 'airport' ? 'Airport, land' : f.kind === 'overfly' ? 'Airport, fly over' : f.navType === 'VFR-WP' ? 'VFR waypoint' : f.navType ? kindName(f.navType) : 'Route point'

// 37°20.1′N 121°49.2′W, the way SkyVector shows a point.
export function fmtLatLon(lat?: number, lon?: number) {
  if (lat == null || lon == null) return ''
  const one = (v: number, p: string, n: string, w: number) => { const a = Math.abs(v), d = Math.floor(a); return `${String(d).padStart(w, '0')}°${((a - d) * 60).toFixed(1).padStart(4, '0')}′${v >= 0 ? p : n}` }
  return `${one(lat, 'N', 'S', 2)} ${one(lon, 'E', 'W', 3)}`
}

// Step 3: build the route, then the route as flown. Points you could add
// (NASR and landmarks) are listed leg by leg and drawn on the chart, where the
// line can be dragged like SkyVector's. Below: each flight's cruise altitude
// and why, every navlog point (TOC, checkpoints, TOD) with position, magnetic
// course, altitude, distance and terrain; airspace and TFRs on the line.
// Automatic checkpoints can be dropped.
export function RouteStep({ plan, set, d, routePts, alternate, weather, airspace, radar, notams, checkpoints, landmarks, landmarksLoading, edit }: {
  plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; routePts: Airport[]; alternate: Airport | null; weather: WeatherBundle | null; airspace: unknown; radar?: MapRadar | null; notams: MapNotams[]
  checkpoints: Checkpoint[]; landmarks: Landmarks | null; landmarksLoading: boolean; edit: RouteEdit
}) {
  const skip = plan.skipFixes || []
  const sugg = useMemo(() => suggest(routePts, checkpoints, landmarks), [routePts, checkpoints, landmarks])
  // Kinds hidden in the list are hidden on the chart too.
  const [off, setOff] = useState<Set<SuggestKind>>(() => new Set(['fix', 'rail']))
  // Near the line (in the list) always; the rest of the area when zoomed in (see PlannerMap).
  const cands = useMemo(() => { const near = new Set(sugg.map(x => x.token)); return candidates(checkpoints, landmarks, sugg).filter(c => !off.has(c.kind)).map(c => ({ ...c, near: near.has(c.token) })) }, [checkpoints, landmarks, sugg, off])
  const lm = useMemo(() => landmarks && { ...landmarks, lines: landmarks.lines.filter(l => !off.has(l.kind)) }, [landmarks, off])
  return (
    <div className="space-y-8">
      {routePts.length > 1 && (
        <div className="space-y-3">
          <RouteChips pts={routePts} edit={edit} />
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div>
              <PlannerMap className="h-[26rem] sm:h-[34rem] print:hidden" route={routePts} alternate={alternate} weather={weather} d={d} airspace={airspace} radar={radar} notams={notams} landmarks={lm} cands={cands} edit={edit} />
              <p className="mt-2 text-sm text-fg-3">Drag the route line to add a point; drag a point to move it, click it to remove it. Points snap to the dots (airports, VFR waypoints, VORs, fixes, towns, towers 200 ft AGL and up, peaks) and onto highways, rivers, railroads and power lines. Satellite shows terrain, Topo roads and towns, Sectional elevations, parachute areas and VFR waypoints.</p>
            </div>
            <Suggestions sugg={sugg} pts={routePts} edit={edit} loading={landmarksLoading} errors={landmarks?.errors ?? []} off={off} setOff={setOff} />
          </div>
        </div>
      )}
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
              <table className="num w-full text-sm md:min-w-[46rem] [&_td+td]:pl-2 [&_th]:whitespace-nowrap [&_th+th]:pl-2">
                <thead><tr className="text-left text-xs text-fg-3">
                  <th className="pb-1.5 font-medium">Point</th><th className="pb-1.5 font-medium max-sm:hidden">Type</th><th className="pb-1.5 font-medium max-md:hidden">Position</th>
                  <th className="pb-1.5 text-right font-medium">MC</th><th className="pb-1.5 text-right font-medium">Altitude</th><th className="pb-1.5 text-right font-medium">Leg nm</th>
                  <th className="pb-1.5 text-right font-medium">Terrain</th><th className="w-8 pb-1.5" />
                </tr></thead>
                <tbody>
                  {start && (
                    <tr className="border-t border-border"><td className="py-1.5 font-medium">{start.from}<div className="font-sans text-xs font-normal text-fg-3 sm:hidden">Airport, depart</div></td><td className="py-1.5 font-sans text-fg-3 max-sm:hidden">Airport, depart</td>
                      <td className="py-1.5 text-fg-2 max-md:hidden">{fmtLatLon(f.from.lat, f.from.lon)}</td><td /><td className="py-1.5 text-right">{Math.round(f.from.elev).toLocaleString()}</td><td /><td /><td /></tr>
                  )}
                  {f.rows.map(r => (
                    <tr key={r.key} className={cn('border-t border-border', (r.to.kind === 'toc' || r.to.kind === 'tod') && 'text-fg-2')}>
                      <td className="py-1.5 font-medium">{r.to.label}<div className="font-sans text-xs font-normal text-fg-3 sm:hidden">{fixType(r.to)}{r.to.freq ? <span className="num"> · {r.to.freq}</span> : null}</div></td>
                      <td className="py-1.5 font-sans text-fg-3 max-sm:hidden">{fixType(r.to)}{r.to.freq ? <span className="num"> · {r.to.freq}</span> : null}</td>
                      <td className="py-1.5 text-fg-2 max-md:hidden">{fmtLatLon(r.to.lat, r.to.lon)}</td>
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
                  <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2"><span className="num w-14 shrink-0 font-medium">Class {c.cls}</span><span className="min-w-0 flex-1 basis-40 text-fg-2">{c.name}</span>
                    <span className="num ml-auto shrink-0 text-fg-3">{c.floor ? c.floor.toLocaleString() : 'SFC'}–{c.ceiling?.toLocaleString() ?? ''}{c.atCruise ? ' · at cruise' : ''}</span></li>
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

const ptName = (a: Airport) => a.label || a.icao || a.id

// The route as chips: departure → points flown over (removable) → arrival.
function RouteChips({ pts, edit }: { pts: Airport[]; edit: RouteEdit }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Route">
      {pts.map((a, i) => {
        const end = i === 0 || i === pts.length - 1
        return (
          <li key={`${a.id}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <ArrowRight className="size-3.5 text-fg-3" />}
            <span className={cn('num inline-flex h-7 items-center gap-1 rounded-full pl-2.5 ring-1 ring-inset', end ? 'bg-accent-soft pr-2.5 font-medium text-accent ring-accent/30' : 'pr-1 text-fg ring-border')} title={a.name}>
              {ptName(a)}
              {end && <span className="text-xs font-normal opacity-80">{i === 0 ? 'dep' : 'arr'}</span>}
              {!end && <button className="grid size-5 place-items-center rounded-full text-fg-3 hover:bg-bad-soft hover:text-bad" aria-label={`Remove ${ptName(a)}`} onClick={() => edit.remove(i)}><X className="size-3.5" /></button>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

const ORDER: SuggestKind[] = ['vfr', 'airport', 'navaid', 'fix', 'town', 'road', 'river', 'rail', 'power', 'lake', 'peak', 'obstacle']

// Points you could fly over, leg by leg, nearest the line first in each kind.
function Suggestions({ sugg, pts, edit, loading, errors, off, setOff }: {
  sugg: ReturnType<typeof suggest>; pts: Airport[]; edit: RouteEdit; loading: boolean; errors: string[]; off: Set<SuggestKind>; setOff: React.Dispatch<React.SetStateAction<Set<SuggestKind>>>
}) {
  const counts = useMemo(() => { const c: Partial<Record<SuggestKind, number>> = {}; for (const s of sugg) c[s.kind] = (c[s.kind] ?? 0) + 1; return c }, [sugg])
  const shown = sugg.filter(s => !off.has(s.kind))
  const legs = [...new Set(shown.map(s => s.leg))]
  return (
    <div className="flex h-[28rem] min-h-0 flex-col rounded-lg ring-1 ring-inset ring-border 2xl:h-[34rem]">
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-fg">Suggested points</span>{loading && <span className="flex items-center gap-1.5 text-xs text-fg-3"><Loader2 className="size-3.5 animate-spin" />Landmarks</span>}</div>
        <div className="scrollbar-none -mx-3 mt-2 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:px-0">
          {ORDER.filter(k => counts[k]).map(k => (
            <button key={k} aria-pressed={!off.has(k)} onClick={() => setOff(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })}
              className={cn('inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm font-medium ring-1 ring-inset sm:h-6 sm:px-2 sm:text-xs', off.has(k) ? 'text-fg-3 ring-border' : 'text-fg ring-border bg-card')}>
              <span className="size-2 rounded-full" style={{ background: SUGGEST_KIND[k].color, opacity: off.has(k) ? 0.35 : 1 }} />{SUGGEST_KIND[k].label} <span className="num text-fg-3">{counts[k]}</span>
            </button>
          ))}
        </div>
        {errors.length > 0 && <p className="mt-1.5 text-xs text-warn">Unavailable: {errors.join('; ')}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!shown.length && <p className="px-3 py-3 text-sm text-fg-3">{loading ? 'Looking for points near the line…' : 'Nothing within 5 nm of the line for the kinds selected.'}</p>}
        {legs.map(leg => (
          <div key={leg}>
            <div className="num sticky top-0 border-b border-border bg-card px-3 py-1.5 text-xs font-medium text-fg-3 backdrop-blur">{ptName(pts[leg - 1])} → {ptName(pts[leg])}</div>
            <ul className="divide-y divide-border">
              {shown.filter(s => s.leg === leg).map(s => (
                <li key={s.key} className="flex items-center gap-2.5 px-3 py-1.5">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: SUGGEST_KIND[s.kind].color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fg">{s.label}{s.nasr && s.name && <span className="text-fg-3"> · {s.name}</span>}</div>
                    <div className="num truncate text-xs text-fg-3">{s.detail} · {s.alongNm.toFixed(1)} nm{Math.abs(s.offNm) >= 0.1 ? ` · ${Math.abs(s.offNm).toFixed(1)} nm ${s.offNm > 0 ? 'right' : 'left'}` : ' · on the line'}</div>
                  </div>
                  <button className="press grid size-9 shrink-0 place-items-center rounded-full text-accent sm:size-7 ring-1 ring-inset ring-border hover:bg-accent-soft" aria-label={`Add ${s.label} to the route`} title="Add to the route"
                    onClick={() => edit.insert(s.leg, { token: s.token, label: s.nasr ? undefined : s.label, kind: s.kind })}><Plus className="size-4" /></button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

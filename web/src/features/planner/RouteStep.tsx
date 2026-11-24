import { useMemo, useState } from 'react'
import { ArrowRight, Loader2, Pencil, Plus, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { OptNum } from './FlightInputs'
import type { Airport, Checkpoint, Derived, NavFix, Plan, WeatherBundle } from './model'
import { MapBoundary } from './MapBoundary'
import { PlannerMap, type MapNotams, type MapRadar, type RouteEdit } from './PlannerMap'
import { SUGGEST_KIND, candidates, kindName, suggest, type Landmarks, type SuggestKind } from './suggest'
import { SubHead, deg3, fmtTime } from './ui'
import { Tooltip } from '@/components/ui/misc'
import { Dot } from '@/components/ui/badge'
import type { InputSource } from './explain'
import { SourceStrip, TIER_COLOR } from './ExplainView'
import type { WindSrc } from './model'

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
export function RouteStep({ plan, set, d, routePts, alternate, weather, airspace, radar, notams, checkpoints, landmarks, landmarksLoading, edit, part, sources = [], focusKey = null, onFocus }: {
  part: 'chart' | 'table'; sources?: InputSource[]; focusKey?: string | null; onFocus?: (key: string) => void; plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; routePts: Airport[]; alternate: Airport | null; weather: WeatherBundle | null; airspace: unknown; radar?: MapRadar | null; notams: MapNotams[]
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
      {part === 'chart' && routePts.length < 2 && <p className="text-[13px] text-fg-3">Enter a departure and arrival to open the chart.</p>}
      {part === 'chart' && routePts.length > 1 && (
        <div className="space-y-3">
          <RouteChips pts={routePts} edit={edit} />
          <div className="grid gap-4 @5xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div>
              <MapBoundary><PlannerMap className="h-[26rem] sm:h-[34rem] print:hidden" route={routePts} alternate={alternate} weather={weather} d={d} airspace={airspace} radar={radar} notams={notams} landmarks={lm} cands={cands} edit={edit} /></MapBoundary>
              <p className="mt-2 text-[13px] text-fg-3">Drag the line to add a point, drag a point to move it, click it to remove it. Points snap to nearby landmarks.</p>
            </div>
            <Suggestions sugg={sugg} pts={routePts} edit={edit} loading={landmarksLoading} errors={landmarks?.errors ?? []} off={off} setOff={setOff} />
          </div>
        </div>
      )}
      {part === 'table' && <>
      {!d.flights.length && <p className="text-sm text-fg-3">The route fills in once the airports resolve and the aircraft's POH is known.</p>}
      <SourceStrip list={sources} />
      {d.flights.map(f => {
        const fw = plan.flightWinds?.[f.n] ?? {}
        const cruiseRow = f.rows.find(r => r.phase === 'cruise') ?? f.rows[0]
        const fc = cruiseRow?.windSrc === 'yours' ? null : cruiseRow?.wind
        const putFw = (k: 'wdir' | 'wspd' | 'temp', v: number | null) => set({ flightWinds: { ...plan.flightWinds, [f.n]: { ...fw, [k]: v } } })
        return (
          <div key={f.n}>
            <SubHead right={<span className="num text-xs text-fg-3">{f.distNm.toFixed(1)} nm · {Math.round(f.eteMin)} min · {f.fuelGal.toFixed(2)} gal</span>}>
              {d.flights.length > 1 ? `Flight ${f.n + 1} · ` : ''}<span className="num">{f.from.icao || f.from.id} → {f.to.icao || f.to.id}</span>
            </SubHead>
            <div className="mb-5 grid gap-x-6 gap-y-4 @3xl:grid-cols-2">
              <div>
                <div className="text-sm"><span className="num font-medium text-fg">Cruise {f.alt.toLocaleString()} ft MSL</span></div>
                <p className="mt-0.5 text-[13px] text-fg-3">{f.altSet ? `Set by you; automatic is ${f.altAuto.toLocaleString()} ft.` : `${f.hemispheric ? `Lowest VFR altitude for ${Math.round(f.mc)}° magnetic` : 'Short hop: below 3,000 ft AGL'}, 1,000 ft or more above the highest terrain${f.terrainMax != null ? ` (${Math.round(f.terrainMax).toLocaleString()} ft)` : ''}.`}</p>
                <div className="mt-2 w-36"><OptNum value={f.altSet ? f.alt : null} placeholder={f.altAuto} unit="ft" step={500} onChange={v => set({ altitudes: { ...plan.altitudes, [f.n]: v ?? 0 } })} label={`Cruise altitude ${f.from.id} to ${f.to.id}`} /></div>
              </div>
              <div>
                <div className="text-sm font-medium text-fg">Winds at cruise from your briefing</div>
                <p className="mt-0.5 text-[13px] text-fg-3">Optional. Replaces the forecast for every row of this flight; blank uses the forecast shown.</p>
                <div className="mt-2 grid max-w-sm grid-cols-3 gap-2">
                  <OptNum value={fw.wdir ?? null} placeholder={fc?.dir != null ? deg3(fc.dir) : '—'} unit="°" step={10} onChange={v => putFw('wdir', v)} label="Wind direction from your briefing" />
                  <OptNum value={fw.wspd ?? null} placeholder={fc ? Math.round(fc.spd) : '—'} unit="kt" onChange={v => putFw('wspd', v)} label="Wind speed from your briefing" />
                  <OptNum value={fw.temp ?? null} placeholder={fc?.temp ?? '—'} unit="°C" onChange={v => putFw('temp', v)} label="Temperature from your briefing" />
                </div>
              </div>
            </div>
            <NavTable rows={f.rows} from={f.from} focusKey={focusKey} onFocus={onFocus} onDrop={id => set({ skipFixes: [...skip, id] })} />
          </div>
        )
      })}
      {skip.length > 0 && <p className="text-sm text-fg-3">Dropped checkpoints: <span className="num">{skip.join(', ')}</span> <button className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => set({ skipFixes: [] })}><RotateCcw className="size-3.5" />Restore</button></p>}

      {(d.crossings.length > 0 || (d.hazards.tfrs?.length ?? 0) > 0) && (
        <div className="flow [--flow-basis:min(100%,24rem)]">
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
      </>}
    </div>
  )
}

const ptName = (a: Airport) => a.label || a.icao || a.id

// The route as chips: departure → points flown over (tap a name to rename it,
// × to remove it) → arrival. Names carry to the navlog.
function RouteChips({ pts, edit }: { pts: Airport[]; edit: RouteEdit }) {
  const [editing, setEditing] = useState<number | null>(null)
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Route">
      {pts.map((a, i) => {
        const end = i === 0 || i === pts.length - 1
        const ident = a.icao || a.id
        return (
          <li key={`${a.id}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <ArrowRight className="size-3.5 text-fg-3" />}
            {editing === i ? (
              <input autoFocus defaultValue={a.label ?? ''} placeholder={`Name (blank: ${ident})`} maxLength={40} aria-label={`Name for ${ident}`}
                className="h-7 w-44 rounded-full bg-transparent px-2.5 text-sm text-fg ring-1 ring-inset ring-accent/60 outline-none"
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = a.label ?? ''; setEditing(null) } }}
                onBlur={e => { if ((e.currentTarget.value.trim()) !== (a.label ?? '')) edit.rename(i, e.currentTarget.value); setEditing(null) }} />
            ) : (
              <span className={cn('num inline-flex h-7 items-center gap-1 rounded-full pl-2.5 ring-1 ring-inset', end ? 'bg-accent-soft pr-2.5 font-medium text-accent ring-accent/30' : 'pr-1 text-fg ring-border')} title={a.label && a.label !== ident ? `${a.label} (${ident})` : a.name}>
                {end ? ptName(a) : <button className="inline-flex items-center gap-1 hover:text-accent" onClick={() => setEditing(i)} aria-label={`Rename ${ptName(a)}`}>{ptName(a)}<Pencil className="size-3 text-fg-3" /></button>}
                {end && <span className="text-xs font-normal opacity-80">{i === 0 ? 'dep' : 'arr'}</span>}
                {!end && <button className="grid size-5 place-items-center rounded-full text-fg-3 hover:bg-bad-soft hover:text-bad" aria-label={`Remove ${ptName(a)}`} onClick={() => edit.remove(i)}><X className="size-3.5" /></button>}
              </span>
            )}
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
        {errors.length > 0 && <p className="mt-1.5 text-xs text-fg-3">Unavailable: {errors.join('; ')}</p>}
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

const COLS: { k: string; h: string; tip: string; cls?: string }[] = [
  { k: 'alt', h: 'Alt', tip: 'Cruise altitude; ↑ climbing to it, ↓ descending to pattern altitude.' },
  { k: 'mc', h: 'MC', tip: 'Magnetic course: great-circle true course minus east variation (WMM 2025).' },
  { k: 'wind', h: 'Wind', tip: 'Forecast wind and temperature at the row\'s midpoint and altitude, for the time it\'s flown. The dot shows the source.' },
  { k: 'tas', h: 'TAS', tip: 'True airspeed: POH cruise table at this altitude, temperature and RPM; POH climb speed while climbing.', cls: 'max-md:hidden' },
  { k: 'mh', h: 'MH', tip: 'Magnetic heading: course corrected for wind (WCA), minus variation.' },
  { k: 'dist', h: 'nm', tip: 'Row distance, great circle.' },
  { k: 'gs', h: 'GS', tip: 'Ground speed from the wind triangle.' },
  { k: 'ete', h: 'ETE', tip: 'Distance ÷ ground speed; climb rows use the POH climb time.' },
  { k: 'eta', h: 'ETA', tip: 'Takeoff time plus the time of every row so far.', cls: 'max-lg:hidden' },
  { k: 'fuel', h: 'Fuel left', tip: 'Usable fuel minus start/taxi and every row so far, in gallons.' },
]
const SRC_TIP: Record<WindSrc, string> = { forecast: 'Forecast', stale: 'Old forecast copy', yours: 'Your briefing winds', row: 'Typed into this row', calm: 'No forecast: calm' }
const SRC_TIER = { forecast: 'primary', stale: 'backup', yours: 'yours', row: 'yours', calm: 'standin' } as const

// The NavLog as worked out: one row per point, every computed column, each row
// selectable to show its workings in the sidebar.
function NavTable({ rows, from, focusKey, onFocus, onDrop }: { rows: Derived['navlog']; from: Airport; focusKey: string | null; onFocus?: (key: string) => void; onDrop: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="num w-full text-sm text-fg-2 [&_td+td]:pl-3 [&_td]:whitespace-nowrap [&_th+th]:pl-3 [&_th]:whitespace-nowrap">
        <thead><tr className="text-left text-xs text-fg-3">
          <th className="pb-1.5 font-medium">Point</th>
          {COLS.map(c => (
            <th key={c.k} className={cn('pb-1.5 text-right font-medium', c.cls)}>
              <Tooltip content={<span className="block text-[13px] leading-snug">{c.tip}</span>}><span tabIndex={0} className="cursor-help underline decoration-border-strong decoration-dotted underline-offset-4">{c.h}</span></Tooltip>
            </th>
          ))}
          <th className="w-7 pb-1.5" />
        </tr></thead>
        <tbody>
          <tr className="border-t border-border">
            <td className="py-2 font-medium text-fg">{from.label || from.icao || from.id}<div className="font-sans text-xs font-normal text-fg-3">Depart · {Math.round(from.elev).toLocaleString()} ft</div></td>
            <td colSpan={COLS.length + 1} />
          </tr>
          {rows.map(r => {
            const on = focusKey === r.key
            const w = r.wind
            return (
              <tr key={r.key} onClick={() => onFocus?.(r.key)} aria-selected={on}
                className={cn('cursor-pointer border-t border-border transition-colors', on ? 'bg-accent-soft' : 'hover:bg-hover')}>
                <td className="py-2">
                  <button onClick={e => { e.stopPropagation(); onFocus?.(r.key) }} className={cn('text-left font-medium outline-none focus-visible:underline', on ? 'text-accent' : 'text-fg')}>{r.to.label}</button>
                  <div className="font-sans text-xs font-normal text-fg-3">{fixType(r.to)}{r.to.freq ? <span className="num"> · {r.to.freq}</span> : null}</div>
                </td>
                <td className="py-2 text-right">{r.alt}</td>
                <td className="py-2 text-right">{deg3(r.mc)}°</td>
                <td className="py-2 text-right">
                  <span className="inline-flex items-center justify-end gap-1.5" title={SRC_TIP[r.windSrc]}>
                    <Dot color={TIER_COLOR[SRC_TIER[r.windSrc]]} />
                    {w && w.spd ? `${w.dir == null ? 'VRB' : deg3(w.dir)}/${Math.round(w.spd)}` : 'Calm'}
                  </span>
                  <div className="text-xs text-fg-3">{Math.round(r.oat)} °C</div>
                </td>
                <td className="py-2 text-right max-md:hidden">{Math.round(r.tas)}</td>
                <td className="py-2 text-right font-medium text-fg">{deg3(r.mh)}°<div className="text-xs font-normal text-fg-3">{r.wca >= 0 ? '+' : '−'}{Math.abs(Math.round(r.wca))}° WCA</div></td>
                <td className="py-2 text-right">{r.distNm.toFixed(1)}</td>
                <td className="py-2 text-right">{Math.round(r.gs)}</td>
                <td className="py-2 text-right">{r.eteMin.toFixed(1)}</td>
                <td className="py-2 text-right max-lg:hidden">{fmtTime(r.eta)}</td>
                <td className="py-2 text-right">{r.fuelRem.toFixed(1)}</td>
                <td className="py-2 text-right">{r.to.kind === 'checkpoint' && <button className="text-fg-3 hover:text-bad" aria-label={`Drop ${r.to.label}`} title="Drop this checkpoint" onClick={e => { e.stopPropagation(); onDrop(r.to.id) }}><X className="size-4" /></button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

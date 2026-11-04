import { useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, Plus, RotateCcw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { titleCase } from '@/lib/format'
import { hemispheric } from './calc'
import { useAirportSearch, useNearby } from './api'
import type { Airport, Derived, Plan } from './model'
import { isWaypoint } from './model'
import { PlannerMap, type MapNotams, type MapRadar } from './PlannerMap'
import { KV, NumField, SubHead, Synced, fmtTime } from './ui'

const FREQ_LABEL: Record<string, string> = { 'LCL/P': 'Tower', 'LCL/S': 'Tower (sec.)', 'GND/P': 'Ground', 'CD/P': 'Clearance', ATIS: 'ATIS', 'D-ATIS': 'D-ATIS', CTAF: 'CTAF', UNICOM: 'UNICOM', 'APCH/P': 'Approach', 'APCH/P DEP/P': 'Approach/Departure', 'APCH/P DEP/P IC': 'Approach/Departure', 'CLASS C': 'Class C', 'CLASS B': 'Class B' }
export const freqLabel = (u: string) => FREQ_LABEL[u] || u

export function TripSection({ plan, set, resolve, d, weather, airspace, cycle, radar, notams }: {
  plan: Plan; set: (p: Partial<Plan>) => void; resolve: (token: string) => Airport | undefined; d: Derived; weather: import('./model').WeatherBundle | null; airspace: unknown; cycle: string | null
  radar?: MapRadar | null; notams?: MapNotams[]
}) {
  const byId = resolve
  const route = plan.route.map(byId).filter(Boolean) as Airport[]
  const airportsOnly = route.filter(a => !isWaypoint(a))
  const dest = route.length >= 2 ? route[route.length - 1] : null
  const alternate = plan.alternate ? byId(plan.alternate) ?? null : null
  const move = (i: number, by: number) => { const r = [...plan.route]; const [x] = r.splice(i, 1); r.splice(i + by, 0, x); set({ route: r }) }
  const firstMc = d.legs[0]?.mc
  const hemi = firstMc != null ? hemispheric(firstMc, plan.cruiseAlt, Math.max(...airportsOnly.map(a => a.elev), 0)) : null

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-5">
        <div className="space-y-5 xl:col-span-2">
          <div>
            <SubHead>Route</SubHead>
            <ol className="space-y-1.5">
              {plan.route.map((id, i) => {
                const a = byId(id)
                const wp = !!a && isWaypoint(a)
                const overfly = id.endsWith('*') || wp, middle = i > 0 && i < plan.route.length - 1
                const role = i === 0 ? 'Departure' : i === plan.route.length - 1 ? 'Destination' : overfly ? 'Fly over' : 'Land'
                return (
                  <li key={`${id}-${i}`} className="flex items-center gap-2 rounded-lg px-3 py-2 ring-1 ring-inset ring-border">
                    <span className="num w-24 shrink-0 truncate font-medium text-fg">{a?.icao || id.replace(/\*$/, '')}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg-3">{a ? (wp ? a.name : titleCase(a.name)) : 'Not found'}{wp && a?.frequencies[0] && <span className="num ml-1">{a.frequencies[0].freq}</span>}{!middle && <span className="ml-2 text-xs">{role}</span>}</span>
                    {middle && wp && <span className="h-7 shrink-0 rounded-full px-2.5 text-xs leading-7 text-fg-3 ring-1 ring-inset ring-border">{a?.navType === 'VFR-WP' ? 'VFR waypoint' : a?.kind === 'gps' ? 'GPS' : a?.navType || 'Waypoint'}</span>}
                    {middle && !wp && <button onClick={() => set({ route: plan.route.map((x, k) => (k === i ? (overfly ? x.replace(/\*$/, '') : `${x}*`) : x)) })} className={cn('h-7 shrink-0 rounded-full px-2.5 text-xs ring-1 ring-inset', overfly ? 'text-fg-2 ring-border' : 'bg-accent-soft text-accent ring-accent/30')} title="Land here, or use it as a checkpoint">{overfly ? 'Fly over' : 'Land'}</button>}
                    <Button size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp /></Button>
                    <Button size="icon-sm" variant="ghost" disabled={i === plan.route.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown /></Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => set({ route: plan.route.filter((_, k) => k !== i) })} aria-label="Remove"><X /></Button>
                  </li>
                )
              })}
            </ol>
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <AirportPicker onPick={id => set({ route: [...plan.route, id] })} onWaypoint={t => set({ route: plan.route.length >= 2 ? [...plan.route.slice(0, -1), t, plan.route.at(-1)!] : [...plan.route, t] })}
                placeholder={plan.route.length ? 'Add airport, waypoint or coordinates' : 'Departure airport'} />
              {plan.route.length >= 2 && plan.route[0] !== plan.route.at(-1) && (
                <Button variant="ghost" size="md" onClick={() => set({ route: [...plan.route, plan.route[0]] })}><RotateCcw />Return to {plan.route[0]}</Button>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm text-fg-2">Departure (local)</span>
              <Input type="datetime-local" value={plan.departLocal} onChange={e => set({ departLocal: e.target.value })} className="num" />
              {d.departAt && <span className="mt-1 block text-xs text-fg-3">{d.departAt.toISOString().slice(11, 16)}Z · {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>}
            </label>
            <NumField label="Minutes on the ground at each stop" value={plan.stopMinutes} onChange={v => set({ stopMinutes: v })} unit="min" min={0} step={5} />
            <NumField label="Cruise altitude" value={plan.cruiseAlt} onChange={v => set({ cruiseAlt: v })} unit="ft MSL" step={500} min={1000}
              hint={hemi?.applies ? (hemi.ok ? `Matches §91.159 for a ${Math.round(firstMc!)}° magnetic course` : `§91.159: ${hemi.suggest?.toLocaleString()} ft for a ${Math.round(firstMc!)}° magnetic course`) : 'Hemispheric rule applies above 3,000 ft AGL'} />
            <label className="block">
              <span className="mb-1 block text-sm text-fg-2">Cruise power</span>
              <Select value={plan.rpm} onChange={e => set({ rpm: Number(e.target.value) })} className="num">
                {[2600, 2500, 2400, 2300, 2200].map(r => <option key={r} value={r}>{r} RPM</option>)}
              </Select>
              <span className="mt-1 block text-xs text-fg-3">POH Fig. 5-8 · ≤75 % power recommended</span>
            </label>
          </div>

          <Alternate dest={dest} value={plan.alternate} onChange={v => set({ alternate: v })} wxCats={new Map(d.wx.map(w => [w.airport.id, w.category]))} />
        </div>
        <PlannerMap className="h-[26rem] xl:col-span-3 xl:h-auto xl:min-h-[30rem]" route={route} alternate={alternate} weather={weather} d={d} airspace={airspace} radar={radar} notams={notams} />
      </div>

      {(route.length > 0 || alternate) && (
        <div>
          <SubHead right={<Synced at={cycle ?? undefined} label="FAA NASR cycle" source="Chart Supplement data" />}>Airports</SubHead>
          <div className="grid gap-4 2xl:grid-cols-2 3xl:grid-cols-3">
            {[...airportsOnly.filter((a, i, arr) => arr.findIndex(b => b.id === a.id) === i), ...(alternate && !route.includes(alternate) ? [alternate] : [])].map(a => (
              <AirportCard key={a.id} a={a} role={a === alternate ? 'Alternate' : a === route[0] ? 'Departure' : a === dest ? 'Destination' : 'Stop'} eta={d.wx.find(w => w.airport.id === a.id)?.at} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function AirportPicker({ onPick, onWaypoint, placeholder }: { onPick: (id: string) => void; onWaypoint: (token: string) => void; placeholder: string }) {
  const [q, setQ] = useState('')
  const { data = [] } = useAirportSearch(q)
  const pick = (id: string) => { onPick(id); setQ('') }
  // Anything that isn't a search hit (navaid, fix, VP waypoint, radial/DME, coordinates) goes in as a waypoint.
  const raw = q.trim().toUpperCase()
  const looksLikePoint = /^[A-Z]{2,5}$|^[A-Z]{2,3}\d{6}$|\/|^\d{2,6}(\.\d+)?[NS]/.test(raw)
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-fg-3" />
      <Input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} className="pl-8"
        onKeyDown={e => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          const exact = data.find(a => a.icao === raw || a.id === raw)
          if (exact || (data[0] && !looksLikePoint)) pick((exact ?? data[0]).icao || (exact ?? data[0]).id)
          else if (raw) { onWaypoint(raw); setQ('') }
        }} />
      {looksLikePoint && raw && <button className="mt-1 text-xs text-accent hover:underline" onClick={() => { onWaypoint(raw); setQ('') }}>Add {raw} as a waypoint</button>}
      {q.trim().length >= 2 && data.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg bg-card py-1 shadow-lg ring-1 ring-border">
          {data.slice(0, 10).map(a => (
            <li key={a.id}><button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover" onClick={() => pick(a.icao || a.id)}>
              <span className="num w-12 shrink-0 font-medium">{a.icao || a.id}</span><span className="truncate text-fg-2">{titleCase(a.name)}</span><span className="ml-auto shrink-0 text-xs text-fg-3">{titleCase(a.city)}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Alternate({ dest, value, onChange, wxCats }: { dest: Airport | null; value: string | null; onChange: (v: string | null) => void; wxCats: Map<string, string | null> }) {
  const { data = [] } = useNearby(dest ? { lat: dest.lat, lon: dest.lon } : null)
  if (!dest) return null
  const list = data.filter(a => a.id !== dest.id).slice(0, 8)
  return (
    <div>
      <SubHead right={<span className="text-xs text-fg-3">Public, runway long enough for a 172, within 40 nm of {dest.icao || dest.id}</span>}>Alternate</SubHead>
      <div className="flex flex-wrap gap-1.5">
        {list.map(a => {
          const id = a.icao || a.id, sel = value === id
          return (
            <button key={a.id} onClick={() => onChange(sel ? null : id)} aria-pressed={sel}
              className={cn('press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm ring-1 ring-inset', sel ? 'bg-accent-soft text-accent ring-accent/40' : 'text-fg-2 ring-border hover:bg-hover')}>
              <span className="num font-medium">{id}</span><span className="text-fg-3">{a.distNm} nm</span>{a.towered && <span className="text-xs text-fg-3">TWR</span>}
              {sel && wxCats.get(a.id) && <span className="text-xs">· {wxCats.get(a.id)}</span>}
            </button>
          )
        })}
        {!list.length && <span className="text-sm text-fg-3">Looking for nearby airports…</span>}
      </div>
    </div>
  )
}

export function AirportCard({ a, role, eta }: { a: Airport; role: string; eta?: Date }) {
  const [more, setMore] = useState(false)
  const id = a.icao || a.id
  const tower = a.towered ? `Towered${a.towerHrs ? ` ${a.towerHrs} local` : ''}` : 'Non-towered'
  const tpa = Math.round((a.elev + (a.tpaAgl || 1000)) / 10) * 10
  const freqs = [...a.frequencies, ...(a.approach?.frequencies.map(f => ({ ...f, sector: [f.sector, `via ${a.approach!.via}`].filter(Boolean).join(' · ') })) ?? [])]
  const order = ['ATIS', 'D-ATIS', 'CD/P', 'GND/P', 'LCL/P', 'LCL/S', 'CTAF', 'UNICOM', 'APCH/P', 'APCH/P DEP/P', 'APCH/P DEP/P IC', 'CLASS C', 'CLASS B']
  const sorted = [...freqs].sort((x, y) => order.indexOf(x.use) - order.indexOf(y.use))
  return (
    <div className="rounded-lg p-4 ring-1 ring-inset ring-border">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2"><span className="num text-lg font-medium text-fg">{id}</span><span className="text-sm text-fg-3">{role}</span></div>
          <div className="text-sm text-fg-2">{titleCase(a.name)} · {titleCase(a.city)}, {a.state}</div>
        </div>
        <div className="flex gap-1">
          {[['AirNav', `https://www.airnav.com/airport/${id}`], ['SkyVector', `https://skyvector.com/airport/${a.id}`]].map(([l, h]) => (
            <Button key={l} asChild size="sm" variant="ghost"><a href={h} target="_blank" rel="noopener noreferrer">{l}<ExternalLink /></a></Button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone={a.towered ? 'accent' : 'neutral'}>{tower}</Badge>
        {a.airspace?.B && <Badge tone="accent">Class B</Badge>}{a.airspace?.C && <Badge tone="accent">Class C</Badge>}{a.airspace?.D && <Badge>Class D</Badge>}{a.airspace?.E && <Badge>Class E surface</Badge>}
        {a.use !== 'PU' && <Badge tone="warn">Private use</Badge>}
        {a.segCircle && <Badge>Segmented circle</Badge>}
        {eta && <Badge tone="outline">ETA {fmtTime(eta)}</Badge>}
      </div>
      <KV className="mt-3" items={[
        ['Elevation', <span className="num">{Math.round(a.elev).toLocaleString()} ft</span>],
        ['Pattern altitude', <span className="num">{tpa.toLocaleString()} ft MSL{a.tpaAgl ? '' : ' (1,000 ft AGL, not published)'}</span>],
        ['Magnetic variation', <span className="num">{Math.abs(a.magVar)}° {a.magVar >= 0 ? 'E' : 'W'}</span>],
        ['Weather', a.wx ? <span>{a.wx.type} {a.wx.id !== a.id ? `at ${a.wx.id} (${a.wx.distNm} nm)` : ''} {a.wx.freq && <span className="num">{a.wx.freq}</span>} {a.wx.phone && <a className="num text-accent hover:underline" href={`tel:${a.wx.phone}`}>{a.wx.phone}</a>}</span> : 'No AWOS/ASOS within 30 nm'],
        ['Airspace hours', a.airspace?.hrs],
        ['Lighting', a.lights],
        ['Sun', a.sun ? <span className="num">Rise {fmtTime(new Date(a.sun.rise))} · set {fmtTime(new Date(a.sun.set))} · civil dusk {fmtTime(new Date(a.sun.civilDusk))}</span> : null],
        ['Flight service', <span><span className="num">122.2</span> · <a className="num text-accent hover:underline" href="tel:18009927433">1-800-WX-BRIEF</a></span>],
      ]} />
      <div className="mt-3 grid gap-x-6 text-sm sm:grid-cols-2">
        {sorted.map((f, i) => (
          <div key={i} className="flex min-w-0 items-baseline gap-2 border-b border-border py-1"><span className="shrink-0 text-fg-3">{freqLabel(f.use)}</span><span className="num ml-auto text-fg">{f.freq}</span>{f.sector && <span className="w-28 shrink-0 truncate text-right text-xs text-fg-3" title={f.sector}>{f.sector}</span>}</div>
        ))}
      </div>
      <table className="mt-3 w-full text-sm">
        <thead><tr className="text-left text-xs text-fg-3"><th className="pb-1 font-medium">Runway</th><th className="pb-1 font-medium">Size</th><th className="pb-1 font-medium">Surface</th><th className="pb-1 font-medium">Ends</th></tr></thead>
        <tbody>{a.runways.map(r => (
          <tr key={r.id} className="border-t border-border align-top">
            <td className="num py-1.5 font-medium">{r.id}</td>
            <td className="num py-1.5 text-fg-2">{r.len.toLocaleString()} × {r.wid ?? '—'}</td>
            <td className="py-1.5 text-fg-2">{r.surface}{r.cond ? ` · ${titleCase(r.cond)}` : ''}{r.lights ? ` · ${r.lights} lights` : ''}</td>
            <td className="py-1.5 text-xs text-fg-3">{r.ends.map(e => `${e.id}${e.right ? ' RP' : ''}${e.displaced ? ` · thr −${e.displaced}` : ''}${e.vgsi ? ` · ${e.vgsi}` : ''}`).join(' / ')}</td>
          </tr>
        ))}</tbody>
      </table>
      {a.remarks.length > 0 && (
        <div className="mt-3">
          <button className="text-sm text-accent hover:underline" onClick={() => setMore(m => !m)}>{more ? 'Hide' : 'Show'} Chart Supplement remarks ({a.remarks.length})</button>
          {more && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-2">{a.remarks.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </div>
      )}
    </div>
  )
}

export function AddFirst() {
  return <span className="inline-flex items-center gap-1 text-fg-3"><Plus className="size-4" />Add airports to start</span>
}

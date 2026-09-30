import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, CalendarClock, CloudSun, Layers, MoreHorizontal, Pause, Pencil, Plane, Play, SkipBack, SkipForward, Trash2, User } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton, Switch } from '@/components/ui/misc'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { Stat, DL } from '@/components/data/stat'
import { MapView, fitTo, mapColor, maplibregl } from '@/components/data/MapView'
import { useFlights, useHistoricMetar, useNiceAir, useRegistry, useTrack, useTrackStats } from '@/lib/queries'
import { get } from '@/lib/api'
import { calDate, hours } from '@/lib/format'
import { route, trainingLabel, isSolo } from '@/lib/flying'
import { num, cn } from '@/lib/utils'
import type { Airport, Flight, TrackPoint } from '@/lib/types'
import type { FeatureCollection } from 'geojson'
import { FlightFormDialog } from './FlightForm'
import { useDeleteFlight } from './LogbookPage'

const utc = (ts: string | number, sec = false) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), hour12: false, timeZone: 'UTC' }) + 'Z'
const local = (ts: string | number) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const cssVar = (n: string) => mapColor(n)

export default function FlightPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { data: flights, isLoading } = useFlights()
  const f = flights?.find(x => String(x.id) === id)
  const track = useTrack(f?.id, !!f?.has_track)
  const remove = useDeleteFlight()
  const editOpen = params.get('edit') === '1'
  const setEdit = (o: boolean) => setParams(p => { if (o) p.set('edit', '1'); else p.delete('edit'); return p }, { replace: true })

  const pts = useMemo(() => (track.data || []).filter(p => p.lat != null && p.lon != null), [track.data])
  const [idx, setIdx] = useState(0)
  useEffect(() => setIdx(0), [id])

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-96" /><Skeleton className="h-[520px]" /></div>
  if (!f) return <EmptyState icon={Plane} title="Flight not found" className="py-24" action={<Button asChild><Link to="/flying">Back to logbook</Link></Button>} />

  const stops = [f.departure, ...(f.via_airports || []), f.arrival].filter(Boolean) as Airport[]
  const stats: [string, string | null, string?][] = [
    ['Total', hours(f.total_duration), 'h'], ['Dual received', hours(f.dual_received), 'h'], ['Dual given', hours(f.dual_given), 'h'], ['PIC', hours(f.pic), 'h'],
    ['Solo', hours(f.solo), 'h'], ['Cross-country', hours(f.cross_country), 'h'], ['Night', hours(f.night), 'h'],
    ['Actual instrument', hours(f.actual_instrument), 'h'], ['Simulated instrument', hours(f.simulated_instrument), 'h'],
    ['Take-offs', f.takeoffs ? String(f.takeoffs) : null], ['Landings', f.landings ? String(f.landings) : null],
    ['Night landings', f.night_landings_full_stop || f.night_landings ? String(f.night_landings_full_stop || f.night_landings) : null],
    ['Holds', f.holds ? String(f.holds) : null], ['Distance', num(f.distance_nm) ? String(Math.round(num(f.distance_nm))) : null, 'nm'],
  ]

  return (
    <div>
      <Link to="/flying" className="mb-3 inline-flex items-center gap-1 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="size-4" />Logbook</Link>
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="accent" size="md">{trainingLabel(f.training_type)}</Badge>
            {isSolo(f) && <Badge size="md">Solo</Badge>}
            {f.flight_review && <Badge tone="accent" size="md">Flight review</Badge>}
            {f.checkride && <Badge tone="good" size="md">Checkride</Badge>}
            {f.ipc && <Badge tone="accent" size="md">IPC</Badge>}
          </div>
          <h1 className="num text-3xl font-semibold tracking-tight">{route(f).join(' → ')}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-3">
            <span>{calDate(f.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
            <span>·</span><span><span className="num text-fg-2">{f.aircraft?.tail_number}</span> {f.aircraft?.make} {f.aircraft?.model}</span>
            {f.instructor_name && <><span>·</span><span className="inline-flex items-center gap-1"><User className="size-3.5" />{f.instructor_name}</span></>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setEdit(true)}><Pencil />Edit</Button>
          <Menu>
            <MenuTrigger asChild><Button size="icon" aria-label="More actions"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => setEdit(true)}><Pencil />Edit flight</MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={async () => { if (await remove(f)) navigate('/flying') }}><Trash2 />Delete flight</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      <Card className="mb-5">
        <CardBody className="flex flex-wrap gap-x-8 gap-y-4 pt-4">
          {stats.filter(([, v]) => v).map(([l, v, u]) => <Stat key={l} label={l} value={v} unit={u} size="sm" />)}
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          <Card className="overflow-hidden">
            <FlightMap stops={stops} pts={pts} idx={idx} loading={f.has_track && track.isLoading} />
            {pts.length >= 2 && <TrackPlayer pts={pts} idx={idx} setIdx={setIdx} />}
            {!f.has_track && <div className="border-t border-border px-5 py-3 text-sm text-fg-3">No GPS track for this flight — the map shows the planned route between airports.</div>}
          </Card>
          <TrackStatsCard id={f.id} enabled={f.has_track} source={f.track_source} />
          <Notes f={f} />
        </div>
        <div className="space-y-5 xl:col-span-4">
          <AircraftCard f={f} />
          <ScheduleCard f={f} />
          <WeatherCard f={f} stops={stops} pts={pts} />
        </div>
      </div>
      <FlightFormDialog open={editOpen} onOpenChange={setEdit} flight={editOpen ? f : null} />
    </div>
  )
}

// ── Map ──────────────────────────────────────────────────────────────────────
const PLANE_SVG = (color: string) => `<svg viewBox="0 0 32 32" width="30" height="30"><g transform="translate(16 16)" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))"><path d="M0-13c1 2 1.7 7 1.7 13S1 10 0 13c-1-3-1.7-7-1.7-13S-1-11 0-13Z" fill="${color}" stroke="#fff" stroke-width=".8"/><path d="M-1.5 0-14 6-13.4 7.6-1.5 2.4Z M1.5 0 14 6 13.4 7.6 1.5 2.4Z M-1.2 8.6-7 11.6-6.7 12.8-1.2 10.2Z M1.2 8.6 7 11.6 6.7 12.8 1.2 10.2Z" fill="${color}" stroke="#fff" stroke-width=".6"/></g></svg>`

function FlightMap({ stops, pts, idx, loading }: { stops: Airport[]; pts: TrackPoint[]; idx: number; loading: boolean }) {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const planeRef = useRef<{ marker: maplibregl.Marker; el: HTMLDivElement } | null>(null)
  const [layers, setLayers] = useState({ satellite: false, airspace: false, airports: false })
  const [mapKey, setMapKey] = useState(0)

  // Move the aircraft with the scrubber.
  useEffect(() => {
    const p = pts[idx], pl = planeRef.current
    if (!p || !pl) return
    pl.marker.setLngLat([p.lon, p.lat])
    pl.el.style.transform = `rotate(${p.track_deg ?? 0}deg)`
  }, [idx, pts])

  const applyLayers = useCallback(async (map: maplibregl.Map, l: typeof layers) => {
    const firstOverlay = ['aspc-b-fill', 'us-airports', 'route-casing'].find(id => map.getLayer(id))
    if (l.satellite && !map.getLayer('sat')) {
      if (!map.getSource('sat')) map.addSource('sat', { type: 'raster', tiles: ['https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri' })
      map.addLayer({ id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-opacity': 0.9 } }, firstOverlay)
    } else if (!l.satellite && map.getLayer('sat')) map.removeLayer('sat')

    const aspc = ['aspc-b-fill', 'aspc-b-line', 'aspc-c-fill', 'aspc-c-line', 'aspc-d-fill', 'aspc-d-line']
    if (l.airspace && !map.getSource('airspace')) {
      const fc = await get<FeatureCollection>('/api/external/faa-airspace').catch(() => null)
      if (fc && mapRef.current === map && !map.getSource('airspace')) {
        map.addSource('airspace', { type: 'geojson', data: fc })
        const before = map.getLayer('route-casing') ? 'route-casing' : undefined
        const add = (cls: string, color: string, fillOp: number, dash?: number[]) => {
          map.addLayer({ id: `aspc-${cls.toLowerCase()}-fill`, type: 'fill', source: 'airspace', filter: ['==', ['get', 'CLASS'], cls], paint: { 'fill-color': color, 'fill-opacity': fillOp } }, before)
          map.addLayer({ id: `aspc-${cls.toLowerCase()}-line`, type: 'line', source: 'airspace', filter: ['==', ['get', 'CLASS'], cls], paint: { 'line-color': color, 'line-width': 1.2, 'line-opacity': 0.8, ...(dash ? { 'line-dasharray': dash } : {}) } }, before)
        }
        add('B', '#2563eb', 0.06); add('C', '#c026d3', 0.05); add('D', '#2563eb', 0.03, [4, 3])
      }
    }
    for (const id of aspc) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', l.airspace ? 'visible' : 'none')

    if (l.airports && !map.getSource('us-airports')) {
      const fc = await get<FeatureCollection>('/api/external/us-airports').catch(() => null)
      if (fc && mapRef.current === map && !map.getSource('us-airports')) {
        map.addSource('us-airports', { type: 'geojson', data: fc })
        map.addLayer({ id: 'us-airports', type: 'circle', source: 'us-airports', minzoom: 7, paint: { 'circle-radius': 3, 'circle-color': cssVar('--fg-3'), 'circle-stroke-color': cssVar('--card'), 'circle-stroke-width': 1 } }, map.getLayer('route-casing') ? 'route-casing' : undefined)
      }
    }
    if (map.getLayer('us-airports')) map.setLayoutProperty('us-airports', 'visibility', l.airports ? 'visible' : 'none')
  }, [])

  useEffect(() => { if (mapRef.current?.isStyleLoaded()) applyLayers(mapRef.current, layers) }, [layers, applyLayers])

  if (loading) return <Skeleton className="h-[520px] rounded-none" />
  const coords: [number, number][] = pts.length >= 2 ? pts.map(p => [p.lon, p.lat]) : stops.filter(s => s.lon != null).map(s => [s.lon!, s.lat!])

  return (
    <div className="relative">
      <MapView key={mapKey} className="h-[520px]" fullscreen center={coords[0]} zoom={9} onLoad={map => {
        mapRef.current = map
        const accent = cssVar('--accent')
        if (coords.length >= 2) {
          map.addSource('route', { type: 'geojson', lineMetrics: true, data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } })
          map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.85 } })
          map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 2.5, ...(pts.length >= 2 ? { 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, accent, 1, cssVar('--c5')] } : { 'line-color': accent, 'line-dasharray': [2, 2] }) } })
        }
        const seen = new Set<string>()
        for (const a of stops) {
          if (a.lon == null || seen.has(a.icao)) continue
          seen.add(a.icao)
          const el = document.createElement('div')
          el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;cursor:default"><span style="width:12px;height:12px;border-radius:50%;background:${accent};border:2.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span><span style="font:600 11px var(--font-mono);color:var(--fg);background:var(--card);border:1px solid var(--border);border-radius:4px;padding:0 4px">${a.icao}</span></div>`
          new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, -6] }).setLngLat([a.lon, a.lat!]).setPopup(new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(`<b style="font-family:var(--font-mono)">${a.icao}</b><div style="font-size:12px;color:var(--fg-3)">${a.name || ''}${a.city ? ` · ${a.city}` : ''}</div>${a.elevation_ft != null ? `<div style="font-size:12px">${a.elevation_ft} ft elevation</div>` : ''}`)).addTo(map)
        }
        if (pts.length >= 2) {
          const outer = document.createElement('div')
          const el = document.createElement('div')
          el.style.cssText = 'width:30px;height:30px;transform-origin:center;will-change:transform'
          el.innerHTML = PLANE_SVG(cssVar('--fg'))
          outer.appendChild(el)
          const marker = new maplibregl.Marker({ element: outer, anchor: 'center' }).setLngLat(coords[0]).addTo(map)
          el.style.transform = `rotate(${pts[0].track_deg ?? 0}deg)`
          planeRef.current = { marker, el }
        }
        fitTo(map, coords, 60, 13)
        applyLayers(map, layers)
        return () => { mapRef.current = null; planeRef.current = null }
      }} />
      <div className="absolute left-3 top-3 z-10">
        <Popover>
          <PopoverTrigger asChild><Button size="sm" className="shadow-pop"><Layers />Layers</Button></PopoverTrigger>
          <PopoverContent className="w-60 space-y-3">
            {([['satellite', 'Satellite imagery'], ['airspace', 'Class B, C, D airspace'], ['airports', 'All US airports']] as const).map(([k, l]) => (
              <label key={k} className="flex items-center justify-between gap-3 text-sm">{l}<Switch checked={layers[k]} onCheckedChange={c => setLayers(s => ({ ...s, [k]: c }))} /></label>
            ))}
            {layers.airspace && <div className="flex gap-3 border-t border-border pt-2 text-xs text-fg-3"><span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#2563eb]" />B</span><span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#c026d3]" />C</span><span className="flex items-center gap-1"><span className="h-0 w-3 border-t border-dashed border-[#2563eb]" />D</span></div>}
          </PopoverContent>
        </Popover>
      </div>
      <button className="sr-only" onClick={() => setMapKey(k => k + 1)}>Reset map</button>
    </div>
  )
}

// ── Track player: altitude profile + groundspeed, scrubbed or played ─────────
function TrackPlayer({ pts, idx, setIdx }: { pts: TrackPoint[]; idx: number; setIdx: (i: number | ((i: number) => number)) => void }) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const svgRef = useRef<SVGSVGElement>(null)
  const [w, setW] = useState(800)
  const n = pts.length

  useEffect(() => {
    const el = svgRef.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Real elapsed time drives playback: 1× replays the flight 60 times faster than it happened.
  const idxRef = useRef(idx)
  idxRef.current = idx
  useEffect(() => {
    if (!playing) return
    const t0 = +new Date(pts[0].ts)
    let clock = +new Date(pts[idxRef.current].ts) - t0
    let raf = 0, last = performance.now()
    const tick = (now: number) => {
      clock += (now - last) * 60 * speed
      last = now
      let j = idxRef.current
      while (j < n - 1 && +new Date(pts[j + 1].ts) - t0 <= clock) j++
      if (j !== idxRef.current) setIdx(j)
      if (j >= n - 1) { setPlaying(false); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, pts, n, setIdx])

  const H = 150, padL = 44, padR = 12, padT = 12, padB = 22
  const cw = Math.max(100, w - padL - padR), ch = H - padT - padB
  const alts = pts.map(p => p.altitude_ft ?? 0), gss = pts.map(p => p.groundspeed_kts ?? 0)
  const aMin = Math.min(...alts), aMax = Math.max(...alts, aMin + 1), gMax = Math.max(...gss, 1)
  const t0 = +new Date(pts[0].ts), t1 = +new Date(pts[n - 1].ts)
  const x = (i: number) => padL + ((+new Date(pts[i].ts) - t0) / (t1 - t0 || 1)) * cw
  const ya = (a: number) => padT + ch - ((a - aMin) / (aMax - aMin)) * ch
  const yg = (g: number) => padT + ch - (g / gMax) * ch
  const step = Math.max(1, Math.floor(n / 800))
  const altPath = useMemo(() => pts.filter((_, i) => i % step === 0 || i === n - 1).map((p, k, arr) => { const i = pts.indexOf(arr[k]); return `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${ya(p.altitude_ft ?? 0).toFixed(1)}` }).join(' '), [pts, w]) // eslint-disable-line react-hooks/exhaustive-deps
  const gsPath = useMemo(() => pts.filter((_, i) => i % step === 0 || i === n - 1).map((p, k, arr) => { const i = pts.indexOf(arr[k]); return `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${yg(p.groundspeed_kts ?? 0).toFixed(1)}` }).join(' '), [pts, w]) // eslint-disable-line react-hooks/exhaustive-deps

  const fromPointer = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const t = t0 + Math.max(0, Math.min(1, (e.clientX - r.left - padL) / cw)) * (t1 - t0)
    let lo = 0, hi = n - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (+new Date(pts[m].ts) < t) lo = m + 1; else hi = m }
    setIdx(lo)
  }

  const p = pts[idx]
  const prev = pts[Math.max(0, idx - 1)]
  const dts = (+new Date(p.ts) - +new Date(prev.ts)) / 1000
  const vs = p.vertical_speed_fpm ?? (dts > 0 && p.altitude_ft != null && prev.altitude_ft != null ? ((p.altitude_ft - prev.altitude_ft) / dts) * 60 : null)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => aMin + (aMax - aMin) * f)

  return (
    <div className="border-t border-border">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Skip to start" onClick={() => { setPlaying(false); setIdx(0) }}><SkipBack /></Button>
          <Button variant="primary" size="icon-sm" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { if (idx >= n - 1) setIdx(0); setPlaying(pl => !pl) }}>{playing ? <Pause /> : <Play />}</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Skip to end" onClick={() => { setPlaying(false); setIdx(n - 1) }}><SkipForward /></Button>
          <div className="ml-1 flex rounded-md bg-sunken p-0.5 ring-1 ring-inset ring-border">
            {[1, 2, 4, 8].map(s => <button key={s} onClick={() => setSpeed(s)} className={cn('num h-6 rounded px-1.5 text-xs text-fg-3', speed === s && 'bg-card text-fg ring-1 ring-border')}>{s}×</button>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <Readout label="Time" value={`${utc(p.ts, true)}`} sub={local(p.ts)} />
          <Readout label="Altitude" value={p.altitude_ft != null ? `${Math.round(p.altitude_ft).toLocaleString()} ft` : '—'} />
          <Readout label="Ground speed" value={p.groundspeed_kts != null ? `${Math.round(p.groundspeed_kts)} kt` : '—'} />
          <Readout label="Track" value={p.track_deg != null ? `${String(Math.round(p.track_deg)).padStart(3, '0')}°` : '—'} />
          <Readout label="Vertical" value={vs != null && Math.abs(vs) > 50 ? `${vs > 0 ? '+' : '−'}${Math.round(Math.abs(vs) / 10) * 10} fpm` : 'Level'} />
        </div>
      </div>
      <div className="px-2 pb-2 pt-1">
        <svg ref={svgRef} width={w} height={H} className="block cursor-crosshair touch-none select-none" onPointerDown={e => { setPlaying(false); (e.target as Element).setPointerCapture?.(e.pointerId); fromPointer(e) }} onPointerMove={e => e.buttons && fromPointer(e)} role="slider" aria-label="Flight position" aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={idx} tabIndex={0}
          onKeyDown={e => { if (e.key === 'ArrowRight') setIdx(i => Math.min(n - 1, i + Math.max(1, Math.round(n / 100)))); if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - Math.max(1, Math.round(n / 100)))); if (e.key === ' ') { e.preventDefault(); setPlaying(pl => !pl) } }}>
          {ticks.map((t, i) => <g key={i}><line x1={padL} x2={padL + cw} y1={ya(t)} y2={ya(t)} stroke="var(--grid)" /><text x={padL - 6} y={ya(t) + 4} textAnchor="end" fontSize={11} fill="var(--axis)" className="num">{t >= 1000 ? `${(t / 1000).toFixed(1)}k` : Math.round(t)}</text></g>)}
          <path d={`${altPath} L${padL + cw} ${padT + ch} L${padL} ${padT + ch} Z`} fill="var(--accent)" fillOpacity={0.1} />
          <path d={gsPath} fill="none" stroke="var(--fg-3)" strokeWidth={1.25} strokeDasharray="3 3" />
          <path d={altPath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
          <rect x={padL} y={padT} width={Math.max(0, x(idx) - padL)} height={ch} fill="var(--fg)" fillOpacity={0.03} />
          <line x1={x(idx)} x2={x(idx)} y1={padT} y2={padT + ch} stroke="var(--fg)" strokeOpacity={0.5} />
          <circle cx={x(idx)} cy={ya(p.altitude_ft ?? 0)} r={5} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
          <text x={padL} y={H - 5} fontSize={11} fill="var(--axis)" className="num">{utc(pts[0].ts)}</text>
          <text x={padL + cw} y={H - 5} fontSize={11} fill="var(--axis)" textAnchor="end" className="num">{utc(pts[n - 1].ts)}</text>
        </svg>
        <div className="flex gap-4 px-2 text-xs text-fg-3"><span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-accent" />Altitude (ft)</span><span className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-fg-3" />Ground speed (scaled, peak {Math.round(gMax)} kt)</span></div>
      </div>
    </div>
  )
}

function Readout({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div><div className="text-xs text-fg-3">{label}</div><div className="num font-medium text-fg">{value}{sub && <span className="ml-1.5 font-normal text-fg-3">{sub}</span>}</div></div>
}

function TrackStatsCard({ id, enabled, source }: { id: number; enabled: boolean; source: string | null }) {
  const { data: s, isLoading } = useTrackStats(id, enabled)
  if (!enabled) return null
  if (isLoading) return <Skeleton className="h-24" />
  if (!s) return null
  const items: [string, string | null][] = [
    ['Peak altitude', s.max_altitude_ft ? `${s.max_altitude_ft.toLocaleString()} ft` : null],
    ['GPS distance', s.distance_nm ? `${s.distance_nm.toFixed(1)} nm` : null],
    ['Max ground speed', s.max_groundspeed_kts ? `${s.max_groundspeed_kts} kt` : null],
    ['Avg ground speed', s.avg_groundspeed_kts ? `${s.avg_groundspeed_kts} kt` : null],
    ['Best climb', s.max_climb_fpm && s.max_climb_fpm > 50 ? `+${s.max_climb_fpm.toLocaleString()} fpm` : null],
    ['Steepest descent', s.max_descent_fpm && s.max_descent_fpm < -50 ? `${s.max_descent_fpm.toLocaleString()} fpm` : null],
    ['Track points', s.track_points ? s.track_points.toLocaleString() : null],
  ]
  return (
    <Card>
      <CardHeader title="GPS track" description={source ? `Recorded by ${source === 'fr24' ? 'Flightradar24' : source === 'aeroapi' ? 'FlightAware' : source}` : undefined} />
      <CardBody className="grid grid-cols-2 gap-5 sm:grid-cols-4 lg:grid-cols-7">
        {items.filter(([, v]) => v).map(([l, v]) => <Stat key={l} label={l} value={v} size="sm" />)}
      </CardBody>
    </Card>
  )
}

function Notes({ f }: { f: Flight }) {
  if (!f.remarks && !f.instructor_comments && !f.approaches?.length && !(f.hobbs_start && f.hobbs_end) && !(f.tach_start && f.tach_end)) return null
  return (
    <Card>
      <CardHeader title="Notes" />
      <CardBody className="space-y-4">
        {f.remarks && <div><div className="mb-1 text-sm font-medium text-fg-3">Remarks</div><p className="whitespace-pre-wrap text-base leading-relaxed">{f.remarks}</p></div>}
        {f.instructor_comments && <div><div className="mb-1 text-sm font-medium text-fg-3">Instructor comments</div><p className="whitespace-pre-wrap text-base leading-relaxed">{f.instructor_comments}</p></div>}
        {!!f.approaches?.length && <div><div className="mb-1.5 text-sm font-medium text-fg-3">Approaches</div><div className="flex flex-wrap gap-1.5">{f.approaches.map((a, i) => <Badge key={i} size="md">{a.approach_type}{a.runway ? ` Rwy ${a.runway}` : ''} <span className="num">{a.airport_icao}</span>{a.circle_to_land ? ' · circle' : ''}</Badge>)}</div></div>}
        <DL items={[
          ['Hobbs', f.hobbs_start && f.hobbs_end ? <span className="num">{f.hobbs_start} → {f.hobbs_end}</span> : null],
          ['Tach', f.tach_start && f.tach_end ? <span className="num">{f.tach_start} → {f.tach_end}</span> : null],
          ['Source', f.source && f.source !== 'manual' ? f.source : null],
        ]} />
      </CardBody>
    </Card>
  )
}

// ── Aircraft ─────────────────────────────────────────────────────────────────
function AircraftCard({ f }: { f: Flight }) {
  const ac = f.aircraft
  const { data: r, isLoading } = useRegistry(ac?.tail_number)
  const [broken, setBroken] = useState(false)
  if (!ac) return null
  const p = r?.performance
  const perf: [string, string | null][] = p ? [
    ['Cruise', p.cruise_ktas ? `${p.cruise_ktas} KTAS` : null], ['Range', p.range_nm ? `${p.range_nm} nm` : null], ['Ceiling', p.service_ceiling_ft ? `${p.service_ceiling_ft.toLocaleString()} ft` : null],
    ['MTOW', p.mtow_lbs ? `${p.mtow_lbs.toLocaleString()} lb` : null], ['Fuel', p.fuel_gal ? `${p.fuel_gal} gal` : null], ['Burn', p.fuel_burn_gph ? `${p.fuel_burn_gph} gph` : null],
  ] : []
  const vspeeds: [string, number | undefined][] = p ? [['Vs0', p.vs0_kts], ['Vs1', p.vs1_kts], ['Vx', p.vx_kts], ['Vy', p.vy_kts], ['Va', p.va_kts], ['Vno', p.vno_kts], ['Vne', p.vne_kts]] : []
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[16/9] bg-sunken">
        {r?.photo_url && !broken ? <img src={r.photo_url} alt={`${ac.tail_number}`} className="size-full object-cover" onError={() => setBroken(true)} /> : <div className="grid size-full place-items-center"><Plane className="size-10 text-fg-3" /></div>}
        {r?.owner && <span className="absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white">{r.owner}</span>}
      </div>
      <CardBody className="pt-4">
        <div className="num text-xl font-semibold">{ac.tail_number}</div>
        <div className="text-sm text-fg-3">{r?.make || ac.make} {r?.model || ac.model}{(r?.year || ac.year) ? ` · ${r?.year || ac.year}` : ''}</div>
        {isLoading ? <Skeleton className="mt-4 h-32" /> : <>
          <DL className="mt-3" items={[
            ['Engine', r?.engine_type || ac.engine_type ? `${r?.engine_type || ac.engine_type}${r?.engine_hp || ac.engine_hp ? ` · ${r?.engine_hp || ac.engine_hp} hp` : ''}` : null],
            ['Category', r?.category ? `${r.category}${r.aircraft_class ? ` · ${r.aircraft_class}` : ''}` : null],
            ['Gear', r?.gear_type ? r.gear_type.replace(/_/g, ' ') : null], ['Seats', r?.seats || ac.seats ? String(r?.seats || ac.seats) : null],
            ['Serial', r?.serial ? <span className="num">{r.serial}</span> : null], ['Mode S', r?.mode_s_hex ? <span className="num">{r.mode_s_hex.toUpperCase()}</span> : null],
            ['Registration', r?.status || null], ['Complex', r?.is_complex ? 'Yes' : null],
          ]} />
          {perf.some(([, v]) => v) && <>
            <div className="mb-2 mt-4 text-sm font-medium text-fg-2">Performance <span className="font-normal text-fg-3">· POH reference</span></div>
            <div className="grid grid-cols-3 gap-3">{perf.filter(([, v]) => v).map(([k, v]) => <div key={k}><div className="text-xs text-fg-3">{k}</div><div className="num text-sm">{v}</div></div>)}</div>
          </>}
          {vspeeds.some(([, v]) => v) && <div className="mt-4 flex flex-wrap gap-1.5">{vspeeds.filter(([, v]) => v).map(([k, v]) => <span key={k} className="rounded-md bg-sunken px-2 py-1 text-xs ring-1 ring-inset ring-border"><span className="text-fg-3">{k}</span> <span className="num font-medium">{v}</span></span>)}</div>}
        </>}
      </CardBody>
    </Card>
  )
}

// ── NICE AIR booking for this flight ─────────────────────────────────────────
function ScheduleCard({ f }: { f: Flight }) {
  const { data: schedules, isLoading } = useNiceAir()
  const tail = f.aircraft?.tail_number || ''
  const short = tail.replace(/^N/, '')
  const s = (schedules || []).filter(x => x.date_str === f.date.slice(0, 10) && x.tail?.replace(/^N/, '') === short && x.type !== 'cancelled')
    .sort((a, b) => (b.received || '').localeCompare(a.received || ''))[0]
  const clock = (v?: string) => (v || '').replace(/^\d+\/\d+\/\d+\s+/, '') || '—'
  return (
    <Card>
      <CardHeader icon={<CalendarClock />} title="NICE AIR booking" description={s ? undefined : 'From the flight school’s emails'} />
      <CardBody>
        {isLoading ? <Skeleton className="h-20" /> : !s ? <p className="text-sm text-fg-3">No booking on record for this flight.</p> : <>
          <DL items={[
            ['Instructor', s.cfi || null],
            ['Scheduled', <span className="num">{clock(s.start_local)} – {clock(s.end_local)}</span>],
            ['Block out', f.time_out ? <span className="num">{local(f.time_out)}</span> : null],
            ['Block in', f.time_in ? <span className="num">{local(f.time_in)}</span> : null],
          ]} />
          {s.type === 'changed' && <Badge tone="warn" className="mt-3">Schedule was changed</Badge>}
        </>}
      </CardBody>
    </Card>
  )
}

// ── METARs at each airport around the time of the flight ─────────────────────
function WeatherCard({ f, stops, pts }: { f: Flight; stops: Airport[]; pts: TrackPoint[] }) {
  const base = f.date.slice(0, 10)
  const dep = pts[0]?.ts || f.time_out || `${base}T19:00:00Z`
  const arr = pts[pts.length - 1]?.ts || f.time_in || `${base}T21:00:00Z`
  const legs = stops.map((a, i) => {
    const t = i === 0 ? dep : i === stops.length - 1 ? arr : new Date(+new Date(dep) + (+new Date(arr) - +new Date(dep)) * (i / (stops.length - 1))).toISOString()
    return { icao: a.icao, when: new Date(t).toISOString(), leg: i === 0 ? 'Departure' : i === stops.length - 1 ? 'Arrival' : 'Via' }
  })
  return (
    <Card>
      <CardHeader icon={<CloudSun />} title="Weather at the time" description="Nearest METAR to each leg" />
      <CardBody className="space-y-3">{legs.map((l, i) => <MetarRow key={i} {...l} />)}</CardBody>
    </Card>
  )
}

function MetarRow({ icao, when, leg }: { icao: string; when: string; leg: string }) {
  const { data, isLoading } = useHistoricMetar(icao, when)
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm"><span><span className="text-fg-3">{leg}</span> <span className="num font-medium">{icao}</span></span>{data?.valid && <span className="num text-xs text-fg-3">{utc(data.valid)}</span>}</div>
      {isLoading ? <Skeleton className="h-10" /> : data?.metar ? <code className="block break-words rounded-md bg-sunken px-2.5 py-2 font-mono text-xs leading-relaxed text-fg-2 ring-1 ring-inset ring-border">{data.metar}</code> : <p className="text-sm text-fg-3">No METAR available.</p>}
    </div>
  )
}

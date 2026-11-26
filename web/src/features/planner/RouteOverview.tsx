import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as maplibre from 'maplibre-gl'
import type * as maplibregl from 'maplibre-gl'
import { MapView, mapColor } from '@/components/data/MapView'
import { cn } from '@/lib/utils'
import { titleCase } from '@/lib/format'
import { isWaypoint, type Airport, type Derived, type Leg, type PerfAt, type WxAt } from './model'
import { arrivalProcedure, departureProcedure, tpaOf, type Procedure } from './procedures'
import { Cat, deg3, fmtMin, fmtTime } from './ui'
import { RunwayDiagram } from './RunwayDiagram'

// The whole flight on one map: departure, the airports and points flown over,
// the arrival and the alternate, all in view. Each leg carries its course and
// altitude; each airport its wind. The runway in use is drawn with how to fly
// it: the departure climb-out, and at the arrival the recommended pattern
// entry (AIM 4-3-3: a 45° entry to downwind, or a midfield crossing from the
// other side). Hover or tap an airport or a leg for the details.

type LL = { lat: number; lon: number }
const xy = (p: LL): [number, number] => [p.lon, p.lat]
const code = (a: Airport) => a.icao || a.id

interface Pt { a: Airport; role: 'Departure' | 'Arrival' | 'Flown over' | 'Waypoint' | 'Alternate'; wx: WxAt | null; perf: PerfAt | null; entry: Procedure | null; dep: Procedure | null }
type Hover = { kind: 'pt'; i: number; at: LL } | { kind: 'leg'; i: number; at: LL } | null

export function RouteOverview({ route, alternate, d, className }: { route: Airport[]; alternate: Airport | null; d: Derived; className?: string }) {
  const pts: Pt[] = useMemo(() => {
    const n = route.length
    const out: Pt[] = route.map((a, i) => {
      const role = i === 0 ? 'Departure' : i === n - 1 ? 'Arrival' : isWaypoint(a) ? 'Waypoint' : 'Flown over'
      const wx = d.wx.find(w => w.airport.id === a.id && (i === 0 ? w.role === 'departure' : i === n - 1 ? w.role === 'destination' : true)) ?? null
      const perf = i === 0 ? d.perf.find(p => p.airport.id === a.id && p.kind === 'takeoff') ?? null
        : i === n - 1 ? [...d.perf].reverse().find(p => p.airport.id === a.id && p.kind === 'landing' && p.wx.role !== 'alternate') ?? null : null
      // Leave toward the next waypoint; join from the previous one.
      const entry = i === n - 1 && n > 1 && perf?.runway ? arrivalProcedure(a, perf.runway, route[i - 1]) : null
      const dep = i === 0 && n > 1 && perf?.runway ? departureProcedure(a, perf.runway, route[1]) : null
      return { a, role, wx, perf, entry, dep }
    })
    if (alternate && !route.some(a => a.id === alternate.id)) {
      out.push({ a: alternate, role: 'Alternate', wx: d.wx.find(w => w.role === 'alternate') ?? null, perf: d.perf.find(p => p.wx.role === 'alternate') ?? null, entry: null, dep: null })
    }
    return out
  }, [route, alternate, d])
  const legs = d.legs

  // The drawn route: the en-route line runs from where the departure leaves the
  // pattern to where the arrival joins it; TOC and TOD sit on what's drawn.
  const geo = useMemo(() => {
    const dep = pts.find(p => p.role === 'Departure')?.dep, entry = pts.find(p => p.role === 'Arrival')?.entry
    const segs = legs.map((l, i) => [i === 0 && dep ? dep.join : l.from, i === legs.length - 1 && entry ? entry.join : l.to] as [LL, LL])
    const fl = d.flights[0], last = d.flights.at(-1)
    const climbNm = fl ? sumUntil(fl.rows, 'toc') : 0
    const descNm = last ? sumAfter(last.rows, 'tod') : 0
    const enroute = segs.length ? [segs[0][0], ...segs.map(s => s[1])] : []
    const toc = fl?.rows.some(r => r.to.kind === 'toc') && climbNm > 0 ? along([...(dep?.path.slice(0, -1) ?? [route[0]]), ...enroute], climbNm) : null
    const tod = last?.rows.some(r => r.to.kind === 'tod') && descNm > 0 ? along([...enroute].reverse(), descNm) : null
    return { segs, toc, tod }
  }, [pts, legs, d, route])

  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [zoomTick, setZoomTick] = useState(0) // labels that depend on spacing are re-checked when the zoom settles
  const [hover, setHover] = useState<Hover>(null)
  const [pinned, setPinned] = useState(false)
  const pinnedRef = useRef(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const [, setTick] = useState(0)
  const pin = (h: NonNullable<Hover>) => { setHover(h); setPinned(true); pinnedRef.current = true }
  const unpin = () => { setPinned(false); pinnedRef.current = false; setHover(null) }

  const onLoad = useCallback((map: maplibregl.Map) => {
    const accent = mapColor('--accent'), muted = mapColor('--fg-3'), good = mapColor('--good')
    const line = (c: LL[]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: c.map(xy) } })
    const fc = (features: GeoJSON.Feature[]) => ({ type: 'FeatureCollection' as const, features })
    map.addSource('legs', { type: 'geojson', data: fc(geo.segs.map((sg, i) => ({ ...line(sg), properties: { i } }))) })
    map.addLayer({ id: 'legs-casing', type: 'line', source: 'legs', paint: { 'line-color': '#000', 'line-width': 6, 'line-opacity': 0.5 }, layout: { 'line-cap': 'round' } })
    map.addLayer({ id: 'legs', type: 'line', source: 'legs', paint: { 'line-color': accent, 'line-width': 3 }, layout: { 'line-cap': 'round' } })
    map.addLayer({ id: 'legs-hit', type: 'line', source: 'legs', paint: { 'line-color': '#000', 'line-width': 22, 'line-opacity': 0 } })
    const arr = pts.find(p => p.role === 'Arrival'), alt = pts.find(p => p.role === 'Alternate')
    map.addSource('alt', { type: 'geojson', data: fc(arr && alt ? [line([arr.a, alt.a])] : []) })
    map.addLayer({ id: 'alt', type: 'line', source: 'alt', paint: { 'line-color': muted, 'line-width': 2, 'line-dasharray': [2, 2] } })
    const rwys = pts.flatMap(p => { const rc = p.perf?.runway, o = rc?.runway.ends.find(e => e !== rc.end); return rc && rc.end.lat != null && rc.end.lon != null && o?.lat != null && o.lon != null ? [line([{ lat: rc.end.lat, lon: rc.end.lon }, { lat: o.lat, lon: o.lon }])] : [] })
    map.addSource('rwy', { type: 'geojson', data: fc(rwys) })
    map.addLayer({ id: 'rwy', type: 'line', source: 'rwy', paint: { 'line-color': '#f5f5f5', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 13, 8] } })
    map.addSource('procs', { type: 'geojson', data: fc(pts.flatMap(p => [p.entry ? line(p.entry.path) : null, p.dep ? line(p.dep.path) : null].filter(Boolean) as GeoJSON.Feature[])) })
    map.addLayer({ id: 'procs', type: 'line', source: 'procs', paint: { 'line-color': good, 'line-width': 2, 'line-dasharray': [1.5, 1.5] }, layout: { 'line-join': 'round' } })
    map.on('mousemove', 'legs-hit', e => { const i = e.features?.[0]?.properties?.i; if (i != null && !pinnedRef.current) setHover({ kind: 'leg', i: Number(i), at: { lat: e.lngLat.lat, lon: e.lngLat.lng } }); map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'legs-hit', () => { if (!pinnedRef.current) setHover(h => (h?.kind === 'leg' ? null : h)); map.getCanvas().style.cursor = '' })
    map.on('click', 'legs-hit', e => { const i = e.features?.[0]?.properties?.i; if (i != null) pin({ kind: 'leg', i: Number(i), at: { lat: e.lngLat.lat, lon: e.lngLat.lng } }) })
    map.on('click', e => { if (!map.queryRenderedFeatures(e.point, { layers: ['legs-hit'] }).length) unpin() })
    const all = [...pts.map(p => p.a), ...pts.flatMap(p => [...(p.entry?.path ?? []), ...(p.dep?.path ?? [])])]
    if (all.length) {
      const lons = all.map(p => p.lon), lats = all.map(p => p.lat)
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: { top: 70, bottom: 60, left: 60, right: 140 }, maxZoom: 11, duration: 0 })
    }
    // Markers move with the map on their own; only an open card follows it here.
    let raf = 0
    map.on('move', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setTick(t => t + 1)) })
    map.on('zoomend', () => setZoomTick(t => t + 1)); map.on('resize', () => setZoomTick(t => t + 1))
    setMap(map)
    return () => { cancelAnimationFrame(raf); setMap(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, geo])

  const P = (p: LL) => (map ? map.project([p.lon, p.lat]) : null)
  const w = boxRef.current?.clientWidth ?? 0, h = boxRef.current?.clientHeight ?? 0
  void zoomTick
  const hoverAt = hover ? P(hover.at) : null

  return (
    <div ref={boxRef} className={cn('relative overflow-hidden rounded-xl ring-1 ring-inset ring-white/[0.04]', className)}>
      {/* The map is re-created when the route, alternate or figures change, so its layers match them. */}
      <MapView key={JSON.stringify([pts.map(p => [p.a.id, p.perf?.runway?.end.id, p.entry?.kind, p.dep?.kind]), legs.map(l => Math.round(l.tc))])} className="h-full" onLoad={onLoad} controls />
      {map && <>
        {/* Course and altitude on each leg, at the middle of what's drawn. */}
        {geo.segs.map(([a, b], i) => {
          const pa = P(a), pb = P(b)
          if (!pa || !pb || Math.hypot(pb.x - pa.x, pb.y - pa.y) < 90) return null
          const l = legs[i], alt = d.flights[l.flight]?.alt, at = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }
          return (
            <MapMarker key={`leg-${i}`} map={map} at={at}>
              <button type="button" className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#111]/90 px-2 py-0.5 text-[11px] whitespace-nowrap text-fg ring-1 ring-white/10 hover:ring-accent"
                onMouseEnter={() => !pinnedRef.current && setHover({ kind: 'leg', i, at })} onMouseLeave={() => !pinnedRef.current && setHover(null)}
                onClick={() => pin({ kind: 'leg', i, at })}>
                <span className="num">{deg3(l.mc)}°</span><span className="text-fg-3"> · </span><span className="num">{alt ? `${(alt / 1000).toFixed(1)}k` : ''}</span>
              </button>
            </MapMarker>
          )
        })}
        {/* Top of climb and top of descent, on the drawn route. */}
        {([['TOC', geo.toc], ['TOD', geo.tod]] as const).map(([k, at]) => at && (
          <MapMarker key={k} map={map} at={at}>
            <span className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#111] ring-2 ring-accent" />
            <span className="num absolute left-2.5 -top-2 whitespace-nowrap text-[10px] text-fg-2 [text-shadow:0_0_3px_#000]">{k} {(k === 'TOC' ? d.flights[0] : d.flights.at(-1))?.alt.toLocaleString()}</span>
          </MapMarker>
        ))}
        {/* Airports and points, each with its surface wind; a label that would overlap an earlier one goes on the left. */}
        {pts.map((p, i) => {
          const s = P(p.a)
          const flip = !!s && pts.slice(0, i).some(q => { const o = P(q.a); return o && Math.abs(o.y - s.y) < 22 && Math.abs(s.x - o.x) < 150 })
          const wind = p.wx?.wind.from ? p.wx.wind : null
          const apt = !isWaypoint(p.a)
          const end = p.role === 'Departure' || p.role === 'Arrival'
          return (
            <MapMarker key={`${p.a.id}-${i}`} map={map} at={p.a}>
              <button type="button" aria-label={`${code(p.a)} ${p.role}`}
                onMouseEnter={() => !pinnedRef.current && setHover({ kind: 'pt', i, at: p.a })} onMouseLeave={() => !pinnedRef.current && setHover(null)}
                onClick={() => pin({ kind: 'pt', i, at: p.a })}
                className={cn('absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#111]',
                  end ? 'size-4 bg-accent' : p.role === 'Alternate' ? 'size-3.5 bg-fg-3' : apt ? 'size-3 bg-fg' : 'size-2.5 rotate-45 rounded-[2px] bg-fg-2')} />
              <div className={cn('pointer-events-none absolute -top-2.5 flex items-center gap-1.5 whitespace-nowrap rounded-md bg-[#111]/85 px-1.5 py-0.5 text-[11px] ring-1 ring-white/10', flip ? 'right-3' : 'left-3', !end && 'opacity-80')}>
                <span className="num font-medium text-fg">{p.a.label && isWaypoint(p.a) ? p.a.label : code(p.a)}</span>
                {p.wx?.category && <span className="size-1.5 rounded-full" style={{ background: p.wx.category === 'VFR' ? 'var(--good)' : p.wx.category === 'MVFR' ? 'var(--c1)' : p.wx.category === 'IFR' ? 'var(--bad)' : 'var(--c5)' }} />}
                {wind && (wind.spd ? <span className="num inline-flex items-center gap-0.5 text-fg-2"><WindArrow dir={wind.dir} />{wind.spd}{wind.gust ? `G${wind.gust}` : ''}</span> : <span className="text-fg-3">calm</span>)}
              </div>
            </MapMarker>
          )
        })}
        {hover && hoverAt && <div className="pointer-events-none absolute inset-0"><Card x={hoverAt.x} y={hoverAt.y} w={w} h={h} hover={hover} pts={pts} legs={legs} d={d} pinned={pinned} onClose={unpin} /></div>}
      </>}
      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-[#111]/85 px-2 py-1 text-[11px] text-fg-3 ring-1 ring-white/10">
        <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 bg-accent" />Route</span>
        <span className="inline-flex items-center gap-1"><span className="h-0 w-4 border-t-2 border-dashed border-good" />Departure and pattern entry</span>
        {pts.some(p => p.role === 'Alternate') && <span className="inline-flex items-center gap-1"><span className="h-0 w-4 border-t-2 border-dashed border-fg-3" />Alternate</span>}
      </div>
    </div>
  )
}

// A React element pinned to a map position with a native MapLibre marker, so it
// moves in the same frame as the map (no lag while dragging).
function MapMarker({ map, at, children }: { map: maplibregl.Map; at: LL; children: React.ReactNode }) {
  const [el] = useState(() => { const e = document.createElement('div'); e.style.cssText = 'width:0;height:0;position:relative'; return e })
  const marker = useRef<maplibregl.Marker | null>(null)
  useEffect(() => { const m = new maplibre.Marker({ element: el, anchor: 'center' }).setLngLat([at.lon, at.lat]).addTo(map); marker.current = m; return () => { m.remove() } }, [map, el]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { marker.current?.setLngLat([at.lon, at.lat]) }, [at.lat, at.lon])
  return createPortal(children, el)
}

// Distances along a drawn line (nm, flat earth is plenty at these lengths).
const nmBetween = (a: LL, b: LL) => Math.hypot((b.lat - a.lat) * 60, (b.lon - a.lon) * 60 * Math.cos((a.lat * Math.PI) / 180))
function along(path: LL[], nm: number): LL | null {
  let left = nm
  for (let i = 1; i < path.length; i++) {
    const d = nmBetween(path[i - 1], path[i])
    if (d >= left && d > 0) { const t = left / d; return { lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t, lon: path[i - 1].lon + (path[i].lon - path[i - 1].lon) * t } }
    left -= d
  }
  return path.at(-1) ?? null
}
// The climb is the rows up to TOC; the descent the rows after TOD.
const sumUntil = (rows: Derived['navlog'], kind: 'toc') => { let s = 0; for (const r of rows) { s += r.distNm; if (r.to.kind === kind) return s } return 0 }
const sumAfter = (rows: Derived['navlog'], kind: 'tod') => { const i = rows.findIndex(r => r.to.kind === kind); return i < 0 ? 0 : rows.slice(i + 1).reduce((s, r) => s + r.distNm, 0) }

function WindArrow({ dir }: { dir: number | null }) {
  if (dir == null) return <span className="text-[10px]">VRB</span>
  // Points the way the wind blows (from dir, toward dir + 180): the glyph points south, so rotating it by dir does that.
  return <svg viewBox="0 0 12 12" className="size-3" style={{ transform: `rotate(${dir}deg)` }} aria-hidden><path d="M6 1v9M2.5 6.5 6 10l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => v == null || v === '' ? null : (
  <div className="flex items-baseline justify-between gap-4 py-0.5"><dt className="text-fg-3">{k}</dt><dd className="num text-right text-fg">{v}</dd></div>
)

// The hover card, kept inside the map and flipped away from the edges.
function Card({ x, y, hover, w, h, pts, legs, d, pinned, onClose }: { x: number; y: number; hover: NonNullable<Hover>; w: number; h: number; pts: Pt[]; legs: Leg[]; d: Derived; pinned: boolean; onClose: () => void }) {
  const W = Math.min(300, w - 16)
  const left = Math.max(8, Math.min(x + 16 + W > w ? x - 16 - W : x + 16, w - W - 8))
  // Beside the point horizontally; vertically it starts near the point but never leaves the map (it scrolls if taller).
  const style = { left, width: W, top: Math.max(8, Math.min(y - 60, h - 8 - Math.min(h - 16, 520))), maxHeight: h - 16 }
  return (
    <div className="pointer-events-auto absolute overflow-y-auto rounded-xl bg-[#141414]/95 p-3 text-[13px] shadow-pop ring-1 ring-white/10 backdrop-blur" style={style} role="dialog" aria-label="Details">
      {pinned && <button onClick={onClose} className="absolute top-2 right-2 grid size-6 place-items-center rounded-full text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close">×</button>}
      {hover.kind === 'pt' ? <PointCard p={pts[hover.i]} /> : <LegCard l={legs[hover.i]} alt={d.flights[legs[hover.i].flight]?.alt} />}
    </div>
  )
}

function PointCard({ p }: { p: Pt }) {
  const { a, wx, perf } = p
  const rw = perf?.runway
  const time = p.role === 'Departure' ? 'Departure' : 'Arrival'
  const f = (re: RegExp) => a.frequencies.find(x => re.test(x.use))?.freq
  const freqs = [['ATIS', f(/ATIS/)], ['Tower', f(/^LCL/)], ['Ground', f(/^GND/)], ['CTAF', f(/^CTAF/)]].filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ')
  return (
    <div>
      <div className="pr-6">
        <div className="flex items-center gap-2"><span className="num text-[15px] font-medium text-fg">{code(a)}</span><span className="text-fg-3">{p.role}</span>{wx?.category && <Cat cat={wx.category} />}</div>
        {!isWaypoint(a) && <div className="text-fg-2">{titleCase(a.name)}</div>}
      </div>
      {wx && (
        <dl className="mt-2 border-t border-white/10 pt-2">
          <Row k={`Weather at ${time.toLowerCase()}`} v={fmtTime(wx.at)} />
          <Row k="Wind" v={wx.wind.from ? (!wx.wind.spd ? 'Calm' : `${wx.wind.dir == null ? 'VRB' : `${deg3(wx.wind.dir)}°`} ${wx.wind.spd}${wx.wind.gust ? `G${wx.wind.gust}` : ''} kt`) : 'No report'} />
          <Row k="Ceiling · visibility" v={`${wx.ceiling ? `${wx.ceiling.toLocaleString()} ft` : 'None'} · ${wx.visib != null ? `${wx.visib} SM` : '—'}`} />
          <Row k="Temp · altimeter" v={`${wx.tempC != null ? `${Math.round(wx.tempC)} °C` : '—'} · ${wx.altimInHg?.toFixed(2) ?? '—'}`} />
          <Row k="Density altitude" v={wx.da != null ? `${wx.da.toLocaleString()} ft` : null} />
          <Row k="From" v={wx.wind.from === 'taf' ? `TAF ${wx.tafStation}` : wx.metarStation ? `METAR ${wx.metarStation}` : null} />
        </dl>
      )}
      {rw && (
        <RunwayDiagram compact airport={a} wind={wx?.wind.from ? wx.wind : null} active={[rw.end.id]} className="mx-auto mt-2 max-w-[11rem]" />
      )}
      {rw && (
        <dl className="mt-2 border-t border-white/10 pt-2">
          <Row k="Runway in use" v={`${rw.end.id} · ${deg3(rw.magHdg)}°`} />
          <Row k="Wind on it" v={`${rw.head >= 0 ? `${rw.head} kt head` : `${-rw.head} kt tail`} · ${Math.abs(rw.cross)} kt cross${rw.cross > 0 ? ' R' : rw.cross < 0 ? ' L' : ''}`} />
          <Row k="Size" v={`${rw.runway.len.toLocaleString()} × ${rw.runway.wid ?? '—'} ft${rw.runway.surface ? ` ${rw.runway.surface}` : ''}`} />
          <Row k="Pattern" v={`${rw.end.right ? 'Right' : 'Left'} · ${tpaOf(a).toLocaleString()} ft`} />
          {perf?.dist && <Row k={perf.kind === 'takeoff' ? 'Takeoff over 50 ft' : 'Landing over 50 ft'} v={`${perf.dist.total.toLocaleString()} of ${(perf.kind === 'takeoff' ? rw.toraFt : rw.ldaFt).toLocaleString()} ft`} />}
        </dl>
      )}
      {!rw && !isWaypoint(a) && <dl className="mt-2 border-t border-white/10 pt-2"><Row k="Elevation · pattern" v={`${Math.round(a.elev).toLocaleString()} · ${tpaOf(a).toLocaleString()} ft`} /></dl>}
      {(p.entry || p.dep) && <p className="mt-2 rounded-md bg-good-soft px-2 py-1.5 text-fg">{p.entry?.text ?? p.dep?.text}</p>}
      {freqs && <p className="num mt-2 text-fg-3">{freqs}</p>}
    </div>
  )
}

function LegCard({ l, alt }: { l: Leg; alt?: number }) {
  const name = (a: Airport) => a.label || code(a)
  return (
    <div className="pr-6">
      <div className="num text-[15px] font-medium text-fg">{name(l.from)} → {name(l.to)}</div>
      <dl className="mt-2 border-t border-white/10 pt-2">
        <Row k="Course mag · true" v={`${deg3(l.mc)}° · ${deg3(l.tc)}°`} />
        <Row k="Heading (magnetic)" v={`${deg3(l.mh)}°${Number.isNaN(l.wca) || !Math.round(l.wca) ? '' : ` (${l.wca > 0 ? '+' : '−'}${Math.abs(Math.round(l.wca))}° WCA)`}`} />
        <Row k="Altitude" v={alt ? `${alt.toLocaleString()} ft` : null} />
        <Row k="Wind aloft" v={l.wind ? `${l.wind.dir == null ? 'VRB' : `${deg3(l.wind.dir)}°`} ${Math.round(l.wind.spd)} kt${l.wind.temp != null ? ` · ${Math.round(l.wind.temp)} °C` : ''}` : 'Calm'} />
        <Row k="Distance · GS" v={`${l.distNm.toFixed(1)} nm · ${Math.round(l.gs)} kt`} />
        <Row k="Time · fuel" v={`${fmtMin(l.eteMin)} · ${l.fuelGal.toFixed(1)} gal`} />
        <Row k="Depart · arrive" v={`${fmtTime(l.departAt)} → ${fmtTime(l.arriveAt)}`} />
        <Row k="Highest terrain" v={l.terrainMax != null ? `${Math.round(l.terrainMax).toLocaleString()} ft` : null} />
      </dl>
    </div>
  )
}

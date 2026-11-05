import { useEffect, useRef, useState } from 'react'
import { MapView, fitTo, mapColor, maplibregl } from '@/components/data/MapView'
import { cn } from '@/lib/utils'
import { category, ceilingOf, parseVisib } from './calc'
import type { Airport, Derived, WeatherBundle } from './model'
import { isWaypoint } from './model'
import { coordToken } from './route'
import { SUGGEST_KIND, type Candidate, type Landmarks } from './suggest'
import { fmtTime } from './ui'

export interface MapNotams { icao: string; lat: number; lon: number; count: number; items: string[]; unavailable?: boolean }
export interface MapRadar { valid: string | null; tiles: string }
const FAA = (svc: string) => `https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`
const ESRI = (svc: string) => `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`
// Base charts, one at a time (FAA charts are the current editions the FAA
// publishes as map tiles; TAC only exists around terminal areas, so the
// sectional stays underneath it).
const CHARTS = [
  { key: 'sectional', label: 'Sectional', layers: ['sectional'], note: 'FAA VFR sectional (current edition)' },
  { key: 'tac', label: 'Terminal', layers: ['sectional', 'tac'], note: 'FAA terminal area chart over the sectional (zoom in)' },
  { key: 'ifrlow', label: 'IFR Low', layers: ['ifrlow'], note: 'FAA IFR enroute low' },
  { key: 'satellite', label: 'Satellite', layers: ['satellite'], note: 'Esri World Imagery' },
  { key: 'topo', label: 'Topo', layers: ['topo'], note: 'Esri World Topographic' },
  { key: 'street', label: 'Street', layers: [], note: 'CARTO / OpenStreetMap' },
] as const
type ChartKey = (typeof CHARTS)[number]['key']
const RASTERS: { id: string; tiles: string; minzoom?: number; maxzoom: number; attribution: string; opacity: number }[] = [
  { id: 'sectional', tiles: FAA('VFR_Sectional'), maxzoom: 12, attribution: 'FAA VFR sectional', opacity: 0.9 },
  { id: 'tac', tiles: FAA('VFR_Terminal'), minzoom: 10, maxzoom: 13, attribution: 'FAA terminal area chart', opacity: 1 },
  { id: 'ifrlow', tiles: FAA('IFR_AreaLow'), maxzoom: 12, attribution: 'FAA IFR enroute low', opacity: 0.95 },
  { id: 'satellite', tiles: ESRI('World_Imagery'), maxzoom: 18, attribution: 'Esri, Maxar, Earthstar Geographics', opacity: 1 },
  { id: 'topo', tiles: ESRI('World_Topo_Map'), maxzoom: 18, attribution: 'Esri, USGS, NOAA', opacity: 1 },
]
const CHART_KEY = 'planner-map-chart'
const savedChart = (): ChartKey => { try { const v = localStorage.getItem(CHART_KEY); return CHARTS.some(c => c.key === v) ? (v as ChartKey) : 'sectional' } catch { return 'sectional' } }

type FC = GeoJSON.FeatureCollection
const empty: FC = { type: 'FeatureCollection', features: [] }
const LAYERS = [
  { key: 'radar', label: 'Radar' },
  { key: 'airspace', label: 'Airspace' },
  { key: 'wx', label: 'METAR' },
  { key: 'pirep', label: 'PIREPs' },
  { key: 'adv', label: 'SIGMET / AIRMET' },
  { key: 'cwa', label: 'CWA' },
  { key: 'tfr', label: 'TFRs' },
  { key: 'notam', label: 'NOTAMs' },
  { key: 'lm', label: 'Landmarks' },
] as const
type LayerKey = (typeof LAYERS)[number]['key']

const HAZARD_COLOR: Record<string, string> = { CONVECTIVE: '#e8453c', IFR: '#c45bd6', MT_OBSC: '#d99a00', ICE: '#3ab0e8', TURB_LO: '#e4673a', TURB_HI: '#e4673a', SFC_WND: '#9085e9', LLWS: '#de5d8c' }

// Route edits from the map; indices are positions in the `route` prop.
export interface RouteEdit {
  insert: (at: number, p: EditPoint) => void
  move: (i: number, p: EditPoint) => void
  remove: (i: number) => void
  add: (p: EditPoint & { lat: number; lon: number }) => void
}
export interface EditPoint { token: string; label?: string; kind?: string }

export function PlannerMap({ route, alternate, weather, d, className, airspace, radar, notams, landmarks, cands, edit }: {
  route: Airport[]; alternate: Airport | null; weather: WeatherBundle | null; d: Derived; className?: string; airspace: unknown; radar?: MapRadar | null; notams?: MapNotams[]
  landmarks?: Landmarks | null; cands?: (Candidate & { near?: boolean })[]; edit?: RouteEdit
}) {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [chart, setChart] = useState<ChartKey>(savedChart)
  const [on, setOn] = useState<Record<LayerKey, boolean>>({ radar: true, airspace: false, wx: true, pirep: true, adv: true, cwa: true, tfr: true, notam: true, lm: true })
  const popup = useRef<maplibregl.Popup | null>(null)
  // Handlers are registered once on load; they read the latest props from refs.
  const editRef = useRef(edit); editRef.current = edit
  const routeRef = useRef(route); routeRef.current = route

  const onLoad = (map: maplibregl.Map) => {
    mapRef.current = map
    const accent = mapColor('--accent'), fg3 = mapColor('--fg-3'), card = mapColor('--card'), fg = mapColor('--fg')
    for (const r of RASTERS) {
      map.addSource(r.id, { type: 'raster', tiles: [r.tiles], tileSize: 256, maxzoom: r.maxzoom, ...(r.minzoom ? { minzoom: r.minzoom } : {}), attribution: r.attribution })
      map.addLayer({ id: r.id, type: 'raster', source: r.id, paint: { 'raster-opacity': r.opacity }, layout: { visibility: 'none' } })
    }
    for (const id of ['airspace', 'adv', 'tfr', 'route', 'airports', 'metars', 'pireps', 'notams', 'lm-lines', 'cands', 'drag']) map.addSource(id, { type: 'geojson', data: empty })
    map.addLayer({ id: 'aspc-fill', type: 'fill', source: 'airspace', paint: { 'fill-color': ['match', ['get', 'CLASS'], 'B', '#3987e5', 'C', '#de5d8c', '#3987e5'], 'fill-opacity': ['match', ['get', 'CLASS'], 'D', 0.03, 0.06] } })
    map.addLayer({ id: 'aspc-line', type: 'line', source: 'airspace', paint: { 'line-color': ['match', ['get', 'CLASS'], 'B', '#3987e5', 'C', '#de5d8c', '#3987e5'], 'line-width': 1.1, 'line-opacity': 0.7, 'line-dasharray': ['match', ['get', 'CLASS'], 'D', ['literal', [3, 2]], ['literal', [1, 0]]] } })
    map.addLayer({ id: 'adv-fill', type: 'fill', source: 'adv', filter: ['!=', ['get', 'kind'], 'cwa'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 } })
    map.addLayer({ id: 'adv-line', type: 'line', source: 'adv', filter: ['!=', ['get', 'kind'], 'cwa'], paint: { 'line-color': ['get', 'color'], 'line-width': 1.6 } })
    map.addLayer({ id: 'cwa-fill', type: 'fill', source: 'adv', filter: ['==', ['get', 'kind'], 'cwa'], paint: { 'fill-color': '#f2a33a', 'fill-opacity': 0.16 } })
    map.addLayer({ id: 'cwa-line', type: 'line', source: 'adv', filter: ['==', ['get', 'kind'], 'cwa'], paint: { 'line-color': '#f2a33a', 'line-width': 2, 'line-dasharray': [4, 2] } })
    map.addLayer({ id: 'tfr-fill', type: 'fill', source: 'tfr', paint: { 'fill-color': '#e8453c', 'fill-opacity': 0.22 } })
    map.addLayer({ id: 'tfr-line', type: 'line', source: 'tfr', paint: { 'line-color': '#e8453c', 'line-width': 2 } })
    map.addLayer({ id: 'lm-lines', type: 'line', source: 'lm-lines', paint: { 'line-color': ['match', ['get', 'kind'], 'road', '#e0782b', 'river', '#2f86d6', 'rail', '#555555', 'power', '#9a4fd0', '#888888'], 'line-width': ['match', ['get', 'kind'], 'road', 2.2, 1.6], 'line-opacity': 0.85, 'line-dasharray': ['match', ['get', 'kind'], 'power', ['literal', [3, 2]], 'rail', ['literal', [2, 1.5]], ['literal', [1, 0]]] } })
    map.addLayer({ id: 'lm-line-labels', type: 'symbol', source: 'lm-lines', minzoom: 9, layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold', 'Noto Sans Regular'], 'text-size': 11, 'symbol-spacing': 400 }, paint: { 'text-color': ['match', ['get', 'kind'], 'road', '#e0782b', 'river', '#2f86d6', 'rail', '#555555', 'power', '#9a4fd0', '#888888'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } })
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.85 } })
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['get', 'alt'], fg3, accent], 'line-width': 3, 'line-dasharray': ['case', ['get', 'alt'], ['literal', [2, 2]], ['literal', [1, 0]]] } })
    map.addLayer({ id: 'route-hit', type: 'line', source: 'route', filter: ['!', ['get', 'alt']], paint: { 'line-color': '#000', 'line-width': 16, 'line-opacity': 0.001 } })
    map.addLayer({ id: 'drag', type: 'line', source: 'drag', paint: { 'line-color': accent, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } })
    map.addLayer({ id: 'cands', type: 'circle', source: 'cands', filter: ['any', ['get', 'near'], ['>=', ['zoom'], 10]], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 11, 5], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } })
    map.addLayer({ id: 'cand-labels', type: 'symbol', source: 'cands', minzoom: 9.5, filter: ['any', ['get', 'near'], ['>=', ['zoom'], 10]], layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold', 'Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } })
    map.addLayer({ id: 'metars', type: 'circle', source: 'metars', paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': card, 'circle-stroke-width': 1.5 } })
    map.addLayer({ id: 'pireps', type: 'circle', source: 'pireps', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
    map.addLayer({ id: 'notams', type: 'circle', source: 'notams', paint: { 'circle-radius': 9, 'circle-color': '#d99a00', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-translate': [14, -14] } })
    map.addLayer({ id: 'notam-count', type: 'symbol', source: 'notams', layout: { 'text-field': ['to-string', ['get', 'count']], 'text-font': ['Open Sans Semibold', 'Noto Sans Regular'], 'text-size': 11, 'text-allow-overlap': true }, paint: { 'text-color': '#fff', 'text-translate': [14, -14] } })
    map.addLayer({ id: 'airports', type: 'circle', source: 'airports', paint: { 'circle-radius': ['case', ['get', 'wp'], 5, 8], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': ['case', ['get', 'wp'], 2, 2.5] } })
    map.addLayer({ id: 'airport-labels', type: 'symbol', source: 'airports', layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold', 'Noto Sans Regular'], 'text-size': 13, 'text-offset': [0, 1.4], 'text-anchor': 'top' }, paint: { 'text-color': fg, 'text-halo-color': card, 'text-halo-width': 1.5 } })
    // A popup, optionally with one action button (add / remove a route point).
    const show = (at: maplibregl.LngLatLike, html: string, action?: { label: string; run: () => void }) => {
      popup.current?.remove()
      const el = document.createElement('div')
      el.style.cssText = 'font-size:13px;line-height:1.45;white-space:pre-wrap'
      el.innerHTML = html
      if (action) {
        const b = document.createElement('button')
        b.textContent = action.label
        b.style.cssText = `display:block;margin-top:6px;padding:3px 10px;border-radius:999px;background:${accent};color:#fff;font-weight:600;font-size:12px`
        b.onclick = () => { action.run(); popup.current?.remove() }
        el.appendChild(b)
      }
      popup.current = new maplibregl.Popup({ closeButton: true, maxWidth: '22rem', className: 'planner-pop' }).setLngLat(at).setDOMContent(el).addTo(map)
    }
    for (const layer of ['airports', 'metars', 'pireps', 'adv-fill', 'cwa-fill', 'tfr-fill', 'notams', 'cands']) {
      map.on('click', layer, e => {
        const f = e.features?.[0]
        if (!f || dragged) return
        const p = f.properties || {}
        const ed = editRef.current
        if (layer === 'airports' && p.mid && ed) return show(e.lngLat, String(p.html ?? ''), { label: 'Remove from route', run: () => ed.remove(Number(p.idx)) })
        if (layer === 'cands') {
          const html = `<b>${escHtml(String(p.label))}</b>${p.name && p.name !== p.label ? ` · ${escHtml(String(p.name))}` : ''}<br>${escHtml(String(p.detail ?? ''))}`
          const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates
          return show(e.lngLat, html, ed && { label: 'Add to route', run: () => ed.add({ token: String(p.token), label: p.nasr ? undefined : String(p.label), kind: String(p.kind), lat, lon }) })
        }
        show(e.lngLat, String(p.html ?? ''))
      })
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
    }

    // Dragging: pull the line to add a point on a leg, or move a point you added.
    // On release the point snaps to a candidate (airport, VFR waypoint, VOR,
    // fix, town, tower…) or onto a highway / river / railroad / power line
    // under the cursor; elsewhere it becomes a coordinate.
    let drag: { mode: 'move' | 'insert'; idx: number } | null = null
    let dragged = false
    const legNear = (pt: maplibregl.Point) => {
      const r = routeRef.current
      let best = 1, bd = Infinity
      for (let i = 1; i < r.length; i++) {
        const a = map.project([r[i - 1].lon, r[i - 1].lat]), b = map.project([r[i].lon, r[i].lat])
        const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy
        const t = L ? Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / L)) : 0
        const dd = (a.x + t * dx - pt.x) ** 2 + (a.y + t * dy - pt.y) ** 2
        if (dd < bd) { bd = dd; best = i }
      }
      return best
    }
    const begin = (mode: 'move' | 'insert', idx: number) => { drag = { mode, idx }; dragged = false; map.dragPan.disable(); popup.current?.remove() }
    const onDown = (layer: 'airports' | 'route-hit') => (e: maplibregl.MapLayerMouseEvent | maplibregl.MapLayerTouchEvent) => {
      if (!editRef.current || ('points' in e && e.points.length > 1)) return
      if (layer === 'airports') {
        const p = e.features?.[0]?.properties
        if (!p?.mid) return
        e.preventDefault(); begin('move', Number(p.idx))
      } else {
        if (map.queryRenderedFeatures(e.point, { layers: ['airports'] }).length) return
        e.preventDefault(); begin('insert', legNear(e.point))
      }
    }
    const onMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!drag) return
      dragged = true
      const r = routeRef.current
      const prev = r[drag.idx - 1], next = drag.mode === 'move' ? r[drag.idx + 1] : r[drag.idx]
      if (!prev || !next) return
      ;(map.getSource('drag') as maplibregl.GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[prev.lon, prev.lat], [e.lngLat.lng, e.lngLat.lat], [next.lon, next.lat]] } })
    }
    const snap = (pt: maplibregl.Point, ll: maplibregl.LngLat): EditPoint => {
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [[pt.x - 12, pt.y - 12], [pt.x + 12, pt.y + 12]]
      const c = map.getLayer('cands') ? map.queryRenderedFeatures(box, { layers: ['cands'] })[0] : null
      if (c?.properties) return { token: String(c.properties.token), label: c.properties.nasr ? undefined : String(c.properties.label), kind: String(c.properties.kind) }
      const l = map.getLayer('lm-lines') ? map.queryRenderedFeatures([[pt.x - 8, pt.y - 8], [pt.x + 8, pt.y + 8]], { layers: ['lm-lines'] })[0] : null
      if (l?.properties && l.geometry.type === 'LineString') {
        const q = nearestOn(l.geometry.coordinates as [number, number][], [ll.lng, ll.lat])
        return { token: coordToken({ lat: q[1], lon: q[0] }), label: l.properties.kind === 'power' ? 'Power line' : String(l.properties.name), kind: String(l.properties.kind) }
      }
      return { token: coordToken({ lat: ll.lat, lon: ll.lng }) }
    }
    const onUp = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!drag) return
      const dr = drag
      drag = null
      map.dragPan.enable()
      ;(map.getSource('drag') as maplibregl.GeoJSONSource).setData(empty)
      const ed = editRef.current, moved = dragged
      setTimeout(() => { dragged = false }, 0)
      if (!moved || !ed) return
      const p = snap(e.point, e.lngLat)
      if (dr.mode === 'move') ed.move(dr.idx, p); else ed.insert(dr.idx, p)
    }
    map.on('mousedown', 'airports', onDown('airports')); map.on('touchstart', 'airports', onDown('airports'))
    map.on('mousedown', 'route-hit', onDown('route-hit')); map.on('touchstart', 'route-hit', onDown('route-hit'))
    map.on('mousemove', onMove); map.on('touchmove', onMove)
    map.on('mouseup', onUp); map.on('touchend', onUp)
    map.on('mouseenter', 'route-hit', () => { if (editRef.current) map.getCanvas().style.cursor = 'grab' })
    map.on('mouseleave', 'route-hit', () => { map.getCanvas().style.cursor = '' })
    // Keep the attribution folded behind its (i) so it doesn't cover the legend.
    const fold = () => map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
    fold(); map.on('resize', fold)
    setReady(true)
  }

  // Data → sources.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const esc = escHtml
    const set = (id: string, fc: FC) => (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(fc)
    const line = (pts: Airport[], alt: boolean): GeoJSON.Feature => ({ type: 'Feature', properties: { alt }, geometry: { type: 'LineString', coordinates: pts.map(a => [a.lon, a.lat]) } })
    set('route', { type: 'FeatureCollection', features: [route.length > 1 ? line(route, false) : null, alternate && route.length ? line([route[route.length - 1], alternate], true) : null].filter(Boolean) as GeoJSON.Feature[] })
    const wxBy = new Map(d.wx.map(w => [w.airport.id, w]))
    set('airports', { type: 'FeatureCollection', features: [...route, ...(alternate ? [alternate] : [])].map((a, i, arr) => {
      const w = wxBy.get(a.id)
      const wp = isWaypoint(a)
      const last = i === arr.length - (alternate ? 2 : 1)
      const mid = a !== alternate && i > 0 && !last
      const role = a === alternate ? 'ALT' : i === 0 ? 'DEP' : last ? 'DEST' : wp ? (a.navType || 'WAYPOINT') : 'FLY OVER'
      if (wp) return { type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { wp: true, mid, idx: i, label: a.label || a.id, color: mapColor('--fg-2'), html: `<b>${esc(a.label || a.id)}</b> · ${esc(role)}<br>${esc(a.name)}${a.frequencies[0] ? `<br>${esc(a.frequencies[0].freq)}` : ''}<br>${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}` } }
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: {
        wp: mid, mid, idx: i, label: `${a.icao || a.id}`, color: w?.category ? mapColor(catVar(w.category)) : mapColor('--fg-3'),
        html: `<b>${esc(a.icao || a.id)}</b> · ${role}<br>${esc(a.name)}<br>${w ? `${w.category ?? 'no report'} at ETA ${w.at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${w.metar ? `<br><span style="font-family:monospace">${esc(w.metar.rawOb)}</span>` : ''}` : ''}`,
      } }
    }) })
    set('metars', { type: 'FeatureCollection', features: (weather?.metars.data || []).filter(m => !route.some(a => (a.icao || a.id) === m.icaoId)).map(m => {
      const cat = m.fltCat || category(ceilingOf(m.clouds), parseVisib(m.visib))
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [m.lon, m.lat] }, properties: { color: mapColor(catVar(cat)), html: `<b>${esc(m.icaoId)}</b> ${cat}<br><span style="font-family:monospace">${esc(m.rawOb)}</span>` } }
    }) })
    set('pireps', { type: 'FeatureCollection', features: (weather?.pireps.data || []).map(p => {
      const sev = `${p.tbInt1} ${p.icgInt1}`
      const color = /SEV|EXTRM/.test(sev) ? '#e8453c' : /MOD/.test(sev) ? '#e4673a' : /LGT|TRC/.test(sev) ? '#d99a00' : '#8e8d88'
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { color, html: `<b>${p.pirepType}</b> ${esc(p.acType || '')}<br><span style="font-family:monospace">${esc(p.rawOb)}</span>` } }
    }) })
    // Everything issued for the area, not only what touches the line: the map is for seeing the picture.
    const tag = (kind: string) => (a: import('./model').Advisory) => ({ a, kind })
    const advs = [...(weather?.sigmets.data || []).map(tag('sigmet')), ...(weather?.gairmets.data || []).map(tag('gairmet')), ...(weather?.cwas.data || []).map(tag('cwa'))]
    set('adv', { type: 'FeatureCollection', features: advs.filter(({ a }) => a.coords?.length > 2).map(({ a, kind }) => ({
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [a.coords.map(c => [Number(c.lon), Number(c.lat)])] },
      properties: { kind, color: HAZARD_COLOR[a.hazard] || '#9085e9', html: `<b>${kind === 'cwa' ? `CWA ${esc(a.cwsu ?? '')}` : a.airSigmetType || (a.product ? `G-AIRMET ${a.product}` : 'Advisory')} — ${esc(a.hazard ?? '')}</b><br>${esc(a.due_to || a.rawAirSigmet || a.cwaText || a.text || '')}` },
    })) })
    set('notams', { type: 'FeatureCollection', features: (notams || []).filter(n => n.count > 0).map(n => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
      properties: { count: n.count, html: `<b>${esc(n.icao)} · ${n.count} NOTAM${n.count > 1 ? 's' : ''}</b><br>${n.items.slice(0, 6).map(t => `• ${esc(t.slice(0, 160))}`).join('<br>')}${n.count > 6 ? '<br>… see the Weather step' : ''}` },
    })) })
    set('tfr', { type: 'FeatureCollection', features: (d.hazards.tfrs || []).map(f => ({ ...f, properties: { html: `<b>TFR ${esc(f.properties.id)}</b> ${esc(f.properties.kind)}<br>${esc(f.properties.title)}` } })) as GeoJSON.Feature[] })
  }, [ready, route, alternate, weather, d, notams])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource('lm-lines') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: (landmarks?.lines ?? []).map(l => ({ type: 'Feature', properties: { kind: l.kind, name: l.name }, geometry: { type: 'LineString', coordinates: l.coords } })) })
  }, [ready, landmarks])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource('cands') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: (cands ?? []).map(c => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: { token: c.token, label: c.label, name: c.name, kind: c.kind, detail: c.detail, near: !!c.near, nasr: !c.token.includes('/'), color: SUGGEST_KIND[c.kind].color },
    })) })
  }, [ready, cands])

  // The nationwide airspace layer is large: send it to the map once, not on every edit.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !airspace || !Array.isArray(airspace)) return
    ;(map.getSource('airspace') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: airspace as GeoJSON.Feature[] })
  }, [ready, airspace])

  // Radar tiles: the source URL carries the scan time so a new scan replaces the tiles.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !radar?.tiles) return
    if (map.getLayer('radar')) map.removeLayer('radar')
    if (map.getSource('radar')) map.removeSource('radar')
    map.addSource('radar', { type: 'raster', tiles: [`${radar.tiles}?t=${encodeURIComponent(radar.valid ?? '')}`], tileSize: 256, attribution: 'NEXRAD composite · Iowa Environmental Mesonet' })
    map.addLayer({ id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.65 }, layout: { visibility: on.radar ? 'visible' : 'none' } }, 'aspc-fill')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, radar?.tiles, radar?.valid])

  // Fit to the route once its airports change.
  // Fit when the departure, arrival or alternate change (not on every point you add).
  const routeKey = [route[0], route[route.length - 1], alternate].map(a => a?.id).join(',')
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const pts = [...route, ...(alternate ? [alternate] : [])].map(a => [a.lon, a.lat] as [number, number])
    if (pts.length) fitTo(map, pts, 64, 10)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, routeKey])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const vis = (ids: string[], v: boolean) => ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'))
    const base = CHARTS.find(c => c.key === chart)!.layers as readonly string[]
    for (const r of RASTERS) vis([r.id], base.includes(r.id))
    vis(['radar'], on.radar); vis(['aspc-fill', 'aspc-line'], on.airspace); vis(['metars'], on.wx); vis(['pireps'], on.pirep)
    vis(['adv-fill', 'adv-line'], on.adv); vis(['cwa-fill', 'cwa-line'], on.cwa); vis(['tfr-fill', 'tfr-line'], on.tfr); vis(['notams', 'notam-count'], on.notam)
    vis(['lm-lines', 'lm-line-labels', 'cands', 'cand-labels'], on.lm)
  }, [on, chart, ready])

  return (
    <div className={cn('relative overflow-hidden rounded-lg ring-1 ring-inset ring-border', className)}>
      <MapView className="h-full w-full" onLoad={onLoad} zoom={8} fullscreen />
      <div className="absolute left-2 top-2 flex max-w-[calc(100%-4rem)] flex-wrap gap-1">
        <div role="radiogroup" aria-label="Base chart" className="flex flex-wrap gap-0.5 rounded-full bg-card/90 p-0.5 ring-1 ring-border backdrop-blur">
          {CHARTS.map(c => (
            <button key={c.key} role="radio" aria-checked={chart === c.key} onClick={() => { setChart(c.key); try { localStorage.setItem(CHART_KEY, c.key) } catch { /* private mode */ } }}
              className={cn('h-6 rounded-full px-2.5 text-xs font-medium', chart === c.key ? 'bg-accent text-bg' : 'text-fg-2 hover:text-fg')}>{c.label}</button>
          ))}
        </div>
        {LAYERS.filter(l => l.key !== 'lm' || landmarks || cands?.length).map(l => (
          <button key={l.key} onClick={() => setOn(s => ({ ...s, [l.key]: !s[l.key] }))} aria-pressed={on[l.key]}
            className={cn('h-7 rounded-full px-2.5 text-xs font-medium backdrop-blur', on[l.key] ? 'bg-card/90 text-fg ring-1 ring-border' : 'bg-card/60 text-fg-3')}>{l.label}</button>
        ))}
      </div>
      <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-x-2 gap-y-0.5 rounded-md bg-card/85 px-2 py-1 text-xs text-fg-2 backdrop-blur">
        {(['VFR', 'MVFR', 'IFR', 'LIFR'] as const).map(c => <span key={c} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: `var(${catVar(c)})` }} />{c}</span>)}
        {on.radar && radar?.valid && <span>· Radar {fmtTime(new Date(radar.valid))}</span>}
        <span>· {CHARTS.find(c => c.key === chart)!.note}</span>
      </div>
    </div>
  )
}

const catVar = (c: string) => ({ VFR: '--good', MVFR: '--c1', IFR: '--bad', LIFR: '--c5' } as Record<string, string>)[c] || '--fg-3'

const escHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
// Closest point on a polyline to p (flat lon/lat; fine for snapping).
function nearestOn(line: [number, number][], p: [number, number]): [number, number] {
  let best = line[0], bd = Infinity
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy
    const t = L ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L)) : 0
    const q: [number, number] = [ax + t * dx, ay + t * dy], dd = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
    if (dd < bd) { bd = dd; best = q }
  }
  return best
}

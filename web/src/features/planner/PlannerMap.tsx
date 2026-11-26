import { useEffect, useRef, useState } from 'react'
import { Layers } from 'lucide-react'
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
  { key: 'plain', label: 'Plain', layers: [], note: 'CARTO / OpenStreetMap' },
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

// A route airport's popup: weather at your ETA, elevation and pattern
// altitude, the runway the wind favours, the frequencies you'll use, NOTAMs.
function airportHtml(a: Airport, role: string, w: Derived['wx'][number] | undefined, perf: Derived['perf'], notams: number) {
  const esc = escHtml, t = (x: Date) => x.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const rw = perf.find(p => p.runway)?.runway
  const f = (u: RegExp) => a.frequencies.find(x => u.test(x.use))
  const freqs = [['ATIS', f(/ATIS/)], ['Tower', f(/^LCL/)], ['Ground', f(/^GND/)], ['CTAF', f(/^CTAF/)]].filter(([, x]) => x).map(([k, x]) => `${k} ${esc((x as { freq: string }).freq)}`).join(' · ')
  const tpa = Math.round(a.elev + (a.tpaAgl || 1000))
  return [
    `<b>${esc(a.icao || a.id)}</b> · ${role}`, esc(a.name),
    `Elevation ${Math.round(a.elev).toLocaleString()} ft · pattern ${tpa.toLocaleString()} ft${a.towered ? ' · towered' : ''}`,
    w ? `<b>${w.category ?? 'No report'}</b> at ETA ${t(w.at)}${w.wind.from ? ` · wind ${w.wind.dir == null ? 'VRB' : String(w.wind.dir).padStart(3, '0')}@${w.wind.spd}${w.wind.gust ? `G${w.wind.gust}` : ''}` : ''}` : '',
    rw ? `Runway ${esc(rw.end.id)}: ${rw.head >= 0 ? `${rw.head} kt headwind` : `${-rw.head} kt tailwind`}, ${Math.abs(rw.cross)} kt crosswind` : '',
    freqs, notams ? `<span style="color:#d99a00">${notams} NOTAM${notams > 1 ? 's' : ''} for a VFR flight</span>` : '',
    w?.metar ? `<span style="font-family:monospace">${esc(w.metar.rawOb)}</span>` : '',
  ].filter(Boolean).join('<br>')
}
const empty: FC = { type: 'FeatureCollection', features: [] }
const LAYERS = [
  { key: 'radar', label: 'Radar' },
  { key: 'airspace', label: 'Airspace' },
  { key: 'wx', label: 'METAR' },
  { key: 'wind', label: 'Wind' },
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
  rename: (i: number, name: string) => void // blank: back to the ident
  add: (p: EditPoint & { lat: number; lon: number }) => void
}
export interface EditPoint { token: string; label?: string; kind?: string }

// Two uses: 'route' (Route and fuel: every chart and layer, with TFRs, NOTAMs,
// PIREPs and landmarks on to start) and 'weather' (the briefing: a plain dark
// map with only the weather layers, all on: radar, METAR flight categories,
// winds, PIREPs, SIGMETs / G-AIRMETs, CWAs and TFRs).
const WEATHER_LAYERS: LayerKey[] = ['radar', 'wx', 'wind', 'pirep', 'adv', 'cwa', 'tfr']
const START: Record<'route' | 'weather', Record<LayerKey, boolean>> = {
  route: { radar: false, airspace: false, wx: false, wind: false, pirep: true, adv: false, cwa: false, tfr: true, notam: true, lm: true },
  weather: { radar: true, airspace: false, wx: true, wind: true, pirep: true, adv: true, cwa: true, tfr: true, notam: false, lm: false },
}
export function PlannerMap({ route, alternate, weather, d, className, airspace, radar, notams, landmarks, cands, edit, mode = 'route' }: {
  route: Airport[]; alternate: Airport | null; weather: WeatherBundle | null; d: Derived; className?: string; airspace: unknown; radar?: MapRadar | null; notams?: MapNotams[]
  landmarks?: Landmarks | null; cands?: (Candidate & { near?: boolean })[]; edit?: RouteEdit; mode?: 'route' | 'weather'
}) {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [controls, setControls] = useState(false) // phones: chart and layer buttons behind one toggle
  const [chart, setChart] = useState<ChartKey>(() => (mode === 'weather' ? 'plain' : savedChart()))
  const [on, setOn] = useState<Record<LayerKey, boolean>>(START[mode])
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
    for (const id of ['airspace', 'adv', 'tfr', 'route', 'airports', 'metars', 'pireps', 'notams', 'lm-lines', 'cands', 'drag', 'winds']) map.addSource(id, { type: 'geojson', data: empty })
    // A wind arrow (points north; rotated to blow downwind), drawn once.
    if (!map.hasImage('wind-arrow')) {
      const c = document.createElement('canvas'); c.width = c.height = 32
      const g = c.getContext('2d')!
      g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round'
      const arrow = () => { g.beginPath(); g.moveTo(16, 28); g.lineTo(16, 6); g.moveTo(8, 13); g.lineTo(16, 5); g.lineTo(24, 13); g.stroke() }
      arrow(); g.strokeStyle = '#1f6feb'; g.lineWidth = 2.5; arrow()
      map.addImage('wind-arrow', g.getImageData(0, 0, 32, 32))
    }
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
    // Suggestions are hollow rings in their kind's colour; your route points are filled, numbered pins.
    map.addLayer({ id: 'cands', type: 'circle', source: 'cands', filter: ['any', ['get', 'near'], ['>=', ['zoom'], 10]], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3.5, 11, 6], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.9 } })
    map.addLayer({ id: 'cand-labels', type: 'symbol', source: 'cands', minzoom: 9.5, filter: ['any', ['get', 'near'], ['>=', ['zoom'], 10]], layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold', 'Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } })
    map.addLayer({ id: 'metars', type: 'circle', source: 'metars', paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': card, 'circle-stroke-width': 1.5 } })
    map.addLayer({ id: 'pireps', type: 'circle', source: 'pireps', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
    // NOTAMs: an amber square with the count (a different shape from the round route pins).
    map.addLayer({ id: 'notams', type: 'symbol', source: 'notams', layout: { 'icon-image': ['concat', 'notam-', ['to-string', ['get', 'count']]], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-offset': [16, -16] } })
    map.addLayer({ id: 'winds', type: 'symbol', source: 'winds', layout: {
      'icon-image': 'wind-arrow', 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['get', 'spd'], 0, 0.55, 30, 1.1],
      'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold', 'Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true,
    }, paint: { 'text-color': fg, 'text-halo-color': card, 'text-halo-width': 1.5, 'icon-opacity': ['case', ['get', 'aloft'], 0.95, 0.8] } })
    // Departure, arrival and alternate are circles in their flight-category colour; your route points are
    // numbered pins (an image, so the number is centred exactly); the circle under a pin is its hit area.
    map.addLayer({ id: 'airports', type: 'circle', source: 'airports', paint: { 'circle-radius': ['case', ['get', 'mid'], 11, 8], 'circle-color': ['get', 'color'], 'circle-opacity': ['case', ['get', 'mid'], 0, 1], 'circle-stroke-color': '#fff', 'circle-stroke-width': ['case', ['get', 'mid'], 0, 2.5] } })
    map.addLayer({ id: 'route-num', type: 'symbol', source: 'airports', filter: ['get', 'mid'], layout: { 'icon-image': ['concat', 'pin-', ['to-string', ['get', 'idx']]], 'icon-allow-overlap': true, 'icon-ignore-placement': true } })
    map.on('styleimagemissing', e => {
      const m = /^(pin|notam)-(\d+)$/.exec(e.id)
      if (!m || map.hasImage(e.id)) return
      const r = window.devicePixelRatio || 1, size = 24, c = document.createElement('canvas')
      c.width = c.height = size * r
      const g = c.getContext('2d')!
      g.scale(r, r)
      if (m[1] === 'pin') {
        g.beginPath(); g.arc(12, 12, 10.5, 0, Math.PI * 2); g.fillStyle = accent; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke()
      } else {
        g.beginPath(); g.roundRect(2, 2, 20, 20, 5); g.fillStyle = '#d99a00'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke()
      }
      g.fillStyle = m[1] === 'pin' ? '#fff' : '#111'
      g.font = `600 ${m[2].length > 1 ? 10 : 12}px Inter, system-ui, sans-serif`
      g.textAlign = 'center'; g.textBaseline = 'alphabetic'
      const t = g.measureText(m[2])
      g.fillText(m[2], 12, 12 + (t.actualBoundingBoxAscent - t.actualBoundingBoxDescent) / 2)
      map.addImage(e.id, g.getImageData(0, 0, c.width, c.height), { pixelRatio: r })
    })
    map.addLayer({ id: 'airport-labels', type: 'symbol', source: 'airports', layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold', 'Noto Sans Regular'], 'text-size': 13, 'text-offset': [0, 1.4], 'text-anchor': 'top' }, paint: { 'text-color': fg, 'text-halo-color': card, 'text-halo-width': 1.5 } })
    // A popup, optionally with one action button (add / remove a route point)
    // and, for a point on the route, a field to name it.
    const show = (at: maplibregl.LngLatLike, html: string, action?: { label: string; run: () => void }, name?: { value: string; ident: string; save: (v: string) => void }) => {
      popup.current?.remove()
      const el = document.createElement('div')
      el.style.cssText = 'font-size:13px;line-height:1.45;white-space:pre-wrap'
      el.innerHTML = html
      if (name) {
        const f = document.createElement('form')
        f.style.cssText = 'display:flex;gap:6px;margin-top:8px;white-space:normal'
        const i = document.createElement('input')
        i.value = name.value; i.placeholder = `Name (blank: ${name.ident})`; i.maxLength = 40; i.setAttribute('aria-label', 'Point name')
        i.style.cssText = 'flex:1;min-width:0;padding:4px 8px;border-radius:6px;border:1px solid #8886;background:transparent;color:inherit;font-size:13px'
        const b = document.createElement('button')
        b.type = 'submit'; b.textContent = 'Name'
        b.style.cssText = `padding:3px 10px;border-radius:999px;border:1px solid ${accent};color:${accent};font-weight:600;font-size:12px`
        f.onsubmit = ev => { ev.preventDefault(); name.save(i.value); popup.current?.remove() }
        f.append(i, b); el.appendChild(f)
      }
      if (action) {
        const b = document.createElement('button')
        b.textContent = action.label
        b.style.cssText = `display:block;margin-top:6px;padding:3px 10px;border-radius:999px;background:${accent};color:#fff;font-weight:600;font-size:12px`
        b.onclick = () => { action.run(); popup.current?.remove() }
        el.appendChild(b)
      }
      popup.current = new maplibregl.Popup({ closeButton: true, maxWidth: '22rem', className: 'planner-pop' }).setLngLat(at).setDOMContent(el).addTo(map)
    }
    for (const layer of ['airports', 'metars', 'pireps', 'adv-fill', 'cwa-fill', 'tfr-fill', 'notams', 'cands', 'winds']) {
      map.on('click', layer, e => {
        const f = e.features?.[0]
        if (!f || dragged) return
        const p = f.properties || {}
        const ed = editRef.current
        if (layer === 'airports' && p.mid && ed) return show(e.lngLat, String(p.html ?? ''), { label: 'Remove from route', run: () => ed.remove(Number(p.idx)) }, { value: String(p.named ?? ''), ident: String(p.ident ?? ''), save: v => ed.rename(Number(p.idx), v) })
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

    // A click on empty map: add a point there, named as you like (blank keeps its coordinates).
    const interactive = ['airports', 'route-num', 'metars', 'pireps', 'adv-fill', 'cwa-fill', 'tfr-fill', 'notams', 'cands', 'winds', 'route-hit']
    map.on('click', e => {
      const ed = editRef.current
      if (!ed || dragged || map.queryRenderedFeatures(e.point, { layers: interactive.filter(l => map.getLayer(l)) }).length) return
      const ll = { lat: e.lngLat.lat, lon: e.lngLat.lng }
      const el = document.createElement('form')
      el.style.cssText = 'font-size:13px;line-height:1.45;display:grid;gap:8px;min-width:15rem'
      const head = document.createElement('div')
      head.innerHTML = `<b>Add a point here</b><br><span style="opacity:.7">${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}</span>`
      const i = document.createElement('input')
      i.placeholder = 'Name it, e.g. Reservoir dam'; i.maxLength = 40; i.setAttribute('aria-label', 'Point name')
      i.style.cssText = 'padding:5px 8px;border-radius:6px;border:1px solid #8886;background:transparent;color:inherit;font-size:13px'
      const b = document.createElement('button')
      b.type = 'submit'; b.textContent = 'Add to route'
      b.style.cssText = `justify-self:start;padding:4px 12px;border-radius:999px;background:${accent};color:#fff;font-weight:600;font-size:12px`
      el.onsubmit = ev => { ev.preventDefault(); ed.add({ token: coordToken(ll), label: i.value.trim() || undefined, lat: ll.lat, lon: ll.lon }); popup.current?.remove() }
      el.append(head, i, b)
      popup.current?.remove()
      popup.current = new maplibregl.Popup({ closeButton: true, maxWidth: '22rem', className: 'planner-pop' }).setLngLat(e.lngLat).setDOMContent(el).addTo(map)
      setTimeout(() => i.focus(), 0)
    })

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
      if (wp) return { type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { wp: true, mid, idx: i, label: a.label || a.id, named: a.label ?? '', ident: a.id, color: mapColor('--fg-2'), html: `<b>${esc(a.label || a.id)}</b>${a.label && a.label !== a.id ? ` (${esc(a.id)})` : ''} · ${esc(role)}<br>${esc(a.name)}${a.frequencies[0] ? `<br>${esc(a.frequencies[0].freq)}` : ''}<br>${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}` } }
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: {
        wp: mid, mid, idx: i, label: (mid && a.label) || a.icao || a.id, named: a.label ?? '', ident: a.icao || a.id, color: w?.category ? mapColor(catVar(w.category)) : mapColor('--fg-3'),
        html: airportHtml(a, role, w, d.perf.filter(p => p.airport.id === a.id), (notams || []).find(n => n.icao === (a.icao || a.id))?.count ?? 0),
      } }
    }) })
    set('metars', { type: 'FeatureCollection', features: (weather?.metars.data || []).filter(m => !route.some(a => (a.icao || a.id) === m.icaoId)).map(m => {
      const cat = m.fltCat || category(ceilingOf(m.clouds), parseVisib(m.visib))
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [m.lon, m.lat] }, properties: { color: mapColor(catVar(cat)), html: `<b>${esc(m.icaoId)}</b> ${cat}<br><span style="font-family:monospace">${esc(m.rawOb)}</span>` } }
    }) })
    // Wind: surface at every METAR (from its report), aloft at the navlog's rows (the forecast used).
    const num = (v: unknown) => (typeof v === 'number' ? v : null)
    const sfc = (weather?.metars.data || []).filter(m => num(m.wdir) != null && (m.wspd ?? 0) > 0).map(m => ({
      type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] },
      properties: { rot: (num(m.wdir)! + 180) % 360, spd: m.wspd, label: `${String(num(m.wdir)).padStart(3, '0')}@${m.wspd}${m.wgst ? `G${m.wgst}` : ''}`, aloft: false, html: `<b>${esc(m.icaoId)} surface wind</b><br>${String(num(m.wdir)).padStart(3, '0')}° at ${m.wspd} kt${m.wgst ? `, gusting ${m.wgst}` : ''} (METAR)` },
    }))
    const seen = new Set<string>()
    const aloft = d.navlog.filter(r => r.wind?.dir != null && r.to.lat != null).filter(r => { const k = `${r.flight}-${Math.round((r.to.lat ?? 0) * 10)}-${Math.round((r.to.lon ?? 0) * 10)}`; if (seen.has(k)) return false; seen.add(k); return true }).map(r => ({
      type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [r.to.lon!, r.to.lat!] },
      properties: { rot: (r.wind!.dir! + 180) % 360, spd: r.wind!.spd, aloft: true, label: `${String(r.wind!.dir).padStart(3, '0')}/${r.wind!.spd}${r.wind!.temp != null ? ` ${r.wind!.temp > 0 ? '+' : ''}${Math.round(r.wind!.temp)}°` : ''} · ${r.altFt.toLocaleString()}`, html: `<b>Wind aloft at ${esc(r.to.label)}</b><br>${String(r.wind!.dir).padStart(3, '0')}° at ${r.wind!.spd} kt${r.wind!.temp != null ? `, ${Math.round(r.wind!.temp)} °C` : ''} at ${r.altFt.toLocaleString()} ft<br>${r.windSrc === 'forecast' ? 'NOAA HRRR/GFS model forecast' : r.windSrc === 'yours' ? 'Your briefing winds' : r.windSrc === 'row' ? 'Typed into the NavLog' : r.windSrc === 'stale' ? 'Older copy of the forecast' : 'Calm (no forecast)'}${r.windWindow ? ` · valid ${r.windWindow}` : ''}` },
    }))
    set('winds', { type: 'FeatureCollection', features: [...sfc, ...aloft] })
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
    vis(['radar'], on.radar); vis(['aspc-fill', 'aspc-line'], on.airspace); vis(['metars'], on.wx); vis(['winds'], on.wind); vis(['pireps'], on.pirep)
    vis(['adv-fill', 'adv-line'], on.adv); vis(['cwa-fill', 'cwa-line'], on.cwa); vis(['tfr-fill', 'tfr-line'], on.tfr); vis(['notams'], on.notam)
    vis(['lm-lines', 'lm-line-labels', 'cands', 'cand-labels'], on.lm)
  }, [on, chart, ready])

  return (
    <div className={cn('@container relative overflow-hidden rounded-lg ring-1 ring-inset ring-border', className)}>
      <MapView className="h-full w-full" onLoad={onLoad} zoom={8} fullscreen />
      <button onClick={() => setControls(v => !v)} aria-expanded={controls} className="absolute left-2 top-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-card/90 px-3 text-sm font-medium text-fg ring-1 ring-border backdrop-blur @xl:hidden">
        <Layers className="size-4" />{controls ? 'Done' : mode === 'weather' ? 'Layers' : CHARTS.find(c => c.key === chart)!.label}
      </button>
      <div className={cn('absolute left-2 top-12 max-w-[calc(100%-4rem)] flex-wrap gap-1 @xl:top-2 @xl:flex', controls ? 'flex' : 'hidden')}>
        {mode === 'route' && <div role="radiogroup" aria-label="Base chart" className="flex flex-wrap gap-0.5 rounded-2xl bg-card/90 p-0.5 @xl:rounded-full ring-1 ring-border backdrop-blur">
          {CHARTS.filter(c => c.key !== 'plain').map(c => (
            <button key={c.key} role="radio" aria-checked={chart === c.key} onClick={() => { setChart(c.key); try { localStorage.setItem(CHART_KEY, c.key) } catch { /* private mode */ } }}
              className={cn('h-8 rounded-full px-3 text-sm font-medium @xl:h-6 @xl:px-2.5 @xl:text-xs', chart === c.key ? 'bg-accent text-bg' : 'text-fg-2 hover:text-fg')}>{c.label}</button>
          ))}
        </div>}
        {LAYERS.filter(l => (mode === 'weather' ? WEATHER_LAYERS.includes(l.key) : l.key !== 'lm' || landmarks || cands?.length)).map(l => (
          <button key={l.key} onClick={() => setOn(s => ({ ...s, [l.key]: !s[l.key] }))} aria-pressed={on[l.key]}
            className={cn('h-8 rounded-full px-3 text-sm font-medium backdrop-blur @xl:h-7 @xl:px-2.5 @xl:text-xs', on[l.key] ? 'bg-card/90 text-fg ring-1 ring-border' : 'bg-card/60 text-fg-3')}>{l.label}</button>
        ))}
      </div>
      <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-x-2 gap-y-0.5 rounded-md bg-card/85 px-2 py-1 text-xs text-fg-2 backdrop-blur">
        {(['VFR', 'MVFR', 'IFR', 'LIFR'] as const).map(c => <span key={c} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: `var(${catVar(c)})` }} />{c}</span>)}
        {on.radar && radar?.valid && <span>· Radar {fmtTime(new Date(radar.valid))}</span>}
        <span className="hidden @xl:inline">· {mode === 'weather' ? 'aviationweather.gov (NWS AWC) · tfr.faa.gov · NEXRAD' : CHARTS.find(c => c.key === chart)!.note}</span>
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

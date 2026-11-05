import { useEffect, useRef, useState } from 'react'
import { MapView, fitTo, mapColor, maplibregl } from '@/components/data/MapView'
import { cn } from '@/lib/utils'
import { category, ceilingOf, parseVisib } from './calc'
import type { Airport, Derived, WeatherBundle } from './model'
import { isWaypoint } from './model'
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
] as const
type LayerKey = (typeof LAYERS)[number]['key']

const HAZARD_COLOR: Record<string, string> = { CONVECTIVE: '#e8453c', IFR: '#c45bd6', MT_OBSC: '#d99a00', ICE: '#3ab0e8', TURB_LO: '#e4673a', TURB_HI: '#e4673a', SFC_WND: '#9085e9', LLWS: '#de5d8c' }

export function PlannerMap({ route, alternate, weather, d, className, airspace, radar, notams }: { route: Airport[]; alternate: Airport | null; weather: WeatherBundle | null; d: Derived; className?: string; airspace: unknown; radar?: MapRadar | null; notams?: MapNotams[] }) {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [chart, setChart] = useState<ChartKey>(savedChart)
  const [on, setOn] = useState<Record<LayerKey, boolean>>({ radar: true, airspace: false, wx: true, pirep: true, adv: true, cwa: true, tfr: true, notam: true })
  const popup = useRef<maplibregl.Popup | null>(null)

  const onLoad = (map: maplibregl.Map) => {
    mapRef.current = map
    const accent = mapColor('--accent'), fg3 = mapColor('--fg-3'), card = mapColor('--card'), fg = mapColor('--fg')
    for (const r of RASTERS) {
      map.addSource(r.id, { type: 'raster', tiles: [r.tiles], tileSize: 256, maxzoom: r.maxzoom, ...(r.minzoom ? { minzoom: r.minzoom } : {}), attribution: r.attribution })
      map.addLayer({ id: r.id, type: 'raster', source: r.id, paint: { 'raster-opacity': r.opacity }, layout: { visibility: 'none' } })
    }
    for (const id of ['airspace', 'adv', 'tfr', 'route', 'airports', 'metars', 'pireps', 'notams']) map.addSource(id, { type: 'geojson', data: empty })
    map.addLayer({ id: 'aspc-fill', type: 'fill', source: 'airspace', paint: { 'fill-color': ['match', ['get', 'CLASS'], 'B', '#3987e5', 'C', '#de5d8c', '#3987e5'], 'fill-opacity': ['match', ['get', 'CLASS'], 'D', 0.03, 0.06] } })
    map.addLayer({ id: 'aspc-line', type: 'line', source: 'airspace', paint: { 'line-color': ['match', ['get', 'CLASS'], 'B', '#3987e5', 'C', '#de5d8c', '#3987e5'], 'line-width': 1.1, 'line-opacity': 0.7, 'line-dasharray': ['match', ['get', 'CLASS'], 'D', ['literal', [3, 2]], ['literal', [1, 0]]] } })
    map.addLayer({ id: 'adv-fill', type: 'fill', source: 'adv', filter: ['!=', ['get', 'kind'], 'cwa'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 } })
    map.addLayer({ id: 'adv-line', type: 'line', source: 'adv', filter: ['!=', ['get', 'kind'], 'cwa'], paint: { 'line-color': ['get', 'color'], 'line-width': 1.6 } })
    map.addLayer({ id: 'cwa-fill', type: 'fill', source: 'adv', filter: ['==', ['get', 'kind'], 'cwa'], paint: { 'fill-color': '#f2a33a', 'fill-opacity': 0.16 } })
    map.addLayer({ id: 'cwa-line', type: 'line', source: 'adv', filter: ['==', ['get', 'kind'], 'cwa'], paint: { 'line-color': '#f2a33a', 'line-width': 2, 'line-dasharray': [4, 2] } })
    map.addLayer({ id: 'tfr-fill', type: 'fill', source: 'tfr', paint: { 'fill-color': '#e8453c', 'fill-opacity': 0.22 } })
    map.addLayer({ id: 'tfr-line', type: 'line', source: 'tfr', paint: { 'line-color': '#e8453c', 'line-width': 2 } })
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.85 } })
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['get', 'alt'], fg3, accent], 'line-width': 3, 'line-dasharray': ['case', ['get', 'alt'], ['literal', [2, 2]], ['literal', [1, 0]]] } })
    map.addLayer({ id: 'metars', type: 'circle', source: 'metars', paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': card, 'circle-stroke-width': 1.5 } })
    map.addLayer({ id: 'pireps', type: 'circle', source: 'pireps', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
    map.addLayer({ id: 'notams', type: 'circle', source: 'notams', paint: { 'circle-radius': 9, 'circle-color': '#d99a00', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-translate': [14, -14] } })
    map.addLayer({ id: 'notam-count', type: 'symbol', source: 'notams', layout: { 'text-field': ['to-string', ['get', 'count']], 'text-font': ['Open Sans Semibold', 'Noto Sans Regular'], 'text-size': 11, 'text-allow-overlap': true }, paint: { 'text-color': '#fff', 'text-translate': [14, -14] } })
    map.addLayer({ id: 'airports', type: 'circle', source: 'airports', paint: { 'circle-radius': ['case', ['get', 'wp'], 5, 8], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': ['case', ['get', 'wp'], 2, 2.5] } })
    map.addLayer({ id: 'airport-labels', type: 'symbol', source: 'airports', layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold', 'Noto Sans Regular'], 'text-size': 13, 'text-offset': [0, 1.4], 'text-anchor': 'top' }, paint: { 'text-color': fg, 'text-halo-color': card, 'text-halo-width': 1.5 } })
    for (const layer of ['airports', 'metars', 'pireps', 'adv-fill', 'cwa-fill', 'tfr-fill', 'notams']) {
      map.on('click', layer, e => {
        const f = e.features?.[0]
        if (!f) return
        popup.current?.remove()
        popup.current = new maplibregl.Popup({ closeButton: true, maxWidth: '22rem', className: 'planner-pop' }).setLngLat(e.lngLat).setHTML(`<div style="font-size:13px;line-height:1.45;white-space:pre-wrap">${String(f.properties?.html ?? '')}</div>`).addTo(map)
      })
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
    }
    setReady(true)
  }

  // Data → sources.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
    const set = (id: string, fc: FC) => (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(fc)
    const line = (pts: Airport[], alt: boolean): GeoJSON.Feature => ({ type: 'Feature', properties: { alt }, geometry: { type: 'LineString', coordinates: pts.map(a => [a.lon, a.lat]) } })
    set('route', { type: 'FeatureCollection', features: [route.length > 1 ? line(route, false) : null, alternate && route.length ? line([route[route.length - 1], alternate], true) : null].filter(Boolean) as GeoJSON.Feature[] })
    const wxBy = new Map(d.wx.map(w => [w.airport.id, w]))
    set('airports', { type: 'FeatureCollection', features: [...route, ...(alternate ? [alternate] : [])].map((a, i, arr) => {
      const w = wxBy.get(a.id)
      const wp = isWaypoint(a)
      const role = a === alternate ? 'ALT' : i === 0 ? 'DEP' : i === arr.length - (alternate ? 2 : 1) ? 'DEST' : wp ? (a.navType || 'WAYPOINT') : 'STOP'
      if (wp) return { type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { wp: true, label: a.id, color: mapColor('--fg-2'), html: `<b>${esc(a.id)}</b> · ${esc(role)}<br>${esc(a.name)}${a.frequencies[0] ? `<br>${esc(a.frequencies[0].freq)}` : ''}<br>${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}` } }
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: {
        wp: false, label: `${a.icao || a.id}`, color: w?.category ? mapColor(catVar(w.category)) : mapColor('--fg-3'),
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
  const routeKey = [...route, alternate].map(a => a?.id).join(',')
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
        {LAYERS.map(l => (
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

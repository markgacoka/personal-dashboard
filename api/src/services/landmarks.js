// Visual checkpoints around a route for the planner's Route step: towns, peaks,
// lakes, highways, rivers and railroads from OpenStreetMap (OpenFreeMap vector
// tiles, zoom 10), power transmission lines of 115 kV and up (HIFLD), and
// obstacles 200 ft AGL and taller (FAA Digital Obstacle File, the towers a
// sectional charts). Tiles and boxes are cached in memory; none of these change
// quickly.
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { fetchWithTimeout } from '../lib/http.js'
import { cached } from './awc.js'

const Z = 10
const DAY = 24 * 3600_000
const HIFLD = 'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0/query'
const DOF = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services/Digital_Obstacle_File/FeatureServer/0/query'
export const SOURCES = 'OpenStreetMap (OpenFreeMap tiles), HIFLD transmission lines, FAA Digital Obstacle File'

const tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z)
const tileY = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z) }
const r5 = v => Math.round(v * 1e5) / 1e5

// Douglas–Peucker in degrees; enough to keep a highway's shape at chart scale.
export function simplify(pts, tol = 0.0008) {
  if (pts.length < 3) return pts
  const [a, b] = [pts[0], pts[pts.length - 1]]
  let max = 0, at = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1]
    const d = dx || dy ? Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy) : Math.hypot(p[0] - a[0], p[1] - a[1])
    if (d > max) { max = d; at = i }
  }
  return max > tol ? [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)] : [a, b]
}

const ROAD = { 'us-interstate': 'I-', 'us-highway': 'US ', 'us-state': 'Hwy ' }
// One decoded tile → { points, lines }. Pure apart from the decoder.
export function fromTile(buf, x, y) {
  const t = new VectorTile(new Pbf(buf))
  const points = [], lines = []
  const each = (name, fn) => { const l = t.layers[name]; if (l) for (let i = 0; i < l.length; i++) fn(l.feature(i)) }
  const geo = f => f.toGeoJSON(x, y, Z).geometry
  const parts = g => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [])
  const addLine = (kind, name, g) => { for (const c of parts(g)) { const s = simplify(c).map(([lo, la]) => [r5(lo), r5(la)]); if (s.length > 1) lines.push({ kind, name, coords: s }) } }
  const pt = (kind, name, g, extra = {}) => { if (g.type === 'Point') points.push({ kind, name, lat: r5(g.coordinates[1]), lon: r5(g.coordinates[0]), ...extra }) }
  each('place', f => { const p = f.properties; if (p.name && /^(city|town|village)$/.test(p.class)) pt('town', p.name, geo(f), { size: p.class }) })
  each('mountain_peak', f => { const p = f.properties; if (p.name && p.class === 'peak') pt('peak', p.name, geo(f), { ele: p.ele_ft ?? null }) })
  each('water_name', f => { const p = f.properties; if (p.name && /lake|reservoir/.test(p.class)) pt('lake', p.name, geo(f)) })
  each('transportation_name', f => {
    const p = f.properties
    if (!/^(motorway|trunk)$/.test(p.class) || p.subclass === 'junction' || !p.ref) return
    addLine('road', `${ROAD[p.network] ?? 'Hwy '}${p.ref}`, geo(f))
  })
  each('transportation', f => { const p = f.properties; if (p.class === 'rail' && p.brunnel !== 'tunnel') addLine('rail', 'Railroad', geo(f)) })
  each('waterway', f => { const p = f.properties; if (p.name && /river|canal/.test(p.class)) addLine('river', p.name, geo(f)) })
  return { points, lines }
}

const tileUrl = () => cached('ofm:tilejson', DAY, async () => {
  const r = await fetchWithTimeout('https://tiles.openfreemap.org/planet', { ms: 10000 })
  if (!r.ok) throw new Error(`OpenFreeMap ${r.status}`)
  return (await r.json()).tiles[0]
})

const osmTile = (x, y) => cached(`ofm:${Z}/${x}/${y}`, 7 * DAY, async () => {
  const url = (await tileUrl()).data.replace('{z}', Z).replace('{x}', x).replace('{y}', y)
  const r = await fetchWithTimeout(url, { ms: 15000 })
  if (r.status === 204 || r.status === 404) return { points: [], lines: [] }
  if (!r.ok) throw new Error(`OpenFreeMap tile ${r.status}`)
  return fromTile(Buffer.from(await r.arrayBuffer()), x, y)
})

async function arcgis(url, where, box, fields) {
  const out = []
  for (let offset = 0; offset < 6000; offset += 2000) {
    const qs = new URLSearchParams({ where, geometry: [box.west, box.south, box.east, box.north].join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326', outFields: fields, maxAllowableOffset: '0.0008', resultOffset: String(offset), resultRecordCount: '2000', f: 'geojson' })
    const r = await fetchWithTimeout(`${url}?${qs}`, { ms: 20000 })
    if (!r.ok) throw new Error(`ArcGIS ${r.status}`)
    const j = await r.json()
    out.push(...(j.features || []))
    if (!j.properties?.exceededTransferLimit) break
  }
  return out
}

const q4 = v => Math.round(v * 4) / 4
const powerLines = box => cached(`hifld:${[box.south, box.west, box.north, box.east].join(',')}`, 7 * DAY, async () =>
  (await arcgis(HIFLD, 'VOLTAGE >= 115', box, 'VOLTAGE')).flatMap(f => {
    const g = f.geometry, kv = Math.round(f.properties?.VOLTAGE)
    const parts = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : []
    return parts.map(c => ({ kind: 'power', name: `${kv} kV power line`, coords: c.map(([lo, la]) => [r5(lo), r5(la)]) }))
  }))
const obstacles = box => cached(`dof:${[box.south, box.west, box.north, box.east].join(',')}`, DAY, async () =>
  (await arcgis(DOF, 'AGL >= 200', box, 'Type_Code,AGL,AMSL,Lighting,City')).map(f => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates
    const type = String(p.Type_Code || 'Obstacle').trim().toLowerCase()
    return { kind: 'obstacle', name: `${type[0].toUpperCase()}${type.slice(1)} ${p.AMSL.toLocaleString()} MSL (${p.AGL} AGL)`, lat: r5(lat), lon: r5(lon), agl: p.AGL, amsl: p.AMSL, lit: p.Lighting && p.Lighting !== 'N' }
  }))

// Everything in a box (at most ~1.6° × 2.4°: about 12 × 8 zoom-10 tiles).
export async function landmarks(raw) {
  const box = { south: q4(raw.south - 0.125), west: q4(raw.west - 0.125), north: q4(raw.north + 0.125), east: q4(raw.east + 0.125) }
  const xs = [tileX(box.west, Z), tileX(box.east, Z)], ys = [tileY(box.north, Z), tileY(box.south, Z)]
  const tiles = []
  for (let x = xs[0]; x <= xs[1]; x++) for (let y = ys[0]; y <= ys[1]; y++) tiles.push([x, y])
  if (tiles.length > 120) throw Object.assign(new Error('Area too large'), { statusCode: 400 })
  const errors = []
  const settle = (p, what) => p.then(r => r.data ?? r, e => { errors.push(`${what}: ${e.message}`); return null })
  const [osm, power, obst] = await Promise.all([
    Promise.all(tiles.map(([x, y]) => settle(osmTile(x, y), 'OpenStreetMap'))),
    settle(powerLines(box), 'Power lines'),
    settle(obstacles(box), 'Obstacles'),
  ])
  const inside = p => p.lat >= box.south && p.lat <= box.north && p.lon >= box.west && p.lon <= box.east
  const seen = new Set()
  const points = [...osm.flatMap(t => t?.points ?? []), ...(obst ?? [])].filter(inside).filter(p => { const k = `${p.kind}|${p.name}|${p.lat.toFixed(2)}|${p.lon.toFixed(2)}`; if (seen.has(k)) return false; seen.add(k); return true })
  const lines = [...osm.flatMap(t => t?.lines ?? []), ...(power ?? [])]
  return { box, points, lines, errors: [...new Set(errors)], source: SOURCES }
}

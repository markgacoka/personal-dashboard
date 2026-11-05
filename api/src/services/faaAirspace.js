// FAA Class B/C/D airspace — the sectional-chart "Class Airspace" dataset:
// https://adds-faa.opendata.arcgis.com/datasets/c6a62360338e408cb1512366ad61559e_0
// (Not "Airspace Boundary", which covers ARTCC/FIR boundaries and has no
// Class B/C/D polygons.) Class A is omitted: it's a nationwide shell above
// FL180 and useless on a local flight map.
import { createFeatureLayer } from './featureLayer.js'

const layer = createFeatureLayer({
  name: 'faa-airspace',
  label: 'FAA class airspace',
  baseUrl: 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0',
  fields: 'NAME,LOWER_VAL,UPPER_VAL,TYPE_CODE,LOCAL_TYPE,CLASS',
  where: "CLASS IN ('B','C','D')",
  // Polygons are vertex-heavy: 1000-record pages ran to tens of MB and timed
  // out on this host's path to the service. Small pages plus 5-decimal
  // coordinates (~1 m, far finer than a boundary line needs) stay fast.
  pageSize: 250,
  extraParams: '&outSR=4326&geometryPrecision=5',
  timeoutMs: 45_000,
  legacyFile: 'faa-airspace.json',
})

export const sendFaaAirspace = layer.send
export const scheduleFaaAirspaceRefresh = layer.scheduleRefresh

// The nationwide layer is ~90 MB of GeoJSON. The planner only needs the
// polygons near a route: index each feature by its bounding box once per
// layer version (kept as JSON text, not objects, to hold memory down) and
// answer box queries from that.
let index = null
export async function airspaceIn(box, log) {
  const gz = await layer.getGzip(log)
  if (index?.gz !== gz) {
    const { gunzipSync } = await import('zlib')
    const fc = JSON.parse(gunzipSync(gz).toString('utf8'))
    const items = []
    for (const f of fc.features || []) {
      const g = f.geometry
      if (!g) continue
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
      for (const p of polys) for (const ring of p) for (const [x, y] of ring) { if (x < w) w = x; if (y < s) s = y; if (x > e) e = x; if (y > n) n = y }
      if (Number.isFinite(w)) items.push({ w, s, e, n, json: JSON.stringify(f) })
    }
    index = { gz, items }
  }
  const hits = index.items.filter(i => i.w <= box.east && i.e >= box.west && i.s <= box.north && i.n >= box.south)
  return `{"type":"FeatureCollection","features":[${hits.map(i => i.json).join(',')}]}`
}

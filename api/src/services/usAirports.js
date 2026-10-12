// US public-use airports — nationwide reference layer for flight maps, from
// the FAA ArcGIS US_Airport FeatureServer (NASR data, 28-day cadence).
import { gunzip } from 'zlib'
import { promisify } from 'util'
import { createFeatureLayer } from './featureLayer.js'

const layer = createFeatureLayer({
  name: 'us-airports',
  label: 'US airports',
  baseUrl: 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0',
  fields: 'IDENT,ICAO_ID,NAME,SERVCITY,STATE',
  // Fixed-wing, public-use, operational only: heliports, gliderports, and
  // closed or private strips are noise on a GA flight-log map.
  where: "TYPE_CODE='AD' AND PRIVATEUSE=0 AND OPERSTATUS='OPERATIONAL'",
  pageSize: 1000,
  extraParams: '&geometryPrecision=4',
  timeoutMs: 30_000,
  legacyFile: 'us-airports.json',
})

export const sendUsAirports = layer.send

// [{ icao, name, lat, lon }] for nearest-airport lookups (parsed once).
let parsed = null
export async function usAirportList(log) {
  if (parsed) return parsed
  const fc = JSON.parse(await promisify(gunzip)(await layer.getGzip(log)))
  parsed = fc.features.filter(f => f.geometry?.coordinates).map(f => ({
    icao: f.properties.ICAO_ID || (f.properties.IDENT && f.properties.IDENT.length === 3 ? 'K' + f.properties.IDENT : f.properties.IDENT),
    name: f.properties.NAME, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
  }))
  return parsed
}
export const scheduleUsAirportsRefresh = layer.scheduleRefresh

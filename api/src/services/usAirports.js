// US public-use airports — nationwide reference layer for flight maps, from
// the FAA ArcGIS US_Airport FeatureServer (NASR data, 28-day cadence).
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
export const scheduleUsAirportsRefresh = layer.scheduleRefresh

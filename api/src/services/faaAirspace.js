// FAA Class B/C/D airspace — the sectional-chart "Class Airspace" dataset:
// https://adds-faa.opendata.arcgis.com/datasets/c6a62360338e408cb1512366ad61559e_0
// (Not "Airspace Boundary", which covers ARTCC/FIR boundaries and has no
// Class B/C/D polygons.) Class A is omitted: it's a nationwide shell above
// FL180 and useless on a local flight map.
import { createFeatureLayer } from './featureLayer.js'

const layer = createFeatureLayer({
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
  fileName: 'faa-airspace.json',
})

export const getFaaAirspace = layer.get
export const scheduleFaaAirspaceRefresh = layer.scheduleRefresh

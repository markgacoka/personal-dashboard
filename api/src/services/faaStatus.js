// FAA operational status for the flight planner: NAS airport status (ground
// stops, ground delay programs, departure/arrival delays, closures) from
// nasstatus.faa.gov, and temporary flight restrictions from tfr.faa.gov (the
// list carries type and dates, the WFS layer the shapes).
import { fetchWithTimeout } from '../lib/http.js'
import { cached } from './awc.js'

const MIN = 60_000
const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? null
const all = (xml, name) => [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'g'))].map(m => m[1])

// Pure: the XML feed → one entry per affected airport and program.
export function parseNasStatus(xml) {
  const out = []
  for (const block of all(xml, 'Delay_type')) {
    for (const d of all(block, 'Ground_Delay')) out.push({ airport: tag(d, 'ARPT'), kind: 'Ground delay', reason: tag(d, 'Reason'), detail: `avg ${tag(d, 'Avg')}, max ${tag(d, 'Max')}` })
    for (const d of all(block, 'Program')) out.push({ airport: tag(d, 'ARPT'), kind: 'Ground stop', reason: tag(d, 'Reason'), detail: tag(d, 'End_Time') ? `until ${tag(d, 'End_Time')}` : '' })
    for (const d of all(block, 'Delay')) {
      const ad = d.match(/<Arrival_Departure Type="(\w+)">([\s\S]*?)<\/Arrival_Departure>/)
      out.push({ airport: tag(d, 'ARPT'), kind: `${ad?.[1] || 'Arrival/departure'} delay`, reason: tag(d, 'Reason'), detail: ad ? `${tag(ad[2], 'Min')}–${tag(ad[2], 'Max')}, ${tag(ad[2], 'Trend')?.toLowerCase()}` : '' })
    }
    for (const d of all(block, 'Airport')) out.push({ airport: tag(d, 'ARPT'), kind: 'Closure', reason: tag(d, 'Reason'), detail: [tag(d, 'Start'), tag(d, 'Reopen') && `reopens ${tag(d, 'Reopen')}`].filter(Boolean).join(' ') })
  }
  return { updated: tag(xml, 'Update_Time'), items: out.filter(i => i.airport) }
}

export const nasStatus = () => cached('nasstatus', 5 * MIN, async () => {
  const r = await fetchWithTimeout('https://nasstatus.faa.gov/api/airport-status-information', { ms: 12000 })
  if (!r.ok) throw new Error(`NAS status ${r.status}`)
  return parseNasStatus(await r.text())
})

export const tfrs = () => cached('tfrs', 15 * MIN, async () => {
  const [list, shapes] = await Promise.all([
    fetchWithTimeout('https://tfr.faa.gov/tfrapi/exportTfrList', { ms: 15000 }).then(r => (r.ok ? r.json() : [])),
    fetchWithTimeout('https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json&srsname=EPSG:4326', { ms: 20000 })
      .then(r => (r.ok ? r.json() : { features: [] })),
  ])
  const byId = new Map(list.map(t => [t.notam_id, t]))
  return (shapes.features || []).map(f => {
    const id = String(f.properties?.NOTAM_KEY || '').split('-')[0]
    const t = byId.get(id)
    return {
      type: 'Feature', geometry: f.geometry,
      properties: { id, kind: t?.type || f.properties?.LEGAL || 'TFR', title: f.properties?.TITLE || t?.description || id, description: t?.description || '', facility: t?.facility || f.properties?.CNS_LOCATION_ID || '', state: t?.state || f.properties?.STATE || '' },
    }
  }).filter(f => f.geometry)
})

export const datis = icao => cached(`datis:${icao}`, 2 * MIN, async () => {
  const r = await fetchWithTimeout(`https://atis.info/api/${icao}`, { ms: 10000 })
  if (!r.ok) return []
  const d = await r.json()
  return Array.isArray(d) ? d.map(a => ({ type: a.type, code: a.code, text: a.datis, time: a.time, updatedAt: a.updatedAt })) : []
})

// Terrain along the route (Open-Meteo elevation, Copernicus 90 m DEM), in feet.
export async function elevations(points) {
  const out = []
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100)
    const key = `elev:${chunk.map(([la, lo]) => `${la.toFixed(3)},${lo.toFixed(3)}`).join(';')}`
    const { data } = await cached(key, 24 * 60 * MIN, async () => {
      const q = `latitude=${chunk.map(p => p[0].toFixed(4)).join(',')}&longitude=${chunk.map(p => p[1].toFixed(4)).join(',')}`
      const r = await fetchWithTimeout(`https://api.open-meteo.com/v1/elevation?${q}`, { ms: 12000 })
      if (!r.ok) throw new Error(`elevation ${r.status}`)
      return (await r.json()).elevation.map(m => Math.round(m * 3.28084))
    })
    out.push(...data)
  }
  return out
}

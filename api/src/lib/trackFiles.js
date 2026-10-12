// Parse a GPS track file the owner recorded (GPX, KML with gx:Track, or a
// ForeFlight-style CSV) into normalized points. Altitudes become feet.
import { parseCsvLine } from './csv.js'

const M_TO_FT = 3.28084
const num = v => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : null)
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`)); return m ? m[1].trim() : null }

function parseGpx(xml) {
  const pts = []
  for (const m of xml.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
    const lat = num(m[1].match(/lat="([^"]+)"/)?.[1]), lon = num(m[1].match(/lon="([^"]+)"/)?.[1])
    const time = tag(m[2], 'time'), ele = num(tag(m[2], 'ele'))
    const speed = num(tag(m[2], 'speed')) // m/s, when the recorder writes it
    if (lat == null || lon == null || !time) continue
    pts.push({ ts: new Date(time).toISOString(), lat, lon, altitude_ft: ele != null ? Math.round(ele * M_TO_FT) : null, groundspeed_kts: speed != null ? Math.round(speed * 1.94384) : null })
  }
  return pts
}

function parseKml(xml) {
  const whens = [...xml.matchAll(/<when>([^<]+)<\/when>/g)].map(m => m[1].trim())
  const coords = [...xml.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)].map(m => m[1].trim().split(/\s+/).map(Number))
  return whens.slice(0, coords.length).map((w, i) => {
    const [lon, lat, alt] = coords[i]
    return { ts: new Date(w).toISOString(), lat, lon, altitude_ft: Number.isFinite(alt) ? Math.round(alt * M_TO_FT) : null }
  }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  const rows = lines.map(l => parseCsvLine(l, { trim: true }))
  const header = rows[0].map(h => h.toLowerCase())
  const isHeader = header.some(h => /timestamp|time|lat/.test(h))
  const col = (re, fallback) => (isHeader ? header.findIndex(h => re.test(h)) : fallback)
  const ts = col(/timestamp|^time|date/, 0), lat = col(/lat/, 1), lon = col(/lon|lng/, 2), alt = col(/alt/, 3)
  const spd = col(/speed|spd/, 4), trk = col(/course|track|heading/, 5)
  return (isHeader ? rows.slice(1) : rows).map(r => {
    const t = r[ts]
    const when = /^\d{9,}(\.\d+)?$/.test(t) ? new Date(+t * (t.length > 11 ? 1 : 1000)) : new Date(t)
    return { ts: isNaN(+when) ? null : when.toISOString(), lat: num(r[lat]), lon: num(r[lon]), altitude_ft: alt >= 0 ? num(r[alt]) : null, groundspeed_kts: spd >= 0 ? num(r[spd]) : null, track_deg: trk >= 0 ? num(r[trk]) : null }
  }).filter(p => p.ts && p.lat != null && p.lon != null)
}

export function parseTrackFile(text) {
  const head = text.slice(0, 2000)
  if (/<gpx[\s>]/i.test(head)) return { format: 'GPX', points: parseGpx(text) }
  if (/<kml[\s>]/i.test(head)) return { format: 'KML', points: parseKml(text) }
  return { format: 'CSV', points: parseCsv(text) }
}

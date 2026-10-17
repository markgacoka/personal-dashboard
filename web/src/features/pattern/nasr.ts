// FAA NASR airport records (from /api/pattern/*) turned into the trainer's
// Airport shape: real runway-end coordinates, rotated so magnetic north is up.
import type { Airport } from './airports'
import { bearing, norm360, NM_FT, type Pt, type RunwayDef } from './geo'

export interface NasrEnd { id: string; trueHdg: number | null; right: boolean; lat: number | null; lon: number | null; elev: number | null; displaced: number; vgsi: string | null; lda: number | null }
export interface NasrRunway { id: string; len: number; wid: number | null; surface: string | null; cond: string | null; lights: string | null; ends: NasrEnd[] }
export interface NasrFreq { use: string; freq: string; call: string | null; hrs: string | null; sector: string | null }
export interface NasrAirport {
  id: string; icao: string | null; name: string; city: string; state: string; lat: number; lon: number
  elev: number; tpaAgl: number | null; magVar: number; use: string; towered: boolean; towerCall: string | null; towerHrs: string | null
  segCircle: boolean; windIndicator: string | null; lights: string | null
  frequencies: NasrFreq[]; wx: { id: string; type: string; freq: string | null; phone: string | null; distNm: number } | null
  runways: NasrRunway[]; remarks: string[]
  airspace: { B: boolean; C: boolean; D: boolean; E: boolean; hrs: string | null } | null
  cycle: string
}
export interface NasrSummary { id: string; icao: string | null; name: string; city: string; state: string; public: boolean; towered: boolean; suitable: boolean }

const SMALL = new Set(['OF', 'THE', 'AND', 'AT'])
export const titleCase = (s: string) => s.toLowerCase().replace(/[a-z]+('[a-z])?/g, (w, _a, i) => (i > 0 && SMALL.has(w.toUpperCase()) ? w : w[0].toUpperCase() + w.slice(1)))
export const ident = (r: Pick<NasrAirport, 'id' | 'icao'>) => r.icao || r.id

// What pilots call the field on CTAF: the airport name without the generic words, else the city.
export function spokenName(r: Pick<NasrAirport, 'name' | 'city'>) {
  const n = r.name.split(/ OF |\//)[0]
    .replace(/\b(MUNI(CIPAL)?|RGNL|REGIONAL|INTL|INTERNATIONAL|AIRPORT|ARPT|COUNTY|CO|MEMORIAL|MEML|EXECUTIVE|EXEC|AIRPARK|FLD|FIELD|INDUSTRIAL|AIRFIELD|JETPORT|STRIP)\b/g, '')
    .replace(/\s+/g, ' ').trim()
  return titleCase(n.length >= 3 ? n : r.city)
}

export const sameRwy = (a: string, b: string) => a.replace(/^0+/, '') === b.replace(/^0+/, '')

const NAMED: Record<string, number> = { N: 360, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 }

export function toAirport(r: NasrAirport): Airport {
  const cos = Math.cos((r.lat * Math.PI) / 180)
  const th = (r.magVar * Math.PI) / 180
  const local = (lat: number, lon: number): Pt => {
    const x = (lon - r.lon) * 60 * cos, y = (lat - r.lat) * 60
    return [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)]
  }
  const runways: RunwayDef[] = r.runways.map((rw, i) => {
    const [a, b] = rw.ends
    const pa = a.lat != null && a.lon != null ? local(a.lat, a.lon) : null
    const pb = b.lat != null && b.lon != null ? local(b.lat, b.lon) : null
    const fromId = /^\d/.test(a.id) ? (parseInt(a.id) * 10 || 360) : NAMED[a.id] ?? 0
    const hdg = pa && pb ? Math.round(bearing(pa, pb)) : a.trueHdg != null ? Math.round(norm360(a.trueHdg - r.magVar)) : fromId
    const center: Pt = pa && pb ? [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2] : [i * 0.12, -i * 0.12]
    return {
      ends: [a.id, b.id], hdg: hdg || 360, lengthFt: rw.len, widthFt: rw.wid || 60, center,
      traffic: [a.right ? 'R' : 'L', b.right ? 'R' : 'L'], displacedFt: [a.displaced || 0, b.displaced || 0],
    }
  })
  const longest = runways.slice().sort((a, b) => b.lengthFt - a.lengthFt)[0]
  const perp: Pt = longest ? [Math.cos((longest.hdg * Math.PI) / 180), -Math.sin((longest.hdg * Math.PI) / 180)] : [1, 0]
  const lab = (f: NasrFreq) => f.use === 'CTAF' ? 'CTAF' : f.use === 'UNICOM' ? 'UNICOM' : f.use.startsWith('LCL') ? `Tower${f.sector ? ` ${f.sector.replace(/^RWY /, '')}` : ''}` : f.use.startsWith('GND') ? 'Ground' : f.use.includes('ATIS') ? 'ATIS' : f.use === 'CD/P' ? 'Clearance' : f.use.startsWith('APCH') || f.use.startsWith('CLASS') ? `Approach${f.sector ? ` (${f.sector})` : ''}` : f.use
  const seen = new Set<string>()
  const freqs = r.frequencies.map(f => ({ label: lab(f), mhz: f.freq, note: f.hrs || undefined })).filter(f => { const k = f.label + f.mhz; if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 9)
  if (r.wx?.freq || r.wx?.phone) freqs.push({ label: `${r.wx.type}${r.wx.distNm ? ` (${r.wx.id}, ${r.wx.distNm} nm)` : ''}`, mhz: r.wx.freq || '—', note: r.wx.phone || undefined })
  return {
    icao: ident(r), name: titleCase(r.name), city: `${titleCase(r.city)}, ${r.state}`, elev: Math.round(r.elev),
    tpa: Math.round(r.elev + (r.tpaAgl ?? 1000)),
    tpaNote: r.tpaAgl ? `${r.tpaAgl.toLocaleString()} ft AGL, published` : '1,000 ft AGL; not published, AC 90-66 default',
    towered: r.towered, freqs,
    wx: r.wx ? { kind: r.wx.type, mhz: r.wx.freq || undefined, phone: r.wx.phone || undefined, station: r.wx.id, distNm: r.wx.distNm } : null,
    runways,
    circle: r.segCircle && longest ? [longest.center[0] + perp[0] * 0.18, longest.center[1] + perp[1] * 0.18] : undefined,
    remarks: [...(r.towerHrs ? [`TWR ${r.towerHrs}.`] : []), ...r.remarks],
    classD: r.airspace?.D ? 4 : undefined,
    surveyed: r.runways.every(rw => rw.ends.every(e => e.lat != null)),
  }
}

export const lengthNm = (ft: number) => ft / NM_FT

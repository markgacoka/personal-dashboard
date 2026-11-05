// Points you could add to the route, leg by leg: NASR airports, VFR waypoints,
// VORs and fixes near the line, landmarks near it (towns, peaks, lakes, towers
// 200 ft AGL and up) and where the line crosses a highway, river, railroad or
// power line. Pure; positions use a flat projection per leg (fine at these
// distances).
import type { LatLon } from './calc'
import type { Checkpoint } from './model'
import { coordToken } from './route'

export interface Landmarks {
  points: { kind: 'town' | 'peak' | 'lake' | 'obstacle'; name: string; lat: number; lon: number; ele?: number | null; agl?: number; amsl?: number; size?: string; lit?: boolean }[]
  lines: { kind: 'road' | 'rail' | 'river' | 'power'; name: string; coords: [number, number][] }[]
  errors: string[]; source: string
}
export type SuggestKind = 'airport' | 'vfr' | 'navaid' | 'fix' | 'town' | 'road' | 'river' | 'rail' | 'power' | 'lake' | 'peak' | 'obstacle'
export interface Suggestion {
  key: string; token: string; label: string; name: string; kind: SuggestKind; lat: number; lon: number
  leg: number; alongNm: number; offNm: number; detail: string; nasr: boolean
}

export const SUGGEST_KIND: Record<SuggestKind, { label: string; color: string }> = {
  airport: { label: 'Airports', color: '#3a6fd8' },
  vfr: { label: 'VFR waypoints', color: '#c2397a' },
  navaid: { label: 'VORs', color: '#2f8f6a' },
  fix: { label: 'RNAV fixes', color: '#7a7a7a' },
  town: { label: 'Towns', color: '#b8691c' },
  road: { label: 'Highways', color: '#e0782b' },
  river: { label: 'Rivers', color: '#2f86d6' },
  rail: { label: 'Railroads', color: '#555555' },
  power: { label: 'Power lines', color: '#9a4fd0' },
  lake: { label: 'Lakes', color: '#1f9fb8' },
  peak: { label: 'Peaks', color: '#7d5a3a' },
  obstacle: { label: 'Towers', color: '#d43c3c' },
}

const NASR_KIND = { airport: 'airport', vfr: 'vfr', navaid: 'navaid', fix: 'fix' } as const

function frame(a: LatLon, b: LatLon) {
  const lat0 = (a.lat + b.lat) / 2, k = 60 * Math.cos((lat0 * Math.PI) / 180)
  const xy = (p: LatLon): [number, number] => [(p.lon - a.lon) * k, (p.lat - a.lat) * 60]
  const back = ([x, y]: [number, number]): LatLon => ({ lat: a.lat + y / 60, lon: a.lon + x / k })
  const B = xy(b), len = Math.hypot(B[0], B[1])
  // t along (0 at a, 1 at b); off in nm, + to the right of the course.
  const place = (p: LatLon) => { const [x, y] = xy(p); return { t: (x * B[0] + y * B[1]) / (len * len), off: (x * B[1] - y * B[0]) / len } }
  return { xy, back, B, len, place }
}

export function suggest(route: (LatLon & { id: string })[], checkpoints: Checkpoint[], lm: Landmarks | null | undefined, maxOff = 5): Suggestion[] {
  const out: Suggestion[] = []
  const onRoute = new Set(route.map(r => r.id))
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i]
    const f = frame(a, b)
    if (f.len < 2) continue
    const ok = (t: number, off: number) => t > 0.02 && t < 0.98 && Math.abs(off) <= maxOff
    for (const c of checkpoints) {
      if (onRoute.has(c.id)) continue
      const { t, off } = f.place(c)
      if (!ok(t, off)) continue
      const kind = NASR_KIND[c.kind ?? 'airport']
      out.push({ key: `${i}:n:${c.id}`, token: c.id, label: c.icao || c.id, name: c.name, kind, lat: c.lat, lon: c.lon, leg: i, alongNm: t * f.len, offNm: off, nasr: true,
        detail: `${SUGGEST_KIND[kind].label.replace(/s$/, '')}${c.type && kind === 'navaid' ? ` (${c.type})` : ''}${c.freq ? ` · ${c.freq}` : ''}` })
    }
    for (const p of lm?.points ?? []) {
      const { t, off } = f.place(p)
      if (!ok(t, off) || (p.kind === 'obstacle' && Math.abs(off) > 3)) continue
      const label = p.kind === 'obstacle' ? `Tower ${p.amsl}` : p.name
      const detail = p.kind === 'obstacle' ? `${p.name}${p.lit ? ' · lighted' : ''}` : p.kind === 'peak' ? `Peak${p.ele ? ` ${p.ele.toLocaleString()} ft` : ''}` : p.kind === 'town' ? `${p.size === 'city' ? 'City' : p.size === 'town' ? 'Town' : 'Village'}` : 'Lake'
      out.push({ key: `${i}:p:${p.kind}:${p.lat},${p.lon}`, token: coordToken(p), label, name: p.name, kind: p.kind, lat: p.lat, lon: p.lon, leg: i, alongNm: t * f.len, offNm: off, nasr: false, detail })
    }
    // Where the leg crosses a line feature (one per name every 1.5 nm along the leg).
    const crossings: Suggestion[] = []
    for (const l of lm?.lines ?? []) {
      for (let k = 1; k < l.coords.length; k++) {
        const P = f.xy({ lon: l.coords[k - 1][0], lat: l.coords[k - 1][1] }), Q = f.xy({ lon: l.coords[k][0], lat: l.coords[k][1] })
        const d = [Q[0] - P[0], Q[1] - P[1]] as const
        const den = f.B[0] * d[1] - f.B[1] * d[0]
        if (Math.abs(den) < 1e-9) continue
        const t = (P[0] * d[1] - P[1] * d[0]) / den, u = (P[0] * f.B[1] - P[1] * f.B[0]) / den
        if (t <= 0.02 || t >= 0.98 || u < 0 || u > 1) continue
        const along = t * f.len
        if (crossings.some(c => c.kind === l.kind && c.name === l.name && Math.abs(c.alongNm - along) < 1.5)) continue
        const pt = f.back([f.B[0] * t, f.B[1] * t])
        const lat = Math.round(pt.lat * 1e5) / 1e5, lon = Math.round(pt.lon * 1e5) / 1e5
        crossings.push({ key: `${i}:x:${l.kind}:${l.name}:${along.toFixed(1)}`, token: coordToken({ lat, lon }), label: l.kind === 'power' ? 'Power line' : l.name, name: l.name, kind: l.kind, lat, lon, leg: i, alongNm: along, offNm: 0, nasr: false,
          detail: `${l.kind === 'road' ? 'Highway' : l.kind === 'river' ? 'River' : l.kind === 'rail' ? 'Railroad' : l.name} crossing` })
      }
    }
    out.push(...crossings)
  }
  return out.sort((x, y) => x.leg - y.leg || x.alongNm - y.alongNm)
}

export type Candidate = Pick<Suggestion, 'token' | 'label' | 'kind' | 'name' | 'lat' | 'lon' | 'detail'>
// Everything a dragged point can snap to on the map: every NASR point and
// landmark in the area (not only those near the current line), plus the
// current line's crossings.
export function candidates(checkpoints: Checkpoint[], lm: Landmarks | null | undefined, sugg: Suggestion[]): Candidate[] {
  const out = new Map<string, Candidate>()
  for (const c of checkpoints) {
    const kind = NASR_KIND[c.kind ?? 'airport']
    out.set(c.id, { token: c.id, label: c.icao || c.id, kind, name: c.name, lat: c.lat, lon: c.lon, detail: `${SUGGEST_KIND[kind].label.replace(/s$/, '')}${c.freq ? ` · ${c.freq}` : ''}` })
  }
  for (const p of lm?.points ?? []) {
    const tok = coordToken(p)
    out.set(tok, { token: tok, label: p.kind === 'obstacle' ? `Tower ${p.amsl}` : p.name, kind: p.kind, name: p.name, lat: p.lat, lon: p.lon, detail: p.kind === 'obstacle' ? p.name : p.kind === 'peak' ? `Peak${p.ele ? ` ${p.ele.toLocaleString()} ft` : ''}` : p.kind === 'town' ? 'Town' : 'Lake' })
  }
  for (const s of sugg) if (!s.nasr && ['road', 'river', 'rail', 'power'].includes(s.kind)) out.set(s.token, s)
  return [...out.values()]
}

export const kindName = (k: string) => { const l = SUGGEST_KIND[k as SuggestKind]?.label; return l ? (k === 'fix' ? 'RNAV fix' : l.replace(/s$/, '')) : k }

// The planner's arithmetic: atmosphere, POH table interpolation, wind
// components, the wind triangle, weight and balance, fuel, and the geometry
// that decides which advisories touch the route. Pure functions only.
import type { AircraftProfile, DistanceTable } from './poh'
import { magvar } from 'magvar'

// ── Atmosphere ────────────────────────────────────────────────────────────────
export const pressureAltitude = (elevFt: number, altimInHg: number) => Math.round(elevFt + (29.92 - altimInHg) * 1000)
export const isaTemp = (paFt: number) => 15 - 2 * (paFt / 1000)
export const densityAltitude = (paFt: number, oatC: number) => Math.round(paFt + 120 * (oatC - isaTemp(paFt)))
export const hPaToInHg = (hpa: number) => hpa * 0.0295300

// ── Interpolation ─────────────────────────────────────────────────────────────
function bracket(xs: number[], x: number): [number, number, number] {
  if (x <= xs[0]) return [0, 0, 0]
  if (x >= xs[xs.length - 1]) return [xs.length - 1, xs.length - 1, 0]
  const i = xs.findIndex(v => v > x) - 1
  return [i, i + 1, (x - xs[i]) / (xs[i + 1] - xs[i])]
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export interface TableResult { ground: number; total: number; clamped: string[] }

// Bilinear in pressure altitude × temperature. Values below the table's lowest
// row/column use that row/column (the POH's sea level / 0 °C); above the
// highest, or in a blank cell, there is no answer.
export function tableAt(t: DistanceTable, pa: number, temp: number): TableResult | null {
  const clamped: string[] = []
  if (pa > t.pa[t.pa.length - 1] || temp > t.temps[t.temps.length - 1]) return null
  if (pa < t.pa[0]) clamped.push('pressure altitude below sea level row')
  if (temp < t.temps[0]) clamped.push(`temperature below ${t.temps[0]} °C column`)
  const [p0, p1, pt] = bracket(t.pa, pa), [c0, c1, ct] = bracket(t.temps, temp)
  const cells = [t.rows[p0][c0], t.rows[p0][c1], t.rows[p1][c0], t.rows[p1][c1]]
  if (cells.some(c => !c)) return null
  const [a, b, c, d] = cells as [number, number][]
  const at = (k: 0 | 1) => lerp(lerp(a[k], b[k], ct), lerp(c[k], d[k], ct), pt)
  return { ground: at(0), total: at(1), clamped }
}

// Across the takeoff sheets (2400/2200/2000 lb): linear in weight. Below the
// lightest sheet the lightest is used (conservative); above the heaviest the
// heaviest is used and flagged.
export function distanceAt(tables: DistanceTable[], weight: number, pa: number, temp: number): TableResult | null {
  const sorted = [...tables].sort((a, b) => a.weight - b.weight)
  const ws = sorted.map(t => t.weight)
  const [i0, i1, f] = bracket(ws, weight)
  const r0 = tableAt(sorted[i0], pa, temp), r1 = tableAt(sorted[i1], pa, temp)
  if (!r0 || !r1) return null
  const clamped = [...new Set([...r0.clamped, ...r1.clamped])]
  if (weight > ws[ws.length - 1]) clamped.push(`weight above the ${ws[ws.length - 1]} lb chart`)
  return { ground: lerp(r0.ground, r1.ground, f), total: lerp(r0.total, r1.total, f), clamped }
}

export interface Corrections { headwindPer9kt: number; tailwindPer2kt: number; grassGroundRoll: number }

// POH notes: −10 % per 9 kt headwind; +10 % per 2 kt tailwind (to 10 kt); on
// dry grass add a share of the ground roll (to both roll and total).
export function corrected(r: TableResult, headwind: number, grass: boolean, n: Corrections) {
  const f = headwind >= 0 ? 1 - n.headwindPer9kt * (headwind / 9) : 1 + n.tailwindPer2kt * (-headwind / 2)
  const ground = r.ground * f, extra = grass ? ground * n.grassGroundRoll : 0
  return { ground: Math.round(ground + extra), total: Math.round(r.total * f + extra), tailwindOverLimit: headwind < -10 }
}

// ── Wind ─────────────────────────────────────────────────────────────────────
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
export const norm360 = (d: number) => ((d % 360) + 360) % 360

// Headwind (+) / tailwind (−) and crosswind (+ from the right) for a heading.
export function windComponents(windFrom: number | null, speed: number, heading: number) {
  if (windFrom == null || !speed) return { head: 0, cross: 0 }
  const a = rad(windFrom - heading)
  return { head: Math.round(speed * Math.cos(a)) || 0, cross: Math.round(speed * Math.sin(a)) || 0 }
}

// Wind triangle: true course + TAS + wind (from, kt) → wind correction angle, true heading, ground speed.
export function windTriangle(tc: number, tas: number, windFrom: number | null, windSpd: number) {
  if (windFrom == null || !windSpd || !tas) return { wca: 0, th: norm360(tc), gs: tas }
  const wta = rad(windFrom - tc)
  const s = (windSpd * Math.sin(wta)) / tas
  if (Math.abs(s) >= 1) return { wca: NaN, th: NaN, gs: 0 }
  const wca = Math.asin(s)
  const gs = tas * Math.cos(wca) - windSpd * Math.cos(wta)
  return { wca: deg(wca), th: norm360(tc + deg(wca)), gs }
}

// Magnetic = true − easterly variation ("east is least"); variation east-positive.
export const toMagnetic = (trueDeg: number, varEast: number) => norm360(trueDeg - varEast)
// Magnetic variation (east +) from the World Magnetic Model 2025 on the flight
// date. NASR's per-airport figures keep their survey epoch (Reid-Hillview's is
// 1975: 16°E, against about 13°E today), so they aren't used for headings.
export const variationAt = (p: { lat: number; lon: number }, when: Date) => magvar(p.lat, p.lon, 0, when)

// ── Geodesy ──────────────────────────────────────────────────────────────────
export interface LatLon { lat: number; lon: number }
const R_NM = 3440.065
export function distanceNm(a: LatLon, b: LatLon) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(s)))
}
export function initialCourse(a: LatLon, b: LatLon) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon))
  return norm360(deg(Math.atan2(y, x)))
}
export function intermediate(a: LatLon, b: LatLon, f: number): LatLon {
  return { lat: lerp(a.lat, b.lat, f), lon: lerp(a.lon, b.lon, f) } // legs are short; linear is within chart accuracy
}
// Points every `stepNm` along a polyline.
export function sampleRoute(pts: LatLon[], stepNm = 2): LatLon[] {
  const out: LatLon[] = []
  for (let i = 1; i < pts.length; i++) {
    const n = Math.max(1, Math.ceil(distanceNm(pts[i - 1], pts[i]) / stepNm))
    for (let k = 0; k < n; k++) out.push(intermediate(pts[i - 1], pts[i], k / n))
  }
  if (pts.length) out.push(pts[pts.length - 1])
  return out
}
export function pointInPolygon(p: LatLon, ring: [number, number][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
// Does a polygon ([lon, lat] ring) touch the corridor around the sampled route?
export function touchesCorridor(samples: LatLon[], ring: [number, number][], corridorNm: number) {
  if (samples.some(p => pointInPolygon(p, ring))) return true
  return ring.some(([lon, lat]) => samples.some(p => distanceNm(p, { lat, lon }) <= corridorNm))
}

// ── Cruise and climb (POH tables) ────────────────────────────────────────────
export function cruiseAt(p: AircraftProfile, pa: number, isaDev: number, rpm: number) {
  const rpms = [...new Set(p.cruise.map(r => r.rpm))]
  const use = rpms.reduce((a, b) => (Math.abs(b - rpm) < Math.abs(a - rpm) ? b : a))
  const rows = p.cruise.filter(r => r.rpm === use).sort((a, b) => a.pa - b.pa)
  if (!rows.length) return null
  const col = (r: (typeof rows)[number]) => {
    const [i0, i1, f] = bracket([-20, 0, 20], isaDev)
    const a = r.cols[i0] ?? r.cols[1], b = r.cols[i1] ?? r.cols[1]
    if (!a || !b) return null
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)] as const
  }
  const pas = rows.map(r => r.pa)
  const [i0, i1, f] = bracket(pas, pa)
  const a = col(rows[i0]), b = col(rows[i1])
  if (!a || !b) return null
  return { rpm: use, bhp: Math.round(lerp(a[0], b[0], f)), ktas: Math.round(lerp(a[1], b[1], f)), gph: Math.round(lerp(a[2], b[2], f) * 10) / 10, belowTable: pa < pas[0] }
}

// Fig. 5-7 is from sea level: climb from A to B is (B − A); +10 % per 10 °C above standard.
export function climbBetween(p: AircraftProfile, fromPa: number, toPa: number, isaDev: number) {
  if (toPa <= fromPa) return { min: 0, gal: 0, nm: 0 }
  const at = (pa: number) => {
    const xs = p.climb.map(r => r.pa), [i0, i1, f] = bracket(xs, pa)
    const a = p.climb[i0], b = p.climb[i1]
    return { min: lerp(a.min, b.min, f), gal: lerp(a.gal, b.gal, f), nm: lerp(a.nm, b.nm, f) }
  }
  const a = at(Math.max(0, fromPa)), b = at(toPa), k = 1 + Math.max(0, isaDev) / 100
  return { min: (b.min - a.min) * k, gal: (b.gal - a.gal) * k, nm: (b.nm - a.nm) * k }
}

// ── Weight and balance ───────────────────────────────────────────────────────
export interface WbItem { label: string; weight: number; arm: number }
export function wbTotal(items: WbItem[]) {
  const weight = items.reduce((s, i) => s + i.weight, 0)
  const moment = items.reduce((s, i) => s + i.weight * i.arm, 0)
  return { weight, moment, cg: weight ? moment / weight : 0 }
}
// Inside the CG envelope ([arm, weight] polygon), counting its edges as inside:
// the POH sample airplane sits exactly on the 2,400 lb line.
export function inEnvelope(env: [number, number][], cg: number, weight: number) {
  if (pointInPolygon({ lat: weight, lon: cg }, env)) return true
  return env.some(([x1, y1], i) => {
    const [x2, y2] = env[(i + 1) % env.length]
    const cross = (cg - x1) * (y2 - y1) - (weight - y1) * (x2 - x1)
    const within = cg >= Math.min(x1, x2) - 1e-9 && cg <= Math.max(x1, x2) + 1e-9 && weight >= Math.min(y1, y2) - 1e-9 && weight <= Math.max(y1, y2) + 1e-9
    return within && Math.abs(cross) < 1e-6 * Math.max(1, Math.hypot(x2 - x1, y2 - y1))
  })
}

// ── VFR rules ────────────────────────────────────────────────────────────────
// §91.159: more than 3,000 ft AGL, magnetic course 0–179° → odd thousands + 500; 180–359° → even + 500.
export function hemispheric(magCourse: number, altMsl: number, groundFt: number) {
  if (altMsl - groundFt <= 3000) return { applies: false, ok: true, suggest: null as number | null }
  const east = norm360(magCourse) < 180
  const thousands = Math.round((altMsl - 500) / 1000)
  const ok = altMsl % 1000 === 500 && (east ? thousands % 2 === 1 : thousands % 2 === 0)
  const base = Math.floor(altMsl / 1000)
  const candidates = [base - 1, base, base + 1].filter(t => (east ? t % 2 === 1 : t % 2 === 0)).map(t => t * 1000 + 500)
  const suggest = candidates.sort((a, b) => Math.abs(a - altMsl) - Math.abs(b - altMsl))[0]
  return { applies: true, ok, suggest }
}

// Cruise altitude for a flight: the lowest VFR cruising altitude for its
// magnetic course (§91.159: odd thousands + 500 eastbound, even + 500 westbound),
// at least 3,500 ft and 1,000 ft above the highest terrain on the line. A hop too
// short to climb that high and come back down (about 2 nm up and 3.7 nm down per
// 1,000 ft in a trainer) stays below 3,000 ft AGL, where the rule doesn't apply.
export function vfrAltitude(eastbound: boolean, terrainFt: number | null, fieldFt: number, distNm: number) {
  const floor = Math.max((terrainFt ?? fieldFt) + 1000, fieldFt + 1500)
  let t = Math.max(3, Math.ceil((floor - 500) / 1000))
  if ((t % 2 === 1) !== eastbound) t++
  const alt = t * 1000 + 500
  if (((alt - fieldFt) / 1000) * 5.7 > distNm * 0.6) {
    const low = Math.ceil(floor / 500) * 500
    if (low - fieldFt <= 3000 && low < alt) return { alt: low, hemispheric: false }
  }
  return { alt, hemispheric: true }
}

// §91.151 day 30 min / night 45 min at normal cruise.
export const reserveMinutes = (night: boolean) => (night ? 45 : 30)

// ── Weather helpers ──────────────────────────────────────────────────────────
export type Category = 'VFR' | 'MVFR' | 'IFR' | 'LIFR'
export function parseVisib(v: unknown): number | null {
  if (v == null || v === '') return null
  const s = String(v).replace('+', '').replace('P', '')
  if (/^\d+\s+\d\/\d$/.test(s)) { const [w, f] = s.split(/\s+/); const [n, d] = f.split('/').map(Number); return +w + n / d }
  if (/^\d\/\d$/.test(s)) { const [n, d] = s.split('/').map(Number); return n / d }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}
export function ceilingOf(clouds?: { cover: string; base: number | null }[] | null, vertVis?: number | null) {
  const c = (clouds || []).filter(l => /BKN|OVC|OVX/.test(l.cover) && l.base != null).map(l => l.base as number)
  if (vertVis != null) c.push(vertVis)
  return c.length ? Math.min(...c) : null
}
export function category(ceilingFt: number | null, visSm: number | null): Category {
  const c = ceilingFt ?? Infinity, v = visSm ?? Infinity
  if (c < 500 || v < 1) return 'LIFR'
  if (c < 1000 || v < 3) return 'IFR'
  if (c <= 3000 || v <= 5) return 'MVFR'
  return 'VFR'
}

export interface TafPeriod { timeFrom: number; timeTo: number; fcstChange: string | null; probability: number | null; wdir: number | string | null; wspd: number | null; wgst: number | null; visib: string | number | null; vertVis: number | null; wxString: string | null; clouds: { cover: string; base: number | null }[] }

// The TAF conditions in force at a time: the prevailing group (base / FM /
// BECMG) plus any TEMPO or PROB groups covering it.
export function tafAt(fcsts: TafPeriod[], tSec: number) {
  const covering = fcsts.filter(f => tSec >= f.timeFrom && tSec < f.timeTo)
  const prevailing = covering.filter(f => !f.fcstChange || f.fcstChange === 'FM' || f.fcstChange === 'BECMG').at(-1) || null
  const temporary = covering.filter(f => f.fcstChange === 'TEMPO' || f.fcstChange === 'PROB')
  return { prevailing, temporary }
}

// Worst category of a TAF moment (prevailing and temporary groups).
export function tafCategory(m: ReturnType<typeof tafAt>): Category | null {
  const groups = [m.prevailing, ...m.temporary].filter(Boolean) as TafPeriod[]
  if (!groups.length) return null
  const rank: Category[] = ['VFR', 'MVFR', 'IFR', 'LIFR']
  return groups.map(g => category(ceilingOf(g.clouds, g.vertVis), parseVisib(g.visib))).sort((a, b) => rank.indexOf(b) - rank.indexOf(a))[0]
}

// ── Winds aloft ──────────────────────────────────────────────────────────────
export interface FbWind { dir: number | null; spd: number; temp: number | null; lv?: boolean }
export interface FbProduct { source?: string; basedOn: string; valid: string; forUse: [string, string]; levels: number[]; stations: Record<string, { lat: number; lon: number; winds: Record<string, FbWind> }> }

// Absolute "for use" window of an FB product. `valid` is DDHHMM (UTC) in the
// month of `ref`; the window's start is the last start-time at or before the
// valid time, its end the first end-time after the start.
export function fbWindow(prod: FbProduct, ref: Date) {
  const day = Number(prod.valid.slice(0, 2)), hh = Number(prod.valid.slice(2, 4)), mm = Number(prod.valid.slice(4, 6))
  let valid = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), day, hh, mm)
  if (valid - ref.getTime() > 15 * 86_400_000) valid = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, day, hh, mm)
  if (ref.getTime() - valid > 15 * 86_400_000) valid = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, day, hh, mm)
  const at = (hhmm: string, base: number) => { const d = new Date(base); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(hhmm.slice(0, 2)) % 24, Number(hhmm.slice(2))) + (hhmm === '2400' ? 86_400_000 : 0) }
  let start = at(prod.forUse[0], valid)
  if (start > valid) start -= 86_400_000
  let end = at(prod.forUse[1], start)
  if (end <= start) end += 86_400_000
  return { start, end, valid }
}

// The FB product whose for-use window contains the time; otherwise the one
// valid nearest to it, flagged `outside`.
export function fbFor(products: { fcst: string; data: FbProduct[] | null }[], at: Date): { fcst: string; product: FbProduct; outside?: boolean } | null {
  const list = products.map(p => ({ fcst: p.fcst, product: p.data?.[0] })).filter(p => p.product?.forUse && p.product.valid) as { fcst: string; product: FbProduct }[]
  const t = at.getTime()
  for (const p of list) { const w = fbWindow(p.product, at); if (t >= w.start && t < w.end) return p }
  const best = list.map(p => ({ ...p, gap: Math.abs(fbWindow(p.product, at).valid - t) })).sort((a, b) => a.gap - b.gap)[0]
  return best ? { fcst: best.fcst, product: best.product, outside: true } : null
}

// Wind and temperature at a point and altitude: the nearest three stations
// (inverse distance), each interpolated between the levels around the altitude.
// Directions are averaged as vectors. Temperature falls back to the standard
// lapse rate from the nearest level that has one.
export function windAt(prod: FbProduct, at: LatLon, altFt: number) {
  const st = Object.entries(prod.stations).map(([id, s]) => ({ id, ...s, d: distanceNm(at, s) })).sort((a, b) => a.d - b.d).slice(0, 3)
  if (!st.length) return null
  let u = 0, v = 0, tSum = 0, tW = 0, wSum = 0
  for (const s of st) {
    const lv = prod.levels.filter(l => s.winds[l]).sort((a, b) => a - b)
    if (!lv.length) continue
    const lo = [...lv].reverse().find(l => l <= altFt) ?? lv[0], hi = lv.find(l => l >= altFt) ?? lv[lv.length - 1]
    const f = hi === lo ? 0 : (altFt - lo) / (hi - lo)
    const vec = (w: FbWind) => (w.dir == null ? [0, 0] : [w.spd * Math.sin(rad(w.dir)), w.spd * Math.cos(rad(w.dir))])
    const [u0, v0] = vec(s.winds[lo]), [u1, v1] = vec(s.winds[hi])
    const w = 1 / Math.max(s.d, 1) ** 2
    u += w * lerp(u0, u1, f); v += w * lerp(v0, v1, f); wSum += w
    const withT = lv.filter(l => s.winds[l].temp != null)
    if (withT.length) {
      const tl = [...withT].reverse().find(l => l <= altFt), th = withT.find(l => l >= altFt)
      const t = tl != null && th != null && th !== tl ? lerp(s.winds[tl].temp!, s.winds[th].temp!, (altFt - tl) / (th - tl))
        : s.winds[(tl ?? th)!].temp! - 2 * ((altFt - (tl ?? th)!) / 1000)
      tSum += w * t; tW += w
    }
  }
  if (!wSum) return null
  u /= wSum; v /= wSum
  const spd = Math.round(Math.hypot(u, v))
  return { dir: spd ? Math.round(norm360(deg(Math.atan2(u, v)))) : null, spd, temp: tW ? Math.round(tSum / tW) : null, stations: st.map(s => s.id) }
}

// Lowest altitude where the FB temperature crosses 0 °C at the nearest station.
export function freezingLevel(prod: FbProduct, at: LatLon) {
  const s = Object.values(prod.stations).map(x => ({ ...x, d: distanceNm(at, x) })).sort((a, b) => a.d - b.d)[0]
  if (!s) return null
  const pts = prod.levels.filter(l => s.winds[l]?.temp != null).map(l => [l, s.winds[l].temp!] as const)
  if (!pts.length) return null
  if (pts[0][1] <= 0) return { altFt: Math.max(0, Math.round(pts[0][0] - (pts[0][1] / -2) * 1000)), approx: true }
  for (let i = 1; i < pts.length; i++) if (pts[i][1] <= 0) {
    const [a, ta] = pts[i - 1], [b, tb] = pts[i]
    return { altFt: Math.round(lerp(a, b, ta / (ta - tb)) / 100) * 100, approx: false }
  }
  return null
}

// ── Airspeed (same density model as the E6BX navlog) ─────────────────────────
// σ from pressure altitude and OAT via density altitude; TAS = CAS / √σ.
export function densityRatio(paFt: number, oatC: number) {
  const tIsa = 288.15 - paFt * 0.0019812
  const da = paFt + (tIsa / 0.0019812) * (1 - Math.pow(tIsa / (oatC + 273.15), 0.234969))
  return Math.pow((288.15 - da * 0.0019812) / 288.15, 1 / 0.234969)
}
export const tasFromCas = (cas: number, paFt: number, oatC: number) => cas / Math.sqrt(densityRatio(paFt, oatC))
export const casFromTas = (tas: number, paFt: number, oatC: number) => tas * Math.sqrt(densityRatio(paFt, oatC))

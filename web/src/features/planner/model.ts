// The planning engine: plan inputs + fetched data → navlog, weights, takeoff and
// landing performance at every airport, weather at each ETA, and the list of
// go/no-go checks. Pure; the page renders what this returns.
import type { AircraftProfile, ProfileEdits, ProfileMatch } from './poh'
import {
  category, ceilingOf, climbBetween, corrected, cruiseAt, densityAltitude, distanceAt, distanceNm, fbFor, freezingLevel, hPaToInHg, hemispheric,
  inEnvelope, initialCourse, pointInPolygon, intermediate, isaTemp, parseVisib, pressureAltitude, reserveMinutes, tafAt, tafCategory, toMagnetic, touchesCorridor,
  sampleRoute, wbTotal, windAt, windComponents, windTriangle, casFromTas, tasFromCas, variationAt, vfrAltitude, type Category, type FbProduct, type LatLon, type TafPeriod,
} from './calc'
import { pilotChecks, aircraftClass, roleOf, MINIMUMS_CHECK, type Crew, type PilotCerts } from './pilot'
import { fixFor } from './fixes'
import { AV1ATES, EQUIPMENT_DAY, EQUIPMENT_NIGHT, IMSAFE, MX_DOCS } from './checklists'

// ── Inputs ────────────────────────────────────────────────────────────────────
// What you type: tail, route, departure time, cruise power and who sits where.
// Everything else has an automatic value (altitude, fuel, ground time) that the
// optional fields override.
export interface Plan {
  name: string
  route: string[]
  alternate: string | null
  departLocal: string
  rpm: number
  tail: string | null
  seats?: { pilot: number; front: number; rearL: number; rearR: number }
  loads: { front: number; rear: number; bag1: number; bag2: number }
  // null: full usable fuel for the tanks.
  fuelGal: number | null
  stopMinutes: number
  // Names for coordinate route points picked from landmarks ("37.1234/-121.5678" → Gilroy).
  labels?: Record<string, { name: string; kind: string }>
  // Engine start to takeoff at the first airport (start, taxi, run-up); unset → 10 min.
  taxiMin?: number
  // Checklist answers: imsafe.*, mx.*, eq.* → true (done / fit), false (failed / not fit).
  checklist?: Record<string, boolean>
  // Automatic checkpoints you dropped, by id.
  skipFixes?: string[]
  // Cruise altitude per flight (stop to stop), by flight index; unset → automatic.
  altitudes?: Record<string, number>
  night: boolean | null
  actuals?: Record<string, { ata?: string; gs?: string; fuel?: string; dev?: string }>
  // E6B-style per-row inputs that replace the forecast/POH value for that row.
  overrides?: Record<string, RowOverride>
  // Make/model/year when the registry has none (e.g. a non-US tail) or to correct it.
  aircraft?: { make?: string; model?: string; year?: number | null }
  timeOff?: string
  notes?: string
  // Who flies: you as PIC, or dual with an instructor (the instructor is PIC).
  crew?: Crew
}
export interface RowOverride { wdir?: number | null; wspd?: number | null; temp?: number | null; cas?: number | null }

// A route token resolved by /api/planner/resolve.
export interface RoutePoint {
  token: string; overfly: boolean; kind: 'airport' | 'navaid' | 'fix' | 'vfr' | 'gps' | 'radial' | 'unknown'
  id: string; label: string; name?: string; lat?: number; lon?: number; magVar?: number | null; elev?: number | null; freq?: string | null; type?: string; error?: string
}

export interface Minimums {
  maxWind: number; maxGust: number; maxCrosswind: number
  ceilingDay: number; ceilingNight: number; visDay: number; visNight: number
  runwayLength: number; runwayWidth: number
  reserveDay: number; reserveNight: number
  nightAllowed: boolean
}
export const DEFAULT_MINIMUMS: Minimums = {
  maxWind: 15, maxGust: 20, maxCrosswind: 10, ceilingDay: 3000, ceilingNight: 5000, visDay: 5, visNight: 8,
  runwayLength: 2500, runwayWidth: 50, reserveDay: 60, reserveNight: 60, nightAllowed: false,
}

export interface AircraftPlanning {
  emptyWeight?: number; emptyMoment?: number // lb, lb-in/1000
  tanks?: string
  color?: string
  equipment?: { transponder?: string; adsbOut?: boolean; gps?: string; equipCode?: string; autopilot?: boolean; notes?: string }
  inspections?: Record<string, string | number | undefined> // ISO dates; 'hundredHoursLeft'
  profile?: ProfileEdits // your values over the POH / registry ones
  updatedAt?: string
}

export interface NasrRunwayEnd { id: string; trueHdg: number | null; right: boolean; lat: number | null; lon: number | null; elev: number | null; displaced: number; vgsi: string | null; lda: number | null }
export interface NasrRunway { id: string; len: number; wid: number | null; surface: string | null; cond: string | null; lights: string | null; ends: NasrRunwayEnd[] }
export interface NasrFreq { use: string; freq: string; call: string | null; hrs: string | null; sector: string | null }
export interface Airport {
  id: string; icao: string | null; name: string; city: string; state: string; lat: number; lon: number; elev: number; tpaAgl: number | null; magVar: number
  use: string; towered: boolean; towerCall: string | null; towerHrs: string | null; segCircle: boolean; windIndicator: string | null; lights: string | null
  frequencies: NasrFreq[]; wx: { id: string; type: string; freq: string | null; phone: string | null; distNm: number } | null
  runways: NasrRunway[]; remarks: string[]; airspace: { B: boolean; C: boolean; D: boolean; E: boolean; hrs: string | null } | null; cycle: string
  approach: { via: string; distNm: number; frequencies: NasrFreq[] } | null
  fss?: { id: string; name: string | null } | null
  kind?: RoutePoint['kind']; navType?: string
  label?: string
  notes?: string // from your airport profile
  profiled?: boolean // your airport profile changed something
  sun: { rise: string; set: string; civilDawn: string; civilDusk: string; date: string } | null
}

// Your airport profile: pattern altitude (MSL), pattern side per runway end, notes.
export interface AirportProfile { tpaMsl?: number | null; pattern?: Record<string, 'L' | 'R'>; notes?: string; updatedAt?: string }
export function applyAirportProfile(a: Airport, p?: AirportProfile | null): Airport {
  if (!p) return a
  const pat = p.pattern ?? {}
  const tpa = p.tpaMsl != null && p.tpaMsl > a.elev ? p.tpaMsl - a.elev : null
  return {
    ...a,
    tpaAgl: tpa ?? a.tpaAgl,
    runways: a.runways.map(r => ({ ...r, ends: r.ends.map(e => (pat[e.id] ? { ...e, right: pat[e.id] === 'R' } : e)) })),
    notes: p.notes?.trim() || undefined,
    profiled: tpa != null || Object.keys(pat).length > 0 || !!p.notes?.trim(),
  }
}

export interface Metar { icaoId: string; obsTime: number; temp: number | null; dewp: number | null; wdir: number | string | null; wspd: number | null; wgst: number | null; visib: string | number | null; altim: number | null; clouds: { cover: string; base: number | null }[]; fltCat?: string; rawOb: string; lat: number; lon: number; elev: number; name?: string }
export interface Taf { icaoId: string; rawTAF: string; issueTime: string; lat: number; lon: number; fcsts: TafPeriod[]; name?: string }
export interface Pirep { obsTime: number; lat: number; lon: number; fltLvl: number | null; acType: string; rawOb: string; tbInt1: string; icgInt1: string; tbBas1: number | null; tbTop1: number | null; icgBas1: number | null; icgTop1: number | null; pirepType: string; wxString?: string; clouds?: unknown }
export interface Advisory { hazard: string; rawAirSigmet?: string; airSigmetType?: string; validTimeFrom?: number; validTimeTo?: number; altitudeHi1?: number | null; altitudeLow1?: number | null; severity?: number | string | null; coords: { lat: string | number; lon: string | number }[]; product?: string; validTime?: string; forecastHour?: number; due_to?: string; top?: string | null; base?: string | null; tag?: string; cwsu?: string; cwaText?: string; text?: string }
export interface Section<T> { data: T | null; fetchedAt: string; error?: string }
export interface WeatherBundle {
  metars: Section<Metar[]>; tafs: Section<Taf[]>; pireps: Section<Pirep[]>; sigmets: Section<Advisory[]>; gairmets: Section<Advisory[]>; cwas: Section<Advisory[]>
  winds: { fcst: string; data: FbProduct[] | null; fetchedAt: string; error?: string }[]
  nas: Section<{ updated: string; total: number; items: { airport: string; kind: string; reason: string; detail: string }[] }>
  tfrs: Section<{ type: 'Feature'; geometry: { type: string; coordinates: unknown }; properties: { id: string; kind: string; title: string; description: string } }[]>
}

export interface Inputs {
  airports: Airport[]
  weather: WeatherBundle | null
  match: ProfileMatch | null
  planning: AircraftPlanning
  minimums: Minimums
  terrain: number[] | null // feet, along sampleRoute(route, 2)
  currency: { key: string; name: string; state: string; detail: string }[]
  airspace: { type: 'Feature'; geometry: { type: string; coordinates: unknown }; properties: { NAME: string; CLASS: string; LOWER_VAL: number | null; UPPER_VAL: number | null } }[] | null
  checkpoints?: Checkpoint[]
  points?: RoutePoint[]
  // Your certificates (null: not saved yet; undefined: skip the pilot-privilege checks).
  certs?: PilotCerts | null
  now?: number
}

// ── Outputs ───────────────────────────────────────────────────────────────────
export type Status = 'ok' | 'caution' | 'nogo' | 'todo'
export type SectionKey = 'trip' | 'pilot' | 'aircraft' | 'loading' | 'performance' | 'navlog' | 'weather'
export interface Check { section: SectionKey; status: Status; title: string; detail?: string; airport?: string; fix?: string }

export interface Leg {
  from: Airport; to: Airport; distNm: number; tc: number; mc: number; varEast: number
  wind: { dir: number | null; spd: number; temp: number | null; stations: string[] } | null
  tas: number; gph: number; wca: number; th: number; mh: number; gs: number
  climb: { min: number; gal: number; nm: number } | null
  eteMin: number; fuelGal: number; departAt: Date; arriveAt: Date; terrainMax: number | null; stop: boolean; flight: number
}

// One takeoff to one landing: a NavLog sheet of its own.
export interface Flight {
  n: number; from: Airport; to: Airport; legs: Leg[]; rows: NavRow[]
  alt: number; altAuto: number; altSet: boolean; hemispheric: boolean; mc: number; terrainMax: number | null
  distNm: number; eteMin: number; fuelGal: number; departAt: Date; arriveAt: Date
  climb: { min: number; gal: number; nm: number } | null; cruise: { ktas: number; gph: number; bhp: number } | null
  tpaFrom: number; tpaTo: number; fuelStart: number
}
export interface WbStep { label: string; source: string; weight: number; arm: number | null; moment: number; total?: boolean; max?: number; over?: boolean }

export interface Checkpoint { id: string; icao: string | null; name: string; lat: number; lon: number; elev: number | null; magVar: number | null; freq: string | null; towered: boolean; kind?: 'airport' | 'vfr' | 'fix' | 'navaid'; type?: string | null }
// Which points make good checkpoints: airports and VFR waypoints you can see,
// then VORs, then RNAV fixes (on the GPS, not on the ground).
const CP_RANK = { airport: 0, vfr: 0, navaid: 1, fix: 2 } as const
const CP_OFF = { airport: 5, vfr: 5, navaid: 4, fix: 2 } as const
export interface NavFix { id: string; label: string; kind: 'airport' | 'overfly' | 'checkpoint' | 'toc' | 'tod' | 'waypoint'; freq: string | null; navType?: string; cpKind?: Checkpoint['kind']; lat?: number; lon?: number }
export interface NavRow {
  key: string; leg: number; flight: number; from: string; to: NavFix; phase: 'climb' | 'cruise' | 'descent'; alt: string
  wind: { dir: number | null; spd: number; temp: number | null; stations: string[] } | null
  tas: number; cas: number; altFt: number; tc: number; mc: number; wca: number; th: number; varEast: number; mh: number
  overridden: (keyof RowOverride)[]
  distNm: number; remNm: number; gs: number; eteMin: number; eta: Date; fuelGal: number; fuelRem: number; terrainMax: number | null
}

// Route entries: departure, the points flown over, arrival (a legacy "*" suffix is ignored).
export const parseRouteItem = (s: string) => ({ id: s.replace(/\*$/, ''), overfly: s.endsWith('*') })

// A navaid, fix or coordinate on the route, shaped like an airport record so the
// leg maths treats every point alike (no runways: it can't be a stop).
export function waypointAsAirport(p: RoutePoint): Airport {
  return {
    id: p.token.replace(/\*$/, ''), icao: null, name: p.name || p.label, city: '', state: '', lat: p.lat!, lon: p.lon!, elev: p.elev ?? 0, tpaAgl: null, magVar: p.magVar ?? 0,
    use: '', towered: false, towerCall: null, towerHrs: null, segCircle: false, windIndicator: null, lights: null,
    frequencies: p.freq ? [{ use: p.type || 'NAV', freq: p.freq, call: null, hrs: null, sector: null }] : [], wx: null, runways: [], remarks: [], airspace: null, cycle: '',
    approach: null, sun: null, kind: p.kind, navType: p.type,
  }
}
export const isWaypoint = (a: Airport) => !!a.kind && a.kind !== 'airport'

// Seat weights → W&B stations (pilot + front passenger share an arm, so do the rear seats).
export function loadsOf(plan: Plan): Plan['loads'] {
  const s = plan.seats
  return s ? { ...plan.loads, front: (s.pilot || 0) + (s.front || 0), rear: (s.rearL || 0) + (s.rearR || 0) } : plan.loads
}
export const soulsOf = (plan: Plan) => {
  const s = plan.seats
  if (s) return [s.pilot, s.front, s.rearL, s.rearR].filter(w => w > 0).length
  return (plan.loads.front > 250 ? 2 : plan.loads.front > 0 ? 1 : 0) + (plan.loads.rear > 0 ? Math.max(1, Math.round(plan.loads.rear / 170)) : 0)
}

// Route token → airport record or waypoint, using the resolver's answer when there is one
// (so "SJC" is the VOR, as SkyVector reads it, not San José airport).
export function makeResolver(airports: Airport[], points?: RoutePoint[]) {
  const aptById = (id: string) => airports.find(a => a.id === id.replace(/^K(?=[A-Z0-9]{3}$)/, '') || a.icao === id || a.id === id)
  return (raw: string): Airport | undefined => {
    const id = raw.replace(/\*$/, '').toUpperCase()
    const p = points?.find(x => x.token.replace(/\*$/, '') === id)
    if (p && p.kind !== 'airport' && p.kind !== 'unknown' && p.lat != null) return waypointAsAirport(p)
    return aptById(p?.kind === 'airport' ? p.id : id)
  }
}

export interface WxAt {
  airport: Airport; at: Date; role: 'departure' | 'stop' | 'destination' | 'alternate'
  metar: Metar | null; metarStation: string | null; metarAgeMin: number | null
  taf: Taf | null; tafStation: string | null; tafMoment: ReturnType<typeof tafAt> | null
  wind: { dir: number | null; spd: number; gust: number | null; from: 'taf' | 'metar' | null }
  ceiling: number | null; visib: number | null; category: Category | null
  altimInHg: number | null; tempC: number | null; pa: number; da: number | null; night: boolean | null
}

export interface RunwayCalc { runway: NasrRunway; end: NasrRunwayEnd; magHdg: number; head: number; cross: number; toraFt: number; ldaFt: number }
export interface PerfAt {
  airport: Airport; kind: 'takeoff' | 'landing'; weight: number; wx: WxAt; runway: RunwayCalc | null
  dist: { ground: number; total: number; clamped: string[] } | null; required: number | null; margin: number | null; asi: number | null
}

export interface Derived {
  profile: AircraftProfile | null
  departAt: Date | null
  takeoffAt: Date | null
  legs: Leg[]
  flights: Flight[]
  navlog: NavRow[]
  totals: { distNm: number; eteMin: number; tripFuel: number; taxiFuel: number; reserveFuel: number; personalReserveFuel: number; requiredFuel: number; usableFuel: number; enduranceMin: number }
  wx: WxAt[]
  wb: { items: { label: string; weight: number; arm: number; moment: number }[]; ramp: ReturnType<typeof wbTotal>; takeoff: ReturnType<typeof wbTotal>; landing: ReturnType<typeof wbTotal>; emptySample: boolean; steps: WbStep[] }
  perf: PerfAt[]
  samples: LatLon[]
  freezing: { altFt: number; approx: boolean } | null
  fb: { fcst: string; product: FbProduct; outside?: boolean } | null
  crossings: { name: string; cls: string; floor: number | null; ceiling: number | null; atCruise: boolean }[]
  hazards: { sigmets: Advisory[]; gairmets: Advisory[]; cwas: Advisory[]; tfrs: WeatherBundle['tfrs']['data']; pireps: Pirep[] }
  checks: Check[]
  sections: Record<SectionKey, Status>
}

// Any landing after civil dusk or takeoff before civil dawn (from NASR sun times).
function wxNight(legs: Leg[]) {
  const dark = (a: Airport, at: Date) => !!a.sun && (at < new Date(a.sun.civilDawn) || at > new Date(a.sun.civilDusk))
  return legs.some(l => dark(l.from, l.departAt) || dark(l.to, l.arriveAt))
}

const STATUS_RANK: Status[] = ['ok', 'todo', 'caution', 'nogo']
export const worst = (xs: Status[]): Status => xs.reduce<Status>((a, b) => (STATUS_RANK.indexOf(b) > STATUS_RANK.indexOf(a) ? b : a), 'ok')

// Local "YYYY-MM-DDTHH:mm" (browser time zone) → Date.
export const parseLocal = (s: string) => { const d = new Date(s); return Number.isNaN(+d) ? null : d }

const nearest = <T extends { lat: number; lon: number }>(list: T[], p: LatLon, maxNm: number) =>
  list.map(x => ({ x, d: distanceNm(p, x) })).filter(o => o.d <= maxNm).sort((a, b) => a.d - b.d)[0] || null

const ringsOf = (g: { type: string; coordinates: unknown }): [number, number][][] =>
  g.type === 'Polygon' ? [(g.coordinates as [number, number][][])[0]] : g.type === 'MultiPolygon' ? (g.coordinates as [number, number][][][]).map(p => p[0]) : []
// Bounding box [west, south, east, north] of a polygon, computed once per
// geometry: the nationwide airspace layer has thousands of detailed polygons,
// and testing every route sample against each one took seconds per edit.
const boxes = new WeakMap<object, number[]>()
function boxOf(g: { type: string; coordinates: unknown }) {
  let b = boxes.get(g)
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity]
    for (const r of ringsOf(g)) for (const [x, y] of r) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y }
    boxes.set(g, b)
  }
  return b
}
// Airspace the line passes through, remembered for the last route so edits
// that don't move the route (checklists, loading) skip the polygon tests.
let lastAirspace: { src: unknown; key: string; out: { name: string; cls: string; floor: number | null; ceiling: number | null }[] } | null = null
function airspaceOnLine(airspace: NonNullable<Inputs['airspace']>, samples: LatLon[]) {
  const key = samples.map(p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(';')
  if (lastAirspace && lastAirspace.src === airspace && lastAirspace.key === key) return lastAirspace.out
  const out: { name: string; cls: string; floor: number | null; ceiling: number | null }[] = []
  const seen = new Set<string>()
  const rb = [Math.min(...samples.map(p => p.lon)), Math.min(...samples.map(p => p.lat)), Math.max(...samples.map(p => p.lon)), Math.max(...samples.map(p => p.lat))]
  for (const f of airspace) {
    const k = `${f.properties.NAME}|${f.properties.CLASS}|${f.properties.LOWER_VAL}`
    if (seen.has(k)) continue
    const fb = boxOf(f.geometry)
    if (fb[0] > rb[2] || fb[2] < rb[0] || fb[1] > rb[3] || fb[3] < rb[1]) continue
    if (!ringsOf(f.geometry).some(r => r.length > 2 && samples.some(s => pointInPolygon(s, r)))) continue
    seen.add(k)
    const floor = f.properties.LOWER_VAL != null && f.properties.LOWER_VAL > -9000 ? f.properties.LOWER_VAL : 0
    const ceiling = f.properties.UPPER_VAL != null && f.properties.UPPER_VAL > -9000 ? f.properties.UPPER_VAL : null
    out.push({ name: f.properties.NAME, cls: f.properties.CLASS, floor, ceiling })
  }
  lastAirspace = { src: airspace, key, out }
  return out
}

const advRing = (a: Advisory): [number, number][] => a.coords.map(c => [Number(c.lon), Number(c.lat)])

function weatherAt(a: Airport, at: Date, role: WxAt['role'], w: WeatherBundle | null, now: number): WxAt {
  const id = a.icao || a.id
  const metars = w?.metars.data || [], tafs = w?.tafs.data || []
  const metar = metars.find(m => m.icaoId === id) || nearest(metars, a, 15)?.x || null
  const taf = tafs.find(t => t.icaoId === id) || nearest(tafs, a, 25)?.x || null
  const tSec = at.getTime() / 1000
  const tafMoment = taf && tSec <= Math.max(...taf.fcsts.map(f => f.timeTo)) ? tafAt(taf.fcsts, tSec) : null
  const p = tafMoment?.prevailing
  const soon = at.getTime() - now < 60 * 60_000
  const useTaf = !!p && !soon
  const num = (v: unknown) => (typeof v === 'number' ? v : null)
  const wind = useTaf ? { dir: num(p!.wdir), spd: p!.wspd ?? 0, gust: p!.wgst, from: 'taf' as const }
    : metar ? { dir: num(metar.wdir), spd: metar.wspd ?? 0, gust: metar.wgst, from: 'metar' as const } : { dir: null, spd: 0, gust: null, from: null }
  const ceiling = useTaf ? ceilingOf(p!.clouds, p!.vertVis) : metar ? ceilingOf(metar.clouds) : null
  const visib = useTaf ? parseVisib(p!.visib) : metar ? parseVisib(metar.visib) : null
  const cat = useTaf ? tafCategory(tafMoment!) : metar ? category(ceiling, visib) : null
  const altimInHg = metar?.altim ? Math.round(hPaToInHg(metar.altim) * 100) / 100 : null
  const tempC = metar?.temp ?? null
  const pa = pressureAltitude(a.elev, altimInHg ?? 29.92)
  const sun = a.sun
  const night = sun ? at < new Date(sun.civilDawn) || at > new Date(sun.civilDusk) : null
  return {
    airport: a, at, role, metar, metarStation: metar?.icaoId ?? null, metarAgeMin: metar ? Math.round((now / 1000 - metar.obsTime) / 60) : null,
    taf, tafStation: taf?.icaoId ?? null, tafMoment, wind, ceiling, visib, category: cat, altimInHg, tempC, pa,
    da: tempC != null ? densityAltitude(pa, tempC) : null, night,
  }
}

export function bestRunway(a: Airport, wx: WxAt, minWidth: number): RunwayCalc[] {
  const out: RunwayCalc[] = []
  for (const r of a.runways) for (const e of r.ends) {
    if (e.trueHdg == null) continue
    const magHdg = toMagnetic(e.trueHdg, a.magVar)
    // METAR/TAF winds are true; runway components need both in the same reference.
    const { head, cross } = windComponents(wx.wind.dir, wx.wind.gust ?? wx.wind.spd, e.trueHdg)
    out.push({ runway: r, end: e, magHdg, head, cross, toraFt: r.len, ldaFt: e.lda ?? r.len - (e.displaced || 0) })
  }
  // Most headwind, then least crosswind, then runways meeting your width minimum, then the longest.
  const wide = (r: RunwayCalc) => ((r.runway.wid ?? 0) >= minWidth ? 1 : 0)
  return out.sort((x, y) => y.head - x.head || Math.abs(x.cross) - Math.abs(y.cross) || wide(y) - wide(x) || y.runway.len - x.runway.len)
}

export function derive(plan: Plan, inp: Inputs): Derived {
  const now = inp.now ?? Date.now()
  const checks: Check[] = []
  const add = (section: SectionKey, status: Status, title: string, detail?: string, airport?: string) => checks.push({ section, status, title, detail, airport })
  const profile = inp.match?.profile ?? null
  const departAt = parseLocal(plan.departLocal)
  const byId = makeResolver(inp.airports, inp.points)
  const routeItems = plan.route.map(parseRouteItem).filter(x => byId(x.id))
  const when = departAt ?? new Date(now)
  const withVar = (a: Airport): Airport => ({ ...a, magVar: Math.round(variationAt(a, when) * 10) / 10 })
  const route = routeItems.map(x => { const a = withVar(byId(x.id)!); const l = plan.labels?.[x.id]; return l ? { ...a, label: l.name, name: l.name, navType: l.kind || a.navType } : a })
  const altApt = plan.alternate ? byId(plan.alternate) : undefined
  const alt = altApt ? withVar(altApt) : null
  const minimums = inp.minimums
  const loads = loadsOf(plan)
  const tank = profile?.fuel.find(f => f.key === (inp.planning.tanks || 'standard')) ?? profile?.fuel[0]
  const usable = Math.min(plan.fuelGal ?? tank?.usable ?? 40, tank?.usable ?? Infinity)

  // ── Trip ──
  if (plan.route.length < 2) add('trip', 'todo', 'Add a departure and a destination')
  const missing = plan.route.map(parseRouteItem).filter(x => !byId(x.id)).map(x => x.id)
  if (missing.length && (inp.airports.length || inp.points?.length)) add('trip', 'nogo', `Not found in FAA NASR: ${missing.join(', ')}`, 'Use an airport, navaid (SJC), fix or VFR waypoint (VPCOY), radial/distance (SJC090020) or coordinates (3720N12150W, 37.33/-121.83).')
  if (route.length >= 2 && (isWaypoint(route[0]) || isWaypoint(route[route.length - 1]))) add('trip', 'nogo', 'The route must start and end at an airport')
  if (!departAt) add('trip', 'todo', 'Set the departure time')
  else if (departAt.getTime() < now - 30 * 60_000) add('trip', 'caution', 'Departure time is in the past', 'Weather is matched to the planned times; update it to brief the actual flight.')

  // ── Navlog ──
  // Each leg becomes rows: from the field to the top of climb, through
  // checkpoint airports near the line, to the top of descent, then down to
  // pattern altitude at the next stop. Overfly points ("KCVH*") don't land.
  const fbSel = inp.weather && departAt ? fbFor(inp.weather.winds, departAt) : null
  const legs: Leg[] = []
  const navlog: NavRow[] = []
  const samples = sampleRoute(route, 2)
  const terrainNear = (pts: LatLon[]) => {
    if (!inp.terrain?.length || !samples.length) return null
    let max = -Infinity
    for (const p of pts) {
      let bi = 0, bd = Infinity
      samples.forEach((sm, k) => { const dd = (sm.lat - p.lat) ** 2 + (sm.lon - p.lon) ** 2; if (dd < bd) { bd = dd; bi = k } })
      if (inp.terrain[bi] != null) max = Math.max(max, inp.terrain[bi])
    }
    return Number.isFinite(max) ? max : null
  }
  const taxiMin = plan.taxiMin ?? 10
  const takeoffAt = departAt ? new Date(departAt.getTime() + taxiMin * 60_000) : null
  let t: Date | null = takeoffAt ? new Date(takeoffAt) : null
  let fuelUsed = 0, departures = 0
  // One flight, one navlog: you land only at the last point; everything between is flown over.
  const routeOverfly = route.map((_, k) => k > 0 && k < route.length - 1)
  const ov = plan.overrides || {}

  // Flights (takeoff to landing) and each one's cruise altitude: automatic from
  // the magnetic course and the terrain under the line unless you set one.
  const flightOfLeg: number[] = []
  const flightLegs: number[][] = []
  for (let i = 1; i < route.length; i++) {
    const f = flightLegs.length - (i > 1 && routeOverfly[i - 1] ? 1 : 0)
    if (!flightLegs[f]) flightLegs[f] = []
    flightLegs[f].push(i); flightOfLeg[i] = f
  }
  const flightAlt = flightLegs.map((ls, f) => {
    const pts = [route[ls[0] - 1], ...ls.map(i => route[i])]
    const dists = ls.map(i => distanceNm(route[i - 1], route[i]))
    const east = ls.reduce((s, i, k) => s + (toMagnetic(initialCourse(route[i - 1], route[i]), (route[i - 1].magVar + route[i].magVar) / 2) < 180 ? dists[k] : -dists[k]), 0) >= 0
    const terrainMax = terrainNear(sampleRoute(pts, 2))
    const auto = vfrAltitude(east, terrainMax, Math.max(pts[0].elev, pts[pts.length - 1].elev), dists.reduce((a, b) => a + b, 0))
    const set = Number(plan.altitudes?.[f]) || 0
    return { alt: set > 0 ? set : auto.alt, altAuto: auto.alt, altSet: set > 0, hemispheric: auto.hemispheric, terrainMax }
  })

  const altMax = Math.max(0, ...flightAlt.map(f => f.alt))
  if (profile && t) {
    const wind = (p: LatLon, alt: number) => (fbSel ? windAt(fbSel.product, p, alt) : null)
    for (let i = 1; i < route.length; i++) {
      const from = route[i - 1], to = route[i]
      const flight = flightOfLeg[i]
      const cruiseAlt = flightAlt[flight].alt
      const startsAtStop = i === 1 || !routeOverfly[i - 1]
      const endsAtStop = i === route.length - 1 || !routeOverfly[i]
      if (startsAtStop) departures++
      const D = distanceNm(from, to), legTc = initialCourse(from, to)
      const midWind = wind(intermediate(from, to, 0.5), cruiseAlt)
      const isaDev = midWind?.temp != null ? midWind.temp - isaTemp(cruiseAlt) : 0
      const cr = cruiseAt(profile, cruiseAlt, isaDev, plan.rpm)
      const tas = cr?.ktas ?? 0, gph = cr?.gph ?? 0
      // Climb: POH time/fuel; ground distance from climb TAS and the wind at mid-climb.
      const climb = startsAtStop ? climbBetween(profile, pressureAltitude(from.elev, 29.92), cruiseAlt, isaDev) : { min: 0, gal: 0, nm: 0 }
      const climbMidAlt = (from.elev + cruiseAlt) / 2
      const climbKias = profile.climb.find(c => c.pa >= climbMidAlt)?.kias ?? 74
      const climbTas = Math.round(climbKias * (1 + 0.02 * climbMidAlt / 1000))
      const cw = wind(intermediate(from, to, 0.1), climbMidAlt)
      const climbGs = windTriangle(legTc, climbTas, cw?.dir ?? null, cw?.spd ?? 0).gs || climbTas
      let climbNm = (climb.min / 60) * climbGs
      // Descent: 500 fpm from cruise to pattern altitude at cruise speed (planning assumption; the POH has no descent table).
      const tpa = to.elev + (to.tpaAgl || 1000)
      const descMin = endsAtStop ? Math.max(0, cruiseAlt - tpa) / 500 : 0
      const dw = wind(intermediate(from, to, 0.9), (cruiseAlt + tpa) / 2)
      const descGs = windTriangle(legTc, tas, dw?.dir ?? null, dw?.spd ?? 0).gs || tas
      let descNm = (descMin / 60) * descGs
      let scale = 1
      if (climbNm + descNm > D * 0.98 && climbNm + descNm > 0) { scale = (D * 0.98) / (climbNm + descNm); climbNm *= scale; descNm *= scale }
      const tToc = climbNm / D, tTod = 1 - descNm / D
      // Checkpoints on legs over 20 nm: airports and VFR waypoints within 5 nm of
      // the line, VORs within 4, RNAV fixes within 2; at least 8 nm apart and
      // clear of the climb and descent.
      const picked: { t: number; a: Checkpoint }[] = []
      const skip = new Set(plan.skipFixes || [])
      const cands = (inp.checkpoints || []).filter(a => !skip.has(a.id) && !route.some(r => r.id === a.id)).map(a => {
        const along = distanceNm(from, a), back = distanceNm(a, to)
        const off = Math.sqrt(Math.max(0, along ** 2 - ((along ** 2 - back ** 2 + D ** 2) / (2 * D)) ** 2))
        return { a, t: (along ** 2 - back ** 2 + D ** 2) / (2 * D * D), off, k: a.kind ?? 'airport' }
      }).filter(c => D > 20 && c.t > tToc + 4 / D && c.t < tTod - 4 / D && c.off <= CP_OFF[c.k])
        .sort((x, y) => CP_RANK[x.k] - CP_RANK[y.k] || x.off - y.off)
      for (const c of cands) if (picked.every(p => Math.abs(p.t - c.t) * D >= 8) && picked.length < 8) picked.push(c)
      picked.sort((x, y) => x.t - y.t)
      const fixes: { t: number; label: string; id: string; kind: NavFix['kind']; freq?: string | null; navType?: string; cpKind?: Checkpoint['kind']; pt: LatLon; varEast: number }[] = [
        { t: 0, label: from.label || from.icao || from.id, id: from.id, kind: 'airport', pt: from, varEast: from.magVar },
        ...(climbNm > 0.5 ? [{ t: tToc, label: 'TOC', id: 'TOC', kind: 'toc' as const, pt: intermediate(from, to, tToc), varEast: variationAt(intermediate(from, to, tToc), when) }] : []),
        ...picked.map(p => ({ t: p.t, label: p.a.icao || p.a.id, id: p.a.id, kind: 'checkpoint' as const, freq: p.a.freq, navType: p.a.type ?? undefined, cpKind: p.a.kind ?? 'airport', pt: { lat: p.a.lat, lon: p.a.lon }, varEast: variationAt(p.a, when) })),
        ...(descNm > 0.5 ? [{ t: tTod, label: 'TOD', id: 'TOD', kind: 'tod' as const, pt: intermediate(from, to, tTod), varEast: variationAt(intermediate(from, to, tTod), when) }] : []),
        { t: 1, label: to.label || to.icao || to.id, id: to.id, kind: endsAtStop ? 'airport' as const : isWaypoint(to) ? 'waypoint' as const : 'overfly' as const, freq: isWaypoint(to) ? to.frequencies[0]?.freq ?? null : to.frequencies.find(f => f.use === 'CTAF' || f.use === 'LCL/P')?.freq ?? null, navType: to.navType, pt: to, varEast: to.magVar },
      ]
      const legStart = new Date(t)
      let legMin = 0, legFuel = 0
      for (let k = 1; k < fixes.length; k++) {
        const a = fixes[k - 1], b = fixes[k]
        const phase: NavRow['phase'] = b.t <= tToc + 1e-9 && climbNm > 0.5 ? 'climb' : a.t >= tTod - 1e-9 && descNm > 0.5 ? 'descent' : 'cruise'
        const altFt = phase === 'climb' ? climbMidAlt : phase === 'descent' ? (cruiseAlt + tpa) / 2 : cruiseAlt
        const segMid = intermediate(a.pt, b.pt, 0.5)
        const key = `${i}-${k}-${b.id}`
        const o = ov[key] || {}
        const fw = wind(segMid, altFt)
        const overridden = (Object.keys(o) as (keyof RowOverride)[]).filter(x => o[x] != null && !Number.isNaN(o[x]))
        const w = overridden.some(x => x !== 'cas')
          ? { dir: o.wdir ?? fw?.dir ?? null, spd: o.wspd ?? fw?.spd ?? 0, temp: o.temp ?? fw?.temp ?? null, stations: fw?.stations ?? [] }
          : fw
        const oat = w?.temp ?? isaTemp(altFt)
        const rowTas = o.cas != null ? Math.round(tasFromCas(o.cas, altFt, oat)) : phase === 'climb' ? climbTas : tas
        const tc = initialCourse(a.pt, b.pt), varEast = (a.varEast + b.varEast) / 2
        const tri = windTriangle(tc, rowTas, w?.dir ?? null, w?.spd ?? 0)
        const dist = distanceNm(a.pt, b.pt)
        const ete = phase === 'climb' ? climb.min * scale : tri.gs > 0 ? (dist / tri.gs) * 60 : 0
        const fuel = phase === 'climb' ? climb.gal * scale : (ete / 60) * gph
        legMin += ete; legFuel += fuel; fuelUsed += fuel
        t = new Date(t.getTime() + ete * 60_000)
        navlog.push({
          key, leg: i, flight, from: a.label, to: { id: b.id, label: b.label, kind: b.kind, freq: b.freq ?? null, navType: b.navType, cpKind: b.cpKind, lat: b.pt.lat, lon: b.pt.lon }, phase, altFt, overridden,
          cas: Math.round(casFromTas(rowTas, altFt, oat)),
          alt: phase === 'climb' ? `↑${cruiseAlt.toLocaleString()}` : phase === 'descent' ? `↓${Math.round(tpa).toLocaleString()}` : cruiseAlt.toLocaleString(),
          wind: w, tas: rowTas, tc, wca: tri.wca, th: tri.th, varEast, mh: toMagnetic(tri.th, varEast), mc: toMagnetic(tc, varEast),
          distNm: dist, gs: tri.gs, eteMin: ete, eta: new Date(t), fuelGal: fuel, remNm: 0, fuelRem: 0, terrainMax: terrainNear(sampleRoute([a.pt, b.pt], 2)),
        })
      }
      const mainRow = navlog.filter(r => r.leg === i).find(r => r.phase === 'cruise') ?? navlog.filter(r => r.leg === i)[0]
      legs.push({ from, to, distNm: D, tc: legTc, mc: toMagnetic(legTc, (from.magVar + to.magVar) / 2), varEast: (from.magVar + to.magVar) / 2, wind: midWind, tas, gph,
        wca: mainRow?.wca ?? 0, th: mainRow?.th ?? legTc, mh: mainRow?.mh ?? legTc, gs: mainRow?.gs ?? tas, climb: climb.min ? climb : null, eteMin: legMin, fuelGal: legFuel,
        departAt: legStart, arriveAt: new Date(t), terrainMax: terrainNear(sampleRoute([from, to], 2)), stop: endsAtStop, flight })
      if (endsAtStop && i < route.length - 1) t = new Date(t.getTime() + plan.stopMinutes * 60_000)
    }
    let remNm = navlog.reduce((x, r) => x + r.distNm, 0)
    let fuelRem = usable
    let lastLeg = 0
    for (const r of navlog) {
      if (r.leg !== lastLeg && (r.leg === 1 || legs[r.leg - 2]?.stop)) fuelRem -= profile.climbStartFuelGal
      lastLeg = r.leg
      remNm -= r.distNm; fuelRem -= r.fuelGal
      r.remNm = Math.max(0, remNm); r.fuelRem = fuelRem
    }
  }
  const flights: Flight[] = []
  flightLegs.forEach((_, f) => {
    const fl = legs.filter(l => l.flight === f)
    if (!fl.length) return
    const rows = navlog.filter(r => r.flight === f)
    const from = fl[0].from, to = fl[fl.length - 1].to, fa = flightAlt[f]
    const sum = (k: 'distNm' | 'eteMin' | 'fuelGal') => fl.reduce((x, l) => x + l[k], 0)
    const isaDev = fl[0].wind?.temp != null ? fl[0].wind.temp - isaTemp(fa.alt) : 0
    flights.push({
      n: f, from, to, legs: fl, rows, alt: fa.alt, altAuto: fa.altAuto, altSet: fa.altSet, hemispheric: fa.hemispheric, terrainMax: fa.terrainMax,
      mc: toMagnetic(initialCourse(from, to), (from.magVar + to.magVar) / 2), distNm: sum('distNm'), eteMin: sum('eteMin'), fuelGal: sum('fuelGal'),
      departAt: fl[0].departAt, arriveAt: fl[fl.length - 1].arriveAt, climb: fl[0].climb,
      cruise: profile ? { ktas: fl[0].tas, gph: fl[0].gph, bhp: cruiseAt(profile, fa.alt, isaDev, plan.rpm)?.bhp ?? 0 } : null,
      tpaFrom: from.elev + (from.tpaAgl || 1000), tpaTo: to.elev + (to.tpaAgl || 1000),
      fuelStart: rows[0] ? rows[0].fuelRem + rows[0].fuelGal + (profile?.climbStartFuelGal ?? 0) : usable,
    })
  })
  const distTotal = legs.reduce((s, l) => s + l.distNm, 0)
  const eteTotal = legs.reduce((s, l) => s + l.eteMin, 0)
  const cruiseGph = legs[0]?.gph || (profile ? cruiseAt(profile, altMax, 0, plan.rpm)?.gph ?? 0 : 0)
  const anyNight = plan.night ?? false
  const taxiFuel = (profile?.climbStartFuelGal ?? 1.1) * Math.max(1, departures)
  const reserveFuel = (reserveMinutes(anyNight) / 60) * cruiseGph
  const personalReserveFuel = ((anyNight ? minimums.reserveNight : minimums.reserveDay) / 60) * cruiseGph
  const requiredFuel = fuelUsed + taxiFuel + Math.max(reserveFuel, personalReserveFuel)
  const enduranceMin = cruiseGph ? ((usable - taxiFuel) / cruiseGph) * 60 : 0

  if (profile && route.length >= 2 && legs.length) {
    if (usable < fuelUsed + taxiFuel + reserveFuel) add('navlog', 'nogo', 'Fuel below the legal reserve', `Need ${(fuelUsed + taxiFuel + reserveFuel).toFixed(1)} gal (trip + taxi + ${reserveMinutes(anyNight)} min, §91.151); ${usable.toFixed(1)} gal usable on board.`)
    else if (usable < requiredFuel) add('navlog', 'caution', 'Fuel below your personal reserve', `Need ${requiredFuel.toFixed(1)} gal with a ${anyNight ? minimums.reserveNight : minimums.reserveDay}-minute reserve; ${usable.toFixed(1)} gal usable.`)
    else add('navlog', 'ok', 'Fuel covers the trip and reserve', `${requiredFuel.toFixed(1)} gal required, ${usable.toFixed(1)} gal usable.`)
    if (!fbSel) add('navlog', 'caution', 'No winds aloft forecast', 'Headings and ground speeds assume calm wind.')
    else if (fbSel.product.source && !fbSel.outside) add('navlog', 'ok', 'Winds aloft from a weather model', `NWS discontinued the FB winds-aloft table on Nov 3, 2026 (NAM retirement, Service Change Notice 26-47), so winds come from ${fbSel.product.source} for ${fbSel.product.forUse.join('–')}Z. Cross-check with your briefing.`)
    else if (fbSel.outside) add('navlog', 'caution', 'No winds-aloft forecast covers the departure time', `Using the FB ${fbSel.fcst}-hour forecast valid ${fbSel.product.valid.slice(0, 2)} ${fbSel.product.valid.slice(2)}Z; forecasts reach about 24 hours ahead — re-brief closer to the flight.`)
    for (const l of legs) {
      const legAlt = flightAlt[l.flight].alt
      const h = hemispheric(l.mc, legAlt, l.terrainMax ?? Math.max(l.from.elev, l.to.elev))
      if (h.applies && !h.ok) add('navlog', 'caution', `${l.from.id}→${l.to.id}: ${legAlt.toLocaleString()} ft doesn't match the hemispheric rule`, `Magnetic course ${Math.round(l.mc)}° → ${h.suggest?.toLocaleString()} ft (§91.159).`)
      if (l.terrainMax != null && legAlt - l.terrainMax < 1000) add('navlog', 'nogo', `${l.from.id}→${l.to.id}: cruise is within 1,000 ft of terrain`, `Highest terrain on the line ${l.terrainMax.toLocaleString()} ft MSL.`)
      else if (l.terrainMax != null && legAlt - l.terrainMax < 2000) add('navlog', 'caution', `${l.from.id}→${l.to.id}: under 2,000 ft above the highest terrain`, `Terrain ${l.terrainMax.toLocaleString()} ft MSL; obstacles (towers) can stand 1,000+ ft above it.`)
      if (l.climb && l.climb.nm > l.distNm) add('navlog', 'caution', `${l.from.id}→${l.to.id}: the leg is shorter than the climb`, `${Math.round(l.climb.nm)} nm to reach ${legAlt.toLocaleString()} ft; plan a lower altitude.`)
    }
    if (altMax > 12000) add('navlog', 'caution', 'Above 12,500 ft supplemental oxygen rules apply after 30 minutes (§91.211)')
  }

  // ── Weather at each ETA ──
  const wx: WxAt[] = []
  if (route.length && departAt) {
    wx.push(weatherAt(route[0], departAt, 'departure', inp.weather, now))
    legs.forEach((l, i) => { if (l.stop) wx.push(weatherAt(l.to, l.arriveAt, i === legs.length - 1 ? 'destination' : 'stop', inp.weather, now)) })
    if (alt) {
      const lastArr = legs.at(-1)?.arriveAt ?? departAt
      const leg = route.length ? distanceNm(route[route.length - 1], alt) : 0
      wx.push(weatherAt(alt, new Date(lastArr.getTime() + (leg / Math.max(legs[0]?.gs || 100, 60)) * 3_600_000), 'alternate', inp.weather, now))
    }
  }
  for (const w of wx) {
    const id = w.airport.icao || w.airport.id, night = !!w.night
    if (!w.metar && !w.taf) { add('weather', 'caution', `${id}: no METAR or TAF within 25 nm`, undefined, id); continue }
    const ceilMin = night ? minimums.ceilingNight : minimums.ceilingDay, visMin = night ? minimums.visNight : minimums.visDay
    const where = `${id} at ${w.at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${w.wind.from === 'taf' ? ` (TAF ${w.tafStation})` : w.metarStation ? ` (METAR ${w.metarStation})` : ''}`
    if (w.category === 'IFR' || w.category === 'LIFR') add('weather', 'nogo', `${where}: ${w.category}`, `Ceiling ${w.ceiling?.toLocaleString() ?? 'none'} ft, visibility ${w.visib ?? '—'} SM — below VFR.`, id)
    else if ((w.ceiling != null && w.ceiling < ceilMin) || (w.visib != null && w.visib < visMin)) add('weather', 'nogo', `${where}: below your minimums`, `Ceiling ${w.ceiling?.toLocaleString() ?? 'none'} ft (min ${ceilMin.toLocaleString()}), visibility ${w.visib ?? '—'} SM (min ${visMin}).`, id)
    else if (w.category === 'MVFR') add('weather', 'caution', `${where}: MVFR`, undefined, id)
    else add('weather', 'ok', `${where}: ${w.category ?? 'conditions reported'}`, w.ceiling ? `Ceiling ${w.ceiling.toLocaleString()} ft` : 'No ceiling', id)
    const temp = w.tafMoment?.temporary || []
    if (temp.length && w.wind.from === 'taf') {
      const tc = tafCategory({ prevailing: null, temporary: temp })
      if (tc && tc !== 'VFR') add('weather', 'caution', `${id}: TEMPO/PROB ${tc} around the ETA`, temp.map(g => `${g.fcstChange}${g.probability ? ' ' + g.probability : ''}: vis ${g.visib ?? '—'}, ${(g.clouds || []).map(c => `${c.cover}${c.base ?? ''}`).join(' ')} ${g.wxString ?? ''}`).join('; '), id)
    }
    if (w.wind.spd > minimums.maxWind) add('weather', 'nogo', `${id}: wind ${w.wind.spd} kt above your ${minimums.maxWind} kt maximum`, undefined, id)
    if (w.wind.gust && w.wind.gust > minimums.maxGust) add('weather', 'nogo', `${id}: gusts ${w.wind.gust} kt above your ${minimums.maxGust} kt maximum`, undefined, id)
    if (w.metar && w.metarAgeMin != null && w.metarAgeMin > 90 && w.at.getTime() - now < 2 * 3_600_000) add('weather', 'caution', `${id}: latest METAR is ${w.metarAgeMin} min old`, undefined, id)
    if (w.night && !minimums.nightAllowed) add('pilot', 'nogo', `${id}: ETA is after civil twilight`, 'Your minimums don\'t include night flight.', id)
  }

  // Corridor hazards (10 nm either side for advisories, 5 nm for TFRs).
  const inTime = (a: Advisory) => !departAt || ((a.validTimeFrom == null || a.validTimeFrom * 1000 <= (legs.at(-1)?.arriveAt ?? departAt).getTime()) && (a.validTimeTo == null || a.validTimeTo * 1000 >= departAt.getTime()))
  const near = (a: Advisory) => samples.length > 0 && touchesCorridor(samples, advRing(a), 10)
  const sigmets = (inp.weather?.sigmets.data || []).filter(a => near(a) && inTime(a))
  const gTimes = departAt ? (a: Advisory) => !a.validTime || Math.abs(Date.parse(a.validTime) - departAt.getTime()) <= 3 * 3_600_000 : () => true
  const gairmets = (inp.weather?.gairmets.data || []).filter(a => near(a) && gTimes(a))
  const cwas = (inp.weather?.cwas.data || []).filter(a => near(a) && inTime(a))
  const tfrs = (inp.weather?.tfrs.data || []).filter(f => ringsOf(f.geometry).some(r => touchesCorridor(samples, r, 5)))
  const pireps = (inp.weather?.pireps.data || []).filter(p => samples.some(s => distanceNm(s, p) <= 30))
  for (const s of sigmets) add('weather', s.hazard === 'CONVECTIVE' || /TS|CONV/.test(s.hazard) ? 'nogo' : 'caution', `${s.hazard === 'CONVECTIVE' ? 'Convective SIGMET' : `${s.airSigmetType || 'SIGMET'} ${s.hazard}`} on the route`, s.rawAirSigmet?.split('\n').slice(2, 5).join(' '))
  const gByHazard = new Map<string, Advisory[]>()
  for (const g of gairmets) gByHazard.set(g.hazard, [...(gByHazard.get(g.hazard) || []), g])
  for (const [h, list] of gByHazard) {
    const label: Record<string, string> = { IFR: 'IFR conditions', MT_OBSC: 'Mountain obscuration', ICE: 'Icing', TURB_LO: 'Low-level turbulence', TURB_HI: 'High-level turbulence', SFC_WND: 'Strong surface winds', LLWS: 'Low-level wind shear', FZLVL: 'Freezing level', M_FZLVL: 'Multiple freezing levels' }
    if (h === 'FZLVL' || h === 'M_FZLVL') continue
    const g0 = list[0]
    add('weather', h === 'TURB_HI' ? 'ok' : 'caution', `G-AIRMET ${g0.product ?? ''} — ${label[h] ?? h} on the route`, [g0.due_to, g0.base || g0.top ? `${g0.base ?? 'SFC'}–${g0.top ?? ''}` : null].filter(Boolean).join(' · ') || undefined)
  }
  for (const c of cwas) add('weather', 'caution', 'Center Weather Advisory on the route', (c.cwaText || c.text || '').slice(0, 240))
  for (const f of tfrs) add('weather', 'nogo', `TFR near the route: ${f.properties.title}`, `${f.properties.kind} ${f.properties.id} — check its times and altitudes before flying.`)
  for (const p of pireps) {
    const sev = `${p.tbInt1 || ''} ${p.icgInt1 || ''}`
    if (/SEV|EXTRM/.test(sev)) add('weather', 'nogo', `PIREP: severe ${p.tbInt1 ? 'turbulence' : 'icing'} near the route`, p.rawOb)
    else if (/MOD/.test(sev)) add('weather', 'caution', `PIREP: moderate ${/MOD/.test(p.tbInt1) ? 'turbulence' : 'icing'} near the route`, p.rawOb)
  }
  for (const i of inp.weather?.nas.data?.items || []) add('weather', i.kind === 'Closure' ? 'nogo' : 'caution', `${i.airport}: ${i.kind}`, [i.reason, i.detail].filter(Boolean).join(' — '), i.airport)
  const freezing = fbSel && route[0] ? freezingLevel(fbSel.product, route[0]) : null
  if (freezing && altMax >= freezing.altFt - 500) add('weather', 'caution', `Cruise at or above the freezing level (~${freezing.altFt.toLocaleString()} ft)`, 'Flight into known icing is prohibited (POH Section 2). Stay clear of visible moisture.')
  if (inp.weather) for (const [k, s] of Object.entries({ METARs: inp.weather.metars, TAFs: inp.weather.tafs, PIREPs: inp.weather.pireps, SIGMETs: inp.weather.sigmets, 'G-AIRMETs': inp.weather.gairmets, 'NAS status': inp.weather.nas, TFRs: inp.weather.tfrs })) {
    if (s.error) add('weather', 'caution', `${k} unavailable`, s.error)
  }

  // ── Airspace crossed ──
  const crossings: Derived['crossings'] = []
  if (inp.airspace && samples.length) {
    for (const c of airspaceOnLine(inp.airspace, samples)) crossings.push({ ...c, atCruise: flightAlt.some(f => f.alt >= (c.floor ?? 0) && (c.ceiling == null || f.alt <= c.ceiling)) })
    const warned = new Set<string>()
    for (const c of crossings) {
      // One warning per airspace: Class B/C shelves share a name.
      if (warned.has(`${c.cls}|${c.name}`) || (c.cls === 'C' && !c.atCruise)) continue
      warned.add(`${c.cls}|${c.name}`)
      if (c.cls === 'B') add('navlog', 'caution', `Class B ${c.name} (${c.floor ? c.floor.toLocaleString() : 'SFC'}–${c.ceiling?.toLocaleString() ?? ''} ft) on the line`, c.atCruise ? 'Your cruise altitude is inside it: you need a clearance ("cleared into the Class Bravo") or a route around/under it.' : 'You pass under or over it at cruise — mind the climb and descent.')
      else if (c.cls === 'C' && c.atCruise) add('navlog', 'caution', `Class C ${c.name} at your cruise altitude`, 'Establish two-way radio communication before entering.')
    }
  }

  // ── Pilot: privileges for this role, passengers, airplane, airspace and distance ──
  const crew = plan.crew ?? {}
  const certs = inp.certs
  const role = roleOf(crew, certs)
  const seatsP = plan.seats
  const passengers = seatsP ? (role === 'dual' ? 0 : Number(seatsP.front > 0)) + Number(seatsP.rearL > 0) + Number(seatsP.rearR > 0) : Number(loads.rear > 0)
  if (certs !== undefined && route.length >= 2) {
    const homeApt = (certs?.home && byId(certs.home)) || route[0]
    const stopsUsed = [route[0], ...legs.filter(l => l.stop).map(l => l.to)]
    const code = (a: Airport) => a.icao || a.id
    const atCruiseB = crossings.filter(c => c.cls === 'B' && c.atCruise).map(c => c.name)
    const visibs = wx.filter(w => w.role !== 'alternate' && w.visib != null).map(w => w.visib!)
    const ceils = wx.filter(w => w.role !== 'alternate' && w.ceiling != null).map(w => w.ceiling!)
    checks.push(...pilotChecks({
      certs, crew: { ...crew, role }, passengers, night: wx.some(w => w.night) || (!wx.length && !!plan.night), depart: departAt, aircraft: aircraftClass(profile, inp.planning.profile), model: inp.planning.profile?.model || (profile ? profile.model.replace(/^Cessna\s*/, '') : null),
      worstVisib: visibs.length ? Math.min(...visibs) : null, lowestCeiling: ceils.length ? Math.min(...ceils) : null, cruiseAlt: altMax,
      maxFromHomeNm: Math.max(0, ...route.map(p => distanceNm(homeApt, p))), landsAway: route[route.length - 1].id !== route[0].id, home: code(homeApt),
      classB: [...new Set([...atCruiseB, ...stopsUsed.filter(a => a.airspace?.B).map(code)])],
      controlled: [...new Set([...crossings.filter(c => /^[BCD]$/.test(c.cls) && c.atCruise).map(c => `Class ${c.cls} ${c.name}`), ...stopsUsed.filter(a => a.towered || a.airspace?.B || a.airspace?.C || a.airspace?.D).map(code)])],
      airports: stopsUsed.map(code), xcEndorsedForFlight: plan.checklist?.['crew.xcEndorsed'] === true, currency: inp.currency,
    }))
  }

  // ── Aircraft ──
  if (!plan.tail) add('aircraft', 'todo', 'Choose the aircraft')
  else if (inp.match && !inp.match.exact && inp.match.note) add('aircraft', 'caution', 'Closest POH used', inp.match.note)
  if (plan.tail) {
    const insp = inp.planning.inspections || {}
    for (const i of AV1ATES) {
      if (i.ifrOnly) continue
      if (i.months) {
        const d = insp[i.key] ? new Date(String(insp[i.key])) : null
        if (!d) continue
        const due = new Date(d); due.setMonth(due.getMonth() + i.months + 1, 0) // end of the calendar month
        if (due.getTime() < (departAt?.getTime() ?? now)) add('aircraft', 'nogo', `${i.label} overdue`, `Due by ${due.toLocaleDateString()}.`)
        else add('aircraft', 'ok', `${i.label} current`, `Until ${due.toLocaleDateString()}.`)
      } else if (i.hours) {
        const left = Number(insp.hundredHoursLeft)
        if (!Number.isFinite(left) || insp.hundredHoursLeft === '' || insp.hundredHoursLeft == null) continue
        if (left - eteTotal / 60 < 0) add('aircraft', 'nogo', '100-hour inspection would be exceeded', `${left} h left, flight ~${(eteTotal / 60).toFixed(1)} h (10 h overfly only to reach a place to do it).`)
        else add('aircraft', left < 10 ? 'caution' : 'ok', `100-hour: ${left} h remaining`)
      }
    }
    if (crossings.some(c => c.cls === 'B' || c.cls === 'C') && inp.planning.equipment?.adsbOut === false) add('aircraft', 'nogo', 'ADS-B Out required in and above Class B/C (§91.225)')
  }

  // ── Checklists: pilot condition, paperwork and inspections, equipment ──
  const ck = plan.checklist || {}
  const answered = (keys: string[]) => ({ yes: keys.filter(k => ck[k] === true), no: keys.filter(k => ck[k] === false), open: keys.filter(k => ck[k] == null) })
  const ims = answered(IMSAFE.map(i => `imsafe.${i.key}`))
  if (ims.no.length) add('pilot', 'nogo', `Not fit to fly: ${ims.no.map(k => IMSAFE.find(i => `imsafe.${i.key}` === k)!.label.toLowerCase()).join(', ')}`, 'IMSAFE (AIM 8-1-1).')
  else if (ims.open.length) add('pilot', 'todo', `IMSAFE: ${ims.open.length} of ${IMSAFE.length} to answer`)
  else add('pilot', 'ok', 'IMSAFE: fit to fly')
  if (plan.tail) {
    const mx = answered(MX_DOCS.map(i => `mx.${i.key}`))
    if (mx.no.length) add('aircraft', 'nogo', `Not airworthy: ${mx.no.map(k => MX_DOCS.find(i => `mx.${i.key}` === k)!.label).join(', ')}`, '§91.7: don\'t fly an unairworthy aircraft; §91.213 for inoperative equipment.')
    else if (mx.open.length) add('aircraft', 'todo', `Maintenance and documents: ${mx.open.length} of ${MX_DOCS.length} to check`)
    else add('aircraft', 'ok', 'Maintenance, inspections and documents checked')
    const eqList = [...EQUIPMENT_DAY, ...(plan.night || wxNight(legs) ? EQUIPMENT_NIGHT : [])]
    const eq = answered(eqList.map(i => `eq.${i.key}`))
    if (eq.no.length) add('aircraft', 'nogo', `Required equipment inoperative: ${eq.no.map(k => eqList.find(i => `eq.${i.key}` === k)!.label).join(', ')}`, '§91.205 / §91.213(d).')
    else if (eq.open.length) add('aircraft', 'todo', `Required equipment: ${eq.open.length} of ${eqList.length} to check`)
    else add('aircraft', 'ok', 'Required equipment working')
  }

  // ── Weight and balance ──
  const items: Derived['wb']['items'] = []
  let emptySample = false
  if (profile) {
    const ew = inp.planning.emptyWeight ?? 1467, em = inp.planning.emptyMoment ?? 57.3
    emptySample = inp.planning.emptyWeight == null
    const push = (label: string, weight: number, arm: number) => items.push({ label, weight, arm, moment: weight * arm })
    push('Basic empty weight', ew, (em * 1000) / ew)
    push(`Fuel ${+usable.toFixed(1)} gal`, usable * 6, profile.fuelArm)
    const st = Object.fromEntries(profile.stations.map(s => [s.key, s]))
    push(st.front.label, loads.front, st.front.arm)
    push(st.rear.label, loads.rear, st.rear.arm)
    push(st.bag1.label, loads.bag1, st.bag1.arm)
    push(st.bag2.label, loads.bag2, st.bag2.arm)
  }
  const ramp = wbTotal(items)
  // The W&B sheet, line by line: loading, ramp, then for each flight the run-up
  // fuel, takeoff, the navlog's fuel burn and the landing.
  const steps: WbStep[] = []
  if (profile) {
    const L = profile.limits, arm = profile.fuelArm, code = (a: Airport) => a.icao || a.id
    const s = plan.seats
    const src: Record<string, string> = {
      'Basic empty weight': emptySample ? 'POH sample airplane' : 'Aircraft W&B record',
      [items[1].label]: `${+usable.toFixed(1)} gal × 6 lb/gal`,
      [items[2].label]: s ? [s.pilot && `pilot ${s.pilot}`, s.front && `front ${s.front}`].filter(Boolean).join(' + ') : '',
      [items[3].label]: s ? [s.rearL && `left ${s.rearL}`, s.rearR && `right ${s.rearR}`].filter(Boolean).join(' + ') : '',
    }
    items.forEach((it, k) => { if (k < 3 || it.weight) steps.push({ label: it.label, source: src[it.label] ?? '', weight: it.weight, arm: it.arm, moment: it.moment }) })
    let w = ramp.weight, mo = ramp.moment
    const total = (label: string, max: number) => {
      const cg = w ? mo / w : 0
      steps.push({ label, source: `max ${max.toLocaleString()}`, weight: w, arm: cg, moment: mo, total: true, max, over: w > max + 1e-6 || !inEnvelope(profile.envelope.normal, cg, w) })
    }
    const minus = (label: string, source: string, lb: number) => { w -= lb; mo -= lb * arm; steps.push({ label, source, weight: -lb, arm, moment: -lb * arm }) }
    total('Ramp', L.maxRamp)
    for (const f of flights) {
      minus('Run-up fuel', `POH: start, taxi, takeoff (${profile.climbStartFuelGal} gal)`, profile.taxiFuelLb)
      total(flights.length > 1 ? `Takeoff ${code(f.from)}` : 'Takeoff', L.maxTakeoff)
      minus('Flight burn', `${f.fuelGal.toFixed(2)} gal × 6 (navlog)`, f.fuelGal * 6)
      total(`Landing ${code(f.to)}`, L.maxLanding)
    }
  }
  const takeoff = profile ? wbTotal([...items, { label: 'Start, taxi, runup', weight: -profile.taxiFuelLb, arm: profile.fuelArm }]) : ramp
  const landing = profile ? wbTotal([...items, { label: 'Start, taxi, runup', weight: -profile.taxiFuelLb * Math.max(1, departures), arm: profile.fuelArm }, { label: 'Trip fuel', weight: -fuelUsed * 6, arm: profile.fuelArm }]) : ramp
  if (profile && plan.tail) {
    const L = profile.limits
    if (loads.front <= 0) add('loading', 'todo', 'Enter the pilot\'s weight')
    if (emptySample) add('loading', 'caution', 'Empty weight is the POH sample airplane', `Enter ${plan.tail}'s basic empty weight and moment from its W&B record.`)
    if (ramp.weight > L.maxRamp) add('loading', 'nogo', `Ramp weight ${Math.round(ramp.weight)} lb over the ${L.maxRamp} lb maximum`)
    if (takeoff.weight > L.maxTakeoff) add('loading', 'nogo', `Takeoff weight ${Math.round(takeoff.weight)} lb over the ${L.maxTakeoff} lb maximum`, `Remove ${Math.ceil(takeoff.weight - L.maxTakeoff)} lb (≈${Math.ceil((takeoff.weight - L.maxTakeoff) / 6)} gal of fuel).`)
    else add('loading', 'ok', `Takeoff weight ${Math.round(takeoff.weight)} lb`, `${Math.round(L.maxTakeoff - takeoff.weight)} lb under the maximum.`)
    if (landing.weight > L.maxLanding) add('loading', 'nogo', `Landing weight over the ${L.maxLanding} lb maximum`)
    if (loads.bag1 > 120 || loads.bag2 > 50 || loads.bag1 + loads.bag2 > L.baggageCombined) add('loading', 'nogo', 'Baggage over the limit', 'Area 1 120 lb, area 2 50 lb, 120 lb combined.')
    for (const st of steps) if (st.total && st.arm != null && !inEnvelope(profile.envelope.normal, st.arm, st.weight)) add('loading', 'nogo', `${st.label}: CG ${st.arm.toFixed(2)} in outside the envelope`, `At ${Math.round(st.weight)} lb.`)
    if (plan.fuelGal != null && plan.fuelGal > (tank?.usable ?? 40)) add('loading', 'caution', `More fuel than the ${tank?.label.toLowerCase()} hold`, `${tank?.usable} gal usable.`)
  }

  // ── Performance ──
  const perf: PerfAt[] = []
  if (profile && departAt && route.length >= 2 && legs.length) {
    let w = takeoff.weight
    const at = (a: Airport, wxx: WxAt, kind: 'takeoff' | 'landing', weight: number) => {
      const rw = bestRunway(a, wxx, minimums.runwayWidth)[0] ?? null
      const temp = wxx.tempC ?? isaTemp(wxx.pa)
      const raw = distanceAt(kind === 'takeoff' ? profile.takeoff : profile.landing, weight, Math.max(wxx.pa, 0), Math.max(temp, 0))
      const grass = !!rw && !/ASPH|CONC|PEM/.test(rw.runway.surface || '')
      const dist = raw && rw ? { ...corrected(raw, rw.head, grass, kind === 'takeoff' ? profile.takeoffNotes : profile.landingNotes), clamped: raw.clamped } : raw ? { ground: Math.round(raw.ground), total: Math.round(raw.total), clamped: raw.clamped } : null
      const avail = rw ? (kind === 'takeoff' ? rw.toraFt : rw.ldaFt) : null
      // Ground roll must fit the runway; the 50-ft figure is the obstacle-clearance distance (ASI: add 50 %).
      perf.push({ airport: a, kind, weight, wx: wxx, runway: rw, dist, required: dist?.ground ?? null, margin: avail != null && dist ? avail - dist.total : null, asi: dist ? Math.round(dist.total * 1.5) : null })
    }
    at(route[0], wx[0], 'takeoff', w)
    let wi = 1
    legs.forEach((l, i) => {
      w -= l.fuelGal * 6
      if (!l.stop) return
      const wxx = wx[wi++]
      at(l.to, wxx, 'landing', w)
      if (i < legs.length - 1) { w -= (profile.climbStartFuelGal * 6); at(l.to, wxx, 'takeoff', w) }
    })
    if (alt) { const wa = wx.find(x => x.role === 'alternate'); if (wa) at(alt, wa, 'landing', w) }
    for (const p of perf) {
      const id = p.airport.icao || p.airport.id
      if (!p.runway) { add('performance', 'caution', `${id}: no runway data`, undefined, id); continue }
      const rwy = p.runway, L = p.kind === 'takeoff' ? rwy.toraFt : rwy.ldaFt
      if (!p.dist) add('performance', 'nogo', `${id} ${p.kind}: beyond the POH chart`, `Pressure altitude ${p.wx.pa.toLocaleString()} ft, ${p.wx.tempC ?? '—'} °C.`, id)
      else if (p.dist.ground > L) add('performance', 'nogo', `${id} ${p.kind} RWY ${rwy.end.id}: ground roll ${p.dist.ground} ft exceeds ${L} ft available`, undefined, id)
      else if (p.dist.total > L) add('performance', 'caution', `${id} ${p.kind} RWY ${rwy.end.id}: 50-ft obstacle distance ${p.dist.total} ft exceeds the ${L} ft runway`, 'Fine for a ground roll, but there is no margin to clear an obstacle at the end.', id)
      else if (p.asi! > L) add('performance', 'caution', `${id} ${p.kind} RWY ${rwy.end.id}: less than the ASI +50 % margin`, `${p.dist.total} ft over 50 ft; +50 % is ${p.asi} ft vs ${L} ft available.`, id)
      else add('performance', 'ok', `${id} ${p.kind} RWY ${rwy.end.id}: ${p.dist.total} ft of ${L} ft`, `Ground roll ${p.dist.ground} ft · ${rwy.head >= 0 ? `${rwy.head} kt headwind` : `${-rwy.head} kt tailwind`} · ${Math.abs(rwy.cross)} kt crosswind`, id)
      if (Math.abs(rwy.cross) > (profile.crosswindDemo)) add('performance', 'nogo', `${id}: crosswind ${Math.abs(rwy.cross)} kt above the ${profile.crosswindDemo} kt demonstrated`, undefined, id)
      else if (Math.abs(rwy.cross) > minimums.maxCrosswind) add('performance', 'nogo', `${id}: crosswind ${Math.abs(rwy.cross)} kt above your ${minimums.maxCrosswind} kt maximum`, undefined, id)
      if (rwy.head < 0) add('performance', rwy.head < -10 ? 'nogo' : 'caution', `${id}: ${-rwy.head} kt tailwind on the best runway`, 'POH corrections cover tailwinds up to 10 kt.', id)
      if (rwy.runway.len < minimums.runwayLength) add('performance', 'caution', `${id}: runway ${rwy.runway.len} ft shorter than your ${minimums.runwayLength} ft minimum`, undefined, id)
      if (p.dist?.clamped.length) add('performance', 'caution', `${id} ${p.kind}: ${p.dist.clamped.join('; ')}`, undefined, id)
      if (p.wx.da != null && p.wx.da > 5000) add('performance', 'caution', `${id}: density altitude ${p.wx.da.toLocaleString()} ft`, undefined, id)
    }
  }

  // Same check twice (a round trip's two ETAs at one airport) shows once; with an
  // instructor on board your personal minimums become cautions; each gets its fix.
  const seenCk = new Set<string>()
  const finalChecks = checks.filter(c => { const k = `${c.section}|${c.status}|${c.title.replace(/ at \d{1,2}:\d{2}\s[AP]M/, '')}|${c.detail ?? ''}`; if (seenCk.has(k)) return false; seenCk.add(k); return true })
    .map(c => (role === 'dual' && certs !== undefined && c.status === 'nogo' && MINIMUMS_CHECK.test(c.title) ? { ...c, status: 'caution' as const, detail: `${c.detail ? `${c.detail} ` : ''}Your solo minimums; with your instructor on board, decide together.` } : c))
    .map(c => ({ ...c, fix: fixFor(c) }))
  checks.length = 0; checks.push(...finalChecks)
  const sections = Object.fromEntries((['trip', 'pilot', 'aircraft', 'loading', 'performance', 'navlog', 'weather'] as SectionKey[]).map(k => {
    const own = checks.filter(c => c.section === k).map(c => c.status)
    return [k, own.length ? worst(own) : (k === 'trip' && route.length >= 2 ? 'ok' : 'todo')]
  })) as Record<SectionKey, Status>

  return {
    profile, departAt, takeoffAt, legs, flights, navlog,
    totals: { distNm: distTotal, eteMin: eteTotal, tripFuel: fuelUsed, taxiFuel, reserveFuel, personalReserveFuel, requiredFuel, usableFuel: usable, enduranceMin },
    wx, wb: { items, ramp, takeoff, landing, emptySample, steps }, perf, samples, freezing, fb: fbSel, crossings,
    hazards: { sigmets, gairmets, cwas, tfrs, pireps }, checks, sections,
  }
}


// The planning engine: plan inputs + fetched data → navlog, weights, takeoff and
// landing performance at every airport, weather at each ETA, and the list of
// go/no-go checks. Pure; the page renders what this returns.
import type { AircraftProfile, ProfileMatch } from './poh'
import {
  category, ceilingOf, climbBetween, corrected, cruiseAt, densityAltitude, distanceAt, distanceNm, fbFor, freezingLevel, hPaToInHg, hemispheric,
  inEnvelope, initialCourse, pointInPolygon, intermediate, isaTemp, parseVisib, pressureAltitude, reserveMinutes, tafAt, tafCategory, toMagnetic, touchesCorridor,
  sampleRoute, wbTotal, windAt, windComponents, windTriangle, type Category, type FbProduct, type LatLon, type TafPeriod,
} from './calc'
import { AV1ATES, IMSAFE } from './checklists'

// ── Inputs ────────────────────────────────────────────────────────────────────
export interface Plan {
  name: string
  route: string[]
  alternate: string | null
  departLocal: string
  cruiseAlt: number
  rpm: number
  tail: string | null
  loads: { front: number; rear: number; bag1: number; bag2: number }
  fuelGal: number
  stopMinutes: number
  imsafe: Record<string, boolean | undefined>
  pave: Record<string, string>
  equipment: Record<string, boolean | undefined>
  phases: Record<string, boolean | undefined>
  night: boolean | null
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
  equipment?: { transponder?: string; adsbOut?: boolean; gps?: string; equipCode?: string; autopilot?: boolean; notes?: string }
  inspections?: Record<string, string | number | undefined> // ISO dates; 'hundredHoursLeft'
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
  sun: { rise: string; set: string; civilDawn: string; civilDusk: string; date: string } | null
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
  now?: number
}

// ── Outputs ───────────────────────────────────────────────────────────────────
export type Status = 'ok' | 'caution' | 'nogo' | 'todo'
export type SectionKey = 'trip' | 'pilot' | 'aircraft' | 'loading' | 'performance' | 'navlog' | 'weather'
export interface Check { section: SectionKey; status: Status; title: string; detail?: string; airport?: string }

export interface Leg {
  from: Airport; to: Airport; distNm: number; tc: number; mc: number; varEast: number
  wind: { dir: number | null; spd: number; temp: number | null; stations: string[] } | null
  tas: number; gph: number; wca: number; th: number; mh: number; gs: number
  climb: { min: number; gal: number; nm: number } | null
  eteMin: number; fuelGal: number; departAt: Date; arriveAt: Date; terrainMax: number | null
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
  legs: Leg[]
  totals: { distNm: number; eteMin: number; tripFuel: number; taxiFuel: number; reserveFuel: number; personalReserveFuel: number; requiredFuel: number; usableFuel: number; enduranceMin: number }
  wx: WxAt[]
  wb: { items: { label: string; weight: number; arm: number; moment: number }[]; ramp: ReturnType<typeof wbTotal>; takeoff: ReturnType<typeof wbTotal>; landing: ReturnType<typeof wbTotal>; emptySample: boolean }
  perf: PerfAt[]
  samples: LatLon[]
  freezing: { altFt: number; approx: boolean } | null
  fb: { fcst: string; product: FbProduct; outside?: boolean } | null
  crossings: { name: string; cls: string; floor: number | null; ceiling: number | null; atCruise: boolean }[]
  hazards: { sigmets: Advisory[]; gairmets: Advisory[]; cwas: Advisory[]; tfrs: WeatherBundle['tfrs']['data']; pireps: Pirep[] }
  checks: Check[]
  sections: Record<SectionKey, Status>
}

const STATUS_RANK: Status[] = ['ok', 'todo', 'caution', 'nogo']
export const worst = (xs: Status[]): Status => xs.reduce<Status>((a, b) => (STATUS_RANK.indexOf(b) > STATUS_RANK.indexOf(a) ? b : a), 'ok')

// Local "YYYY-MM-DDTHH:mm" (browser time zone) → Date.
export const parseLocal = (s: string) => { const d = new Date(s); return Number.isNaN(+d) ? null : d }

const nearest = <T extends { lat: number; lon: number }>(list: T[], p: LatLon, maxNm: number) =>
  list.map(x => ({ x, d: distanceNm(p, x) })).filter(o => o.d <= maxNm).sort((a, b) => a.d - b.d)[0] || null

const ringsOf = (g: { type: string; coordinates: unknown }): [number, number][][] =>
  g.type === 'Polygon' ? [(g.coordinates as [number, number][][])[0]] : g.type === 'MultiPolygon' ? (g.coordinates as [number, number][][][]).map(p => p[0]) : []
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

function bestRunway(a: Airport, wx: WxAt, minWidth: number): RunwayCalc[] {
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
  const byId = (id: string) => inp.airports.find(a => a.id === id.replace(/^K(?=[A-Z0-9]{3}$)/, '') || a.icao === id || a.id === id)
  const route = plan.route.map(byId).filter(Boolean) as Airport[]
  const alt = plan.alternate ? byId(plan.alternate) ?? null : null
  const minimums = inp.minimums

  // ── Trip ──
  if (plan.route.length < 2) add('trip', 'todo', 'Add a departure and a destination')
  const missing = plan.route.filter(id => !byId(id))
  if (missing.length && inp.airports.length) add('trip', 'nogo', `Not in the FAA airport data: ${missing.join(', ')}`)
  if (!departAt) add('trip', 'todo', 'Set the departure time')
  else if (departAt.getTime() < now - 30 * 60_000) add('trip', 'caution', 'Departure time is in the past', 'Weather is matched to the planned times; update it to brief the actual flight.')
  if (!plan.alternate && route.length >= 2) add('trip', 'caution', 'No alternate chosen', 'Pick an alternate near the destination in case it goes below minimums or the runway closes.')

  // ── Navlog ──
  const fbSel = inp.weather && departAt ? fbFor(inp.weather.winds, departAt) : null
  const legs: Leg[] = []
  const samples = sampleRoute(route, 2)
  let t: Date | null = departAt ? new Date(departAt) : null
  let fuelUsed = 0
  if (profile && t) {
    for (let i = 1; i < route.length; i++) {
      const from = route[i - 1], to = route[i]
      const distNm = distanceNm(from, to), tc = initialCourse(from, to), varEast = (from.magVar + to.magVar) / 2
      const mid = intermediate(from, to, 0.5)
      const wind = fbSel ? windAt(fbSel.product, mid, plan.cruiseAlt) : null
      const fieldPa = pressureAltitude(from.elev, 29.92)
      const isaDev = wind?.temp != null ? wind.temp - isaTemp(plan.cruiseAlt) : 0
      const cr = cruiseAt(profile, plan.cruiseAlt, isaDev, plan.rpm)
      const tas = cr?.ktas ?? 0, gph = cr?.gph ?? 0
      const tri = windTriangle(tc, tas, wind?.dir ?? null, wind?.spd ?? 0)
      const climb = climbBetween(profile, fieldPa, plan.cruiseAlt, isaDev)
      const climbNm = Math.min(climb.nm, distNm)
      const cruiseNm = Math.max(0, distNm - climbNm)
      const cruiseMin = tri.gs > 0 ? (cruiseNm / tri.gs) * 60 : 0
      const eteMin = climb.min + cruiseMin
      const fuelGal = climb.gal + (cruiseMin / 60) * gph
      const legSamples = sampleRoute([from, to], 2)
      const terrainMax = inp.terrain ? (() => {
        const startIdx = samples.findIndex(s => s.lat === legSamples[0].lat && s.lon === legSamples[0].lon)
        const slice = inp.terrain.slice(Math.max(0, startIdx), Math.max(0, startIdx) + legSamples.length)
        return slice.length ? Math.max(...slice) : null
      })() : null
      const departLeg = new Date(t)
      const arrive: Date = new Date(t.getTime() + eteMin * 60_000)
      legs.push({ from, to, distNm, tc, mc: toMagnetic(tc, varEast), varEast, wind, tas, gph, wca: tri.wca, th: tri.th, mh: toMagnetic(tri.th, varEast), gs: tri.gs, climb: climb.min ? climb : null, eteMin, fuelGal, departAt: departLeg, arriveAt: arrive, terrainMax })
      fuelUsed += fuelGal
      t = new Date(arrive.getTime() + plan.stopMinutes * 60_000)
    }
  }
  const distTotal = legs.reduce((s, l) => s + l.distNm, 0)
  const eteTotal = legs.reduce((s, l) => s + l.eteMin, 0)
  const cruiseGph = legs[0]?.gph || (profile ? cruiseAt(profile, plan.cruiseAlt, 0, plan.rpm)?.gph ?? 0 : 0)
  const anyNight = plan.night ?? false
  const tank = profile?.fuel.find(f => f.key === (inp.planning.tanks || 'standard')) ?? profile?.fuel[0]
  const usable = Math.min(plan.fuelGal, tank?.usable ?? plan.fuelGal)
  const taxiFuel = profile?.climbStartFuelGal ?? 1.1
  const reserveFuel = (reserveMinutes(anyNight) / 60) * cruiseGph
  const personalReserveFuel = ((anyNight ? minimums.reserveNight : minimums.reserveDay) / 60) * cruiseGph
  const requiredFuel = fuelUsed + taxiFuel + Math.max(reserveFuel, personalReserveFuel)
  const enduranceMin = cruiseGph ? ((usable - taxiFuel) / cruiseGph) * 60 : 0

  if (profile && route.length >= 2 && legs.length) {
    if (usable < fuelUsed + taxiFuel + reserveFuel) add('navlog', 'nogo', 'Fuel below the legal reserve', `Need ${(fuelUsed + taxiFuel + reserveFuel).toFixed(1)} gal (trip + taxi + ${reserveMinutes(anyNight)} min, §91.151); ${usable.toFixed(1)} gal usable on board.`)
    else if (usable < requiredFuel) add('navlog', 'caution', 'Fuel below your personal reserve', `Need ${requiredFuel.toFixed(1)} gal with a ${anyNight ? minimums.reserveNight : minimums.reserveDay}-minute reserve; ${usable.toFixed(1)} gal usable.`)
    else add('navlog', 'ok', 'Fuel covers the trip and reserve', `${requiredFuel.toFixed(1)} gal required, ${usable.toFixed(1)} gal usable.`)
    if (!fbSel) add('navlog', 'caution', 'No winds aloft forecast', 'Headings and ground speeds assume calm wind.')
    else if (fbSel.outside) add('navlog', 'caution', 'No winds-aloft forecast covers the departure time', `Using the FB ${fbSel.fcst}-hour forecast valid ${fbSel.product.valid.slice(0, 2)} ${fbSel.product.valid.slice(2)}Z; forecasts reach about 24 hours ahead — re-brief closer to the flight.`)
    for (const l of legs) {
      const h = hemispheric(l.mc, plan.cruiseAlt, l.terrainMax ?? Math.max(l.from.elev, l.to.elev))
      if (h.applies && !h.ok) add('navlog', 'caution', `${l.from.id}→${l.to.id}: ${plan.cruiseAlt.toLocaleString()} ft doesn't match the hemispheric rule`, `Magnetic course ${Math.round(l.mc)}° → ${h.suggest?.toLocaleString()} ft (§91.159).`)
      if (l.terrainMax != null && plan.cruiseAlt - l.terrainMax < 1000) add('navlog', 'nogo', `${l.from.id}→${l.to.id}: cruise is within 1,000 ft of terrain`, `Highest terrain on the line ${l.terrainMax.toLocaleString()} ft MSL.`)
      else if (l.terrainMax != null && plan.cruiseAlt - l.terrainMax < 2000) add('navlog', 'caution', `${l.from.id}→${l.to.id}: under 2,000 ft above the highest terrain`, `Terrain ${l.terrainMax.toLocaleString()} ft MSL; obstacles (towers) can stand 1,000+ ft above it.`)
      if (l.climb && l.climb.nm > l.distNm) add('navlog', 'caution', `${l.from.id}→${l.to.id}: the leg is shorter than the climb`, `${Math.round(l.climb.nm)} nm to reach ${plan.cruiseAlt.toLocaleString()} ft; plan a lower altitude.`)
    }
    if (plan.cruiseAlt > 12000) add('navlog', 'caution', 'Above 12,500 ft supplemental oxygen rules apply after 30 minutes (§91.211)')
  }

  // ── Weather at each ETA ──
  const wx: WxAt[] = []
  if (route.length && departAt) {
    wx.push(weatherAt(route[0], departAt, 'departure', inp.weather, now))
    legs.forEach((l, i) => wx.push(weatherAt(l.to, l.arriveAt, i === legs.length - 1 ? 'destination' : 'stop', inp.weather, now)))
    if (alt) {
      const lastArr = legs.at(-1)?.arriveAt ?? departAt
      const leg = route.length ? distanceNm(route[route.length - 1], alt) : 0
      wx.push(weatherAt(alt, new Date(lastArr.getTime() + (leg / Math.max(legs[0]?.gs || 100, 60)) * 3_600_000), 'alternate', inp.weather, now))
    }
  }
  const nightAny = wx.some(w => w.night) || anyNight
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
  if (freezing && plan.cruiseAlt >= freezing.altFt - 500) add('weather', 'caution', `Cruise at or above the freezing level (~${freezing.altFt.toLocaleString()} ft)`, 'Flight into known icing is prohibited (POH Section 2). Stay clear of visible moisture.')
  if (inp.weather) for (const [k, s] of Object.entries({ METARs: inp.weather.metars, TAFs: inp.weather.tafs, PIREPs: inp.weather.pireps, SIGMETs: inp.weather.sigmets, 'G-AIRMETs': inp.weather.gairmets, 'NAS status': inp.weather.nas, TFRs: inp.weather.tfrs })) {
    if (s.error) add('weather', 'caution', `${k} unavailable`, s.error)
  }

  // ── Airspace crossed ──
  const crossings: Derived['crossings'] = []
  if (inp.airspace && samples.length) {
    const seen = new Set<string>()
    for (const f of inp.airspace) {
      const key = `${f.properties.NAME}|${f.properties.CLASS}|${f.properties.LOWER_VAL}`
      if (seen.has(key)) continue
      if (!ringsOf(f.geometry).some(r => r.length > 2 && samples.some(s => pointInPolygon(s, r)))) continue
      seen.add(key)
      const floor = f.properties.LOWER_VAL != null && f.properties.LOWER_VAL > -9000 ? f.properties.LOWER_VAL : 0
      const ceiling = f.properties.UPPER_VAL != null && f.properties.UPPER_VAL > -9000 ? f.properties.UPPER_VAL : null
      crossings.push({ name: f.properties.NAME, cls: f.properties.CLASS, floor, ceiling, atCruise: plan.cruiseAlt >= (floor ?? 0) && (ceiling == null || plan.cruiseAlt <= ceiling) })
    }
    for (const c of crossings) {
      if (c.cls === 'B') add('navlog', 'caution', `Class B ${c.name} (${c.floor ? c.floor.toLocaleString() : 'SFC'}–${c.ceiling?.toLocaleString() ?? ''} ft) on the line`, c.atCruise ? 'Your cruise altitude is inside it: you need a clearance ("cleared into the Class Bravo") or a route around/under it.' : 'You pass under or over it at cruise — mind the climb and descent.')
      else if (c.cls === 'C' && c.atCruise) add('navlog', 'caution', `Class C ${c.name} at your cruise altitude`, 'Establish two-way radio communication before entering.')
    }
  }

  // ── Pilot ──
  const fit = IMSAFE.map(i => plan.imsafe[i.key])
  if (fit.some(v => v === false)) add('pilot', 'nogo', 'IMSAFE: not fit to fly', IMSAFE.filter(i => plan.imsafe[i.key] === false).map(i => i.label).join(', '))
  else if (fit.some(v => v === undefined)) add('pilot', 'todo', 'Complete the IMSAFE checklist')
  else add('pilot', 'ok', 'IMSAFE complete')
  const paveDone = ['pilot', 'aircraft', 'environment', 'external'].filter(k => (plan.pave[k] || '').trim()).length
  add('pilot', paveDone === 4 ? 'ok' : 'todo', paveDone === 4 ? 'PAVE risks reviewed' : `PAVE: ${4 - paveDone} of 4 not reviewed`)
  // §61.57 recency only binds when carrying passengers (day) or at night; a student
  // pilot flies solo on a CFI's 90-day endorsement instead of a flight review.
  for (const c of inp.currency) {
    if (c.key === 'ifr') continue
    if (c.key === 'night' && !nightAny) continue
    if (c.state === 'lapsed') add('pilot', 'caution', `${c.name}: lapsed`, `${c.detail}${c.key === 'day' ? ' — needed to carry passengers.' : c.key === 'review' ? ' — solo flight needs a current CFI endorsement instead.' : ''}`)
    else if (c.state === 'expiring' || c.state === 'grace') add('pilot', 'caution', `${c.name}: ${c.state}`, c.detail)
    else if (c.state === 'current') add('pilot', 'ok', `${c.name}: current`, c.detail)
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
        if (!d) { add('aircraft', 'todo', `${i.label}: date not recorded`, i.detail); continue }
        const due = new Date(d); due.setMonth(due.getMonth() + i.months + 1, 0) // end of the calendar month
        if (due.getTime() < (departAt?.getTime() ?? now)) add('aircraft', 'nogo', `${i.label} overdue`, `Due by ${due.toLocaleDateString()}.`)
        else add('aircraft', 'ok', `${i.label} current`, `Until ${due.toLocaleDateString()}.`)
      } else if (i.hours) {
        const left = Number(insp.hundredHoursLeft)
        if (!Number.isFinite(left) || insp.hundredHoursLeft === '' || insp.hundredHoursLeft == null) add('aircraft', 'todo', '100-hour: hours remaining not recorded', i.detail)
        else if (left - eteTotal / 60 < 0) add('aircraft', 'nogo', '100-hour inspection would be exceeded', `${left} h left, flight ~${(eteTotal / 60).toFixed(1)} h (10 h overfly only to reach a place to do it).`)
        else add('aircraft', left < 10 ? 'caution' : 'ok', `100-hour: ${left} h remaining`)
      } else if (!insp[i.key]) add('aircraft', 'todo', `${i.label}: not confirmed`, i.detail)
    }
    if (plan.equipment && Object.values(plan.equipment).filter(Boolean).length === 0) add('aircraft', 'todo', 'Required equipment (ATOMATOFLAMES) not checked')
    if (crossings.some(c => c.cls === 'B' || c.cls === 'C') && inp.planning.equipment?.adsbOut === false) add('aircraft', 'nogo', 'ADS-B Out required in and above Class B/C (§91.225)')
  }

  // ── Weight and balance ──
  const items: Derived['wb']['items'] = []
  let emptySample = false
  if (profile) {
    const ew = inp.planning.emptyWeight ?? 1467, em = inp.planning.emptyMoment ?? 57.3
    emptySample = inp.planning.emptyWeight == null
    const push = (label: string, weight: number, arm: number) => items.push({ label, weight, arm, moment: weight * arm })
    push('Basic empty weight', ew, (em * 1000) / ew)
    push(`Fuel ${plan.fuelGal} gal`, plan.fuelGal * 6, profile.fuelArm)
    const st = Object.fromEntries(profile.stations.map(s => [s.key, s]))
    push(st.front.label, plan.loads.front, st.front.arm)
    push(st.rear.label, plan.loads.rear, st.rear.arm)
    push(st.bag1.label, plan.loads.bag1, st.bag1.arm)
    push(st.bag2.label, plan.loads.bag2, st.bag2.arm)
  }
  const ramp = wbTotal(items)
  const takeoff = profile ? wbTotal([...items, { label: 'Start, taxi, runup', weight: -profile.taxiFuelLb, arm: profile.fuelArm }]) : ramp
  const landing = profile ? wbTotal([...items, { label: 'Start, taxi, runup', weight: -profile.taxiFuelLb, arm: profile.fuelArm }, { label: 'Trip fuel', weight: -fuelUsed * 6, arm: profile.fuelArm }]) : ramp
  if (profile && plan.tail) {
    const L = profile.limits
    if (plan.loads.front <= 0) add('loading', 'todo', 'Enter the pilot and front passenger weight')
    if (emptySample) add('loading', 'caution', 'Empty weight is the POH sample airplane', `Enter ${plan.tail}'s basic empty weight and moment from its W&B record.`)
    if (ramp.weight > L.maxRamp) add('loading', 'nogo', `Ramp weight ${Math.round(ramp.weight)} lb over the ${L.maxRamp} lb maximum`)
    if (takeoff.weight > L.maxTakeoff) add('loading', 'nogo', `Takeoff weight ${Math.round(takeoff.weight)} lb over the ${L.maxTakeoff} lb maximum`, `Remove ${Math.ceil(takeoff.weight - L.maxTakeoff)} lb (≈${Math.ceil((takeoff.weight - L.maxTakeoff) / 6)} gal of fuel).`)
    else add('loading', 'ok', `Takeoff weight ${Math.round(takeoff.weight)} lb`, `${Math.round(L.maxTakeoff - takeoff.weight)} lb under the maximum.`)
    if (landing.weight > L.maxLanding) add('loading', 'nogo', `Landing weight over the ${L.maxLanding} lb maximum`)
    if (plan.loads.bag1 > 120 || plan.loads.bag2 > 50 || plan.loads.bag1 + plan.loads.bag2 > L.baggageCombined) add('loading', 'nogo', 'Baggage over the limit', 'Area 1 120 lb, area 2 50 lb, 120 lb combined.')
    for (const [label, w] of [['Takeoff', takeoff], ['Landing', landing]] as const) {
      if (!inEnvelope(profile.envelope.normal, w.cg, w.weight)) add('loading', 'nogo', `${label} CG ${w.cg.toFixed(1)} in outside the envelope`, `At ${Math.round(w.weight)} lb.`)
    }
    if (plan.fuelGal > (tank?.usable ?? 40)) add('loading', 'caution', `More fuel than the ${tank?.label.toLowerCase()} hold`, `${tank?.usable} gal usable.`)
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
    legs.forEach((l, i) => {
      w -= l.fuelGal * 6
      const wxx = wx[i + 1]
      at(l.to, wxx, 'landing', w)
      if (i < legs.length - 1) at(l.to, wxx, 'takeoff', w)
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

  const sections = Object.fromEntries((['trip', 'pilot', 'aircraft', 'loading', 'performance', 'navlog', 'weather'] as SectionKey[]).map(k => {
    const own = checks.filter(c => c.section === k).map(c => c.status)
    return [k, own.length ? worst(own) : (k === 'trip' && route.length >= 2 ? 'ok' : 'todo')]
  })) as Record<SectionKey, Status>

  return {
    profile, departAt, legs,
    totals: { distNm: distTotal, eteMin: eteTotal, tripFuel: fuelUsed, taxiFuel, reserveFuel, personalReserveFuel, requiredFuel, usableFuel: usable, enduranceMin },
    wx, wb: { items, ramp, takeoff, landing, emptySample }, perf, samples, freezing, fb: fbSel, crossings,
    hazards: { sigmets, gairmets, cwas, tfrs, pireps }, checks, sections,
  }
}


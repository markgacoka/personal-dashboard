// What sits behind one NavLog row or one W&B line: the steps with this row's
// numbers, where each input came from (and the backup when it's missing), what
// was assumed, and the range a right answer falls in. Pure; built from derive()'s
// output. The method itself is written up in docs/navlog-method.md.
import { inEnvelope, isaTemp, reserveMinutes } from './calc'
import type { Derived, NavRow, Plan, WbStep, WeatherBundle, WindSrc } from './model'
import type { TableSection } from './poh'
import type { Line } from './workings'

// primary: the intended source, current · backup: a fallback or an old copy of
// the primary · yours: a value you entered · standin: a default for missing data.
export type Tier = 'primary' | 'backup' | 'yours' | 'standin'
export interface Expl {
  key: string; title: string; value: string
  steps: Line[]
  source: { used: string; tier: Tier; backup?: string; at?: string | null }
  assumes: string[]
  expect: { text: string; ok: boolean | null }
  // The row inputs you can replace here (E6B style).
  edit?: ('wdir' | 'wspd' | 'temp' | 'cas')[]
}
export interface InputSource { key: string; label: string; value: string; tier: Tier; at?: string | null; detail: string }

export interface ExplainInput { d: Derived; plan: Plan; weather: WeatherBundle | null; pohClosest: boolean }

const n0 = (x: number) => Math.round(x).toLocaleString()
const n1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1)
const deg = (x: number) => `${String(Math.round(((x % 360) + 360) % 360) || 360).padStart(3, '0')}°`
const sgn = (x: number, dp = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(dp)}`
const ew = (v: number) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? 'E' : 'W'}`
const hm = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

const WIND_TIER: Record<WindSrc, Tier> = { forecast: 'primary', stale: 'backup', yours: 'yours', row: 'yours', calm: 'standin' }
const WIND_BACKUP = 'Last good model fetch (up to 6 h old), then your briefing winds, then calm'

function windSource(r: NavRow, x: ExplainInput) {
  const prod = x.d.fb?.product
  const entry = x.weather?.winds.find(w => w.data?.length)
  const model = prod?.source ?? (x.d.fb ? `NWS FB ${x.d.fb.fcst}-hour forecast` : 'Forecast')
  const used = r.windSrc === 'row' ? 'Typed into this row' : r.windSrc === 'yours' ? 'Your briefing winds for this flight'
    : r.windSrc === 'calm' ? 'None: calm wind, standard temperature' : `${model}${r.windWindow ? `, ${r.windWindow}` : ''}${r.windSrc === 'stale' ? ' (old copy)' : ''}`
  return { used, tier: WIND_TIER[r.windSrc], backup: WIND_BACKUP, at: r.windSrc === 'forecast' || r.windSrc === 'stale' ? entry?.fetchedAt ?? null : undefined }
}

function pohSource(x: ExplainInput, fig: string | undefined, what: string) {
  const p = x.d.profile!
  const custom = what === 'cruise' && (p.cruiseFixed?.ktas || p.cruiseFixed?.gph)
  if (custom) return { used: 'Your aircraft profile\'s cruise numbers', tier: 'yours' as Tier, backup: `POH ${fig ?? what}` }
  const read = p.read
  if (read?.sections.includes(what as TableSection)) return { used: `${read.book}, ${fig ?? what} (read from the PDF)`, tier: 'primary' as Tier, backup: 'The 1982 172P POH tables' }
  if (read) return { used: `1982 172P POH, ${fig ?? what}: the ${read.book} table couldn't be read`, tier: 'backup' as Tier, backup: 'Your aircraft profile\'s numbers' }
  return { used: `${p.model} POH${fig ? `, ${fig}` : ''}`, tier: (x.pohClosest ? 'backup' : 'primary') as Tier, backup: 'The closest POH, flagged' }
}

// The row's explanation, one card per quantity, in the order they're worked out.
export function explainRow(x: ExplainInput, r: NavRow): Expl[] {
  const { d, plan } = x
  const p = d.profile
  if (!p) return []
  const out: Expl[] = []
  const flight = d.flights[r.flight]
  const isa = isaTemp(r.altFt)
  const w = r.wind
  const phase = r.phase === 'climb' ? 'climb' : r.phase === 'descent' ? 'descent' : 'cruise'

  out.push({
    key: 'course', title: 'Course', value: `MC ${deg(r.mc)}`,
    steps: [
      { k: 'Distance', v: `${n1(r.distNm)} nm (great circle)` },
      { k: 'True course', v: `${deg(r.tc)} (initial course)` },
      { k: 'Variation', v: `${ew(r.varEast)} (average of the two ends)` },
      { k: 'Magnetic course', v: `${deg(r.tc)} ${r.varEast >= 0 ? '−' : '+'} ${Math.abs(r.varEast).toFixed(1)} = ${deg(r.mc)}` },
    ],
    source: { used: 'FAA NASR positions; World Magnetic Model 2025 on the flight date', tier: 'primary', backup: 'NASR\'s per-airport variation (decades old)' },
    assumes: ['Great-circle line from the row\'s start to its end.', 'East variation is subtracted ("east is least").'],
    expect: { text: 'Matches the isogonic line on the sectional (about 13° E around the Bay Area).', ok: Math.abs(r.varEast) < 25 },
  })

  const wSpd = w?.spd ?? 0
  const tDev = r.oat - isa
  out.push({
    key: 'wind', title: 'Wind and temperature', value: w && wSpd ? `${w.dir == null ? 'VRB' : deg(w.dir)} / ${Math.round(wSpd)} kt · ${Math.round(r.oat)} °C` : `Calm · ${Math.round(r.oat)} °C`,
    steps: [
      { k: 'Altitude used', v: `${n0(r.altFt)} ft (${phase === 'cruise' ? 'cruise' : `mid-${phase}`})` },
      ...(r.windSrc === 'forecast' || r.windSrc === 'stale' ? [
        { k: 'Forecast window', v: `${r.windWindow ?? '—'}, the one covering ${hm(new Date(r.eta.getTime() - r.eteMin * 60_000))}` },
        { k: 'Points used', v: `${w?.stations.length ?? 0} nearest, weighted 1 ÷ distance²` },
        { k: 'Between levels', v: 'Linear in height; direction as a vector' },
      ] : []),
      { k: 'Standard temperature', v: `15 − 2 × ${n1(r.altFt / 1000)} = ${n1(isa)} °C` },
      { k: 'Deviation from ISA', v: `${Math.round(r.oat)} − ${n1(isa)} = ${sgn(tDev)} °C` },
    ],
    source: windSource(r, x),
    assumes: [
      'The wind at the row\'s midpoint holds for the whole row.',
      ...(r.windSrc === 'calm' ? ['No forecast: calm wind and standard temperature.'] : []),
      ...(r.windSrc === 'forecast' || r.windSrc === 'stale' ? ['Model winds aren\'t an official FAA product: compare with the GFA winds/temps chart or your Flight Service briefing.'] : []),
    ],
    expect: { text: 'Under about 50 kt at these altitudes; temperature within 15 °C of standard.', ok: r.windSrc === 'calm' ? null : wSpd <= 50 && Math.abs(tDev) <= 15 },
    edit: ['wdir', 'wspd', 'temp'],
  })

  const climbIas = r.phase === 'climb' ? p.climb.find(c => c.pa >= r.altFt)?.kias ?? 74 : null
  const casSet = r.overridden.includes('cas')
  out.push({
    key: 'tas', title: 'Airspeed', value: `${Math.round(r.tas)} KTAS · ${Math.round(r.cas)} KCAS`,
    steps: casSet ? [
      { k: 'CAS (yours)', v: `${Math.round(r.cas)} kt` },
      { k: 'TAS', v: `CAS ÷ √σ at ${n0(r.altFt)} ft, ${Math.round(r.oat)} °C = ${Math.round(r.tas)} kt` },
    ] : r.phase === 'climb' ? [
      { k: 'POH climb IAS', v: `${climbIas} kt` },
      { k: 'Climb TAS', v: `IAS ÷ √σ at ${n0(r.altFt)} ft, ${Math.round(r.oat)} °C = ${Math.round(r.tas)} kt` },
    ] : [
      { k: 'Power', v: `${plan.rpm} RPM, recommended lean` },
      { k: 'Pressure altitude', v: flight?.cruise ? `${n0(flight.alt)} + (29.92 − ${flight.cruise.altim.toFixed(2)}) × 1,000 = ${n0(flight.cruise.pa)} ft` : `${n0(r.altFt)} ft` },
      { k: 'ISA deviation', v: `${sgn(tDev, 0)} °C` },
      { k: 'POH cruise table', v: r.phase === 'descent' ? `${Math.round(r.tas)} KTAS; ${r.gph} GPH at the table's lowest power (descending)` : `${flight?.cruise ? `${flight.cruise.bhp} % BHP, ` : ''}${Math.round(r.tas)} KTAS, ${r.gph} GPH (interpolated)` },
      { k: 'CAS', v: `TAS × √σ = ${Math.round(r.cas)} kt` },
    ],
    source: casSet ? { used: 'Typed into this row', tier: 'yours', backup: 'POH cruise table' } : pohSource(x, r.phase === 'climb' ? p.figures.climb : p.figures.cruise, r.phase === 'climb' ? 'climb' : 'cruise'),
    assumes: r.phase === 'climb' ? ['POH climb speed, converted to TAS at the forecast temperature.'] : r.phase === 'descent' ? ['Descent at cruise TAS, power back to the cruise table\'s lowest RPM (the POH has no descent table).'] : ['Cruise at the chosen RPM, leaned as the POH recommends.'],
    expect: { text: `Between Vy and Vne: ${p.vspeeds.vy}–${p.vspeeds.vne} KIAS for the ${p.model}.`, ok: r.cas >= p.vspeeds.vy - 5 && r.cas <= p.vspeeds.vne },
    edit: ['cas'],
  })

  const maxWca = r.tas && wSpd ? (Math.asin(Math.min(1, wSpd / r.tas)) * 180) / Math.PI : 0
  out.push({
    key: 'heading', title: 'Heading', value: `MH ${Number.isNaN(r.mh) ? '—' : deg(r.mh)}`,
    steps: [
      { k: 'Wind angle', v: w?.dir != null ? `${deg(w.dir)} − ${deg(r.tc)} = ${sgn(((w.dir - r.tc + 540) % 360) - 180, 0)}°` : 'calm' },
      { k: 'Wind correction', v: w?.dir != null && wSpd ? `asin(${Math.round(wSpd)} × sin(${Math.round(((w.dir - r.tc + 540) % 360) - 180)}°) ÷ ${Math.round(r.tas)}) = ${sgn(r.wca)}°` : '0°' },
      { k: 'True heading', v: `${deg(r.tc)} ${r.wca >= 0 ? '+' : '−'} ${Math.abs(r.wca).toFixed(1)} = ${deg(r.th)}` },
      { k: 'Magnetic heading', v: `${deg(r.th)} ${r.varEast >= 0 ? '−' : '+'} ${Math.abs(r.varEast).toFixed(1)} = ${deg(r.mh)}` },
      { k: 'Compass heading', v: 'MH + deviation from the compass card (you enter it on the NavLog)' },
    ],
    source: { used: 'Course, wind and airspeed above', tier: WIND_TIER[r.windSrc], backup: 'Calm wind: WCA 0, TH = TC' },
    assumes: ['Steady wind through the row.'],
    expect: { text: `|WCA| ≤ ${maxWca.toFixed(1)}° (asin of wind ÷ TAS), pointing into the wind.`, ok: Number.isNaN(r.wca) ? false : Math.abs(r.wca) <= maxWca + 0.1 },
  })

  const legStart = new Date(r.eta.getTime() - r.eteMin * 60_000)
  out.push({
    key: 'time', title: 'Ground speed and time', value: `${Math.round(r.gs)} kt · ${n1(r.eteMin)} min`,
    steps: [
      { k: 'Ground speed', v: `TAS × cos(WCA) − wind × cos(wind angle) = ${Math.round(r.gs)} kt` },
      { k: 'ETE', v: r.phase === 'climb' ? `POH climb time = ${n1(r.eteMin)} min` : `${n1(r.distNm)} ÷ ${Math.round(r.gs)} × 60 = ${n1(r.eteMin)} min` },
      { k: 'ETA', v: `${hm(legStart)} + ${n1(r.eteMin)} min = ${hm(r.eta)}` },
    ],
    source: r.phase === 'climb' ? pohSource(x, p.figures.climb, 'climb') : { used: 'Wind triangle', tier: WIND_TIER[r.windSrc], backup: 'TAS alone when the wind is calm' },
    assumes: [`Takeoff ${plan.taxiMin ?? 10} min after engine start (start, taxi and run-up).`, ...(r.phase === 'descent' ? ['Descent at 500 fpm from cruise to pattern altitude.'] : [])],
    expect: { text: `${Math.round(r.tas - wSpd)}–${Math.round(r.tas + wSpd)} kt (TAS ± wind).`, ok: r.gs >= r.tas - wSpd - 1 && r.gs <= r.tas + wSpd + 1 },
  })

  const night = plan.night ?? false
  out.push({
    key: 'fuel', title: 'Fuel', value: `${r.fuelGal.toFixed(2)} gal · ${n1(r.fuelRem)} left`,
    steps: [
      { k: 'This row', v: r.phase === 'climb' ? `POH climb fuel = ${r.fuelGal.toFixed(2)} gal` : `${n1(r.eteMin)} ÷ 60 × ${r.gph} GPH = ${r.fuelGal.toFixed(2)} gal` },
      { k: 'Remaining', v: `usable − start/taxi − rows so far = ${n1(r.fuelRem)} gal` },
      { k: 'Reserve', v: `${n1(d.totals.reserveFuel)} gal (${reserveMinutes(night)} min, §91.151)` },
    ],
    source: r.phase === 'climb' ? pohSource(x, p.figures.climb, 'climb') : pohSource(x, p.figures.cruise, 'cruise'),
    assumes: [`${p.climbStartFuelGal} gal for start, taxi and takeoff per takeoff (POH).`, '6 lb per gallon (100LL).'],
    expect: { text: 'Fuel remaining stays above the reserve.', ok: r.fuelRem >= d.totals.reserveFuel },
  })
  return out
}

// One W&B line: the arithmetic, its source and the limit it's held to.
export function explainWb(x: ExplainInput, s: WbStep, i: number): Expl {
  const { d, plan } = x
  const p = d.profile!
  const steps = d.wb.steps
  if (s.total) {
    const cg = s.weight ? s.moment / s.weight : 0
    const inside = inEnvelope(p.envelope.normal, cg, s.weight)
    const lastTotal = steps.slice(0, i).map(z => !!z.total).lastIndexOf(true)
    const parts = steps.slice(Math.max(0, lastTotal), i)
    const sum = parts.map((z, k) => (k ? `${z.weight < 0 ? '−' : '+'} ${n0(Math.abs(z.weight))}` : n0(z.weight))).join(' ')
    return {
      key: `wb${i}`, title: s.label, value: `${n0(s.weight)} lb · CG ${cg.toFixed(2)} in`,
      steps: [
        { k: 'Weight', v: `${sum} = ${n0(s.weight)} lb` },
        { k: 'Moment', v: `${n0(s.moment)} lb-in` },
        { k: 'CG', v: `${n0(s.moment)} ÷ ${n0(s.weight)} = ${cg.toFixed(2)} in` },
        { k: 'Maximum', v: `${n0(s.max ?? 0)} lb` },
      ],
      source: { used: `${p.model} POH Section 2 limits and the CG envelope`, tier: x.pohClosest ? 'backup' : 'primary', backup: 'Limits in your aircraft profile' },
      assumes: ['Normal category envelope.', 'Fuel burned comes off at the fuel arm.'],
      expect: { text: `At most ${n0(s.max ?? 0)} lb, CG inside the envelope at this weight.`, ok: !s.over && inside },
    }
  }
  const isEmpty = s.label === 'Basic empty weight'
  const isFuel = /^Fuel|fuel|burn/i.test(s.label)
  const seat = !isEmpty && !isFuel
  const stn = p.stations.find(z => z.label === s.label)
  return {
    key: `wb${i}`, title: s.label, value: `${s.weight < 0 ? '−' : ''}${n0(Math.abs(s.weight))} lb × ${s.arm?.toFixed(1)} in`,
    steps: [
      ...(s.source ? [{ k: 'From', v: s.source }] : []),
      { k: 'Moment', v: `${n0(s.weight)} × ${s.arm?.toFixed(1)} = ${n0(s.moment)} lb-in` },
    ],
    source: isEmpty
      ? (d.wb.emptySample ? { used: 'POH sample airplane', tier: 'standin', backup: `${plan.tail ?? 'This tail'}'s W&B record (Aircraft → Profile and records)` } : { used: `${plan.tail}'s W&B record`, tier: 'yours' })
      : isFuel ? { used: s.label.startsWith('Fuel ') ? (plan.fuelGal == null ? 'Full usable fuel for the tanks' : 'Your fuel entry') : s.label === 'Flight burn' ? 'NavLog fuel × 6 lb/gal' : `POH (${p.climbStartFuelGal} gal)`, tier: s.label.startsWith('Fuel ') && plan.fuelGal != null ? 'yours' : 'primary' }
        : { used: 'Your seat and baggage weights', tier: 'yours' },
    assumes: isEmpty ? ['Includes unusable fuel and full oil, per the weighing record.'] : isFuel ? ['6 lb per gallon (100LL).', `Fuel arm ${p.fuelArm} in.`] : ['Weights include clothing and headsets.', ...(stn?.range ? [`Arm range ${stn.range}.`] : [])],
    expect: isEmpty
      ? { text: 'A 172 weighs about 1,400–1,700 lb empty, CG about 38–40 in.', ok: d.wb.emptySample ? null : s.weight >= 1200 && s.weight <= 1900 }
      : seat && stn?.max ? { text: `At most ${stn.max} lb here.`, ok: s.weight <= stn.max }
        : { text: s.weight >= 0 ? 'Positive weight at the station arm.' : 'Removed at the fuel arm.', ok: null },
  }
}

// Each input the NavLog and W&B depend on, with the tier of what was used.
export function inputSources(x: ExplainInput): InputSource[] {
  const { d, weather } = x
  const out: InputSource[] = []
  const src = new Set(d.navlog.map(r => r.windSrc))
  const wEntry = weather?.winds.find(w => w.data?.length)
  if (d.navlog.length) {
    const tier: Tier = src.has('calm') ? 'standin' : src.has('stale') ? 'backup' : src.has('yours') || src.has('row') ? 'yours' : 'primary'
    out.push({
      key: 'winds', label: 'Winds aloft', tier, at: tier === 'primary' || tier === 'backup' ? wEntry?.fetchedAt ?? null : undefined,
      value: tier === 'standin' ? 'Calm' : tier === 'yours' ? (src.has('yours') ? 'Your briefing' : 'Some rows typed in') : d.fb?.product.source ? 'NOAA model' : 'NWS FB',
      detail: tier === 'standin' ? 'No forecast reached the planner, so headings and times assume calm wind. Enter the winds from your briefing.'
        : tier === 'backup' ? 'The model is unreachable; using its last good forecast.' : tier === 'yours' ? 'Winds you entered replace the forecast.' : `${d.fb?.product.source ?? 'Forecast'}, for the time each row is flown.`,
    })
  }
  if (d.profile) {
    const fixed = d.profile.cruiseFixed?.ktas || d.profile.cruiseFixed?.gph
    const read = d.profile.read
    const all = read && !read.missing.length
    out.push({
      key: 'perf', label: 'Performance', value: fixed ? 'Your numbers' : read?.sections.length ? (all ? 'Read from its POH' : 'Partly 172P') : `${d.profile.model} POH`,
      tier: fixed ? 'yours' : read?.sections.length ? (all ? 'primary' : 'backup') : x.pohClosest ? 'backup' : 'primary',
      detail: read?.sections.length ? `Read from the ${read.book} PDF: ${read.sections.join(', ')}${read.missing.length ? `; ${read.missing.join(', ')} from the 172P` : ''}. Compare a row with the page in the POH tab.`
        : x.pohClosest ? 'The closest POH to this model: check the numbers against the airplane\'s own book.' : 'Cruise, climb, takeoff and landing tables.',
    })
    out.push({ key: 'empty', label: 'Empty weight', value: d.wb.emptySample ? 'POH sample' : 'Aircraft record', tier: d.wb.emptySample ? 'standin' : 'yours', detail: d.wb.emptySample ? 'Enter this tail\'s weighed empty weight and moment under Aircraft → Profile and records.' : 'Saved for this tail.' })
  }
  if (d.flights.length) {
    const unknown = d.flights.some(f => f.terrainMax == null)
    out.push({ key: 'terrain', label: 'Terrain', value: unknown ? 'Unknown' : 'Copernicus DEM', tier: unknown ? 'standin' : 'primary', detail: unknown ? 'Terrain didn\'t load: the altitude uses field elevations only.' : 'Highest ground every 2 nm along the line.' })
    out.push({ key: 'var', label: 'Variation', value: 'WMM 2025', tier: 'primary', detail: 'World Magnetic Model on the flight date.' })
  }
  if (d.wx.length) {
    const none = d.wx.filter(w => w.altimInHg == null).length
    out.push({ key: 'surface', label: 'Altimeter, temp', value: none ? `Standard at ${none}` : 'METAR', tier: none ? 'standin' : 'primary', at: weather?.metars.fetchedAt, detail: none ? 'Fields without a METAR use 29.92 inHg and standard temperature.' : 'Latest METAR at or near each airport.' })
  }
  return out
}

export const TIER_LABEL: Record<Tier, string> = { primary: 'Primary', backup: 'Backup', yours: 'Yours', standin: 'Stand-in' }

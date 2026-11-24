// The plan's workings, for the sidebar: what was assumed, every number worked
// out line by line, and where each input came from. Pure: built from derive()'s
// output and the plan, so it always matches what the steps show.
import { distanceAt, isaTemp, reserveMinutes } from './calc'
import type { Derived, Minimums, Plan, WeatherBundle } from './model'

export interface Line { k: string; v: string }
// One worked result: a title, the answer, the arithmetic and where it comes from.
import { notamHighlights, type NotamSet } from './brief'

export interface Work { title: string; result: string; lines: Line[]; fig?: string; src?: string }
export interface Topic { key: string; title: string; items: Work[] }
export interface Assumption { label: string; value: string; basis: string; change?: string }
export interface Source { what: string; from: string; at?: string | null; href?: string }

export interface WorkingsInput {
  d: Derived; plan: Plan; minimums: Minimums; weather: WeatherBundle | null
  cycle: string | null; pohNote: string | null; altAuto: boolean; altMode?: 'auto' | 'yours' | 'none'; certsSaved: boolean; terrainAt?: string | null
  notams?: NotamSet[]
}

const n0 = (x: number) => Math.round(x).toLocaleString()
const n1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1)
const sgn = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`
const deg = (x: number) => `${String(Math.round(((x % 360) + 360) % 360) || 360).padStart(3, '0')}°`
const ew = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'E' : 'W'}`
const t = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const id = (a: { icao: string | null; id: string }) => a.icao || a.id

export function assumptions(x: WorkingsInput): Assumption[] {
  const { d, plan, minimums: m } = x
  const p = d.profile
  const night = plan.night ?? false
  const out: Assumption[] = [
    { label: 'Engine start to takeoff', value: `${plan.taxiMin ?? 10} min`, basis: 'Start, taxi and run-up before the takeoff time used for every ETA.', change: 'Weight and performance → fuel and taxi' },
    { label: 'Fuel weight', value: '6 lb/gal', basis: '100LL avgas, the POH loading figure.' },
  ]
  if (p) out.push(
    { label: 'Start, taxi and run-up fuel', value: `${p.climbStartFuelGal} gal per takeoff`, basis: `POH ${p.figures.climb ?? 'climb chart'} note.` },
    { label: 'Climb', value: 'POH climb schedule', basis: 'Time, fuel and distance from the POH chart between field and cruise pressure altitude (each from the departure altimeter setting), +10 % per 10 °C above standard; climb TAS is the POH climb IAS at the forecast temperature.' },
    { label: 'Descent', value: '500 fpm at cruise TAS', basis: 'Planning figure (the POH has no descent table): top of descent = (cruise − pattern altitude) ÷ 500 fpm × ground speed before the airport, with the wind at mid-descent; fuel at the cruise table\'s lowest RPM. Pattern altitude is the airport\'s, or 1,000 ft AGL.' },
    { label: 'Pressure altitude', value: 'From the altimeter setting', basis: 'The POH tables are by pressure altitude: indicated altitude + (29.92 − the nearest METAR altimeter) × 1,000. Without a METAR within 25 nm, 29.92.' },
    { label: 'Units', value: 'Knots, nautical miles', basis: 'Each POH table\'s header is read for KIAS/KTAS or MPH; MPH tables and markings are divided by 1.151, and a table that states neither is flagged.' },
    { label: 'Cruise power', value: `${plan.rpm} RPM, recommended lean`, basis: p.cruiseFixed?.ktas || p.cruiseFixed?.gph ? 'Your aircraft profile\'s cruise numbers replace the POH table.' : `POH ${p.figures.cruise ?? 'cruise table'}, at the cruise altitude and the forecast temperature there.`, change: 'Route and fuel → cruise power' },
  )
  out.push(
    { label: 'Cruise altitude', value: x.altAuto ? 'Automatic' : 'Yours', basis: 'Lowest VFR cruising altitude for the magnetic course (§91.159), at least 3,500 ft and 1,000 ft above the highest terrain on the line; short hops stay below 3,000 ft AGL.', change: 'Route and fuel' },
    { label: 'Winds aloft', value: d.fb ? (d.fb.product.source ?? `FB ${d.fb.fcst}-hour`) : 'Calm', basis: d.fb ? 'Interpolated between the nearest stations and levels for each NavLog row.' : 'No forecast covers the departure time, so headings and ground speeds are no-wind.' },
    { label: 'Surface weather at each ETA', value: 'TAF, or METAR within the hour', basis: 'The TAF period at the ETA when it is more than an hour away; otherwise the latest METAR. Nearest report within 15 nm (METAR) or 25 nm (TAF) when the field has none.' },
    { label: 'Altimeter and temperature', value: 'From the METAR', basis: 'Without a METAR, 29.92 inHg and standard temperature.' },
    { label: 'Night', value: 'Civil twilight', basis: 'An ETA before civil dawn or after civil dusk (NASR sun times) counts as night: 45-minute reserve, night equipment and currency.' },
    { label: 'Fuel reserve', value: `${Math.max(reserveMinutes(night), night ? m.reserveNight : m.reserveDay)} min`, basis: `The larger of §91.151 (${reserveMinutes(night)} min ${night ? 'night' : 'day'}) and your minimum (${night ? m.reserveNight : m.reserveDay} min), at cruise fuel flow.`, change: 'Pilot → minimums' },
    { label: 'Runway used', value: 'Most headwind', basis: 'Then the least crosswind, then wide enough for your minimum, then the longest. Gusts count in full for the components.' },
    { label: 'Runway margin', value: '+50 % on the 50-ft distance', basis: 'The ASI safety margin; under it is a caution, a ground roll over the runway is a no-go.' },
    { label: 'Magnetic variation', value: 'WMM 2025 on the flight date', basis: 'NASR\'s per-airport values are decades old.' },
    { label: 'Empty weight', value: d.wb.emptySample ? 'POH sample airplane' : 'Aircraft W&B record', basis: d.wb.emptySample ? 'Enter this tail\'s basic empty weight and moment for real numbers.' : 'Saved for this tail.', change: 'Aircraft' },
    x.altMode === 'none'
      ? { label: 'Alternate', value: 'None', basis: 'You chose not to plan one: no alternate weather, landing distance or flight-plan entry. Not required for VFR, but keep a diversion airport in mind.', change: 'Airports' }
      : { label: 'Alternate', value: x.altMode === 'yours' ? 'Yours' : 'Automatic', basis: 'Nearest public airport within 40 nm of the destination, long enough for the airplane, not on the route and not reporting IFR.', change: 'Airports' },
    { label: 'Checkpoints', value: 'Automatic', basis: 'On legs over 20 nm: airports and VFR waypoints within 5 nm of the line, VORs within 4, RNAV fixes within 2; at least 8 nm apart and clear of the climb and descent.' },
  )
  if (!x.certsSaved) out.push({ label: 'Pilot certificate', value: 'Student pilot', basis: 'Your certificates aren\'t saved, so the Part 61 checks assume the most restrictive case.', change: 'Pilot' })
  return out
}

export function calculations(x: WorkingsInput): Topic[] {
  const { d, plan, minimums: m } = x
  const p = d.profile
  const topics: Topic[] = []

  // Time, distance and headings, leg by leg.
  if (d.legs.length) topics.push({
    key: 'legs', title: 'Courses, headings and times', items: d.legs.map((l, li) => {
      // The headings come from the first cruise row (checkpoints bend the line a little).
      const rows = d.navlog.filter(r => r.leg === li + 1)
      const r = rows.find(x => x.phase === 'cruise') ?? rows[0]
      const w = r?.wind
      return {
        title: `${id(l.from)} → ${id(l.to)}`, result: `MH ${deg(r?.mh ?? l.mh)} · GS ${Math.round(r?.gs ?? l.gs)} kt · ${Math.round(l.eteMin)} min`,
        lines: [
          { k: 'Distance (great circle)', v: `${n1(l.distNm)} nm` },
          ...(r ? [
            { k: 'Cruise segment', v: `${r.from} → ${r.to.label}, ${n1(r.distNm)} nm` },
            { k: 'True course', v: deg(r.tc) },
            { k: 'Wind at cruise', v: w && w.spd ? `${deg(w.dir ?? 0)} / ${Math.round(w.spd)} kt${w.temp != null ? `, ${Math.round(w.temp)} °C` : ''}` : 'calm' },
            { k: 'TAS (POH cruise)', v: `${Math.round(r.tas)} kt` },
            { k: 'Wind correction', v: `${sgn(r.wca)}° → TH ${deg(r.th)}` },
            { k: 'Variation (WMM)', v: `${ew(r.varEast)} → MH ${deg(r.mh)}` },
            { k: 'Ground speed', v: `${Math.round(r.gs)} kt` },
          ] : []),
          ...(l.climb ? [{ k: 'Climb', v: `${n1(l.climb.min)} min, ${l.climb.gal.toFixed(2)} gal` }] : []),
          { k: 'Time (all rows)', v: `${n1(l.eteMin)} min, ${t(l.departAt)} → ${t(l.arriveAt)}` },
          { k: 'Fuel', v: `${l.fuelGal.toFixed(2)} gal at ${l.gph} GPH` },
        ],
        fig: 'cruise',
      }
    }),
  })

  // Cruise and climb per flight.
  if (p && d.flights.length) topics.push({
    key: 'perf', title: 'Cruise altitude, power and climb', items: d.flights.flatMap(f => {
      const wTemp = f.legs[0]?.wind?.temp
      const isa = isaTemp(f.alt), dev = wTemp != null ? wTemp - isa : 0
      return [{
        title: `${id(f.from)} → ${id(f.to)} at ${n0(f.alt)} ft`, result: f.cruise ? `${f.cruise.ktas} KTAS · ${f.cruise.gph} GPH` : '—',
        lines: [
          { k: 'Highest terrain on the line', v: f.terrainMax != null ? `${n0(f.terrainMax)} ft` : 'unknown' },
          { k: 'Magnetic course', v: `${deg(f.mc)} (${f.mc < 180 ? 'east' : 'west'}bound)` },
          { k: 'Automatic altitude', v: `${n0(f.altAuto)} ft${f.hemispheric ? ', hemispheric rule' : ', under 3,000 ft AGL'}` },
          ...(f.altSet ? [{ k: 'Your altitude', v: `${n0(f.alt)} ft` }] : []),
          { k: 'Standard temperature', v: `15 − 2 × ${n1(f.alt / 1000)} = ${n1(isa)} °C` },
          { k: 'Forecast temperature', v: wTemp != null ? `${Math.round(wTemp)} °C (ISA ${sgn(dev)})` : 'none, ISA used' },
          { k: `${plan.rpm} RPM`, v: f.cruise ? `${f.cruise.bhp} % BHP, ${f.cruise.ktas} KTAS, ${f.cruise.gph} GPH` : '—' },
          ...(f.climb ? [{ k: 'Climb to cruise', v: `${n1(f.climb.min)} min, ${f.climb.gal.toFixed(2)} gal, ${n1(f.climb.nm)} nm (POH, sea-level based: chart at cruise − chart at field)` }] : []),
        ],
        fig: 'cruise',
      }]
    }),
  })

  // Fuel.
  const T = d.totals
  if (p && d.legs.length) {
    const night = plan.night ?? false
    const legal = (reserveMinutes(night) / 60) * (d.legs[0]?.gph ?? 0)
    const reserve = Math.max(T.reserveFuel, T.personalReserveFuel)
    topics.push({
      key: 'fuel', title: 'Fuel', items: [{
        title: 'Required vs on board', result: `${n1(T.requiredFuel)} of ${n1(T.usableFuel)} gal`,
        lines: [
          { k: 'Trip (NavLog rows)', v: `${T.tripFuel.toFixed(2)} gal` },
          { k: 'Start, taxi, run-up', v: `${T.taxiFuel.toFixed(2)} gal` },
          { k: `Legal reserve ${reserveMinutes(night)} min`, v: `${legal.toFixed(2)} gal` },
          { k: `Your reserve ${night ? m.reserveNight : m.reserveDay} min`, v: `${T.personalReserveFuel.toFixed(2)} gal` },
          { k: 'Required', v: `${T.tripFuel.toFixed(2)} + ${T.taxiFuel.toFixed(2)} + ${reserve.toFixed(2)} = ${T.requiredFuel.toFixed(2)} gal` },
          { k: 'Usable on board', v: `${T.usableFuel.toFixed(1)} gal` },
          { k: 'Spare', v: `${(T.usableFuel - T.requiredFuel).toFixed(1)} gal (${Math.round(((T.usableFuel - T.requiredFuel) / (d.legs[0]?.gph || 1)) * 60)} min)` },
          { k: 'Endurance', v: `(${T.usableFuel.toFixed(1)} − ${T.taxiFuel.toFixed(1)}) ÷ ${d.legs[0]?.gph} GPH = ${Math.floor(T.enduranceMin / 60)}:${String(Math.round(T.enduranceMin % 60)).padStart(2, '0')}` },
        ],
        src: '§91.151',
      }],
    })
  }

  // Each airport on the trip: where its elevation, pattern altitude,
  // frequencies, weather and NOTAMs came from, as the NavLog uses them.
  if (d.wx.length) topics.push({
    key: 'airports', title: 'Airports: elevation, pattern, frequencies, weather, NOTAMs', items: d.wx.map(w => {
      const a = w.airport, code = id(a)
      const f = (u: RegExp) => a.frequencies.filter(x => u.test(x.use)).map(x => x.freq).join(', ')
      const n = x.notams?.find(s => s.icao === code)
      const hi = n ? notamHighlights(n.items, 6).shown : []
      return {
        title: `${code} · ${w.role} at ${t(w.at)}`, result: `${n0(a.elev)} ft`, src: `FAA NASR${x.cycle ? ` cycle ${x.cycle}` : ''}`,
        lines: [
          { k: 'Field elevation', v: `${n0(a.elev)} ft MSL (NASR)` },
          { k: 'Pattern altitude', v: a.tpaAgl ? `${n0(a.elev + a.tpaAgl)} ft MSL: elevation + ${n0(a.tpaAgl)} ft (NASR traffic pattern altitude)` : `${n0(a.elev + 1000)} ft MSL: elevation + 1,000 ft (AIM 4-3-3 default; NASR lists none)` },
          { k: 'Frequencies on the NavLog', v: [a.towered ? `tower ${f(/^LCL/) || '—'}${a.towerHrs ? ` (${a.towerHrs})` : ''}, ground ${f(/^GND/) || '—'}` : `CTAF ${f(/^CTAF/) || f(/UNICOM/) || '—'}`, f(/ATIS/) && `ATIS ${f(/ATIS/)}`, a.wx?.freq && `${a.wx.type} ${a.wx.freq}`].filter(Boolean).join(' · ') + ' (NASR; D-ATIS from the FAA when the tower publishes it)' },
          { k: 'Weather used', v: w.wind.from === 'taf' ? `TAF ${w.tafStation ?? ''} for ${t(w.at)} (more than an hour out, so the forecast)` : w.metar ? `METAR ${w.metarStation ?? ''}, observed ${t(new Date(w.metar.obsTime * 1000))}` : 'No METAR or TAF within 25 nm' },
          { k: 'NOTAMs', v: !n ? 'Not loaded' : n.unavailable ? 'FAA NOTAM Search unavailable: check 1800wxbrief.com' : `${n.items.length} from FAA NOTAM Search${hi.length ? `; for a VFR flight: ${hi.join(' · ')}` : '; none that affect a VFR flight'}` },
        ],
      }
    }),
  })

  // Density altitude at each ETA (one per airport and time).
  if (d.wx.length) topics.push({
    key: 'da', title: 'Pressure and density altitude', items: d.wx.map(w => {
      const alt = w.altimInHg ?? 29.92, oat = w.tempC, isa = isaTemp(w.pa)
      return {
        title: `${id(w.airport)} at ${t(w.at)}`, result: w.da != null ? `DA ${n0(w.da)} ft` : `PA ${n0(w.pa)} ft`,
        lines: [
          { k: 'Field elevation', v: `${n0(w.airport.elev)} ft` },
          { k: 'Altimeter', v: `${alt.toFixed(2)} inHg${w.altimInHg == null ? ' (standard; no METAR)' : ` (METAR ${w.metarStation})`}` },
          { k: 'Pressure altitude', v: `${n0(w.airport.elev)} + (29.92 − ${alt.toFixed(2)}) × 1,000 = ${n0(w.pa)} ft` },
          { k: 'Standard temperature', v: `15 − 2 × ${n1(w.pa / 1000)} = ${n1(isa)} °C` },
          { k: 'Density altitude', v: oat != null ? `${n0(w.pa)} + 120 × (${oat} − ${n1(isa)}) = ${n0(w.da!)} ft` : 'no temperature reported' },
        ],
      }
    }),
  })

  // Takeoff and landing distances.
  if (p && d.perf.length) topics.push({
    key: 'runway', title: 'Runway wind and distances', items: d.perf.map(pf => {
      const r = pf.runway, w = pf.wx
      const temp = w.tempC ?? isaTemp(w.pa)
      const raw = distanceAt(pf.kind === 'takeoff' ? p.takeoff : p.landing, pf.weight, Math.max(w.pa, 0), Math.max(temp, 0))
      const notes = pf.kind === 'takeoff' ? p.takeoffNotes : p.landingNotes
      const f = r ? (r.head >= 0 ? 1 - notes.headwindPer9kt * (r.head / 9) : 1 + notes.tailwindPer2kt * (-r.head / 2)) : 1
      const grass = !!r && !/ASPH|CONC|PEM/.test(r.runway.surface || '')
      const avail = r ? (pf.kind === 'takeoff' ? r.toraFt : r.ldaFt) : null
      const spd = w.wind.gust ?? w.wind.spd
      return {
        title: `${id(pf.airport)} ${pf.kind}${r ? ` RWY ${r.end.id}` : ''}`, result: pf.dist ? `${n0(pf.dist.total)} of ${avail != null ? n0(avail) : '—'} ft` : 'off the chart',
        lines: [
          { k: 'Weight', v: `${n0(pf.weight)} lb` },
          { k: 'Pressure altitude, temperature', v: `${n0(w.pa)} ft, ${Math.round(temp)} °C${w.tempC == null ? ' (standard)' : ''}` },
          ...(raw ? [{ k: 'POH chart (interpolated)', v: `ground ${n0(raw.ground)} ft, over 50 ft ${n0(raw.total)} ft` }] : []),
          ...(r ? [
            { k: 'Wind', v: w.wind.dir != null && spd ? `${deg(w.wind.dir)} / ${spd} kt${w.wind.gust ? ' (gust)' : ''} on runway ${deg(r.end.trueHdg ?? 0)} true` : 'calm' },
            { k: 'Components', v: `${r.head >= 0 ? `${r.head} kt head` : `${-r.head} kt tail`}, ${Math.abs(r.cross)} kt cross` },
            { k: 'Wind factor', v: r.head >= 0 ? `1 − ${notes.headwindPer9kt} × ${r.head}/9 = ${f.toFixed(3)}` : `1 + ${notes.tailwindPer2kt} × ${-r.head}/2 = ${f.toFixed(3)}` },
          ] : []),
          ...(grass ? [{ k: 'Dry grass', v: `+${Math.round(notes.grassGroundRoll * 100)} % of the ground roll` }] : []),
          ...(pf.dist ? [{ k: 'Corrected', v: `ground ${n0(pf.dist.ground)} ft, over 50 ft ${n0(pf.dist.total)} ft` }] : []),
          ...(pf.asi != null ? [{ k: 'With +50 % margin', v: `${n0(pf.dist!.total)} × 1.5 = ${n0(pf.asi)} ft` }] : []),
          ...(avail != null ? [{ k: pf.kind === 'takeoff' ? 'Takeoff run available' : 'Landing distance available', v: `${n0(avail)} ft` }] : []),
          ...(r ? [{ k: 'Crosswind limits', v: `${p.crosswindDemo} kt demonstrated, yours ${m.maxCrosswind} kt` }] : []),
        ],
        fig: pf.kind,
      }
    }),
  })

  // Weight and balance.
  if (p && d.wb.steps.length) topics.push({
    key: 'wb', title: 'Weight and balance', items: [{
      title: 'Loading', result: `Takeoff ${n0(d.wb.takeoff.weight)} lb, CG ${d.wb.takeoff.cg.toFixed(2)} in`,
      lines: d.wb.steps.map(s => s.total
        ? { k: `= ${s.label}`, v: `${n0(s.weight)} lb, CG ${(s.moment / (s.weight || 1)).toFixed(2)} in (${n0(s.moment)} ÷ ${n0(s.weight)}); max ${n0(s.max ?? 0)}${s.over ? ' · OUT' : ''}` }
        : { k: s.label, v: `${s.weight < 0 ? '−' : ''}${n0(Math.abs(s.weight))} lb × ${s.arm?.toFixed(1)} in = ${n0(s.moment)} lb-in` }),
      fig: 'wb',
    }],
  })
  return topics
}

export function sources(x: WorkingsInput): Source[] {
  const { d, weather: w } = x
  const out: Source[] = []
  if (d.profile) out.push({ what: 'Aircraft performance, limits and loading', from: x.pohNote ? `${d.profile.source}. ${x.pohNote}` : d.profile.source })
  out.push({ what: 'Airports, runways, frequencies, navaids and fixes', from: `FAA NASR${x.cycle ? `, cycle ${x.cycle}` : ''}`, href: 'https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/' })
  if (w) {
    out.push({ what: 'METARs and TAFs', from: 'aviationweather.gov', at: w.metars.fetchedAt, href: 'https://aviationweather.gov' })
    out.push({ what: 'SIGMETs, G-AIRMETs, CWAs and PIREPs', from: 'aviationweather.gov', at: w.sigmets.fetchedAt })
    const wind = d.fb ? w.winds.find(z => z.fcst === d.fb!.fcst) : null
    out.push({ what: 'Winds and temperatures aloft', from: d.fb ? (d.fb.product.source ? `${d.fb.product.source} (the NWS FB tables ended Nov 3, 2026)` : `NWS FB ${d.fb.fcst}-hour forecast, based ${d.fb.product.basedOn}Z`) : 'none for this time', at: wind?.fetchedAt })
    out.push({ what: 'TFRs', from: 'tfr.faa.gov', at: w.tfrs.fetchedAt, href: 'https://tfr.faa.gov' })
    out.push({ what: 'Airport closures and delays', from: 'FAA NAS Status', at: w.nas.fetchedAt, href: 'https://nasstatus.faa.gov' })
  }
  out.push(
    { what: 'NOTAMs', from: 'FAA NOTAM Search', href: 'https://notams.aim.faa.gov/notamSearch/' },
    { what: 'Class B, C and D airspace', from: 'FAA Class Airspace dataset (sectional charts)', href: 'https://adds-faa.opendata.arcgis.com/datasets/c6a62360338e408cb1512366ad61559e_0' },
    { what: 'Terrain under the route', from: 'Open-Meteo elevation (Copernicus GLO-90), every 2 nm', at: x.terrainAt },
    { what: 'Magnetic variation', from: 'World Magnetic Model 2025 (NOAA)' },
    { what: 'Currency and recency', from: 'Your logbook on this site' },
    { what: 'Certificates, minimums, aircraft and airport profiles', from: 'What you saved here' },
  )
  return out
}

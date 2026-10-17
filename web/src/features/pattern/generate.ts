// Builds an arrival scenario for any US airport from its FAA NASR record and
// the conditions (live METAR/NOTAMs or generated weather). Every answer is
// derived from the data: wind, runway length and surface, closures, the
// published traffic direction, pattern altitude, tower hours and frequencies.
import type { Airport } from './airports'
import { bearing, compass8, components, descentPlan, fmtHdg, norm360, polar, runwayEnds, type RunwayEnd, type Wind } from './geo'
import type { Info, Opt, Scenario, Step, Question } from './model'
import { whereRelative } from './drill'
import { ident, sameRwy, spokenName, titleCase, toAirport, type NasrAirport } from './nasr'

export type Rng = () => number
const pick = <T,>(rng: Rng, xs: T[]) => xs[Math.floor(rng() * xs.length)]
const shuffle = <T,>(rng: Rng, xs: T[]) => xs.map(x => [rng(), x] as const).sort((a, b) => a[0] - b[0]).map(x => x[1])
const r5 = (h: number) => Math.round(h / 5) * 5
const ME = 'Cessna 6512K', SHORT = 'Cessna 12K'
const POH = 'C172P POH §4 (verify against your aircraft)'

export interface Conditions {
  source: 'live' | 'generated'
  station?: string
  wind: Wind
  visSm: number
  ceilingAgl: number | null // lowest BKN/OVC layer above the field
  skyText: string
  tempC: number
  dewC: number
  altimInHg: number
  raw?: string
  localHour: number
  closures: string[] // runway idents closed by NOTAM or remark
  notams: string[]
}

// ── Runway suitability for a C172P ─────────────────────────────────────────────
// POH landing distance over a 50 ft obstacle is ~1,335 ft at sea level; add
// ~4% per 1,000 ft of density altitude, ~20% on turf/gravel, and a 1.3 safety factor. The API's `suitable` flag uses
// the same rule for a standard day (api/src/services/nasr.js).
export function landingNeed(elev: number, surface: string | null, daFt: number) {
  const soft = surface ? !/ASPH|CONC|PEM/.test(surface) : true
  return Math.round(1335 * (1 + 0.04 * Math.max(elev, daFt) / 1000) * (soft ? 1.2 : 1) * 1.3 / 50) * 50
}

export interface EndInfo { e: RunwayEnd; len: number; lda: number; surface: string | null; ok: boolean; why: string; head: number; cross: number }

export function assessEnds(rec: NasrAirport, ap: Airport, c: Conditions): EndInfo[] {
  const da = densityAltitude(rec.elev, c.altimInHg, c.tempC)
  const ends = ap.runways.flatMap(runwayEnds)
  return ends.map(e => {
    const rw = rec.runways.find(r => r.ends.some(x => x.id === e.ident))!
    const nend = rw.ends.find(x => x.id === e.ident)!
    const lda = nend.lda ?? rw.len - (nend.displaced || 0)
    const need = landingNeed(rec.elev, rw.surface, da)
    const comp = components(c.wind, e.hdg)
    const closed = c.closures.some(cl => cl.split('/').some(x => sameRwy(x, e.ident)))
    const bad = rw.surface && /WATER|ROOF|DECK|SNOW|ICE|WOOD|ALUMINUM|STEEL/.test(rw.surface)
    let why = '', ok = true
    if (closed) { ok = false; why = `Runway ${rw.id} is closed (${c.source === 'live' ? 'NOTAM' : 'remark'}).` }
    else if (bad) { ok = false; why = `${titleCase(rw.surface!)} surface: not a runway for a 172 on wheels.` }
    else if (lda < need) { ok = false; why = `${lda.toLocaleString()} ft available for landing; a 172 here needs about ${need.toLocaleString()} ft with a safety margin.` }
    return { e, len: rw.len, lda, surface: rw.surface, ok, why, head: comp.head, cross: comp.cross }
  })
}

export function densityAltitude(elev: number, altim: number, tempC: number) {
  const pa = elev + (29.92 - altim) * 1000
  const isa = 15 - 2 * (elev / 1000)
  return Math.round(pa + 120 * (tempC - isa))
}

export function calmWindRunway(rec: NasrAirport): string | null {
  for (const r of rec.remarks) {
    const m = r.match(/\b(?:RWY|RY)S?\s*(\d{1,2}[LRC]?)\b[^.]*?CALM WIND/)
    if (m) return m[1]
  }
  return null
}

// The runway in use: best headwind among usable ends; the published calm-wind runway in light wind.
export function chooseRunway(rec: NasrAirport, ends: EndInfo[], w: Wind) {
  const usable = ends.filter(x => x.ok)
  if (!usable.length) return null
  const calm = calmWindRunway(rec)
  const calmEnd = calm ? usable.find(x => sameRwy(x.e.ident, calm)) : undefined
  if (w.spd <= 4 && calmEnd && calmEnd.head > -3) return { end: calmEnd, reason: 'calm' as const }
  const sorted = usable.slice().sort((a, b) => b.head - a.head || Math.abs(a.cross) - Math.abs(b.cross) || b.len - a.len)
  if (w.spd <= 2) return { end: usable.slice().sort((a, b) => b.len - a.len)[0], reason: 'longest' as const }
  return { end: sorted[0], reason: 'wind' as const }
}

const towerOpen = (hrs: string | null, hour: number) => {
  if (!hrs) return true
  if (/CONT|24/.test(hrs) && !/\d{4}-\d{4}/.test(hrs)) return true
  const m = hrs.match(/(\d{2})(\d{2})-(\d{2})(\d{2})/)
  if (!m) return true
  const a = +m[1] + +m[2] / 60, b = +m[3] + +m[4] / 60
  return a < b ? hour >= a && hour < b : hour >= a || hour < b
}

const freqOf = (rec: NasrAirport, use: RegExp, rwy?: string) => {
  const fs = rec.frequencies.filter(f => use.test(f.use))
  return (rwy ? fs.find(f => f.sector && f.sector.split(/[ /]/).some(x => sameRwy(x, rwy))) : null) ?? fs[0] ?? null
}

// ── Generated weather ─────────────────────────────────────────────────────────
export function generateConditions(rec: NasrAirport, rng: Rng): Conditions {
  const ap = toAirport(rec)
  const ends = ap.runways.flatMap(runwayEnds)
  const aligned = rng() < 0.65 && ends.length
  const dir = aligned ? norm360(pick(rng, ends).hdg + (rng() - 0.5) * 70) : rng() * 360
  const spd = Math.round(rng() < 0.12 ? rng() * 3 : 4 + Math.pow(rng(), 1.3) * 16)
  const gust = spd >= 8 && rng() < 0.3 ? spd + 5 + Math.round(rng() * 8) : undefined
  const marginal = rng() < 0.12
  const ceil = marginal ? 800 + Math.round(rng() * 6) * 100 : rng() < 0.5 ? null : 3000 + Math.round(rng() * 50) * 100
  const tempC = Math.round(30 - rec.elev / 400 - rng() * 22)
  const hour = 8 + Math.floor(rng() * 12)
  const sky = ceil == null ? (rng() < 0.5 ? 'Sky clear' : `Few ${(4000 + Math.round(rng() * 40) * 100).toLocaleString()}`) : `Ceiling ${ceil.toLocaleString()} ${rng() < 0.5 ? 'broken' : 'overcast'}`
  return {
    source: 'generated', wind: { dir: Math.round(dir / 10) * 10 || 360, spd, gust }, visSm: marginal ? 3 + Math.floor(rng() * 3) : 10,
    ceilingAgl: ceil, skyText: sky, tempC, dewC: tempC - 3 - Math.round(rng() * 12), altimInHg: Math.round((29.75 + rng() * 0.5) * 100) / 100,
    localHour: hour, closures: rec.remarks.flatMap(r => { const m = r.match(/^RWY (\d{1,2}[LRC]?\/\d{1,2}[LRC]?) CLSD(?: INDEF\w*)?\.?$/); return m ? [m[1]] : [] }), notams: [],
  }
}

// METAR JSON from aviationweather.gov (as returned by /api/external/metar/:icao).
export interface AwcMetar { rawOb?: string; wdir?: number | string; wspd?: number; wgst?: number; visib?: number | string; temp?: number; dewp?: number; altim?: number; clouds?: { cover: string; base: number | null }[] }
export function liveConditions(rec: NasrAirport, m: AwcMetar, station: string, notams: string[], localHour: number, rng: Rng): Conditions {
  const gen = generateConditions(rec, rng)
  const vrb = m.wdir === 'VRB' || m.wdir == null
  const layer = (m.clouds || []).find(c => /BKN|OVC|OVX/.test(c.cover) && c.base != null)
  const altim = m.altim ? (m.altim > 100 ? m.altim / 33.8639 : m.altim) : gen.altimInHg
  const closures = [...gen.closures]
  for (const n of notams) { const mm = n.match(/^RWY (\d{1,2}[LRC]?\/\d{1,2}[LRC]?) CLSD\b(?!.*\b(?:EXC|DLY|MON|TUE|WED|THU|FRI|SAT|SUN)\b)/); if (mm) closures.push(mm[1]) }
  const vis = typeof m.visib === 'string' ? parseFloat(m.visib) || 10 : m.visib ?? 10
  return {
    source: 'live', station, raw: m.rawOb,
    wind: { dir: vrb ? 0 : Math.round(Number(m.wdir) - rec.magVar) || 360, spd: m.wspd ?? 0, gust: m.wgst || undefined },
    visSm: vis, ceilingAgl: layer?.base ?? null,
    skyText: (m.clouds || []).filter(c => c.base != null).map(c => `${({ FEW: 'Few', SCT: 'Scattered', BKN: 'Broken', OVC: 'Overcast' } as Record<string, string>)[c.cover] ?? c.cover} ${c.base!.toLocaleString()}`).join(', ') || 'Sky clear',
    tempC: m.temp != null ? Math.round(m.temp) : gen.tempC, dewC: m.dewp != null ? Math.round(m.dewp) : gen.dewC, altimInHg: Math.round(altim * 100) / 100, localHour, closures, notams,
  }
}

// ── The scenario ──────────────────────────────────────────────────────────────
export function makeArrival(rec: NasrAirport, c: Conditions, rng: Rng = Math.random): Scenario {
  const ap = toAirport(rec)
  const id = ident(rec)
  const name = spokenName(rec)
  const ends = assessEnds(rec, ap, c)
  const choice = chooseRunway(rec, ends, c.wind)
  const da = densityAltitude(rec.elev, c.altimInHg, c.tempC)
  const open = rec.towered && towerOpen(rec.towerHrs, c.localHour)
  const ctaf = freqOf(rec, /^CTAF$/)?.freq ?? (rec.towered ? freqOf(rec, /^LCL/)?.freq : null) ?? '122.9'
  const hh = String(c.localHour).padStart(2, '0') + ':' + String(Math.floor(rng() * 6) * 10).padStart(2, '0')
  const brgFrom = Math.round(rng() * 360)
  const nm = Math.round((9 + rng() * 3) * 10) / 10
  const pos = polar(brgFrom, nm)
  const cruise = Math.ceil((rec.elev + 2500) / 500) * 500 + 500
  const hdgIn = r5(bearing(pos, [0, 0]))
  const wx = rec.wx
  const wxName = wx ? `${wx.type}${wx.distNm ? ` at ${wx.id} (${wx.distNm} nm away)` : ''}` : 'no on-field weather'
  const wxCom: [string, string] | undefined = wx?.freq ? [`${Number(open ? freqOf(rec, /^LCL/, choice?.end.e.ident)?.freq ?? ctaf : ctaf).toFixed(3)} ${open ? 'TWR' : 'CTAF'}`, `${Number(wx.freq).toFixed(3)} ${wx.id} ${wx.type}`] : undefined
  const windTxt = c.wind.spd < 3 ? 'calm' : `${fmtHdg(c.wind.dir)} at ${c.wind.spd}${c.wind.gust ? ` gust ${c.wind.gust}` : ''}`
  const steps: Step[] = []
  const base = { at: { polar: [brgFrom, nm] as [number, number] }, alt: cruise, hdg: hdgIn, gs: 105, time: hh }
  const supplement: Info = { kind: 'supplement', title: `Chart Supplement · ${id}` }

  // 1. What exists and what can you use?
  {
    const facts: Opt[] = []
    const T = (label: string, why: string) => facts.push({ id: `t${facts.length}`, label, why: `True. ${why}` })
    const F = (label: string, why: string) => facts.push({ id: `f${facts.length}`, label, why: `False. ${why}` })
    const rights = ends.filter(x => x.e.side === 'R'), lefts = ends.filter(x => x.e.side === 'L')
    if (rights.length) T(`Runway ${rights[0].e.ident} uses right traffic.`, 'The FAA data flags right-hand traffic for that runway end; assume nothing.')
    if (lefts.length) F(`Runway ${lefts[0].e.ident} uses right traffic.`, `Runway ${lefts[0].e.ident} is standard left traffic (14 CFR 91.126).`)
    T(`Pattern altitude is about ${ap.tpa.toLocaleString()} ft MSL.`, `${ap.tpaNote}; field elevation ${ap.elev.toLocaleString()} ft.`)
    if (rec.elev > 400) F(`Pattern altitude is ${(rec.tpaAgl ?? 1000).toLocaleString()} ft MSL.`, `That is the height above the field (AGL). Add the ${ap.elev.toLocaleString()} ft elevation.`)
    if (!rec.towered) {
      T(`The CTAF is ${ctaf}.`, 'From the FAA frequency file.')
      if (ctaf !== '122.8') F('The CTAF is 122.8.', `It is ${ctaf} here. 122.8 is common, which is why it is a trap.`)
      else F('The CTAF is 123.0.', 'It is 122.8 here.')
      F('A control tower is open during the day.', 'Non-towered field: self-announce on the CTAF.')
    } else {
      T(`A tower operates ${rec.towerHrs ?? 'here'}${ctaf ? `; CTAF ${ctaf} when it is closed` : ''}.`, 'From the FAA tower record.')
    }
    const bad = ends.find(x => !x.ok)
    if (bad) T(`Runway ${bad.e.ident} is not usable for you today.`, bad.why)
    const disp = ends.find(x => x.e.displacedNm > 0)
    if (disp) T(`Runway ${disp.e.ident} has a ${Math.round(disp.e.displacedNm * 6076)} ft displaced threshold.`, 'Touch down beyond it; that pavement is for takeoff and rollout.')
    if (rec.use !== 'PU') T('This is a private-use airport: you need prior permission to land.', 'Private-use facilities are not open to the public (FAA data: use code PR).')
    const sel = shuffle(rng, facts).slice(0, 6)
    if (!sel.some(f => f.id.startsWith('t'))) sel[0] = facts.find(f => f.id.startsWith('t'))!
    steps.push({
      ...base, at: { polar: [brgFrom, nm + 25] }, alt: rec.elev, gs: 0, phase: 'Preflight', title: 'What exists, and what can you use?',
      situation: `You are planning a flight to ${titleCase(rec.name)} (${id}) in ${titleCase(rec.city)}, ${rec.state}. You have never been there. Read the Chart Supplement data from the FAA (cycle ${rec.cycle})${c.notams.length ? ' and today’s NOTAMs' : ''} first.`,
      info: [supplement, ...(c.notams.length ? [{ kind: 'notam' as const, title: `Live NOTAMs · ${id}`, lines: c.notams.slice(0, 12) }] : [])],
      q: { kind: 'multi', prompt: 'Which statements are true? Select all that apply.', options: sel, answer: sel.filter(f => f.id.startsWith('t')).map(f => f.id), why: 'Brief the field before you go: runways and their condition, traffic direction for each runway end, pattern altitude, frequencies, tower hours and remarks.', refs: ['14 CFR 91.103', `Chart Supplement ${id}`] },
    })
  }

  // 2. Weather and runway
  const wxText = `${wx && !wx.distNm ? name : wx?.id ?? name} automated weather observation, ${c.raw?.match(/ \d{2}(\d{4})Z /)?.[1] ?? `${String((c.localHour + 7) % 24).padStart(2, '0')}55`}Z. Wind ${c.wind.spd < 3 ? 'calm' : `${fmtHdg(c.wind.dir)} at ${c.wind.spd}${c.wind.gust ? ` gust ${c.wind.gust}` : ''}`}. Visibility ${c.visSm >= 10 ? 10 : c.visSm}. ${c.skyText}. Temperature ${c.tempC}, dew point ${c.dewC}. Altimeter ${c.altimInHg.toFixed(2)}.`
  const wxInfo: Info[] = [
    { kind: 'weather', title: c.source === 'live' ? `Live METAR · ${c.station}` : 'Weather (generated)', lines: [c.raw || wxText, `Density altitude ≈ ${da.toLocaleString()} ft`] },
  ]
  const radioWx = wx ? [{ from: `${wx.id} ${wx.type}`, text: wxText, voice: 2 }] : []
  if (!choice) {
    steps.push({
      ...base, phase: 'Decision', title: 'Is there anywhere to land?', com: wxCom, radio: radioWx, info: [...wxInfo, supplement],
      situation: `${wx ? `You listen to the ${wxName}.` : 'There is no weather reporting nearby.'} Look at every runway in the data.`,
      q: {
        kind: 'choice', prompt: 'Can you land here in a 172 today?', answer: 'no',
        options: [
          { id: 'yes', label: 'Yes, pick the longest runway and use short-field technique', why: ends.map(x => `${x.e.ident}: ${x.why}`).join(' ') },
          { id: 'no', label: 'No. Every runway is closed, too short or unsuitable; pick another airport', why: 'Correct. No runway meets the need with a safety margin.' },
        ],
        why: 'Runway suitability is part of the land/no-land decision: length available versus the POH landing distance adjusted for elevation, temperature and surface, plus closures.', refs: [POH, '14 CFR 91.103'],
      },
    })
    return finish()
  }
  const best = choice.end
  const rwyOpts = shuffle(rng, ends).slice(0, 8)
  if (!rwyOpts.includes(best)) rwyOpts[0] = best
  const compTxt = (x: EndInfo) => `${Math.abs(Math.round(x.head))} kt ${x.head >= 0 ? 'headwind' : 'tailwind'}, ${Math.abs(Math.round(x.cross))} kt crosswind${Math.round(x.cross) ? ` from the ${x.cross > 0 ? 'right' : 'left'}` : ''}`
  const runwayQ: Question = {
    kind: 'choice', prompt: `Wind ${windTxt}. Which runway do you plan to land on?`, answer: best.e.ident,
    options: rwyOpts.map(x => ({ id: x.e.ident, rwy: x.e.ident, label: `Runway ${x.e.ident} · ${x.len.toLocaleString()} ft${x.surface ? ` ${titleCase(x.surface)}` : ''}`,
      why: !x.ok ? x.why : x === best ? `Best choice. ${compTxt(x)}.${choice.reason === 'calm' ? ' It is also the published calm-wind runway.' : ''}` : `${compTxt(x)}.` })),
    why: choice.reason === 'calm' ? `In light wind use the published calm-wind runway (${best.e.ident}); it is where other traffic will be.` : choice.reason === 'longest' ? `With calm wind and no published calm-wind runway, use the runway in use you hear on frequency; here traffic is using the longest runway, ${best.e.ident}.` : 'Choose the usable runway most aligned with the wind. Broadcast weather (AWOS/ASOS/ATIS) gives wind in magnetic degrees; METAR text uses true.',
    refs: ['AIM 4-3-3', 'AIM 7-1-12'],
  }
  steps.push({ ...base, phase: 'Weather', title: wx ? `Listen to the ${wx.type}` : 'Get the wind', com: wxCom, radio: radioWx, info: [...wxInfo, supplement], situation: `Inbound at ${cruise.toLocaleString()} ft. ${wx ? `You tune the ${wxName}.` : 'No weather station within 30 nm: you will rely on the windsock and other traffic.'}`, q: runwayQ })

  // 3. Land/no-land
  const xw = Math.abs(best.cross), gf = c.wind.gust ? c.wind.gust - c.wind.spd : 0
  const lowCeil = c.ceilingAgl != null && c.ceilingAgl < (rec.tpaAgl ?? 1000) + 500
  const lowVis = c.visSm < 3
  const tooWindy = xw > 15 || gf > 15 || best.head < -5
  const nogo = tooWindy || lowCeil || lowVis
  const factors = [
    `crosswind ${Math.round(xw)} kt (172P demonstrated 15)`, gf ? `gust factor ${gf} kt` : 'no gusts',
    `ceiling ${c.ceilingAgl == null ? 'none' : `${c.ceilingAgl.toLocaleString()} ft AGL`} vs pattern ${(rec.tpaAgl ?? 1000).toLocaleString()} AGL`, `visibility ${c.visSm} SM`, `density altitude ${da.toLocaleString()} ft`,
  ]
  steps.push({
    ...base, phase: 'Decision', title: 'Land or not?', info: wxInfo,
    situation: `Runway ${best.e.ident}: ${compTxt(best)}. Weather: ${c.skyText.toLowerCase()}, visibility ${c.visSm} SM. Your limits: 15 kt crosswind (172P demonstrated), 10 kt gust factor, and a pattern flown 500 ft below the clouds with at least 3 SM.`,
    q: {
      kind: 'choice', prompt: 'Is this a go?', answer: nogo ? 'no' : 'go',
      options: [
        { id: 'go', label: 'Go: conditions are within limits', why: nogo ? `No: ${[tooWindy && 'the wind exceeds the airplane or your limits', lowCeil && 'the ceiling does not allow a pattern 500 ft below the clouds', lowVis && 'visibility is below 3 SM'].filter(Boolean).join('; ')}.` : 'Correct.' },
        { id: 'no', label: 'No-go: divert or wait', why: nogo ? 'Correct.' : 'Nothing here exceeds the limits; waiting is fine but not required.' },
      ],
      why: `Check every factor: ${factors.join('; ')}.`, refs: ['14 CFR 91.155', POH],
    },
  })
  if (nogo) return finish()

  // 4. Pattern direction and side
  const sideBrg = bearing([0, 0], best.e.out)
  const side = compass8(sideBrg)
  const dir = best.e.side === 'L' ? 'left' : 'right'
  const opp = compass8(sideBrg + 180)
  steps.push({
    ...base, phase: 'Entry', title: 'Traffic direction', scene: {},
    situation: `Runway ${best.e.ident} (${fmtHdg(best.e.hdg)}° magnetic).`,
    q: {
      kind: 'choice', prompt: `For runway ${best.e.ident}, which way is the traffic pattern and where is the downwind?`, answer: 'ok',
      options: shuffle(rng, [
        { id: 'ok', label: `${titleCase(dir)} traffic; downwind ${side} of the runway`, why: 'Correct.' },
        { id: 'a', label: `${titleCase(dir === 'left' ? 'right' : 'left')} traffic; downwind ${opp} of the runway`, why: `The FAA data shows ${dir} traffic for ${best.e.ident}.` },
        { id: 'b', label: `${titleCase(dir)} traffic; downwind ${opp} of the runway`, why: `${titleCase(dir)} turns put the downwind on your ${dir} as you land: ${side}.` },
        { id: 'c', label: `${titleCase(dir === 'left' ? 'right' : 'left')} traffic; downwind ${side} of the runway`, why: `The side is right, the direction is wrong: ${dir} traffic.` },
      ]),
      why: `The Chart Supplement (and the segmented circle${rec.segCircle ? ', which this airport has' : ''}) tells you the direction. Left traffic is the default; right traffic is published per runway end.`, refs: ['14 CFR 91.126(b)', 'AIM 4-3-3'],
    },
  })

  // 5. Position
  const rel = whereRelative(best.e, pos)
  const desc = (end: string, ps: boolean) => `${end === 'abeam' ? 'Abeam the runway' : `Off the ${end} end of ${best.e.ident}`}, on the ${ps ? 'pattern' : 'non-pattern'} side`
  steps.push({
    ...base, phase: 'Position', title: 'Where are you?', hideOwnship: true, scene: { pattern: best.e.ident },
    situation: `Your airplane is hidden. ForeFlight: ${id} ${nm} nm, bearing to ${fmtHdg(bearing(pos, [0, 0]))}°.`,
    q: {
      kind: 'choice', prompt: `Relative to the runway ${best.e.ident} pattern, where are you?`, answer: 'ok',
      options: shuffle(rng, [
        { id: 'ok', label: desc(rel.end, rel.patternSide), why: 'Correct.' },
        { id: 's', label: desc(rel.end, !rel.patternSide), why: `Pattern side for ${best.e.ident} is ${side}.` },
        { id: 'e', label: desc(rel.end === 'approach' ? 'departure' : 'approach', rel.patternSide), why: `You are ${compass8(brgFrom)} of the field.` },
        { id: 'es', label: desc(rel.end === 'approach' ? 'departure' : 'approach', !rel.patternSide), why: `You are ${compass8(brgFrom)} of the field.` },
      ]),
      why: `Bearing to the field ± 180 = ${fmtHdg(brgFrom)}°: you are ${compass8(brgFrom)} of the field. The downwind for ${best.e.ident} is ${side}.`,
    },
  })

  // 6. Descent
  const atTpaNm = 3, gs = 105
  const dp = descentPlan(cruise, ap.tpa, gs)
  const tod = Math.round((dp.nm + atTpaNm) * 2) / 2
  const nowNm = Math.max(nm, tod + 1.5)
  steps.push({
    ...base, at: { polar: [brgFrom, nowNm] }, phase: 'Descent', title: 'Plan the descent', info: [{ kind: 'profile', title: 'Descent profile', profile: { alt: cruise, tpa: ap.tpa, gs, fpm: 500, nowNm, atTpaNm } }],
    situation: `${nowNm} nm out at ${cruise.toLocaleString()} ft, ${gs} kt. Pattern altitude ${ap.tpa.toLocaleString()} MSL; you want to be level ${atTpaNm} nm from the field at 500 fpm.`,
    q: {
      kind: 'choice', prompt: 'At what distance from the field do you start down?', answer: 'a',
      options: shuffle(rng, [
        { id: 'a', label: `About ${tod} nm`, why: `Correct. ${(cruise - ap.tpa).toLocaleString()} ft ÷ 500 fpm = ${dp.minutes.toFixed(1)} min ≈ ${dp.nm.toFixed(1)} nm at ${gs} kt, plus ${atTpaNm} nm.` },
        { id: 'b', label: `About ${Math.max(1, Math.round(tod / 2))} nm`, why: 'Too late: it needs roughly double the descent rate, arriving fast and high.' },
        { id: 'c', label: 'Overhead, then descend in the pattern', why: 'Never descend into the pattern from above; enter at pattern altitude.' },
        { id: 'd', label: `About ${Math.round(tod + 12)} nm`, why: 'Far too early: a long, low cruise for no reason.' },
      ]),
      why: 'Altitude to lose ÷ rate = minutes; × ground speed ÷ 60 = distance; add where you want to be level.', refs: ['AFH ch. 8'],
    },
  })

  // 7. Radio and entry
  const ctl = open ? freqOf(rec, /^LCL/, best.e.ident) : null
  const tower = titleCase(rec.towerCall || name)
  const dirFrom = compass8(brgFrom)
  const entryAt = { polar: [brgFrom, Math.min(nm, 7)] as [number, number] }
  const entryAlt = Math.max(ap.tpa, Math.min(cruise, ap.tpa + 600))
  if (open && ctl) {
    const atis = freqOf(rec, /ATIS/)
    steps.push({
      ...base, phase: 'Radio', title: 'Call the tower', com: [`${Number(ctl.freq).toFixed(3)} ${id} TWR`, atis ? `${Number(atis.freq).toFixed(3)} ATIS` : wxCom?.[1] ?? ''],
      situation: `The tower is open (${rec.towerHrs}). ${atis ? `You copied ATIS information Bravo on ${atis.freq}.` : 'No ATIS: you listened to the weather.'} ${ctl.sector ? `Note: tower frequency ${ctl.freq} is for ${ctl.sector}.` : ''}`,
      q: {
        kind: 'order', prompt: 'Build your initial call in order.',
        items: [{ id: 'who', label: `${tower} Tower,` }, { id: 'me', label: `${ME},` }, { id: 'where', label: `${Math.round(nm)} miles ${dirFrom},` }, { id: 'alt', label: `${cruise.toLocaleString()},` }, ...(atis ? [{ id: 'atis', label: 'with Bravo,' }] : []), { id: 'int', label: 'inbound full stop.' }],
        distractors: [{ id: 'rq', label: `request ${dir} downwind ${best.e.ident},`, why: 'Let the tower assign the runway and entry.' }],
        why: 'Facility, call sign, position, altitude, ATIS code, intentions. Do not enter the Class D until the tower answers with your call sign.', refs: ['AIM 4-2-3', '14 CFR 91.129'],
      },
      after: { radio: [{ from: 'You', you: true, text: `${tower} Tower, ${ME}, ${Math.round(nm)} miles ${dirFrom}, ${cruise.toLocaleString()}, ${atis ? 'with Bravo, ' : ''}inbound full stop.`, voice: 0 }] },
    })
    const kind = rel.patternSide ? '45' : 'midfield'
    const instr = rel.patternSide ? `enter ${dir} downwind runway ${best.e.ident}, report midfield` : `cross midfield at or above ${ap.tpa.toLocaleString()}, enter ${dir} downwind runway ${best.e.ident}`
    steps.push({
      ...base, at: entryAt, alt: entryAlt, phase: 'Entry', title: 'Follow the instruction', com: [`${Number(ctl.freq).toFixed(3)} ${id} TWR`, ''], scene: { pattern: best.e.ident },
      radio: [{ from: `${tower} Tower`, text: `${ME}, ${tower} Tower, ${instr}. Altimeter ${c.altimInHg.toFixed(2)}.`, voice: 1 }],
      situation: `The tower answered: “${SHORT}, ${instr}.”`,
      q: {
        kind: 'choice', prompt: 'Which path follows the instruction?', answer: 'a',
        options: [
          { id: 'a', label: kind === '45' ? `45° entry to ${dir} downwind ${best.e.ident}` : `Cross midfield, turn ${dir} downwind ${best.e.ident}`, why: 'Correct.', fly: { entry: kind, rwy: best.e.ident } },
          { id: 'b', label: `${titleCase(dir === 'left' ? 'right' : 'left')} downwind ${best.e.ident}`, why: 'Wrong side: that is the opposite traffic direction.', fly: { entry: '45', rwy: best.e.ident, flip: true } },
          { id: 'c', label: `Straight-in ${best.e.ident}`, why: 'You were not cleared for a straight-in.', fly: { entry: 'straight', rwy: best.e.ident } },
          { id: 'd', label: `${titleCase(dir)} base ${best.e.ident}`, why: 'You were told to enter the downwind.', fly: { entry: 'base', rwy: best.e.ident } },
        ],
        why: 'Picture it before you turn: runway number = landing direction, turn direction = downwind side. Read back the runway and instruction.', refs: ['AIM 4-3-2'],
      },
      after: { fly: { entry: kind, rwy: best.e.ident }, radio: [{ from: 'You', you: true, text: `${dir === 'left' ? 'Left' : 'Right'} downwind ${best.e.ident}, ${SHORT}.`, voice: 0 }] },
    })
  } else {
    const callName = name
    steps.push({
      ...base, at: { polar: [brgFrom, 10] }, phase: 'Radio', title: rec.towered ? 'Tower closed: self-announce' : 'Ten-mile call', com: [`${Number(ctaf).toFixed(3)} CTAF`, wxCom?.[1] ?? ''],
      situation: rec.towered ? `It is ${hh} local and the tower is closed (${rec.towerHrs}). The CTAF is ${ctaf}.` : `About 10 nm out on CTAF ${ctaf}. Listen first, then call.`,
      q: {
        kind: 'order', prompt: 'Build the call in order.',
        items: [{ id: 'who', label: `${callName} traffic,` }, { id: 'me', label: `${ME},` }, { id: 'where', label: `10 miles ${dirFrom},` }, { id: 'alt', label: `${cruise.toLocaleString()},` }, { id: 'int', label: `inbound landing, will enter ${rel.patternSide ? `the 45 for ${dir} downwind` : `midfield for ${dir} downwind`} runway ${best.e.ident},` }, { id: 'end', label: `${callName}.` }],
        distractors: [{ id: 'adv', label: 'any traffic in the area please advise,', why: 'Not a recognized self-announce phrase (AIM 4-1-9).' }],
        why: 'Who, who you are, where, altitude, intentions, then the airport name again: several fields may share the frequency.', refs: ['AIM 4-1-9', 'AC 90-66'],
      },
      after: { radio: [{ from: 'You', you: true, text: `${callName} traffic, ${ME}, 10 miles ${dirFrom}, ${cruise.toLocaleString()}, inbound landing, runway ${best.e.ident}, ${callName}.`, voice: 0 }] },
    })
    const entry = rel.patternSide ? '45' : 'overfly'
    steps.push({
      ...base, at: entryAt, alt: entryAlt, phase: 'Entry', title: 'Choose the entry', scene: { pattern: best.e.ident },
      situation: `You are on the ${rel.patternSide ? 'pattern' : 'non-pattern'} side of runway ${best.e.ident}, ${Math.min(nm, 7)} nm ${dirFrom}.`,
      q: {
        kind: 'choice', prompt: 'Which entry do you fly?', answer: entry,
        options: [
          { id: '45', label: `45° to ${dir} downwind ${best.e.ident}`, fly: { entry: '45', rwy: best.e.ident }, why: rel.patternSide ? 'Correct. You are on the pattern side.' : 'You would have to cross the pattern first.' },
          { id: 'overfly', label: 'Overfly midfield 500 ft above pattern altitude, teardrop to the 45', fly: { entry: 'overfly', rwy: best.e.ident }, why: rel.patternSide ? 'Unnecessary from the pattern side.' : 'Correct. The AC 90-66 method from the non-pattern side.' },
          { id: 'straight', label: `Straight-in ${best.e.ident}`, fly: { entry: 'straight', rwy: best.e.ident }, why: 'Not prohibited, but it bypasses the traffic flow; not the recommended entry.' },
          { id: 'wrong', label: `${dir === 'left' ? 'Right' : 'Left'} downwind ${best.e.ident}`, fly: { entry: '45', rwy: best.e.ident, flip: true }, why: `Wrong direction: ${dir} traffic is published for ${best.e.ident}.` },
        ],
        why: 'Pattern side: 45° to midfield downwind at pattern altitude. Non-pattern side: cross midfield 500 ft above, descend clear of the pattern, teardrop onto the 45.', refs: ['AC 90-66', 'AIM 4-3-3'],
      },
      after: { fly: { entry, rwy: best.e.ident } },
    })
  }

  // 8. High field: density altitude
  if (rec.elev >= 3000 || da >= 5000) {
    steps.push({
      at: { leg: 'mid', rwy: best.e.ident }, alt: ap.tpa, gs: 95, time: hh, phase: 'Pattern', title: 'High and hot', scene: { pattern: best.e.ident },
      situation: `Field elevation ${rec.elev.toLocaleString()} ft, ${c.tempC}°C: density altitude about ${da.toLocaleString()} ft.`,
      q: {
        kind: 'choice', prompt: 'What changes on this approach?', answer: 'a',
        options: shuffle(rng, [
          { id: 'a', label: 'Same indicated airspeeds, but a higher ground speed and longer landing roll; keep the mixture leaned for best power for a possible go-around', why: 'Correct. IAS is what the wing feels; true airspeed and ground speed are higher, and full rich at high density altitude costs go-around power.' },
          { id: 'b', label: 'Fly 10 kt faster indicated to make up for thin air', why: 'No: the stall happens at the same indicated airspeed. Extra speed adds float and runway.' },
          { id: 'c', label: 'Mixture full rich on downwind as at sea level', why: 'At high density altitude full rich can leave you short of power for a go-around; lean for best power.' },
          { id: 'd', label: 'Nothing changes', why: 'Landing distance grows with density altitude.' },
        ]),
        why: 'Density altitude affects true airspeed, ground speed, engine power and landing distance, not the indicated speeds you fly.', refs: [POH, 'PHAK ch. 11'],
      },
    })
  }

  // 9. Downwind flow
  steps.push({
    at: { leg: 'mid', rwy: best.e.ident }, alt: ap.tpa, gs: 90, time: hh, phase: 'Pattern', title: 'Downwind flow', scene: { pattern: best.e.ident },
    situation: `Midfield ${dir} downwind ${best.e.ident} at ${ap.tpa.toLocaleString()} ft.`,
    q: {
      kind: 'order', prompt: 'Order the actions from midfield to the base turn.',
      items: [
        { id: 'bl', label: 'Before landing: belts, fuel BOTH, mixture as required' }, { id: 'carb', label: 'Abeam the touchdown point: carb heat ON' },
        { id: 'pwr', label: 'Power about 1,500 RPM' }, { id: 'f10', label: 'Flaps 10° in the white arc' }, { id: 'trim', label: 'Trim for about 75 KIAS, start down' },
        { id: 'look', label: `Clear final, turn base, announce ${dir} base ${best.e.ident}` },
      ],
      distractors: [{ id: 'f30', label: 'Flaps 30° at 95 KIAS', why: 'Exceeds 85 KIAS Vfe for 30° flaps.' }],
      why: 'The same flow every time makes every pattern, at every airport, look the same.', refs: [POH, 'AFH ch. 8'],
    },
    after: { fly: { pattern: 'final', rwy: best.e.ident, from: 'mid' } },
  })

  // 10. PAPI / VASI
  const nend = rec.runways.flatMap(r => r.ends).find(e => e.id === best.e.ident)
  if (nend?.vgsi) {
    const papi = nend.vgsi.startsWith('P')
    const reading = pick(rng, papi ? [['3 white, 1 red', 'slightly high'], ['2 white, 2 red', 'on glidepath'], ['1 white, 3 red', 'slightly low'], ['4 red', 'well below']] : [['white over white', 'high'], ['red over white', 'on glidepath'], ['red over red', 'low']])
    steps.push({
      at: { leg: 'final', rwy: best.e.ident }, alt: ap.tpa - 500, gs: 65, time: hh, phase: 'Landing', title: papi ? 'Read the PAPI' : 'Read the VASI', scene: { pattern: best.e.ident },
      situation: `Final for ${best.e.ident}. The ${papi ? 'PAPI' : 'VASI'} (FAA code ${nend.vgsi}) shows ${reading[0]}.`,
      q: {
        kind: 'choice', prompt: 'What does it tell you?', answer: reading[1],
        options: shuffle(rng, (papi ? ['slightly high', 'on glidepath', 'slightly low', 'well below'] : ['high', 'on glidepath', 'low']).map(v => ({ id: v, label: titleCase(v), why: v === reading[1] ? 'Correct.' : `${reading[0]} means ${reading[1]}.` }))),
        why: papi ? 'PAPI: 4 white high, 3W/1R slightly high, 2/2 on path, 1W/3R slightly low, 4 red low.' : 'Two-bar VASI: red over white is on path; white over white high; red over red low.', refs: ['AIM 2-1-2'],
      },
    })
  }

  // 11. The windsock on final
  const shift = rng() < 0.45
  const sock: Wind = shift ? { dir: norm360(c.wind.dir + (rng() < 0.5 ? 70 : -70) + (rng() - 0.5) * 20), spd: Math.max(c.wind.spd + 6, 15), gust: c.wind.gust } : { ...c.wind }
  const sc = components(sock, best.e.hdg)
  const alt = ends.filter(x => x.ok && x !== best).map(x => ({ x, c: components(sock, x.e.hdg) })).sort((a, b) => b.c.head - a.c.head)[0]
  const goAround = Math.abs(sc.cross) > 13 || sc.head < -4
  steps.push({
    at: { leg: 'final', rwy: best.e.ident }, alt: rec.elev + 400, gs: 60, time: hh, phase: 'Decision', title: 'Look at the windsock', sock, wind: c.wind, scene: { pattern: best.e.ident },
    situation: `Short final for ${best.e.ident}, 400 ft AGL. ${rec.windIndicator?.startsWith('Y') ? 'The FAA data lists a wind indicator here.' : 'There may be no windsock here; use your drift and the trees, water and smoke.'} Check the windsock panel.`,
    q: {
      kind: 'choice', prompt: `The sock shows about ${fmtHdg(Math.round(sock.dir / 10) * 10)}° at ${sock.spd >= 15 ? '15+' : sock.spd} kt. What do you do?`, answer: goAround ? 'ga' : 'land',
      options: [
        { id: 'land', label: 'Continue: crosswind technique, land', why: goAround ? `That is about ${Math.abs(Math.round(sc.cross))} kt of crosswind${sc.head < 0 ? ` and ${Math.abs(Math.round(sc.head))} kt of tailwind` : ''}: past the limits.` : `Correct. About ${Math.abs(Math.round(sc.cross))} kt crosswind: manageable.` },
        { id: 'ga', label: `Go around${alt ? ` and re-plan, maybe for runway ${alt.x.e.ident}` : ' and re-plan or divert'}`, why: goAround ? 'Correct. When the sock disagrees with the report beyond your limits, go around and re-evaluate.' : 'Not needed: the wind is within limits. A go-around is never wrong, but here landing is the expected answer.' },
        { id: 'long', label: 'Land long to get past the gusts', why: 'Landing long uses up the runway you need and does not change the crosswind.' },
      ],
      why: 'The windsock is the wind at the runway now. A fully extended sock means 15 kt or more.', refs: ['AC 150/5345-27', 'AFH ch. 9'],
    },
    after: { fly: goAround ? { pattern: 'goaround', rwy: best.e.ident, from: 'final' } : { pattern: 'land', rwy: best.e.ident, from: 'final' } },
  })

  // 12. After landing
  if (!goAround) {
    const gnd = open ? freqOf(rec, /^GND/) : null
    steps.push({
      at: { leg: 'rollout', rwy: best.e.ident }, alt: rec.elev, hdg: best.e.hdg, gs: 15, time: hh, phase: 'Landing', title: 'Clear of the runway',
      situation: open ? `Landed on ${best.e.ident}. The tower says: “${SHORT}, turn ${dir} next taxiway, contact ground ${gnd?.freq ?? 'point'}.”` : `Landed on ${best.e.ident}, slowing down.`,
      q: {
        kind: 'order', prompt: 'Order your after-landing actions.',
        items: [
          { id: 'exit', label: 'Exit and stop past the hold-short markings' },
          { id: 'call', label: open ? `Contact ground${gnd ? ` on ${gnd.freq}` : ''}` : `“${name} traffic, ${SHORT} clear of runway ${best.e.ident}, ${name}”` },
          { id: 'flaps', label: 'Flaps UP' }, { id: 'carb', label: 'Carb heat COLD' },
        ],
        distractors: [{ id: 'early', label: 'Change frequency during the rollout', why: 'Stay on the tower/CTAF until you are clear of the runway.' }],
        why: 'Clear the runway completely, then talk, then clean up (POH after landing: flaps UP, carb heat COLD).', refs: [POH, 'AIM 4-3-20'],
      },
    })
  }
  return finish()

  function finish(): Scenario {
    return {
      id: `us-${rec.id}`, title: `${titleCase(rec.name)} (${id})`, airport: id, ap,
      source: `FAA NASR cycle ${rec.cycle}${c.source === 'live' ? ` · live weather from ${c.station}` : ' · generated weather'}`,
      blurb: '', tags: [], wind: c.wind, steps,
    }
  }
}

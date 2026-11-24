// What a POH says about the airplane itself, read from its text: engine,
// propeller, oil, fuel system, landing gear, tires, brakes, electrical, airspeed
// markings and limits, normal speeds, stall speeds, load factors, icing and the
// Section 1 performance summary. GAMA-format handbooks print these as
// "Label: value" lines and fixed phrases, so each is a pattern over the
// whitespace-collapsed text; anything not found is left out rather than guessed.
import { pool } from '../db/client.js'
import { ocrPages, pdfPages } from './pohPages.js'
import { speedUnit } from './pohTables.js'

export const SPECS_VERSION = 2

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }
const num = s => (s == null ? null : Number(String(s).replace(/[,\s]/g, '')))
const qty = s => (s == null ? null : WORDS[String(s).toLowerCase()] ?? num(s))
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// OCR repairs inside numbers: "7 5 inches", "13, 100", "+3. Og", "2 cc", "1500/0" stays.
export function normalize(text) {
  return text
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/(\d)\s+(?=\d\s*(?:inches|Quarts|quarts|gallons|PSI|psi)\b)/g, '$1')
    .replace(/(\d),\s+(\d{3})\b/g, '$1,$2')
    .replace(/(\d)\.\s*O(?=g|\b)/g, '$1.0').replace(/\bl(\d)/g, '1$1').replace(/\{/g, '(').replace(/\}/g, ')')
    .replace(/([a-z])-[ \t]*\n\s*([a-z])/g, '$1-$2').replace(/(\d)\.\s+(\d)/g, '$1.$2')
    .replace(/\b0-(\d{3})\b/g, 'O-$1').replace(/(\d)O(?=\d)/g, '$10').replace(/\bK[Il1]AS\b/g, 'KIAS')
    .replace(/\b(\d)B\b/g, '$18').replace(/(\d)W -(\d)/g, '$1W-$2').replace(/\b(\d)(\d)G\b/g, '$1.$2G').replace(/(\d) \.(\d)/g, '$1.$2').replace(/\bRa\.nge\b/g, 'Range').replace(/\(O°/g, '(0°')
    .replace(/[ \t]+/g, ' ')
}
const flat = t => t.replace(/\s+/g, ' ')

function after(text, label, re, span = 200) {
  const i = text.search(label)
  if (i < 0) return null
  return text.slice(i, i + span).match(re)
}

export function engineOf(t) {
  // Cessna: "Engine Model Number: O-320-D2J."; Piper: "(c) Engine Model Number 0-320-D3G".
  const model = t.match(/Engine Model (?:Number|No\.):?\s*([A-Z]{1,4}-\d{3}[A-Z0-9-]*)/i)?.[1]?.replace(/-([A-Z])Z([A-Z]{1,3})$/, '-$12$2') ?? null
  const make = (t.match(/Engine Manufacturer:\s*([A-Za-z][A-Za-z .]+?)\.\s/i)?.[1] ?? t.match(/Engine Manufacturer\s+([A-Z][a-z]+)/)?.[1])?.replace(/^Aveo/, 'Avco') ?? null
  const hp = t.match(/(\d{2,3}) rated BHP at ([\d,]+)\s*RPM/i)
  const php = t.match(/Rated Horsepower\s+(\d{2,3})/i), prpm = t.match(/Rated Speed \(rpm\)\s+(\d{4})/i)
  const type = t.match(/Engine Type:\s*(.+?)(?:\s+with\s+([\d.]+)\s*cu\.?\s*in\.?|\.)/i) ?? t.match(/Engine Type\s+([A-Z][A-Za-z ,-]+?)\s+\d/)
  const disp = type?.[2] ?? t.match(/Displacement \(cubic inches\)\s+([\d.]+)/i)?.[1]
  if (!model && !hp && !php) return null
  return {
    make, model, hp: num(hp?.[1] ?? php?.[1]), rpm: num(hp?.[2] ?? prpm?.[1]),
    type: type ? cap(type[1].replace(/\s*-\s*(?=[a-z])/g, '-').replace(/-\s+/g, '-').replace(/,\s*$/, '').replace(/\s*engine$/i, '').trim().toLowerCase()) : null,
    displacement: disp ? `${disp} cu in` : null,
  }
}

export function propellerOf(t) {
  const model = (t.match(/Propeller Model Number:\s*([A-Z0-9/]+)/i)?.[1] ?? t.match(/Propeller Manufacturer\s+\w+\s*(?:\(\w\)\s*)?Model\s+([A-Z0-9-]+)/i)?.[1])?.replace(/(\d{3})1(DTM)/, '$1/$2') ?? null
  if (!model) return null
  const max = t.match(/Propeller Diameter, Maximum:\s*(\d+) inches/i) ?? t.match(/Propeller Diameter \(inches\)\s*(?:\(\d\)\s*)?Maximum\s+(\d+)/i)
  const min = t.match(/Minimum:\s*(\d+) inches/i) ?? t.match(/Propeller Diameter \(inches\)[^]{0,30}?Minimum\s+(\d+)/i)
  const blades = t.match(/Number of Blades:?\s*(\d)/i)
  const make = t.match(/Propeller Manufacturer:\s*([A-Za-z][A-Za-z .]+?)(?: Accessory Division)?\.\s/i)?.[1] ?? t.match(/Propeller Manufacturer\s+([A-Z][a-z]+)/)?.[1] ?? null
  const clearance = t.match(/Propeller ground clearance is (\d+(?: \d\/\d|[¼½¾])?)"/i)?.[1] ?? null
  return {
    make, model, blades: blades ? num(blades[1]) : null,
    diameterIn: max ? [min ? num(min[1]) : num(max[1]), num(max[1])] : null,
    type: cap(t.match(/Propeller Type[^A-Za-z]*(Fixed pitch|Constant speed)/i)?.[1]?.toLowerCase()) ?? null,
    groundClearance: clearance ? `${clearance.replace(' 3/4', '¾').replace(' 1/2', '½').replace(' 1/4', '¼')} in` : null,
  }
}

export function oilOf(t) {
  const sump = t.match(/Sump:\s*(\d+)\s*(?:U\.S\.\s*)?Quarts/i) ?? t.match(/oil capacity of the engine is (\d+) quarts/i) ?? t.match(/Oil Capacity \(U\.S\. quarts\)\s+(\d+)/i), total = t.match(/Total:\s*(\d+)\s*(?:U\.S\.\s*)?Quarts/i)
  const min = t.match(/(?:operate (?:on|with) less than|not be operated on less than)\s+(\w+)\s+quarts/i) ?? t.match(/minimum safe quantity\s+is (\w+) quarts/i)
  const ext = t.match(/(?:F|f)ill to (\w+) quarts for extended flight/)
  const pMin = t.match(/Oil Pressure, Minimum:\s*\*?\s*(\d+) psi/i) ?? t.match(/Oil Pressure\s*Minimum \(red line\)\s*(\d+)\s*PSI/i)
  const pMax = t.match(/Oil Pressure, Minimum:[^]{0,80}?Maximum:\s*(\d+) psi/i) ?? t.match(/Oil Pressure\s*Minimum \(red line\)\s*\d+\s*PSI\s*Maximum \(red line\)\s*(\d+)\s*PSI/i)
  const green = after(t, /Oil Pressure\s+['*"]*\s*\d+ psi/i, /(\d{2})\s*-\s*([\dgO]{2}) psi/, 80)
  const temp = t.match(/Maximum Oil Temperature:\s*(?:(\d{3})\s*°\s*F|\d{2,3}\s*°\s*C\s*\((\d{3})\s*°\s*F\))/i)
  const visc = t.match(/Recommended Viscosity for Temperature Range:([^]*?)(?:Oil Capacity|NOTE)/i)?.[1]
  if (!sump && !min) return null
  return {
    sumpQt: sump ? num(sump[1]) : null, totalQt: total ? num(total[1]) : null,
    minQt: min ? qty(min[1]) : null, extendedQt: ext ? qty(ext[1]) : null,
    pressurePsi: pMin ? { min: num(pMin[1]), green: green ? [num(green[1]), num(green[2].replace(/g/g, '9').replace(/O/g, '0'))] : null, max: pMax ? num(pMax[1]) : null } : null,
    maxTempF: temp ? num(temp[1] ?? temp[2]) : null,
    spec: /MIL-L-6082[^]{0,600}MIL-L-22851/.test(t) ? 'MIL-L-6082 straight mineral oil for break-in (first 50 h), then MIL-L-22851 ashless dispersant' : null,
    viscosity: visc ? (visc.split(/MIL-L-22851[^:\n]*:/i).at(-1)).split('\n').map(l => l.trim()).filter(l => /SAE\s?\d/.test(l) && /^(?:SAE|All|Above|Below|[−_-]?\d)/.test(l)).map(l => l.replace(/^_/, '−').replace(/\.\s*$/, '').replace(/\s+or$/, '').replace(/\s*\(\s*/g, ' (').replace(/\.\s*use\s+/i, ': ').replace(/\s*\(['"]*$/, '').replace(/\s+/g, ' ').trim()) : [],
  }
}

const COLOR = { blue: 'Blue', green: 'Green', red: 'Red', amber: 'Amber', clear: 'Clear' }
export function fuelOf(t) {
  const tanks = []
  for (const m of t.matchAll(/(Standard|Long Range|Integral) Tanks:\s*Total Capacity:\s*([\d.]+)\s*(?:U\.S\.\s*)?gallons\W*Total Capacity Each Tank:\s*([\d.]+)\s*(?:U\.S\.\s*)?gallons\W*Total Usable:\s*([\d.]+)\s*(?:U\.S\.\s*)?gallons/gi)) {
    const key = m[1].toLowerCase().startsWith('long') ? 'long' : m[1].toLowerCase()
    if (tanks.some(x => x.key === key)) continue
    const total = num(m[2]), usable = num(m[4])
    tanks.push({ key, label: `${key === 'long' ? 'Long-range' : cap(key)} tanks`, total, each: num(m[3]), usable, unusable: +(total - usable).toFixed(1) })
  }
  const one = t.match(/Total Capacity:\s*([\d.]+)\s*(?:U\.S\.\s*)?gallons\W*Total Usable:\s*([\d.]+)\s*(?:U\.S\.\s*)?gallons/i)
  if (!tanks.length && one) { const total = num(one[1]), usable = num(one[2]); tanks.push({ key: 'standard', label: 'Two wing tanks', total, each: total / 2, usable, unusable: +(total - usable).toFixed(1) }) }
  const pip = t.match(/Fuel Capacity \(U\.S\. gal\) \(total\)\s+([\d.]+)[^]{0,20}?Usable Fuel \(U\.S\. gal\) \(total\)\s+([\d.]+)/i)
  if (!tanks.length && pip) { const total = num(pip[1]), usable = num(pip[2]); tanks.push({ key: 'standard', label: 'Two wing tanks', total, each: total / 2, usable, unusable: +(total - usable).toFixed(1) }) }
  const oct = t.match(/Minimum Octane\s+((?:\d{2,3}(?:\/\d{2,3})?(?:LL)?\s+(?:Blue|Green|Red)(?:\s+or\s+)?)+)/i)?.[1]
  const block = t.match(/(?:Approved )?Fuel Grades? \(and Colors?\):([^]{0,700}?)(?:Fuel Capacity|$)/i)?.[1] ?? ''
  const grades = []
  for (const m of block.matchAll(/((?:80\/87|100LL|100\/130|100)(?:\s*\(Formerly 100\/130\))?)[^()\n]*?(Minimum )?Grade[^()]*?\(\s*(\w+)\s*\)|(100\/130 Low Lead AVGAS)\s*[{(]\s*(\w+)\s*[)}]/gi)) {
    const grade = m[4] ? '100/130 low lead (now 100LL)' : `${m[1].replace(/\s*\(Formerly 100\/130\)/i, ' (formerly 100/130)')}${m[2] ? ' (minimum)' : ''}`
    const color = COLOR[(m[3] ?? m[5]).toLowerCase()]
    if (color && !grades.some(g => g.grade === grade)) grades.push({ grade, color })
  }
  for (const m of (oct ?? '').matchAll(/(\d{2,3}(?:\/\d{2,3})?(?:LL)?)\s+(Blue|Green|Red)/gi)) if (!grades.some(g => g.grade === m[1])) grades.push({ grade: m[1], color: COLOR[m[2].toLowerCase()] })
  const sys = t.match(/consists? of two vented\s*fu\s?el tanks/i)
  const sel = t.match(/valve,? labeled ([A-Z]+(?:[,.] [A-Z]+)*,? and [A-Z]+)/)
  if (!tanks.length && !grades.length) return null
  return {
    tanks, grades,
    system: sys ? `Two vented wing tanks feed by gravity through a strainer to the ${/fuel injection|injector/i.test(t) ? 'engine' : 'carburetor'}${/manual primer/i.test(t) ? '; manual primer' : ''}.` : null,
    selector: sel ? `${sel[1].replace(/[,.] /g, ', ').replace(/,? and /, ', ')}.` : null,
  }
}

export function gearOf(t) {
  const g = t.match(/landing gear is of the (tricycle|conventional) type( with a steerable nose wheel)?/i) ?? (/fixed-gear/i.test(t) && /nose gear/i.test(t) ? [null, 'tricycle', /nose gear is steerable/i.test(t) ? ' steerable' : null] : null)
  const shock = /tubular spring-steel main landing gear struts/i.test(t) ? `Tubular spring-steel main struts${/air\/oil nose gear shock strut/i.test(t) ? '; air/oil nose strut' : ''}` : null
  const tire = w => t.match(new RegExp(`${w} WHEEL TIRE PRESSURE\\s*-+\\s*(\\d+)\\s*PSI on ([\\d.]+\\s*-\\s*\\d+),\\s*(\\d+)-Ply`, 'i'))
  const pp = t.match(/main gear tires require a pressure of (\d+) psi,? and the nose gear tire requires a pressure of (\d+) psi/i)
  const ps = t.match(/nose gear has a ([\d.]+ x \d+) (\w+)-ply tire,? while the main wheel assemblies have ([\d.]+ x \d+) (\w+)-ply/i)
  const nose = tire('NOSE') ?? (pp ? [null, pp[2], ps?.[1] ?? '', String(qty(ps?.[2]) ?? '')] : null), main = tire('MAIN') ?? (pp ? [null, pp[1], ps?.[3] ?? '', String(qty(ps?.[4]) ?? '')] : null)
  const strut = t.match(/NOSE GEAR SHOCK STRUT[^]{0,200}?inflated? with air to (\d+)\s*PSI/i)
  if (!g && !nose) return null
  const fmt = m => (m ? `${m[1]} psi${m[2] ? ` · ${m[2].replace(/\s/g, '')}${m[3] ? `, ${m[3]}-ply` : ''}` : ''}` : null)
  return {
    type: g ? `${/(?:hydraulically|electrically)[- ](?:operated|actuated),? retractable/i.test(t) ? 'Retractable' : 'Fixed'} ${g[1].toLowerCase()}` : null,
    nose: g?.[2] ? `Steerable${(a => (a ? ` ${a[1]}° each side` : ''))(t.match(/steerable through a (\d+) degree arc/i))} through the rudder pedals` : null,
    shock: shock ?? (/struts are of the air-oil type/i.test(t) ? 'Air-oil struts on all three legs' : null),
    tires: nose || main ? { nose: fmt(nose), main: fmt(main) } : null,
    strut: strut ? `${strut[1]} psi${/MIL-H-5606/.test(t) ? ', MIL-H-5606 fluid' : ''}` : null,
  }
}

export function brakesOf(t) {
  const b = t.match(/has a (single-disc|disc-type|double-disc)?\s*,?\s*hydraulically[- ]actuated (?:disc-type )?brake on each main/i) ?? t.match(/hydraulically\s*actu-?\s*ated (single-disc|disc-type) brake/i)
  const pb = t.match(/(single|double) disc hydraulic brake/i)
  const toe = /applying pressure to the top of either the left|actuated by toe brake pedals/i.test(t)
  const park = t.match(/parking brake which is operated by a handle under the (left|right) side of the instrument panel/i)
  const ppark = /parking brake is incorporated in the master cylinder/i.test(t)
  if (!b && !park && !pb) return null
  return {
    type: b || pb ? `${b?.[1] ? `${cap(b[1].replace('disc-type', 'disc'))}, ` : pb ? `${cap(pb[1].toLowerCase())}-disc, ` : ''}hydraulic, on each main wheel${toe ? '; toe brakes on both sets of rudder pedals' : ''}` : null,
    parking: ppark ? 'Hand brake lever below the panel: pull back and press the knob to set' : park ? `Handle under the ${park[1].toLowerCase()} side of the panel${/handle aft,? and rotate it 90/i.test(t) ? ': hold the toe brakes, pull aft, turn 90° down' : ''}` : null,
    fluid: t.match(/BRAKES\s*-+\s*Service as required with (MIL-H-\d+)/i)?.[1] ?? null,
  }
}

export function electricalOf(t) {
  const v = t.match(/(\d{2})-volt,? direct-current/i) ?? t.match(/(\d{2})-volt,? \d{2,3}-amp alternator/i), alt = t.match(/(\d{2,3})-amp alternator/i)
  const bat = t.match(/(\d{2})-volt(?:, (\d+)-amp(?:ere)? hour)? battery/i)
  if (!v && !alt) return null
  return {
    volts: v ? num(v[1]) : null, alternatorAmps: alt ? num(alt[1]) : null,
    battery: bat ? `${bat[1]} V${bat[2] ? `, ${bat[2]} Ah` : ''}` : null,
    bus: /split bus bar/i.test(t) ? 'Split bus: electronics on one side, general circuits on the other' : /avi\s?onics bus bar/i.test(t) ? 'Primary bus and avionics bus, joined by the avionics power switch' : null,
    warning: /low-voltage (?:warning )?light/i.test(t) ? 'Low-voltage light; over-voltage sensor shuts the alternator off' : /over-voltage (?:warning )?light/i.test(t) ? 'Over-voltage light; the sensor shuts the alternator off' : null,
  }
}

export function pitotHeatOf(t) {
  if (!/heated pitot|pitot heat/i.test(t)) return null
  const cb = t.match(/(?:labeled )?PIT\s?\w\s?T HT[^]{0,120}?(\d+)-amp circuit breaker/i) ?? t.match(/(\d+)-amp circuit breaker[^]{0,120}?PIT\s?O\s?T/i)
  return `${/\(if installed\)|either an unheated or\s+heated pitot|optional/i.test(t) ? 'Optional' : 'In the book; check the airplane'}${cb ? ` (PITOT HT switch, ${cb[1]} A breaker)` : ''}`
}

export function arcsOf(t) {
  const a = (name, two = true) => t.match(new RegExp(`${name}(?:\\s*\\([^)]*\\))?\\s+(\\d{2,3})\\b${two ? '\\s*(?:to|[^\\d\\s]{1,3})\\s*(\\d{2,3})\\b' : ''}`, 'i'))
  const w = a('White\\s?Arc'), g = a('Green\\s?Arc'), y = a('Yellow\\s?Arc'), r = a('Red\\s?(?:Radial\\s)?Line', false)
  if (!w || !g) return null
  // The markings table's header says KIAS or MPH; an MPH book is converted to knots.
  const i = t.search(/White\s?Arc/i), unit = speedUnit(t.slice(Math.max(0, i - 600), i)) ?? 'kt'
  const k = v => (unit === 'mph' ? Math.round(num(v) / 1.15078) : num(v))
  return { white: [k(w[1]), k(w[2])], green: [k(g[1]), k(g[2])], yellow: y ? [k(y[1]), k(y[2])] : null, red: r ? k(r[1]) : null, unit }
}

// Figure 2-1: the airspeed limitations table, KCAS and KIAS in the header's order
// (Cessna prints KCAS first, Piper KIAS first).
export function limitsOf(t) {
  const h = t.match(/SPEED\s+(KCAS\s+KIAS|KIAS\s+KCAS)([^]{0,2400}?)(?:Figure\s+(?:2-)?1\b|AIRSPEED INDICATOR MARKINGS|$)/i)
  if (!h) return null
  const blk = h[2], kias = m => num(/^KCAS/i.test(h[1]) ? m[2] : m[1])
  const PAIR = String.raw`(\d{2,3})\s*-?\s*(\d{2,3})\b`
  const pair = label => { const m = blk.match(new RegExp(`${label}[^\\d]*?${PAIR}`, 'i')); return m ? kias(m) : null }
  const vaBlk = blk.match(/Maneuvering[^]*?(?=Maximum Flaps?|V\s?FE|Maximum Window|CAUTION|$)/i)?.[0] ?? ''
  const va = [...vaBlk.matchAll(new RegExp(String.raw`(\d{4})\s*(?:Pounds|Lbs\.?|LBS\.?(?:\s*G\.W\.)?)\s+${PAIR}`, 'gi'))].map(m => [num(m[1]), num(/^KCAS/i.test(h[1]) ? m[3] : m[2])])
  const vfeBlk = blk.match(/(?:Maximum\s*Flaps?\s*Extended|V\s?FE)[^]*?(?=Maximum\s*Window|Maximum\s+\d|Design Maneuvering|$)/i)?.[0] ?? ''
  const vfe = []
  for (const line of vfeBlk.split('\n')) {
    // KCAS and KIAS sit within a few knots of each other; "100 - 300 Flaps" (OCR of 10°–30°) does not.
    const m = [...line.matchAll(new RegExp(PAIR, 'g'))].find(x => num(x[1]) >= 50 && num(x[2]) >= 50 && Math.abs(num(x[1]) - num(x[2])) <= 20)
    if (!m) continue
    const before = line.slice(0, m.index)
    const f = before.match(/(\d{1,3})\s*[°'=]?\s*(?:(?:-|to|=to)\s*(\d{1,3}|FULL)\s*[°']?)?\s*Flaps|Flaps\s*(\d{1,3})\s*[°'=]*\s*(?:(?:-|to|=to)\s*(\d{1,3}|FULL))?/i)
    const a = f?.[1] ?? f?.[3], b = f?.[2] ?? f?.[4]
    vfe.push({ label: a ? `Flaps ${fixFlap(a)}${b ? `–${/full/i.test(b) ? 'full' : fixFlap(b)}` : ''}` : 'Flaps extended', kias: kias(m) })
  }
  const vne = pair('(?:V\\s?NE|Never\\s*Exceed\\s*Speed)'), vno = pair('(?:V\\s?NO|Maximum\\s*Structural)')
  const w = blk.match(new RegExp(String.raw`Maximum\s*(?:Window\s*Open\s*(?:Speed)?\s*)?${PAIR}[^]{0,120}?[Ww]indows?`))
  return vne || vno ? { vne, vno, va, vfe, windowOpen: w ? kias(w) : null } : null
}
// OCR reads "10°" as "100" and "40°" as "400".
const fixFlap = s => { const n = num(s); return `${n >= 100 ? n / 10 : n}°` }

export function speedsOf(t) {
  const k = re => { const m = t.match(re); return m ? num(m[1]) : null }
  const range = re => t.match(re)?.slice(1, 3).map(num) ?? null
  const glide = t.match(/Maximum Glide[^\d]{0,40}?(?:\d{4}\s*Lbs\.?\s*)?[.\s]*(\d{2,3})\s*KIAS/i)
  const xw = t.match(/Maximum Demonstrated Crosswind Velocity:?[^]{0,160}?(\d{2})\s*K(?:N|TS)/i)
  return {
    vy: k(/Best Rate[- ]of[- ]C\S{0,2}mb[,.]? Sea Level(?: thru 10,000 Feet)?[ .]*(\d{2,3})\s*KIAS/i) ?? k(/Best Rate of Climb Speed\s+(\d{2,3})\s*KIAS/i), vx: k(/Best Angle[- ]of[- ]C\S{0,2}mb[,.]? Sea Level(?: thru 10,000 Feet)?[ .]*(\d{2,3})\s*KIAS/i) ?? k(/Best Angle of Climb Speed\s+(\d{2,3})\s*KIAS/i),
    vy10: k(/Best Rate[- ]of[- ]C\S{0,2}mb[,.]? 10[.,]?000 Feet[ .]*(\d{2,3})\s*KIAS/i), vx10: k(/Best Angle[- ]of[- ]C\S{0,2}mb[,.]? 10[.,]?000 Feet[ .]*(\d{2,3})\s*KIAS/i),
    climb: range(/Normal Climb Out[ .]*(\d{2,3})\s*-\s*(\d{2,3})\s*KIAS/i),
    approachUp: range(/Normal Approach[,.]? Flaps Up[ .]*(\d{2,3})\s*-\s*(\d{2,3})/i),
    approach: range(/Normal Approach[,.]? Flaps \d{2}\s*['°][ .]*(\d{2,3})\s*-\s*(\d{2,3})/i),
    finalApproach: k(/Final Approach Speed \(Flaps \d+°?\)\s+(\d{2,3})\s*KIAS/i),
    shortApproach: k(/Short Field Approach[,.]? Flaps \d{2}\s*['°][ .]*(\d{2,3})\s*K/i),
    glide: glide ? num(glide[1]) : null, crosswind: xw ? num(xw[1]) : null,
  }
}

// Figure 5-3: per CG block, each flap row's KIAS / KCAS pairs at 0, 30, 45 and 60° of bank.
export function stallOf(t) {
  const i = t.search(/STALL SPEEDS\s+CONDITIONS/i)
  if (i < 0) return null
  const s = t.slice(i, i + 3000)
  const block = name => s.match(new RegExp(`${name}([^]*?)(?:MOST FORWARD|Figure 5-3|$)`, 'i'))?.[1] ?? ''
  const rows = b => {
    const out = []
    for (const line of b.split('\n')) {
      const m = line.match(/^\s*(?:\d{4}\s+)?(UP|\d{2,3}\s*[°']?)\s+((?:\d{2}\s*[.]?\s*){8})\s*$/i)
      if (!m) continue
      const v = m[2].match(/\d{2}/g).map(Number)
      out.push({ flaps: /up/i.test(m[1]) ? 'Up' : fixFlap(m[1].replace(/\D/g, '')), kias: [v[0], v[2], v[4], v[6]] })
    }
    return out
  }
  const unit = speedUnit(s.slice(0, 1200)) ?? 'kt'
  const conv = list => (unit === 'mph' ? list.map(r => ({ ...r, kias: r.kias.map(v => Math.round(v / 1.15078)) })) : list)
  const aft = conv(rows(block('MOST REARWARD'))), fwd = conv(rows(block('MOST FORWARD')))
  if (!aft.length || aft.length !== fwd.length) return null
  const weight = s.match(/\n\s*(\d{4})\s+(?:UP|\d)/)?.[1]
  const loss = s.match(/altitude loss during a stall recovery (?:is approximately|may be as much as) (\d+) feet/i)
  return {
    unit, weight: weight ? num(weight) : null, altitudeLoss: loss ? `${/approximately/i.test(loss[0]) ? 'About' : 'Up to'} ${loss[1]} ft in the recovery` : null,
    rows: aft.map((r, k) => ({ flaps: r.flaps, aft: r.kias, fwd: fwd[k].kias })),
  }
}

export function loadFactorsOf(t) {
  const f = re => t.match(re)
  const n = f(/NORMAL CATEGORY\s*Flight Load Factors \((?:Maximum Takeoff|Gross) Weight\s*-\s*([\d,]+) (?:lbs|POUNDS)[^)]*\):?[^+]*?(\+\d\.\d+)\s*g[,.]?\s*(-\d\.\d+)\s*g[^+]*?(\+\d\.\d+)\s*g/i)
  const u = f(/UTILITY CATEGORY\s*Flight Load Factors \((?:Maximum Takeoff|Gross) Weight\s*-\s*([\d,]+) lb[^)]*\):?[^+]*?(\+\d\.\d+)\s*g[,.]?\s*(-\d\.\d+)\s*g[^+]*?(\+\d\.\d+)\s*g/i)
  const one = m => (m ? { weight: num(m[1]), flapsUp: `${m[2]} g / ${m[3].replace('-', '−')} g`, flapsDown: `${m[4]} g` } : null)
  if (n) return { normal: one(n), utility: one(u) }
  const c = f(/Flight Load Factors:\s*\*?\s*Flaps Up:?\s*(\+\d\.\d+)\s*g[,.]?\s*(-\d\.\d+)\s*g[^+]*?(\+\d\.\d+)\s*g/i)
  if (c) return { normal: { weight: null, flapsUp: `${c[1]} g / ${c[2].replace('-', '−')} g`, flapsDown: `${c[3]} g` }, utility: null, single: true }
  const p = f(/Positive Load Factor \(Maximum\)\s+([\d.]+)\s*G\s+([\d.]+)\s*G/i)
  return p ? { normal: { weight: null, flapsUp: `+${p[1]} g${/No inverted maneuvers/i.test(t) ? ' (no inverted maneuvers)' : ''}`, flapsDown: null }, utility: { weight: null, flapsUp: `+${p[2]} g`, flapsDown: null } } : null
}

export function summaryOf(t) {
  const out = []
  const sp = t.match(/SPEED:([^]*?)CRUISE:/i)?.[1]
  if (sp) {
    const kt = [...sp.matchAll(/(\d{3})\s*KNOTS/gi)].map(m => num(m[1]))
    if (/Maximum at Sea\.? ?Level/i.test(sp) && kt[0]) out.push({ label: 'Maximum speed, sea level', value: `${kt[0]} kt` })
    const c = sp.match(/Cruise[.,]? (\d+)% Power at (\d+) Ft/i)
    if (c && kt[1]) out.push({ label: `Cruise, ${c[1]} % at ${num(c[2]).toLocaleString('en-US')} ft`, value: `${kt[1]} kt` })
  }
  for (const m of flat(t).matchAll(/(\d+)% Power at (\d+) Ft[ .]*Range\s*(\d+)\s*NM\s*(\d+) Gallons Usable Fuel\s*Time\s*([\d.]+)\s*HRS/gi)) {
    out.push({ label: `Range, ${m[1]} % at ${num(m[2]).toLocaleString('en-US')} ft, ${m[4]} gal`, value: `${m[3]} nm · ${m[5]} h` }); break
  }
  for (const m of flat(t).matchAll(/Maximum Range at ([\d,.]+) Ft[ .]*Range\s*(\d+)\s*NM\s*(\d+) Gallons Usable Fuel\s*Time\s*([\d.]+)\s*HRS/gi)) {
    out.push({ label: `Range, best economy at ${num(m[1].replace('.', ',')).toLocaleString('en-US')} ft, ${m[3]} gal`, value: `${m[2]} nm · ${m[4]} h` }); break
  }
  const f = flat(t)
  const roc = f.match(/RATE OF C\S*\s?MB AT SEA LEVEL[ .·]*(\d{3,4})\s*FPM/i)
  if (roc) out.push({ label: 'Climb rate, sea level', value: `${roc[1]} fpm` })
  const ceil = f.match(/SERVICE CEILING[ .·]*(\d{1,2})[,.](\d{3})\s*FT/i)
  if (ceil) out.push({ label: 'Service ceiling', value: `${ceil[1]},${ceil[2]} ft` })
  const tk = f.match(/TAKEOFF PERFORMANCE\s*:?[^A-Za-z]*Ground Roll[ .·]*(\d{3,4})\s*FT\s*Tota\.?l Distance Over 50-Ft Obstacle[ .·]*(\d{3,4})\s*FT/i)
  if (tk) out.push({ label: 'Takeoff, ground roll / over 50 ft', value: `${tk[1]} / ${num(tk[2]).toLocaleString('en-US')} ft` })
  const ld = f.match(/LANDIN\w* PERFORMANCE\s*:?[^A-Za-z]*Ground Roll[ .·]*(\d{3,4})\s*FT\s*Total Distance Over 50-Ft Obstacle[ .·]*(\d{3,4})\s*FT/i)
  if (ld) out.push({ label: 'Landing, ground roll / over 50 ft', value: `${ld[1]} / ${num(ld[2]).toLocaleString('en-US')} ft` })
  return out
}

export function specsFromText(pages) {
  const t = normalize(pages.join('\n\f\n'))
  const f = flat(t)
  const out = {
    v: SPECS_VERSION,
    engine: engineOf(f), propeller: propellerOf(f), oil: oilOf(t), fuel: fuelOf(f), gear: gearOf(f), brakes: brakesOf(f),
    electrical: electricalOf(f), pitotHeat: pitotHeatOf(f), arcs: arcsOf(f), limits: limitsOf(t), speeds: speedsOf(f), stall: stallOf(t),
    loadFactors: loadFactorsOf(f), icing: /Flight into known icing conditions (?:is )?prohibited/i.test(f) ? 'Flight into known icing prohibited' : null,
    dims: { wingAreaSqFt: num(f.match(/Wing \S{1,8} is (\d{3}) sq/i)?.[1]), wheelBaseIn: num(f.match(/Wheel\s?\S{0,6}\s?length is (\d{2,3})"/i)?.[1]) },
    emptyStandard: num(f.match(/STANDARD EMPTY WEIGHT:\s*\w+[ .·]*(\d{4})\s*LBS/i)?.[1]),
    summary: summaryOf(t),
  }
  out.found = Object.entries(out).filter(([k, v]) => !['v', 'summary', 'dims', 'emptyStandard'].includes(k) && v != null).length
  return out
}

// A stored POH's specs, read once per parser version: from the text layer now,
// or for a scan from an OCR pass in the background (saved when it finishes).
const ocring = new Set()
export async function ensureSpecs(doc, log) {
  if (!doc?.id) return null
  const { rows: [r] } = await pool.query('SELECT specs FROM planner_documents WHERE id = $1', [doc.id])
  if (r?.specs?.v === SPECS_VERSION && !r.specs.pending) return r.specs
  if (r?.specs?.pending && ocring.has(doc.id)) return r.specs
  const { rows: [b] } = await pool.query('SELECT bytes FROM planner_documents WHERE id = $1', [doc.id])
  const pages = await pdfPages(b.bytes)
  if (pages) {
    const s = specsFromText(pages)
    await pool.query('UPDATE planner_documents SET specs = $2 WHERE id = $1', [doc.id, JSON.stringify(s)])
    log?.info({ id: doc.id, found: s.found }, 'POH specs read')
    return s
  }
  const pending = { v: SPECS_VERSION, pending: 'Reading the scanned book (OCR); a few minutes' }
  await pool.query('UPDATE planner_documents SET specs = $2 WHERE id = $1', [doc.id, JSON.stringify(pending)])
  ocring.add(doc.id)
  ocrPages(b.bytes).then(async ocr => {
    const s = { ...specsFromText(ocr), ocr: true }
    await pool.query('UPDATE planner_documents SET specs = $2 WHERE id = $1', [doc.id, JSON.stringify(s)])
    log?.info({ id: doc.id, found: s.found }, 'POH specs read by OCR')
  }).catch(e => log?.warn({ id: doc.id, err: e.message }, 'POH specs OCR failed')).finally(() => ocring.delete(doc.id))
  return pending
}

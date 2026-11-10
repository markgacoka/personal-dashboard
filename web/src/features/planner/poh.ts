// Aircraft performance and limitations for the planner, transcribed from the
// scanned 1982 Cessna 172P Pilot's Operating Handbook (N54829 copy). Figure
// numbers are kept so every number can be checked against the book.
//
// Takeoff/landing tables: [pressure altitude ft][temperature °C] → [ground roll, total over 50 ft]; null where the POH leaves a blank.

export interface DistanceTable {
  weight: number
  speeds: { liftoff?: number; at50: number }
  pa: number[]
  temps: number[]
  rows: ([number, number] | null)[][]
}

export interface CruiseRow { pa: number; rpm: number; cols: ([number, number, number] | null)[] } // ISA−20, ISA, ISA+20 → %BHP, KTAS, GPH

export interface AircraftProfile {
  key: string
  model: string
  source: string
  engine: string
  limits: { maxRamp: number; maxTakeoff: number; maxLanding: number; utilityMax: number; baggageCombined: number }
  stations: { key: string; label: string; arm: number; max?: number; range?: string }[]
  fuel: { key: string; label: string; usable: number; total: number }[]
  fuelArm: number
  fuelGrade: string
  taxiFuelLb: number
  envelope: { normal: [number, number][]; utility: [number, number][] } // [arm in, weight lb], closed polygon
  speeds: { label: string; kias: string; note?: string }[]
  vspeeds: { vso: number; vs1: number; vr: number; vx: number; vy: number; va: [number, number][]; vfe: string; vno: number; vne: number; glide: number; approach: string; shortApproach: number }
  crosswindDemo: number
  glideNmPer1000: number
  oil: string
  takeoff: DistanceTable[]
  landing: DistanceTable[]
  takeoffNotes: { headwindPer9kt: number; tailwindPer2kt: number; grassGroundRoll: number }
  landingNotes: { headwindPer9kt: number; tailwindPer2kt: number; grassGroundRoll: number }
  climb: { pa: number; temp: number; kias: number; fpm: number; min: number; gal: number; nm: number }[]
  climbStartFuelGal: number
  cruise: CruiseRow[]
  figures: Record<string, string>
  // Your own cruise numbers (from the aircraft profile) in place of the POH table.
  cruiseFixed?: { ktas?: number | null; gph?: number | null }
}

// What you changed on a tail's profile (saved per tail in planner_aircraft as
// data.profile). Blank fields keep the POH / TCDS / registry value.
type Num = number | null | undefined
export interface ProfileEdits {
  make?: string; model?: string; year?: Num; engine?: string; oil?: string
  maxRamp?: Num; maxTakeoff?: Num; maxLanding?: Num; utilityMax?: Num
  fuelUsable?: Num; fuelTotal?: Num; fuelArm?: Num
  arms?: Partial<Record<'front' | 'rear' | 'bag1' | 'bag2', Num>>
  vso?: Num; vs1?: Num; vr?: Num; vx?: Num; vy?: Num; va?: Num; vfe?: string; vno?: Num; vne?: Num; glide?: Num; approach?: string; shortApproach?: Num
  crosswindDemo?: Num; glideNmPer1000?: Num
  cruiseKtas?: Num; cruiseGph?: Num
}

const has = (v: Num): v is number => v != null && Number.isFinite(v) && v > 0
const text = (v?: string) => (v && v.trim() ? v.trim() : undefined)
// Number of fields you set (for "3 of your values" and the Reset button).
export const editCount = (e?: ProfileEdits | null) => !e ? 0 : Object.entries(e).reduce((n, [k, v]) => n + (k === 'arms' ? Object.values(v as object).filter(x => has(x as Num)).length : typeof v === 'string' ? (v.trim() ? 1 : 0) : has(v as Num) ? 1 : 0), 0)

// The profile to plan with: the matched POH profile with your values on top.
export function applyEdits(m: ProfileMatch, e?: ProfileEdits | null): ProfileMatch {
  const n = editCount(e)
  if (!e || !n) return m
  const p = m.profile
  const L = p.limits
  const arms = e.arms ?? {}
  const vs = p.vspeeds
  const profile: AircraftProfile = {
    ...p,
    source: `${p.source}, with ${n} value${n > 1 ? 's' : ''} from your aircraft profile`,
    engine: text(e.engine) ?? p.engine,
    oil: text(e.oil) ?? p.oil,
    limits: { ...L, maxRamp: has(e.maxRamp) ? e.maxRamp : L.maxRamp, maxTakeoff: has(e.maxTakeoff) ? e.maxTakeoff : L.maxTakeoff, maxLanding: has(e.maxLanding) ? e.maxLanding : L.maxLanding, utilityMax: has(e.utilityMax) ? e.utilityMax : L.utilityMax },
    fuel: has(e.fuelUsable) ? [{ key: 'yours', label: 'Your tanks', usable: e.fuelUsable, total: has(e.fuelTotal) ? e.fuelTotal : e.fuelUsable }] : p.fuel,
    fuelArm: has(e.fuelArm) ? e.fuelArm : p.fuelArm,
    stations: p.stations.map(s => { const a = arms[s.key as keyof typeof arms]; return has(a) ? { ...s, arm: a } : s }),
    vspeeds: {
      ...vs, vso: has(e.vso) ? e.vso : vs.vso, vs1: has(e.vs1) ? e.vs1 : vs.vs1, vr: has(e.vr) ? e.vr : vs.vr, vx: has(e.vx) ? e.vx : vs.vx, vy: has(e.vy) ? e.vy : vs.vy,
      va: has(e.va) ? [[has(e.maxTakeoff) ? e.maxTakeoff : L.maxTakeoff, e.va]] : vs.va, vfe: text(e.vfe) ?? vs.vfe, vno: has(e.vno) ? e.vno : vs.vno, vne: has(e.vne) ? e.vne : vs.vne,
      glide: has(e.glide) ? e.glide : vs.glide, approach: text(e.approach) ?? vs.approach, shortApproach: has(e.shortApproach) ? e.shortApproach : vs.shortApproach,
    },
    crosswindDemo: has(e.crosswindDemo) ? e.crosswindDemo : p.crosswindDemo,
    glideNmPer1000: has(e.glideNmPer1000) ? e.glideNmPer1000 : p.glideNmPer1000,
    cruiseFixed: has(e.cruiseKtas) || has(e.cruiseGph) ? { ktas: has(e.cruiseKtas) ? e.cruiseKtas : null, gph: has(e.cruiseGph) ? e.cruiseGph : null } : undefined,
  }
  return { ...m, profile }
}

const PA = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]
const T = [0, 10, 20, 30, 40]
type P = [number, number]
const rows = (...r: (P | null)[][]) => r

export const C172P: AircraftProfile = {
  key: 'C172P',
  model: 'Cessna 172P',
  source: '1982 Cessna 172P POH (12 May 1981, rev. 2), N54829 copy',
  engine: 'Lycoming O-320-D2J, 160 hp',
  limits: { maxRamp: 2407, maxTakeoff: 2400, maxLanding: 2400, utilityMax: 2100, baggageCombined: 120 },
  stations: [
    { key: 'front', label: 'Pilot and front passenger', arm: 37, range: 'Sta 34–46' },
    { key: 'rear', label: 'Rear passengers', arm: 73 },
    { key: 'bag1', label: 'Baggage area 1', arm: 95, max: 120, range: 'Sta 82–108' },
    { key: 'bag2', label: 'Baggage area 2', arm: 123, max: 50, range: 'Sta 108–142' },
  ],
  fuel: [
    { key: 'standard', label: 'Standard tanks', usable: 40, total: 43 },
    { key: 'long', label: 'Long-range tanks', usable: 50, total: 54 },
    { key: 'integral', label: 'Integral tanks', usable: 62, total: 68 },
  ],
  fuelArm: 48,
  fuelGrade: '100LL (blue) or 100 (green)',
  taxiFuelLb: 7,
  envelope: {
    normal: [[35.0, 1500], [35.0, 1950], [39.5, 2400], [47.3, 2400], [47.3, 1500]],
    utility: [[35.0, 1500], [35.0, 1950], [36.5, 2100], [40.5, 2100], [40.5, 1500]],
  },
  speeds: [
    { label: 'Normal climb', kias: '70–80' },
    { label: 'Short-field takeoff, flaps 10°, at 50 ft', kias: '56' },
    { label: 'Best rate (Vy), sea level / 10,000 ft', kias: '76 / 71' },
    { label: 'Best angle (Vx), sea level / 10,000 ft', kias: '60 / 65' },
    { label: 'Normal approach, flaps up / 30°', kias: '65–75 / 60–70' },
    { label: 'Short-field approach, flaps 30°', kias: '61' },
    { label: 'Balked landing, flaps 20°', kias: '55' },
    { label: 'Best glide, flaps up', kias: '65' },
  ],
  vspeeds: { vso: 33, vs1: 44, vr: 51, vx: 60, vy: 76, va: [[2400, 99], [2000, 92], [1600, 82]], vfe: '110 (10°) / 85 (10–30°)', vno: 127, vne: 158, glide: 65, approach: '60–70', shortApproach: 61 },
  crosswindDemo: 15,
  glideNmPer1000: 1.5,
  oil: 'Not less than 5 qt; 7 qt for extended flight',
  takeoff: [
    { weight: 2400, speeds: { liftoff: 51, at50: 56 }, pa: PA, temps: T, rows: rows(
      [[795, 1460], [860, 1570], [925, 1685], [995, 1810], [1065, 1945]],
      [[875, 1605], [940, 1725], [1015, 1860], [1090, 2000], [1170, 2155]],
      [[960, 1770], [1035, 1910], [1115, 2060], [1200, 2220], [1290, 2395]],
      [[1055, 1960], [1140, 2120], [1230, 2295], [1325, 2480], [1425, 2685]],
      [[1165, 2185], [1260, 2365], [1355, 2570], [1465, 2790], [1575, 3030]],
      [[1285, 2445], [1390, 2660], [1500, 2895], [1620, 3160], [1745, 3455]],
      [[1425, 2755], [1540, 3015], [1665, 3300], [1800, 3620], [1940, 3990]],
      [[1580, 3140], [1710, 3450], [1850, 3805], [2000, 4220], null],
      [[1755, 3615], [1905, 4015], [2060, 4480], null, null],
    ) },
    { weight: 2200, speeds: { liftoff: 49, at50: 54 }, pa: PA, temps: T, rows: rows(
      [[650, 1195], [700, 1280], [750, 1375], [805, 1470], [865, 1575]],
      [[710, 1310], [765, 1405], [825, 1510], [885, 1615], [950, 1735]],
      [[780, 1440], [840, 1545], [905, 1660], [975, 1785], [1045, 1915]],
      [[855, 1585], [925, 1705], [995, 1835], [1070, 1975], [1150, 2130]],
      [[945, 1750], [1020, 1890], [1100, 2040], [1180, 2200], [1270, 2375]],
      [[1040, 1945], [1125, 2105], [1210, 2275], [1305, 2465], [1405, 2665]],
      [[1150, 2170], [1240, 2355], [1340, 2555], [1445, 2775], [1555, 3020]],
      [[1270, 2440], [1375, 2655], [1485, 2890], [1605, 3155], [1730, 3450]],
      [[1410, 2760], [1525, 3015], [1650, 3305], [1785, 3630], [1925, 4005]],
    ) },
    { weight: 2000, speeds: { liftoff: 46, at50: 51 }, pa: PA, temps: T, rows: rows(
      [[525, 970], [565, 1035], [605, 1110], [650, 1185], [695, 1265]],
      [[570, 1060], [615, 1135], [665, 1215], [710, 1295], [765, 1385]],
      [[625, 1160], [675, 1240], [725, 1330], [780, 1425], [840, 1525]],
      [[690, 1270], [740, 1365], [800, 1465], [860, 1570], [920, 1685]],
      [[755, 1400], [815, 1500], [880, 1615], [945, 1735], [1015, 1865]],
      [[830, 1545], [900, 1660], [970, 1790], [1040, 1925], [1120, 2070]],
      [[920, 1710], [990, 1845], [1070, 1990], [1150, 2145], [1235, 2315]],
      [[1015, 1900], [1095, 2055], [1180, 2225], [1275, 2405], [1370, 2605]],
      [[1125, 2125], [1215, 2305], [1310, 2500], [1410, 2715], [1520, 2950]],
    ) },
  ],
  landing: [
    { weight: 2400, speeds: { at50: 61 }, pa: PA, temps: T, rows: rows(
      [[510, 1235], [530, 1265], [550, 1295], [570, 1325], [585, 1350]],
      [[530, 1265], [550, 1295], [570, 1325], [590, 1360], [610, 1390]],
      [[550, 1295], [570, 1330], [590, 1360], [610, 1390], [630, 1425]],
      [[570, 1330], [590, 1360], [615, 1395], [635, 1430], [655, 1460]],
      [[595, 1365], [615, 1400], [635, 1430], [660, 1470], [680, 1500]],
      [[615, 1400], [640, 1435], [660, 1470], [685, 1510], [705, 1540]],
      [[640, 1435], [660, 1470], [685, 1510], [710, 1550], [730, 1580]],
      [[665, 1475], [690, 1515], [710, 1550], [735, 1590], [760, 1630]],
      [[690, 1515], [715, 1555], [740, 1595], [765, 1635], [790, 1675]],
    ) },
  ],
  takeoffNotes: { headwindPer9kt: 0.10, tailwindPer2kt: 0.10, grassGroundRoll: 0.15 },
  landingNotes: { headwindPer9kt: 0.10, tailwindPer2kt: 0.10, grassGroundRoll: 0.45 },
  climb: [
    { pa: 0, temp: 15, kias: 76, fpm: 700, min: 0, gal: 0, nm: 0 },
    { pa: 1000, temp: 13, kias: 76, fpm: 655, min: 1, gal: 0.3, nm: 2 },
    { pa: 2000, temp: 11, kias: 75, fpm: 610, min: 3, gal: 0.6, nm: 4 },
    { pa: 3000, temp: 9, kias: 75, fpm: 560, min: 5, gal: 1.0, nm: 6 },
    { pa: 4000, temp: 7, kias: 74, fpm: 515, min: 7, gal: 1.4, nm: 9 },
    { pa: 5000, temp: 5, kias: 74, fpm: 470, min: 9, gal: 1.7, nm: 11 },
    { pa: 6000, temp: 3, kias: 73, fpm: 425, min: 11, gal: 2.2, nm: 14 },
    { pa: 7000, temp: 1, kias: 72, fpm: 375, min: 14, gal: 2.6, nm: 18 },
    { pa: 8000, temp: -1, kias: 72, fpm: 330, min: 17, gal: 3.1, nm: 22 },
    { pa: 9000, temp: -3, kias: 71, fpm: 285, min: 20, gal: 3.6, nm: 26 },
    { pa: 10000, temp: -5, kias: 71, fpm: 240, min: 24, gal: 4.2, nm: 32 },
    { pa: 11000, temp: -7, kias: 70, fpm: 190, min: 29, gal: 4.9, nm: 38 },
    { pa: 12000, temp: -9, kias: 70, fpm: 145, min: 35, gal: 5.8, nm: 47 },
  ],
  climbStartFuelGal: 1.1,
  cruise: [
    { pa: 2000, rpm: 2500, cols: [null, [76, 114, 8.5], [72, 114, 8.1]] },
    { pa: 2000, rpm: 2400, cols: [[72, 110, 8.1], [69, 109, 7.7], [65, 108, 7.3]] },
    { pa: 2000, rpm: 2300, cols: [[65, 104, 7.3], [62, 103, 6.9], [59, 102, 6.6]] },
    { pa: 2000, rpm: 2200, cols: [[58, 99, 6.6], [55, 97, 6.3], [53, 96, 6.1]] },
    { pa: 2000, rpm: 2100, cols: [[52, 92, 6.0], [50, 91, 5.8], [48, 89, 5.7]] },
    { pa: 4000, rpm: 2550, cols: [null, [76, 117, 8.5], [72, 116, 8.1]] },
    { pa: 4000, rpm: 2500, cols: [[77, 115, 8.6], [73, 114, 8.1], [69, 113, 7.7]] },
    { pa: 4000, rpm: 2400, cols: [[69, 109, 7.8], [65, 108, 7.3], [62, 107, 7.0]] },
    { pa: 4000, rpm: 2300, cols: [[62, 104, 7.0], [59, 102, 6.6], [57, 101, 6.4]] },
    { pa: 4000, rpm: 2200, cols: [[56, 98, 6.3], [54, 96, 6.1], [51, 94, 5.9]] },
    { pa: 4000, rpm: 2100, cols: [[51, 91, 5.8], [48, 89, 5.7], [47, 88, 5.5]] },
    { pa: 6000, rpm: 2600, cols: [null, [77, 119, 8.6], [72, 118, 8.1]] },
    { pa: 6000, rpm: 2500, cols: [[73, 114, 8.2], [69, 113, 7.8], [66, 112, 7.4]] },
    { pa: 6000, rpm: 2400, cols: [[66, 108, 7.4], [63, 107, 7.0], [60, 106, 6.7]] },
    { pa: 6000, rpm: 2300, cols: [[60, 103, 6.7], [57, 101, 6.4], [55, 99, 6.2]] },
    { pa: 6000, rpm: 2200, cols: [[54, 96, 6.1], [52, 95, 5.9], [50, 92, 5.8]] },
    { pa: 6000, rpm: 2100, cols: [[49, 90, 5.7], [47, 88, 5.5], [46, 86, 5.5]] },
    { pa: 8000, rpm: 2650, cols: [null, [77, 121, 8.6], [73, 120, 8.1]] },
    { pa: 8000, rpm: 2600, cols: [[77, 119, 8.7], [73, 118, 8.2], [69, 117, 7.8]] },
    { pa: 8000, rpm: 2500, cols: [[70, 113, 7.8], [66, 112, 7.4], [63, 111, 7.1]] },
    { pa: 8000, rpm: 2400, cols: [[63, 108, 7.1], [60, 106, 6.7], [58, 104, 6.5]] },
    { pa: 8000, rpm: 2300, cols: [[57, 101, 6.4], [55, 100, 6.2], [53, 97, 6.0]] },
    { pa: 8000, rpm: 2200, cols: [[52, 95, 5.9], [50, 93, 5.8], [49, 91, 5.7]] },
    { pa: 10000, rpm: 2600, cols: [[74, 118, 8.3], [70, 117, 7.8], [66, 115, 7.4]] },
    { pa: 10000, rpm: 2500, cols: [[67, 112, 7.5], [64, 111, 7.1], [61, 109, 6.8]] },
    { pa: 10000, rpm: 2400, cols: [[61, 106, 6.8], [58, 105, 6.5], [56, 102, 6.3]] },
    { pa: 10000, rpm: 2300, cols: [[55, 100, 6.3], [53, 98, 6.0], [51, 96, 5.9]] },
    { pa: 10000, rpm: 2200, cols: [[50, 93, 5.8], [49, 91, 5.7], [47, 89, 5.6]] },
    { pa: 12000, rpm: 2550, cols: [[67, 114, 7.5], [64, 112, 7.1], [61, 111, 6.9]] },
    { pa: 12000, rpm: 2500, cols: [[64, 111, 7.2], [61, 109, 6.8], [59, 107, 6.6]] },
    { pa: 12000, rpm: 2400, cols: [[59, 105, 6.6], [56, 103, 6.3], [54, 100, 6.1]] },
    { pa: 12000, rpm: 2300, cols: [[53, 98, 6.1], [51, 96, 5.9], [50, 94, 5.8]] },
  ],
  figures: {
    limits: 'Section 2: weight limits p. 2-6, CG limits p. 2-7, fuel p. 2-9',
    speeds: 'Section 4, Speeds for Normal Operation p. 4-3',
    stall: 'Figure 5-3, Stall Speeds',
    takeoff: 'Figure 5-5, Takeoff Distance (sheets 1–2)',
    climb: 'Figure 5-7, Time, Fuel and Distance to Climb',
    cruise: 'Figure 5-8, Cruise Performance (2400 lb, recommended lean)',
    landing: 'Figure 5-11, Landing Distance',
    glide: 'Figure 3-1, Maximum Glide',
    wb: 'Figure 6-5, Sample Loading Problem; CG envelope p. 2-7',
  },
}

// Models without a POH on file use the 172P tables with the model's own
// weight and CG limits from FAA Type Certificate Data Sheet 3A12.
const TCDS: Record<string, Pick<AircraftProfile, 'limits' | 'envelope'> & { engine: string }> = {
  '172N': {
    engine: 'Lycoming O-320-H2AD, 160 hp (per TCDS; STC conversions differ)',
    limits: { maxRamp: 2307, maxTakeoff: 2300, maxLanding: 2300, utilityMax: 2000, baggageCombined: 120 },
    envelope: { normal: [[35.0, 1500], [35.0, 1950], [38.5, 2300], [47.3, 2300], [47.3, 1500]], utility: [[35.0, 1500], [35.0, 1950], [35.5, 2000], [40.5, 2000], [40.5, 1500]] },
  },
  '172M': {
    engine: 'Lycoming O-320-E2D, 150 hp (per TCDS; STC conversions differ)',
    limits: { maxRamp: 2307, maxTakeoff: 2300, maxLanding: 2300, utilityMax: 2000, baggageCombined: 120 },
    envelope: { normal: [[35.0, 1500], [35.0, 1950], [38.5, 2300], [47.3, 2300], [47.3, 1500]], utility: [[35.0, 1500], [35.0, 1950], [35.5, 2000], [40.5, 2000], [40.5, 1500]] },
  },
}

export interface ProfileMatch { profile: AircraftProfile; exact: boolean; note: string | null }

// The profile to plan with for a registry model string ("172P", "172N", "CESSNA 172N").
export function profileFor(model?: string | null): ProfileMatch {
  const m = String(model || '').toUpperCase().match(/172([A-Z])?/)
  const variant = m ? `172${m[1] || ''}` : ''
  if (variant === '172P') return { profile: C172P, exact: true, note: null }
  const t = TCDS[variant]
  if (t) {
    return {
      profile: { ...C172P, key: `C${variant}`, model: `Cessna ${variant}`, engine: t.engine, limits: t.limits, envelope: t.envelope },
      exact: false,
      note: `No ${variant} POH on file. Distances, climb and cruise come from the 1982 172P POH (a 160 hp, 2,400 lb airplane); weight and CG limits are the ${variant}'s from TCDS 3A12. Check this airplane's own POH and any engine STC supplement.`,
    }
  }
  return {
    profile: C172P, exact: false,
    note: model ? `No POH profile for "${model}". Showing the 1982 172P only as a reference — do not use these numbers for this airplane.` : 'Choose an aircraft.',
  }
}

// Pages of the scanned 172P POH (N54829 copy, as stored in the planner) for jumping to a figure.
export const POH_PAGES_172P: Record<string, number> = {
  limits: 18, airspeed: 19, weights: 21, cg: 22, fuel: 24, emergency: 31, glide: 38, speeds: 48, checklist: 50,
  beforeTakeoff: 53, landingChecklist: 54, stall: 80, takeoff: 82, climb: 85, cruise: 86, landing: 94, wb: 102,
}

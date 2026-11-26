// What a POH says about the airplane itself, as the API reads it from the
// book's text (api/src/services/pohSpecs.js): engine, propeller, oil, fuel
// system, gear and tires, brakes, electrical, airspeed markings and limits,
// normal speeds, stall speeds, load factors, icing and the Section 1
// performance summary. Anything the book's text didn't yield is null.

type N = number | null
export interface StallRow { flaps: string; aft: number[]; fwd: number[] } // KIAS at 0°, 30°, 45°, 60° bank
export interface LoadFactor { weight: N; flapsUp: string | null; flapsDown: string | null }
export interface Tank { key: string; label: string; total: number; each: number; usable: number; unusable: number }
export interface PohSpecs {
  v: number; pending?: string; failed?: string; ocr?: boolean; found?: number
  engine?: { make: string | null; model: string | null; hp: N; rpm: N; type: string | null; displacement: string | null } | null
  propeller?: { make: string | null; model: string | null; blades: N; diameterIn: [number, number] | null; type: string | null; groundClearance: string | null } | null
  oil?: { sumpQt: N; totalQt: N; minQt: N; extendedQt: N; pressurePsi: { min: N; green: [number, number] | null; max: N } | null; maxTempF: N; spec: string | null; viscosity: string[] } | null
  fuel?: { tanks: Tank[]; grades: { grade: string; color: string }[]; system: string | null; selector: string | null } | null
  gear?: { type: string | null; nose: string | null; shock: string | null; tires: { nose: string | null; main: string | null } | null; strut: string | null } | null
  brakes?: { type: string | null; parking: string | null; fluid: string | null } | null
  electrical?: { volts: N; alternatorAmps: N; battery: string | null; bus: string | null; warning: string | null } | null
  pitotHeat?: string | null
  arcs?: { white: [number, number]; green: [number, number]; yellow: [number, number] | null; red: N; unit?: 'kt' | 'mph' } | null
  limits?: { vne: N; vno: N; va: [number, number][]; vfe: { label: string; kias: number }[]; windowOpen: N } | null
  speeds?: { vy: N; vx: N; vy10: N; vx10: N; climb: [number, number] | null; approachUp: [number, number] | null; approach: [number, number] | null; finalApproach: N; shortApproach: N; glide: N; crosswind: N } | null
  stall?: { weight: N; altitudeLoss: string | null; rows: StallRow[]; unit?: 'kt' | 'mph' } | null
  loadFactors?: { normal: LoadFactor | null; utility: LoadFactor | null; single?: boolean } | null
  icing?: string | null
  dims?: { wingAreaSqFt: N; wheelBaseIn: N }
  emptyStandard?: N
  summary?: { label: string; value: string }[]
}

// Enough was read to show a sheet (a scan still being read, or a book with no
// recognisable sections, isn't).
export const hasSpecs = (s?: PohSpecs | null): s is PohSpecs => !!s && !s.pending && (s.found ?? 0) >= 3

const inRange = (v: N | undefined, lo: number, hi: number): v is number => v != null && Number.isFinite(v) && v >= lo && v <= hi
const range = (r: [number, number] | null | undefined) => (r ? `${r[0]}–${r[1]}` : null)

// The V-speeds, tanks, oil and crosswind the planner flies, from the book's
// own pages: each one only where it was read and is plausible.
export function specOverrides(s: PohSpecs) {
  const a = s.arcs, l = s.limits, sp = s.speeds
  const vs: Record<string, unknown> = {}
  if (inRange(a?.white[0], 20, 120)) vs.vso = a!.white[0]
  if (inRange(a?.green[0], 25, 130)) vs.vs1 = a!.green[0]
  const vno = l?.vno ?? a?.green[1], vne = l?.vne ?? a?.red
  if (inRange(vno, 70, 250)) vs.vno = vno
  if (inRange(vne, 80, 300)) vs.vne = vne
  if (l?.va.length && l.va.every(([w, v]) => inRange(w, 800, 12000) && inRange(v, 50, 200))) vs.va = l.va
  if (l?.vfe.length) vs.vfe = l.vfe.length > 1 ? l.vfe.map(x => `${x.kias} (${x.label.replace(/^Flaps /, '')})`).join(' / ') : `${l.vfe[0].kias}`
  if (inRange(sp?.vx, 40, 150)) vs.vx = sp!.vx
  if (inRange(sp?.vy, 45, 160)) vs.vy = sp!.vy
  if (inRange(sp?.glide, 40, 150)) vs.glide = sp!.glide
  const appr = range(sp?.approach) ?? (sp?.finalApproach ? String(sp.finalApproach) : null)
  if (appr) vs.approach = appr
  if (inRange(sp?.shortApproach, 40, 120)) vs.shortApproach = sp!.shortApproach
  const tanks = (s.fuel?.tanks ?? []).filter(t => inRange(t.usable, 5, 500) && t.total >= t.usable)
  const speedList = [
    sp?.climb && { label: 'Normal climb', kias: range(sp.climb)! },
    (sp?.vy || sp?.vy10) && { label: 'Best rate (Vy), sea level / 10,000 ft', kias: [sp!.vy, sp!.vy10].filter(Boolean).join(' / ') },
    (sp?.vx || sp?.vx10) && { label: 'Best angle (Vx), sea level / 10,000 ft', kias: [sp!.vx, sp!.vx10].filter(Boolean).join(' / ') },
    (sp?.approachUp || sp?.approach) && { label: 'Normal approach, flaps up / down', kias: [range(sp!.approachUp), range(sp!.approach)].filter(Boolean).join(' / ') },
    sp?.shortApproach && { label: 'Short-field approach', kias: String(sp.shortApproach) },
    sp?.finalApproach && { label: 'Final approach, full flaps', kias: String(sp.finalApproach) },
    sp?.glide && { label: 'Best glide', kias: String(sp.glide) },
  ].filter(Boolean) as { label: string; kias: string }[]
  const o = s.oil
  return {
    vspeeds: vs,
    fuel: tanks.map(t => ({ key: t.key, label: t.label, usable: t.usable, total: t.total })),
    fuelGrade: s.fuel?.grades.length ? s.fuel.grades.map(g => `${g.grade} (${g.color.toLowerCase()})`).join(', ') : null,
    oil: o?.minQt ? `Not less than ${o.minQt} qt${o.extendedQt ? `; ${o.extendedQt} qt for extended flight` : ''}${o.sumpQt ? ` (sump ${o.sumpQt} qt)` : ''}` : null,
    crosswindDemo: inRange(sp?.crosswind, 5, 40) ? sp!.crosswind : null,
    engine: s.engine?.model ? `${s.engine.make ? `${s.engine.make.replace(/^Avco /, '')} ` : ''}${s.engine.model}${s.engine.hp ? `, ${s.engine.hp} hp` : ''}` : null,
    speeds: speedList,
  }
}

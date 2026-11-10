// The Notes block at the top of each NavLog sheet, written the way you'd jot it
// down from a briefing: the day, the airplane and preflight time, the hazards on
// the route (TFR, SIGMET, CWA, turbulence, G-AIRMETs) and the NOTAMs that matter
// at the two airports. Pure; the sheet renders the lines.
import { notamBody } from '@/lib/weather'
import type { Advisory, Derived, Flight } from './model'
import { fmtZ } from './ui'

export interface NotamSet { icao: string; items: string[]; unavailable?: boolean }

// IFR procedures, charts and obstacle lights don't change a VFR plan.
const SKIP = /\b(IAP|RNAV|ILS|LOC|LPV|VOR\/DME RWY|SID|STAR|ODP|DVA|TAKEOFF MINIMUMS|PROCEDURE|CHART|OBST|CRANE|TWR LGT|LGT ON .*TOWER|ASR|AWOS-3 .*WIND)\b/
const RANK: [RegExp, number][] = [[/\bAD\b.*\bCLSD\b|\bRWY\b.*\bCLSD\b/, 0], [/\bRWY\b/, 1], [/\bUAS\b|\bAIRSPACE\b|\bTFR\b|\bPJE\b|\bAEROBATIC/, 2], [/\bTWY\b|\bAPRON\b/, 3], [/\bSVC\b|\bCOM\b|\bATIS\b|\bNAV\b|\bFUEL\b|\bTWR\b/, 4]]

// One NOTAM → a short note: "RWY 08/26 VASI out", "UAS area 7.5 nm SFC–1,000 ft".
export function notamDigest(raw: string) {
  let t = notamBody(raw).replace(/\s+/g, ' ').trim()
  t = t.replace(/^!\S+ \d+\/\d+ \S+ /, '').replace(/ \d{10}(-\d{10}(EST)?|-PERM)?$/, '')
  t = t.replace(/^AIRSPACE UAS WI AN AREA DEFINED AS ([\d.]+NM) RADIUS OF (\S+).*?(SFC|\d+FT)-(\d+FT)( AGL)?.*$/, 'UAS area $1 around $2, $3–$4$5')
    .replace(/\bU\/S\b/g, 'out').replace(/\bCLSD\b/g, 'closed').replace(/\bUNUSABLE\b/g, 'unusable').replace(/\bAVBL\b/g, 'available').replace(/\bUNAVBL\b/g, 'unavailable')
  return t.length > 80 ? `${t.slice(0, 78).replace(/\s\S*$/, '')}…` : t
}

export function notamHighlights(items: string[], max = 4) {
  const ranked = items.map(raw => ({ raw, body: notamBody(raw).toUpperCase() })).filter(n => n.body && !SKIP.test(n.body))
    .map(n => ({ ...n, rank: RANK.find(([re]) => re.test(n.body))?.[1] ?? 9 })).filter(n => n.rank < 9).sort((a, b) => a.rank - b.rank)
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of ranked) { const d = notamDigest(n.raw); if (!seen.has(d)) { seen.add(d); out.push(d) } }
  return { shown: out.slice(0, max), more: Math.max(0, out.length - max) }
}

const level = (v?: string | null) => (v == null || v === '' ? null : /^\d+$/.test(v) ? `FL${v.padStart(3, '0')}` : v)
const range = (g: Advisory) => { const b = level(g.base), t = level(g.top); return b || t ? `${b ?? 'SFC'}–${t ?? ''}` : '' }
const GA: Record<string, { product: string; label: string }> = {
  IFR: { product: 'Sierra', label: 'IFR' }, MT_OBSC: { product: 'Sierra', label: 'obscured mountains' },
  TURB_LO: { product: 'Tango', label: 'turbulence' }, TURB_HI: { product: 'Tango', label: 'turbulence aloft' }, SFC_WND: { product: 'Tango', label: 'surface winds 30 kt+' }, LLWS: { product: 'Tango', label: 'low-level wind shear' },
  ICE: { product: 'Zulu', label: 'moderate icing' },
}

export function weatherNotes(d: Derived) {
  const h = d.hazards
  const conv = h.sigmets.filter(s => s.hazard === 'CONVECTIVE')
  const other = h.sigmets.filter(s => s.hazard !== 'CONVECTIVE')
  const turbP = h.pireps.filter(p => /MOD|SEV|EXTRM/.test(p.tbInt1 || ''))
  const none: string[] = [], have: string[] = []
  ;(h.tfrs?.length ? have : none).push(h.tfrs?.length ? `TFR ${h.tfrs.map(f => f.properties.id || f.properties.title).join(', ')}` : 'TFR')
  ;(other.length ? have : none).push(other.length ? `SIGMET ${[...new Set(other.map(s => s.hazard))].join(', ').toLowerCase()}` : 'SIGMET')
  ;(h.cwas.length ? have : none).push(h.cwas.length ? `CWA ${h.cwas.map(c => c.cwsu ?? '').join(' ').trim()}`.trim() : 'CWA')
  ;(turbP.length ? have : none).push(turbP.length ? `PIREP ${turbP.map(p => p.tbInt1.toLowerCase()).join(', ')} turbulence` : 'turbulence')
  const byProduct = new Map<string, Set<string>>()
  for (const g of h.gairmets) {
    const m = GA[g.hazard]; if (!m) continue
    const r = range(g)
    if (!byProduct.has(m.product)) byProduct.set(m.product, new Set())
    byProduct.get(m.product)!.add(`${m.label}${r ? ` ${r}` : ''}`)
  }
  const ga = [...byProduct].map(([p, s]) => `${p} (${[...s].join(', ')})`).join(', ')
  const lines = [[none.length ? `no ${none.join(', ')}` : '', ...have].filter(Boolean).join(', ') + (ga ? ` | G-AIRMET ${ga}` : ' | no G-AIRMETs')]
  for (const c of conv) lines.push(`Convective SIGMET${c.validTimeTo ? ` until ${fmtZ(new Date(c.validTimeTo * 1000))}` : ''}`)
  if (d.freezing) lines.push(`Freezing level ~${d.freezing.altFt.toLocaleString()} ft`)
  return lines
}

export function flightNotes(d: Derived, f: Flight, aircraft: string, notams: NotamSet[], instructor: string | null = null) {
  const dep = f.departAt
  const pre = new Date(dep.getTime() - 30 * 60_000)
  const hhmm = (x: Date) => `${String(x.getHours()).padStart(2, '0')}${String(x.getMinutes()).padStart(2, '0')}`
  const day = dep.toLocaleDateString('en-US', { weekday: 'long', month: 'numeric', day: 'numeric' }).replace(',', '')
  const ids = [...new Set([f.from, f.to].map(a => a.icao || a.id))]
  const nt = ids.map(id => {
    const set = notams.find(n => n.icao === id)
    if (!set) return `${id} loading`
    if (set.unavailable) return `${id} unavailable (check notams.aim.faa.gov)`
    const { shown, more } = notamHighlights(set.items)
    return shown.length ? `${id} ${shown.join('; ')}${more ? ` (+${more} more)` : ''}` : `${id} none that affect VFR`
  })
  return { day: `${day} (VFR${instructor ? `, dual with ${instructor}` : ''})`, aircraft: `${aircraft} (preflight ${hhmm(pre)} local)`, wx: weatherNotes(d), notams: nt }
}

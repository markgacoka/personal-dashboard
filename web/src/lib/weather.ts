import type { AirportInfo, Metar, Runway } from './types'

export type Verdict = 'GO' | 'CAUTION' | 'NO-GO'

export interface Brief {
  cat: string
  wdir: number | 'VRB' | null
  wspd: number
  wgst: number | null
  calm: boolean
  best: { ident: string; hdg: number; headwind: number; crosswind: number } | null
  densityAltitude: number | null
  altimInHg: number | null
  spread: number | null
  observed: Date | null
  verdict: Verdict
  reasons: string[]
}

// Observation time from the raw METAR ("…271853Z…"); the API's obsTime isn't reliable.
export function observedAt(raw?: string): Date | null {
  const m = raw?.match(/\b(\d{2})(\d{2})(\d{2})Z\b/)
  if (!m) return null
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), +m[1], +m[2], +m[3]))
  if (d > now) d.setUTCMonth(d.getUTCMonth() - 1)
  return d
}

export function brief(metar: Metar, airport: AirportInfo | null, runways: Runway[]): Brief {
  const raw = metar.rawOb || metar.raw || ''
  const cat = (metar.fltcat || '').toUpperCase() || 'VFR'
  const wdir = metar.wdir ?? null
  const wspd = metar.wspd || 0
  const wgst = metar.wgst || null

  let best: Brief['best'] = null
  if (typeof wdir === 'number' && wspd) {
    let score = -Infinity
    for (const r of runways) {
      for (const [hdg, ident] of [[r.le_hdg, r.le_ident], [r.he_hdg, r.he_ident]] as const) {
        if (!hdg) continue
        const rad = ((((wdir - hdg) % 360) + 360) % 360) * Math.PI / 180
        const hw = Math.round(wspd * Math.cos(rad))
        const xw = Math.round(Math.abs(wspd * Math.sin(rad)))
        if (hw - xw * 0.5 > score) { score = hw - xw * 0.5; best = { ident, hdg, headwind: hw, crosswind: xw } }
      }
    }
  }

  const altimInHg = metar.altim ? metar.altim / 33.8639 : null
  let densityAltitude: number | null = null
  if (airport?.elev != null && altimInHg && metar.temp != null) {
    const pa = airport.elev + (29.92 - altimInHg) * 1000
    densityAltitude = Math.round(pa + 118.8 * (metar.temp - (15 - 2 * (pa / 1000))))
  }

  const reasons: string[] = []
  let verdict: Verdict = 'GO'
  if (cat === 'IFR' || cat === 'LIFR') { verdict = 'NO-GO'; reasons.push(cat) }
  else {
    if (cat === 'MVFR') reasons.push('MVFR')
    if (best && best.crosswind > 10) reasons.push(`${best.crosswind} kt crosswind`)
    if (wgst && wgst > 20) reasons.push(`gusts ${wgst} kt`)
    if (reasons.length) verdict = 'CAUTION'
  }

  return {
    cat, wdir, wspd, wgst, calm: !wspd || wspd < 2, best, densityAltitude,
    altimInHg, spread: metar.temp != null && metar.dewp != null ? metar.temp - metar.dewp : null,
    observed: observedAt(raw) || (metar.obsTime ? new Date(metar.obsTime) : null),
    verdict, reasons,
  }
}

export function windText(b: Pick<Brief, 'wdir' | 'wspd' | 'wgst'>) {
  if (b.wdir === 'VRB') return `Variable at ${b.wspd} kt`
  if (typeof b.wdir === 'number' && b.wspd) return `${String(b.wdir).padStart(3, '0')}° at ${b.wspd} kt${b.wgst ? `, gusting ${b.wgst}` : ''}`
  return b.wspd === 0 ? 'Calm' : '—'
}

// ── NOTAMs ───────────────────────────────────────────────────────────────────
export const NOTAM_KIND: Record<string, { label: string; tone: 'bad' | 'warn' | 'info' | 'neutral' }> = {
  TFR: { label: 'Flight restriction', tone: 'bad' }, FDC: { label: 'Regulatory', tone: 'bad' },
  IAP: { label: 'Approach', tone: 'info' }, ODP: { label: 'Departure', tone: 'info' }, NAV: { label: 'Navaid', tone: 'info' },
  COM: { label: 'Communications', tone: 'info' }, N: { label: 'Local', tone: 'info' },
  RWY: { label: 'Runway', tone: 'warn' }, TWY: { label: 'Taxiway', tone: 'warn' }, OBST: { label: 'Obstacle', tone: 'warn' }, D: { label: 'General', tone: 'warn' },
  SVC: { label: 'Service', tone: 'neutral' }, O: { label: 'Other', tone: 'neutral' }, AD: { label: 'Aerodrome', tone: 'neutral' },
}

// The E) free-text section of an ICAO NOTAM, falling back to the whole text.
export function notamBody(raw?: string) {
  if (!raw) return ''
  const m = raw.match(/\bE\)\s+([\s\S]*?)(?=\n[A-GQ]\)|$)/)
  if (m) return m[1].trim()
  return raw.replace(/^[QABCDEFG]\)[ \t].*\n?/gm, '').trim() || raw.trim()
}

const ABBREV: [RegExp, string][] = [
  [/\bRWYS\b/g, 'runways'], [/\bRWY\b/g, 'runway'], [/\bTWYS\b/g, 'taxiways'], [/\bTWY\b/g, 'taxiway'],
  [/\bACFTS?\b/g, 'aircraft'], [/\bCLSD\b/g, 'closed'], [/\bOBSTS?\b/g, 'obstacle'], [/\bTEMP\b/g, 'temporary'],
  [/\bPERM\b/g, 'permanent'], [/\bLGTD\b/g, 'lighted'], [/\bLGT\b/g, 'lighting'], [/\bOPS\b/g, 'operations'],
  [/\bOUT OF SVC\b/g, 'out of service'], [/\bSVC\b/g, 'service'], [/\bUNAVBL\b/g, 'unavailable'], [/\bAVBL\b/g, 'available'],
  [/\bUNMON\b/g, 'unmonitored'], [/\bFREQ\b/g, 'frequency'], [/\bDER\b/g, 'departure end of runway'], [/\bAMDT\b/g, 'amendment'],
  [/\bORIG\b/g, 'original'], [/\bCOMS?\b/g, 'communications'], [/\bNOT AUTH\b/g, 'not authorized'], [/\bEQPD\b/g, 'equipped'],
  [/\bWIP\b/g, 'work in progress'], [/\bCATS\b/g, 'categories'], [/\bINFO\b/g, 'information'], [/\bPPR\b/g, 'prior permission required'],
  [/\bAPCH\b/g, 'approach'], [/\bDEP\b/g, 'departure'], [/\bHDG\b/g, 'heading'], [/\bALT\b/g, 'altitude'],
  [/\bMINM\b/g, 'minimum'], [/\bMAXM\b/g, 'maximum'], [/\bAD\b/g, 'aerodrome'], [/\bARP\b/g, 'aerodrome reference point'],
  [/\bEXCPT\b/g, 'except'], [/\bAPPROX\b/g, 'approximately'], [/(?<=[,.\s]|^)NA(?=[,.\s]|$)/gm, 'not authorized'],
]
export function notamExpand(text: string) {
  let t = text
  for (const [re, rep] of ABBREV) t = t.replace(re, rep)
  return t
}

export function notamDate(s?: string) {
  if (!s || s === 'PERM') return null
  const est = /EST\s*$/i.test(s)
  const m = String(s).match(/^(\d{1,2})\/(\d{2})\/(\d{4})\s+(\d{2})(\d{2})/)
  if (!m) return String(s)
  const mo = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[+m[1] - 1]
  return `${mo} ${+m[2]}, ${m[3]} ${m[4]}:${m[5]}Z${est ? ' (est.)' : ''}`
}

export const FREQ_ORDER = ['ATIS', 'AWOS', 'ASOS', 'A/G', 'TWR', 'CTAF', 'GND', 'APP', 'DEP', 'CLD']

export function homeAirport() {
  try { return localStorage.getItem('home-airport') || 'KRHV' } catch { return 'KRHV' }
}
export function setHomeAirport(icao: string) {
  try { localStorage.setItem('home-airport', icao.toUpperCase()) } catch { /* per-browser */ }
}

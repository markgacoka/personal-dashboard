// A POH's performance tables read from its text layer: takeoff and landing
// distance, time/fuel/distance to climb and cruise performance, plus the wind
// and grass corrections from the chart notes. Built for the Cessna GAMA-format
// tables (172, 152, 182 …), including OCR'd scans whose rows come apart.
//
// Values are placed by column position (the median position of each column in
// the rows that read completely), so a row split over two lines is joined and a
// misread value stays in its own cell. Every table is then checked: distances
// grow with altitude and temperature and the total exceeds the ground roll;
// climb time, fuel and distance grow with altitude; cruise speeds and flows sit
// in a plausible range. A row that fails is dropped (the planner interpolates
// across the gap), and a table with too few good rows is not used at all.
import { pool } from '../db/client.js'
import { pdfPages } from './pohPages.js'

export const TABLES_VERSION = 2

const num = s => (/^-?\d{1,2},\d{3}$/.test(s) ? Number(s.replace(',', '')) : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN)
const isSL = s => /^S\.?L\.?$/i.test(s)
const isNull = s => /^-{2,}$/.test(s) || s === '—'
const isPa = s => isSL(s) || (Number.isFinite(num(s)) && num(s) % 1000 === 0 && num(s) >= 1000 && num(s) <= 16000)
const paOf = s => (isSL(s) ? 0 : num(s))

// Tokens with their column centre. "7. 5" (an OCR gap) → "7.5"; "S. L." → "S.L."; lone punctuation dropped.
export function tokens(line) {
  const l = line.replace(/(\d)\. (\d)\b/g, '$1.$2 ').replace(/S\s?\.\s?L\s?\./gi, 'S.L.')
  return [...l.matchAll(/\S+/g)].filter(m => !/^[.,:;'`|_~·•-]$/.test(m[0])).map(m => ({ s: m[0], x: m.index + m[0].length / 2 }))
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }

// Columns placed by position: tokens → cells [0..n), each a token string or undefined.
function place(toks, centres, tol) {
  const cells = Array(centres.length).fill(undefined)
  for (const t of toks) {
    let best = -1, bd = Infinity
    centres.forEach((c, i) => { const d = Math.abs(c - t.x); if (d < bd) { bd = d; best = i } })
    if (best >= 0 && bd <= tol && cells[best] === undefined) cells[best] = t.s
  }
  return cells
}

// ── Takeoff / landing distance ────────────────────────────────────────────────
// Rows: [weight [speed speed]] PA ground total ground total … (one pair per temperature).
// Each sheet is fitted on its own: two sheets rarely share column positions.
export function distanceTables(pageTexts, { speeds = 2 } = {}) {
  const header = pageTexts.flatMap(p => p.split('\n')).map(l => [...l.matchAll(/(-?\d{1,2})\s*°\s*C/g)].map(m => Number(m[1]))).find(t => t.length >= 3)
  return pageTexts.flatMap(p => distanceSheet(p, header, speeds))
}

function distanceSheet(text, header, speeds) {
  const lines = text.split('\n')
  const parsed = lines.map((l, i) => {
    const t = tokens(l)
    // The altitude is the token followed by at least three distances (margin specks before it are ignored).
    const k = t.findIndex((x, j) => isPa(x.s) && t.slice(j + 1).filter(y => num(y.s) >= 100 || isNull(y.s)).length >= 3)
    if (k < 0) return { i, data: t, lead: null }
    const lead = t.slice(0, k).map(y => num(y.s)).filter(Number.isFinite)
    return { i, pa: paOf(t[k].s), lead, data: t.slice(k + 1) }
  })
  const rows = parsed.filter(r => r.lead)
  if (!rows.length) return []
  // Columns: the usual count of values per row (OCR specks in the margins don't count).
  const vals = r => r.data.filter(y => Number.isFinite(num(y.s)) || isNull(y.s))
  const counts = rows.map(r => vals(r).length)
  const width = [...new Set(counts)].sort((a, b) => counts.filter(c => c === b).length - counts.filter(c => c === a).length || b - a)[0]
  const nT = header && header.length * 2 === width ? header.length : width / 2
  if (!Number.isInteger(nT) || nT < 3) return []
  const temps = header && header.length === nT ? header : Array.from({ length: nT }, (_, k) => k * 10)
  const full = rows.filter(r => vals(r).length === nT * 2)
  if (full.length < 3) return []
  const centres = Array.from({ length: nT * 2 }, (_, c) => median(full.map(r => vals(r)[c].x)))
  const gap = Math.min(...centres.slice(1).map((c, k) => c - centres[k]))
  const used = new Set()
  const out = []
  let cur = null
  for (const r of rows) {
    const w = r.lead.find(v => v >= 1000 && v <= 4000)
    if (w) {
      const sp = r.lead.filter(v => v >= 30 && v < 120)
      cur = { weight: w, speeds: speeds === 2 ? { liftoff: sp[0] ?? null, at50: sp[1] ?? sp[0] ?? null } : { at50: sp[0] ?? null }, pa: [], rows: [], failed: 0 }
      out.push(cur)
    }
    if (!cur) continue
    let cells = place(r.data, centres, gap / 2)
    // A row OCR split over lines: fill its empty columns from unlabelled number-only lines next to it.
    if (cells.some(c => c === undefined)) {
      for (const j of [r.i - 1, r.i + 1, r.i - 2, r.i + 2]) {
        const o = parsed[j]
        // Specks in the margins don't disqualify a line; words inside the table do.
        const inside = o ? o.data.filter(y => y.x > centres[0] - gap && y.x < centres.at(-1) + gap) : []
        if (!o || o.lead || used.has(j) || inside.some(y => /[A-Za-z]{3,}/.test(y.s))) continue
        const ov = vals(o)
        if (ov.length < 2) continue
        const extra = place(ov, centres, gap / 2)
        if (extra.some((v, c) => v !== undefined && cells[c] !== undefined)) continue
        cells = cells.map((v, c) => v ?? extra[c])
        used.add(j)
        if (cells.every(v => v !== undefined)) break
      }
    }
    const pairs = []
    let ok = true
    for (let k = 0; k < nT; k++) {
      const a = cells[2 * k], b = cells[2 * k + 1]
      if (a !== undefined && b !== undefined && isNull(a) && isNull(b)) { pairs.push(null); continue }
      const g = num(a ?? ''), tot = num(b ?? '')
      if (!Number.isFinite(g) || !Number.isFinite(tot)) { ok = false; break }
      pairs.push([g, tot])
    }
    if (ok) { cur.pa.push(r.pa); cur.rows.push(pairs) } else cur.failed++
  }
  return out.map(t => checkDistance({ ...t, temps })).filter(Boolean)
}

// Keep rows that read sensibly; null when too little is left to trust.
function checkDistance(t) {
  const keep = { pa: [], rows: [] }
  const order = t.pa.map((p, i) => i).sort((a, b) => t.pa[a] - t.pa[b])
  let dropped = t.failed
  for (const i of order) {
    const row = t.rows[i], prev = keep.rows.at(-1)
    const inRow = row.every(c => !c || (c[0] > 0 && c[1] > c[0] && c[1] < 10_000)) &&
      row.every((c, k) => { const p = row.slice(0, k).reverse().find(Boolean); return !c || !p || (c[0] >= p[0] && c[1] >= p[1]) })
    // Distances run nearly straight across temperature: a value 4 % off the line
    // through its neighbours, or more than 30 % up per 1,000 ft on the row below, is a misread.
    const smooth = row.every((c, k) => {
      const a = row[k - 1], b = row[k + 1]
      return !c || !a || !b || [0, 1].every(j => Math.abs(c[j] - (a[j] + b[j]) / 2) <= 0.04 * c[j])
    })
    const grow = prev ? 1.3 ** ((t.pa[i] - keep.pa.at(-1)) / 1000) : 1
    const vsPrev = !prev || row.every((c, k) => !c || !prev[k] || (c[0] >= prev[k][0] && c[1] >= prev[k][1] && c[1] <= prev[k][1] * grow))
    if (inRow && smooth && vsPrev && t.pa[i] !== keep.pa.at(-1)) { keep.pa.push(t.pa[i]); keep.rows.push(row) } else dropped++
  }
  if (keep.pa[0] !== 0 || keep.pa.length < 5 || !keep.rows[0].every(Boolean)) return null
  // Rows the chart has but the reader couldn't use: the planner interpolates across
  // them, which errs long because the distances curve upward with altitude.
  const missing = []
  for (let pa = 1000; pa < keep.pa.at(-1); pa += 1000) if (!keep.pa.includes(pa)) missing.push(pa)
  return { weight: t.weight, speeds: t.speeds, pa: keep.pa, temps: t.temps, rows: keep.rows, missing, dropped }
}

// ── Time, fuel and distance to climb ──────────────────────────────────────────
// Rows: [weight] PA temp KIAS FPM min gal nm.
export function climbTable(pageTexts) {
  const out = []
  let dropped = 0
  for (const line of pageTexts.flatMap(p => p.split('\n'))) {
    const t = tokens(line).map(x => x.s)
    const k = t.findIndex(isPa)
    if (k < 0 || t.length - k - 1 !== 6) continue
    const [temp, kias, fpm, min, gal, nm] = t.slice(k + 1).map(num)
    const row = { pa: paOf(t[k]), temp, kias, fpm, min, gal, nm }
    const prev = out.at(-1)
    const ok = [temp, kias, fpm, min, gal, nm].every(Number.isFinite) && kias >= 45 && kias <= 110 && fpm >= 50 && fpm <= 2000 && gal < 20 && nm < 100 &&
      (!prev || (row.pa > prev.pa && min >= prev.min && gal >= prev.gal && nm >= prev.nm))
    if (ok) out.push(row); else dropped++
  }
  return out.length >= 5 && out[0].pa === 0 && out[0].min === 0 ? { rows: out, dropped } : null
}

// ── Cruise performance ───────────────────────────────────────────────────────
// Rows: [PA] RPM, then %BHP KTAS GPH at 20 °C below, standard and 20 °C above.
export function cruiseTable(pageTexts) {
  const lines = pageTexts.flatMap(p => p.split('\n'))
  const rows = []
  let pa = null
  for (const line of lines) {
    const t = tokens(line)
    let k = 0
    if (t[0] && isPa(t[0].s) && t[1] && num(t[1].s) >= 1800 && num(t[1].s) <= 2900) { pa = paOf(t[0].s); k = 1 }
    const rpm = t[k] ? num(t[k].s) : NaN
    if (!(rpm >= 1800 && rpm <= 2900 && rpm % 50 === 0) || pa == null) continue
    rows.push({ pa, rpm, data: t.slice(k + 1) })
  }
  const full = rows.filter(r => r.data.length === 9)
  if (full.length < 5) return null
  const centres = Array.from({ length: 9 }, (_, c) => median(full.map(r => r.data[c].x)))
  const gap = Math.min(...centres.slice(1).map((c, k) => c - centres[k]))
  const out = []
  let dropped = 0
  for (const r of rows) {
    const raw = place(r.data, centres, gap / 2)
    // Fuel flow is printed with a decimal ("6.0"); a bare "6" is a misread.
    const cells = raw.map((v, c) => (v === undefined || (c % 3 === 2 && !v.includes('.')) ? NaN : num(v)))
    const cols = [0, 1, 2].map(g => {
      const [bhp, ktas, gph] = cells.slice(g * 3, g * 3 + 3)
      return bhp >= 20 && bhp <= 100 && ktas >= 50 && ktas <= 200 && gph >= 2 && gph <= 20 ? [bhp, ktas, gph] : null
    })
    // Colder air gives more power and flow at the same RPM: %BHP and GPH fall
    // from the 20 °C-below column to the 20 °C-above one, and TAS stays within a
    // few knots of standard. A column out of line with the other two is a misread.
    const fits = (a, b) => !a || !b || (a[0] >= b[0] && a[2] >= b[2])
    const near = c => !c || !cols[1] || Math.abs(c[1] - cols[1][1]) <= 6
    if (cols[1] && !fits(cols[0], cols[1]) && !fits(cols[1], cols[2])) cols[1] = null
    if (cols[0] && (!fits(cols[0], cols[1]) || !near(cols[0]))) cols[0] = null
    if (cols[2] && (!fits(cols[1], cols[2]) || !near(cols[2]))) cols[2] = null
    if (!cols[1]) { dropped++; continue }
    // Within an altitude, less RPM is less power, speed and flow.
    const above = out.at(-1)
    if (above && above.pa === r.pa && above.rpm > r.rpm && !(above.cols[1][0] >= cols[1][0] && above.cols[1][1] >= cols[1][1] && above.cols[1][2] >= cols[1][2])) { dropped++; continue }
    out.push({ pa: r.pa, rpm: r.rpm, cols })
  }
  const pas = new Set(out.map(r => r.pa))
  return out.length >= 6 && pas.size >= 2 ? { rows: out, dropped } : null
}

// ── Notes ────────────────────────────────────────────────────────────────────
export function corrections(text) {
  const t = text.replace(/\s+/g, ' ').replace(/knot\s+s\b/gi, 'knots').replace(/head\s+wind/gi, 'headwind').replace(/tail\s+wind/gi, 'tailwind')
  const head = t.match(/decrease distances (\d+)\s*% for each (\d+) knots? headwind/i)
  const tail = t.match(/tailwinds? up to \d+ knots?, increase distances by (\d+)\s*% for each (\d+) knots?/i)
  const grass = t.match(/increase distances by (\d+)\s*% of the "?\s*ground roll/i)
  if (!head || !tail) return null
  return {
    headwindPer9kt: Math.round((Number(head[1]) / 100) * (9 / Number(head[2])) * 1000) / 1000,
    tailwindPer2kt: Math.round((Number(tail[1]) / 100) * (2 / Number(tail[2])) * 1000) / 1000,
    grassGroundRoll: grass ? Number(grass[1]) / 100 : null,
  }
}

const caption = (text, re) => {
  const m = text.replace(/\s+/g, ' ').match(new RegExp(`Figure\\s+(\\d+-\\d+)\\s*\\.?\\s*(${re.source})`, 'i'))
  return m ? `Figure ${m[1]}, ${m[2].replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w+/g, w => w.toLowerCase())}` : null
}

// Pure: every page's text (index 0 = page 1) and the page map → the tables found.
// Older books (Cessna before 1976, many Pipers) print speeds in MPH and distances
// in statute miles. Each table's own header says which: knots when it names
// KIAS/KTAS/KCAS/KNOTS, MPH when it names only MPH; null when it names neither.
const MPH_PER_KT = 1.15078
export function speedUnit(text) {
  const t = String(text).toUpperCase()
  if (/\bK(?:IAS|TAS|CAS|NOTS)\b|\bKTS\b/.test(t)) return 'kt'
  if (/\bMPH\b|\bM\.P\.H\.?/.test(t)) return 'mph'
  return null
}
const kt = v => (v == null ? v : Math.round(v / MPH_PER_KT))
const nm = v => (v == null ? v : Math.round((v / MPH_PER_KT) * 10) / 10)
export function toKnots(t, units) {
  const out = { ...t }
  if (units.takeoff === 'mph' && t.takeoff) out.takeoff = t.takeoff.map(x => ({ ...x, speeds: Object.fromEntries(Object.entries(x.speeds).map(([k, v]) => [k, kt(v)])) }))
  if (units.landing === 'mph' && t.landing) out.landing = t.landing.map(x => ({ ...x, speeds: Object.fromEntries(Object.entries(x.speeds).map(([k, v]) => [k, kt(v)])) }))
  if (units.climb === 'mph' && t.climb) out.climb = t.climb.map(x => ({ ...x, kias: kt(x.kias), nm: nm(x.nm) }))
  if (units.cruise === 'mph' && t.cruise) out.cruise = t.cruise.map(x => ({ ...x, cols: x.cols.map(c => (c ? [c[0], kt(c[1]), c[2]] : c)) }))
  return out
}

export function tablesFromText(pages, pageMap = {}) {
  const at = (key, heading) => {
    const p = pageMap[key]
    if (!p) return []
    // The mapped page and the sheets that follow it with the same heading.
    const out = [pages[p - 1] ?? '']
    for (let q = p; q < Math.min(pages.length, p + 3) && heading.test(pages[q] ?? ''); q++) out.push(pages[q])
    return out
  }
  const tk = at('takeoff', /TAKEOFF\s+DISTANCE/i), ld = at('landing', /LANDING\s+DISTANCE/i)
  const cl = at('climb', /CLIMB/i), cr = at('cruise', /CRUISE\s+PERFORMANCE/i)
  const takeoff = distanceTables(tk, { speeds: 2 })
  const landing = distanceTables(ld, { speeds: 1 })
  const climb = climbTable(cl)
  const cruise = cruiseTable(cr)
  const fuel = cl.join(' ').replace(/\s+/g, ' ').match(/add (\d+(?:\.\d)?) gal\w* of fuel for engine start/i)
  const pick = list => list.map(({ dropped, ...t }) => t) // eslint-disable-line no-unused-vars
  const units = { takeoff: tk.length ? speedUnit(tk.join('\n')) : null, landing: ld.length ? speedUnit(ld.join('\n')) : null, climb: cl.length ? speedUnit(cl.join('\n')) : null, cruise: cr.length ? speedUnit(cr.join('\n')) : null }
  return toKnots({
    v: TABLES_VERSION,
    takeoff: takeoff.length ? pick(takeoff) : null,
    landing: landing.length ? pick(landing) : null,
    climb: climb?.rows ?? null,
    cruise: cruise?.rows ?? null,
    climbStartFuelGal: fuel ? Number(fuel[1]) : null,
    takeoffNotes: tk.length ? corrections(tk.join('\n')) : null,
    landingNotes: ld.length ? corrections(ld.join('\n')) : null,
    figures: {
      takeoff: tk.length ? caption(tk.join('\n'), /Takeoff Distance/) : null,
      landing: ld.length ? caption(ld.join('\n'), /Landing Distance/) : null,
      climb: cl.length ? caption(cl.join('\n'), /Time,? Fuel,? and Distance to Climb/) : null,
      cruise: cr.length ? caption(cr.join('\n'), /Cruise Performance/) : null,
    },
    dropped: {
      takeoff: takeoff.reduce((s, t) => s + t.dropped, 0), landing: landing.reduce((s, t) => s + t.dropped, 0),
      climb: climb?.dropped ?? 0, cruise: cruise?.dropped ?? 0,
    },
    units,
  }, units)
}

// From the PDF: text-layer books only (a scan without one gets { v, none: true }).
export async function pohTables(bytes, pageMap) {
  const pages = await pdfPages(bytes)
  if (!pages) return { v: TABLES_VERSION, none: 'no text layer' }
  return tablesFromText(pages, pageMap ?? {})
}

// A stored POH's tables, read once per parser version and saved with it.
export async function ensureTables(doc, log) {
  if (!doc?.id) return null
  const { rows: [r] } = await pool.query('SELECT tables, page_map FROM planner_documents WHERE id = $1', [doc.id])
  if (r?.tables?.v === TABLES_VERSION) return r.tables
  const { rows: [b] } = await pool.query('SELECT bytes FROM planner_documents WHERE id = $1', [doc.id])
  const t = await pohTables(b.bytes, r?.page_map ?? doc.page_map)
  await pool.query('UPDATE planner_documents SET tables = $2 WHERE id = $1', [doc.id, JSON.stringify(t)])
  log?.info({ id: doc.id, takeoff: t.takeoff?.length ?? 0, landing: t.landing?.length ?? 0, climb: t.climb?.length ?? 0, cruise: t.cruise?.length ?? 0, none: t.none }, 'POH tables read')
  return t
}

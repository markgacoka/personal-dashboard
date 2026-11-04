// Route tokens the way SkyVector and ForeFlight accept them, resolved against
// FAA NASR: airports (KRHV, RHV, E16), navaids (SJC, OSI), fixes and VFR
// waypoints (VPCOY), navaid radial/distance (SJC090020, SJC/090/20) and GPS
// coordinates (3720N12150W, 372030N1215015W, 37.34/-121.83, 37.34,-121.83,
// N37.34/W121.83). A trailing "*" marks an airport that is flown over.
import { pool } from '../db/client.js'

const R_NM = 3440.065
const rad = d => (d * Math.PI) / 180
const deg = r => (r * 180) / Math.PI

// Destination point from a start, true bearing and distance (great circle).
export function project(p, brgTrue, distNm) {
  const d = distNm / R_NM, b = rad(brgTrue), la = rad(p.lat), lo = rad(p.lon)
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b))
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2))
  return { lat: deg(la2), lon: ((deg(lo2) + 540) % 360) - 180 }
}

const dms = (d, m = 0, s = 0) => Number(d) + Number(m) / 60 + Number(s) / 3600

// Coordinates only; returns {lat, lon} or null.
export function parseCoord(raw) {
  const t = String(raw).trim().toUpperCase()
  let m = t.match(/^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)?([NS])(\d{3})(\d{2})(\d{2}(?:\.\d+)?)?([EW])$/)
  if (m) {
    const lat = dms(m[1], m[2], m[3] || 0) * (m[4] === 'S' ? -1 : 1)
    const lon = dms(m[5], m[6], m[7] || 0) * (m[8] === 'W' ? -1 : 1)
    return valid(lat, lon)
  }
  m = t.match(/^(\d{2})([NS])(\d{3})([EW])$/)
  if (m) return valid(+m[1] * (m[2] === 'S' ? -1 : 1), +m[3] * (m[4] === 'W' ? -1 : 1))
  m = t.match(/^([NS])?(-?\d{1,2}(?:\.\d+)?)[/,]([EW])?(-?\d{1,3}(?:\.\d+)?)$/)
  if (m) {
    const lat = Number(m[2]) * (m[1] === 'S' ? -1 : 1), lon = Number(m[4]) * (m[3] === 'W' ? -1 : 1)
    return valid(lat, lon)
  }
  return null
}
const valid = (lat, lon) => (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 } : null)

// Token → what to look up. Pure.
export function classify(raw) {
  const overfly = /\*$/.test(raw)
  const t = String(raw).trim().toUpperCase().replace(/\*$/, '')
  const c = parseCoord(t)
  if (c) return { token: t, overfly, kind: 'gps', ...c }
  let m = t.match(/^([A-Z]{2,3})(\d{3})(\d{3})$/) || t.match(/^([A-Z]{2,3})\/(\d{1,3})\/(\d{1,3}(?:\.\d+)?)$/)
  if (m) return { token: t, overfly, kind: 'radial', navaid: m[1], radial: Number(m[2]) % 360, dist: Number(m[3]) }
  if (/^[A-Z0-9]{3,4}$/.test(t) && /\d/.test(t)) return { token: t, overfly, kind: 'airport' }
  if (/^[A-Z]{4}$/.test(t)) return { token: t, overfly, kind: 'airport' }
  if (/^[A-Z]{3}$/.test(t)) return { token: t, overfly, kind: 'navaid-or-airport' }
  if (/^[A-Z]{2}$/.test(t)) return { token: t, overfly, kind: 'navaid' }
  if (/^[A-Z0-9]{5}$/.test(t)) return { token: t, overfly, kind: 'fix' }
  return { token: t, overfly, kind: 'unknown' }
}

const near = (list, ref) => (ref ? [...list].sort((a, b) => dist2(a, ref) - dist2(b, ref))[0] : list[0])
const dist2 = (a, b) => (a.lat - b.lat) ** 2 + ((a.lon - b.lon) * Math.cos(rad((a.lat + b.lat) / 2))) ** 2

async function magVarNear(p) {
  const { rows } = await pool.query(
    `SELECT (data->>'magVar')::real AS v FROM nasr_airports WHERE lat BETWEEN $1::float8 - 1 AND $1::float8 + 1 AND lon BETWEEN $2::float8 - 1.5 AND $2::float8 + 1.5
      ORDER BY (lat - $1::float8) ^ 2 + ((lon - $2::float8) * cos(radians($1::float8))) ^ 2 LIMIT 1`, [p.lat, p.lon])
  return rows[0]?.v ?? null
}

// Resolve every token; ambiguous idents take the match nearest the previous point.
export async function resolveRoute(tokens) {
  const cls = tokens.slice(0, 30).map(classify)
  const ids = [...new Set(cls.flatMap(c => [c.token, c.navaid, c.token.replace(/^K(?=[A-Z]{3}$)/, '')]).filter(Boolean))]
  const [{ rows: apts }, { rows: pts }] = await Promise.all([
    pool.query('SELECT id, icao, name, lat, lon, (data->>\'magVar\')::real AS mag_var, (data->>\'elev\')::real AS elev FROM nasr_airports WHERE id = ANY($1) OR icao = ANY($1)', [ids]),
    pool.query('SELECT id, type, name, state, lat, lon, elev, mag_var, freq, vfr FROM nasr_points WHERE id = ANY($1)', [ids]),
  ])
  const out = []
  let prev = null
  for (const c of cls) {
    const t = c.token
    const airport = () => apts.find(a => a.icao === t) || apts.find(a => a.id === t) || (t.length === 4 && t[0] === 'K' ? apts.find(a => a.id === t.slice(1) && !a.icao) : null)
    const navaids = id => pts.filter(p => p.id === id && p.type !== 'FIX' && p.type !== 'VFR-WP')
    let r = null
    if (c.kind === 'gps') r = { kind: 'gps', id: t, label: t, name: 'GPS coordinate', lat: c.lat, lon: c.lon, magVar: null, freq: null, type: 'GPS' }
    else if (c.kind === 'airport') { const a = airport(); if (a) r = { kind: 'airport', id: a.id, label: a.icao || a.id, name: a.name, lat: a.lat, lon: a.lon, magVar: a.mag_var, elev: a.elev, freq: null, type: 'Airport' } }
    else if (c.kind === 'navaid-or-airport' || c.kind === 'navaid') {
      const n = near(navaids(t), prev)
      const a = c.kind === 'navaid-or-airport' ? airport() : null
      // A bare 3-letter ident is the navaid (SkyVector's reading) unless only an airport has it.
      if (n) r = { kind: 'navaid', id: t, label: t, name: n.name, lat: n.lat, lon: n.lon, magVar: n.mag_var, elev: n.elev, freq: n.freq, type: n.type }
      else if (a) r = { kind: 'airport', id: a.id, label: a.icao || a.id, name: a.name, lat: a.lat, lon: a.lon, magVar: a.mag_var, elev: a.elev, freq: null, type: 'Airport' }
    } else if (c.kind === 'fix') {
      const f = near(pts.filter(p => p.id === t), prev)
      if (f) r = { kind: f.vfr ? 'vfr' : 'fix', id: t, label: t, name: f.vfr ? 'VFR waypoint' : 'Fix', lat: f.lat, lon: f.lon, magVar: f.mag_var, freq: null, type: f.type }
    } else if (c.kind === 'radial') {
      const n = near(navaids(c.navaid), prev)
      if (n) {
        // Radials are magnetic, from the navaid's own published variation.
        const mv = n.mag_var ?? (await magVarNear(n)) ?? 0
        const p = project(n, (c.radial + mv + 360) % 360, c.dist)
        r = { kind: 'radial', id: t, label: t, name: `${c.navaid} ${String(c.radial).padStart(3, '0')}° radial, ${c.dist} nm`, lat: p.lat, lon: p.lon, magVar: mv, freq: n.freq, type: 'Radial/DME' }
      }
    }
    if (r) {
      if (r.magVar == null) r.magVar = await magVarNear(r)
      prev = r
    }
    out.push(r ? { token: c.overfly ? `${t}*` : t, overfly: c.overfly, ...r } : { token: t, overfly: c.overfly, kind: 'unknown', id: t, label: t, error: `Not found in FAA NASR: ${t}` })
  }
  return out
}

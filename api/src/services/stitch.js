// Stitch one flight track out of every source that saw the aircraft, and
// describe what happened on it (departures, landings, time on the ground,
// coverage gaps).
//
// Sources disagree in density, fields and quality, so stitching goes:
//   1. drop each source's impossible points (position or altitude jumps),
//   2. merge on a shared timeline: where two points fall within 3 s, keep the
//      one from the better source (an owner-uploaded GPS log, then readsb
//      networks, which carry ground speed, vertical rate and ground state, then
//      OpenSky),
//   3. fill ground speed, track and vertical speed from neighbouring positions
//      where the chosen source didn't report them.
// Nothing is interpolated: gaps stay gaps and are reported as such.

export const SOURCE_RANK = { upload: 0, foreflight_csv: 0, adsblol: 1, adsbexchange: 2, airplaneslive: 3, adsbfi: 4, theairtraffic: 5, opensky: 6 }
export const SOURCE_NAME = {
  upload: 'Your GPS log', foreflight_csv: 'ForeFlight', adsblol: 'adsb.lol', adsbexchange: 'ADS-B Exchange',
  airplaneslive: 'airplanes.live', adsbfi: 'adsb.fi', theairtraffic: 'theairtraffic', opensky: 'OpenSky',
}

const R_NM = 3440.065
export function nm(a, b) {
  const toR = Math.PI / 180
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2
  return R_NM * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}
function bearing(a, b) {
  const toR = Math.PI / 180
  const y = Math.sin((b.lon - a.lon) * toR) * Math.cos(b.lat * toR)
  const x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) - Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos((b.lon - a.lon) * toR)
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)
}

// Points a light aircraft can't produce relative to the previous good point:
// faster than 300 kt over the ground, or climbing/descending over 6,000 fpm.
export function dropOutliers(points) {
  const out = []
  for (const p of points) {
    const prev = out.at(-1)
    if (prev) {
      const dt = (Date.parse(p.ts) - Date.parse(prev.ts)) / 1000
      if (dt > 0 && dt < 600) {
        const kt = (nm(prev, p) / dt) * 3600
        const fpm = p.altitude_ft != null && prev.altitude_ft != null ? Math.abs(p.altitude_ft - prev.altitude_ft) / dt * 60 : 0
        if (kt > 300 || fpm > 6000) continue
      }
    }
    out.push(p)
  }
  return out
}

export function mergeTracks(...lists) {
  const all = lists.flat().filter(p => p?.ts && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map(p => ({ ...p, t: Date.parse(p.ts) }))
    .sort((a, b) => (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9) || a.t - b.t)
  const kept = []
  const taken = new Set()
  for (const p of all) {
    const key = Math.round(p.t / 3000)
    if (taken.has(key) || taken.has(key - 1) || taken.has(key + 1)) continue
    taken.add(key)
    kept.push(p)
  }
  return kept.sort((a, b) => a.t - b.t).map(({ t, ...p }) => p)
}

// Ground speed, track and vertical speed from the neighbouring points, where
// the source left them out (OpenSky track rows carry neither speed nor rate).
export function fillDerived(points) {
  return points.map((p, i) => {
    const a = points[i - 1], b = points[i + 1]
    const pair = a && b ? [a, b] : a ? [a, p] : b ? [p, b] : null
    if (!pair) return p
    const dt = (Date.parse(pair[1].ts) - Date.parse(pair[0].ts)) / 1000
    if (!(dt > 0 && dt <= 120)) return p
    const out = { ...p }
    if (out.groundspeed_kts == null) out.groundspeed_kts = Math.round((nm(pair[0], pair[1]) / dt) * 3600)
    if (out.track_deg == null && nm(pair[0], pair[1]) > 0.01) out.track_deg = bearing(pair[0], pair[1])
    if (out.vertical_speed_fpm == null && pair[0].altitude_ft != null && pair[1].altitude_ft != null) {
      out.vertical_speed_fpm = Math.round(((pair[1].altitude_ft - pair[0].altitude_ft) / dt) * 60)
    }
    return out
  })
}

// The full stitch: clean each source, merge, derive missing fields.
export function stitch(bySource) {
  const cleaned = Object.values(bySource).map(list =>
    dropOutliers([...list].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))))
  return fillDerived(mergeTracks(...cleaned))
}

// ── What happened ───────────────────────────────────────────────────────────
export function nearestAirport(p, airports) {
  let best = null
  for (const a of airports) {
    if (a.lat == null || a.lon == null) continue
    const d = nm(p, a)
    if (!best || d < best.nm) best = { ...a, nm: d }
  }
  return best
}

// Stops (unbroken runs of low, slow points close to one airport), the route
// they imply, and whether the track starts and ends on the ground.
export function analyzeTrack(points, airports) {
  const pts = points.filter(p => p.lat != null && p.lon != null)
  if (!pts.length) return null
  const stops = []
  let open = false
  for (const p of pts) {
    const apt = nearestAirport(p, airports)
    const near = apt && apt.nm <= 2.5
    const elev = apt?.elevation_ft ?? 0
    const low = p.on_ground || (p.altitude_ft != null && p.altitude_ft - elev < 700 && (p.groundspeed_kts == null || p.groundspeed_kts < 80))
    if (!(near && low)) { open = false; continue }
    const t = Date.parse(p.ts)
    const last = stops.at(-1)
    if (open && last.icao === apt.icao) { last.end = t; last.ground ||= !!p.on_ground; last.minAgl = Math.min(last.minAgl, p.on_ground ? 0 : p.altitude_ft - elev) }
    else stops.push({ icao: apt.icao, name: apt.name, lat: apt.lat, lon: apt.lon, start: t, end: t, ground: !!p.on_ground, minAgl: p.on_ground ? 0 : p.altitude_ft - elev })
    open = true
  }
  const t0 = Date.parse(pts[0].ts), t1 = Date.parse(pts.at(-1).ts)
  const startsAtAirport = !!stops[0] && stops[0].start - t0 < 5 * 60_000
  const endsAtAirport = !!stops.length && t1 - stops.at(-1).end < 5 * 60_000 && stops.at(-1).start > t0 + 10 * 60_000
  const moving = pts.filter(p => p.groundspeed_kts == null || p.groundspeed_kts > 5)
  let distance = 0
  for (let i = 1; i < pts.length; i++) if (!pts[i].on_ground) distance += nm(pts[i - 1], pts[i])
  const farthest = startsAtAirport ? Math.max(...pts.map(p => nm(stops[0], p))) : 0
  return {
    stops,
    departure: startsAtAirport ? stops[0].icao : null,
    arrival: endsAtAirport ? stops.at(-1).icao : null,
    via: stops.slice(startsAtAirport ? 1 : 0, endsAtAirport ? -1 : undefined).map(s => s.icao),
    landings: stops.length - (startsAtAirport ? 1 : 0),
    complete: startsAtAirport && endsAtAirport,
    firstMove: Date.parse((moving[0] || pts[0]).ts),
    lastMove: Date.parse((moving.at(-1) || pts.at(-1)).ts),
    distance_nm: Math.round(distance),
    farthest_nm: Math.round(farthest),
  }
}

// A readable account of the flight for the flight page.
export function summarize(points, airports) {
  const a = analyzeTrack(points, airports)
  const sources = {}
  for (const p of points) sources[p.source || 'opensky'] = (sources[p.source || 'opensky'] || 0) + 1
  const gaps = []
  for (let i = 1; i < points.length; i++) {
    const dt = (Date.parse(points[i].ts) - Date.parse(points[i - 1].ts)) / 1000
    if (dt >= 120) gaps.push({ from: points[i - 1].ts, to: points[i].ts, seconds: Math.round(dt), near: nearestAirport(points[i - 1], airports)?.icao || null })
  }
  const events = (a?.stops || []).map((s, i) => {
    const first = i === 0 && a.departure, last = i === a.stops.length - 1 && a.arrival
    const minutes = Math.round((s.end - s.start) / 60_000)
    const kind = first ? 'departure' : last ? 'landing'
      : s.ground ? (minutes >= 3 ? 'full stop' : 'touch-and-go') : s.minAgl < 300 ? 'touch-and-go' : 'low approach'
    return { icao: s.icao, name: s.name, kind, from: new Date(s.start).toISOString(), to: new Date(s.end).toISOString(), minutes, seen_on_ground: s.ground }
  })
  return {
    sources: Object.entries(sources).map(([k, n]) => ({ source: k, name: SOURCE_NAME[k] || k, points: n })).sort((x, y) => y.points - x.points),
    first: points[0]?.ts || null, last: points.at(-1)?.ts || null,
    complete: !!a?.complete, events, gaps,
    distance_nm: a?.distance_nm ?? null,
    airborne_minutes: a ? Math.round((a.lastMove - a.firstMove) / 60_000) : null,
  }
}

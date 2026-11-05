// Route text ⇄ plan.route. One flight, one navlog: plan.route is the departure
// airport, the points flown over (navaids, fixes, VFR waypoints, airports,
// coordinates), and the arrival airport. Text is SkyVector/ForeFlight style.
import type { LatLon } from './calc'
import { distanceNm } from './calc'

export const tokenize = (text: string) =>
  text.toUpperCase().replace(/\bDCT\b/g, ' ').split(/[\s>]+/).map(t => t.trim().replace(/\*$/, '')).filter(Boolean)

export const routeToText = (route: string[]) => route.map(clean).join(' ')
export const clean = (t: string) => t.replace(/\*$/, '')

export function splitRoute(route: string[]) {
  const r = route.map(clean)
  return { dep: r[0] ?? '', via: r.length > 2 ? r.slice(1, -1) : [], arr: r.length > 1 ? r[r.length - 1] : '' }
}

// No arrival yet → just the departure (the points need both ends to make a leg).
export function joinRoute(dep: string, via: string[], arr: string) {
  const d = clean(dep.trim().toUpperCase())
  if (!d) return []
  return arr.trim() ? [d, ...via.map(clean), clean(arr.trim().toUpperCase())] : [d]
}

// A coordinate token the resolver reads back exactly: "37.12345/-121.54321".
export const coordToken = (p: LatLon) => `${p.lat.toFixed(5)}/${p.lon.toFixed(5)}`

// Where a new point adds the least distance: between which two route points.
export function bestInsert(pts: LatLon[], p: LatLon) {
  let best = 1, extra = Infinity
  for (let i = 1; i < pts.length; i++) {
    const e = distanceNm(pts[i - 1], p) + distanceNm(p, pts[i]) - distanceNm(pts[i - 1], pts[i])
    if (e < extra) { extra = e; best = i }
  }
  return best
}

export const insertAt = (route: string[], i: number, token: string) => [...route.slice(0, i), token, ...route.slice(i)]
export const removeAt = (route: string[], i: number) => route.filter((_, k) => k !== i)
export const replaceAt = (route: string[], i: number, token: string) => route.map((t, k) => (k === i ? token : t))

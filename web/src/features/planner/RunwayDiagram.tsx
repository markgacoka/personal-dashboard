import { useId } from 'react'
import { cn } from '@/lib/utils'
import { windComponents } from './calc'
import type { Airport, NasrRunway, NasrRunwayEnd } from './model'
import { deg3 } from './ui'

// The airport's runways drawn to scale and true north up, from the runway-end
// coordinates in FAA NASR (the Chart Supplement's data), with the wind blowing
// across them, the runway to use highlighted with its direction of travel, and
// its traffic pattern on the published side. Runways without end coordinates
// are drawn on their heading through the field's center.

export interface RunwayWind { dir: number | null; spd: number; gust?: number | null }
const FT_PER_DEG = 60 * 6076.12

interface Seg { r: NasrRunway; a: NasrRunwayEnd; b: NasrRunwayEnd; p: [number, number]; q: [number, number] }

function segments(apt: Airport): Seg[] {
  const ends = apt.runways.flatMap(r => r.ends).filter(e => e.lat != null && e.lon != null)
  const lat0 = ends.length ? ends.reduce((s, e) => s + e.lat!, 0) / ends.length : apt.lat
  const lon0 = ends.length ? ends.reduce((s, e) => s + e.lon!, 0) / ends.length : apt.lon
  const k = Math.cos((lat0 * Math.PI) / 180)
  const xy = (e: NasrRunwayEnd): [number, number] => [(e.lon! - lon0) * k * FT_PER_DEG, -(e.lat! - lat0) * FT_PER_DEG]
  const out: Seg[] = []
  let offset = 0
  for (const r of apt.runways) {
    const [a, b] = r.ends
    if (!a) continue
    if (b && a.lat != null && b.lat != null && a.lon != null && b.lon != null) { out.push({ r, a, b, p: xy(a), q: xy(b) }); continue }
    // No surveyed ends: lay it on its heading, beside any others without coordinates.
    const hdg = a.trueHdg ?? (Number.parseInt(a.id, 10) || 36) * 10
    const t = (hdg * Math.PI) / 180, u: [number, number] = [Math.sin(t), -Math.cos(t)], n: [number, number] = [-u[1], u[0]]
    const c: [number, number] = [n[0] * offset, n[1] * offset]
    offset += 900
    out.push({ r, a, b: b ?? a, p: [c[0] - (u[0] * r.len) / 2, c[1] - (u[1] * r.len) / 2], q: [c[0] + (u[0] * r.len) / 2, c[1] + (u[1] * r.len) / 2] })
  }
  return out
}

export function RunwayDiagram({ airport, wind, active, compact, className }: {
  airport: Airport; wind: RunwayWind | null; active: string[]; compact?: boolean; className?: string
}) {
  const uid = useId().replace(/:/g, '')
  const segs = segments(airport)
  if (!segs.length) return <div className={cn('grid aspect-square place-items-center rounded-lg text-[13px] text-fg-3 ring-1 ring-inset ring-border', className)}>No runway data</div>
  const S = compact ? 220 : 320
  // The pattern for the runway in use, in feet like the runways, so the fit includes it.
  const patterns = segs.flatMap(s => {
    const end = active.includes(s.a.id) ? s.a : active.includes(s.b.id) ? s.b : null
    if (!end || s.a === s.b) return []
    const t = end === s.a ? s.p : s.q, f = end === s.a ? s.q : s.p
    const len = Math.hypot(f[0] - t[0], f[1] - t[1]) || 1, ux = (f[0] - t[0]) / len, uy = (f[1] - t[1]) / len
    const side = end.right ? 1 : -1, nx = -uy * side, ny = ux * side
    const D = Math.max(len * 0.5, 2200), e = Math.max(len * 0.22, 900)
    const pts: [number, number][] = [f, [f[0] + ux * e, f[1] + uy * e], [f[0] + ux * e + nx * D, f[1] + uy * e + ny * D], [t[0] - ux * e + nx * D, t[1] - uy * e + ny * D], [t[0] - ux * e, t[1] - uy * e], t]
    return [{ id: s.r.id, pts, t, u: [ux, uy] as [number, number], len }]
  })
  const all = [...segs.flatMap(s => [s.p, s.q]), ...patterns.flatMap(p => p.pts)]
  const xs = all.map(v => v[0]), ys = all.map(v => v[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const span = Math.max(maxX - minX, maxY - minY, 2500)
  const pad = S * (compact ? 0.1 : 0.12)
  const sc = (S - 2 * pad) / span
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const P = (v: [number, number]): [number, number] => [S / 2 + (v[0] - cx) * sc, S / 2 + (v[1] - cy) * sc]
  const windTo = wind?.dir != null && wind.spd > 0 ? (wind.dir + 180) % 360 : null
  const fmt = (n: number) => Math.round(n * 10) / 10
  const streaks = Array.from({ length: compact ? 7 : 10 }, (_, i) => i)

  return (
    <svg viewBox={`0 0 ${S} ${S}`} className={cn('block h-auto w-full select-none', className)} role="img"
      aria-label={`${airport.icao || airport.id} runways${active.length ? `, runway ${active.join(' and ')} in use` : ''}${wind?.dir != null && wind.spd ? `, wind ${deg3(wind.dir)} at ${wind.spd} knots` : ''}`}>
      <defs>
        <marker id={`ah${uid}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" /></marker>
        <marker id={`wh${uid}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 1 L9 5 L0 9 z" fill="var(--fg-2)" /></marker>
        <clipPath id={`cl${uid}`}><rect width={S} height={S} rx="10" /></clipPath>
      </defs>
      <g clipPath={`url(#cl${uid})`}>
        {/* Wind: streaks drifting the way the air moves. */}
        {windTo != null && (
          <g transform={`rotate(${windTo - 90} ${S / 2} ${S / 2})`} className="text-fg-3" aria-hidden>
            {streaks.map(i => {
              const y = (S * 1.4 * (i + 0.5)) / streaks.length - S * 0.2
              const x = ((i * 53) % S) - S * 0.1
              return <line key={i} x1={x} y1={y} x2={x + S * 0.16} y2={y} stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.25" strokeLinecap="round"
                className="rwy-wind" style={{ animationDelay: `${(i * 0.37) % 2.4}s`, animationDuration: `${Math.max(1.6, 4.2 - Math.min(wind!.spd, 25) / 10)}s` }} />
            })}
          </g>
        )}

        {/* Runways, to scale; the one in use in the accent colour. */}
        {segs.map((s, i) => {
          const [x1, y1] = P(s.p), [x2, y2] = P(s.q)
          const len = Math.hypot(x2 - x1, y2 - y1)
          const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
          const w = Math.max((s.r.wid ?? 75) * sc, compact ? 5 : 6)
          const on = active.includes(s.a.id) || active.includes(s.b.id)
          return (
            <g key={s.r.id} transform={`translate(${fmt((x1 + x2) / 2)} ${fmt((y1 + y2) / 2)}) rotate(${fmt(ang)})`}>
              <rect x={-len / 2} y={-w / 2} width={len} height={w} rx="1.5" fill={on ? 'var(--accent)' : 'var(--fg-3)'} fillOpacity={on ? 0.95 : 0.55}
                className="rwy-grow" style={{ animationDelay: `${i * 90}ms` }} />
              {!compact && w >= 7 && <line x1={-len / 2 + 6} x2={len / 2 - 6} y1="0" y2="0" stroke="var(--card)" strokeOpacity="0.8" strokeWidth="0.8" strokeDasharray="5 4" className="rwy-grow" style={{ animationDelay: `${i * 90}ms` }} />}
              {!compact && (() => {
                const flip = Math.abs(ang) > 90
                const x = (flip ? 1 : -1) * len * 0.28
                return <text x={x} y={-w / 2 - 4} transform={flip ? 'rotate(180)' : undefined} textAnchor="middle" className="num" fontSize="9.5" fill="var(--fg-3)">{s.r.len.toLocaleString()}′</text>
              })()}
            </g>
          )
        })}

        {/* Runway numbers just beyond each threshold. */}
        {segs.flatMap(s => {
          const [x1, y1] = P(s.p), [x2, y2] = P(s.q)
          const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len
          const d = compact ? 11 : 13
          return [[s.a, x1 - ux * d, y1 - uy * d], [s.b, x2 + ux * d, y2 + uy * d]].filter(([e], k) => k === 0 || e !== s.a).map(([e, x, y]) => {
            const end = e as NasrRunwayEnd, on = active.includes(end.id)
            return <text key={`${s.r.id}-${end.id}`} x={fmt(x as number)} y={fmt(y as number)} textAnchor="middle" dominantBaseline="central" className="num"
              fontSize={compact ? 10 : 11.5} fontWeight={on ? 700 : 500} fill={on ? 'var(--accent)' : 'var(--fg-2)'}>{end.id}</text>
          })
        })}

        {/* The runway in use: direction of travel and the pattern on its side. */}
        {patterns.map(pt => {
          const path = pt.pts.map((v, i) => { const [x, y] = P(v); return `${i ? 'L' : 'M'}${fmt(x)} ${fmt(y)}` }).join(' ')
          const [tx, ty] = P(pt.t), L = pt.len * sc
          const a1 = [tx + pt.u[0] * L * 0.2, ty + pt.u[1] * L * 0.2], a2 = [tx + pt.u[0] * L * 0.75, ty + pt.u[1] * L * 0.75]
          return (
            <g key={`pat-${pt.id}`}>
              <path d={path} fill="none" stroke="var(--accent)" strokeOpacity="0.7" strokeWidth="1.25" strokeDasharray="4 4" strokeLinejoin="round" className="rwy-pattern" />
              <line x1={fmt(a1[0])} y1={fmt(a1[1])} x2={fmt(a2[0])} y2={fmt(a2[1])} stroke="var(--card)" strokeWidth="1.6" markerEnd={`url(#ah${uid})`} />
            </g>
          )
        })}
      </g>

      {/* North and the wind, in the corners. */}
      <g transform={`translate(${S - 20} 20)`} aria-hidden>
        <circle r="12" fill="var(--card)" stroke="var(--border)" />
        <path d="M0 -8 L3.5 3 L0 1 L-3.5 3 z" fill="var(--fg-2)" />
        <text y="-15" textAnchor="middle" fontSize="8.5" fill="var(--fg-3)" fontWeight="600">N</text>
      </g>
      {!compact && (
        <g transform="translate(26 26)" aria-hidden>
          <circle r="17" fill="var(--card)" stroke="var(--border)" />
          {windTo != null
            ? <line x1={-11 * Math.sin((windTo * Math.PI) / 180)} y1={11 * Math.cos((windTo * Math.PI) / 180)} x2={9 * Math.sin((windTo * Math.PI) / 180)} y2={-9 * Math.cos((windTo * Math.PI) / 180)} stroke="var(--fg-2)" strokeWidth="2" markerEnd={`url(#wh${uid})`} />
            : <text textAnchor="middle" dominantBaseline="central" fontSize="8" fill="var(--fg-3)">{wind?.spd ? 'VRB' : 'CALM'}</text>}
        </g>
      )}
    </svg>
  )
}

// What the diagram says, in words and numbers: the wind and its components on the runway in use.
export function RunwayFacts({ airport, wind, end, compact }: { airport: Airport; wind: RunwayWind | null; end: NasrRunwayEnd | null; compact?: boolean }) {
  const c = end?.trueHdg != null && wind ? windComponents(wind.dir, wind.gust ?? wind.spd, end.trueHdg) : null
  const rw = end ? airport.runways.find(r => r.ends.includes(end)) : null
  return (
    <dl className={cn('num grid grid-cols-2 gap-x-4 gap-y-1.5', compact ? 'text-[13px]' : 'text-sm')}>
      <div className="min-w-0"><dt className="text-[12px] text-fg-3">Wind</dt><dd className="text-fg">{!wind ? '—' : !wind.spd ? 'Calm' : wind.dir == null ? `VRB ${wind.spd} kt` : `${deg3(wind.dir)}° ${wind.spd}${wind.gust ? `G${wind.gust}` : ''} kt`}</dd></div>
      <div className="min-w-0"><dt className="text-[12px] text-fg-3">Runway</dt><dd className="truncate text-fg">{end ? <>{end.id}{!compact && <span className="text-fg-3"> · {end.right ? 'right' : 'left'} pattern</span>}</> : '—'}</dd></div>
      <div className="min-w-0"><dt className="text-[12px] text-fg-3">{c && c.head < 0 ? 'Tailwind' : 'Headwind'}</dt><dd className={cn(c && c.head < 0 ? 'text-warn' : 'text-fg')}>{c ? `${Math.abs(c.head)} kt` : '—'}</dd></div>
      <div className="min-w-0"><dt className="text-[12px] text-fg-3">Crosswind</dt><dd className="text-fg">{c ? <>{Math.abs(c.cross)} kt<span className="text-fg-3">{c.cross > 0 ? ' from right' : c.cross < 0 ? ' from left' : ''}</span></> : '—'}</dd></div>
      {!compact && rw && <div className="col-span-2 min-w-0"><dt className="text-[12px] text-fg-3">Length · width · surface</dt><dd className="text-fg">{rw.len.toLocaleString()} × {rw.wid ?? '—'} ft{rw.surface ? <span className="text-fg-3"> · {rw.surface}</span> : ''}{end?.displaced ? <span className="text-fg-3"> · threshold displaced {end.displaced} ft</span> : ''}</dd></div>}
    </dl>
  )
}

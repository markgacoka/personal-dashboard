import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Airport } from './airports'
import { circuit, findEnd, fmtHdg, legPoint, NM_FT, runwayEnds, sampleAt, smooth, type Pt, type Sample, type Wind } from './geo'
import { atPoint, trafficTrack, type TrafficDef, type Zone } from './model'

export type CandState = 'idle' | 'hover' | 'picked' | 'right' | 'wrong' | 'dim'
export interface Candidate { id: string; letter: string; track: Sample[]; state: CandState }
export interface Box { x: number; y: number; w: number; h: number }
export interface RunwayPick { state: Record<string, CandState>; onPick: (ident: string) => void; onHover?: (ident: string | null) => void }

const CAND_COLOR: Record<CandState, string> = { idle: 'var(--c1)', hover: 'var(--accent)', picked: 'var(--accent)', right: 'var(--good)', wrong: 'var(--bad)', dim: 'var(--fg-3)' }
const xy = (p: Pt) => `${p[0].toFixed(4)},${(-p[1]).toFixed(4)}`
const line = (pts: Pt[]) => pts.map(xy).join(' ')
const PLANE = 'M0,-11 L1.7,-7 L1.7,-2.5 L11,0.8 L11,3 L1.7,1.8 L1.2,7 L4.6,9.4 L4.6,11 L0,10 L-4.6,11 L-4.6,9.4 L-1.2,7 L-1.7,1.8 L-11,3 L-11,0.8 L-1.7,-2.5 L-1.7,-7 Z'

function useFrame(active = true) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!active) return
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => { setT((now - t0) / 1000); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return t
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 800, h: 480 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(200, e.contentRect.width), h: Math.max(200, e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

function fitBox(points: Pt[], aspect: number): Box {
  const xs = points.map(p => p[0]), ys = points.map(p => -p[1])
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const pad = Math.max(x1 - x0, y1 - y0) * 0.1 + 0.4
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad
  let w = x1 - x0, h = y1 - y0
  if (w / h < aspect) { const nw = h * aspect; x0 -= (nw - w) / 2; w = nw } else { const nh = w / aspect; y0 -= (nh - h) / 2; h = nh }
  return { x: x0, y: y0, w, h }
}

export function Scene({ ap, sock, pattern, zones = [], traffic = [], own, candidates = [], focus, runwayPick, onCandidate, onHoverCandidate, className }: {
  ap: Airport
  sock: Wind
  pattern?: string
  zones?: Zone[]
  traffic?: TrafficDef[]
  own: { s: Sample; trail?: Sample[]; ahead?: Sample[]; hidden?: boolean }
  candidates?: Candidate[]
  focus: Pt[]
  runwayPick?: RunwayPick
  onCandidate?: (id: string) => void
  onHoverCandidate?: (id: string | null) => void
  className?: string
}) {
  const [ref, size] = useSize<HTMLDivElement>()
  const t = useFrame()
  const target = useMemo(() => fitBox([[-1.6, -1.6], [1.6, 1.6], ...focus], size.w / size.h), [focus, size.w, size.h])
  const box = useRef<Box>(target)
  const last = useRef(0)
  // Ease the camera toward its target once per frame.
  const dt = Math.min(0.1, Math.max(0, t - last.current)); last.current = t
  const k = 1 - Math.exp(-dt * 4)
  box.current = { x: box.current.x + (target.x - box.current.x) * k, y: box.current.y + (target.y - box.current.y) * k, w: box.current.w + (target.w - box.current.w) * k, h: box.current.h + (target.h - box.current.h) * k }
  const b = box.current
  const px = b.w / size.w

  const patternTrack = useMemo(() => {
    if (!pattern) return null
    const e = findEnd(ap.runways, pattern)
    return { e, track: smooth(circuit(e, ap.tpa, ap.elev)) }
  }, [ap, pattern])
  const trafficTracks = useMemo(() => traffic.map(tr => ({ tr, track: trafficTrack(ap, tr) })), [ap, traffic])
  const scale = [1, 2, 5, 10].find(n => n / px > 70) ?? 10

  return (
    <div ref={ref} className={cn('relative overflow-hidden rounded-lg border border-border bg-sunken', className)}>
      <svg viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} className="absolute inset-0 size-full select-none" role="img" aria-label={`Map of ${ap.icao} with runways, traffic pattern and your aircraft`}>
        <defs>
          <pattern id="tfr-hatch" width={8 * px} height={8 * px} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={8 * px} stroke="var(--bad)" strokeWidth={1.5 * px} opacity={0.35} />
          </pattern>
        </defs>

        {ap.water && <polygon points={line(ap.water)} fill="color-mix(in oklch, var(--c1) 14%, transparent)" />}
        {ap.water && <text x={ap.water[2][0] - 1.2} y={-ap.water[2][1] + 0.6} textAnchor="end" fontSize={12 * px} fill="var(--c1)" opacity={0.85} fontStyle="italic">{ap.waterLabel}</text>}
        {ap.ridges?.map(r => (
          <g key={r.label}>
            <polyline points={line(r.path)} fill="none" stroke="var(--c4)" strokeWidth={10 * px} strokeOpacity={0.18} strokeLinecap="round" />
            <text x={r.path[1][0] + 10 * px} y={-r.path[1][1]} fontSize={11 * px} fill="var(--c4)">{r.label}</text>
          </g>
        ))}

        {[1, 3, 5, 10, 20].map(r => (
          <g key={r}>
            <circle r={r} fill="none" stroke="var(--border-strong)" strokeWidth={px} strokeDasharray={`${3 * px} ${4 * px}`} />
            <text y={-r - 3 * px} textAnchor="middle" fontSize={10 * px} fill="var(--fg-3)">{r} nm</text>
          </g>
        ))}
        {ap.classD && <circle r={ap.classD} fill="none" stroke="var(--c7)" strokeWidth={1.5 * px} strokeDasharray={`${8 * px} ${5 * px}`} opacity={0.8} />}
        {ap.classD && <text x={0} y={ap.classD - 4 * px} textAnchor="middle" fontSize={10 * px} fill="var(--c7)">Class D</text>}

        {zones.map((z, i) => <ZoneMark key={i} z={z} p={atPoint(ap, z.at)} px={px} />)}

        {patternTrack && <PatternOverlay e={patternTrack.e} track={patternTrack.track} px={px} />}

        <RunwayLayer ap={ap} px={px} pattern={pattern} />
        {runwayPick && <RunwayPickLayer ap={ap} px={px} pick={runwayPick} />}

        {ap.circle && (
          <g transform={`translate(${ap.circle[0]} ${-ap.circle[1]})`}>
            <circle r={7 * px} fill="none" stroke="var(--c4)" strokeWidth={1.5 * px} />
            {sock.spd > 0 && <line x1={0} y1={0} x2={0} y2={-9 * px} stroke="var(--c2)" strokeWidth={3 * px} strokeLinecap="round" transform={`rotate(${sock.dir + 180})`} />}
          </g>
        )}

        {candidates.map(c => {
          const pts = c.track.map(s => s.p)
          const mid = sampleAt(c.track, 0.42).p
          const color = CAND_COLOR[c.state]
          const strong = c.state !== 'idle' && c.state !== 'dim'
          return (
            <g key={c.id} className={onCandidate ? 'cursor-pointer' : undefined} onClick={() => onCandidate?.(c.id)} onPointerEnter={() => onHoverCandidate?.(c.id)} onPointerLeave={() => onHoverCandidate?.(null)}>
              <polyline points={line(pts)} fill="none" stroke="transparent" strokeWidth={16 * px} />
              <polyline points={line(pts)} fill="none" stroke={color} strokeWidth={(strong ? 3 : 2) * px} strokeOpacity={c.state === 'dim' ? 0.35 : 0.9} strokeDasharray={c.state === 'right' ? undefined : `${6 * px} ${4 * px}`} strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={mid[0]} cy={-mid[1]} r={10 * px} fill={color} />
              <text x={mid[0]} y={-mid[1] + 4 * px} textAnchor="middle" fontSize={11 * px} fontWeight={700} fill="var(--card)">{c.letter}</text>
            </g>
          )
        })}

        {trafficTracks.map(({ tr, track }) => {
          const s = track.length > 1 ? sampleAt(track, ((t / (tr.period ?? 60)) + (tr.phase ?? 0)) % 1) : { ...track[0], hdg: tr.hdg ?? 0 }
          const rel = Math.round((s.alt - own.s.alt) / 100)
          return (
            <g key={tr.id} transform={`translate(${s.p[0]} ${-s.p[1]})`}>
              {tr.icon === 'canopy' ? (
                <path d="M-6,0 Q0,-8 6,0 L0,7 Z" transform={`scale(${px})`} fill="var(--c2)" stroke="var(--card)" strokeWidth={1} />
              ) : tr.icon === 'balloon' ? (
                <g transform={`scale(${px})`}><circle r={7} fill="var(--c5)" stroke="var(--card)" strokeWidth={1} /><rect x={-2.5} y={7} width={5} height={4} fill="var(--c4)" /></g>
              ) : (
                <path d={PLANE} transform={`rotate(${s.hdg}) scale(${px * 0.85})`} fill="var(--c2)" stroke="var(--card)" strokeWidth={1.2} />
              )}
              <text x={12 * px} y={-4 * px} fontSize={10 * px} fontWeight={600} fill="var(--c2)">{tr.label}</text>
              <text x={12 * px} y={8 * px} fontSize={10 * px} fill="var(--fg-2)" className="num">{rel === 0 ? '±00' : `${rel > 0 ? '+' : '−'}${String(Math.abs(rel)).padStart(2, '0')}`}</text>
            </g>
          )
        })}

        {own.ahead && own.ahead.length > 1 && <polyline points={line(own.ahead.map(s => s.p))} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={2 * px} strokeDasharray={`${4 * px} ${4 * px}`} />}
        {own.trail && own.trail.length > 1 && <polyline points={line(own.trail.map(s => s.p))} fill="none" stroke="var(--accent)" strokeWidth={2.5 * px} strokeLinecap="round" strokeLinejoin="round" />}
        {!own.hidden && (
          <g transform={`translate(${own.s.p[0]} ${-own.s.p[1]})`}>
            <circle r={18 * px} fill="var(--accent)" opacity={0.12}><animate attributeName="r" values={`${12 * px};${22 * px};${12 * px}`} dur="2.4s" repeatCount="indefinite" /></circle>
            <path d={PLANE} transform={`rotate(${own.s.hdg}) scale(${px * 1.15})`} fill="var(--accent)" stroke="var(--card)" strokeWidth={1.4} />
          </g>
        )}
        {!own.hidden && <OffscreenMarker p={own.s.p} b={b} px={px} />}
        {own.hidden && <text x={b.x + b.w / 2} y={b.y + 26 * px} textAnchor="middle" fontSize={12 * px} fill="var(--fg-3)">Your position is hidden. Use the instruments.</text>}
      </svg>

      <div className="pointer-events-none absolute bottom-3 left-3 flex items-end gap-3">
        <div className="flex flex-col items-center rounded-md border border-border bg-card/90 px-2 py-1 text-2xs font-semibold text-fg-2 shadow-card"><span aria-hidden>▲</span>N</div>
        <div className="rounded-md border border-border bg-card/90 px-2 py-1 shadow-card">
          <div className="h-1.5 border-x-2 border-b-2 border-fg-2" style={{ width: scale / px }} />
          <div className="num mt-0.5 text-2xs text-fg-2">{scale} nm</div>
        </div>
        <div className="hidden rounded-md border border-border bg-card/90 px-2 py-1 text-xs text-fg-2 shadow-card sm:block">Magnetic north up · {ap.surveyed ? 'runways from FAA survey data' : 'runway layout schematic'}</div>
      </div>
    </div>
  )
}

export function RunwayLayer({ ap, px, pattern }: { ap: Airport; px: number; pattern?: string }) {
  return <>
    {ap.runways.map(r => {
      const L = r.lengthFt / NM_FT, W = Math.max(r.widthFt / NM_FT, 6 * px)
      const active = r.ends.some(e => e === pattern)
      return (
        <g key={r.ends.join('/')} transform={`translate(${r.center[0]} ${-r.center[1]}) rotate(${r.hdg})`}>
          <rect x={-W / 2} y={-L / 2} width={W} height={L} rx={px} fill={active ? 'var(--fg-2)' : 'var(--fg-3)'} stroke="var(--card)" strokeWidth={px} />
          <line x1={0} y1={-L / 2 + 4 * px} x2={0} y2={L / 2 - 4 * px} stroke="var(--card)" strokeWidth={0.8 * px} strokeDasharray={`${4 * px} ${3 * px}`} />
          {r.displacedFt?.map((d, i) => d ? <line key={i} x1={-W / 2} x2={W / 2} y1={(i ? -1 : 1) * (L / 2 - d / NM_FT)} y2={(i ? -1 : 1) * (L / 2 - d / NM_FT)} stroke="var(--card)" strokeWidth={1.6 * px} /> : null)}
          {r.ends.map((id, i) => (
            <text key={id} y={0} transform={`rotate(${i ? 180 : 0}) translate(0 ${L / 2 + 12 * px})`} textAnchor="middle" fontSize={11 * px} fontWeight={700} fill={pattern === id ? 'var(--accent)' : 'var(--fg-2)'} className="num">{id}</text>
          ))}
        </g>
      )
    })}
  </>
}

export function RunwayPickLayer({ ap, px, pick }: { ap: Airport; px: number; pick: RunwayPick }) {
  return <>
    {ap.runways.flatMap(runwayEnds).map(e => {
      const st = pick.state[e.ident] ?? 'idle'
      const lp: Pt = [e.threshold[0] - e.dir[0] * 16 * px, e.threshold[1] - e.dir[1] * 16 * px]
      return (
        <g key={e.ident} className="cursor-pointer" onClick={() => pick.onPick(e.ident)} onPointerEnter={() => pick.onHover?.(e.ident)} onPointerLeave={() => pick.onHover?.(null)}>
          <circle cx={lp[0]} cy={-lp[1]} r={13 * px} fill={st === 'idle' ? 'var(--card)' : CAND_COLOR[st]} fillOpacity={st === 'idle' ? 0.9 : 0.2} stroke={st === 'idle' ? 'var(--border-strong)' : CAND_COLOR[st]} strokeWidth={(st === 'idle' ? 1 : 2) * px} />
          <text x={lp[0]} y={-lp[1] + 4 * px} textAnchor="middle" fontSize={11 * px} fontWeight={700} fill={st === 'idle' ? 'var(--fg)' : CAND_COLOR[st]} className="num">{e.ident}</text>
        </g>
      )
    })}
  </>
}

function OffscreenMarker({ p, b, px }: { p: Pt; b: Box; px: number }) {
  const x = p[0], y = -p[1], m = 30 * px
  if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return null
  const cx = Math.min(b.x + b.w - m, Math.max(b.x + m, x)), cy = Math.min(b.y + b.h - m, Math.max(b.y + m, y))
  const ang = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <circle r={14 * px} fill="var(--accent)" />
      <path d="M0,-8 L5,2 L-5,2 Z" transform={`rotate(${ang}) scale(${px})`} fill="var(--accent-fg)" />
      <text y={26 * px} textAnchor="middle" fontSize={11 * px} fontWeight={600} fill="var(--accent)">You · {Math.hypot(p[0], p[1]).toFixed(1)} nm</text>
    </g>
  )
}

// Close-up of the runways: idents, displaced thresholds, the pattern for the
// runway in use, the segmented circle and the reported wind. Runway ends are clickable when picking.
export function AirportDiagram({ ap, pattern, wind, pick, className }: { ap: Airport; pattern?: string; wind: Wind; pick?: RunwayPick; className?: string }) {
  const ends = ap.runways.flatMap(runwayEnds)
  const pts: Pt[] = ends.flatMap(e => [e.threshold, e.departureEnd])
  if (pattern) { const e = findEnd(ap.runways, pattern); pts.push(...(['mid', 'base', 'baseMid', 'final', 'downwindStart', 'upwind', 'crosswind'] as const).map(l => legPoint(e, l))) }
  const box = fitBox(pts, 1.5)
  const px = box.w / 330
  const pt = pattern ? (() => { const e = findEnd(ap.runways, pattern); return { e, track: smooth(circuit(e, ap.tpa, ap.elev)) } })() : null
  const R = Math.min(box.w, box.h) * 0.44
  return (
    <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className={cn('w-full', className)} role="img" aria-label={`${ap.icao} runway diagram`}>
      {pt && <PatternOverlay e={pt.e} track={pt.track} px={px} />}
      <RunwayLayer ap={ap} px={px} pattern={pattern} />
      {ap.circle && <circle cx={ap.circle[0]} cy={-ap.circle[1]} r={6 * px} fill="none" stroke="var(--c4)" strokeWidth={1.5 * px} />}
      {wind.spd > 0 && (
        <g transform={`translate(${box.x + box.w / 2} ${box.y + box.h / 2}) rotate(${wind.dir})`}>
          <line x1={0} y1={-R} x2={0} y2={-R * 0.72} stroke="var(--fg)" strokeWidth={2.5 * px} strokeLinecap="round" />
          <path d={`M0,${-R * 0.66} L${-5 * px},${-R * 0.75} L${5 * px},${-R * 0.75} Z`} fill="var(--fg)" />
        </g>
      )}
      {pick && <RunwayPickLayer ap={ap} px={px} pick={pick} />}
    </svg>
  )
}

function ZoneMark({ z, p, px }: { z: Zone; p: Pt; px: number }) {
  if (z.kind === 'obstacle') return (
    <g transform={`translate(${p[0]} ${-p[1]})`}>
      <path d="M0,-8 L7,5 L-7,5 Z" transform={`scale(${px})`} fill="var(--c4)" stroke="var(--card)" strokeWidth={1} />
      <text x={10 * px} y={4 * px} fontSize={10 * px} fontWeight={600} fill="var(--c4)">{z.label}</text>
    </g>
  )
  const color = z.kind === 'jump' ? 'var(--c2)' : 'var(--bad)'
  return (
    <g>
      <circle cx={p[0]} cy={-p[1]} r={Math.max(z.r, 8 * px)} fill={z.kind === 'tfr' ? 'url(#tfr-hatch)' : color} fillOpacity={z.kind === 'tfr' ? 1 : 0.12} stroke={color} strokeWidth={2 * px} strokeDasharray={z.kind === 'avoid' ? `${5 * px} ${3 * px}` : undefined} />
      <text x={p[0]} y={-p[1] - Math.max(z.r, 8 * px) - 4 * px} textAnchor="middle" fontSize={10.5 * px} fontWeight={600} fill={color}>{z.label}</text>
    </g>
  )
}

function PatternOverlay({ e, track, px }: { e: ReturnType<typeof findEnd>; track: Sample[]; px: number }) {
  const labels: [string, Pt][] = [['Downwind', legPoint(e, 'mid', 0.95)], ['Base', legPoint(e, 'baseMid', 0.75)], ['Final', legPoint(e, 'final')], ['Upwind', legPoint(e, 'upwind')]]
  return (
    <g>
      <polyline points={line(track.map(s => s.p))} fill="none" stroke="var(--accent)" strokeOpacity={0.55} strokeWidth={2 * px} strokeDasharray={`${7 * px} ${5 * px}`} />
      {[0.12, 0.3, 0.5, 0.75, 0.92].map(f => {
        const s = sampleAt(track, f)
        return <path key={f} d="M-4,3 L0,-3 L4,3" transform={`translate(${s.p[0]} ${-s.p[1]}) rotate(${s.hdg}) scale(${px})`} fill="none" stroke="var(--accent)" strokeWidth={1.6} />
      })}
      {labels.map(([l, p]) => <text key={l} x={p[0]} y={-p[1]} textAnchor="middle" fontSize={10 * px} fill="var(--accent)" opacity={0.85}>{l}</text>)}
    </g>
  )
}

// Top-down windsock: points downwind, length by speed (full at 15 kt), swings with gusts.
export function Windsock({ sock, wind, rwyHdg, className }: { sock: Wind; wind: Wind; rwyHdg?: number; className?: string }) {
  const calm = sock.spd < 3
  const len = 14 + 34 * Math.min(1, sock.spd / 15)
  const swing = sock.gust ? Math.min(20, (sock.gust - sock.spd) * 2.2) : 3
  const differs = Math.abs(((sock.dir - wind.dir + 540) % 360) - 180) > 30 || Math.abs(sock.spd - wind.spd) > 4
  return (
    <div className={cn('w-40', className)}>
      <div className="flex items-center justify-between text-sm font-medium text-fg-2"><span>Windsock</span><span className="num text-fg-3">{calm ? 'limp' : sock.spd >= 15 ? 'full' : `${Math.round(Math.min(1, sock.spd / 15) * 100)}%`}</span></div>
      <svg viewBox="-60 -60 120 120" className="mx-auto mt-1 block size-36">
        <circle r={54} fill="none" stroke="var(--border-strong)" strokeDasharray="2 4" />
        {['N', 'E', 'S', 'W'].map((c, i) => <text key={c} x={Math.sin(i * Math.PI / 2) * 46} y={-Math.cos(i * Math.PI / 2) * 46 + 4} textAnchor="middle" fontSize={10} fill="var(--fg-3)">{c}</text>)}
        {rwyHdg != null && <rect x={-4} y={-40} width={8} height={80} rx={1} fill="var(--sunken)" stroke="var(--border-strong)" transform={`rotate(${rwyHdg})`} />}
        <circle r={3} fill="var(--fg-2)" />
        {calm ? <path d="M0,0 q4,6 1,12" stroke="var(--c2)" strokeWidth={5} fill="none" strokeLinecap="round" /> : (
          <g transform={`rotate(${sock.dir + 180})`}>
            <g className="windsock-flutter" style={{ ['--swing' as string]: `${swing}deg`, animationDuration: sock.gust ? '1.1s' : '2.6s' }}>
              {Array.from({ length: 5 }, (_, i) => {
                const y0 = -(i * len) / 5, y1 = -((i + 1) * len) / 5
                const w0 = 7 - i * 0.9, w1 = 7 - (i + 1) * 0.9
                return <path key={i} d={`M${-w0},${y0} L${w0},${y0} L${w1},${y1} L${-w1},${y1} Z`} fill={i % 2 ? 'var(--card)' : 'var(--c2)'} stroke="var(--c2)" strokeWidth={0.8} />
              })}
            </g>
          </g>
        )}
      </svg>
      <div className="num text-center text-sm text-fg-2">{calm ? 'Calm' : `From ~${fmtHdg(Math.round(sock.dir / 10) * 10)}°`}</div>
      {differs && <div className="mt-1 rounded bg-warn-soft px-1.5 py-0.5 text-center text-xs font-medium text-warn">Differs from the report</div>}
    </div>
  )
}

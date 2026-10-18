import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Info as InfoIcon, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Airport } from './airports'
import { components, dist, findEnd, fmtHdg, sampleAt, type Pt, type RunwayEnd, type Sample, type Wind } from './geo'
import { atPoint, trafficTrack, type TrafficDef, type Zone } from './model'
import { Cessna, line, MAP, PatternOverlay, PICK_COLOR, RunwayPickLayer, Runways, sockText, TRAFFIC, type PickState, type RunwayPick } from './art'

export type CandState = PickState
export interface Candidate { id: string; letter: string; track: Sample[]; state: CandState }
export interface Box { x: number; y: number; w: number; h: number }

export function useFrame(active = true) {
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

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 800, h: 480 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(200, e.contentRect.width), h: Math.max(160, e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

export function fitBox(points: Pt[], aspect: number, padFrac = 0.1, padMin = 0.4): Box {
  const xs = points.map(p => p[0]), ys = points.map(p => -p[1])
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const pad = Math.max(x1 - x0, y1 - y0) * padFrac + padMin
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad
  let w = x1 - x0, h = y1 - y0
  if (w / h < aspect) { const nw = h * aspect; x0 -= (nw - w) / 2; w = nw } else { const nh = w / aspect; y0 -= (nh - h) / 2; h = nh }
  return { x: x0, y: y0, w, h }
}

type Present = 'you' | 'traffic' | 'pattern' | 'classD' | 'tfr' | 'jump' | 'obstacle' | 'avoid' | 'closed' | 'paths' | 'water'

// The situation map: you, the field, the pattern, traffic and hazards, magnetic north up.
export function Scene({ ap, wind, sock, pattern, closed = [], zones = [], traffic = [], own, candidates = [], focus, runwayPick, onCandidate, onHoverCandidate, caption, className, children }: {
  ap: Airport
  wind: Wind
  sock?: Wind
  pattern?: string
  closed?: string[]
  zones?: Zone[]
  traffic?: TrafficDef[]
  own: { s: Sample; trail?: Sample[]; ahead?: Sample[]; hidden?: boolean; gs?: number }
  candidates?: Candidate[]
  focus: Pt[]
  runwayPick?: RunwayPick
  onCandidate?: (id: string) => void
  onHoverCandidate?: (id: string | null) => void
  caption?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  const [ref, size] = useSize<HTMLDivElement>()
  const t = useFrame()
  const [legend, setLegend] = useState(false)
  // Leave room for the overlays along the top and bottom edges.
  const target = useMemo(() => {
    const inner = fitBox([[-1.4, -1.4], [1.4, 1.4], ...focus], size.w / Math.max(80, size.h - 120), 0.08, 0.3)
    const k = inner.w / size.w
    return { x: inner.x, y: inner.y - 64 * k, w: inner.w, h: inner.h + 120 * k }
  }, [focus, size.w, size.h])
  const box = useRef<Box>(target)
  const last = useRef(0)
  // Ease the camera toward its target once per frame.
  const dt = Math.min(0.1, Math.max(0, t - last.current)); last.current = t
  const k = 1 - Math.exp(-dt * 3.5)
  box.current = { x: box.current.x + (target.x - box.current.x) * k, y: box.current.y + (target.y - box.current.y) * k, w: box.current.w + (target.w - box.current.w) * k, h: box.current.h + (target.h - box.current.h) * k }
  const b = box.current
  const px = b.w / size.w

  const end = pattern ? findEnd(ap.runways, pattern) : null
  const fieldPx = Math.max(...ap.runways.map(r => r.lengthFt / 6076.12)) / px
  const trafficTracks = useMemo(() => traffic.map(tr => ({ tr, track: trafficTrack(ap, tr) })), [ap, traffic])
  const scale = [0.5, 1, 2, 5, 10].find(n => n / px > 64) ?? 10
  const rings = [1, 3, 5, 10, 20].filter(r => r / px > 26)
  // One-minute predictor ahead of the airplane, as ForeFlight draws it.
  const lead = own.gs && own.gs > 20 ? Math.min(own.gs / 60, 2.5) : 0
  const leadEnd: Pt = [own.s.p[0] + Math.sin((own.s.hdg * Math.PI) / 180) * lead, own.s.p[1] + Math.cos((own.s.hdg * Math.PI) / 180) * lead]

  const present = new Set<Present>()
  if (!own.hidden) present.add('you')
  if (traffic.length) present.add('traffic')
  if (end) present.add('pattern')
  if (ap.classD) present.add('classD')
  if (ap.water) present.add('water')
  if (closed.length) present.add('closed')
  if (candidates.length) present.add('paths')
  zones.forEach(z => present.add(z.kind))

  return (
    <div ref={ref} className={cn('relative overflow-hidden', className)} style={{ background: `radial-gradient(120% 90% at 50% 45%, ${MAP.land2} 0%, ${MAP.land} 70%)` }}>
      <svg viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} className="absolute inset-0 size-full select-none" role="img" aria-label={`Map of ${ap.icao} with runways, traffic pattern and your aircraft`}>
        <defs>
          <pattern id="tfr-hatch" width={9 * px} height={9 * px} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={9 * px} stroke={MAP.tfr} strokeWidth={1.4 * px} opacity={0.4} />
          </pattern>
          <pattern id="map-grid" width={1} height={1} patternUnits="userSpaceOnUse">
            <path d="M1,0 L0,0 L0,1" fill="none" stroke="#ffffff" strokeOpacity={0.025} strokeWidth={px} />
          </pattern>
        </defs>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="url(#map-grid)" />

        {ap.water && <polygon points={line(ap.water)} fill={MAP.water} stroke={MAP.shore} strokeWidth={1.5 * px} />}
        {ap.water && <text x={ap.water[2][0] - 1.2} y={-ap.water[2][1] + 0.6} textAnchor="end" fontSize={12 * px} fill="#5f97c7" fontStyle="italic">{ap.waterLabel}</text>}
        {ap.ridges?.map(r => (
          <g key={r.label}>
            <polyline points={line(r.path)} fill="none" stroke={MAP.ridge} strokeWidth={22 * px} strokeOpacity={0.35} strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={line(r.path)} fill="none" stroke={MAP.ridge} strokeWidth={8 * px} strokeOpacity={0.5} strokeLinecap="round" strokeLinejoin="round" />
            <text x={r.path[1][0] + 12 * px} y={-r.path[1][1]} fontSize={11 * px} fill="#c2a26a">{r.label}</text>
          </g>
        ))}

        {rings.map(r => (
          <g key={r}>
            <circle r={r} fill="none" stroke={MAP.ring} strokeWidth={px} strokeDasharray={`${2 * px} ${5 * px}`} />
            <text x={r * Math.SQRT1_2 + 3 * px} y={-r * Math.SQRT1_2 - 3 * px} fontSize={10 * px} fill={MAP.ringText} className="num">{r} nm</text>
          </g>
        ))}
        {ap.classD && <>
          <circle r={ap.classD} fill="none" stroke={MAP.classD} strokeWidth={1.6 * px} strokeDasharray={`${9 * px} ${5 * px}`} opacity={0.85} />
          <text x={0} y={ap.classD - 5 * px} textAnchor="middle" fontSize={10 * px} fontWeight={600} fill={MAP.classD}>CLASS D</text>
        </>}

        {zones.map((z, i) => <ZoneMark key={i} z={z} p={atPoint(ap, z.at)} px={px} />)}

        {end && <PatternOverlay ap={ap} e={end} px={px} labels={1.2 / px > 60} tpa={ap.tpa} />}
        <Runways ap={ap} px={px} active={pattern} closed={closed} minWidth={5} labels={(runwayPick && fieldPx >= 120) || fieldPx < 60 ? 'none' : 'outside'} />
        {fieldPx < 60 && !end && <text x={0} y={Math.max(fieldPx, 20) * px * 0.6 + 14 * px} textAnchor="middle" fontSize={11 * px} fontWeight={700} fill="#e6e6e6" stroke="#000" strokeWidth={3 * px} paintOrder="stroke">{ap.icao}</text>}
        {runwayPick && fieldPx >= 120 && <RunwayPickLayer ap={ap} px={px} pick={runwayPick} />}

        {ap.circle && <circle cx={ap.circle[0]} cy={-ap.circle[1]} r={6 * px} fill="none" stroke={MAP.sock} strokeOpacity={0.8} strokeWidth={1.4 * px} />}

        {candidates.map(c => {
          const pts = c.track.map(s => s.p)
          const mid = sampleAt(c.track, 0.42).p
          const color = PICK_COLOR[c.state] === '#e6e6e6' ? '#9fb4c8' : PICK_COLOR[c.state]
          const strong = c.state !== 'idle' && c.state !== 'dim'
          const tip = sampleAt(c.track, 1)
          return (
            <g key={c.id} className={onCandidate ? 'cursor-pointer' : undefined} onClick={() => onCandidate?.(c.id)} onPointerEnter={() => onHoverCandidate?.(c.id)} onPointerLeave={() => onHoverCandidate?.(null)}>
              <polyline points={line(pts)} fill="none" stroke="transparent" strokeWidth={18 * px} />
              {strong && <polyline points={line(pts)} fill="none" stroke={color} strokeOpacity={0.2} strokeWidth={9 * px} strokeLinecap="round" strokeLinejoin="round" />}
              <polyline points={line(pts)} fill="none" stroke={color} strokeWidth={(strong ? 2.6 : 1.8) * px} strokeOpacity={c.state === 'dim' ? 0.35 : 0.95} strokeDasharray={c.state === 'right' ? undefined : `${6 * px} ${4 * px}`} strokeLinecap="round" strokeLinejoin="round" />
              <path d="M-5,4 L0,-4 L5,4 Z" transform={`translate(${tip.p[0]} ${-tip.p[1]}) rotate(${tip.hdg}) scale(${px})`} fill={color} opacity={c.state === 'dim' ? 0.35 : 1} />
              <circle cx={mid[0]} cy={-mid[1]} r={11 * px} fill={color} stroke="#000" strokeOpacity={0.5} strokeWidth={px} />
              <text x={mid[0]} y={-mid[1] + 4 * px} textAnchor="middle" fontSize={12 * px} fontWeight={700} fill="#000">{c.letter}</text>
            </g>
          )
        })}

        {trafficTracks.map(({ tr, track }) => {
          const s = track.length > 1 ? sampleAt(track, ((t / (tr.period ?? 60)) + (tr.phase ?? 0)) % 1) : { ...track[0], hdg: tr.hdg ?? 0 }
          const ahead = track.length > 1 ? sampleAt(track, ((t / (tr.period ?? 60)) + (tr.phase ?? 0) + 0.01) % 1) : s
          const rel = Math.round((s.alt - own.s.alt) / 100)
          const climb = Math.sign(Math.round(ahead.alt - s.alt))
          return (
            <g key={tr.id} transform={`translate(${s.p[0]} ${-s.p[1]})`}>
              {tr.icon === 'canopy' ? (
                <g transform={`scale(${px})`}><path d="M-7,0 Q0,-9 7,0 Z" fill={MAP.jump} stroke="#000" strokeWidth={0.8} /><path d="M-7,0 L0,8 M7,0 L0,8 M0,0 L0,8" stroke={MAP.jump} strokeWidth={0.8} /><circle cy={9} r={1.8} fill="#fff" /></g>
              ) : tr.icon === 'balloon' ? (
                <g transform={`scale(${px})`}><path d="M0,-9 C7,-9 8,-1 3,4 L-3,4 C-8,-1 -7,-9 0,-9 Z" fill="#e85d8e" stroke="#000" strokeWidth={0.8} /><rect x={-2.2} y={6} width={4.4} height={3.5} fill="#c2a26a" /></g>
              ) : (
                <path d={TRAFFIC} transform={`rotate(${s.hdg}) scale(${px})`} fill={MAP.traffic} stroke="#000" strokeWidth={1} strokeLinejoin="round" />
              )}
              <g transform={`translate(${12 * px} 0)`}>
                <text y={-3 * px} fontSize={10.5 * px} fontWeight={600} fill={MAP.traffic} stroke="#000" strokeWidth={2.4 * px} paintOrder="stroke">{tr.label}</text>
                <text y={9 * px} fontSize={10.5 * px} fill="#e6e6e6" stroke="#000" strokeWidth={2.4 * px} paintOrder="stroke" className="num">{rel === 0 ? '±00' : `${rel > 0 ? '+' : '−'}${String(Math.abs(rel)).padStart(2, '0')}`}{climb > 0 ? ' ↑' : climb < 0 ? ' ↓' : ''}</text>
              </g>
            </g>
          )
        })}

        {own.ahead && own.ahead.length > 1 && <polyline points={line(own.ahead.map(s => s.p))} fill="none" stroke={MAP.ownRing} strokeOpacity={0.3} strokeWidth={2 * px} strokeDasharray={`${4 * px} ${4 * px}`} />}
        {own.trail && own.trail.length > 1 && <polyline points={line(own.trail.map(s => s.p))} fill="none" stroke={MAP.ownRing} strokeWidth={2.6 * px} strokeLinecap="round" strokeLinejoin="round" />}
        {!own.hidden && <>
          {lead > 0 && !own.trail && <line x1={own.s.p[0]} y1={-own.s.p[1]} x2={leadEnd[0]} y2={-leadEnd[1]} stroke={MAP.ownRing} strokeWidth={1.6 * px} strokeOpacity={0.8} />}
          <circle cx={own.s.p[0]} cy={-own.s.p[1]} r={20 * px} fill={MAP.ownRing} opacity={0.12}><animate attributeName="r" values={`${14 * px};${24 * px};${14 * px}`} dur="2.4s" repeatCount="indefinite" /></circle>
          <Cessna p={own.s.p} hdg={own.s.hdg} px={px} />
          <OwnTag p={own.s.p} alt={own.s.alt} px={px} />
          <OffscreenMarker p={own.s.p} b={b} px={px} />
        </>}
      </svg>

      {/* Overlays: what the map is showing right now, the reported wind, scale and a key. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
        <div className="min-w-0">{caption}</div>
        <WindChip wind={wind} sock={sock} end={end} />
      </div>
      {own.hidden && (
        <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-sm text-fg-2 backdrop-blur"><Eye className="size-4" />Your position is hidden. Work it out from the instruments.</span>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-end gap-2">
        <div className="grid size-9 place-items-center rounded-full bg-black/60 text-2xs font-bold text-fg-2 backdrop-blur"><svg viewBox="-8 -10 16 20" className="size-4"><path d="M0,-9 L5,6 L0,3 L-5,6 Z" fill="#fff" /></svg></div>
        <div className="rounded-full bg-black/60 px-3 py-1.5 backdrop-blur">
          <div className="h-1.5 border-x-2 border-b-2 border-fg-2" style={{ width: scale / px }} />
          <div className="num mt-0.5 text-2xs text-fg-2">{scale} nm</div>
        </div>
      </div>
      <div className="absolute bottom-3 right-3 flex items-end gap-2">
        {children}
        <button onClick={() => setLegend(l => !l)} className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-sm font-medium text-fg-2 backdrop-blur hover:text-fg" aria-expanded={legend}>
          {legend ? <X className="size-4" /> : <InfoIcon className="size-4" />}Key
        </button>
      </div>
      {legend && <Legend present={present} />}
    </div>
  )
}

function OwnTag({ p, alt, px }: { p: Pt; alt: number; px: number }) {
  return (
    <text x={p[0] + 18 * px} y={-p[1] + 4 * px} fontSize={11 * px} fontWeight={600} fill="#fff" stroke="#000" strokeWidth={3 * px} paintOrder="stroke" className="num">{(Math.round(alt / 10) * 10).toLocaleString()}</text>
  )
}

function WindChip({ wind, sock, end }: { wind: Wind; sock?: Wind; end: RunwayEnd | null }) {
  const calm = !wind.spd
  const c = end && wind.spd ? components(wind, end.hdg) : null
  const off = sock ? Math.abs(((sock.dir - wind.dir + 540) % 360) - 180) : 0
  const differs = sock && (off > 30 || Math.abs(sock.spd - wind.spd) > 4)
  return (
    <div className="shrink-0 rounded-2xl bg-black/65 p-1 pr-3 backdrop-blur">
    <div className="flex items-center gap-2">
      <svg viewBox="-12 -12 24 24" className="size-7">
        <circle r={11} fill="none" stroke="#ffffff" strokeOpacity={0.2} />
        {!calm && <path d="M0,-9 L0,6 M-3.5,2 L0,6.5 L3.5,2" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" transform={`rotate(${wind.dir})`} />}
        {calm && <circle r={3} fill="none" stroke="#fff" strokeWidth={1.6} />}
      </svg>
      <div className="leading-tight">
        <div className="text-2xs text-fg-3">Reported wind</div>
        <div className="num text-sm font-medium text-fg">{calm ? 'Calm' : `${fmtHdg(wind.dir)}° ${wind.spd}${wind.gust ? `G${wind.gust}` : ''} kt`}</div>
      </div>
    </div>
    {c && <div className="num mt-1 pl-2 text-xs text-fg-2">Rwy {end!.ident}: {Math.abs(Math.round(c.head))} {c.head >= 0 ? 'head' : <span className="text-bad">tail</span>} · {Math.abs(Math.round(c.cross))} {c.cross > 0.5 ? 'R' : c.cross < -0.5 ? 'L' : ''} cross</div>}
    {differs && <div className="mt-1 pl-2 text-xs font-medium text-warn">Sock: {sockText(sock!).replace(/^From /, 'from ')}</div>}
    </div>
  )
}

const LEGEND: { k: Present; label: string; icon: React.ReactNode }[] = [
  { k: 'you', label: 'You (Cessna 172), altitude MSL and 1-minute track', icon: <svg viewBox="-16 -14 32 28" className="size-5"><path d="M0,-12.5 C1.3,-12.5 2,-11.2 2.1,-9 L2.2,-5.2 L14.5,-4.6 L15.4,-1.6 L2.1,-0.6 L1.4,7.4 L6.3,8.9 L6.3,9.9 L0,12 L-6.3,9.9 L-6.3,8.9 L-1.4,7.4 L-2.1,-0.6 L-15.4,-1.6 L-14.5,-4.6 L-2.2,-5.2 L-2.1,-9 C-2,-11.2 -1.3,-12.5 0,-12.5 Z" fill="#fff" /></svg> },
  { k: 'traffic', label: 'Traffic: hundreds of feet above (+) or below (−) you', icon: <svg viewBox="-8 -10 16 20" className="size-4"><path d="M0,-9 L6.5,7 L0,3.4 L-6.5,7 Z" fill={MAP.traffic} /></svg> },
  { k: 'pattern', label: 'Traffic pattern for the runway in use, with leg names', icon: <span className="block h-0 w-5 border-t-2 border-dashed" style={{ borderColor: MAP.pattern }} /> },
  { k: 'paths', label: 'Answer options: click a lettered path', icon: <span className="grid size-4 place-items-center rounded-full bg-[#9fb4c8] text-2xs font-bold text-black">A</span> },
  { k: 'classD', label: 'Class D airspace (tower)', icon: <span className="block h-0 w-5 border-t-2 border-dashed" style={{ borderColor: MAP.classD }} /> },
  { k: 'tfr', label: 'Temporary flight restriction', icon: <span className="block size-4 rounded-full border-2" style={{ borderColor: MAP.tfr, background: 'repeating-linear-gradient(45deg, #ff5d5d55 0 2px, transparent 2px 5px)' }} /> },
  { k: 'jump', label: 'Parachute jump area', icon: <span className="block size-4 rounded-full border-2" style={{ borderColor: MAP.jump, background: `${MAP.jump}22` }} /> },
  { k: 'avoid', label: 'Area to avoid', icon: <span className="block size-4 rounded-full border-2 border-dashed" style={{ borderColor: MAP.tfr }} /> },
  { k: 'obstacle', label: 'Obstacle (height MSL)', icon: <svg viewBox="-8 -9 16 14" className="size-4"><path d="M-6,4 L0,-7 L6,4" fill="none" stroke={MAP.obstacle} strokeWidth={2} /><circle cy={2} r={1.6} fill={MAP.obstacle} /></svg> },
  { k: 'closed', label: 'Closed runway', icon: <svg viewBox="-6 -6 12 12" className="size-4"><path d="M-5,-5 L5,5 M5,-5 L-5,5" stroke={MAP.closed} strokeWidth={2.4} strokeLinecap="round" /></svg> },
  { k: 'water', label: 'Water', icon: <span className="block size-4 rounded-sm" style={{ background: MAP.water, border: `1px solid ${MAP.shore}` }} /> },
]

function Legend({ present }: { present: Set<Present> }) {
  return (
    <div className="absolute bottom-14 right-3 z-10 w-72 max-w-[calc(100%-1.5rem)] rounded-xl bg-[#1c1c1c]/95 p-3 shadow-pop backdrop-blur animate-in">
      <div className="mb-2 text-sm font-medium text-fg">Map key</div>
      <ul className="space-y-1.5">
        {LEGEND.filter(l => present.has(l.k)).map(l => <li key={l.k} className="flex items-center gap-2.5 text-sm text-fg-2"><span className="grid w-5 shrink-0 place-items-center">{l.icon}</span>{l.label}</li>)}
        <li className="flex items-center gap-2.5 text-sm text-fg-2"><span className="grid w-5 shrink-0 place-items-center"><span className="block size-4 rounded-full border border-dashed border-fg-3" /></span>Distance rings from the field</li>
      </ul>
      <p className="mt-2 text-sm text-fg-3">Magnetic north is up.</p>
    </div>
  )
}

function OffscreenMarker({ p, b, px }: { p: Pt; b: Box; px: number }) {
  const x = p[0], y = -p[1], m = 34 * px
  if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return null
  const cx = Math.min(b.x + b.w - m, Math.max(b.x + m, x)), cy = Math.min(b.y + b.h - m, Math.max(b.y + m, y))
  const ang = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI
  const anchor = cx > b.x + b.w * 0.7 ? 'end' : cx < b.x + b.w * 0.3 ? 'start' : 'middle'
  const tx = anchor === 'end' ? 14 * px : anchor === 'start' ? -14 * px : 0
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <circle r={15 * px} fill={MAP.ownRing} />
      <path d="M0,-8 L5,3 L-5,3 Z" transform={`rotate(${ang}) scale(${px})`} fill="#000" />
      <text x={tx} y={cy > b.y + b.h / 2 ? -22 * px : 30 * px} textAnchor={anchor} fontSize={11 * px} fontWeight={600} fill={MAP.ownRing} stroke="#000" strokeWidth={3 * px} paintOrder="stroke">You · {Math.hypot(p[0], p[1]).toFixed(1)} nm</text>
    </g>
  )
}

function ZoneMark({ z, p, px }: { z: Zone; p: Pt; px: number }) {
  if (z.kind === 'obstacle') return (
    <g transform={`translate(${p[0]} ${-p[1]})`}>
      <g transform={`scale(${px})`}><path d="M-6,5 L0,-8 L6,5" fill="none" stroke={MAP.obstacle} strokeWidth={2} strokeLinejoin="round" /><circle cy={2.5} r={1.8} fill={MAP.obstacle} /></g>
      <text x={10 * px} y={4 * px} fontSize={10.5 * px} fontWeight={600} fill={MAP.obstacle} stroke="#000" strokeWidth={2.6 * px} paintOrder="stroke">{z.label}</text>
    </g>
  )
  const color = z.kind === 'jump' ? MAP.jump : MAP.tfr
  const r = Math.max(z.r, 9 * px)
  return (
    <g>
      <circle cx={p[0]} cy={-p[1]} r={r} fill={z.kind === 'tfr' ? 'url(#tfr-hatch)' : color} fillOpacity={z.kind === 'tfr' ? 1 : 0.1} stroke={color} strokeWidth={1.8 * px} strokeDasharray={z.kind === 'avoid' ? `${5 * px} ${3 * px}` : undefined} />
      {z.kind === 'jump' && <g transform={`translate(${p[0]} ${-p[1]}) scale(${px})`}><path d="M-7,0 Q0,-9 7,0 Z" fill={color} /><path d="M-7,0 L0,8 M7,0 L0,8" stroke={color} strokeWidth={1} /></g>}
      <text x={p[0]} y={-p[1] - r - 5 * px} textAnchor="middle" fontSize={10.5 * px} fontWeight={600} fill={color} stroke="#000" strokeWidth={2.6 * px} paintOrder="stroke">{z.label}</text>
    </g>
  )
}

export function nearField(p: Pt, nm = 30) { return dist(p, [0, 0]) <= nm }

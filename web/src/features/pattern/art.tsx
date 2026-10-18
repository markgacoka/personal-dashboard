// Shared drawing pieces for the pattern trainer's map, field view and side view.
// Everything is drawn in nautical miles (x east, y north, SVG y flipped) with
// `px` = nautical miles per screen pixel, so strokes and symbols keep their size.
import type { Airport } from './airports'
import { circuit, findEnd, fmtHdg, legHeading, legPoint, NM_FT, norm360, runwayEnds, sampleAt, smooth, type Leg, type Pt, type RunwayEnd, type Sample, type Wind } from './geo'

export const MAP = {
  land: '#0f1311',
  land2: '#141a16',
  water: '#0c2135',
  shore: '#1f4d73',
  ring: '#2b322d',
  ringText: '#7c847d',
  asphalt: '#3d4146',
  paint: '#f4f4f2',
  closed: '#f5c542',
  pattern: '#5eb0ff',
  own: '#ffffff',
  ownRing: '#5eb0ff',
  traffic: '#ffb020',
  tfr: '#ff5d5d',
  jump: '#ff8a3d',
  obstacle: '#ffd24a',
  classD: '#4d8fe8',
  ridge: '#5b4a2e',
  sock: '#ff7a1a',
}

export const xy = (p: Pt) => `${p[0].toFixed(4)},${(-p[1]).toFixed(4)}`
export const line = (pts: Pt[]) => pts.map(xy).join(' ')

// Cessna 172 seen from above, nose up, about 31 units of span.
export const CESSNA = 'M0,-12.5 C1.3,-12.5 2,-11.2 2.1,-9 L2.2,-5.2 L14.5,-4.6 C15.2,-4.55 15.4,-4.2 15.4,-3.6 L15.4,-1.6 C15.4,-1.1 15.1,-0.9 14.5,-0.9 L2.1,-0.6 L1.4,7.4 L5.6,8 C6.1,8.1 6.3,8.4 6.3,8.9 L6.3,9.9 C6.3,10.3 6,10.6 5.6,10.6 L0.9,10.7 L0,12 L-0.9,10.7 L-5.6,10.6 C-6,10.6 -6.3,10.3 -6.3,9.9 L-6.3,8.9 C-6.3,8.4 -6.1,8.1 -5.6,8 L-1.4,7.4 L-2.1,-0.6 L-14.5,-0.9 C-15.1,-0.9 -15.4,-1.1 -15.4,-1.6 L-15.4,-3.6 C-15.4,-4.2 -15.2,-4.55 -14.5,-4.6 L-2.2,-5.2 L-2.1,-9 C-2,-11.2 -1.3,-12.5 0,-12.5 Z'
// The same airplane from the side, nose right.
export const CESSNA_SIDE = 'M-14,-0.8 L-12.2,-7 L-10.4,-7 L-8.6,-1.6 L1,-1.9 L3.4,-4.4 L4,-4.6 L4,-5.4 L-0.6,-5.4 L-0.6,-6.2 L9,-6.2 L9,-5.4 L6.4,-5.4 L9.6,-2.6 C12,-2.4 13.6,-1.2 14,0.2 L14,1 C13,2 11,2.4 8,2.4 L-8.6,1.2 Z'
// ADS-B traffic: an arrowhead pointing along the track.
export const TRAFFIC = 'M0,-9 L6.5,7 L0,3.4 L-6.5,7 Z'

export function Cessna({ p, hdg, px, scale = 1.05, color = MAP.own }: { p: Pt; hdg: number; px: number; scale?: number; color?: string }) {
  return (
    <g transform={`translate(${p[0]} ${-p[1]}) rotate(${hdg}) scale(${px * scale})`}>
      <path d={CESSNA} fill="#000" opacity={0.45} transform="translate(1.6 2.2)" />
      <path d={CESSNA} fill={color} stroke="#0b0d10" strokeWidth={0.9} strokeLinejoin="round" />
      <path d="M-15.4,-2.6 L15.4,-2.6" stroke="#0b0d10" strokeOpacity={0.25} strokeWidth={0.6} />
    </g>
  )
}

// Runways as they are painted: asphalt, edge and centre lines, threshold bars,
// numbers, displaced-threshold arrows and yellow X's on closed runways. Detail
// drops away when the runway is only a few pixels wide.
export function Runways({ ap, px, active, closed = [], minWidth = 6, labels = 'outside' }: {
  ap: Airport; px: number; active?: string; closed?: string[]; minWidth?: number; labels?: 'outside' | 'painted' | 'none'
}) {
  return <>
    {ap.runways.map(r => {
      const L = r.lengthFt / NM_FT
      const W = Math.max(r.widthFt / NM_FT, minWidth * px)
      const wpx = W / px
      const isActive = r.ends.includes(active ?? '')
      const isClosed = r.ends.some(e => closed.includes(e))
      const detail = wpx >= 9
      const keyLen = Math.min(L * 0.07, 22 * px)
      const numSize = Math.min(W * 0.55, 15 * px)
      const painted = labels === 'painted' && wpx >= 16
      return (
        <g key={r.ends.join('/')} transform={`translate(${r.center[0]} ${-r.center[1]}) rotate(${r.hdg})`}>
          {isActive && <rect x={-W / 2 - 3 * px} y={-L / 2 - 3 * px} width={W + 6 * px} height={L + 6 * px} rx={3 * px} fill="none" stroke={MAP.pattern} strokeOpacity={0.55} strokeWidth={1.5 * px} />}
          <rect x={-W / 2} y={-L / 2} width={W} height={L} rx={Math.min(W * 0.08, 1.5 * px)} fill={MAP.asphalt} stroke="#000" strokeOpacity={0.6} strokeWidth={0.8 * px} />
          {detail && <>
            <rect x={-W / 2 + W * 0.06} y={-L / 2 + keyLen * 0.3} width={W * 0.88} height={L - keyLen * 0.6} fill="none" stroke={MAP.paint} strokeOpacity={0.7} strokeWidth={Math.max(0.5 * px, W * 0.015)} />
            <line x1={0} y1={-L / 2 + keyLen * 2.6} x2={0} y2={L / 2 - keyLen * 2.6} stroke={MAP.paint} strokeOpacity={0.85} strokeWidth={Math.max(0.6 * px, W * 0.025)} strokeDasharray={`${Math.max(5 * px, L * 0.025)} ${Math.max(4 * px, L * 0.018)}`} />
          </>}
          {r.ends.map((id, i) => {
            const disp = (r.displacedFt?.[i] ?? 0) / NM_FT
            // Local frame: ends[0] lands toward -y, so its threshold is at +L/2.
            const T = L / 2 - disp
            return (
              <g key={id} transform={`rotate(${i ? 180 : 0})`}>
                {detail && Array.from({ length: 8 }, (_, k) => {
                  const bw = W * 0.055, gap = W * 0.04
                  const x = (k < 4 ? -1 : 1) * (W * 0.07 + (k % 4) * (bw + gap)) - (k < 4 ? bw : 0)
                  return <rect key={k} x={x} y={T - keyLen * 1.2} width={bw} height={keyLen} fill={MAP.paint} opacity={0.9} />
                })}
                {disp > 0 && <>
                  <line x1={-W / 2} x2={W / 2} y1={T} y2={T} stroke={MAP.paint} strokeWidth={Math.max(1.4 * px, W * 0.05)} />
                  {Array.from({ length: Math.max(1, Math.min(4, Math.floor(disp / (12 * px)))) }, (_, k) => {
                    const y = L / 2 - ((k + 0.5) * disp) / Math.max(1, Math.min(4, Math.floor(disp / (12 * px))))
                    const a = Math.min(W * 0.28, 4 * px)
                    return <path key={k} d={`M${-a},${y + a} L0,${y - a * 0.4} L${a},${y + a}`} fill="none" stroke={MAP.paint} strokeWidth={Math.max(0.8 * px, W * 0.04)} />
                  })}
                </>}
                {painted && <text y={T - keyLen * 1.5} textAnchor="middle" fontSize={numSize} fontWeight={700} fill={MAP.paint} className="num" style={{ letterSpacing: '-0.02em' }}>{id}</text>}
                {labels !== 'none' && !painted && (
                  <text transform={`translate(0 ${L / 2 + 10 * px}) rotate(${-(r.hdg + (i ? 180 : 0))})`} y={4 * px} textAnchor="middle" fontSize={12 * px} fontWeight={700} fill={active === id ? MAP.pattern : '#e6e6e6'} stroke="#000" strokeWidth={3 * px} paintOrder="stroke" className="num">{id}</text>
                )}
              </g>
            )
          })}
          {isClosed && [-L / 2 + Math.min(L * 0.15, 30 * px), 0, L / 2 - Math.min(L * 0.15, 30 * px)].map(y => {
            const a = Math.max(W * 0.55, 5 * px)
            return <path key={y} d={`M${-a},${y - a} L${a},${y + a} M${a},${y - a} L${-a},${y + a}`} stroke={MAP.closed} strokeWidth={Math.max(2 * px, W * 0.14)} strokeLinecap="round" />
          })}
        </g>
      )
    })}
  </>
}

const PATTERN_SPAN = 0.7 // nm between the runway and the downwind
const LEG_LABELS: [string, Leg][] = [['Upwind', 'upwind'], ['Crosswind', 'crosswind'], ['Downwind', 'mid'], ['Base', 'baseMid'], ['Final', 'final']]

// The rectangular pattern for runway end `e`, with each leg named along its direction.
export function PatternOverlay({ ap, e, px, labels = true, tpa }: { ap: Airport; e: RunwayEnd; px: number; labels?: boolean; tpa?: number }) {
  const track = smooth(circuit(e, ap.tpa, ap.elev))
  return (
    <g pointerEvents="none">
      <polyline points={line(track.map(s => s.p))} fill="none" stroke={MAP.pattern} strokeOpacity={0.16} strokeWidth={9 * px} strokeLinejoin="round" />
      <polyline points={line(track.map(s => s.p))} fill="none" stroke={MAP.pattern} strokeOpacity={0.85} strokeWidth={1.6 * px} strokeDasharray={`${7 * px} ${5 * px}`} strokeLinejoin="round" />
      {[0.08, 0.2, 0.36, 0.5, 0.64, 0.8, 0.93].map(f => {
        const s = sampleAt(track, f)
        return <path key={f} d="M-4.5,3.5 L0,-2.5 L4.5,3.5" transform={`translate(${s.p[0]} ${-s.p[1]}) rotate(${s.hdg}) scale(${px})`} fill="none" stroke={MAP.pattern} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      })}
      {labels && LEG_LABELS.filter(([, leg]) => PATTERN_SPAN / px > 110 || (PATTERN_SPAN / px > 55 && (leg === 'mid' || leg === 'final'))).map(([l, leg]) => {
        const p = legPoint(e, leg)
        const h = legHeading(e, leg)
        // Keep text upright: read along the leg, flipped when it would be upside down.
        const rot = norm360(h - 90)
        const up = rot > 90 && rot < 270 ? rot - 180 : rot
        const off = leg === 'final' || leg === 'upwind' ? 11 : -9
        const text = leg === 'mid' && tpa ? `${l} · ${tpa.toLocaleString()}` : l
        return (
          <text key={l} transform={`translate(${p[0]} ${-p[1]}) rotate(${up}) translate(0 ${off * px})`} textAnchor="middle" fontSize={10.5 * px} fontWeight={600} fill={MAP.pattern} stroke="#000" strokeOpacity={0.7} strokeWidth={2.6 * px} paintOrder="stroke" style={{ letterSpacing: '0.02em' }}>{text}</text>
        )
      })}
    </g>
  )
}

export const patternEnd = (ap: Airport, ident?: string) => (ident ? findEnd(ap.runways, ident) : null)

// Top-down windsock: points downwind, length by speed (full at 15 kt), swings with gusts.
export function SockGlyph({ sock, size = 1 }: { sock: Wind; size?: number }) {
  const calm = sock.spd < 3
  const len = 10 + 30 * Math.min(1, sock.spd / 15)
  const swing = sock.gust ? Math.min(20, (sock.gust - sock.spd) * 2.2) : 3
  return (
    <g transform={`scale(${size})`}>
      <circle r={4} fill="#c9ccd0" stroke="#000" strokeWidth={1} />
      {calm ? <path d="M0,0 q4,6 1,12" stroke={MAP.sock} strokeWidth={5} fill="none" strokeLinecap="round" /> : (
        <g transform={`rotate(${sock.dir + 180})`}>
          <g className="windsock-flutter" style={{ ['--swing' as string]: `${swing}deg`, animationDuration: sock.gust ? '1.1s' : '2.6s' }}>
            {Array.from({ length: 5 }, (_, i) => {
              const y0 = -(i * len) / 5, y1 = -((i + 1) * len) / 5
              const w0 = 6 - i * 0.8, w1 = 6 - (i + 1) * 0.8
              return <path key={i} d={`M${-w0},${y0} L${w0},${y0} L${w1},${y1} L${-w1},${y1} Z`} fill={i % 2 ? '#f4f4f2' : MAP.sock} stroke="#000" strokeOpacity={0.4} strokeWidth={0.6} />
            })}
          </g>
        </g>
      )}
    </g>
  )
}

export const sockText = (sock: Wind) => sock.spd < 3 ? 'Limp: calm' : `From ~${fmtHdg(Math.round(sock.dir / 10) * 10)}°, ${sock.spd >= 15 ? 'fully extended (15+ kt)' : `${Math.round(Math.min(1, sock.spd / 15) * 100)}% extended (~${sock.spd} kt)`}`

// Runway end markers used when a question asks you to pick a runway on the drawing.
export type PickState = 'idle' | 'hover' | 'picked' | 'right' | 'wrong' | 'dim'
export const PICK_COLOR: Record<PickState, string> = { idle: '#e6e6e6', hover: MAP.pattern, picked: MAP.pattern, right: 'var(--good)', wrong: 'var(--bad)', dim: '#8e8d88' }
export interface RunwayPick { state: Record<string, PickState>; onPick: (ident: string) => void; onHover?: (ident: string | null) => void }

export function RunwayPickLayer({ ap, px, pick }: { ap: Airport; px: number; pick: RunwayPick }) {
  return <>
    {ap.runways.flatMap(runwayEnds).map(e => {
      const st = pick.state[e.ident] ?? 'idle'
      const lp: Pt = [e.threshold[0] - e.dir[0] * 18 * px, e.threshold[1] - e.dir[1] * 18 * px]
      const c = PICK_COLOR[st]
      return (
        <g key={e.ident} className="cursor-pointer" onClick={() => pick.onPick(e.ident)} onPointerEnter={() => pick.onHover?.(e.ident)} onPointerLeave={() => pick.onHover?.(null)}>
          <circle cx={lp[0]} cy={-lp[1]} r={15 * px} fill={st === 'idle' ? '#1b1f22' : c} fillOpacity={st === 'idle' ? 0.95 : 0.22} stroke={c} strokeWidth={(st === 'idle' ? 1.2 : 2.2) * px} />
          <text x={lp[0]} y={-lp[1] + 4.2 * px} textAnchor="middle" fontSize={12 * px} fontWeight={700} fill={c} className="num">{e.ident}</text>
        </g>
      )
    })}
  </>
}

export type { Sample }

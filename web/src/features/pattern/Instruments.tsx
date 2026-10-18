import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { bearing, dist, fmtHdg, type Sample } from './geo'

// ForeFlight-style instrument strip: heading card, altitude, ground speed,
// distance and bearing to the field, and the radios.
export function Instruments({ s, gs, icao, com, trend, hidden, className }: {
  s: Sample; gs: number; icao: string; com?: [string, string]; trend: -1 | 0 | 1; hidden?: boolean; className?: string
}) {
  const d = dist(s.p, [0, 0])
  const brgTo = bearing(s.p, [0, 0])
  const ete = gs > 0 ? Math.round((d / gs) * 60) : null
  const Trend = trend < 0 ? ArrowDown : trend > 0 ? ArrowUp : Minus
  return (
    <div className={cn('flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4', className)}>
      <HeadingDial hdg={s.hdg} />
      <Cell label="Heading" value={`${fmtHdg(s.hdg)}°`} />
      <Cell label="Altitude" value={<span className="inline-flex items-center gap-1">{(Math.round(s.alt / 10) * 10).toLocaleString()}<Trend className="size-4 text-fg-3" /></span>} sub="ft MSL" />
      <Cell label="Ground speed" value={gs ? `${gs}` : '0'} sub="kt" />
      <Cell label={icao} value={hidden ? '—' : d < 0.2 ? 'On field' : `${d.toFixed(1)} nm`} sub={d < 0.2 ? undefined : `bearing to ${fmtHdg(brgTo)}°${ete != null && d > 0.5 ? ` · ${ete} min` : ''}`} accent />
      {com && <Cell label="COM 1 / COM 2" value={<span className="font-mono text-base">{com[0]}</span>} sub={com[1]} />}
    </div>
  )
}

function Cell({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-fg-3">{label}</div>
      <div className={cn('num text-xl font-medium leading-7', accent && 'text-accent')}>{value}</div>
      {sub && <div className="num text-sm text-fg-3">{sub}</div>}
    </div>
  )
}

function HeadingDial({ hdg }: { hdg: number }) {
  return (
    <svg viewBox="-34 -34 68 68" className="size-[4.25rem] shrink-0" role="img" aria-label={`Heading ${fmtHdg(hdg)}`}>
      <circle r={32} fill="var(--card)" stroke="var(--border-strong)" />
      <g transform={`rotate(${-hdg})`} style={{ transition: 'transform 80ms linear' }}>
        {Array.from({ length: 36 }, (_, i) => <line key={i} x1={0} y1={-31} x2={0} y2={i % 3 ? -28 : -25} stroke="var(--fg-3)" strokeWidth={i % 3 ? 0.6 : 1.1} transform={`rotate(${i * 10})`} />)}
        {['N', 'E', 'S', 'W'].map((l, i) => (
          <text key={l} transform={`rotate(${i * 90}) translate(0 -17)`} textAnchor="middle" fontSize={9} fontWeight={700} fill={l === 'N' ? 'var(--accent)' : 'var(--fg-2)'} dy={3}>{l}</text>
        ))}
      </g>
      <path d="M0,-33 L-3,-27 L3,-27 Z" fill="var(--c2)" />
      <path d="M0,-8 L1.4,-2 L7,1 L1.2,1.4 L1,6 L3,7.4 L-3,7.4 L-1,6 L-1.2,1.4 L-7,1 L-1.4,-2 Z" fill="var(--fg)" />
    </svg>
  )
}

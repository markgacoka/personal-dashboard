import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { Airport } from './airports'
import { dist, legAt, type RunwayEnd, type Sample } from './geo'
import { CESSNA_SIDE, MAP } from './art'
import { useSize } from './Scene'

// Side view. Before you answer: your altitude and distance against the field,
// pattern altitude and a 3° glidepath. While the answer flies: the altitude
// along the flown track, with each leg of the pattern named.
export function SideView({ ap, own, flight, end, hidden, className }: {
  ap: Airport; own: Sample; flight?: Sample[] | null; end?: RunwayEnd | null; hidden?: boolean; className?: string
}) {
  const [ref, size] = useSize<HTMLDivElement>()
  const W = size.w, H = size.h
  const padL = 52, padR = 16, padT = 38, padB = 26
  const agl = ap.tpa - ap.elev

  const segs = useMemo(() => {
    if (!flight || !end) return []
    const out: { label: string; s0: number; s1: number }[] = []
    for (let i = 0; i < flight.length; i += 4) {
      const l = legAt(end, flight[i], ap.elev)
      const last = out[out.length - 1]
      if (last && last.label === l) last.s1 = flight[i].s
      else out.push({ label: l, s0: flight[i].s, s1: flight[i].s })
    }
    return out.filter(g => g.s1 - g.s0 > 0.15)
  }, [flight, end, ap.elev])

  if (flight && flight.length > 1) {
    const total = flight[flight.length - 1].s
    const maxAlt = Math.max(...flight.map(s => s.alt), ap.tpa) + 300
    const minAlt = ap.elev - 80
    const x = (s: number) => padL + (s / total) * (W - padL - padR)
    const y = (a: number) => padT + (1 - (a - minAlt) / (maxAlt - minAlt)) * (H - padT - padB)
    const pts = flight.map(s => `${x(s.s).toFixed(1)},${y(s.alt).toFixed(1)}`).join(' ')
    const done = flight.filter(s => s.s <= own.s).map(s => `${x(s.s).toFixed(1)},${y(s.alt).toFixed(1)}`).join(' ')
    return (
      <div ref={ref} className={cn('relative', className)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" role="img" aria-label="Altitude along the flight">
          <Sky W={W} H={H} groundY={y(ap.elev)} />
          <AltLine y={y(ap.tpa)} x0={padL} x1={W - padR} label={`TPA ${ap.tpa.toLocaleString()}`} color={MAP.pattern} agl={agl} />
          <AltLine y={y(ap.elev)} x0={padL} x1={W - padR} label={`${ap.elev.toLocaleString()}`} color="#8e8d88" solid />
          {segs.map((g, i) => (
            <g key={i}>
              <line x1={x(g.s0)} x2={x(g.s0)} y1={padT} y2={H - padB} stroke="#fff" strokeOpacity={0.07} />
              {x(g.s1) - x(g.s0) > 46 && <text x={(x(g.s0) + x(g.s1)) / 2} y={H - 9} textAnchor="middle" fontSize={11} fill={own.s >= g.s0 && own.s <= g.s1 + 0.05 ? '#fff' : '#8e8d88'}>{g.label.replace(/^(Left|Right) /, '').replace(', abeam the numbers', '').replace(' to downwind', '')}</text>}
            </g>
          ))}
          <polyline points={pts} fill="none" stroke={MAP.ownRing} strokeOpacity={0.3} strokeWidth={2} strokeDasharray="4 4" />
          {done && <polyline points={done} fill="none" stroke={MAP.ownRing} strokeWidth={2.5} strokeLinejoin="round" />}
          <Plane x={x(own.s)} y={y(own.alt)} climb={0} />
          <text x={x(own.s)} y={y(own.alt) - 14} textAnchor={x(own.s) > W - 80 ? 'end' : 'middle'} fontSize={12} fontWeight={600} fill="#fff" className="num">{(Math.round(own.alt / 10) * 10).toLocaleString()} ft</text>
        </svg>
        <Title>Side view · altitude along the flight</Title>
      </div>
    )
  }

  // Static: distance from the field on x (field at the right), altitude on y.
  const d = dist(own.p, [0, 0])
  const maxD = Math.max(3, Math.min(30, d * 1.15 + 0.6))
  const maxAlt = Math.max(own.alt, ap.tpa) + Math.max(400, (Math.max(own.alt, ap.tpa) - ap.elev) * 0.18)
  const minAlt = ap.elev - (maxAlt - ap.elev) * 0.08
  const x = (nm: number) => W - padR - 30 - (nm / maxD) * (W - padL - padR - 40)
  const y = (a: number) => padT + (1 - (a - minAlt) / (maxAlt - minAlt)) * (H - padT - padB)
  const gpTop = Math.min(maxD, (ap.tpa - ap.elev - 50) / 318)
  const ticks = [0, 1, 2, 3, 5, 10, 15, 20, 25, 30].filter(n => n <= maxD && (maxD < 6 || n === 0 || n >= 5 || n === 2))
  const above = Math.round((own.alt - ap.tpa) / 10) * 10
  return (
    <div ref={ref} className={cn('relative', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" role="img" aria-label="Side view of your altitude against the pattern altitude">
        <Sky W={W} H={H} groundY={y(ap.elev)} />
        <AltLine y={y(ap.tpa)} x0={padL} x1={W - padR} label={`TPA ${ap.tpa.toLocaleString()}`} color={MAP.pattern} agl={agl} />
        <line x1={x(0)} y1={y(ap.elev + 50)} x2={x(gpTop)} y2={y(ap.elev + 50 + gpTop * 318)} stroke="#4ade80" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={x(gpTop) + 4} y={y(ap.elev + 50 + gpTop * 318) + 14} fontSize={11} fill="#4ade80" fillOpacity={0.85}>3° glidepath</text>
        <rect x={x(0) - 2} y={y(ap.elev) - 3} width={30} height={4} rx={1} fill={MAP.asphalt} stroke="#fff" strokeOpacity={0.6} strokeWidth={0.8} />
        <text x={x(0) + 13} y={y(ap.elev) + 16} textAnchor="middle" fontSize={11} fill="#bdbdbd">{ap.icao}</text>
        {ticks.map(n => <text key={n} x={x(n)} y={H - 6} textAnchor="middle" fontSize={11} fill="#8e8d88" className="num">{n ? `${n} nm` : ''}</text>)}
        {!hidden && <>
          <line x1={x(d)} x2={x(d)} y1={y(own.alt) + 8} y2={y(ap.elev)} stroke="#fff" strokeOpacity={0.25} strokeDasharray="2 3" />
          <Plane x={x(d)} y={y(own.alt)} climb={0} />
          <text x={x(d)} y={y(own.alt) - 14} textAnchor={x(d) < padL + 70 ? 'start' : 'middle'} fontSize={12} fontWeight={600} fill="#fff" className="num">{(Math.round(own.alt / 10) * 10).toLocaleString()} ft · {d < 0.2 ? 'over the field' : `${d.toFixed(1)} nm`}</text>
          {Math.abs(above) >= 50 && <text x={x(d) + (x(d) < W / 2 ? 10 : -10)} y={(y(own.alt) + y(ap.tpa)) / 2 + 4} textAnchor={x(d) < W / 2 ? 'start' : 'end'} fontSize={11} fill={above > 0 ? '#facc15' : '#f87171'} className="num">{Math.abs(above).toLocaleString()} ft {above > 0 ? 'above' : 'below'} TPA</text>}
        </>}
      </svg>
      <Title>Side view · {hidden ? 'your position is hidden' : 'your altitude and distance'}</Title>
    </div>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return <div className="pointer-events-none absolute left-3 top-2 text-xs font-medium text-fg-3">{children}</div>
}

function Sky({ W, H, groundY }: { W: number; H: number; groundY: number }) {
  return <>
    <defs>
      <linearGradient id="side-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0d1620" /><stop offset="1" stopColor="#131a20" /></linearGradient>
      <linearGradient id="side-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1c2219" /><stop offset="1" stopColor="#11150f" /></linearGradient>
    </defs>
    <rect width={W} height={groundY} fill="url(#side-sky)" />
    <rect y={groundY} width={W} height={Math.max(0, H - groundY)} fill="url(#side-ground)" />
  </>
}

function AltLine({ y, x0, x1, label, color, solid, agl }: { y: number; x0: number; x1: number; label: string; color: string; solid?: boolean; agl?: number }) {
  return (
    <g>
      <line x1={x0} x2={x1} y1={y} y2={y} stroke={color} strokeOpacity={solid ? 0.5 : 0.75} strokeDasharray={solid ? undefined : '6 4'} />
      <text x={x0 - 6} y={y + 4} textAnchor="end" fontSize={11} fill={color} className="num">{label.replace(/^TPA /, '')}</text>
      {!solid && <text x={x0 + 4} y={y - 5} fontSize={11} fontWeight={600} fill={color}>Pattern altitude{agl ? ` · ${agl.toLocaleString()} ft above the field` : ''}</text>}
    </g>
  )
}

function Plane({ x, y }: { x: number; y: number; climb: number }) {
  return <g transform={`translate(${x} ${y}) scale(0.95)`}><path d={CESSNA_SIDE} fill="#fff" stroke="#000" strokeWidth={0.8} strokeLinejoin="round" /></g>
}

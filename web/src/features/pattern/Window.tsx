import { cn } from '@/lib/utils'
import type { Lights } from './model'

// What you see over the cowling on final: the runway in perspective with the
// PAPI (four boxes, left of the runway) or VASI (two bars) lit as the step says.
export function WindowView({ lights, rwy, className }: { lights: Lights; rwy: string; className?: string }) {
  const W = 400, H = 220, hz = 92
  const glow = (c: 'W' | 'R') => (c === 'W' ? '#fffbe8' : '#ff3b30')
  return (
    <div className={cn('relative', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${lights.kind} showing ${lights.colors.join(' ')}`}>
        <defs>
          <linearGradient id="win-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b1a2e" /><stop offset="1" stopColor="#2a3c55" /></linearGradient>
          <linearGradient id="win-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#26301f" /><stop offset="1" stopColor="#141a10" /></linearGradient>
          <filter id="win-glow" x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="2.4" /></filter>
        </defs>
        <rect width={W} height={hz} fill="url(#win-sky)" />
        <rect y={hz} width={W} height={H - hz} fill="url(#win-ground)" />
        <path d={`M184,${hz + 6} L216,${hz + 6} L262,${H} L138,${H} Z`} fill="#3d4146" />
        <path d={`M200,${hz + 10} L200,${H}`} stroke="#f4f4f2" strokeOpacity={0.8} strokeWidth={1.4} strokeDasharray="7 7" />
        {Array.from({ length: 8 }, (_, k) => {
          const x0 = 186 + k * 3.7 + (k > 3 ? 2.4 : 0)
          return <path key={k} d={`M${x0},${hz + 8} L${x0 + 2.2},${hz + 8} L${x0 + 2.6 + (k - 3.5) * 0.9},${hz + 22} L${x0 + 0.2 + (k - 3.5) * 0.9},${hz + 22} Z`} fill="#f4f4f2" opacity={0.85} />
        })}
        <text x={200} y={hz + 46} textAnchor="middle" fontSize={20} fontWeight={700} fill="#f4f4f2" opacity={0.9} transform={`translate(200 ${hz + 46}) scale(1 0.45) translate(-200 ${-(hz + 46)})`}>{rwy}</text>
        {lights.kind === 'PAPI' ? lights.colors.map((c, i) => {
          const x = 132 + i * 11
          return <g key={i}><circle cx={x} cy={hz + 16} r={6} fill={glow(c)} filter="url(#win-glow)" opacity={0.9} /><circle cx={x} cy={hz + 16} r={2.6} fill={glow(c)} /></g>
        }) : lights.colors.map((c, i) => (
          <g key={i}>
            {[0, 1, 2].map(k => {
              const x = 146 + k * 8, yv = hz + (i ? 26 : 12)
              return <g key={k}><circle cx={x} cy={yv} r={5} fill={glow(c)} filter="url(#win-glow)" opacity={0.85} /><circle cx={x} cy={yv} r={2.2} fill={glow(c)} /></g>
            })}
          </g>
        ))}
        <path d={`M0,${H} L0,${H - 26} C120,${H - 42} 280,${H - 42} ${W},${H - 26} L${W},${H} Z`} fill="#0a0a0a" />
      </svg>
      <div className="pointer-events-none absolute left-3 top-2 text-xs font-medium text-fg-2">Out the window · {lights.kind} left of runway {rwy}</div>
    </div>
  )
}

import type { Runway } from '@/lib/types'

// Runways drawn to scale-free headings with the wind arrow on top. The
// wind-favoured runway end is highlighted in the accent colour.
export function WindCompass({ wdir, wspd, wgst, runways, best, size = 176 }: {
  wdir: number | 'VRB' | null; wspd: number; wgst: number | null; runways: Runway[]; best?: string | null; size?: number
}) {
  const R = 64
  const calm = !wspd || wspd < 2
  const vrb = wdir === 'VRB' || wdir == null

  // Parallel runways (same heading ±12°) are offset side by side.
  const groups: Runway[][] = []
  for (const r of runways) {
    const canon = (((r.le_hdg - 1) % 180) + 180) % 180
    const g = groups.find(g => { const c = (((g[0].le_hdg - 1) % 180) + 180) % 180; const d = Math.abs(c - canon); return d < 12 || d > 168 })
    if (g) g.push(r); else groups.push([r])
  }

  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} className="shrink-0 overflow-visible" role="img"
      aria-label={calm ? 'Wind calm' : vrb ? `Wind variable at ${wspd} knots` : `Wind from ${wdir} degrees at ${wspd} knots`}>
      <circle r={R} fill="none" stroke="var(--border-strong)" strokeWidth={1} />
      {Array.from({ length: 72 }, (_, i) => {
        const a = (i * 5 * Math.PI) / 180
        const major = i % 18 === 0, mid = i % 6 === 0
        const inner = major ? R - 9 : mid ? R - 6 : R - 3
        return <line key={i} x1={Math.sin(a) * R} y1={-Math.cos(a) * R} x2={Math.sin(a) * inner} y2={-Math.cos(a) * inner} stroke="var(--border-strong)" strokeWidth={major ? 1.5 : 0.75} />
      })}
      {(['N', 'E', 'S', 'W'] as const).map((c, i) => {
        const a = (i * 90 * Math.PI) / 180
        return <text key={c} x={Math.sin(a) * (R + 12)} y={-Math.cos(a) * (R + 12) + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--fg-3)">{c}</text>
      })}
      {groups.flatMap(g => g.map((r, gi) => {
        const off = g.length > 1 ? (gi - (g.length - 1) / 2) * 16 : 0
        const on = r.le_ident === best || r.he_ident === best
        const len = R - 12
        const num = (h: number) => String(Math.round(h / 10) || 36).padStart(2, '0')
        return (
          <g key={`${r.le_ident}-${r.he_ident}`} transform={`rotate(${r.he_hdg}) translate(${off} 0)`}>
            <rect x={-5.5} y={-len} width={11} height={len * 2} rx={2} fill={on ? 'var(--accent-soft)' : 'var(--sunken)'} stroke={on ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={on ? 1.5 : 1} />
            {on && <line x1={0} y1={-len + 4} x2={0} y2={len - 4} stroke="var(--accent)" strokeWidth={0.75} strokeDasharray="4 3" />}
            <text y={-len - 5} textAnchor="middle" fontSize={9} fontWeight={600} fill={on ? 'var(--accent)' : 'var(--fg-3)'}>{num(r.he_hdg)}</text>
            <text y={len + 13} textAnchor="middle" fontSize={9} fontWeight={600} fill={on ? 'var(--accent)' : 'var(--fg-3)'}>{num(r.le_hdg)}</text>
          </g>
        )
      }))}
      <circle r={22} fill="var(--card)" stroke="var(--border)" />
      {calm ? (
        <text y={4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--good)">CALM</text>
      ) : (
        <>
          {!vrb && (
            <g transform={`rotate(${wdir})`}>
              <line x1={0} y1={-R + 2} x2={0} y2={-24} stroke="var(--fg)" strokeWidth={2.5} strokeLinecap="round" />
              <path d={`M0 -24 L-6 -35 L6 -35 Z`} fill="var(--fg)" />
            </g>
          )}
          <text y={3} textAnchor="middle" fontSize={16} fontWeight={700} fill="var(--fg)" className="num">{wspd}</text>
          <text y={15} textAnchor="middle" fontSize={9} fill="var(--fg-3)">{wgst ? `G${wgst}` : vrb ? 'VRB' : 'kt'}</text>
        </>
      )}
    </svg>
  )
}

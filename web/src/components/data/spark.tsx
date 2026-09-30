import { useId } from 'react'

// Tiny trend line with an end dot; no axes, so it's never the only carrier of a value.
export function Sparkline({ values, width = 120, height = 36, color = 'var(--accent)', fill = true, className }: {
  values: number[]; width?: number; height?: number; color?: string; fill?: boolean; className?: string
}) {
  const id = useId()
  const pts = values.filter(v => Number.isFinite(v))
  if (pts.length < 2) return <svg width={width} height={height} className={className} />
  const min = Math.min(...pts), max = Math.max(...pts)
  const pad = 4
  const x = (i: number) => pad + (i / (pts.length - 1)) * (width - pad * 2)
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2))
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.18} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${d} L${x(pts.length - 1)} ${height} L${x(0)} ${height} Z`} fill={`url(#${id})`} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r={3.5} fill={color} stroke="var(--card)" strokeWidth={2} />
    </svg>
  )
}

// Circular gauge for a 0–100 score.
export function Ring({ value, size = 64, stroke = 6, color = 'var(--accent)', children }: { value: number | null; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth={stroke} />
        {value != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} className="transition-[stroke-dasharray] duration-700" />}
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}

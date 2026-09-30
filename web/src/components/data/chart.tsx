import type { TooltipContentProps } from 'recharts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTip = TooltipContentProps<any, any>
import { cn } from '@/lib/utils'

// Shared Recharts anatomy: recessive hairline grid, muted 12px tick text,
// no axis lines, and one tooltip style everywhere.
export const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: 'var(--axis)', fontSize: 12, fontFamily: 'var(--font-sans)' },
  tickMargin: 8,
} as const

export const gridProps = { stroke: 'var(--grid)', strokeDasharray: '0', vertical: false } as const

export const cursorLine = { stroke: 'var(--border-strong)', strokeWidth: 1 }
export const cursorBand = { fill: 'var(--hover)', opacity: 0.6 }

export interface TipRow { color?: string; label: React.ReactNode; value: React.ReactNode }

export function TipBox({ title, rows, footer }: { title?: React.ReactNode; rows: TipRow[]; footer?: React.ReactNode }) {
  return (
    <div className="min-w-36 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-pop">
      {title && <div className="mb-1 text-xs font-medium text-fg-3">{title}</div>}
      <div className="space-y-0.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            {r.color && <span className="size-2 shrink-0 rounded-[2px]" style={{ background: r.color }} />}
            <span className="flex-1 text-fg-2">{r.label}</span>
            <span className="num font-medium text-fg">{r.value}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-border pt-1.5 text-xs text-fg-3">{footer}</div>}
    </div>
  )
}

// Recharts tooltip adapter: `format` turns one payload entry into a row.
export function makeTip<T = Record<string, unknown>>(opts: {
  title?: (row: T) => React.ReactNode
  rows?: (row: T, payload: AnyTip['payload']) => TipRow[]
  footer?: (row: T) => React.ReactNode
}) {
  return function Tip(props: AnyTip) {
    const { active, payload } = props
    if (!active || !payload?.length) return null
    const row = payload[0].payload as T
    const rows = opts.rows ? opts.rows(row, payload) : payload.map(p => ({ color: p.color as string, label: p.name, value: p.value }))
    if (!rows.length) return null
    return <TipBox title={opts.title?.(row)} rows={rows} footer={opts.footer?.(row)} />
  }
}

export function Legend({ items, className }: { items: { label: React.ReactNode; color: string; dashed?: boolean }[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-2', className)}>
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {it.dashed
            ? <span className="h-0 w-3 border-t-2 border-dashed" style={{ borderColor: it.color }} />
            : <span className="size-2.5 rounded-[3px]" style={{ background: it.color }} />}
          {it.label}
        </span>
      ))}
    </div>
  )
}

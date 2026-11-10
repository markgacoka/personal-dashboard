import { AlertTriangle, CheckCircle2, CircleDashed, RefreshCw, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tooltip } from '@/components/ui/misc'
import { relTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Check, Status } from './model'

export const STATUS_META: Record<Status, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; icon: typeof CheckCircle2; text: string }> = {
  ok: { label: 'OK', tone: 'good', icon: CheckCircle2, text: 'text-good' },
  caution: { label: 'Caution', tone: 'warn', icon: AlertTriangle, text: 'text-warn' },
  nogo: { label: 'No-go', tone: 'bad', icon: XCircle, text: 'text-bad' },
  todo: { label: 'To do', tone: 'neutral', icon: CircleDashed, text: 'text-fg-3' },
}

export function StatusBadge({ status, label, size = 'sm' }: { status: Status; label?: string; size?: 'sm' | 'md' }) {
  const m = STATUS_META[status]
  return <Badge tone={m.tone} size={size}><m.icon />{label ?? m.label}</Badge>
}

export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const m = STATUS_META[status]
  return <m.icon aria-label={m.label} className={cn('size-4 shrink-0', m.text, className)} />
}

// When a block of data was fetched or issued, and where from.
export function Synced({ at, label = 'Fetched', source, className, onRefresh, refreshing }: { at?: string | number | Date | null; label?: string; source?: string; className?: string; onRefresh?: () => void; refreshing?: boolean }) {
  if (!at && !source) return null
  const d = at ? new Date(at) : null
  return (
    <div className={cn('flex flex-wrap items-center gap-x-1.5 text-xs text-fg-3', className)}>
      {d && <Tooltip content={d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}><span>{label} {relTime(d)}</span></Tooltip>}
      {d && source && <span aria-hidden>·</span>}
      {source && <span>{source}</span>}
      {onRefresh && <button onClick={onRefresh} className="ml-1 inline-flex items-center gap-1 text-accent hover:underline" aria-label="Refresh"><RefreshCw className={cn('size-3', refreshing && 'animate-spin')} />Refresh</button>}
    </div>
  )
}

export function Section({ id, n, question, answer, status, children, action }: { id: string; n: number; question: string; answer?: React.ReactNode; status: Status; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <Card>
        <header className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
          <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-pill text-sm font-medium text-fg-2">{n}</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-medium tracking-[-0.011em] text-fg">{question}</h2>
            {answer && <div className="mt-0.5 text-sm text-fg-3">{answer}</div>}
          </div>
          <div className="flex items-center gap-2">{action}<StatusBadge status={status} size="md" /></div>
        </header>
        <div className="space-y-6 px-5 py-5 sm:px-6">{children}</div>
      </Card>
    </section>
  )
}

export function SubHead({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-medium text-fg-2">{children}</h3>{right}</div>
}

export function CheckRows({ checks, onJump }: { checks: Check[]; onJump?: (c: Check) => void }) {
  if (!checks.length) return null
  return (
    <ul className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
      {checks.map((c, i) => (
        <li key={i} className={cn('flex gap-3 px-3 py-2.5', onJump && 'cursor-pointer hover:bg-hover')} onClick={() => onJump?.(c)}>
          <StatusIcon status={c.status} className="mt-0.5" />
          <div className="min-w-0">
            <div className="text-sm text-fg">{c.title}</div>
            {c.detail && <div className="mt-0.5 text-sm text-fg-3">{c.detail}</div>}
            {c.fix && c.status !== 'ok' && <div className="mt-0.5 text-sm text-fg-2"><span className="font-medium">To fix:</span> {c.fix}</div>}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function NumField({ label, value, onChange, unit, min, max, step, hint, className }: { label: string; value: number | ''; onChange: (v: number) => void; unit?: string; min?: number; max?: number; step?: number; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-sm text-fg-2">{label}</span>
      <span className="relative block">
        <Input type="number" inputMode="decimal" value={value} min={min} max={max} step={step} onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))} className={cn('num', unit && 'pr-12')} />
        {unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-3">{unit}</span>}
      </span>
      {hint && <span className="mt-1 block text-xs text-fg-3">{hint}</span>}
    </label>
  )
}

export function KV({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm', className)}>
      {items.filter(([, v]) => v != null && v !== '').map(([k, v], i) => (
        <div key={i} className="contents"><dt className="text-fg-3">{k}</dt><dd className="min-w-0 text-fg">{v}</dd></div>
      ))}
    </dl>
  )
}

export const CAT_COLOR: Record<string, string> = { VFR: 'var(--good)', MVFR: 'var(--c1)', IFR: 'var(--bad)', LIFR: 'var(--c5)' }
export function Cat({ cat }: { cat: string | null | undefined }) {
  if (!cat) return <Badge>No report</Badge>
  return <span className="inline-flex h-[1.375rem] items-center rounded-full px-2 font-mono text-xs font-semibold" style={{ color: CAT_COLOR[cat], background: `color-mix(in oklch, ${CAT_COLOR[cat]} 16%, transparent)` }}>{cat}</span>
}

export const fmtTime = (d: Date | null | undefined) => (d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—')
export const hhmm = (d: Date | null | undefined) => (d ? `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}` : '—')
export const fmtZ = (d: Date | null | undefined) => (d ? `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z` : '—')
export const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}` : `0:${String(Math.round(m)).padStart(2, '0')}`)
export const deg3 = (d: number | null | undefined) => (d == null || Number.isNaN(d) ? '—' : String(Math.round(((d % 360) + 360) % 360) || 360).padStart(3, '0'))

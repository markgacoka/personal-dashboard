import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/misc'

// A labelled figure. Figures are mono/tabular so columns of them line up.
export function Stat({ label, value, unit, sub, tone, size = 'md', className, hint, money }: {
  label: React.ReactNode; value: React.ReactNode; unit?: React.ReactNode; sub?: React.ReactNode
  tone?: 'good' | 'warn' | 'bad' | 'muted'; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string; hint?: string; money?: boolean
}) {
  const sz = { sm: 'text-lg', md: 'text-2xl', lg: 'text-3xl', xl: 'text-4xl' }[size]
  const toneCls = tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : tone === 'muted' ? 'text-fg-3' : 'text-fg'
  const lbl = <div className="text-sm text-fg-3">{label}</div>
  return (
    <div className={cn('min-w-0', className)}>
      {hint ? <Tooltip content={hint}><div className="w-fit cursor-help underline decoration-border-strong decoration-dotted underline-offset-4">{lbl}</div></Tooltip> : lbl}
      <div className={cn('mt-1 flex items-baseline gap-1 font-semibold tracking-tight', sz, toneCls)}>
        <span className={cn('num', money && 'money')}>{value ?? '—'}</span>
        {unit && value != null && value !== '—' && <span className="text-sm font-normal text-fg-3">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 truncate text-sm text-fg-3">{sub}</div>}
    </div>
  )
}

export function PageHeader({ title, description, actions, children, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <div className="mt-1 text-base text-fg-3">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children}
    </div>
  )
}

export function Money({ value, className }: { value: React.ReactNode; className?: string }) {
  return <span className={cn('num money', className)}>{value}</span>
}

// Key/value rows for detail panels.
export function DL({ items, className, cols = 1 }: { items: [React.ReactNode, React.ReactNode][]; className?: string; cols?: 1 | 2 }) {
  const rows = items.filter(([, v]) => v != null && v !== '' && v !== false)
  if (!rows.length) return null
  return (
    <dl className={cn('grid gap-x-6', cols === 2 ? 'sm:grid-cols-2' : '', className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0 sm:[&:nth-last-child(2)]:border-0">
          <dt className="shrink-0 text-sm text-fg-3">{k}</dt>
          <dd className="min-w-0 text-right text-sm text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

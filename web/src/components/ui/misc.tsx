import { Switch as RSwitch, Tabs as RTabs, Tooltip as RTooltip, Progress as RProgress, Separator as RSeparator } from 'radix-ui'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export function Skeleton({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton', className)} {...p} />
}

export function Switch({ className, ...p }: React.ComponentProps<typeof RSwitch.Root>) {
  return (
    <RSwitch.Root className={cn('peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-border-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50', className)} {...p}>
      <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4" />
    </RSwitch.Root>
  )
}

export function Separator({ className, ...p }: React.ComponentProps<typeof RSeparator.Root>) {
  return <RSeparator.Root className={cn('shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:h-full', className)} {...p} />
}

export const TooltipProvider = RTooltip.Provider
export function Tooltip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-50 max-w-72 rounded-md bg-fg px-2.5 py-1.5 text-xs text-bg shadow-pop animate-in">{content}</RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

export function Progress({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'good' | 'warn' | 'bad' }) {
  const color = { accent: 'bg-accent', good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad' }[tone]
  return (
    <RProgress.Root value={value} className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-border', className)}>
      <RProgress.Indicator className={cn('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </RProgress.Root>
  )
}

export const Tabs = RTabs.Root
export function TabsList({ className, ...p }: React.ComponentProps<typeof RTabs.List>) {
  return <RTabs.List className={cn('inline-flex items-center gap-1 border-b border-border', className)} {...p} />
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof RTabs.Trigger>) {
  return <RTabs.Trigger className={cn('-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-sm font-medium text-fg-3 transition-colors hover:text-fg data-[state=active]:border-fg data-[state=active]:text-fg [&_svg]:size-4', className)} {...p} />
}
export const TabsContent = RTabs.Content

// Segmented control: a small set of mutually exclusive filters.
export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; count?: number }[]; className?: string; size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-sunken p-0.5 ring-1 ring-inset ring-border scrollbar-none', className)}>
      {options.map(o => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 font-medium text-fg-3 transition-colors hover:text-fg',
            size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
            value === o.value && 'bg-card text-fg shadow-[0_1px_2px_oklch(0_0_0/0.08)] ring-1 ring-border')}>
          {o.label}
          {o.count != null && <span className="tnum text-xs text-fg-3">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action, className }: { icon?: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {Icon && <div className="mb-3 grid size-10 place-items-center rounded-full bg-sunken ring-1 ring-border"><Icon className="size-5 text-fg-3" /></div>}
      <div className="text-base font-medium text-fg">{title}</div>
      {children && <p className="mt-1 max-w-sm text-sm text-fg-3">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-sunken px-1 font-mono text-[11px] text-fg-3', className)}>{children}</kbd>
}

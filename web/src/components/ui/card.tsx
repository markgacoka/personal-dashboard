import { cn } from '@/lib/utils'

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl bg-card ring-1 ring-inset ring-white/[0.04]', className)} {...p} />
}

export function CardHeader({ title, description, action, className, icon }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return (
    <div className={cn('flex items-start gap-3 px-5 pt-5 pb-3 sm:px-6', className)}>
      {icon && <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-pill text-fg-2 -translate-y-0.5 [&_svg]:size-3.5">{icon}</div>}
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-medium tracking-[-0.011em] text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-fg-3">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5 sm:px-6 sm:pb-6', className)} {...p} />
}

import { cn } from '@/lib/utils'

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-card shadow-card', className)} {...p} />
}

export function CardHeader({ title, description, action, className, icon }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return (
    <div className={cn('flex items-start gap-3 px-5 pt-4 pb-3', className)}>
      {icon && <div className="mt-0.5 text-fg-3 [&_svg]:size-4">{icon}</div>}
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold tracking-tight text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-fg-3">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...p} />
}

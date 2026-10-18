import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium [&_svg]:size-3 [&_svg]:shrink-0', {
  variants: {
    tone: {
      neutral: 'bg-pill text-fg-2',
      accent: 'bg-accent-soft text-accent',
      good: 'bg-good-soft text-good',
      warn: 'bg-warn-soft text-warn',
      bad: 'bg-bad-soft text-bad',
      outline: 'text-fg-2 ring-1 ring-inset ring-border',
    },
    size: { sm: 'h-[1.375rem] px-2 text-xs', md: 'h-7 px-3 text-sm' },
  },
  defaultVariants: { tone: 'neutral', size: 'sm' },
})

export function Badge({ className, tone, size, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...p} />
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: color }} />
}

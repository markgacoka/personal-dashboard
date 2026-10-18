import { forwardRef } from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'press inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium tracking-[-0.006em] disabled:opacity-40 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 select-none',
  {
    variants: {
      variant: {
        primary: 'bg-fg text-bg hover:bg-fg/88',
        secondary: 'bg-pill text-fg hover:bg-pill-hover',
        ghost: 'text-fg-2 hover:bg-pill hover:text-fg',
        danger: 'bg-bad text-black hover:opacity-90',
        'danger-ghost': 'text-bad hover:bg-bad-soft',
        link: 'text-accent hover:underline underline-offset-4 px-0 h-auto active:scale-100',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-5 text-base',
        icon: 'size-9',
        'icon-sm': 'size-8 [&_svg]:size-[0.9375rem]',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {asChild ? children : <>{loading && <Loader2 className="animate-spin" />}{children}</>}
    </Comp>
  )
})
Button.displayName = 'Button'

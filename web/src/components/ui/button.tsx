import { forwardRef } from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background,color,box-shadow,opacity] duration-150 disabled:opacity-50 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 select-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-[inset_0_1px_0_oklch(1_0_0/0.12)]',
        secondary: 'bg-card text-fg border border-border hover:bg-hover hover:border-border-strong shadow-card',
        ghost: 'text-fg-2 hover:bg-hover hover:text-fg',
        danger: 'bg-bad text-white hover:opacity-90',
        'danger-ghost': 'text-bad hover:bg-bad-soft',
        link: 'text-accent hover:underline underline-offset-4 px-0 h-auto',
      },
      size: {
        sm: 'h-8 px-2.5 text-sm',
        md: 'h-9 px-3.5 text-sm',
        lg: 'h-10 px-4 text-base',
        icon: 'size-9',
        'icon-sm': 'size-8 [&_svg]:size-[15px]',
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

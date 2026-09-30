import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

const field = 'w-full rounded-md border border-border bg-card px-3 text-sm text-fg placeholder:text-fg-3 transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) =>
  <input ref={ref} className={cn(field, 'h-9', className)} {...p} />)
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) =>
  <textarea ref={ref} className={cn(field, 'min-h-20 py-2 leading-relaxed', className)} {...p} />)
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) =>
  <select ref={ref} className={cn(field, 'h-9 appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat pr-8', className)}
    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E")` }} {...p} />)
Select.displayName = 'Select'

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-sm font-medium text-fg-2', className)} {...p} />
}

export function Field({ label, hint, children, className, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-fg-3">{hint}</p>}
    </div>
  )
}

import { Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover, AlertDialog as RAlert } from 'radix-ui'
import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

// ── Dialog: centred on desktop, a full-height sheet from the bottom on phones ─
export const Dialog = RDialog.Root
export const DialogTrigger = RDialog.Trigger
export const DialogClose = RDialog.Close

export function DialogContent({ title, description, children, className, footer, wide }: {
  title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string; footer?: React.ReactNode; wide?: boolean
}) {
  return (
    <RDialog.Portal>
      <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <RDialog.Content className={cn(
        'fixed z-50 flex flex-col bg-card shadow-pop outline-none data-[state=open]:animate-in',
        'inset-x-0 bottom-0 top-8 rounded-t-xl border-t border-border',
        'sm:inset-auto sm:left-1/2 sm:top-[6vh] sm:max-h-[88vh] sm:w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:rounded-xl sm:border',
        wide ? 'sm:max-w-4xl' : 'sm:max-w-lg', className)}>
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <RDialog.Title className="text-lg font-semibold tracking-tight">{title}</RDialog.Title>
            {description ? <RDialog.Description className="mt-0.5 text-sm text-fg-3">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{String(title)}</RDialog.Description>}
          </div>
          <RDialog.Close asChild><Button variant="ghost" size="icon-sm" aria-label="Close"><X /></Button></RDialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex items-center gap-2 border-t border-border px-5 py-3 pb-safe">{footer}</div>}
      </RDialog.Content>
    </RDialog.Portal>
  )
}

// ── Menu ─────────────────────────────────────────────────────────────────────
export const Menu = RMenu.Root
export const MenuTrigger = RMenu.Trigger
export function MenuContent({ className, align = 'end', ...p }: React.ComponentProps<typeof RMenu.Content>) {
  return (
    <RMenu.Portal>
      <RMenu.Content align={align} sideOffset={6} collisionPadding={8} className={cn('z-50 min-w-48 rounded-lg border border-border bg-card p-1 shadow-pop data-[state=open]:animate-in', className)} {...p} />
    </RMenu.Portal>
  )
}
export function MenuItem({ className, danger, ...p }: React.ComponentProps<typeof RMenu.Item> & { danger?: boolean }) {
  return <RMenu.Item className={cn('flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-sm text-fg outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-fg-3', danger && 'text-bad [&_svg]:text-bad', className)} {...p} />
}
export function MenuLabel({ className, ...p }: React.ComponentProps<typeof RMenu.Label>) {
  return <RMenu.Label className={cn('px-2 pb-1 pt-1.5 text-xs font-medium text-fg-3', className)} {...p} />
}
export const MenuSeparator = () => <RMenu.Separator className="my-1 h-px bg-border" />

// ── Popover ──────────────────────────────────────────────────────────────────
export const Popover = RPopover.Root
export const PopoverTrigger = RPopover.Trigger
export const PopoverAnchor = RPopover.Anchor
export function PopoverContent({ className, align = 'start', ...p }: React.ComponentProps<typeof RPopover.Content>) {
  return (
    <RPopover.Portal>
      <RPopover.Content align={align} sideOffset={6} collisionPadding={8} className={cn('z-50 rounded-lg border border-border bg-card p-3 shadow-pop outline-none data-[state=open]:animate-in', className)} {...p} />
    </RPopover.Portal>
  )
}

// ── Confirm: an awaitable alert dialog (no browser dialogs) ──────────────────
type ConfirmOpts = { title: string; body?: React.ReactNode; confirm?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null)
  const resolver = useRef<(v: boolean) => void>(null)
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>(res => { resolver.current = res; setOpts(o) }), [])
  const done = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null) }
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <RAlert.Root open={!!opts} onOpenChange={o => !o && done(false)}>
        <RAlert.Portal>
          <RAlert.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in" />
          <RAlert.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-pop data-[state=open]:animate-in">
            <RAlert.Title className="text-base font-semibold">{opts?.title}</RAlert.Title>
            <RAlert.Description asChild><div className="mt-1.5 text-sm text-fg-2">{opts?.body}</div></RAlert.Description>
            <div className="mt-5 flex justify-end gap-2">
              <RAlert.Cancel asChild><Button>Cancel</Button></RAlert.Cancel>
              <RAlert.Action asChild><Button variant={opts?.danger ? 'danger' : 'primary'} onClick={() => done(true)}>{opts?.confirm || 'Confirm'}</Button></RAlert.Action>
            </div>
          </RAlert.Content>
        </RAlert.Portal>
      </RAlert.Root>
    </ConfirmCtx.Provider>
  )
}

import { Command } from 'cmdk'
import { Dialog as RDialog } from 'radix-ui'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, LogOut, Moon, PenLine, Plane, Plus, Search, Sun } from 'lucide-react'
import { usePrefs } from '@/lib/prefs'
import { useFlights } from '@/lib/queries'
import { route, trainingLabel } from '@/lib/flying'
import { calDate } from '@/lib/format'
import { sportOf, SPORTS } from '@/lib/sports'
import type { Activity } from '@/lib/types'
import { ALL_NAV } from './nav'
import { signOut } from '@/lib/auth'

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { resolved, setTheme, toggleMask, masked } = usePrefs()
  const { data: flights } = useFlights()
  // Activities come from whatever is already cached; the palette never triggers a Garmin read.
  const activities = (qc.getQueryData<Activity[]>(['activities']) || []).slice(0, 60)

  const run = (fn: () => void) => { onOpenChange(false); fn() }
  const item = 'flex h-10 cursor-default select-none items-center gap-3 rounded-md px-3 text-sm text-fg data-[selected=true]:bg-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-3'
  const group = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-3'

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <RDialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-pop outline-none data-[state=open]:animate-in">
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <RDialog.Description className="sr-only">Search pages, flights and actions</RDialog.Description>
          <Command loop className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 text-fg-3" />
              <Command.Input autoFocus placeholder="Search pages, flights, activities, actions…" className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-fg-3" />
            </div>
            <Command.List className="max-h-[min(60vh,440px)] overflow-y-auto p-1.5">
              <Command.Empty className="py-10 text-center text-sm text-fg-3">No results</Command.Empty>
              <Command.Group heading="Go to" className={group}>
                {ALL_NAV.map(n => (
                  <Command.Item key={n.to} value={`${n.label} ${n.keywords || ''}`} onSelect={() => run(() => navigate(n.to))} className={item}>
                    <n.icon />{n.label}
                  </Command.Item>
                ))}
                <Command.Item value="mail settings filters labels templates signatures" onSelect={() => run(() => navigate('/mail/settings'))} className={item}><PenLine />Mail settings</Command.Item>
              </Command.Group>
              <Command.Group heading="Actions" className={group}>
                <Command.Item value="log a flight new" onSelect={() => run(() => navigate('/flying?log=1'))} className={item}><Plus />Log a flight</Command.Item>
                <Command.Item value="compose new email message" onSelect={() => run(() => navigate('/mail?compose=1'))} className={item}><PenLine />Compose email</Command.Item>
                <Command.Item value="toggle theme dark light" onSelect={() => run(() => setTheme(resolved === 'dark' ? 'light' : 'dark'))} className={item}>{resolved === 'dark' ? <Sun /> : <Moon />}Switch to {resolved === 'dark' ? 'light' : 'dark'} theme</Command.Item>
                <Command.Item value="privacy balances hide show mask" onSelect={() => run(toggleMask)} className={item}><Eye />{masked ? 'Show' : 'Hide'} balances</Command.Item>
                <Command.Item value="sign out log out" onSelect={() => run(signOut)} className={item}><LogOut />Sign out</Command.Item>
              </Command.Group>
              {!!flights?.length && (
                <Command.Group heading="Flights" className={group}>
                  {flights.map(f => (
                    <Command.Item key={f.id} value={`flight ${route(f).join(' ')} ${calDate(f.date, { year: 'numeric', month: 'long', day: 'numeric' })} ${f.aircraft?.tail_number} ${trainingLabel(f.training_type)}`} onSelect={() => run(() => navigate(`/flying/${f.id}`))} className={item}>
                      <Plane /><span className="num">{route(f).join(' → ')}</span>
                      <span className="ml-auto text-xs text-fg-3">{calDate(f.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!activities.length && (
                <Command.Group heading="Activities" className={group}>
                  {activities.map(a => {
                    const s = SPORTS[sportOf(a)]
                    return (
                      <Command.Item key={a.activityId} value={`activity ${a.activityName} ${s.label} ${a.startTimeLocal.slice(0, 10)}`} onSelect={() => run(() => navigate(`/training/${a.activityId}`))} className={item}>
                        <s.icon /><span className="truncate">{a.activityName || s.label}</span>
                        <span className="ml-auto shrink-0 text-xs text-fg-3">{new Date(a.startTimeLocal).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </Command.Item>
                    )
                  })}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

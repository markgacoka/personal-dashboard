import { useState } from 'react'
import { ArrowRight, ChevronRight, ExternalLink } from 'lucide-react'
import { Segmented } from '@/components/ui/misc'
import { relTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Check, Status } from './model'
import { PohLink } from './RefPanel'
import { StatusIcon } from './ui'
import type { Assumption, Source, Topic } from './workings'

export type DomainKey = 'plan' | 'pilot' | 'aircraft' | 'weather' | 'route' | 'airports' | 'loading'
export const DOMAIN_OF: Record<Check['section'], DomainKey> = { trip: 'plan', pilot: 'pilot', aircraft: 'aircraft', weather: 'weather', navlog: 'route', loading: 'loading', performance: 'loading' }
export const DOMAIN_LABEL: Record<DomainKey, string> = { plan: 'Plan', pilot: 'Pilot', aircraft: 'Aircraft', weather: 'Weather', route: 'Route and fuel', airports: 'Airports', loading: 'Weight and performance' }
const RANK: Status[] = ['nogo', 'caution', 'todo', 'ok']
const GROUP: Record<Exclude<Status, 'ok'>, string> = { nogo: 'No-go: fix before you fly', caution: 'Cautions: decide on each', todo: 'Still to do' }

// Every check that isn't OK, worst first, each with what to do and where.
export function FixesPane({ checks, onJump }: { checks: Check[]; onJump: (k: DomainKey) => void }) {
  const [showOk, setShowOk] = useState(false)
  const open = checks.filter(c => c.status !== 'ok').sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status))
  const ok = checks.filter(c => c.status === 'ok')
  return (
    <div className="space-y-5 px-3 py-3">
      {!open.length && <p className="px-1 text-sm text-fg-2">Nothing to fix: every check passed. Read the workings, then get a standard briefing before you go.</p>}
      {(['nogo', 'caution', 'todo'] as const).map(s => {
        const list = open.filter(c => c.status === s)
        if (!list.length) return null
        return (
          <section key={s}>
            <h3 className={cn('mb-1.5 flex items-center gap-2 px-1 text-sm font-medium', s === 'nogo' ? 'text-bad' : s === 'caution' ? 'text-warn' : 'text-fg-2')}><StatusIcon status={s} />{GROUP[s]}<span className="num text-fg-3">{list.length}</span></h3>
            <ul className="space-y-1">
              {list.map((c, i) => (
                <li key={i}>
                  <button onClick={() => onJump(DOMAIN_OF[c.section])} className="group w-full rounded-lg px-2.5 py-2 text-left hover:bg-hover">
                    <span className="block text-sm text-fg">{c.title}</span>
                    {c.detail && <span className="mt-0.5 block text-[13px] leading-snug text-fg-3">{c.detail}</span>}
                    {c.fix && <span className="mt-1 flex gap-1.5 text-[13px] leading-snug text-fg-2"><ArrowRight className="mt-0.5 size-3.5 shrink-0 text-accent" />{c.fix}</span>}
                    <span className="mt-1 inline-flex items-center gap-0.5 text-xs text-fg-3 group-hover:text-accent">{DOMAIN_LABEL[DOMAIN_OF[c.section]]}<ChevronRight className="size-3" /></span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {ok.length > 0 && (
        <section>
          <button onClick={() => setShowOk(v => !v)} aria-expanded={showOk} className="flex w-full items-center gap-2 px-1 text-sm text-fg-3 hover:text-fg">
            <ChevronRight className={cn('size-4 transition-transform', showOk && 'rotate-90')} />Passed<span className="num">{ok.length}</span>
          </button>
          {showOk && (
            <ul className="mt-1.5 space-y-0.5">
              {ok.map((c, i) => <li key={i} className="flex gap-2 rounded-lg px-2.5 py-1.5 text-[13px]"><StatusIcon status="ok" className="mt-0.5 size-3.5" /><span className="min-w-0"><span className="text-fg-2">{c.title}</span>{c.detail && <span className="text-fg-3"> · {c.detail}</span>}</span></li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

type View = 'calc' | 'assume' | 'source'
// How every number was reached: the arithmetic, what was assumed, and where the inputs came from.
export function WorkingsPane({ topics, assumptions, sources }: { topics: Topic[]; assumptions: Assumption[]; sources: Source[] }) {
  const [view, setView] = useState<View>('calc')
  return (
    <div className="px-3 py-3">
      <Segmented size="sm" value={view} onChange={setView} className="mb-3" options={[{ value: 'calc', label: 'Calculations' }, { value: 'assume', label: 'Assumptions' }, { value: 'source', label: 'Sources' }]} />
      {view === 'calc' && (
        topics.length ? (
          <div className="space-y-5">
            {topics.map(tp => (
              <section key={tp.key}>
                <h3 className="mb-1 px-1 text-sm font-medium text-fg-2">{tp.title}</h3>
                <div className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
                  {tp.items.map((w, i) => (
                    <details key={i} className="group">
                      <summary className="flex cursor-pointer list-none items-baseline gap-2 px-3 py-2 hover:bg-hover [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="size-3.5 shrink-0 translate-y-0.5 text-fg-3 transition-transform group-open:rotate-90" />
                        <span className="min-w-0 flex-1 truncate text-sm text-fg">{w.title}</span>
                        <span className="num shrink-0 text-[13px] text-fg-2">{w.result}</span>
                      </summary>
                      <dl className="space-y-1 px-3 pb-3 pl-8">
                        {w.lines.map((l, k) => (
                          <div key={k} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 text-[13px] leading-snug">
                            <dt className={cn('text-fg-3', l.k.startsWith('=') && 'font-medium text-fg-2')}>{l.k.replace(/^= /, '')}</dt>
                            <dd className={cn('num text-fg-2', l.k.startsWith('=') && 'text-fg')}>{l.v}</dd>
                          </div>
                        ))}
                        {(w.fig || w.src) && <div className="pt-1 text-[13px]">{w.fig ? <PohLink fig={w.fig}>POH {w.fig === 'wb' ? 'loading' : w.fig}</PohLink> : <span className="text-fg-3">{w.src}</span>}</div>}
                      </dl>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : <p className="px-1 text-sm text-fg-3">The calculations appear once the route resolves and the aircraft's POH is known.</p>
      )}
      {view === 'assume' && (
        <ul className="divide-y divide-border">
          {assumptions.map((a, i) => (
            <li key={i} className="px-1 py-2.5">
              <div className="flex items-baseline gap-3"><span className="min-w-0 flex-1 text-sm text-fg">{a.label}</span><span className="num shrink-0 text-[13px] text-fg-2">{a.value}</span></div>
              <p className="mt-0.5 text-[13px] leading-snug text-fg-3">{a.basis}</p>
              {a.change && <p className="mt-0.5 text-xs text-fg-3">Change it: <span className="text-fg-2">{a.change}</span></p>}
            </li>
          ))}
        </ul>
      )}
      {view === 'source' && (
        <ul className="divide-y divide-border">
          {sources.map((s, i) => (
            <li key={i} className="px-1 py-2.5">
              <div className="text-sm text-fg">{s.what}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-fg-3">
                {s.href ? <a href={s.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-fg-2 hover:text-accent hover:underline">{s.from}<ExternalLink className="size-3" /></a> : <span className="text-fg-2">{s.from}</span>}
                {s.at && <span>· fetched {relTime(new Date(s.at))}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

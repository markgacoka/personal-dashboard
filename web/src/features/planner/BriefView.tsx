import { useEffect, useRef } from 'react'
import { ChevronRight, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { worst, type Check, type Derived, type Status } from './model'
import { DOMAIN_LABEL, DOMAIN_OF, type DomainKey } from './Sidebar'
import { CheckRows, StatusIcon, fmtMin, fmtTime } from './ui'

// PAVE order: the pilot, the airplane, the environment, then the numbers.
export const BRIEF_DOMAINS: DomainKey[] = ['pilot', 'aircraft', 'weather', 'route', 'airports', 'loading']
const RANK: Status[] = ['nogo', 'caution', 'todo', 'ok']
const WORD: Record<Status, string> = { nogo: 'no-go', caution: 'caution', todo: 'to do', ok: 'OK' }

export const domainChecks = (d: Derived, k: DomainKey) => d.checks.filter(c => DOMAIN_OF[c.section] === k)
export const domainStatus = (d: Derived, k: DomainKey): Status | null => { const cs = domainChecks(d, k); return cs.length ? worst(cs.map(c => c.status)) : null }
const tally = (cs: Check[]) => (['nogo', 'caution', 'todo'] as Status[]).map(s => [s, cs.filter(c => c.status === s).length] as const).filter(([, n]) => n)

// The brief: the verdict and the trip's numbers, then one line per area with
// its answer; open a line for the detail behind it.
export function Brief({ d, status, label, open, setOpen, summary, detail }: {
  d: Derived; status: Status; label: string; open: DomainKey | null; setOpen: (k: DomainKey | null) => void
  summary: Record<DomainKey, React.ReactNode>; detail: (k: DomainKey) => React.ReactNode
}) {
  const t = d.totals
  const to = d.wb.steps.find(x => x.total && x.label.startsWith('Takeoff'))
  const tone = status === 'nogo' ? 'bg-bad-soft' : status === 'caution' ? 'bg-warn-soft' : status === 'ok' ? 'bg-good-soft' : 'bg-hover'
  const counts = tally(d.checks)
  const refs = useRef<Partial<Record<DomainKey, HTMLLIElement | null>>>({})
  // Bring a newly opened area to the top (not on load, when the page restores it).
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } if (open) refs.current[open]?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [open])
  const facts: [string, React.ReactNode][] = d.legs.length ? [
    ['Takeoff → land', <>{fmtTime(d.takeoffAt)} → {fmtTime(d.legs.at(-1)!.arriveAt)}</>],
    ['Distance · time', <>{Math.round(t.distNm)} nm · {fmtMin(t.eteMin)}</>],
    ['Fuel needed · aboard', <>{t.requiredFuel.toFixed(1)} · {t.usableFuel.toFixed(1)} gal</>],
    ['Takeoff weight · CG', to ? <>{Math.round(to.weight).toLocaleString()} lb · {to.arm?.toFixed(1)} in</> : '—'],
    ['Cruise', <>{d.flights.map(f => `${f.alt.toLocaleString()} ft`).join(' / ')}{d.flights[0]?.cruise ? ` · ${d.flights[0].cruise.ktas} KTAS` : ''}</>],
  ] : []

  return (
    <div className="space-y-4">
      <div className={cn('rounded-xl px-4 py-4 sm:px-5', tone)}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusIcon status={status} className="size-6" />
          <h2 className="text-xl font-medium tracking-[-0.015em] text-fg">{label}</h2>
          <span className="text-sm text-fg-2">{counts.map(([s, n]) => `${n} ${WORD[s]}`).join(' · ') || 'every check passed'}</span>
        </div>
        {facts.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            {facts.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-xs text-fg-3">{k}</dt><dd className="num mt-0.5 truncate text-sm text-fg">{v}</dd></div>)}
          </dl>
        )}
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-inset ring-white/[0.04]">
        {BRIEF_DOMAINS.map(k => {
          const cs = domainChecks(d, k).sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status))
          const st = domainStatus(d, k), issues = cs.filter(c => c.status !== 'ok'), isOpen = open === k
          const tl = tally(cs)
          return (
            <li key={k} ref={el => { refs.current[k] = el }} className="scroll-mt-20">
              <button onClick={() => setOpen(isOpen ? null : k)} aria-expanded={isOpen} className={cn('flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-hover sm:px-5', isOpen && 'bg-hover')}>
                {st ? <StatusIcon status={st} className="size-5" /> : <Circle className="size-5 shrink-0 text-fg-3" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className="text-[15px] font-medium text-fg">{DOMAIN_LABEL[k]}</span>
                    {tl.length > 0 && <span className="text-[13px]">{tl.map(([s, n], i) => <span key={s} className={s === 'nogo' ? 'text-bad' : s === 'caution' ? 'text-warn' : 'text-fg-3'}>{i > 0 && <span className="text-fg-3"> · </span>}{n} {WORD[s]}</span>)}</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-fg-3">{issues[0] && !isOpen ? issues[0].title : summary[k]}</span>
                </span>
                <ChevronRight className={cn('size-4 shrink-0 text-fg-3 transition-transform duration-200', isOpen && 'rotate-90')} />
              </button>
              {isOpen && (
                <div className="space-y-6 border-t border-border px-4 py-5 sm:px-5">
                  {issues.length > 0 && <CheckRows checks={issues} />}
                  {detail(k)}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-[13px] text-fg-3">Not a substitute for a standard briefing (1800wxbrief.com or 1-800-WX-BRIEF), your instructor's judgment or the POH in the airplane.</p>
    </div>
  )
}

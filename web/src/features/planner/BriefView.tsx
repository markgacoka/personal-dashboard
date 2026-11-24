import { useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { worst, type Check, type Derived, type Status } from './model'
import { DOMAIN_LABEL, DOMAIN_OF, type DomainKey } from './Sidebar'
import { CheckRows, VerdictIcon, fmtMin, fmtTime } from './ui'

// PAVE order: the pilot, the airplane, the environment, then the numbers.
export const BRIEF_DOMAINS: DomainKey[] = ['pilot', 'aircraft', 'weather', 'route', 'airports', 'loading']
const RANK: Status[] = ['nogo', 'caution', 'todo', 'ok', 'note']
const WORD: Record<'nogo' | 'caution' | 'todo', string> = { nogo: 'to fix', caution: 'to decide', todo: 'to finish' }

export const domainChecks = (d: Derived, k: DomainKey) => d.checks.filter(c => DOMAIN_OF[c.section] === k)
export const domainStatus = (d: Derived, k: DomainKey): Status | null => { const cs = domainChecks(d, k); return cs.length ? worst(cs.map(c => c.status)) : null }
const tally = (cs: Check[]) => (['nogo', 'caution', 'todo'] as Status[]).map(s => [s, cs.filter(c => c.status === s).length] as const).filter(([, n]) => n)

// The brief: the verdict and the trip's numbers, then one line per area with
// its answer; open a line for the detail behind it.
export function Brief({ d, status, label, open, setOpen, summary, detail, next }: {
  d: Derived; status: Status; label: string; open: DomainKey | null; setOpen: (k: DomainKey | null) => void
  summary: Record<DomainKey, React.ReactNode>; detail: (k: DomainKey) => React.ReactNode
  // What to do now: the next fix, or once nothing is left, the steps before you go.
  next?: React.ReactNode
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
    <div className="space-y-6">
      <div className={cn('rounded-xl px-4 py-5 sm:px-6', tone)}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <VerdictIcon status={status} className="size-6" />
          <h2 className="text-xl font-medium tracking-[-0.015em] text-fg">{label}</h2>
          <span className="text-sm text-fg-2">{counts.map(([s, n]) => `${n} ${WORD[s as keyof typeof WORD]}`).join(' · ') || 'every check passed'}</span>
        </div>
        {facts.length > 0 && (
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
            {facts.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[13px] text-fg-3">{k}</dt><dd className="num mt-1 truncate text-[15px] text-fg-2">{v}</dd></div>)}
          </dl>
        )}
        {next && <div className="mt-5 border-t border-fg/10 pt-4">{next}</div>}
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-inset ring-white/[0.04]">
        {BRIEF_DOMAINS.map(k => {
          const cs = domainChecks(d, k).sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status))
          const issues = cs.filter(c => c.status === 'nogo' || c.status === 'caution' || c.status === 'todo'), notes = cs.filter(c => c.status === 'note'), isOpen = open === k
          const tl = tally(cs)
          // Quiet unless it asks something of you: a red or amber mark only for a no-go or
          // a decision, the area's answer always, and what's left as plain words.
          const mark = tl[0]?.[0]
          return (
            <li key={k} ref={el => { refs.current[k] = el }} className="scroll-mt-20">
              <button onClick={() => setOpen(isOpen ? null : k)} aria-expanded={isOpen} className={cn('grid w-full grid-cols-[0.5rem_minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-4 text-left hover:bg-hover sm:px-6', isOpen && 'bg-hover')}>
                <span aria-hidden className={cn('size-2 rounded-full', mark === 'nogo' ? 'bg-bad' : mark === 'caution' ? 'bg-warn' : 'bg-transparent')} />
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-fg">{DOMAIN_LABEL[k]}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-fg-3">{summary[k]}</span>
                </span>
                <span className="flex items-center gap-3">
                  {tl.length > 0 && <span className="text-[13px] max-sm:hidden">{tl.map(([s, n], i) => <span key={s} className={s === 'nogo' ? 'text-bad' : s === 'caution' ? 'text-warn' : 'text-fg-3'}>{i > 0 && <span className="text-fg-3"> · </span>}{n} {WORD[s as keyof typeof WORD]}</span>)}</span>}
                  <ChevronRight className={cn('size-4 shrink-0 text-fg-3 transition-transform duration-200', isOpen && 'rotate-90')} />
                </span>
              </button>
              {isOpen && (
                <div className="space-y-8 border-t border-border px-4 py-6 sm:px-6">
                  {issues.length > 0 && <CheckRows checks={issues} />}
                  {notes.length > 0 && <CheckRows checks={notes} />}
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

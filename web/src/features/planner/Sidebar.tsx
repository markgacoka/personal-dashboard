import { useState } from 'react'
import { ArrowRight, ArrowUpRight, ChevronDown, ExternalLink } from 'lucide-react'
import { Badge, Dot } from '@/components/ui/badge'
import { Segmented, Tooltip } from '@/components/ui/misc'
import { relTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Check, Status } from './model'
import { PohLink } from './RefPanel'
import { STATUS_META, StatusIcon } from './ui'
import type { Assumption, Line, Source, Topic, Work } from './workings'

export type DomainKey = 'plan' | 'pilot' | 'aircraft' | 'weather' | 'route' | 'airports' | 'loading'
export const DOMAIN_OF: Record<Check['section'], DomainKey> = { trip: 'plan', pilot: 'pilot', aircraft: 'aircraft', weather: 'weather', navlog: 'route', loading: 'loading', performance: 'loading' }
export const DOMAIN_LABEL: Record<DomainKey, string> = { plan: 'Plan', pilot: 'Pilot', aircraft: 'Aircraft', weather: 'Weather', route: 'Route and fuel', airports: 'Airports', loading: 'Weight and performance' }
const DOMAIN_ORDER: DomainKey[] = ['plan', 'pilot', 'aircraft', 'weather', 'route', 'airports', 'loading']
const RANK: Status[] = ['nogo', 'caution', 'todo', 'ok']
const byRank = (a: Check, b: Check) => RANK.indexOf(a.status) - RANK.indexOf(b.status)
const BAR: Record<Status, string> = { nogo: 'bg-bad', caution: 'bg-warn', todo: 'bg-fg-3', ok: 'bg-good' }
const SEVERITY_HEAD: Record<Exclude<Status, 'ok'>, string> = { nogo: 'No-go', caution: 'Caution', todo: 'To do' }
const SEVERITY_HINT: Record<Exclude<Status, 'ok'>, string> = { nogo: 'Fix before you fly', caution: 'Decide on each', todo: 'Not done yet' }

export const worstStatus = (checks: Check[]): Status => checks.reduce<Status>((w, c) => (RANK.indexOf(c.status) < RANK.indexOf(w) ? c.status : w), 'ok')

// "§61.89(a)(1). Rest" → the rule cited, then the explanation.
function splitRule(detail?: string): { rule: string | null; why: string | null } {
  if (!detail) return { rule: null, why: null }
  const m = detail.match(/^(§\s?\d[\d.]*(?:\([a-z0-9]+\))*(?:[–-]§?\d[\d.]*)?)[.:]?\s*/i)
  if (!m) return { rule: null, why: detail }
  const why = detail.slice(m[0].length).trim()
  return { rule: m[1], why: why ? why[0].toUpperCase() + why.slice(1) : null }
}

/* ───────────────────────────── Fixes ───────────────────────────── */

type Filter = Status | null
type GroupBy = 'severity' | 'area'

// Every check that isn't OK, worst first: a scannable title per row that opens
// to the rule, the reason, the fix and a link to where it's fixed.
export function FixesPane({ checks, onJump }: { checks: Check[]; onJump: (k: DomainKey) => void }) {
  const [filter, setFilter] = useState<Filter>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>('severity')
  const count = (s: Status) => checks.filter(c => c.status === s).length
  const open = checks.filter(c => c.status !== 'ok').sort(byRank)
  const shown = filter ? checks.filter(c => c.status === filter) : open
  const total = checks.length || 1

  const groups: { key: string; head: React.ReactNode; hint?: string; items: Check[]; domain?: DomainKey }[] = filter === 'ok'
    ? [{ key: 'ok', head: 'Passed', items: shown }]
    : groupBy === 'severity'
      ? (['nogo', 'caution', 'todo'] as const).map(s => ({ key: s, head: SEVERITY_HEAD[s], hint: SEVERITY_HINT[s], items: shown.filter(c => c.status === s) }))
      : DOMAIN_ORDER.map(k => ({ key: k, head: DOMAIN_LABEL[k], domain: k, items: shown.filter(c => DOMAIN_OF[c.section] === k) }))

  return (
    <div className="pb-4">
      {/* Summary: the whole picture in one line, each count a filter. */}
      <div className="space-y-4 border-b border-border px-4 py-5">
        <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {RANK.map(s => count(s) > 0 && <span key={s} className={cn(BAR[s], 'h-full', s === 'todo' && 'opacity-60')} style={{ width: `${(count(s) / total) * 100}%` }} />)}
        </div>
        <div role="group" aria-label="Filter checks" className="grid grid-cols-4 gap-1">
          {RANK.map(s => {
            const m = STATUS_META[s], n = count(s), on = filter === s
            return (
              <button key={s} onClick={() => setFilter(on ? null : s)} aria-pressed={on} disabled={!n}
                className={cn('press rounded-lg px-2 py-1.5 text-left ring-1 ring-inset disabled:opacity-40', on ? 'bg-pill ring-border-strong' : 'ring-transparent hover:bg-hover')}>
                <span className={cn('num block text-xl font-medium leading-tight tracking-[-0.02em]', n ? m.text : 'text-fg-3', s === 'ok' && n && 'text-fg')}>{n}</span>
                <span className="block text-[13px] text-fg-3">{s === 'ok' ? 'Passed' : m.label}</span>
              </button>
            )
          })}
        </div>
        {filter !== 'ok' && open.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-fg-3">{filter ? `Showing ${STATUS_META[filter].label.toLowerCase()} only` : `${open.length} to resolve`}</span>
            <Segmented size="sm" value={groupBy} onChange={setGroupBy} options={[{ value: 'severity', label: 'Severity' }, { value: 'area', label: 'Area' }]} />
          </div>
        )}
      </div>

      {!open.length && !filter && (
        <div className="px-4 py-8 text-center">
          <StatusIcon status="ok" className="mx-auto size-6" />
          <p className="mt-2 text-sm font-medium text-fg">Every check passed</p>
          <p className="mt-1 text-[13px] text-fg-3">Read the workings, then get a standard briefing before you go.</p>
        </div>
      )}

      {groups.filter(g => g.items.length).map(g => {
        const worst = worstStatus(g.items)
        return (
          <section key={g.key} className="mt-6">
            <header className="flex items-baseline gap-2 px-4 pb-1">
              {groupBy === 'area' && filter !== 'ok' ? <StatusIcon status={worst} className="size-3.5 translate-y-0.5" /> : null}
              <h3 className={cn('text-sm font-medium', groupBy === 'severity' && g.key !== 'ok' ? STATUS_META[g.key as Status].text : 'text-fg')}>{g.head}</h3>
              <span className="num text-[13px] text-fg-3">{g.items.length}</span>

              {g.domain && <button onClick={() => onJump(g.domain!)} className="ml-auto inline-flex items-center gap-0.5 text-[13px] text-fg-3 hover:text-accent">Open<ArrowUpRight className="size-3.5" /></button>}
            </header>
            <ul className="mx-2">
              {g.items.sort(byRank).map((c, i) => <FixRow key={`${c.section}-${c.title}-${i}`} c={c} showArea={groupBy === 'severity' || filter === 'ok'} onJump={onJump} />)}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function FixRow({ c, showArea, onJump }: { c: Check; showArea: boolean; onJump: (k: DomainKey) => void }) {
  const [open, setOpen] = useState(false)
  const { rule, why } = splitRule(c.detail)
  const domain = DOMAIN_OF[c.section]
  const ok = c.status === 'ok'
  const hasBody = !!(why || rule || (c.fix && !ok))
  return (
    <li>
      <button onClick={() => hasBody && setOpen(o => !o)} aria-expanded={hasBody ? open : undefined}
        className={cn('flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left', hasBody && 'hover:bg-hover')}>
        <StatusIcon status={c.status} className="mt-0.5" />
        <span className={cn('min-w-0 flex-1 text-sm leading-snug', c.status === 'nogo' ? 'text-fg' : 'text-fg-2')}>{c.title}</span>
        {showArea && <span className="mt-px shrink-0 text-[13px] text-fg-3">{DOMAIN_LABEL[domain].split(' ')[0]}</span>}
        {hasBody && <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-fg-3 transition-transform duration-200', open && 'rotate-180')} />}
      </button>
      {open && hasBody && (
        <div className="space-y-2 pb-3 pl-9 pr-2">
          {c.fix && !ok && <p className="text-[13px] leading-snug text-fg-2">{c.fix}</p>}
          {(rule || why) && <p className="text-[13px] leading-snug text-fg-3">{why}{rule && <span className="num"> {why ? '· ' : ''}{rule}</span>}</p>}
          {!ok && (
            <button onClick={() => onJump(domain)} className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
              {DOMAIN_LABEL[domain]}<ArrowRight className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/* ──────────────────────────── Workings ──────────────────────────── */

type View = 'calc' | 'assume' | 'source'

// How every number was reached: the arithmetic, what was assumed, and where the inputs came from.
export function WorkingsPane({ topics, assumptions, sources, onJump }: { topics: Topic[]; assumptions: Assumption[]; sources: Source[]; onJump?: (k: DomainKey) => void }) {
  const [view, setView] = useState<View>('calc')
  return (
    <div className="pb-4">
      <div className="sticky top-0 z-10 border-b border-border bg-card px-3 py-3">
        <Segmented size="sm" value={view} onChange={setView} className="w-full [&>button]:flex-1 [&>button]:justify-center"
          options={[{ value: 'calc', label: 'Calculations', count: topics.reduce((n, t) => n + t.items.length, 0) }, { value: 'assume', label: 'Assumptions', count: assumptions.length }, { value: 'source', label: 'Sources', count: sources.length }]} />
        {view === 'calc' && topics.length > 1 && (
          <nav aria-label="Calculations" className="scrollbar-none -mx-1 mt-2.5 flex gap-1 overflow-x-auto px-1">
            {topics.map(tp => (
              <button key={tp.key} onClick={() => document.getElementById(`wk-${tp.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="h-7 shrink-0 rounded-full px-2.5 text-[13px] text-fg-3 ring-1 ring-inset ring-border hover:text-fg">{SHORT[tp.key] ?? tp.title}</button>
            ))}
          </nav>
        )}
      </div>
      {view === 'calc' && <Calculations topics={topics} />}
      {view === 'assume' && <Assumptions list={assumptions} onJump={onJump} />}
      {view === 'source' && <Sources list={sources} />}
    </div>
  )
}

const SHORT: Record<string, string> = { legs: 'Headings', perf: 'Cruise', fuel: 'Fuel', da: 'Density alt.', runway: 'Runways', wb: 'W&B' }

function Calculations({ topics }: { topics: Topic[] }) {
  if (!topics.length) return <p className="px-4 py-8 text-center text-[13px] text-fg-3">The calculations appear once the route resolves and the aircraft's POH is known.</p>
  return (
    <div>
      {topics.map(tp => (
        <section key={tp.key} id={`wk-${tp.key}`} className="scroll-mt-28 pt-4">
          <h3 className="px-3 pb-1.5 text-sm font-medium text-fg-2">{tp.title}</h3>
          <ul className="mx-3 divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
            {tp.items.map((w, i) => <WorkRow key={i} w={w} defaultOpen={tp.items.length === 1 && topics.length <= 2} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}

function WorkRow({ w, defaultOpen }: { w: Work; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const parts = w.result.split(' · ')
  return (
    <li>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-hover">
        <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-fg-3 transition-transform duration-200', !open && '-rotate-90')} />
        <span className="min-w-0 flex-1 text-sm text-fg">{w.title}</span>
        <span className="num flex shrink-0 flex-col items-end text-[13px] leading-snug text-fg">
          {parts.map((p, i) => <span key={i} className={i ? 'text-fg-3' : 'font-medium'}>{p}</span>)}
        </span>
      </button>
      {open && (
        <div className="pb-3 pl-9 pr-3">
          <dl className="space-y-1.5">{w.lines.map((l, k) => <WorkLine key={k} l={l} />)}</dl>
          {(w.fig || w.src) && (
            <div className="mt-2.5 border-t border-border pt-2 text-[13px] text-fg-3">
              {w.fig ? <PohLink fig={w.fig}>POH {w.fig === 'wb' ? 'loading' : w.fig}</PohLink> : <>Rule: <span className="font-mono text-fg-2">{w.src}</span></>}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

// A worksheet line: the label, then the arithmetic muted and its result bright.
function WorkLine({ l }: { l: Line }) {
  const total = l.k.startsWith('= ')
  const at = l.v.lastIndexOf(' = ')
  const [expr, res] = at > 0 ? [l.v.slice(0, at), l.v.slice(at + 3)] : [null, l.v]
  return (
    <div className={cn('grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-3 text-[13px] leading-snug', total && 'mt-1 border-t border-border pt-1.5')}>
      <dt className={total ? 'font-medium text-fg-2' : 'text-fg-3'}>{l.k.replace(/^= /, '')}</dt>
      <dd className="num min-w-0 break-words">
        {expr && <span className="text-fg-3">{expr} = </span>}
        <span className={expr || total ? 'font-medium text-fg' : 'text-fg-2'}>{res}</span>
      </dd>
    </div>
  )
}

// Assumptions, grouped by what they affect; the defaults that stand in for
// missing data come first because replacing them changes the answers.
const A_GROUP: Record<string, string> = {
  'Engine start to takeoff': 'Time and fuel', 'Fuel weight': 'Time and fuel', 'Start, taxi and run-up fuel': 'Time and fuel', 'Fuel reserve': 'Time and fuel',
  'Climb': 'Performance', 'Descent': 'Performance', 'Cruise power': 'Performance', 'Runway margin': 'Performance', 'Empty weight': 'Performance',
  'Cruise altitude': 'Route', 'Magnetic variation': 'Route', 'Checkpoints': 'Route', 'Alternate': 'Route', 'Runway used': 'Route',
  'Winds aloft': 'Weather', 'Surface weather at each ETA': 'Weather', 'Altimeter and temperature': 'Weather', 'Night': 'Weather',
  'Pilot certificate': 'Pilot',
}
const A_ORDER = ['Stand-ins for missing data', 'Time and fuel', 'Performance', 'Route', 'Weather', 'Pilot', 'Other']
const isStandIn = (a: Assumption) => a.value === 'Calm' || /sample/i.test(a.value) || a.label === 'Pilot certificate'
const LABEL_DOMAIN = Object.fromEntries(Object.entries(DOMAIN_LABEL).map(([k, v]) => [v.toLowerCase(), k as DomainKey]))
// "Brief → Pilot → minimums" → pilot; "Plan → Fuel and taxi" → plan.
function changeTarget(change: string): DomainKey | null {
  const [stage, area] = change.split('→').map(s => s.trim().toLowerCase())
  if (stage === 'plan') return 'plan'
  return area ? LABEL_DOMAIN[area] ?? null : null
}

function Assumptions({ list, onJump }: { list: Assumption[]; onJump?: (k: DomainKey) => void }) {
  const grouped = A_ORDER.map(g => ({ g, items: list.filter(a => (isStandIn(a) ? A_ORDER[0] : A_GROUP[a.label] ?? 'Other') === g) })).filter(x => x.items.length)
  return (
    <div>
      {grouped.map(({ g, items }) => {
        const standIn = g === A_ORDER[0]
        return (
          <section key={g} className="pt-4">
            <h3 className={cn('px-3 pb-1.5 text-sm font-medium', standIn ? 'text-warn' : 'text-fg-2')}>{g}</h3>
            {standIn && <p className="-mt-1 px-3 pb-2 text-[13px] text-fg-3">Replace these and the numbers become this flight's, not a stand-in's.</p>}
            <ul className={cn('mx-3 divide-y divide-border rounded-lg ring-1 ring-inset', standIn ? 'ring-warn/30' : 'ring-border')}>
              {items.map((a, i) => {
                const to = a.change ? changeTarget(a.change) : null
                return (
                  <li key={i} className="px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1 text-sm text-fg">{a.label}</span>
                      <Badge tone={standIn ? 'warn' : 'neutral'} className="num h-auto min-h-[1.375rem] max-w-[55%] whitespace-normal py-0.5 text-right text-[13px] font-normal leading-snug">{a.value}</Badge>
                    </div>
                    <p className="mt-1 text-[13px] leading-snug text-fg-3">{a.basis}</p>
                    {a.change && (to && onJump
                      ? <button onClick={() => onJump(to)} className="mt-1 inline-flex items-center gap-1 text-[13px] text-accent hover:underline">Change under {a.change}<ArrowRight className="size-3.5" /></button>
                      : <p className="mt-1 text-[13px] text-fg-3">Change under <span className="text-fg-2">{a.change}</span></p>)}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

// Live feeds with how fresh they are, then the reference data.
const ageTone = (at: string) => {
  const min = (Date.now() - Date.parse(at)) / 60000
  return min <= 60 ? 'var(--good)' : min <= 180 ? 'var(--warn)' : 'var(--bad)'
}

function Sources({ list }: { list: Source[] }) {
  const live = list.filter(s => 'at' in s && !/terrain/i.test(s.what))
  const ref = list.filter(s => !live.includes(s))
  return (
    <div>
      {[{ h: 'Live data', items: live }, { h: 'Reference data', items: ref }].filter(x => x.items.length).map(({ h, items }) => (
        <section key={h} className="pt-4">
          <h3 className="px-3 pb-1.5 text-sm font-medium text-fg-2">{h}</h3>
          <ul className="mx-3 divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
            {items.map((s, i) => (
              <li key={i} className="px-3 py-2.5">
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 text-sm text-fg">{s.what}</span>
                  {s.at ? (
                    <Tooltip content={new Date(s.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-fg-2"><Dot color={ageTone(s.at)} />{relTime(new Date(s.at))}</span>
                    </Tooltip>
                  ) : s.at === null ? <span className="shrink-0 text-[13px] text-fg-3">not fetched</span> : null}
                </div>
                <div className="mt-0.5 text-[13px] leading-snug text-fg-3">
                  {s.href ? <a href={s.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-accent hover:underline">{s.from}<ExternalLink className="size-3" /></a> : s.from}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

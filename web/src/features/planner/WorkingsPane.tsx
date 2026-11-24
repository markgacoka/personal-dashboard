import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ExternalLink } from 'lucide-react'
import { Badge, Dot } from '@/components/ui/badge'
import { Segmented, Tooltip } from '@/components/ui/misc'
import { relTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PohLink } from './RefPanel'
import { SECTION_LABEL, type SectionKey } from './readiness'
import type { Assumption, Line, Source, Topic, Work } from './workings'
import type { Expl } from './explain'
import { ExplCard } from './ExplainView'
import type { RowOverride } from './model'

type View = 'calc' | 'assume' | 'source'

export interface Focus { title: string; subtitle: string; items: Expl[]; card?: string; ov?: RowOverride; onEdit?: (f: keyof RowOverride, v: number | null) => void; onClear: () => void }

export function WorkingsPane({ topics, assumptions, sources, onJump, focus, topic }: { topics: Topic[]; assumptions: Assumption[]; sources: Source[]; onJump?: (k: SectionKey) => void; focus?: Focus | null; topic?: string | null }) {
  const [view, setView] = useState<View>('calc')
  // Opened at one topic (a fact on the overview, a figure in a section): scroll to it.
  useEffect(() => { if (!focus && topic) { setView('calc'); requestAnimationFrame(() => document.getElementById(`wk-${topic}`)?.scrollIntoView({ block: 'start' })) } }, [topic, focus])
  if (focus) return <FocusView f={focus} />
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

// One selected NavLog row or W&B line, quantity by quantity.
function FocusView({ f }: { f: Focus }) {
  return (
    <div className="pb-4">
      <div className="sticky top-0 z-10 border-b border-border bg-card px-3 py-3">
        <button onClick={f.onClear} className="inline-flex items-center gap-1 text-[13px] text-fg-3 hover:text-fg"><ArrowLeft className="size-3.5" />All workings</button>
        <h3 className="mt-2 text-[15px] font-medium text-fg">{f.title}</h3>
        <p className="mt-0.5 text-[13px] text-fg-3">{f.subtitle}</p>
      </div>
      {/* The figure you selected first, then the rest of the row in the order it's worked out. */}
      <ul className="mx-3 mt-4 divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
        {[...f.items].sort((a, b) => Number(b.key === f.card) - Number(a.key === f.card)).map(e => (
          <ExplCard key={e.key} e={e} ov={f.ov} onEdit={f.onEdit} className={cn(e.key === f.card && f.items.length > 1 && 'bg-accent-soft/40')} />
        ))}
      </ul>
      {f.onEdit && <p className="mx-4 mt-4 text-[13px] leading-snug text-fg-3">Values you type here change only this row; clear them to go back to the source.</p>}
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
const LABEL_SECTION = Object.fromEntries((Object.entries(SECTION_LABEL) as [SectionKey, string][]).map(([k, v]) => [v.toLowerCase(), k]))
// "Pilot → minimums" → pilot; "Weight and balance → fuel and taxi" → loading.
function changeTarget(change: string): SectionKey | null {
  return LABEL_SECTION[change.split('→')[0].trim().toLowerCase()] ?? null
}

function Assumptions({ list, onJump }: { list: Assumption[]; onJump?: (k: SectionKey) => void }) {
  const grouped = A_ORDER.map(g => ({ g, items: list.filter(a => (isStandIn(a) ? A_ORDER[0] : A_GROUP[a.label] ?? 'Other') === g) })).filter(x => x.items.length)
  return (
    <div>
      {grouped.map(({ g, items }) => {
        const standIn = g === A_ORDER[0]
        return (
          <section key={g} className="pt-4">
            <h3 className={cn('px-3 pb-1.5 text-sm font-medium', standIn ? 'text-fg' : 'text-fg-2')}>{g}</h3>
            {standIn && <p className="-mt-1 px-3 pb-2 text-[13px] text-fg-3">Replace these and the numbers become this flight's, not a stand-in's.</p>}
            <ul className={cn('mx-3 divide-y divide-border rounded-lg ring-1 ring-inset', 'ring-border')}>
              {items.map((a, i) => {
                const to = a.change ? changeTarget(a.change) : null
                return (
                  <li key={i} className="px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1 text-sm text-fg">{a.label}</span>
                      <Badge tone="neutral" className="num h-auto min-h-[1.375rem] max-w-[55%] whitespace-normal py-0.5 text-right text-[13px] font-normal leading-snug">{a.value}</Badge>
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

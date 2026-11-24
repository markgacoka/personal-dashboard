import { BookOpen, Calculator, ClipboardList, FileText, Maximize2, Minimize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChecklistRun } from './AircraftChecklist'
import { isWaypoint, parseRouteItem } from './model'
import { DocPane, isDocTab, type Tab } from './RefPanel'
import { WorkingsPane } from './WorkingsPane'
import { useFlight } from './useFlight'

const TABS: { key: Tab; label: string; icon: typeof Calculator }[] = [
  { key: 'workings', label: 'Workings', icon: Calculator }, { key: 'poh', label: 'POH', icon: BookOpen },
  { key: 'checklist', label: 'Checklist', icon: ClipboardList }, { key: 'briefing', label: 'Briefing', icon: FileText },
]

// The work sheet: how a figure was reached (its steps, inputs and their
// sources, assumptions, and the range it should fall in), every calculation,
// assumption and source of the plan, and the documents beside it. It opens from
// any figure with a dotted underline; on wide screens it sits beside the page.
export function WorkSheet() {
  const f = useFlight()
  const r = f.refs
  if (!r.state.open) return null
  const tab = r.state.tab
  const own = f.planning.checklist
  const routeIds = f.plan.route.map(x => parseRouteItem(x).id).filter((_, i) => !f.routePts[i] || !isWaypoint(f.routePts[i]))
  return (
    <aside aria-label="Work sheet" className={cn('fixed inset-0 z-40 flex flex-col bg-card sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[30rem] sm:border-l sm:border-border sm:shadow-2xl',
      '2xl:sticky 2xl:inset-auto 2xl:top-20 2xl:z-auto 2xl:h-[calc(100dvh-6rem)] 2xl:w-auto 2xl:rounded-xl 2xl:border-0 2xl:shadow-none 2xl:ring-1 2xl:ring-inset 2xl:ring-white/[0.04] print:hidden')}>
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        <div role="tablist" aria-label="Work sheet" className="scrollbar-none flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => r.set({ tab: t.key, page: null })}
              className={cn('press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm', tab === t.key ? 'bg-pill font-medium text-fg' : 'text-fg-3 hover:text-fg')}>
              <t.icon className="size-3.5" />{t.label}
            </button>
          ))}
        </div>
        <Button size="icon-sm" variant="ghost" className="shrink-0 max-2xl:hidden" onClick={() => r.set({ wide: !r.state.wide })} aria-label={r.state.wide ? 'Narrow the sheet' : 'Widen the sheet'} aria-pressed={r.state.wide}>{r.state.wide ? <Minimize2 /> : <Maximize2 />}</Button>
        <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={() => { r.close(); f.setFocus(null) }} aria-label="Close the sheet"><X /></Button>
      </div>
      {tab === 'checklist' && own?.length
        ? <div className="@container min-h-0 flex-1 overflow-y-auto px-4 py-4"><p className="mb-3 text-[13px] text-fg-3">{f.plan.tail}'s checklist from its profile. Tap a step to tick it.</p><ChecklistRun secs={own} compact /></div>
        : isDocTab(tab)
          ? <DocPane tail={f.plan.tail} model={f.aircraft.model ?? f.match?.profile.key.replace(/^C/, '') ?? null} route={routeIds} date={f.plan.departLocal.slice(0, 10)} pohDoc={f.pohDoc ?? null} pohLoading={f.pohQ.isFetching || f.registry.isLoading} pohStatus={f.pohStatus} />
          : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <WorkingsPane topics={f.topics} assumptions={f.assumed} sources={f.srcs} onJump={k => { f.go(k); if (!window.matchMedia('(min-width: 96rem)').matches) r.close() }} topic={f.focus?.kind === 'topic' ? f.focus.key : null}
                focus={f.focusView ? { ...f.focusView, onClear: () => f.setFocus(null) } : null} />
            </div>}
    </aside>
  )
}

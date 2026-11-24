import { useState } from 'react'
import { Link } from 'react-router'
import { Calculator, Check, ChevronDown, ChevronRight, FilePlus2, Loader2, MoreHorizontal, Pencil, Printer, Save, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { relTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SavedPlan } from './api'
import { FlightInputs } from './FlightInputs'
import { parseRouteItem, type Plan, type Status } from './model'
import { AircraftPicker, CrewPicker, NeedsPilotProfile } from './Pickers'
import { SECTIONS, SECTION_LABEL, sectionState, type SectionKey, type TaskKind } from './readiness'
import { RefProvider } from './RefPanel'
import { AircraftSection, AirportsSection, LoadingSection, NavlogSection, PilotSection, RouteSection, TaskRow, WeatherSectionView } from './Sections'
import { VerdictIcon, fmtMin, fmtTime } from './ui'
import { FlightCtx, useFlight, useFlightState } from './useFlight'
import { WorkSheet } from './WorkSheet'

// The flight file (docs/planner-ux.md): a new flight asks four things, then
// the sections in the order a pilot briefs (pilot, aircraft, weather, airports,
// route and fuel, weight and performance) lead to the NavLog. The rail shows
// what's still open in each; the work sheet explains any figure.
export default function PlannerPage() {
  return <RefProvider><Shell /></RefProvider>
}

function Shell() {
  const f = useFlightState()
  const sheet = f.refs.state.open
  return (
    <FlightCtx.Provider value={f}>
      <div className="planner">
        <Header />
        {f.state.setup ? <NewFlight /> : (
          <div className={cn('grid gap-6 lg:grid-cols-[14.5rem_minmax(0,1fr)]', sheet && (f.refs.state.wide ? '2xl:grid-cols-[14.5rem_minmax(0,1fr)_minmax(28rem,42%)]' : '2xl:grid-cols-[14.5rem_minmax(0,1fr)_28rem] min-[2200px]:grid-cols-[14.5rem_minmax(0,1fr)_34rem]'))}>
            <Rail />
            <main className="min-w-0">
              <Status />
              {f.state.section === 'overview' && <Overview />}
              {f.state.section === 'pilot' && <PilotSection />}
              {f.state.section === 'aircraft' && <AircraftSection />}
              {f.state.section === 'weather' && <WeatherSectionView />}
              {f.state.section === 'airports' && <AirportsSection />}
              {f.state.section === 'route' && <RouteSection />}
              {f.state.section === 'loading' && <LoadingSection />}
              {f.state.section === 'navlog' && <NavlogSection />}
              <Pager />
            </main>
            <WorkSheet />
          </div>
        )}
      </div>
    </FlightCtx.Provider>
  )
}

/* ── Header ── */
function Header() {
  const f = useFlight()
  const [plansOpen, setPlansOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { plan, d } = f
  const when = d.departAt?.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const crew = f.role === 'dual' ? `dual with ${plan.crew?.instructor?.trim() || 'an instructor'}` : (f.certs?.certificate ?? 'student') === 'student' ? 'solo' : 'you as PIC'
  return (
    <header className="mb-6 flex flex-wrap items-start gap-x-6 gap-y-3 print:hidden">
      <div className="min-w-0 flex-1 basis-80">
        <label className="group flex min-w-0 items-center gap-2">
          <input value={plan.name} onChange={e => f.set({ name: e.target.value })} aria-label="Flight name" placeholder="Name this flight" size={Math.max(10, plan.name.length + 1)}
            className="field-sizing-content min-w-0 max-w-full bg-transparent text-2xl font-medium tracking-[-0.02em] text-fg outline-none placeholder:text-fg-3 focus:underline" />
          <Pencil className="size-4 shrink-0 text-fg-3 group-hover:text-fg" aria-hidden />
        </label>
        {!f.state.setup && (
          <p className="mt-1 text-sm text-fg-3">
            <span className="num text-fg-2">{f.routeText}</span>{when && <> · {when}</>}{plan.tail && <> · <span className="num">{plan.tail}</span></>} · {crew}
            {d.legs.length > 0 && <> · <span className="num">{Math.round(d.totals.distNm)} nm · {fmtMin(d.totals.eteMin)}</span></>}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!f.state.setup && <Verdict onClick={() => f.go('overview')} />}
        <Popover open={plansOpen} onOpenChange={setPlansOpen}>
          <PopoverTrigger asChild><Button variant="ghost">Plans<ChevronDown /></Button></PopoverTrigger>
          <PopoverContent align="end" className="max-h-[70dvh] w-80 overflow-hidden p-2">
            <PlanList plans={f.plans.data} loading={f.plans.isLoading} currentId={f.state.id} draft={f.state.id ? null : plan} unsaved={f.dirty && (f.state.id != null || plan.route.length > 1) ? plan.name : null}
              onSave={f.save} onOpen={p => { setPlansOpen(false); f.open(p) }} onNew={() => { setPlansOpen(false); f.startNew() }} />
          </PopoverContent>
        </Popover>
        {f.dirty || !f.state.id
          ? <Button variant="primary" onClick={f.save} loading={f.plans.create.isPending || f.plans.update.isPending}><Save />{f.state.id ? 'Save changes' : 'Save'}</Button>
          : <span role="status" className="inline-flex h-9 items-center gap-1.5 px-1 text-[13px] text-fg-3"><Check className="size-4" />Saved {f.state.savedAt ? relTime(f.state.savedAt) : ''}</span>}
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => { f.go('navlog'); setTimeout(() => window.print(), 300) }}><Printer />Print NavLog</MenuItem>
            <MenuItem onSelect={() => f.refs.show('workings')}><Calculator />All workings</MenuItem>
            <MenuItem asChild><Link to="/flying/plan/profiles"><Users />Profiles</Link></MenuItem>
            {f.state.id && <MenuItem danger onSelect={() => setConfirmDelete(true)}><Trash2 />Delete flight</MenuItem>}
          </MenuContent>
        </Menu>
      </div>
      {confirmDelete && f.state.id && (
        <div role="alertdialog" aria-label="Delete this flight?" className="flex w-full items-center justify-end gap-2 text-[13px]">
          <span className="text-fg-2">Delete "{plan.name}" for good?</span>
          <Button size="sm" variant="danger" onClick={() => { f.remove(); setConfirmDelete(false) }}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
        </div>
      )}
    </header>
  )
}

const VERDICT_TONE: Record<Status, string> = { nogo: 'bg-bad-soft text-bad', caution: 'bg-warn-soft text-warn', ok: 'bg-good-soft text-good', todo: 'bg-hover text-fg-2', note: 'bg-hover text-fg-2' }
function Verdict({ onClick }: { onClick: () => void }) {
  const f = useFlight()
  return (
    <button onClick={onClick} className={cn('inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium', VERDICT_TONE[f.verdict])}>
      <VerdictIcon status={f.verdict} />{f.verdictLabel}
    </button>
  )
}

/* ── Rail: the sections and what's open in each ── */
const MARK: Record<TaskKind | 'done', React.ReactNode> = {
  nogo: <span aria-label="Something rules the flight out" className="size-2 rounded-full bg-bad" />,
  caution: <span aria-label="A decision to make" className="size-2 rounded-full bg-warn" />,
  todo: <span aria-label="Something to finish" className="size-2 rounded-full ring-[1.5px] ring-inset ring-fg-3" />,
  recommended: <span aria-label="Recommended" className="size-1.5 rounded-full bg-fg-3/60" />,
  done: <Check aria-label="Done" className="size-3.5 text-fg-3" />,
}
function Rail() {
  const f = useFlight()
  const open = (k: SectionKey) => f.tasks.filter(t => t.section === k && t.kind !== 'recommended').length
  return (
    <nav aria-label="Flight file" className="print:hidden max-lg:-mx-4 max-lg:overflow-x-auto max-lg:px-4 max-lg:scrollbar-none lg:sticky lg:top-20 lg:self-start">
      <ol className="flex gap-1 max-lg:pb-1 lg:flex-col">
        {SECTIONS.map((s, i) => {
          const on = f.state.section === s.key, st = s.key === 'overview' ? null : s.key === 'navlog' ? (f.d.flights.length ? 'done' : 'todo') : sectionState(f.tasks, s.key)
          const n = s.key === 'overview' || s.key === 'navlog' ? 0 : open(s.key)
          return (
            <li key={s.key} className={cn(s.key === 'navlog' && 'lg:mt-2 lg:border-t lg:border-border lg:pt-2')}>
              <button onClick={() => f.go(s.key)} aria-current={on ? 'page' : undefined} aria-label={`${s.label}${n ? `, ${n} open` : st === 'done' ? ', done' : ''}`}
                className={cn('flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm max-lg:whitespace-nowrap max-lg:ring-1 max-lg:ring-inset', on ? 'bg-pill font-medium text-fg max-lg:ring-border-strong' : 'text-fg-2 hover:bg-hover hover:text-fg max-lg:ring-border')}>
                <span className="num w-3 shrink-0 text-[12px] text-fg-3 max-lg:hidden">{i || ''}</span>
                <span className="min-w-0 flex-1 leading-snug"><span className="lg:hidden">{s.short}</span><span className="max-lg:hidden">{s.rail ?? s.label}</span></span>
                {n > 0 && <span className="num text-[12px] text-fg-3">{n}</span>}
                {st && <span className="grid w-3.5 shrink-0 place-items-center">{MARK[st]}</span>}
              </button>
            </li>
          )
        })}
      </ol>
      <div className="mt-4 hidden space-y-0.5 border-t border-border pt-3 lg:block">
        <button onClick={() => f.refs.show('workings')} className="flex h-8 w-full items-center gap-2 rounded-lg px-3 text-[13px] text-fg-3 hover:bg-hover hover:text-fg"><Calculator className="size-3.5" />Workings and sources</button>
        <Link to="/flying/plan/profiles" className="flex h-8 w-full items-center gap-2 rounded-lg px-3 text-[13px] text-fg-3 hover:bg-hover hover:text-fg"><Users className="size-3.5" />Profiles</Link>
      </div>
    </nav>
  )
}

function Status() {
  const f = useFlight()
  if (!f.loading.length && !f.failed.length) return null
  return (
    <div role="status" aria-live="polite" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] print:hidden">
      {f.loading.length > 0 && <span className="inline-flex items-center gap-2 text-fg-3"><Loader2 className="size-3.5 animate-spin" />Loading {f.loading.join(', ')}…</span>}
      {f.failed.map(([n, retry]) => <span key={n} className="inline-flex items-center gap-1.5 text-fg-2">Couldn't load {n}<button className="text-accent hover:underline" onClick={() => retry()}>Retry</button></span>)}
    </div>
  )
}

// Next and previous section at the foot of each one: the file reads front to back.
function Pager() {
  const f = useFlight()
  const i = SECTIONS.findIndex(s => s.key === f.state.section)
  const next = SECTIONS[i + 1], prev = SECTIONS[i - 1]
  return (
    <div className="mt-10 flex items-center gap-2 border-t border-border pt-4 print:hidden">
      {prev && <Button variant="ghost" onClick={() => f.go(prev.key)}>{prev.label}</Button>}
      {next && <Button variant="secondary" className="ml-auto" onClick={() => f.go(next.key)}>{next.label}<ChevronRight /></Button>}
    </div>
  )
}

/* ── Overview ── */
function Overview() {
  const f = useFlight()
  const { d, plan } = f
  const t = d.totals
  const to = d.wb.steps.find(x => x.total && x.label.startsWith('Takeoff'))
  const must = f.tasks.filter(x => x.kind !== 'recommended'), rec = f.tasks.filter(x => x.kind === 'recommended')
  const fact = (k: string, v: React.ReactNode, topic?: string) => (
    <div key={k} className="min-w-0"><dt className="text-[13px] text-fg-3">{k}</dt><dd className="num mt-1 truncate text-[15px] text-fg">{topic ? <button className="fig" onClick={() => f.explain({ kind: 'topic', key: topic })}>{v}</button> : v}</dd></div>
  )
  const code = (a: { icao: string | null; id: string }) => a.icao || a.id
  const dep = d.perf.find(p => p.kind === 'takeoff'), arr = [...d.perf].reverse().find(p => p.kind === 'landing' && p.wx.role !== 'alternate')
  const areas: [SectionKey, React.ReactNode][] = [
    ['pilot', [f.role === 'dual' ? `Dual with ${plan.crew?.instructor?.trim() || 'an instructor'}` : 'You as pilot in command', f.certs?.certificate ? null : 'certificate not saved'].filter(Boolean).join(' · ')],
    ['aircraft', plan.tail ? `${plan.tail} · ${f.acName}${d.profile ? ` · ${d.profile.engine.split(',')[0]}` : ''}` : 'Not chosen yet'],
    ['weather', d.wx.length ? d.wx.filter(w => w.role !== 'alternate').map(w => `${code(w.airport)} ${w.category ?? 'no report'} at ${fmtTime(w.at)}`).join(' · ') : 'Once the route is set'],
    ['airports', [dep?.runway && `${code(dep.airport)} RWY ${dep.runway.end.id}`, arr?.runway && `${code(arr.airport)} RWY ${arr.runway.end.id}`, f.effAlt ? `alternate ${f.effAlt}` : plan.alternate === false && 'no alternate'].filter(Boolean).join(' · ') || 'Once the route is set'],
    ['route', d.legs.length ? `${d.flights.map(x => `${x.alt.toLocaleString()} ft`).join(' / ')} · ${Math.round(t.distNm)} nm · ${t.requiredFuel.toFixed(1)} of ${t.usableFuel.toFixed(1)} gal needed` : 'Once the route resolves'],
    ['loading', to ? `Takeoff ${Math.round(to.weight).toLocaleString()} lb, CG ${to.arm?.toFixed(1)} in${dep?.dist && dep.runway ? ` · ${dep.dist.total.toLocaleString()} of ${dep.runway.toraFt.toLocaleString()} ft to clear 50 ft` : ''}` : 'Once the aircraft is chosen'],
  ]
  return (
    <div className="space-y-8">
      <section className="rounded-xl bg-card px-4 py-5 ring-1 ring-inset ring-white/[0.04] sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <VerdictIcon status={f.verdict} className="size-6" />
          <h2 className="text-xl font-medium tracking-[-0.015em] text-fg">{f.verdictLabel}</h2>
          <span className="text-sm text-fg-3">{f.verdict === 'nogo' ? 'Something below rules this flight out as planned.' : f.verdict === 'todo' ? 'Finish the items below for a complete brief.' : f.verdict === 'caution' ? 'Legal and within limits; weigh the decisions below.' : 'Legal, within limits and every check passed.'}</span>
        </div>
        {d.legs.length > 0 && (
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
            {fact('Takeoff → land', <>{fmtTime(d.takeoffAt)} → {fmtTime(d.legs.at(-1)!.arriveAt)}</>, 'legs')}
            {fact('Distance · time', <>{Math.round(t.distNm)} nm · {fmtMin(t.eteMin)}</>, 'legs')}
            {fact('Fuel needed · aboard', <>{t.requiredFuel.toFixed(1)} · {t.usableFuel.toFixed(1)} gal</>, 'fuel')}
            {fact('Takeoff weight · CG', to ? <>{Math.round(to.weight).toLocaleString()} lb · {to.arm?.toFixed(1)} in</> : '—', 'wb')}
            {fact('Cruise', <>{d.flights.map(x => `${x.alt.toLocaleString()} ft`).join(' / ')}{d.flights[0]?.cruise ? ` · ${d.flights[0].cruise.ktas} KTAS` : ''}</>, 'perf')}
          </dl>
        )}
        {d.legs.length > 0 && <p className="mt-4 text-[13px] text-fg-3">Select a figure for how it was worked out.</p>}
      </section>

      {must.length > 0 && (
        <section>
          <h3 className="mb-1 text-[15px] font-medium text-fg">Before this brief is complete</h3>
          <p className="mb-2 text-[13px] text-fg-3">Worst first. Each links to the section where it's done.</p>
          <ul className="divide-y divide-border rounded-xl px-4 ring-1 ring-inset ring-border sm:px-5">{must.map(x => <TaskRow key={x.id} t={x} onGo={() => f.go(x.section)} />)}</ul>
        </section>
      )}

      {!must.length && plan.route.length > 1 && (
        <section className="rounded-xl px-4 py-4 ring-1 ring-inset ring-border sm:px-5">
          <h3 className="text-[15px] font-medium text-fg">Ready for the NavLog</h3>
          <p className="mt-1 text-sm text-fg-2">Print it with the weather log, flight plan and {plan.tail}'s checklist, file the flight plan with Flight Service if you want one, and preflight with the checklist.</p>
          <div className="mt-3 flex flex-wrap gap-2"><Button variant="primary" onClick={() => f.go('navlog')}><Printer />NavLog</Button><Button variant="ghost" onClick={() => f.refs.show('checklist')}>Checklist</Button></div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-[15px] font-medium text-fg">The brief</h3>
        <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {areas.map(([k, v]) => {
            const st = sectionState(f.tasks, k)
            return (
              <li key={k}>
                <button onClick={() => f.go(k)} className="flex h-full w-full items-start gap-3 rounded-xl bg-card px-4 py-3.5 text-left ring-1 ring-inset ring-white/[0.04] hover:bg-hover">
                  <span className="mt-1.5 grid w-3.5 shrink-0 place-items-center">{MARK[st]}</span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{SECTION_LABEL[k]}</span><span className="mt-0.5 block text-[13px] text-fg-3">{v}</span></span>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-fg-3" />
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {rec.length > 0 && (
        <section>
          <h3 className="mb-1 text-[15px] font-medium text-fg">For a complete picture</h3>
          <p className="mb-2 text-[13px] text-fg-3">Not part of the go/no-go; they replace stand-ins with this airplane's own data.</p>
          <ul className="divide-y divide-border rounded-xl px-4 ring-1 ring-inset ring-border sm:px-5">{rec.map(x => <TaskRow key={x.id} t={x} onGo={() => f.go(x.section)} />)}</ul>
        </section>
      )}
      <p className="text-[13px] text-fg-3">Not a substitute for a standard briefing (1800wxbrief.com or 1-800-WX-BRIEF), your instructor's judgment or the POH in the airplane.</p>
    </div>
  )
}

/* ── New flight ── */
// Four things make a flight: when and where, the airplane, and who's flying.
// Everything else is asked in its section, and the overview lists what's left.
function NewFlight() {
  const f = useFlight()
  const { plan } = f
  const ready = plan.route.length > 1 && !!plan.tail
  const inputs = { plan, set: f.set, d: f.d, u: f.u, profile: f.d.profile, certs: f.certs ?? null }
  return (
    <div className="space-y-6">
      <NeedsPilotProfile />
      <div className="rounded-xl bg-card px-4 py-6 ring-1 ring-inset ring-white/[0.04] sm:px-7">
        <Step n={1} title="Where and when" lead="Departure, any points to fly over, and the arrival (the departure again for a local flight). The engine-start time sets the weather and winds."><FlightInputs bare step={2} {...inputs} /><FlightInputs bare step={3} {...inputs} /></Step>
        <Step n={2} title="Aircraft" lead="One of your aircraft, or a new one: its registry, POH, weights and checklist are set up once and kept."><AircraftPicker /></Step>
        <Step n={3} title="Who's flying" lead="Solo or as pilot in command, or dual with one of your instructors. It decides which FAA rules apply."><CrewPicker /></Step>
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
          {!ready && <span className="text-[13px] text-fg-3">{plan.route.length < 2 ? 'Add the arrival airport.' : 'Choose the aircraft.'}</span>}
          <Button variant="primary" className="ml-auto" disabled={!ready} onClick={f.finishSetup}>Brief this flight<ChevronRight /></Button>
        </div>
      </div>
    </div>
  )
}

function Step({ n, title, lead, children }: { n: number; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-border py-6 first:border-t-0 first:pt-0 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8">
      <div><div className="flex items-baseline gap-2"><span className="num text-[13px] text-fg-3">{n}</span><h3 className="text-[15px] font-medium text-fg">{title}</h3></div><p className="mt-1 text-[13px] text-fg-3">{lead}</p></div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

/* ── Saved plans ── */
const routeOf = (p: Plan) => p.route.map(r => { const id = parseRouteItem(r).id; return p.labels?.[id]?.name ?? id }).join(' → ') || 'No route'
const whenOf = (p: Plan) => { const d = new Date(p.departLocal); return Number.isNaN(+d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' }) }

function PlanList({ plans, loading, currentId, draft, unsaved, onSave, onOpen, onNew }: {
  plans: SavedPlan[] | undefined; loading: boolean; currentId: number | null; draft: Plan | null
  // The open plan's name when leaving it would lose changes: opening another or starting new asks first.
  unsaved: string | null; onSave: () => Promise<void>; onOpen: (p: SavedPlan) => void; onNew: () => void
}) {
  const [leave, setLeave] = useState<(() => void) | null>(null)
  const guard = (go: () => void) => (unsaved ? setLeave(() => go) : go())
  if (leave) return (
    <div className="p-2">
      <p className="text-sm text-fg">"{unsaved}" has unsaved changes.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={async () => { await onSave(); leave(); setLeave(null) }}>Save and continue</Button>
        <Button size="sm" variant="ghost" onClick={() => { leave(); setLeave(null) }}>Discard changes</Button>
        <Button size="sm" variant="ghost" onClick={() => setLeave(null)}>Cancel</Button>
      </div>
    </div>
  )
  const now = Date.now()
  const at = (p: SavedPlan) => +new Date(p.data.departLocal) || 0
  const upcoming = (plans ?? []).filter(p => at(p) >= now - 3 * 3600_000).sort((a, b) => at(a) - at(b))
  const past = (plans ?? []).filter(p => at(p) < now - 3 * 3600_000).sort((a, b) => at(b) - at(a))
  const Item = ({ p }: { p: SavedPlan }) => (
    <li>
      <button onClick={() => (p.id === currentId ? undefined : guard(() => onOpen(p)))} aria-current={p.id === currentId ? 'true' : undefined}
        className={cn('w-full rounded-lg px-3 py-2 text-left ring-1 ring-inset', p.id === currentId ? 'bg-accent-soft ring-accent/40' : 'ring-transparent hover:bg-hover')}>
        <div className={cn('truncate text-sm', p.id === currentId ? 'font-medium text-accent' : 'text-fg')}>{p.name}</div>
        <div className="num truncate text-xs text-fg-3">{routeOf(p.data)}</div>
        <div className="text-xs text-fg-3">{whenOf(p.data)}{p.data.tail ? ` · ${p.data.tail}` : ''}</div>
      </button>
    </li>
  )
  const Group = ({ title, list }: { title: string; list: SavedPlan[] }) => list.length ? (
    <div><div className="px-3 pb-1 pt-3 text-xs font-medium text-fg-3">{title}</div><ul className="space-y-0.5">{list.map(p => <Item key={p.id} p={p} />)}</ul></div>
  ) : null
  return (
    <div className="flex max-h-[inherit] flex-col">
      <div className="flex items-center justify-between gap-2 pb-2">
        <span className="text-sm font-medium text-fg">Flights</span>
        <Button variant="ghost" size="sm" onClick={() => guard(onNew)}><FilePlus2 />New flight</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {draft && (
          <div className="mb-1 rounded-lg bg-accent-soft px-3 py-2 ring-1 ring-inset ring-accent/40">
            <div className="truncate text-sm font-medium text-accent">{draft.name}</div>
            <div className="num truncate text-xs text-fg-3">{routeOf(draft)}</div>
            <div className="text-xs text-fg-3">Not saved yet</div>
          </div>
        )}
        {loading && <p className="flex items-center gap-2 px-3 py-2 text-sm text-fg-3"><Loader2 className="size-4 animate-spin" />Loading…</p>}
        {!loading && !plans?.length && <p className="px-3 py-2 text-sm text-fg-3">No saved flights yet.</p>}
        <Group title="Upcoming" list={upcoming} />
        <Group title="Past" list={past} />
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Calculator, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FilePlus2, Loader2, MoreHorizontal, Navigation, Pencil, Plane, Printer, Trash2, UserRound, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { relTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { usePlan, type SavedPlan } from './api'
import { FlightInputs } from './FlightInputs'
import { parseRouteItem, type Status } from './model'
import { AircraftPicker, CrewPicker, RouteAirportProfiles } from './Pickers'
import { Summary } from './Summary'
import { SECTIONS, sectionState, type SectionKey, type TaskKind } from './readiness'
import { RefProvider } from './RefPanel'
import { AircraftSection, AirportsSection, NavlogDoc, NavlogSection, PilotSection, RouteSection, WbDoc, WbSection, WeatherBriefSection, WxDoc } from './Sections'
import { VerdictIcon, fmtMin } from './ui'
import { FlightCtx, useFlight, useFlightActions, useFlightState } from './useFlight'
import { WorkSheet } from './WorkSheet'

// One flight (docs/planner-ux.md), at its own address: a new flight asks
// where and when, the aircraft and who's flying; then the brief (pilot,
// aircraft, airports, route and fuel) produces three outputs: the NavLog, the
// weight and balance and the weather briefing. It saves itself as you edit.
export default function PlannerPage() {
  const { id } = useParams()
  const n = Number(id)
  const q = usePlan(Number.isInteger(n) ? n : null)
  if (q.isLoading) return <p className="flex items-center gap-2 text-sm text-fg-3"><Loader2 className="size-4 animate-spin" />Opening the flight…</p>
  if (!q.data) return (
    <div className="rounded-xl bg-card px-6 py-10 text-center ring-1 ring-inset ring-white/[0.04]">
      <p className="text-[15px] font-medium text-fg">This flight doesn't exist</p>
      <p className="mt-1 text-sm text-fg-3">It may have been deleted.</p>
      <Button asChild className="mt-4" variant="secondary"><Link to="/flying/plan">All flights</Link></Button>
    </div>
  )
  return <RefProvider key={n}><Shell saved={q.data} /></RefProvider>
}

function Shell({ saved }: { saved: SavedPlan }) {
  const [params, setParams] = useSearchParams()
  const s = params.get('s')
  const section = (SECTIONS.some(x => x.key === s) ? s : 'overview') as SectionKey
  const f = useFlightState({ saved, section, setSection: k => setParams(k === 'overview' ? {} : { s: k }) })
  const sheet = f.refs.state.open
  // Print all three outputs: render them together for the print, then go back.
  const [printing, setPrinting] = useState(false)
  useEffect(() => { if (!printing) return; const t = setTimeout(() => window.print(), 400); const done = () => setPrinting(false); window.addEventListener('afterprint', done); return () => { clearTimeout(t); window.removeEventListener('afterprint', done) } }, [printing])
  const printAll = () => setPrinting(true)
  return (
    <FlightCtx.Provider value={f}>
      <div className="planner">
        <div className={cn(printing && 'print:hidden')}>
          <Header printAll={printAll} />
          {f.setup ? <NewFlight /> : (
            <div className={cn('grid gap-6 lg:grid-cols-[14.5rem_minmax(0,1fr)]', sheet && (f.refs.state.wide ? '2xl:grid-cols-[14.5rem_minmax(0,1fr)_minmax(28rem,42%)]' : '2xl:grid-cols-[14.5rem_minmax(0,1fr)_28rem] min-[2200px]:grid-cols-[14.5rem_minmax(0,1fr)_34rem]'))}>
              <Rail />
              <main className="@container min-w-0">
                <Status />
                {section === 'overview' && <Summary printAll={printAll} />}
                {section === 'pilot' && <PilotSection />}
                {section === 'aircraft' && <AircraftSection />}
                {section === 'airports' && <AirportsSection />}
                {section === 'route' && <RouteSection />}
                {section === 'navlog' && <NavlogSection />}
                {section === 'loading' && <WbSection />}
                {section === 'weather' && <WeatherBriefSection />}
                <Pager />
              </main>
              <WorkSheet />
            </div>
          )}
        </div>
        {printing && <div className="hidden space-y-8 print:block"><NavlogDoc /><WbDoc /><WxDoc /></div>}
      </div>
    </FlightCtx.Provider>
  )
}

/* ── Header ── */
function Header({ printAll }: { printAll: () => void }) {
  const f = useFlight()
  const a = useFlightActions()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { plan, d } = f
  const when = d.departAt?.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const crew = [f.pilot?.name, f.role === 'dual' ? `dual with ${plan.crew?.instructor?.trim() || 'an instructor'}` : f.pilot ? ((f.certs?.certificate ?? 'student') === 'student' ? 'solo' : 'PIC') : null].filter(Boolean).join(' ')
  return (
    <header className="mb-6 print:hidden">
      <Link to="/flying/plan" className="mb-1 inline-flex items-center gap-1 text-[13px] text-fg-3 hover:text-fg"><ChevronLeft className="size-3.5" />All flights</Link>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <label className="group flex min-w-0 items-center gap-2">
            <input value={plan.name} onChange={e => f.set({ name: e.target.value })} aria-label="Flight name" placeholder="Name this flight" size={Math.max(10, plan.name.length + 1)}
              className="field-sizing-content min-w-0 max-w-full bg-transparent text-2xl font-medium tracking-[-0.02em] text-fg outline-none placeholder:text-fg-3 focus:underline" />
            <Pencil className="size-4 shrink-0 text-fg-3 group-hover:text-fg" aria-hidden />
          </label>
          {!f.setup && (
            <p className="mt-1 text-sm text-fg-3">
              {plan.name.replace(/\s/g, '') !== f.routeText.replace(/\s/g, '') && <><span className="num text-fg-2">{f.routeText}</span> · </>}{when}{plan.tail && <> · <span className="num">{plan.tail}</span></>}{crew && <> · {crew}</>}
              {d.legs.length > 0 && <> · <span className="num">{Math.round(d.totals.distNm)} nm · {fmtMin(d.totals.eteMin)}</span></>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!f.setup && f.section !== 'overview' && <Verdict onClick={() => f.go('overview')} />}
          <SaveStatus />
          <Switcher />
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={printAll}><Printer />Print all three outputs</MenuItem>
              <MenuItem onSelect={() => a.duplicate(plan)}><Copy />Copy as a new flight</MenuItem>
              <MenuItem onSelect={() => f.refs.show('workings')}><Calculator />All workings and sources</MenuItem>
              <MenuItem asChild><Link to="/flying/plan/profiles"><Users />Profiles</Link></MenuItem>
              <MenuItem danger onSelect={() => setConfirmDelete(true)}><Trash2 />Delete flight</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
      {confirmDelete && (
        <div role="alertdialog" aria-label="Delete this flight?" className="mt-3 flex flex-wrap items-center justify-end gap-2 text-[13px]">
          <span className="text-fg-2">Delete "{plan.name}" and everything in it for good?</span>
          <Button size="sm" variant="danger" onClick={() => a.remove(f.id, () => window.location.assign('/flying/plan'))}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
        </div>
      )}
    </header>
  )
}

// Saving happens on its own; this says where it's at, and offers a retry when it failed.
function SaveStatus() {
  const f = useFlight()
  const st = f.saveState
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex h-9 items-center gap-1.5 px-1 text-[13px]', st === 'error' ? 'text-bad' : 'text-fg-3')}>
      {st === 'saved' && <><Check className="size-4" />Saved {relTime(f.savedAt)}</>}
      {(st === 'pending' || st === 'saving') && <><Loader2 className="size-3.5 animate-spin" />Saving…</>}
      {st === 'error' && <>Couldn't save<button className="text-accent hover:underline" onClick={f.retrySave}>Retry</button></>}
    </span>
  )
}

// The other flights, to switch to (each opens at its own address) or start a new one.
function Switcher() {
  const f = useFlight()
  const a = useFlightActions()
  const [open, setOpen] = useState(false)
  const list = (a.plans.data ?? []).filter(p => p.id !== f.id).slice(0, 12)
  const routeOf = (p: SavedPlan) => p.data.route.map(r => parseRouteItem(r).id).join(' → ')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="ghost">Flights<ChevronDown /></Button></PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70dvh] w-80 overflow-y-auto p-2">
        <div className="flex items-center justify-between gap-2 pb-2">
          <Link to="/flying/plan" className="px-2 text-sm font-medium text-fg hover:underline" onClick={() => setOpen(false)}>All flights</Link>
          <Button variant="ghost" size="sm" onClick={() => { setOpen(false); a.newFlight() }}><FilePlus2 />New flight</Button>
        </div>
        <ul className="space-y-0.5">
          {list.map(p => (
            <li key={p.id}>
              <Link to={`/flying/plan/${p.id}`} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-hover">
                <div className="truncate text-sm text-fg">{p.name}</div>
                <div className="num truncate text-xs text-fg-3">{routeOf(p)} · {new Date(p.data.departLocal).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
              </Link>
            </li>
          ))}
          {!list.length && <li className="px-3 py-2 text-sm text-fg-3">No other flights yet.</li>}
        </ul>
      </PopoverContent>
    </Popover>
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

/* ── Rail: the brief, then the outputs, and what's open in each ── */
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
  const item = (s: (typeof SECTIONS)[number]) => {
    const on = f.section === s.key
    const st = s.key === 'overview' ? null : s.key === 'navlog' ? (f.d.flights.length ? 'done' : 'todo') : sectionState(f.tasks, s.key)
    const n = s.key === 'overview' || s.key === 'navlog' ? 0 : open(s.key)
    return (
      <li key={s.key}>
        <button onClick={() => f.go(s.key)} aria-current={on ? 'page' : undefined} aria-label={`${s.label}${n ? `, ${n} open` : st === 'done' ? ', done' : ''}`}
          className={cn('flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm max-lg:whitespace-nowrap max-lg:ring-1 max-lg:ring-inset', on ? 'bg-pill font-medium text-fg max-lg:ring-border-strong' : 'text-fg-2 hover:bg-hover hover:text-fg max-lg:ring-border')}>
          <span className="min-w-0 flex-1 leading-snug"><span className="lg:hidden">{s.short}</span><span className="max-lg:hidden">{s.label}</span></span>
          {n > 0 && <span className="num text-[12px] text-fg-3">{n}</span>}
          {st && <span className="grid w-3.5 shrink-0 place-items-center">{MARK[st]}</span>}
        </button>
      </li>
    )
  }
  return (
    <nav aria-label="Flight" className="print:hidden max-lg:-mx-4 max-lg:overflow-x-auto max-lg:px-4 max-lg:scrollbar-none lg:sticky lg:top-20 lg:self-start">
      <div className="flex gap-1 max-lg:pb-1 lg:flex-col">
        <ol className="contents lg:flex lg:flex-col lg:gap-1">{SECTIONS.filter(s => s.group === 'brief').map(item)}</ol>
        <div className="mx-3 mt-3 mb-1 text-[12px] font-medium uppercase tracking-wide text-fg-3 max-lg:hidden">Outputs</div>
        <ol className="contents lg:flex lg:flex-col lg:gap-1">{SECTIONS.filter(s => s.group === 'output').map(item)}</ol>
      </div>
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

function Pager() {
  const f = useFlight()
  const i = SECTIONS.findIndex(s => s.key === f.section)
  const next = SECTIONS[i + 1], prev = SECTIONS[i - 1]
  return (
    <div className="mt-10 flex items-center gap-2 border-t border-border pt-4 print:hidden">
      {prev && <Button variant="ghost" onClick={() => f.go(prev.key)}>{prev.label}</Button>}
      {next && <Button variant="secondary" className="ml-auto" onClick={() => f.go(next.key)}>{next.label}<ChevronRight /></Button>}
    </div>
  )
}

/* ── New flight ── */
// Three things make a flight: where and when, the airplane, and who's flying
// (loaded from profiles, or created here). Everything else is asked in its section.
function NewFlight() {
  const f = useFlight()
  const { plan } = f
  const ready = plan.route.length > 1 && !!plan.tail && !!f.pilot
  const inputs = { plan, set: f.set, d: f.d, u: f.u, profile: f.d.profile, certs: f.certs ?? null }
  return (
    <div className="rounded-xl bg-card px-4 py-6 ring-1 ring-inset ring-white/[0.04] sm:px-7">
      <Step n={1} icon={Navigation} title="Where and when"><FlightInputs bare step={2} {...inputs} /><FlightInputs bare step={3} {...inputs} /><div className="mt-5"><RouteAirportProfiles /></div></Step>
      <Step n={2} icon={Plane} title="Aircraft"><AircraftPicker /></Step>
      <Step n={3} icon={UserRound} title="Who's flying"><CrewPicker /></Step>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        {!ready && <span className="text-[13px] text-fg-3">{plan.route.length < 2 ? 'Add the arrival (the departure again for a local flight).' : !plan.tail ? 'Choose the aircraft.' : 'Choose the pilot.'}</span>}
        <Button variant="primary" className="ml-auto max-sm:w-full" disabled={!ready} onClick={f.finishSetup}>Brief this flight<ChevronRight /></Button>
      </div>
    </div>
  )
}

function Step({ n, icon: I, title, children }: { n: number; icon: typeof Plane; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-border py-6 first:border-t-0 first:pt-0 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
      <div className="flex items-center gap-3 lg:items-start">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><I className="size-4" /></span>
        <div><div className="num text-[12px] text-fg-3">Step {n}</div><h3 className="text-[15px] font-medium text-fg">{title}</h3></div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

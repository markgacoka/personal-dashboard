import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, FilePlus2, Printer, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { PageHeader } from '@/components/data/stat'
import { useAircraftList, useFlights, useRegistry } from '@/lib/queries'
import { computeCurrency } from '@/lib/flying'
import { homeAirport } from '@/lib/weather'
import { cn } from '@/lib/utils'
import { bboxOf, useAirports, useAirspace, useCorridor, useMinimums, usePlanning, usePlans, useTerrain, useWeather } from './api'
import { sampleRoute } from './calc'
import { DEFAULT_MINIMUMS, derive, parseRouteItem, type Plan, type SectionKey, type Status } from './model'
import { profileFor } from './poh'
import { AircraftSection } from './AircraftSection'
import { LoadingSection } from './LoadingSection'
import { NavlogSection } from './NavlogSection'
import { PerformanceSection } from './PerformanceSection'
import { PilotSection } from './PilotSection'
import { RefPanel, RefProvider, useRefs } from './RefPanel'
import { ReviewStep } from './ReviewStep'
import { TripSection } from './TripSection'
import { WeatherSection } from './WeatherSection'
import { CheckRows, Section, StatusIcon, fmtMin, fmtTime } from './ui'

export const QUESTIONS: { key: SectionKey; q: string; short: string }[] = [
  { key: 'trip', q: 'Where am I going?', short: 'Trip' },
  { key: 'pilot', q: 'Am I okay to go?', short: 'Pilot' },
  { key: 'aircraft', q: 'What am I going with?', short: 'Aircraft' },
  { key: 'loading', q: 'Can it carry the load?', short: 'Weight & balance' },
  { key: 'performance', q: 'Can it get off and back on the ground?', short: 'Performance' },
  { key: 'navlog', q: 'How do I get there?', short: 'Navlog' },
  { key: 'weather', q: 'Is it safe there and back?', short: 'Weather & risks' },
]
const REVIEW = QUESTIONS.length

const DRAFT_KEY = 'planner-draft-v1'
const pad = (n: number) => String(n).padStart(2, '0')
const nextHourLocal = () => { const d = new Date(Date.now() + 60 * 60_000); d.setMinutes(0, 0, 0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00` }
const blank = (tail: string | null): Plan => ({
  name: 'New flight', route: [homeAirport()], alternate: null, departLocal: nextHourLocal(), cruiseAlt: 4500, rpm: 2400, tail,
  loads: { front: 0, rear: 0, bag1: 0, bag2: 0 }, fuelGal: 40, stopMinutes: 15, imsafe: {}, pave: {}, equipment: {}, phases: {}, night: null, actuals: {},
})
interface Draft { plan: Plan; id: number | null; step?: number }
function readDraft(): Draft | null {
  try { const s = localStorage.getItem(DRAFT_KEY); return s ? JSON.parse(s) : null } catch { return null }
}

export default function PlannerPage() {
  return <RefProvider><Planner /></RefProvider>
}

function Planner() {
  const refs = useRefs()!
  const { data: flights = [] } = useFlights()
  const { data: fleetRaw = [] } = useAircraftList()
  const recentTail = useMemo(() => [...flights].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.aircraft?.tail_number ?? null, [flights])
  const fleet = useMemo(() => {
    const used = new Map<string, string>()
    for (const f of flights) if (f.aircraft?.tail_number && (!used.has(f.aircraft.tail_number) || String(f.date) > used.get(f.aircraft.tail_number)!)) used.set(f.aircraft.tail_number, String(f.date))
    return [...fleetRaw].sort((a, b) => (used.get(b.tail_number) ?? '').localeCompare(used.get(a.tail_number) ?? '') || a.tail_number.localeCompare(b.tail_number))
  }, [fleetRaw, flights])

  const [state, setState] = useState<Draft>(() => readDraft() ?? { plan: blank(null), id: null, step: 0 })
  const plan = state.plan
  const step = Math.min(state.step ?? 0, REVIEW)
  const set = (p: Partial<Plan>) => setState(s => ({ ...s, plan: { ...s.plan, ...p } }))
  const go = (n: number) => { setState(s => ({ ...s, step: Math.max(0, Math.min(REVIEW, n)) })); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  useEffect(() => { if (!plan.tail && recentTail) set({ tail: recentTail }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [recentTail])
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)) } catch { /* private mode */ } }, [state])

  // ── Data ──
  const ids = useMemo(() => [...new Set([...plan.route.map(r => parseRouteItem(r).id), ...(plan.alternate ? [plan.alternate] : [])])], [plan.route, plan.alternate])
  const apts = useAirports(ids, plan.departLocal.slice(0, 10))
  const airports = useMemo(() => apts.data?.airports ?? [], [apts.data])
  const routePts = useMemo(() => plan.route.map(r => { const id = parseRouteItem(r).id; return airports.find(a => a.icao === id || a.id === id) }).filter(Boolean) as { lat: number; lon: number }[], [plan.route, airports])
  const allPts = useMemo(() => [...routePts, ...airports], [routePts, airports])
  const wx = useWeather(ids.map(i => (i.length === 3 && !/\d/.test(i) ? `K${i}` : i)), useMemo(() => bboxOf(allPts), [allPts]))
  const samples = useMemo(() => sampleRoute(routePts, 2), [routePts])
  const terrain = useTerrain(samples)
  const airspace = useAirspace()
  const corridor = useCorridor(useMemo(() => (routePts.length > 1 ? bboxOf(routePts, 0.12) : null), [routePts]))
  const registry = useRegistry(plan.tail ?? undefined)
  const planningQ = usePlanning(plan.tail)
  const planning = useMemo(() => planningQ.data ?? {}, [planningQ.data])
  const minQ = useMinimums()
  const minimums = useMemo(() => ({ ...DEFAULT_MINIMUMS, ...(minQ.data || {}) }), [minQ.data])
  const fleetModel = fleet.find(a => a.tail_number === plan.tail)?.model ?? registry.data?.model ?? null
  const match = useMemo(() => (plan.tail ? profileFor(fleetModel) : null), [plan.tail, fleetModel])
  const currency = useMemo(() => computeCurrency(flights), [flights])
  const plans = usePlans()

  const d = useMemo(() => derive(plan, {
    airports, weather: wx.data ?? null, match, planning, minimums, terrain: terrain.data?.elevations ?? null,
    currency, airspace: airspace.data ?? null, checkpoints: corridor.data ?? [],
  }), [plan, airports, wx.data, match, planning, minimums, terrain.data, currency, airspace.data, corridor.data])

  const nightAuto = d.wx.some(w => w.night)
  useEffect(() => { if (plan.night === null && nightAuto) set({ night: true }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [nightAuto])

  // Decision: any no-go rules it out; open items mean it isn't decided yet.
  const all = d.checks.map(c => c.status)
  const overall: Status = all.includes('nogo') ? 'nogo' : all.includes('todo') || plan.route.length < 2 ? 'todo' : all.includes('caution') ? 'caution' : 'ok'
  const verdict = overall === 'nogo' ? { label: 'No-go', sub: 'At least one item rules this flight out as planned.' }
    : overall === 'caution' ? { label: 'Go with caution', sub: 'Legal, but review every caution and decide.' }
    : overall === 'todo' ? { label: 'Incomplete', sub: `Finish the ${all.filter(s => s === 'todo').length} open items to reach a decision${all.includes('caution') ? ' — and review the cautions' : ''}.` }
    : { label: 'Go', sub: 'Every check passed. Still get a standard briefing (1800wxbrief) before you go.' }

  const save = async () => {
    try {
      if (state.id) await plans.update.mutateAsync({ id: state.id, plan })
      else { const r = await plans.create.mutateAsync(plan); setState(s => ({ ...s, id: r.id })) }
      toast.success('Plan saved')
    } catch (e) { toast.error((e as Error).message) }
  }
  const routeText = plan.route.map(r => parseRouteItem(r).id).join(' → ') || 'No route yet'
  const stepStatus = (i: number): Status => (i === REVIEW ? overall : d.sections[QUESTIONS[i].key])
  const savePlanning = (p: typeof planning) => planningQ.save.mutate(p, { onSuccess: () => toast.success(`${plan.tail} saved`) })

  const answer: Record<SectionKey, React.ReactNode> = {
    trip: plan.route.length >= 2 ? <><span className="num">{routeText}</span>{plan.alternate && <> · alternate <span className="num">{plan.alternate}</span></>} · {plan.cruiseAlt.toLocaleString()} ft</> : 'Choose the airports',
    pilot: d.sections.pilot === 'nogo' ? 'Not today' : d.sections.pilot === 'todo' ? 'Answer IMSAFE and PAVE' : 'Fit to fly, risks reviewed',
    aircraft: plan.tail ? <><span className="num">{plan.tail}</span> · {match?.profile.model}{match && !match.exact && ' (closest POH)'}</> : 'Choose the aircraft',
    loading: d.profile ? <span className="num">Takeoff {Math.round(d.wb.takeoff.weight)} lb @ {d.wb.takeoff.cg.toFixed(1)} in · landing {Math.round(d.wb.landing.weight)} lb</span> : undefined,
    performance: d.perf.length ? `Tightest margin: ${Math.min(...d.perf.filter(p => p.margin != null).map(p => p.margin!)).toLocaleString()} ft beyond the 50-ft distance` : undefined,
    navlog: d.legs.length ? <span className="num">{d.navlog.length} checkpoints · {Math.round(d.totals.distNm)} nm · {fmtMin(d.totals.eteMin)} · {d.totals.tripFuel.toFixed(1)} gal · arrive {fmtTime(d.legs.at(-1)!.arriveAt)}</span> : undefined,
    weather: d.wx.length ? d.wx.map(w => `${w.airport.icao || w.airport.id} ${w.category ?? '—'}`).join(' · ') : undefined,
  }
  const body: Record<SectionKey, React.ReactNode> = {
    trip: <TripSection plan={plan} set={set} airports={airports} d={d} weather={wx.data ?? null} airspace={airspace.data} cycle={apts.data?.cycle ?? null} />,
    pilot: <PilotSection plan={plan} set={set} currency={currency} minimums={minimums} savedAt={minQ.data?.updatedAt} saveMinimums={m => minQ.save.mutate(m, { onSuccess: () => toast.success('Minimums saved') })} saving={minQ.save.isPending} />,
    aircraft: <AircraftSection plan={plan} set={set} fleet={fleet} registry={registry.data} match={match} planning={planning} savePlanning={savePlanning} saving={planningQ.save.isPending} night={!!plan.night} />,
    loading: <LoadingSection plan={plan} set={set} d={d} profile={d.profile} planning={planning} savePlanning={p => planningQ.save.mutate(p)} />,
    performance: <PerformanceSection d={d} profile={d.profile} />,
    navlog: <NavlogSection plan={plan} set={set} d={d} airports={airports} terrainAt={terrain.data?.fetchedAt} planning={planning} registry={registry.data} />,
    weather: <WeatherSection d={d} weather={wx.data ?? null} loading={wx.isLoading} refetch={() => wx.refetch()} fetching={wx.isFetching} />,
  }
  const q = QUESTIONS[step]
  const refOpen = refs.state.open
  const routeIds = plan.route.map(r => parseRouteItem(r).id)

  return (
    <div className="planner">
      <PageHeader
        title={<input value={plan.name} onChange={e => set({ name: e.target.value })} aria-label="Plan name" className="w-full min-w-0 bg-transparent outline-none focus:underline" />}
        description={<span><span className="num">{routeText}</span>{d.departAt && <> · {d.departAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}{d.legs.length > 0 && <> · <span className="num">{Math.round(d.totals.distNm)} nm · {fmtMin(d.totals.eteMin)}</span></>}</span>}
        actions={<div className="flex flex-wrap items-center gap-2 print:hidden">
          <Select value={state.id ?? ''} onChange={e => { const p = plans.data?.find(x => x.id === Number(e.target.value)); if (p) setState({ plan: p.data, id: p.id, step: 0 }) }} className="w-44" aria-label="Saved plans">
            <option value="">{plans.data?.length ? 'Saved plans…' : 'No saved plans'}</option>
            {plans.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button variant="secondary" onClick={() => setState({ plan: blank(recentTail), id: null, step: 0 })}><FilePlus2 />New</Button>
          <Button variant="primary" onClick={save} loading={plans.create.isPending || plans.update.isPending}><Save />Save</Button>
          {state.id && <Button variant="danger-ghost" size="icon" aria-label="Delete plan" onClick={() => { plans.remove.mutate(state.id!); setState({ plan: blank(recentTail), id: null, step: 0 }) }}><Trash2 /></Button>}
          <Button variant={refOpen ? 'secondary' : 'ghost'} onClick={() => (refOpen ? refs.close() : refs.show(refs.state.tab))} aria-pressed={refOpen}><BookOpen />POH &amp; briefing</Button>
          <Button variant="ghost" onClick={() => { go(REVIEW); setTimeout(() => window.print(), 400) }}><Printer />Print</Button>
        </div>}
      />

      {/* Steps */}
      <nav aria-label="Planning steps" className="sticky top-16 z-10 -mx-4 mb-5 overflow-x-auto bg-bg/90 px-4 py-2 backdrop-blur scrollbar-none sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 print:hidden">
        <ol className="flex min-w-max gap-1">
          {[...QUESTIONS.map(x => x.short), 'Review'].map((label, i) => (
            <li key={label}>
              <button onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}
                className={cn('press inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm', i === step ? 'bg-fg text-bg' : 'text-fg-2 hover:bg-pill')}>
                {i === step ? <span className="num grid size-5 place-items-center rounded-full bg-bg/15 text-xs">{i + 1}</span> : <StatusIcon status={stepStatus(i)} className="size-4" />}
                {label}
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-pill"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${((step + 1) / (REVIEW + 1)) * 100}%` }} /></div>
      </nav>

      <div className={cn('grid gap-6', refOpen && 'xl:grid-cols-[minmax(0,1fr)_minmax(26rem,44%)]')}>
        <div className="min-w-0 space-y-5">
          {step < REVIEW ? (
            <Section id={q.key} n={step + 1} question={q.q} status={d.sections[q.key]} answer={answer[q.key]}>
              {body[q.key]}
              <CheckRows checks={d.checks.filter(c => c.section === q.key)} />
            </Section>
          ) : (
            <ReviewStep plan={plan} d={d} overall={overall} verdict={verdict} airports={airports} weather={wx.data ?? null} airspace={airspace.data} currency={currency}
              minimums={minimums} planning={planning} registry={registry.data} match={match} terrainAt={terrain.data?.fetchedAt} onJump={k => go(QUESTIONS.findIndex(x => x.key === k))} />
          )}

          <div className="sticky bottom-20 z-10 flex items-center gap-3 rounded-xl bg-card/95 p-3 ring-1 ring-inset ring-border backdrop-blur lg:bottom-4 print:hidden">
            <Button variant="secondary" disabled={step === 0} onClick={() => go(step - 1)}><ArrowLeft />Back</Button>
            <div className="min-w-0 flex-1 text-center text-sm text-fg-3">
              <span className="num">{step + 1} of {REVIEW + 1}</span>
              <span className="hidden sm:inline"> · {step < REVIEW ? (step + 1 < REVIEW ? `Next: ${QUESTIONS[step + 1].q}` : 'Next: review everything') : verdict.label}</span>
            </div>
            {step < REVIEW
              ? <Button variant="primary" onClick={() => go(step + 1)}>{step + 1 === REVIEW ? 'Review' : 'Next'}<ArrowRight /></Button>
              : <Button variant="primary" onClick={save} loading={plans.create.isPending || plans.update.isPending}><Save />Save plan</Button>}
          </div>
        </div>

        {refOpen && (
          <aside className="fixed inset-0 z-40 bg-bg p-2 xl:sticky xl:inset-auto xl:top-32 xl:z-auto xl:h-[calc(100dvh-9rem)] xl:bg-transparent xl:p-0 print:hidden">
            <RefPanel className="h-full" model={match?.profile.key.replace(/^C/, '') ?? null} route={routeIds} date={plan.departLocal.slice(0, 10)} />
          </aside>
        )}
      </div>
    </div>
  )
}

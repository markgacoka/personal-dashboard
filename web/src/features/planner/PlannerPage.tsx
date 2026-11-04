import { useEffect, useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, BookOpen, FilePlus2, Printer, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { PageHeader } from '@/components/data/stat'
import { useAircraftList, useFlights, useRegistry } from '@/lib/queries'
import { get } from '@/lib/api'
import { notamBody } from '@/lib/weather'
import type { NotamResponse } from '@/lib/types'
import { computeCurrency } from '@/lib/flying'
import { homeAirport } from '@/lib/weather'
import { cn } from '@/lib/utils'
import { bboxOf, useAirports, useAirspace, useCorridor, useMinimums, usePilotInfo, usePlanning, usePlans, usePohFind, useRadar, useResolve, useTerrain, useWeather } from './api'
import { sampleRoute } from './calc'
import { DEFAULT_MINIMUMS, derive, isWaypoint, makeResolver, parseRouteItem, type Airport, type Plan, type SectionKey, type Status } from './model'
import { InputsChecklist, SetupStep } from './SetupStep'
import { NavlogSheet } from './NavlogSheet'
import type { MapNotams } from './PlannerMap'
import { unitsForTail } from './units'
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
import { CheckRows, Section, StatusIcon, SubHead, fmtMin, fmtTime } from './ui'
import { Card } from '@/components/ui/card'

export const QUESTIONS: { key: SectionKey; q: string; short: string }[] = [
  { key: 'trip', q: 'Where am I going?', short: 'Trip' },
  { key: 'pilot', q: 'Am I okay to go?', short: 'Pilot' },
  { key: 'aircraft', q: 'What am I going with?', short: 'Aircraft' },
  { key: 'loading', q: 'Can it carry the load?', short: 'Weight & balance' },
  { key: 'performance', q: 'Can it get off and back on the ground?', short: 'Performance' },
  { key: 'navlog', q: 'How do I get there?', short: 'Navlog' },
  { key: 'weather', q: 'Is it safe there and back?', short: 'Weather & risks' },
]
// Step 0 sets up the aircraft and route; steps 1–7 are the questions; then the
// review and the NavLog sheet.
const Q0 = 1
const REVIEW = QUESTIONS.length + Q0
const SHEET = REVIEW + 1
const LABELS = ['Aircraft & route', ...QUESTIONS.map(x => x.short), 'Review', 'NavLog']

const DRAFT_KEY = 'planner-draft-v2'
const pad = (n: number) => String(n).padStart(2, '0')
const nextHourLocal = () => { const d = new Date(Date.now() + 60 * 60_000); d.setMinutes(0, 0, 0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00` }
const blank = (tail: string | null): Plan => ({
  name: 'New flight', route: [homeAirport()], alternate: null, departLocal: nextHourLocal(), cruiseAlt: 4500, rpm: 2400, tail,
  loads: { front: 0, rear: 0, bag1: 0, bag2: 0 }, fuelGal: 40, stopMinutes: 15, imsafe: {}, pave: {}, equipment: {}, phases: {}, night: null, actuals: {},
})
interface Draft { plan: Plan; id: number | null; step?: number }
function readDraft(): Draft | null {
  try {
    const s = localStorage.getItem(DRAFT_KEY)
    if (s) return JSON.parse(s)
    const old = localStorage.getItem('planner-draft-v1')
    return old ? { ...JSON.parse(old), step: 0 } : null
  } catch { return null }
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
  const step = Math.min(state.step ?? 0, SHEET)
  const set = (p: Partial<Plan>) => setState(s => ({ ...s, plan: { ...s.plan, ...p } }))
  const go = (n: number) => { setState(s => ({ ...s, step: Math.max(0, Math.min(SHEET, n)) })); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  useEffect(() => { if (!plan.tail && recentTail) set({ tail: recentTail }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [recentTail])
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)) } catch { /* private mode */ } }, [state])

  // ── Data ──
  const tokens = useMemo(() => plan.route.map(r => parseRouteItem(r).id), [plan.route])
  const resolved = useResolve(tokens)
  const points = useMemo(() => resolved.data?.points ?? [], [resolved.data])
  const ids = useMemo(() => {
    const fromRoute = tokens.map(t => { const p = points.find(x => x.token.replace(/\*$/, '') === t); return p ? (p.kind === 'airport' ? p.id : null) : /^[A-Z0-9]{3,4}$/.test(t) ? t : null }).filter(Boolean) as string[]
    return [...new Set([...fromRoute, ...(plan.alternate ? [plan.alternate] : [])])]
  }, [tokens, points, plan.alternate])
  const apts = useAirports(ids, plan.departLocal.slice(0, 10))
  const airports = useMemo(() => apts.data?.airports ?? [], [apts.data])
  const resolve = useMemo(() => makeResolver(airports, points), [airports, points])
  const routeFull = useMemo(() => plan.route.map(resolve).filter(Boolean) as Airport[], [plan.route, resolve])
  const routePts = routeFull
  const allPts = useMemo(() => [...routePts, ...airports], [routePts, airports])
  const wx = useWeather(airports.map(a => a.icao || a.id), useMemo(() => bboxOf(allPts), [allPts]))
  const radar = useRadar()
  const notamIds = useMemo(() => airports.filter(a => a.icao).map(a => ({ icao: a.icao!, lat: a.lat, lon: a.lon })), [airports])
  const notamQs = useQueries({ queries: notamIds.map(n => ({ queryKey: ['wx', 'notam', n.icao], staleTime: 30 * 60_000, queryFn: () => get<NotamResponse>(`/api/external/notam/${n.icao}`).catch(() => ({ count: 0, notams: [], unavailable: true })) })) })
  const notams: MapNotams[] = notamIds.map((n, i) => { const r = notamQs[i]?.data; return { ...n, count: r?.notams.length ?? 0, items: (r?.notams || []).map(x => notamBody(x.text)), unavailable: r?.unavailable } })
  const samples = useMemo(() => sampleRoute(routePts, 2), [routePts])
  const terrain = useTerrain(samples)
  const airspace = useAirspace()
  const corridor = useCorridor(useMemo(() => (routePts.length > 1 ? bboxOf(routePts, 0.12) : null), [routePts]))
  const registry = useRegistry(plan.tail ?? undefined)
  const planningQ = usePlanning(plan.tail)
  const planning = useMemo(() => planningQ.data ?? {}, [planningQ.data])
  const minQ = useMinimums()
  const minimums = useMemo(() => ({ ...DEFAULT_MINIMUMS, ...(minQ.data || {}) }), [minQ.data])
  const fleetRef = fleet.find(a => a.tail_number === plan.tail)
  const aircraft = useMemo(() => ({
    make: plan.aircraft?.make || registry.data?.make || fleetRef?.make || null,
    model: plan.aircraft?.model || registry.data?.model || fleetRef?.model || null,
    year: plan.aircraft?.year ?? registry.data?.year ?? fleetRef?.year ?? null,
  }), [plan.aircraft, registry.data, fleetRef])
  const pohQ = usePohFind(plan.tail && aircraft.model ? aircraft : null)
  const match = useMemo(() => (plan.tail ? profileFor(aircraft.model) : null), [plan.tail, aircraft.model])
  const u = useMemo(() => unitsForTail(plan.tail), [plan.tail])
  const pilotQ = usePilotInfo()
  const currency = useMemo(() => computeCurrency(flights), [flights])
  const plans = usePlans()

  const d = useMemo(() => derive(plan, {
    airports, weather: wx.data ?? null, match, planning, minimums, terrain: terrain.data?.elevations ?? null,
    currency, airspace: airspace.data ?? null, checkpoints: corridor.data ?? [], points,
  }), [plan, airports, wx.data, match, planning, minimums, terrain.data, currency, airspace.data, corridor.data, points])

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
  const setupStatus: Status = plan.tail && plan.route.length >= 2 && !d.checks.some(c => c.section === 'trip' && c.status === 'nogo' && /NASR|start and end/.test(c.title)) ? 'ok' : 'todo'
  const stepStatus = (i: number): Status => (i === 0 ? setupStatus : i >= REVIEW ? overall : d.sections[QUESTIONS[i - Q0].key])
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
    trip: <TripSection plan={plan} set={set} resolve={resolve} d={d} weather={wx.data ?? null} airspace={airspace.data} cycle={apts.data?.cycle ?? null} radar={radar.data} notams={notams} />,
    pilot: <PilotSection plan={plan} set={set} currency={currency} minimums={minimums} savedAt={minQ.data?.updatedAt} saveMinimums={m => minQ.save.mutate(m, { onSuccess: () => toast.success('Minimums saved') })} saving={minQ.save.isPending} />,
    aircraft: <AircraftSection plan={plan} set={set} fleet={fleet} registry={registry.data} match={match} planning={planning} savePlanning={savePlanning} saving={planningQ.save.isPending} night={!!plan.night} />,
    loading: <LoadingSection plan={plan} set={set} d={d} profile={d.profile} planning={planning} savePlanning={p => planningQ.save.mutate(p)} u={u} />,
    performance: <PerformanceSection d={d} profile={d.profile} />,
    navlog: <NavlogSection plan={plan} set={set} d={d} airports={airports} terrainAt={terrain.data?.fetchedAt} planning={planning} registry={registry.data} u={u} />,
    weather: <WeatherSection d={d} weather={wx.data ?? null} loading={wx.isLoading} refetch={() => wx.refetch()} fetching={wx.isFetching} />,
  }
  const q = step >= Q0 && step < REVIEW ? QUESTIONS[step - Q0] : null
  const refOpen = refs.state.open
  const routeIds = plan.route.map(r => parseRouteItem(r).id).filter((_, i) => !routeFull[i] || !isWaypoint(routeFull[i]))
  const pohStatus = pohQ.isLoading ? `Downloading the ${aircraft.model} POH…` : pohQ.data?.match && !pohQ.data.match.exact ? `${pohQ.data.match.title} is the closest public POH to the ${aircraft.model}.` : null
  const pohError = pohQ.error ? (pohQ.error as Error).message : null
  const sheet = <NavlogSheet plan={plan} set={set} d={d} airports={airports} planning={planning} savePlanning={p => planningQ.save.mutate(p)} registry={registry.data} pilot={pilotQ.data} savePilot={p => pilotQ.save.mutate(p)} u={u} />

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
          <Button variant="ghost" onClick={() => { if (step !== REVIEW && step !== SHEET) go(SHEET); setTimeout(() => window.print(), 400) }}><Printer />Print</Button>
        </div>}
      />

      {/* Steps */}
      <nav aria-label="Planning steps" className="sticky top-16 z-10 -mx-4 mb-5 overflow-x-auto bg-bg/90 px-4 py-2 backdrop-blur scrollbar-none sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 print:hidden">
        <ol className="flex min-w-max gap-1">
          {LABELS.map((label, i) => (
            <li key={label}>
              <button onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}
                className={cn('press inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm', i === step ? 'bg-fg text-bg' : 'text-fg-2 hover:bg-pill')}>
                {i === step ? <span className="num grid size-5 place-items-center rounded-full bg-bg/15 text-xs">{i + 1}</span> : <StatusIcon status={stepStatus(i)} className="size-4" />}
                {label}
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-pill"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${((step + 1) / (SHEET + 1)) * 100}%` }} /></div>
      </nav>

      <div className={cn('grid gap-6', refOpen && 'xl:grid-cols-[minmax(0,1fr)_minmax(26rem,44%)]')}>
        <div className="min-w-0 space-y-5">
          {step === 0 && (
            <>
              <Section id="setup" n={1} question="What am I flying, and where?" status={setupStatus}
                answer={plan.tail && plan.route.length >= 2 ? <><span className="num">{plan.tail}</span> · {aircraft.make} {aircraft.model} · <span className="num">{routeText}</span></> : 'Enter the tail number and the route; every later step fills in from them'}>
                <SetupStep plan={plan} set={set} fleet={fleet} registry={registry.data} registryLoading={registry.isLoading} poh={pohQ.data?.match} pohLoading={pohQ.isLoading}
                  pohError={pohError} units={u} aircraft={aircraft} />
              </Section>
              <Card className="px-5 py-4 sm:px-6"><SubHead>Everything a complete flight plan and navlog needs</SubHead><InputsChecklist plan={plan} d={d} planning={planning} registry={registry.data} poh={pohQ.data?.match} pilot={pilotQ.data} onJump={go} /></Card>
            </>
          )}
          {q && (
            <Section id={q.key} n={step + 1} question={q.q} status={d.sections[q.key]} answer={answer[q.key]}>
              {body[q.key]}
              <CheckRows checks={d.checks.filter(c => c.section === q.key)} />
            </Section>
          )}
          {step === REVIEW && (
            <>
              <ReviewStep plan={plan} d={d} overall={overall} verdict={verdict} airports={airports} weather={wx.data ?? null} airspace={airspace.data} currency={currency}
                minimums={minimums} planning={planning} registry={registry.data} match={match} terrainAt={terrain.data?.fetchedAt} onJump={k => go(QUESTIONS.findIndex(x => x.key === k) + Q0)}
                route={routeFull} radar={radar.data} notams={notams} u={u} />
              <Card className="break-inside-avoid-page px-5 py-4 sm:px-6"><SubHead>Inputs</SubHead><InputsChecklist plan={plan} d={d} planning={planning} registry={registry.data} poh={pohQ.data?.match} pilot={pilotQ.data} onJump={go} /></Card>
              <Card className="px-3 py-4 sm:px-5"><SubHead right={<Button size="sm" variant="ghost" className="print:hidden" onClick={() => go(SHEET)}>Open the NavLog step</Button>}>NavLog</SubHead>{sheet}</Card>
            </>
          )}
          {step === SHEET && (
            <Section id="sheet" n={SHEET + 1} question="NavLog" status={overall} answer="The NICE AIR / Jeppesen VFR Navigation Log, front and reverse — print it or fill it in flight">
              {sheet}
            </Section>
          )}

          <div className="sticky bottom-20 z-10 flex items-center gap-3 rounded-xl bg-card/95 p-3 ring-1 ring-inset ring-border backdrop-blur lg:bottom-4 print:hidden">
            <Button variant="secondary" disabled={step === 0} onClick={() => go(step - 1)}><ArrowLeft />Back</Button>
            <div className="min-w-0 flex-1 text-center text-sm text-fg-3">
              <span className="num">{step + 1} of {SHEET + 1}</span>
              <span className="hidden sm:inline"> · {step < SHEET ? `Next: ${step + 1 < REVIEW ? QUESTIONS[step + 1 - Q0].q : step + 1 === REVIEW ? 'review everything' : 'the NavLog'}` : verdict.label}</span>
            </div>
            {step < SHEET
              ? <Button variant="primary" onClick={() => go(step + 1)}>{step + 1 === REVIEW ? 'Review' : step + 1 === SHEET ? 'NavLog' : 'Next'}<ArrowRight /></Button>
              : <Button variant="primary" onClick={save} loading={plans.create.isPending || plans.update.isPending}><Save />Save plan</Button>}
          </div>
        </div>

        {refOpen && (
          <aside className="fixed inset-0 z-40 bg-bg p-2 xl:sticky xl:inset-auto xl:top-32 xl:z-auto xl:h-[calc(100dvh-9rem)] xl:bg-transparent xl:p-0 print:hidden">
            <RefPanel className="h-full" model={aircraft.model ?? match?.profile.key.replace(/^C/, '') ?? null} route={routeIds} date={plan.departLocal.slice(0, 10)} pohDocId={pohQ.data?.doc?.id ?? null} pohStatus={pohStatus} />
          </aside>
        )}
      </div>
    </div>
  )
}

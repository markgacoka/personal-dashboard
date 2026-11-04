import { useEffect, useMemo, useRef, useState } from 'react'
import { FilePlus2, Printer, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { PageHeader } from '@/components/data/stat'
import { useAircraftList, useFlights, useRegistry } from '@/lib/queries'
import { computeCurrency } from '@/lib/flying'
import { homeAirport } from '@/lib/weather'
import { cn } from '@/lib/utils'
import { bboxOf, useAirports, useAirspace, useMinimums, usePlanning, usePlans, useTerrain, useWeather } from './api'
import { sampleRoute } from './calc'
import { DEFAULT_MINIMUMS, derive, type Check, type Plan, type SectionKey, type Status } from './model'
import { profileFor } from './poh'
import { AircraftSection } from './AircraftSection'
import { LoadingSection } from './LoadingSection'
import { NavlogSection } from './NavlogSection'
import { PerformanceSection } from './PerformanceSection'
import { PilotSection } from './PilotSection'
import { TripSection } from './TripSection'
import { WeatherSection } from './WeatherSection'
import { CheckRows, Section, StatusBadge, StatusIcon, fmtMin, fmtTime } from './ui'

const QUESTIONS: { key: SectionKey; q: string; short: string }[] = [
  { key: 'trip', q: 'Where am I going?', short: 'Trip' },
  { key: 'pilot', q: 'Am I okay to go?', short: 'Pilot' },
  { key: 'aircraft', q: 'What am I going with?', short: 'Aircraft' },
  { key: 'loading', q: 'Can it carry the load?', short: 'Weight & balance' },
  { key: 'performance', q: 'Can it get off and back on the ground?', short: 'Performance' },
  { key: 'navlog', q: 'How do I get there?', short: 'Navlog' },
  { key: 'weather', q: 'Is it safe there and back?', short: 'Weather & risks' },
]

const DRAFT_KEY = 'planner-draft-v1'
const pad = (n: number) => String(n).padStart(2, '0')
const nextHourLocal = () => { const d = new Date(Date.now() + 60 * 60_000); d.setMinutes(0, 0, 0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00` }
const blank = (tail: string | null): Plan => ({
  name: 'New flight', route: [homeAirport()], alternate: null, departLocal: nextHourLocal(), cruiseAlt: 4500, rpm: 2400, tail,
  loads: { front: 0, rear: 0, bag1: 0, bag2: 0 }, fuelGal: 40, stopMinutes: 15, imsafe: {}, pave: {}, equipment: {}, phases: {}, night: null,
})
function readDraft(): { plan: Plan; id: number | null } | null {
  try { const s = localStorage.getItem(DRAFT_KEY); return s ? JSON.parse(s) : null } catch { return null }
}

export default function PlannerPage() {
  const { data: flights = [] } = useFlights()
  const { data: fleetRaw = [] } = useAircraftList()
  const recentTail = useMemo(() => [...flights].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.aircraft?.tail_number ?? null, [flights])
  const fleet = useMemo(() => {
    const used = new Map<string, string>()
    for (const f of flights) if (f.aircraft?.tail_number && (!used.has(f.aircraft.tail_number) || String(f.date) > used.get(f.aircraft.tail_number)!)) used.set(f.aircraft.tail_number, String(f.date))
    return [...fleetRaw].sort((a, b) => (used.get(b.tail_number) ?? '').localeCompare(used.get(a.tail_number) ?? '') || a.tail_number.localeCompare(b.tail_number))
  }, [fleetRaw, flights])

  const [state, setState] = useState(() => readDraft() ?? { plan: blank(null), id: null as number | null })
  const plan = state.plan
  const set = (p: Partial<Plan>) => setState(s => ({ ...s, plan: { ...s.plan, ...p } }))
  useEffect(() => { if (!plan.tail && recentTail) set({ tail: recentTail }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [recentTail])
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)) } catch { /* private mode */ } }, [state])

  // ── Data ──
  const ids = useMemo(() => [...new Set([...plan.route, ...(plan.alternate ? [plan.alternate] : [])])], [plan.route, plan.alternate])
  const date = plan.departLocal.slice(0, 10)
  const apts = useAirports(ids, date)
  const airports = useMemo(() => apts.data?.airports ?? [], [apts.data])
  const routePts = useMemo(() => plan.route.map(id => airports.find(a => a.icao === id || a.id === id)).filter(Boolean) as { lat: number; lon: number }[], [plan.route, airports])
  const allPts = useMemo(() => [...routePts, ...airports], [routePts, airports])
  const wx = useWeather(ids.map(i => (i.length === 3 && !/\d/.test(i) ? `K${i}` : i)), useMemo(() => bboxOf(allPts), [allPts]))
  const samples = useMemo(() => sampleRoute(routePts, 2), [routePts])
  const terrain = useTerrain(samples)
  const airspace = useAirspace()
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
    currency, airspace: airspace.data ?? null,
  }), [plan, airports, wx.data, match, planning, minimums, terrain.data, currency, airspace.data])

  // Night is decided by the ETAs (civil twilight), unless set by hand.
  const nightAuto = d.wx.some(w => w.night)
  useEffect(() => { if (plan.night === null && nightAuto) set({ night: true }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [nightAuto])

  // Decision: any no-go rules it out; open items mean it isn't decided yet.
  const all = d.checks.map(c => c.status)
  const overall: Status = all.includes('nogo') ? 'nogo' : all.includes('todo') || plan.route.length < 2 ? 'todo' : all.includes('caution') ? 'caution' : 'ok'
  const verdict = overall === 'nogo' ? { label: 'No-go', sub: 'At least one item rules this flight out as planned.' } : overall === 'caution' ? { label: 'Go with caution', sub: 'Legal, but review every caution and decide.' } : overall === 'todo' ? { label: 'Incomplete', sub: `Finish the ${all.filter(s => s === 'todo').length} open items to reach a decision${all.includes('caution') ? ' — and review the cautions' : ''}.` } : { label: 'Go', sub: 'Every check passed. Still get a standard briefing (1800wxbrief) before you go.' }

  const jump = (k: SectionKey) => document.getElementById(k)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const save = async () => {
    try {
      if (state.id) await plans.update.mutateAsync({ id: state.id, plan })
      else { const r = await plans.create.mutateAsync(plan); setState(s => ({ ...s, id: r.id })) }
      toast.success('Plan saved')
    } catch (e) { toast.error((e as Error).message) }
  }
  const nameRef = useRef<HTMLInputElement>(null)
  const routeText = plan.route.join(' → ') || 'No route yet'

  return (
    <div className="planner">
      <PageHeader
        title={<input ref={nameRef} value={plan.name} onChange={e => set({ name: e.target.value })} aria-label="Plan name" className="w-full min-w-0 bg-transparent outline-none focus:underline" />}
        description={<span><span className="num">{routeText}</span>{d.departAt && <> · {d.departAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}{d.legs.length > 0 && <> · <span className="num">{Math.round(d.totals.distNm)} nm · {fmtMin(d.totals.eteMin)}</span></>}</span>}
        actions={<div className="flex flex-wrap items-center gap-2 print:hidden">
          <Select value={state.id ?? ''} onChange={e => { const p = plans.data?.find(x => x.id === Number(e.target.value)); if (p) setState({ plan: p.data, id: p.id }) }} className="w-48" aria-label="Saved plans">
            <option value="">{plans.data?.length ? 'Saved plans…' : 'No saved plans'}</option>
            {plans.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button variant="secondary" onClick={() => setState({ plan: blank(recentTail), id: null })}><FilePlus2 />New</Button>
          <Button variant="primary" onClick={save} loading={plans.create.isPending || plans.update.isPending}><Save />Save</Button>
          {state.id && <Button variant="danger-ghost" size="icon" aria-label="Delete plan" onClick={() => { plans.remove.mutate(state.id!); setState({ plan: blank(recentTail), id: null }) }}><Trash2 /></Button>}
          <Button variant="ghost" onClick={() => window.print()}><Printer />Print</Button>
        </div>}
      />

      {/* Step strip (below xl) */}
      <nav className="sticky top-14 z-10 -mx-4 mb-4 flex gap-1 overflow-x-auto bg-bg/90 px-4 py-2 backdrop-blur scrollbar-none xl:hidden print:hidden">
        {QUESTIONS.map((q, i) => <button key={q.key} onClick={() => jump(q.key)} className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-pill px-3 text-sm text-fg-2"><StatusIcon status={d.sections[q.key]} className="size-3.5" />{i + 1}. {q.short}</button>)}
        <button onClick={() => jump('decision' as SectionKey)} className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-pill px-3 text-sm text-fg"><StatusIcon status={overall} className="size-3.5" />Decision</button>
      </nav>

      <div className="grid gap-6 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="hidden xl:block print:hidden">
          <div className="sticky top-20 space-y-3">
            <div className={cn('rounded-xl p-4 ring-1 ring-inset', overall === 'nogo' ? 'bg-bad-soft ring-bad/30' : overall === 'caution' ? 'bg-warn-soft ring-warn/30' : overall === 'ok' ? 'bg-good-soft ring-good/30' : 'bg-card ring-border')}>
              <div className="flex items-center gap-2"><StatusIcon status={overall} className="size-5" /><span className="text-lg font-medium text-fg">{verdict.label}</span></div>
              <p className="mt-1 text-sm text-fg-2">{verdict.sub}</p>
              <button onClick={() => jump('decision' as SectionKey)} className="mt-2 text-sm text-accent hover:underline">See every check</button>
            </div>
            <ol className="rounded-xl bg-card p-2 ring-1 ring-inset ring-white/[0.04]">
              {QUESTIONS.map((q, i) => (
                <li key={q.key}><button onClick={() => jump(q.key)} className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-hover">
                  <StatusIcon status={d.sections[q.key]} className="mt-0.5" />
                  <span className="min-w-0"><span className="block text-sm text-fg">{i + 1}. {q.short}</span><span className="block text-xs text-fg-3">{q.q}</span></span>
                </button></li>
              ))}
            </ol>
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <Section id="trip" n={1} question={QUESTIONS[0].q} status={d.sections.trip}
            answer={plan.route.length >= 2 ? <><span className="num">{routeText}</span>{plan.alternate && <> · alternate <span className="num">{plan.alternate}</span></>} · {plan.cruiseAlt.toLocaleString()} ft</> : 'Choose the airports'}>
            <TripSection plan={plan} set={set} airports={airports} d={d} weather={wx.data ?? null} airspace={airspace.data} cycle={apts.data?.cycle ?? null} />
            <CheckRows checks={d.checks.filter(c => c.section === 'trip')} />
          </Section>

          <Section id="pilot" n={2} question={QUESTIONS[1].q} status={d.sections.pilot}
            answer={d.sections.pilot === 'nogo' ? 'Not today' : d.sections.pilot === 'todo' ? 'Answer IMSAFE and PAVE' : 'Fit to fly, risks reviewed'}>
            <PilotSection plan={plan} set={set} currency={currency} minimums={minimums} savedAt={minQ.data?.updatedAt} saveMinimums={m => minQ.save.mutate(m, { onSuccess: () => toast.success('Minimums saved') })} saving={minQ.save.isPending} />
            <CheckRows checks={d.checks.filter(c => c.section === 'pilot')} />
          </Section>

          <Section id="aircraft" n={3} question={QUESTIONS[2].q} status={d.sections.aircraft}
            answer={plan.tail ? <><span className="num">{plan.tail}</span> · {match?.profile.model}{match && !match.exact && ' (closest POH)'}</> : 'Choose the aircraft'}>
            <AircraftSection plan={plan} set={set} fleet={fleet} registry={registry.data} match={match} planning={planning} savePlanning={p => planningQ.save.mutate(p, { onSuccess: () => toast.success(`${plan.tail} saved`) })} saving={planningQ.save.isPending} night={!!plan.night} />
            <CheckRows checks={d.checks.filter(c => c.section === 'aircraft')} />
          </Section>

          <Section id="loading" n={4} question={QUESTIONS[3].q} status={d.sections.loading}
            answer={d.profile ? <span className="num">Takeoff {Math.round(d.wb.takeoff.weight)} lb @ {d.wb.takeoff.cg.toFixed(1)} in · landing {Math.round(d.wb.landing.weight)} lb</span> : undefined}>
            <LoadingSection plan={plan} set={set} d={d} profile={d.profile} planning={planning} savePlanning={p => planningQ.save.mutate(p)} />
            <CheckRows checks={d.checks.filter(c => c.section === 'loading')} />
          </Section>

          <Section id="performance" n={5} question={QUESTIONS[4].q} status={d.sections.performance}
            answer={d.perf.length ? `Tightest margin: ${Math.min(...d.perf.filter(p => p.margin != null).map(p => p.margin!)).toLocaleString()} ft beyond the 50-ft distance` : undefined}>
            <PerformanceSection d={d} profile={d.profile} />
            <CheckRows checks={d.checks.filter(c => c.section === 'performance')} />
          </Section>

          <Section id="navlog" n={6} question={QUESTIONS[5].q} status={d.sections.navlog}
            answer={d.legs.length ? <span className="num">{d.legs.length} leg{d.legs.length > 1 ? 's' : ''} · {Math.round(d.totals.distNm)} nm · {fmtMin(d.totals.eteMin)} · {d.totals.tripFuel.toFixed(1)} gal · arrive {fmtTime(d.legs.at(-1)!.arriveAt)}</span> : undefined}>
            <NavlogSection plan={plan} d={d} airports={airports} terrainAt={terrain.data?.fetchedAt} planning={planning} registry={registry.data} />
            <CheckRows checks={d.checks.filter(c => c.section === 'navlog')} />
          </Section>

          <Section id="weather" n={7} question={QUESTIONS[6].q} status={d.sections.weather}
            answer={d.wx.length ? d.wx.map(w => `${w.airport.icao || w.airport.id} ${w.category ?? '—'}`).join(' · ') : undefined}>
            <WeatherSection d={d} weather={wx.data ?? null} loading={wx.isLoading} refetch={() => wx.refetch()} fetching={wx.isFetching} />
            <CheckRows checks={d.checks.filter(c => c.section === 'weather')} />
          </Section>

          <Decision checks={d.checks} overall={overall} verdict={verdict} onJump={c => jump(c.section)} />
        </div>
      </div>
    </div>
  )
}

function Decision({ checks, overall, verdict, onJump }: { checks: Check[]; overall: Status; verdict: { label: string; sub: string }; onJump: (c: Check) => void }) {
  const order: Status[] = ['nogo', 'caution', 'todo', 'ok']
  return (
    <section id="decision" className="scroll-mt-20">
      <div className={cn('rounded-xl p-5 ring-1 ring-inset sm:p-6', overall === 'nogo' ? 'bg-bad-soft ring-bad/30' : overall === 'caution' ? 'bg-warn-soft ring-warn/30' : overall === 'ok' ? 'bg-good-soft ring-good/30' : 'bg-card ring-border')}>
        <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-medium text-fg">Go or no-go: {verdict.label}</h2><StatusBadge status={overall} size="md" /></div>
        <p className="mt-1 text-sm text-fg-2">{verdict.sub} This page doesn't replace a standard briefing from Flight Service, your CFI's judgment or the POH in the airplane.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {order.map(s => {
            const list = checks.filter(c => c.status === s)
            if (!list.length) return null
            return (
              <div key={s}>
                <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-fg"><StatusIcon status={s} />{{ nogo: 'No-go', caution: 'Caution', todo: 'Still to do', ok: 'Passed' }[s]} ({list.length})</div>
                <div className="rounded-lg bg-card"><CheckRows checks={list} onJump={onJump} /></div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

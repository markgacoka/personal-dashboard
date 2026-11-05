import { useEffect, useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { BookOpen, FilePlus2, Printer, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { flightNotes, type NotamSet } from './brief'
import { sampleRoute } from './calc'
import { FlightInputs } from './FlightInputs'
import { DEFAULT_MINIMUMS, derive, isWaypoint, makeResolver, parseRouteItem, type Airport, type Plan, type Status } from './model'
import { NavlogFront, NavlogReverse } from './NavlogSheet'
import { PerformanceSection } from './PerformanceSection'
import { PlannerMap, type MapNotams } from './PlannerMap'
import { PohSummary, WbTable } from './PohSummary'
import { profileFor } from './poh'
import { RefPanel, RefProvider, useRefs } from './RefPanel'
import { unitsForTail } from './units'
import { WeatherSection } from './WeatherSection'
import { CheckRows, StatusBadge, StatusIcon, SubHead, fmtMin, fmtTime } from './ui'

const DRAFT_KEY = 'planner-draft-v3'
const pad = (n: number) => String(n).padStart(2, '0')
const nextHourLocal = () => { const d = new Date(Date.now() + 60 * 60_000); d.setMinutes(0, 0, 0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00` }
const blank = (tail: string | null): Plan => ({
  name: 'New flight', route: [homeAirport()], alternate: null, departLocal: nextHourLocal(), rpm: 2400, tail,
  seats: { pilot: 0, front: 0, rearL: 0, rearR: 0 }, loads: { front: 0, rear: 0, bag1: 0, bag2: 0 }, fuelGal: null, stopMinutes: 30, night: null, actuals: {},
})
interface Draft { plan: Plan; id: number | null }
function readDraft(): Draft | null {
  try {
    const s = localStorage.getItem(DRAFT_KEY) ?? localStorage.getItem('planner-draft-v2')
    if (!s) return null
    const d = JSON.parse(s) as Draft
    return { plan: d.plan, id: d.id ?? null }
  } catch { return null }
}

export default function PlannerPage() {
  return <RefProvider><Planner /></RefProvider>
}

// One page: the five inputs at the top, then everything a hand-made plan has —
// a NavLog sheet per flight, POH performance, weight and balance, the weather
// brief with the chart, takeoff/landing distances and the flight plan — filled
// from the FAA, aviationweather.gov and the POH.
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

  const [state, setState] = useState<Draft>(() => readDraft() ?? { plan: blank(null), id: null })
  const plan = state.plan
  const set = (p: Partial<Plan>) => setState(s => ({ ...s, plan: { ...s.plan, ...p } }))
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
  const routePts = useMemo(() => plan.route.map(resolve).filter(Boolean) as Airport[], [plan.route, resolve])
  const allPts = useMemo(() => [...routePts, ...airports], [routePts, airports])
  const wx = useWeather(airports.map(a => a.icao || a.id), useMemo(() => bboxOf(allPts), [allPts]))
  const radar = useRadar()
  const notamIds = useMemo(() => airports.filter(a => a.icao).map(a => ({ icao: a.icao!, lat: a.lat, lon: a.lon })), [airports])
  const notamQs = useQueries({ queries: notamIds.map(n => ({ queryKey: ['wx', 'notam', n.icao], staleTime: 30 * 60_000, queryFn: () => get<NotamResponse>(`/api/external/notam/${n.icao}`).catch(() => ({ count: 0, notams: [], unavailable: true })) })) })
  const notams: MapNotams[] = notamIds.map((n, i) => { const r = notamQs[i]?.data; return { ...n, count: r?.notams.length ?? 0, items: (r?.notams || []).map(x => notamBody(x.text)), unavailable: r?.unavailable } })
  const notamSets: NotamSet[] = notamIds.flatMap((n, i) => { const r = notamQs[i]?.data; return r ? [{ icao: n.icao, items: r.notams.map(x => x.text || ''), unavailable: r.unavailable }] : [] })
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

  // Any no-go rules it out; open items mean it isn't decided yet.
  const all = d.checks.map(c => c.status)
  const overall: Status = all.includes('nogo') ? 'nogo' : all.includes('todo') || plan.route.length < 2 ? 'todo' : all.includes('caution') ? 'caution' : 'ok'
  const verdict = overall === 'nogo' ? 'No-go as planned' : overall === 'caution' ? 'Go with caution' : overall === 'todo' ? 'Incomplete' : 'Go'

  const save = async () => {
    try {
      if (state.id) await plans.update.mutateAsync({ id: state.id, plan })
      else { const r = await plans.create.mutateAsync(plan); setState(s => ({ ...s, id: r.id })) }
      toast.success('Plan saved')
    } catch (e) { toast.error((e as Error).message) }
  }
  const routeText = plan.route.map(r => parseRouteItem(r).id).join(' → ') || 'No route yet'
  const refOpen = refs.state.open
  const routeIds = plan.route.map(r => parseRouteItem(r).id).filter((_, i) => !routePts[i] || !isWaypoint(routePts[i]))
  const pohStatus = pohQ.isLoading ? `Downloading the ${aircraft.model} POH…` : pohQ.data?.match && !pohQ.data.match.exact ? `${pohQ.data.match.title} is the closest public POH to the ${aircraft.model}.` : null
  const alt = plan.alternate ? airports.find(a => a.icao === plan.alternate || a.id === plan.alternate) ?? null : null
  const acName = [aircraft.make && aircraft.make.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), aircraft.model].filter(Boolean).join(' ') || d.profile?.model || 'Aircraft'
  const savePlanning = (p: typeof planning) => planningQ.save.mutate(p, { onSuccess: () => toast.success(`${plan.tail} saved`) })

  return (
    <div className="planner">
      <PageHeader
        title={<input value={plan.name} onChange={e => set({ name: e.target.value })} aria-label="Plan name" className="w-full min-w-0 bg-transparent outline-none focus:underline" />}
        description={<span><span className="num">{routeText}</span>{d.departAt && <> · {d.departAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}{d.legs.length > 0 && <> · <span className="num">{Math.round(d.totals.distNm)} nm · {fmtMin(d.totals.eteMin)} · {d.totals.tripFuel.toFixed(1)} gal</span></>}</span>}
        actions={<div className="flex flex-wrap items-center gap-2 print:hidden">
          <Select value={state.id ?? ''} onChange={e => { const p = plans.data?.find(x => x.id === Number(e.target.value)); if (p) setState({ plan: p.data, id: p.id }) }} className="w-44" aria-label="Saved plans">
            <option value="">{plans.data?.length ? 'Saved plans…' : 'No saved plans'}</option>
            {plans.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button variant="secondary" onClick={() => setState({ plan: blank(recentTail), id: null })}><FilePlus2 />New</Button>
          <Button variant="primary" onClick={save} loading={plans.create.isPending || plans.update.isPending}><Save />Save</Button>
          {state.id && <Button variant="danger-ghost" size="icon" aria-label="Delete plan" onClick={() => { plans.remove.mutate(state.id!); setState({ plan: blank(recentTail), id: null }) }}><Trash2 /></Button>}
          <Button variant={refOpen ? 'secondary' : 'ghost'} onClick={() => (refOpen ? refs.close() : refs.show(refs.state.tab))} aria-pressed={refOpen}><BookOpen />POH &amp; briefing</Button>
          <Button variant="ghost" onClick={() => window.print()}><Printer />Print</Button>
        </div>}
      />

      <div className={cn('grid gap-6', refOpen && 'xl:grid-cols-[minmax(0,1fr)_minmax(26rem,44%)]')}>
        <div className="min-w-0 space-y-5">
          <Card className="px-5 py-5 sm:px-6 print:hidden">
            <FlightInputs plan={plan} set={set} d={d} fleet={fleet} registry={registry.data} registryLoading={registry.isLoading} poh={pohQ.data?.match} pohLoading={pohQ.isLoading}
              pohError={pohQ.error ? (pohQ.error as Error).message : null} u={u} aircraft={aircraft} profile={d.profile} planning={planning} savePlanning={savePlanning}
              minimums={minimums} minimumsSavedAt={minQ.data?.updatedAt} saveMinimums={m => minQ.save.mutate(m, { onSuccess: () => toast.success('Minimums saved') })} savingMinimums={minQ.save.isPending} />
          </Card>

          <Verdict status={overall} label={verdict} checks={d.checks} />

          {d.flights.map(f => (
            <Card key={f.n} className="break-inside-avoid-page px-3 py-4 sm:px-5">
              <SubHead right={<span className="num text-xs text-fg-3">{f.distNm.toFixed(1)} nm · {Math.round(f.eteMin)} min · {f.fuelGal.toFixed(2)} gal · arrive {fmtTime(f.arriveAt)}</span>}>
                NavLog {d.flights.length > 1 ? `${f.n + 1} of ${d.flights.length} · ` : ''}<span className="num">{f.from.icao || f.from.id} → {f.to.icao || f.to.id}</span>
              </SubHead>
              <NavlogFront plan={plan} set={set} d={d} flight={f} notes={flightNotes(d, f, acName, notamSets)} u={u} />
            </Card>
          ))}
          {!d.flights.length && plan.route.length >= 2 && <Card className="px-5 py-4 text-sm text-fg-3 sm:px-6">The NavLog fills in once the route resolves and the aircraft's POH is known.</Card>}

          {d.profile && (
            <Card className="break-inside-avoid-page space-y-6 px-5 py-5 sm:px-6">
              <PohSummary d={d} profile={d.profile} plan={plan} planning={planning} u={u} />
              <div><SubHead right={<span className="text-xs text-fg-3">Limits from POH Sec. 2 and Fig. 6-8</span>}>Weight and balance</SubHead><WbTable d={d} plan={plan} u={u} /></div>
            </Card>
          )}

          {d.wx.length > 0 && (
            <Card className="space-y-5 px-5 py-5 sm:px-6">
              <SubHead>Weather brief</SubHead>
              {routePts.length > 1 && <PlannerMap className="h-[28rem] print:hidden" route={routePts} alternate={alt} weather={wx.data ?? null} d={d} airspace={airspace.data} radar={radar.data} notams={notams} />}
              <WeatherSection d={d} weather={wx.data ?? null} loading={wx.isLoading} refetch={() => wx.refetch()} fetching={wx.isFetching} />
            </Card>
          )}

          {d.perf.length > 0 && <Card className="break-inside-avoid-page space-y-5 px-5 py-5 sm:px-6"><SubHead>Takeoff and landing</SubHead><PerformanceSection d={d} profile={d.profile} /></Card>}

          {d.flights.length > 0 && (
            <Card className="break-inside-avoid-page px-3 py-4 sm:px-5">
              <SubHead>NavLog reverse · weather log and flight plan</SubHead>
              <NavlogReverse plan={plan} set={set} d={d} airports={airports} planning={planning} savePlanning={p => planningQ.save.mutate(p)} registry={registry.data} pilot={pilotQ.data} savePilot={p => pilotQ.save.mutate(p)} />
            </Card>
          )}
          <style>{'@media print { @page { size: letter landscape; margin: 0.25in } .navlog-front > div { zoom: 0.74 } }'}</style>
        </div>

        {refOpen && (
          <aside className="fixed inset-0 z-40 bg-bg p-2 xl:sticky xl:inset-auto xl:top-20 xl:z-auto xl:h-[calc(100dvh-6rem)] xl:bg-transparent xl:p-0 print:hidden">
            <RefPanel className="h-full" model={aircraft.model ?? match?.profile.key.replace(/^C/, '') ?? null} route={routeIds} date={plan.departLocal.slice(0, 10)} pohDocId={pohQ.data?.doc?.id ?? null} pohStatus={pohStatus} />
          </aside>
        )}
      </div>
    </div>
  )
}

function Verdict({ status, label, checks }: { status: Status; label: string; checks: ReturnType<typeof derive>['checks'] }) {
  const tone = status === 'nogo' ? 'bg-bad-soft ring-bad/30' : status === 'caution' ? 'bg-warn-soft ring-warn/30' : status === 'ok' ? 'bg-good-soft ring-good/30' : 'bg-card ring-border'
  const open = checks.filter(c => c.status !== 'ok')
  return (
    <details className={cn('group rounded-xl ring-1 ring-inset print:hidden', tone)} open={status === 'nogo'}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
        <StatusIcon status={status} className="size-5" />
        <span className="text-lg font-medium text-fg">{label}</span>
        <StatusBadge status={status} />
        <span className="text-sm text-fg-3">{(['nogo', 'caution', 'todo'] as Status[]).map(s => { const n = checks.filter(c => c.status === s).length; return n ? `${n} ${{ nogo: 'no-go', caution: 'caution', todo: 'to do', ok: '' }[s]}` : null }).filter(Boolean).join(' · ') || 'every check passed'} · {checks.filter(c => c.status === 'ok').length} passed</span>
        {open.length > 0 && <span className="ml-auto text-sm text-accent group-open:hidden">Show</span>}
      </summary>
      {open.length > 0 && <div className="px-5 pb-4 sm:px-6"><div className="rounded-lg bg-card"><CheckRows checks={[...open].sort((a, b) => ['nogo', 'caution', 'todo'].indexOf(a.status) - ['nogo', 'caution', 'todo'].indexOf(b.status))} /></div>
        <p className="mt-2 text-sm text-fg-3">Not a substitute for a standard briefing (1800wxbrief.com), your CFI's judgment or the POH in the airplane.</p></div>}
    </details>
  )
}

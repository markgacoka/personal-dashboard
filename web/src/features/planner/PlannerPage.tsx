import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { BookOpen, ChevronLeft, ChevronRight, FilePlus2, Loader2, Printer, Save, Trash2 } from 'lucide-react'
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
import { bboxOf, useAirports, useAirspace, useCorridor, useLandmarks, useMinimums, useNearby, usePilotInfo, usePlanning, usePlans, usePohFind, type SavedPlan, useRadar, useResolve, useTerrain, useWeather } from './api'
import { AircraftStep } from './AircraftStep'
import { AirportsStep } from './AirportsStep'
import { PilotStep } from './PilotStep'
import { RouteStep } from './RouteStep'
import { bestInsert, insertAt, removeAt, replaceAt } from './route'
import type { EditPoint, RouteEdit } from './PlannerMap'
import { flightNotes, type NotamSet } from './brief'
import { sampleRoute } from './calc'
import { FlightInputs } from './FlightInputs'
import { DEFAULT_MINIMUMS, derive, isWaypoint, makeResolver, parseRouteItem, worst, type Airport, type Derived, type Plan, type SectionKey, type Status } from './model'
import { NavlogFront, NavlogReverse } from './NavlogSheet'
import { PerformanceSection } from './PerformanceSection'
import { PlannerMap, type MapNotams } from './PlannerMap'
import { WbTable } from './PohSummary'
import { profileFor } from './poh'
import { RefPanel, RefProvider, useRefs } from './RefPanel'
import { unitsForTail } from './units'
import { WeatherSection } from './WeatherSection'
import { CheckRows, KV, StatusBadge, StatusIcon, SubHead, fmtMin, fmtTime } from './ui'

const DRAFT_KEY = 'planner-draft-v3'

// The wizard: you type the flight on step 1; every later step shows what was
// looked up or computed for it, with the source, and the checklists to tick.
const STEPS: { key: string; label: string; blurb: string; sections: SectionKey[] }[] = [
  { key: 'flight', label: 'Flight', blurb: 'Tail number, departure, route and arrival, engine start, cruise power, occupants and fuel. Everything after this is filled in for you.', sections: ['trip'] },
  { key: 'aircraft', label: 'Aircraft', blurb: 'FAA registry, the POH for the model and its numbers, the W&B record, maintenance and equipment.', sections: ['aircraft'] },
  { key: 'route', label: 'Route', blurb: 'Build the route on the chart: suggested airports, VFR waypoints, VORs, towns, highways, rivers, power lines and towers; drag the line to add or move points. Then cruise altitude, TOC, checkpoints and TOD with course, distance and terrain.', sections: ['navlog'] },
  { key: 'airports', label: 'Airports', blurb: 'Runways, pattern, favored or in-use runway, frequencies and NOTAMs (AirNav, Chart Supplement), and the alternate.', sections: [] },
  { key: 'weather', label: 'Weather', blurb: 'METAR/TAF at each ETA, winds aloft, AIRMETs, SIGMETs, CWAs, PIREPs, TFRs and NOTAMs (aviationweather.gov, FAA).', sections: ['weather'] },
  { key: 'loading', label: 'Weight & performance', blurb: 'The W&B sheet from ramp to each landing, and takeoff and landing distances from the POH.', sections: ['loading', 'performance'] },
  { key: 'pilot', label: 'Pilot', blurb: 'IMSAFE, your personal minimums against this flight, and currency from the logbook.', sections: ['pilot'] },
  { key: 'review', label: 'Review', blurb: 'Every check, go or no-go.', sections: [] },
  { key: 'navlog', label: 'NavLog', blurb: 'The sheet per flight, filled in; E6B cells take your own numbers. Print it for the kneeboard.', sections: [] },
]
const pad = (n: number) => String(n).padStart(2, '0')
const nextHourLocal = () => { const d = new Date(Date.now() + 60 * 60_000); d.setMinutes(0, 0, 0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00` }
const blank = (tail: string | null): Plan => ({
  name: 'New flight', route: [homeAirport()], alternate: null, departLocal: nextHourLocal(), rpm: 2400, tail,
  seats: { pilot: 0, front: 0, rearL: 0, rearR: 0 }, loads: { front: 0, rear: 0, bag1: 0, bag2: 0 }, fuelGal: null, stopMinutes: 30, night: null, actuals: {},
})
interface Draft { plan: Plan; id: number | null; step?: number }
function readDraft(): Draft | null {
  try {
    const s = localStorage.getItem(DRAFT_KEY) ?? localStorage.getItem('planner-draft-v2')
    if (!s) return null
    const d = JSON.parse(s) as Draft
    return { plan: d.plan, id: d.id ?? null, step: d.step ?? 0 }
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

  const [state, setState] = useState<Draft>(() => readDraft() ?? { plan: blank(null), id: null, step: 0 })
  const plan = state.plan
  const set = (p: Partial<Plan>) => setState(s => ({ ...s, plan: { ...s.plan, ...p } }))
  useEffect(() => { if (!plan.tail && recentTail) set({ tail: recentTail }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [recentTail])
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)) } catch { /* private mode */ } }, [state])

  // ── Data ──
  const tokens = useMemo(() => plan.route.map(r => parseRouteItem(r).id), [plan.route])
  // Alternate: yours, or the nearest suitable airport to the destination that
  // isn't on the route and isn't reporting IFR (worked out below, once known).
  const [autoAlt, setAutoAlt] = useState<string | null>(null)
  const effAlt = plan.alternate ?? autoAlt
  const resolved = useResolve(tokens)
  const points = useMemo(() => resolved.data?.points ?? [], [resolved.data])
  const ids = useMemo(() => {
    const fromRoute = tokens.map(t => { const p = points.find(x => x.token.replace(/\*$/, '') === t); return p ? (p.kind === 'airport' ? p.id : null) : /^[A-Z0-9]{3,4}$/.test(t) ? t : null }).filter(Boolean) as string[]
    return [...new Set([...fromRoute, ...(effAlt ? [effAlt] : [])])]
  }, [tokens, points, effAlt])
  const apts = useAirports(ids, plan.departLocal.slice(0, 10))
  const airports = useMemo(() => apts.data?.airports ?? [], [apts.data])
  const resolve = useMemo(() => makeResolver(airports, points), [airports, points])
  // Resolved route points (named from plan.labels) and, for each, its index in plan.route.
  const [routePts, routeIdx] = useMemo(() => {
    const pts: Airport[] = [], idx: number[] = []
    plan.route.forEach((r, i) => { const a = resolve(r); if (!a) return; const l = plan.labels?.[parseRouteItem(r).id]; pts.push(l ? { ...a, label: l.name, name: l.name } : a); idx.push(i) })
    return [pts, idx] as const
  }, [plan.route, plan.labels, resolve])
  const allPts = useMemo(() => [...routePts, ...airports], [routePts, airports])
  const wx = useWeather(airports.map(a => a.icao || a.id), useMemo(() => bboxOf(allPts), [allPts]))
  const radar = useRadar()
  const notamIds = useMemo(() => airports.filter(a => a.icao).map(a => ({ icao: a.icao!, lat: a.lat, lon: a.lon })), [airports])
  const notamQs = useQueries({ queries: notamIds.map(n => ({ queryKey: ['wx', 'notam', n.icao], staleTime: 30 * 60_000, queryFn: () => get<NotamResponse>(`/api/external/notam/${n.icao}`).catch(() => ({ count: 0, notams: [], unavailable: true })) })) })
  const notams: MapNotams[] = notamIds.map((n, i) => { const r = notamQs[i]?.data; return { ...n, count: r?.notams.length ?? 0, items: (r?.notams || []).map(x => notamBody(x.text)), unavailable: r?.unavailable } })
  const notamSets: NotamSet[] = notamIds.flatMap((n, i) => { const r = notamQs[i]?.data; return r ? [{ icao: n.icao, items: r.notams.map(x => x.text || ''), unavailable: r.unavailable }] : [] })
  const samples = useMemo(() => sampleRoute(routePts, 2), [routePts])
  const terrain = useTerrain(samples)
  const airspace = useAirspace(useMemo(() => (routePts.length > 1 ? bboxOf(routePts, 1) : null), [routePts]))
  const corridor = useCorridor(useMemo(() => (routePts.length > 1 ? bboxOf(routePts, 0.25) : null), [routePts]))
  const landmarks = useLandmarks(useMemo(() => (routePts.length > 1 ? bboxOf(routePts, 0.25) : null), [routePts]))
  // Route edits from the Route step (suggestions and the map): indices are routePts positions.
  const putLabel = (p: EditPoint) => (p.label ? { ...plan.labels, [p.token]: { name: p.label, kind: p.kind ?? '' } } : plan.labels)
  const edit: RouteEdit = {
    insert: (at, p) => set({ route: insertAt(plan.route, routeIdx[at] ?? plan.route.length - 1, p.token), labels: putLabel(p) }),
    move: (i, p) => set({ route: replaceAt(plan.route, routeIdx[i], p.token), labels: putLabel(p) }),
    remove: i => set({ route: removeAt(plan.route, routeIdx[i]) }),
    add: p => edit.insert(bestInsert(routePts, p), p),
  }
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

  const destApt = routePts.length >= 2 && !isWaypoint(routePts[routePts.length - 1]) ? routePts[routePts.length - 1] : null
  const nearby = useNearby(destApt ? { lat: destApt.lat, lon: destApt.lon } : null)
  useEffect(() => {
    const onRoute = new Set(routePts.map(a => a.id))
    const cats = new Map((wx.data?.metars.data || []).map(m => [m.icaoId, m.fltCat]))
    const list = (nearby.data || []).filter(a => !onRoute.has(a.id))
    const pick = list.find(a => !/IFR/.test(cats.get(a.icao || '') || '')) ?? list[0]
    setAutoAlt(pick ? pick.icao || pick.id : null)
  }, [nearby.data, routePts, wx.data])
  // Everything still loading (or failed), shown under the steps.
  const pending: [string, boolean][] = [
    ['route points', resolved.isFetching], ['airports', apts.isFetching], ['aircraft registry', registry.isLoading], ['POH', pohQ.isLoading],
    ['weather', wx.isFetching], ['terrain', terrain.isLoading], ['airspace', airspace.isFetching], ['checkpoints', corridor.isFetching], ['landmarks', landmarks.isFetching],
    ['NOTAMs', notamQs.some(q => q.isLoading)], ['alternates', nearby.isLoading], ['radar', radar.isLoading],
  ]
  const saving = planningQ.save.isPending || minQ.save.isPending || plans.create.isPending || plans.update.isPending
  const failed: [string, () => void][] = ([
    ['route points', resolved.isError, resolved.refetch], ['airports', apts.isError, apts.refetch], ['weather', wx.isError, wx.refetch], ['terrain', terrain.isError, terrain.refetch],
    ['airspace', airspace.isError, airspace.refetch], ['checkpoints', corridor.isError, corridor.refetch], ['landmarks', landmarks.isError, landmarks.refetch], ['POH', pohQ.isError, pohQ.refetch],
  ] as [string, boolean, () => void][]).filter(([, e]) => e).map(([n, , r]) => [n, r])
  const planEff = useMemo(() => ({ ...plan, alternate: effAlt }), [plan, effAlt])

  const d = useMemo(() => derive(planEff, {
    airports, weather: wx.data ?? null, match, planning, minimums, terrain: terrain.data?.elevations ?? null,
    currency, airspace: airspace.data ?? null, checkpoints: corridor.data ?? [], points,
  }), [planEff, airports, wx.data, match, planning, minimums, terrain.data, currency, airspace.data, corridor.data, points])

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
      toast.success('Saved to your plans', { description: 'Stored in your planner only; nothing is filed with the FAA.' })
    } catch (e) { toast.error((e as Error).message) }
  }
  const routeText = plan.route.map(r => { const id = parseRouteItem(r).id; return plan.labels?.[id]?.name ?? id }).join(' → ') || 'No route yet'
  const refOpen = refs.state.open
  const routeIds = plan.route.map(r => parseRouteItem(r).id).filter((_, i) => !routePts[i] || !isWaypoint(routePts[i]))
  const pohStatus = pohQ.isLoading ? `Downloading the ${aircraft.model} POH…` : pohQ.data?.match && !pohQ.data.match.exact ? `${pohQ.data.match.title} is the closest public POH to the ${aircraft.model}.` : null
  const acName = [aircraft.make && aircraft.make.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), aircraft.model].filter(Boolean).join(' ') || d.profile?.model || 'Aircraft'
  const savePlanning = (p: typeof planning) => planningQ.save.mutate(p, { onSuccess: () => toast.success(`${plan.tail} saved`) })

  const stepAt = Math.min(state.step ?? 0, STEPS.length - 1)
  const go = (i: number) => { setState(s => ({ ...s, step: i })); window.scrollTo({ top: 0 }) }
  const stepStatus = (i: number): Status | null => {
    const st = STEPS[i]
    if (st.key === 'review') return overall
    if (!st.sections.length) return null
    return worst(st.sections.map(k => d.sections[k]))
  }
  const cur = STEPS[stepAt].key
  // Keep the current step's chip in view when the chips scroll sideways (phones).
  const stepsRef = useRef<HTMLElement>(null)
  useEffect(() => { const nav = stepsRef.current, el = nav?.querySelector<HTMLElement>('[aria-current]'); if (nav && el) nav.scrollTo({ left: nav.scrollLeft + el.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' }) }, [stepAt])
  const altAirport = effAlt ? airports.find(a => a.icao === effAlt || a.id === effAlt) ?? null : null

  return (
    <div className="planner">
      <PageHeader className="[&>div:first-child]:basis-full xl:[&>div:first-child]:basis-0 max-sm:[&>div:nth-child(2)]:w-full"
        title={<input value={plan.name} onChange={e => set({ name: e.target.value })} aria-label="Plan name" className="w-full min-w-0 bg-transparent outline-none focus:underline" />}
        description={<span><span className="num">{routeText}</span>{d.departAt && <> · {d.departAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}{d.legs.length > 0 && <> · <span className="num">{Math.round(d.totals.distNm)} nm · {fmtMin(d.totals.eteMin)} · {d.totals.tripFuel.toFixed(1)} gal</span></>}</span>}
        actions={<div className="flex w-full flex-wrap items-center gap-2 sm:w-auto print:hidden">
          <Select value={state.id ?? ''} onChange={e => { const p = plans.data?.find(x => x.id === Number(e.target.value)); if (p) setState({ plan: p.data, id: p.id, step: 0 }) }} className="w-full sm:w-44 xl:hidden" aria-label="Saved plans">
            <option value="">{plans.data?.length ? 'Saved plans…' : 'No saved plans'}</option>
            {plans.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button variant="secondary" onClick={() => setState({ plan: blank(recentTail), id: null, step: 0 })}><FilePlus2 />New</Button>
          <Button variant="primary" onClick={save} loading={plans.create.isPending || plans.update.isPending}><Save />Save</Button>
          {state.id && <Button variant="danger-ghost" size="icon" aria-label="Delete plan" onClick={() => { plans.remove.mutate(state.id!); setState({ plan: blank(recentTail), id: null, step: 0 }) }}><Trash2 /></Button>}
          <Button variant={refOpen ? 'secondary' : 'ghost'} onClick={() => (refOpen ? refs.close() : refs.show(refs.state.tab))} aria-pressed={refOpen}><BookOpen /><span className="sm:hidden">POH</span><span className="max-sm:hidden">POH &amp; briefing</span></Button>
          <Button variant="ghost" onClick={() => { go(STEPS.length - 1); setTimeout(() => window.print(), 300) }} aria-label="Print NavLog"><Printer /><span className="max-sm:hidden">Print NavLog</span></Button>
        </div>}
      />

      <nav ref={stepsRef} aria-label="Planner steps" className="scrollbar-none -mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-1 sm:-mx-1 sm:px-1 print:hidden">
        {STEPS.map((st, i) => {
          const s = stepStatus(i)
          return (
            <button key={st.key} onClick={() => go(i)} aria-current={i === stepAt ? 'step' : undefined}
              className={cn('press flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm ring-1 ring-inset', i === stepAt ? 'bg-accent-soft font-medium text-accent ring-accent/40' : 'text-fg-2 ring-border hover:bg-hover')}>
              <span className="num text-xs text-fg-3">{i + 1}</span>{st.label}{s && s !== 'ok' && <StatusIcon status={s} className="size-4" />}
            </button>
          )
        })}
      </nav>

      <LoadingStrip loading={pending.filter(([, v]) => v).map(([n]) => n)} saving={saving} failed={failed} />

      <div className={cn('grid gap-6', refOpen ? 'xl:grid-cols-[minmax(0,1fr)_minmax(26rem,44%)] 2xl:grid-cols-[15rem_minmax(0,1fr)_minmax(26rem,40%)]' : 'xl:grid-cols-[15rem_minmax(0,1fr)]')}>
        <aside className={cn('hidden xl:sticky xl:top-20 xl:block xl:max-h-[calc(100dvh-6rem)] print:hidden', refOpen && 'xl:hidden 2xl:block')}>
          <PlanList plans={plans.data} loading={plans.isLoading} currentId={state.id} draft={state.id ? null : plan}
            onOpen={p => setState({ plan: p.data, id: p.id, step: 0 })} onNew={() => setState({ plan: blank(recentTail), id: null, step: 0 })} />
        </aside>
        <div className="min-w-0 space-y-5">
          <Card className={cn('px-4 py-4 sm:px-6 sm:py-5', cur === 'navlog' && 'px-3 sm:px-5')}>
            <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 print:hidden">
              <h2 className="text-lg font-medium text-fg">{STEPS[stepAt].label}</h2>
              <p className="text-sm text-fg-3">{STEPS[stepAt].blurb}</p>
            </div>
            {cur === 'flight' && (
              <FlightInputs plan={plan} set={set} d={d} fleet={fleet} registry={registry.data} registryLoading={registry.isLoading} poh={pohQ.data?.match} pohLoading={pohQ.isLoading}
                pohError={pohQ.error ? (pohQ.error as Error).message : null} u={u} aircraft={aircraft} profile={d.profile} />
            )}
            {cur === 'aircraft' && (
              <AircraftStep plan={plan} set={set} d={d} registry={registry.data} match={match} poh={pohQ.data?.match} pohLoading={pohQ.isLoading} pohError={pohQ.error ? (pohQ.error as Error).message : null}
                aircraft={aircraft} planning={planning} savePlanning={savePlanning} u={u} />
            )}
            {cur === 'route' && <RouteStep plan={plan} set={set} d={d} routePts={routePts} alternate={altAirport} weather={wx.data ?? null} airspace={airspace.data} radar={radar.data} notams={notams} checkpoints={corridor.data ?? []} landmarks={landmarks.data ?? null} landmarksLoading={landmarks.isFetching} edit={edit} />}
            {cur === 'airports' && <AirportsStep d={d} routePts={routePts} alternate={altAirport} autoAlternate={autoAlt} setAlternate={v => set({ alternate: v })} minimums={minimums} notams={notamSets} cycle={apts.data?.cycle ?? null} />}
            {cur === 'weather' && (
              <div className="space-y-5">
                {routePts.length > 1 && <PlannerMap className="h-[24rem] print:hidden" route={routePts} alternate={altAirport} weather={wx.data ?? null} d={d} airspace={airspace.data} radar={radar.data} notams={notams} />}
                <WeatherSection d={d} weather={wx.data ?? null} loading={wx.isLoading} refetch={() => wx.refetch()} fetching={wx.isFetching} />
              </div>
            )}
            {cur === 'loading' && (
              <div className="space-y-8">
                <div><SubHead right={<span className="text-xs text-fg-3">Limits from POH Sec. 2 and Fig. 6-8</span>}>Weight and balance</SubHead><WbTable d={d} plan={plan} u={u} /></div>
                <div><SubHead>Takeoff and landing</SubHead><PerformanceSection d={d} profile={d.profile} /></div>
              </div>
            )}
            {cur === 'pilot' && <PilotStep plan={plan} set={set} d={d} currency={currency} minimums={minimums} savedAt={minQ.data?.updatedAt} saveMinimums={m => minQ.save.mutate(m, { onSuccess: () => toast.success('Minimums saved') })} saving={minQ.save.isPending} />}
            {cur === 'review' && <Review d={d} status={overall} label={verdict} onJump={key => go(STEPS.findIndex(s => s.key === key))} />}
            {cur === 'navlog' && (
              <div className="space-y-8">
                {d.flights.length > 0 && <p className="text-sm text-fg-3 xl:hidden print:hidden">The sheet is the paper NavLog at full size; scroll it sideways. Print puts it on one landscape page.</p>}
                {d.flights.map(f => (
                  <div key={f.n} className="break-after-page">
                    <SubHead right={<span className="num text-xs text-fg-3">{f.distNm.toFixed(1)} nm · {Math.round(f.eteMin)} min · {f.fuelGal.toFixed(2)} gal · arrive {fmtTime(f.arriveAt)}</span>}>
                      NavLog {d.flights.length > 1 ? `${f.n + 1} of ${d.flights.length} · ` : ''}<span className="num">{f.from.icao || f.from.id} → {f.to.icao || f.to.id}</span>
                    </SubHead>
                    <NavlogFront plan={planEff} set={set} d={d} flight={f} notes={flightNotes(d, f, acName, notamSets)} u={u} />
                  </div>
                ))}
                {!d.flights.length && <p className="text-sm text-fg-3">The NavLog fills in once the route resolves and the aircraft's POH is known.</p>}
                {d.flights.length > 0 && (
                  <div className="break-before-page">
                    <SubHead>Reverse · weather log and flight plan</SubHead>
                    <NavlogReverse plan={planEff} set={set} d={d} airports={airports} planning={planning} savePlanning={p => planningQ.save.mutate(p)} registry={registry.data} pilot={pilotQ.data} savePilot={p => pilotQ.save.mutate(p)} />
                  </div>
                )}
              </div>
            )}
            <div className="mt-8 flex items-center gap-2 border-t border-border pt-4 print:hidden">
              {stepAt > 0 && <Button variant="ghost" onClick={() => go(stepAt - 1)}><ChevronLeft />{STEPS[stepAt - 1].label}</Button>}
              {stepAt < STEPS.length - 1 && <Button variant="primary" className="ml-auto" onClick={() => go(stepAt + 1)}>{STEPS[stepAt + 1].label}<ChevronRight /></Button>}
              {cur === 'navlog' && <Button variant="primary" className="ml-auto" onClick={() => window.print()}><Printer />Print</Button>}
            </div>
          </Card>
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

const routeOf = (p: Plan) => p.route.map(r => { const id = parseRouteItem(r).id; return p.labels?.[id]?.name ?? id }).join(' → ') || 'No route'
const whenOf = (p: Plan) => { const d = new Date(p.departLocal); return Number.isNaN(+d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' }) }

// Saved plans beside the wizard: upcoming first (soonest on top), then past
// (most recent on top). Saved in your database only.
function PlanList({ plans, loading, currentId, draft, onOpen, onNew }: {
  plans: SavedPlan[] | undefined; loading: boolean; currentId: number | null; draft: Plan | null; onOpen: (p: SavedPlan) => void; onNew: () => void
}) {
  const now = Date.now()
  const at = (p: SavedPlan) => +new Date(p.data.departLocal) || 0
  const upcoming = (plans ?? []).filter(p => at(p) >= now - 3 * 3600_000).sort((a, b) => at(a) - at(b))
  const past = (plans ?? []).filter(p => at(p) < now - 3 * 3600_000).sort((a, b) => at(b) - at(a))
  const Item = ({ p }: { p: SavedPlan }) => (
    <li>
      <button onClick={() => onOpen(p)} aria-current={p.id === currentId ? 'true' : undefined}
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
        <span className="text-sm font-medium text-fg">Flight plans</span>
        <Button variant="ghost" size="sm" onClick={onNew}><FilePlus2 />New</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {draft && (
          <div className="mb-1 rounded-lg bg-accent-soft px-3 py-2 ring-1 ring-inset ring-accent/40">
            <div className="truncate text-sm font-medium text-accent">{draft.name}</div>
            <div className="num truncate text-xs text-fg-3">{routeOf(draft)}</div>
            <div className="text-xs text-fg-3">Not saved yet</div>
          </div>
        )}
        {loading && <p className="flex items-center gap-2 px-3 py-2 text-sm text-fg-3"><Loader2 className="size-4 animate-spin" />Loading plans…</p>}
        {!loading && !plans?.length && <p className="px-3 py-2 text-sm text-fg-3">No saved plans yet. Save puts the plan here.</p>}
        <Group title="Upcoming" list={upcoming} />
        <Group title="Past" list={past} />
      </div>
      <p className="border-t border-border px-3 pt-2 text-xs text-fg-3">Saved in your planner only. Nothing is filed with the FAA; file with 1800wxbrief yourself.</p>
    </div>
  )
}

function LoadingStrip({ loading, saving, failed }: { loading: string[]; saving: boolean; failed: [string, () => void][] }) {
  if (!loading.length && !saving && !failed.length) return null
  return (
    <div role="status" aria-live="polite" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm print:hidden">
      {(loading.length > 0 || saving) && <span className="inline-flex items-center gap-2 text-fg-2"><Loader2 className="size-4 animate-spin text-accent" />{[saving ? 'Saving' : null, loading.length ? `Loading ${loading.join(', ')}` : null].filter(Boolean).join(' · ')}…</span>}
      {failed.map(([n, retry]) => <span key={n} className="inline-flex items-center gap-1.5 text-bad">Couldn't load {n}<button className="text-accent hover:underline" onClick={() => retry()}>Retry</button></span>)}
    </div>
  )
}

const SECTION_STEP: Record<SectionKey, string> = { trip: 'flight', aircraft: 'aircraft', navlog: 'route', weather: 'weather', loading: 'loading', performance: 'loading', pilot: 'pilot' }

// Go/no-go: every check, grouped by the step that produced it, worst first.
function Review({ d, status, label, onJump }: { d: Derived; status: Status; label: string; onJump: (step: string) => void }) {
  const tone = status === 'nogo' ? 'bg-bad-soft ring-bad/30' : status === 'caution' ? 'bg-warn-soft ring-warn/30' : status === 'ok' ? 'bg-good-soft ring-good/30' : 'bg-card ring-border'
  const rank = (s: Status) => ['nogo', 'caution', 'todo', 'ok'].indexOf(s)
  const groups = STEPS.filter(s => s.sections.length).map(s => ({ s, checks: d.checks.filter(c => SECTION_STEP[c.section] === s.key).sort((a, b) => rank(a.status) - rank(b.status)) })).filter(g => g.checks.length)
  const t = d.totals
  const to = d.wb.steps.find(x => x.total && x.label.startsWith('Takeoff'))
  return (
    <div className="space-y-6">
      <div className={cn('flex flex-wrap items-center gap-3 rounded-xl px-5 py-4 ring-1 ring-inset', tone)}>
        <StatusIcon status={status} className="size-5" />
        <span className="text-lg font-medium text-fg">{label}</span>
        <StatusBadge status={status} />
        <span className="text-sm text-fg-3">{(['nogo', 'caution', 'todo'] as Status[]).map(s => { const n = d.checks.filter(c => c.status === s).length; return n ? `${n} ${{ nogo: 'no-go', caution: 'caution', todo: 'to do', ok: '' }[s]}` : null }).filter(Boolean).join(' · ') || 'every check passed'} · {d.checks.filter(c => c.status === 'ok').length} passed</span>
      </div>
      {d.legs.length > 0 && (
        <KV items={[
          ['Engine start / takeoff', <span className="num">{fmtTime(d.departAt)} / {fmtTime(d.takeoffAt)}</span>],
          ['Arrive', <span className="num">{fmtTime(d.legs.at(-1)!.arriveAt)}</span>],
          ['Distance / time', <span className="num">{t.distNm.toFixed(1)} nm · {fmtMin(t.eteMin)}</span>],
          ['Fuel', <span className="num">{t.tripFuel.toFixed(1)} trip + {t.taxiFuel.toFixed(1)} taxi of {t.usableFuel.toFixed(1)} gal usable · {Math.round(t.enduranceMin)} min endurance</span>],
          ['Takeoff weight', to ? <span className="num">{Math.round(to.weight).toLocaleString()} lb · CG {to.arm?.toFixed(2)} in</span> : null],
          ['Cruise', <span className="num">{d.flights.map(f => `${f.alt.toLocaleString()} ft`).join(' / ')}{d.flights[0]?.cruise ? ` · ${d.flights[0].cruise.ktas} KTAS · ${d.flights[0].cruise.gph} GPH` : ''}</span>],
        ]} />
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        {groups.map(g => (
          <div key={g.s.key}>
            <SubHead right={<button className="text-sm text-accent hover:underline" onClick={() => onJump(g.s.key)}>Open {g.s.label.toLowerCase()}</button>}>{g.s.label}</SubHead>
            <CheckRows checks={g.checks} />
          </div>
        ))}
      </div>
      <p className="text-sm text-fg-3">Not a substitute for a standard briefing (1800wxbrief.com, or 1-800-WX-BRIEF), your CFI's judgment or the POH in the airplane.</p>
    </div>
  )
}

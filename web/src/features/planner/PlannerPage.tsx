import { useEffect, useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ChevronDown, ChevronLeft, ChevronRight, FilePlus2, Loader2, MoreHorizontal, PanelRightOpen, Pencil, Printer, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { PageHeader } from '@/components/data/stat'
import { useAircraftList, useFlights, useRegistry } from '@/lib/queries'
import { get } from '@/lib/api'
import { notamBody } from '@/lib/weather'
import type { NotamResponse } from '@/lib/types'
import { computeCurrency } from '@/lib/flying'
import { homeAirport } from '@/lib/weather'
import { cn } from '@/lib/utils'
import { bboxOf, useAirportProfiles, useCertificates, useAirports, useAirspace, useCorridor, useLandmarks, useMinimums, useNearby, usePilotInfo, usePlanning, usePlans, usePohFind, type SavedPlan, useRadar, useResolve, useTerrain, useWeather } from './api'
import { AircraftStep } from './AircraftStep'
import { AirportsStep } from './AirportsStep'
import { PilotStep } from './PilotStep'
import { RouteStep } from './RouteStep'
import { bestInsert, insertAt, removeAt, replaceAt } from './route'
import type { EditPoint, RouteEdit } from './PlannerMap'
import { flightNotes, type NotamSet } from './brief'
import { sampleRoute } from './calc'
import { FlightInputs } from './FlightInputs'
import { DEFAULT_MINIMUMS, applyAirportProfile, derive, isWaypoint, makeResolver, parseRouteItem, type Airport, type Plan, type Status } from './model'
import { NavlogFront, NavlogReverse } from './NavlogSheet'
import { PerformanceSection } from './PerformanceSection'
import { PlannerMap, type MapNotams } from './PlannerMap'
import { WbTable } from './PohSummary'
import { applyEdits, profileFor } from './poh'
import { CERTIFICATES, roleOf } from './pilot'
import { RefPanel, RefProvider, isDocTab, useRefs } from './RefPanel'
import { unitsForTail } from './units'
import { WeatherSection } from './WeatherSection'
import { StatusIcon, SubHead, fmtMin, fmtTime } from './ui'
import { Brief, domainStatus } from './BriefView'
import { DOMAIN_OF, FixesPane, WorkingsPane, type DomainKey } from './Sidebar'
import { assumptions, calculations, sources } from './workings'

const DRAFT_KEY = 'planner-draft-v3'

// Three stages: Plan (what you type and the route on the chart), Brief (the
// verdict, then one line per area with the detail behind it) and NavLog. The
// sidebar holds what to fix, the workings and the documents.
type Stage = 'plan' | 'brief' | 'navlog'
const STAGES: { key: Stage; label: string }[] = [{ key: 'plan', label: 'Plan' }, { key: 'brief', label: 'Brief' }, { key: 'navlog', label: 'NavLog' }]
const pad = (n: number) => String(n).padStart(2, '0')
const nextHourLocal = () => { const d = new Date(Date.now() + 60 * 60_000); d.setMinutes(0, 0, 0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00` }
const blank = (tail: string | null): Plan => ({
  name: 'New flight', route: [homeAirport()], alternate: null, departLocal: nextHourLocal(), rpm: 2400, tail,
  seats: { pilot: 0, front: 0, rearL: 0, rearR: 0 }, loads: { front: 0, rear: 0, bag1: 0, bag2: 0 }, fuelGal: null, stopMinutes: 30, night: null, actuals: {},
})
interface Draft { plan: Plan; id: number | null; stage?: Stage; open?: DomainKey | null }
function readDraft(): Draft | null {
  try {
    const s = localStorage.getItem(DRAFT_KEY) ?? localStorage.getItem('planner-draft-v2')
    if (!s) return null
    const d = JSON.parse(s) as Draft & { step?: number }
    // Drafts from the nine-step wizard: step 0 was the inputs, 8 the NavLog.
    const stage = d.stage ?? (d.step == null || d.step === 0 ? 'plan' : d.step === 8 ? 'navlog' : 'brief')
    return { plan: d.plan, id: d.id ?? null, stage, open: d.open ?? null }
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

  const [state, setState] = useState<Draft>(() => readDraft() ?? { plan: blank(null), id: null, stage: 'plan' })
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
  // Your airport profiles (pattern altitude, pattern sides, notes) on top of NASR.
  const aptIds = useMemo(() => (apts.data?.airports ?? []).map(a => a.icao || a.id), [apts.data])
  const aptProfiles = useAirportProfiles(aptIds)
  const airports = useMemo(() => (apts.data?.airports ?? []).map(a => applyAirportProfile(a, aptProfiles.data?.[a.icao || a.id])), [apts.data, aptProfiles.data])
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
    // Your name for a point (e.g. "Anderson Lake"); blank goes back to its ident.
    rename: (i, name) => {
      const r = plan.route[routeIdx[i]]; if (r == null) return
      const id = parseRouteItem(r).id, labels = { ...plan.labels }
      if (name.trim()) labels[id] = { name: name.trim().slice(0, 40), kind: labels[id]?.kind ?? '' }
      else delete labels[id]
      set({ labels })
    },
    add: p => edit.insert(bestInsert(routePts, p), p),
  }
  const registry = useRegistry(plan.tail ?? undefined)
  const planningQ = usePlanning(plan.tail)
  const planning = useMemo(() => planningQ.data ?? {}, [planningQ.data])
  const minQ = useMinimums()
  const certsQ = useCertificates()
  const certs = certsQ.isLoading ? undefined : (certsQ.data?.certificate ? certsQ.data : null)
  const minimums = useMemo(() => ({ ...DEFAULT_MINIMUMS, ...(minQ.data || {}) }), [minQ.data])
  const fleetRef = fleet.find(a => a.tail_number === plan.tail)
  // This plan's entry, then the tail's saved profile, then the FAA registry.
  const edits = planning.profile
  const aircraft = useMemo(() => ({
    make: plan.aircraft?.make || edits?.make || registry.data?.make || fleetRef?.make || null,
    model: plan.aircraft?.model || edits?.model || registry.data?.model || fleetRef?.model || null,
    year: plan.aircraft?.year ?? edits?.year ?? registry.data?.year ?? fleetRef?.year ?? null,
  }), [plan.aircraft, edits, registry.data, fleetRef])
  const pohQ = usePohFind(plan.tail ? { ...aircraft, tail: plan.tail } : null)
  const match = useMemo(() => (plan.tail ? applyEdits(profileFor(aircraft.model), edits) : null), [plan.tail, aircraft.model, edits])
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
  const saving = planningQ.save.isPending || certsQ.save.isPending || aptProfiles.save.isPending || minQ.save.isPending || plans.create.isPending || plans.update.isPending
  const failed: [string, () => void][] = ([
    ['route points', resolved.isError, resolved.refetch], ['airports', apts.isError, apts.refetch], ['weather', wx.isError, wx.refetch], ['terrain', terrain.isError, terrain.refetch],
    ['airspace', airspace.isError, airspace.refetch], ['checkpoints', corridor.isError, corridor.refetch], ['landmarks', landmarks.isError, landmarks.refetch], ['POH', pohQ.isError, pohQ.refetch],
  ] as [string, boolean, () => void][]).filter(([, e]) => e).map(([n, , r]) => [n, r])
  const planEff = useMemo(() => ({ ...plan, alternate: effAlt }), [plan, effAlt])

  const d = useMemo(() => derive(planEff, {
    airports, weather: wx.data ?? null, match, planning, minimums, terrain: terrain.data?.elevations ?? null,
    currency, airspace: airspace.data ?? null, checkpoints: corridor.data ?? [], points, certs,
  }), [planEff, airports, wx.data, match, planning, minimums, terrain.data, currency, airspace.data, corridor.data, points, certs])

  const nightAuto = d.wx.some(w => w.night)
  useEffect(() => { if (plan.night === null && nightAuto) set({ night: true }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [nightAuto])

  // Any no-go rules it out; open items mean it isn't decided yet.
  const all = d.checks.map(c => c.status)
  const overall: Status = all.includes('nogo') ? 'nogo' : all.includes('todo') || plan.route.length < 2 ? 'todo' : all.includes('caution') ? 'caution' : 'ok'
  const verdict = overall === 'nogo' ? 'No-go as planned' : overall === 'caution' ? 'Go with caution' : overall === 'todo' ? 'Incomplete' : 'Go'

  const save = async () => {
    try {
      // An unnamed plan is named after its route ("KRHV → KSNS").
      const named = !plan.name.trim() || plan.name === 'New flight' ? { ...plan, name: plan.route.length > 1 ? `${parseRouteItem(plan.route[0]).id} → ${parseRouteItem(plan.route.at(-1)!).id}` : 'Flight plan' } : plan
      if (named !== plan) set({ name: named.name })
      if (state.id) await plans.update.mutateAsync({ id: state.id, plan: named })
      else { const r = await plans.create.mutateAsync(named); setState(s => ({ ...s, id: r.id })) }
      toast.success(`Saved "${named.name}"`)
    } catch (e) { toast.error((e as Error).message) }
  }
  const routeText = plan.route.map(r => { const id = parseRouteItem(r).id; return plan.labels?.[id]?.name ?? id }).join(' → ') || 'No route yet'
  const refOpen = refs.state.open
  const routeIds = plan.route.map(r => parseRouteItem(r).id).filter((_, i) => !routePts[i] || !isWaypoint(routePts[i]))
  const pohStatus = pohQ.isLoading ? `Downloading the ${aircraft.model} POH…` : pohQ.data?.uploaded ? `Your upload for ${plan.tail}.` : pohQ.data?.match && !pohQ.data.match.exact ? `${pohQ.data.match.title} is the closest public POH to the ${aircraft.model}.` : null
  const acName = [aircraft.make && aircraft.make.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), aircraft.model].filter(Boolean).join(' ') || d.profile?.model || 'Aircraft'
  const savePlanning = (p: typeof planning) => planningQ.save.mutate(p, { onSuccess: () => toast.success(`${plan.tail} saved`) })

  const stage: Stage = state.stage ?? 'plan'
  const openDomain = state.open ?? null
  const go = (st: Stage, open?: DomainKey | null) => { setState(s => ({ ...s, stage: st, ...(open !== undefined ? { open } : {}) })); if (open === undefined) window.scrollTo({ top: 0 }) }
  const jump = (k: DomainKey) => { if (k === 'plan') go('plan'); else go('brief', k); if (!window.matchMedia('(min-width: 80rem)').matches) refs.close() }
  const altAirport = effAlt ? airports.find(a => a.icao === effAlt || a.id === effAlt) ?? null : null
  const role = roleOf(plan.crew, certs)
  const issues = d.checks.filter(c => c.status !== 'ok').length
  const planIssues = d.checks.filter(c => DOMAIN_OF[c.section] === 'plan' && c.status !== 'ok')

  // The sidebar's workings, from the same derive() output the brief shows.
  const wIn = { d, plan: planEff, minimums, weather: wx.data ?? null, cycle: apts.data?.cycle ?? null, pohNote: pohStatus, altAuto: !d.flights.some(f => f.altSet), certsSaved: !!certs?.certificate, terrainAt: terrain.data?.fetchedAt ?? null }
  const topics = useMemo(() => calculations(wIn), [d, planEff, minimums]) // eslint-disable-line react-hooks/exhaustive-deps
  const assumed = useMemo(() => assumptions(wIn), [d, planEff, minimums, certs]) // eslint-disable-line react-hooks/exhaustive-deps
  const srcs = useMemo(() => sources(wIn), [d, wx.data, apts.data, pohStatus, terrain.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // One line per area of the brief: the answer when it's fine.
  const code = (a: Airport) => a.icao || a.id
  const dep = d.perf.find(p => p.kind === 'takeoff'), arr = [...d.perf].reverse().find(p => p.kind === 'landing' && p.wx.role !== 'alternate')
  const imsafeLeft = d.checks.find(c => c.title.startsWith('IMSAFE:'))
  const summary: Record<DomainKey, React.ReactNode> = {
    plan: routeText,
    pilot: [role === 'dual' ? `Dual with ${plan.crew?.instructor?.trim() || 'an instructor'}` : `You as PIC`, certs?.certificate ? CERTIFICATES.find(c => c.key === certs.certificate)?.label : 'certificate not saved', imsafeLeft?.title].filter(Boolean).join(' · '),
    aircraft: plan.tail ? `${plan.tail} · ${acName}${d.profile ? ` · ${d.profile.engine.split(',')[0]}` : ''}` : 'No aircraft chosen',
    weather: d.wx.length ? d.wx.filter(w => w.role !== 'alternate').map(w => `${code(w.airport)} ${w.category ?? 'no report'} ${fmtTime(w.at)}`).join(' · ') : 'Weather at each ETA, advisories, PIREPs, TFRs and NOTAMs',
    route: d.legs.length ? `${d.flights.map(f => `${f.alt.toLocaleString()} ft`).join(' / ')} · ${Math.round(d.totals.distNm)} nm · ${fmtMin(d.totals.eteMin)} · ${d.totals.requiredFuel.toFixed(1)} of ${d.totals.usableFuel.toFixed(1)} gal${d.crossings.length ? ` · ${d.crossings.length} airspace` : ''}` : 'Altitudes, checkpoints, airspace and fuel',
    airports: [dep?.runway && `${code(dep.airport)} RWY ${dep.runway.end.id}`, arr?.runway && `${code(arr.airport)} RWY ${arr.runway.end.id}`, effAlt && `alternate ${effAlt}`].filter(Boolean).join(' · ') || 'Runways, pattern, frequencies, NOTAMs and the alternate',
    loading: d.wb.steps.length ? `Takeoff ${Math.round(d.wb.takeoff.weight).toLocaleString()} lb, CG ${d.wb.takeoff.cg.toFixed(1)} in${dep?.dist && dep.runway ? ` · ${dep.dist.total.toLocaleString()} of ${dep.runway.toraFt.toLocaleString()} ft to 50 ft` : ''}` : 'Weight and balance, takeoff and landing distances',
  }
  const detail = (k: DomainKey) => {
    if (k === 'pilot') return <PilotStep plan={plan} set={set} d={d} currency={currency} certs={certs ?? null} saveCerts={c => certsQ.save.mutate(c, { onSuccess: () => toast.success('Certificates saved'), onError: e => toast.error(e.message) })} savingCerts={certsQ.save.isPending} minimums={minimums} savedAt={minQ.data?.updatedAt} saveMinimums={m => minQ.save.mutate(m, { onSuccess: () => toast.success('Minimums saved') })} saving={minQ.save.isPending} />
    if (k === 'aircraft') return <AircraftStep plan={plan} set={set} d={d} registry={registry.data} match={match} poh={pohQ.data?.match} pohDoc={pohQ.data?.doc} pohUploaded={!!pohQ.data?.uploaded} savingPlanning={planningQ.save.isPending} pohLoading={pohQ.isLoading} pohError={pohQ.error ? (pohQ.error as Error).message : null} aircraft={aircraft} planning={planning} savePlanning={savePlanning} u={u} />
    if (k === 'weather') return (
      <div className="space-y-6">
        {routePts.length > 1 && <PlannerMap className="h-[22rem] print:hidden" route={routePts} alternate={altAirport} weather={wx.data ?? null} d={d} airspace={airspace.data} radar={radar.data} notams={notams} />}
        <WeatherSection d={d} weather={wx.data ?? null} loading={wx.isLoading} refetch={() => wx.refetch()} fetching={wx.isFetching} />
      </div>
    )
    if (k === 'route') return <RouteStep part="table" plan={plan} set={set} d={d} routePts={routePts} alternate={altAirport} weather={wx.data ?? null} airspace={airspace.data} radar={radar.data} notams={notams} checkpoints={corridor.data ?? []} landmarks={landmarks.data ?? null} landmarksLoading={landmarks.isFetching} edit={edit} />
    if (k === 'airports') return <AirportsStep d={d} routePts={routePts} alternate={altAirport} autoAlternate={autoAlt} setAlternate={v => set({ alternate: v })} minimums={minimums} notams={notamSets} cycle={apts.data?.cycle ?? null}
      nasr={apts.data?.airports ?? []} profiles={aptProfiles.data ?? {}} savingProfile={aptProfiles.save.isPending}
      saveProfile={(id, p) => aptProfiles.save.mutate({ id, profile: p }, { onSuccess: () => toast.success(p ? `${id} profile saved` : `${id} profile deleted`), onError: e => toast.error(e.message) })} />
    if (k === 'loading') return (
      <div className="space-y-8">
        <div><SubHead right={<span className="text-xs text-fg-3">Limits from POH Sec. 2 and Fig. 6-8</span>}>Weight and balance</SubHead><WbTable d={d} plan={plan} u={u} /></div>
        <div><SubHead>Takeoff and landing</SubHead><PerformanceSection d={d} profile={d.profile} /></div>
      </div>
    )
    return null
  }
  const stageStatus = (st: Stage): Status | null => st === 'plan' ? (planIssues.length ? domainStatus({ ...d, checks: planIssues }, 'plan') : null) : st === 'brief' ? overall : null
  const tone = (s: Status | null) => (s === 'nogo' ? 'text-bad' : s === 'caution' ? 'text-warn' : s === 'ok' ? 'text-good' : 'text-fg-3')

  return (
    <div className="planner">
      <PageHeader className="[&>div:first-child]:basis-full xl:[&>div:first-child]:basis-0 max-sm:[&>div:nth-child(2)]:w-full"
        title={<label className="group flex min-w-0 items-center gap-2"><input value={plan.name} onChange={e => set({ name: e.target.value })} aria-label="Plan name" placeholder="Name this flight plan" size={Math.max(10, plan.name.length + 1)} className="field-sizing-content min-w-0 max-w-full bg-transparent outline-none placeholder:text-fg-3 focus:underline" /><Pencil className="size-5 shrink-0 text-fg-3 group-hover:text-fg print:hidden" aria-hidden /></label>}
        description={<span><span className="num">{routeText}</span>{d.departAt && <> · {d.departAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}{d.legs.length > 0 && <> · <span className="num">{Math.round(d.totals.distNm)} nm · {fmtMin(d.totals.eteMin)} · {d.totals.tripFuel.toFixed(1)} gal</span></>}</span>}
        actions={<div className="flex w-full flex-wrap items-center gap-2 sm:w-auto print:hidden">
          <Popover>
            <PopoverTrigger asChild><Button variant="ghost">Plans<ChevronDown /></Button></PopoverTrigger>
            <PopoverContent align="end" className="max-h-[70dvh] w-80 overflow-hidden p-2">
              <PlanList plans={plans.data} loading={plans.isLoading} currentId={state.id} draft={state.id ? null : plan}
                onOpen={p => setState({ plan: p.data, id: p.id, stage: 'brief' })} onNew={() => setState({ plan: blank(recentTail), id: null, stage: 'plan' })} />
            </PopoverContent>
          </Popover>
          <Button variant="secondary" onClick={() => setState({ plan: blank(recentTail), id: null, stage: 'plan' })}><FilePlus2 />New</Button>
          <Button variant="primary" onClick={save} loading={plans.create.isPending || plans.update.isPending}><Save />Save</Button>
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => { go('navlog'); setTimeout(() => window.print(), 300) }}><Printer />Print NavLog</MenuItem>
              {state.id && <MenuItem danger onSelect={() => { plans.remove.mutate(state.id!); setState({ plan: blank(recentTail), id: null, stage: 'plan' }) }}><Trash2 />Delete plan</MenuItem>}
            </MenuContent>
          </Menu>
          {!refOpen && <Button variant="ghost" onClick={() => refs.show(refs.state.tab)}><PanelRightOpen />{issues ? <span className="num">{issues} to fix</span> : 'Workings'}</Button>}
        </div>}
      />

      <nav aria-label="Planner stages" className="mb-4 flex items-center gap-1 border-b border-border print:hidden">
        {STAGES.map(st => {
          const s = stageStatus(st.key), on = stage === st.key
          return (
            <button key={st.key} onClick={() => go(st.key)} aria-current={on ? 'page' : undefined}
              className={cn('-mb-px flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[15px] transition-colors', on ? 'border-accent font-medium text-fg' : 'border-transparent text-fg-3 hover:text-fg')}>
              {st.label}
              {st.key === 'brief' && s && <span className={cn('inline-flex items-center gap-1 text-[13px] font-normal', tone(s))}><StatusIcon status={s} className="size-3.5" /><span className="max-sm:hidden">{verdict}</span></span>}
              {st.key === 'plan' && s && <StatusIcon status={s} className="size-3.5" />}
            </button>
          )
        })}
      </nav>

      <LoadingStrip loading={pending.filter(([, v]) => v).map(([n]) => n)} saving={saving} failed={failed} />

      <div className={cn('grid gap-5', refOpen && (isDocTab(refs.state.tab) ? 'xl:grid-cols-[minmax(0,1fr)_minmax(26rem,42%)]' : 'xl:grid-cols-[minmax(0,1fr)_25rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]'))}>
        <div className="min-w-0 space-y-5">
          {stage === 'plan' && (
            <>
              <Card className="px-4 py-4 sm:px-6 sm:py-5">
                <FlightInputs plan={plan} set={set} d={d} fleet={fleet} registry={registry.data} registryLoading={registry.isLoading} poh={pohQ.data?.match} pohUploaded={pohQ.data?.uploaded ? pohQ.data.doc : null} pohLoading={pohQ.isLoading}
                  pohError={pohQ.error ? (pohQ.error as Error).message : null} u={u} aircraft={aircraft} profile={d.profile} certs={certs ?? null} />
              </Card>
              <Card className="px-4 py-4 sm:px-6 sm:py-5">
                <SubHead right={<span className="text-xs text-fg-3">Optional: drag the line to add points between departure and arrival</span>}>Route on the chart</SubHead>
                <RouteStep part="chart" plan={plan} set={set} d={d} routePts={routePts} alternate={altAirport} weather={wx.data ?? null} airspace={airspace.data} radar={radar.data} notams={notams} checkpoints={corridor.data ?? []} landmarks={landmarks.data ?? null} landmarksLoading={landmarks.isFetching} edit={edit} />
              </Card>
            </>
          )}
          {stage === 'brief' && <Brief d={d} status={overall} label={verdict} open={openDomain} setOpen={k => setState(s => ({ ...s, open: k }))} summary={summary} detail={detail} />}
          {stage === 'navlog' && (
            <Card className="space-y-8 px-3 py-4 sm:px-5 sm:py-5">
              {d.flights.length > 0 && <p className="text-sm text-fg-3 xl:hidden print:hidden">The sheet is the paper NavLog at full size; scroll it sideways. Print puts it on one landscape page.</p>}
              {d.flights.map(f => (
                <div key={f.n} className="break-after-page">
                  <SubHead right={<span className="num text-xs text-fg-3">{f.distNm.toFixed(1)} nm · {Math.round(f.eteMin)} min · {f.fuelGal.toFixed(2)} gal · arrive {fmtTime(f.arriveAt)}</span>}>
                    NavLog {d.flights.length > 1 ? `${f.n + 1} of ${d.flights.length} · ` : ''}<span className="num">{f.from.icao || f.from.id} → {f.to.icao || f.to.id}</span>
                  </SubHead>
                  <NavlogFront plan={planEff} set={set} d={d} flight={f} notes={flightNotes(d, f, acName, notamSets, role === 'dual' ? plan.crew?.instructor?.trim() || 'instructor' : null)} u={u} />
                </div>
              ))}
              {!d.flights.length && <p className="text-sm text-fg-3">The NavLog fills in once the route resolves and the aircraft's POH is known.</p>}
              {d.flights.length > 0 && (
                <div className="break-before-page">
                  <SubHead>Reverse · weather log and flight plan</SubHead>
                  <NavlogReverse plan={planEff} set={set} d={d} airports={airports} planning={planning} savePlanning={p => planningQ.save.mutate(p)} registry={registry.data} pilot={pilotQ.data} savePilot={p => pilotQ.save.mutate(p)} />
                </div>
              )}
            </Card>
          )}
          <div className="flex items-center gap-2 print:hidden">
            {stage === 'brief' && <Button variant="ghost" onClick={() => go('plan')}><ChevronLeft />Plan</Button>}
            {stage === 'navlog' && <Button variant="ghost" onClick={() => go('brief')}><ChevronLeft />Brief</Button>}
            {stage === 'plan' && <Button variant="primary" className="ml-auto" onClick={() => go('brief')}>Brief this flight<ChevronRight /></Button>}
            {stage === 'brief' && <Button variant="primary" className="ml-auto" onClick={() => go('navlog')}>NavLog<ChevronRight /></Button>}
            {stage === 'navlog' && <Button variant="primary" className="ml-auto" onClick={() => window.print()}><Printer />Print</Button>}
          </div>
          <style>{'@media print { @page { size: letter landscape; margin: 0.25in } .navlog-front > div { zoom: 0.74 } }'}</style>
        </div>

        {refOpen && (
          <aside aria-label="Fixes, workings and documents" className="fixed inset-0 z-40 bg-bg p-2 xl:sticky xl:inset-auto xl:top-20 xl:z-auto xl:h-[calc(100dvh-6rem)] xl:bg-transparent xl:p-0 print:hidden">
            <RefPanel className="h-full" tail={plan.tail} model={aircraft.model ?? match?.profile.key.replace(/^C/, '') ?? null} route={routeIds} date={plan.departLocal.slice(0, 10)} pohDocId={pohQ.data?.doc?.id ?? null} pohStatus={pohStatus}
              fixCount={issues} panes={{ fixes: <FixesPane checks={d.checks} onJump={jump} />, workings: <WorkingsPane topics={topics} assumptions={assumed} sources={srcs} /> }} />
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

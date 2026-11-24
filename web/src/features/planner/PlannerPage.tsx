import { useEffect, useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronLeft, ChevronRight, FilePlus2, Loader2, MoreHorizontal, PanelRightOpen, Pencil, Printer, Save, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router'
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
import { DEFAULT_MINIMUMS, applyAirportProfile, derive, isWaypoint, loadsOf, makeResolver, parseRouteItem, type Airport, type Check as PlanCheck, type Plan, type Status } from './model'
import { NavlogFront, NavlogReverse } from './NavlogSheet'
import { PerformanceSection } from './PerformanceSection'
import { PlannerMap, type MapNotams } from './PlannerMap'
import { WbTable } from './PohSummary'
import { applyEdits, profileFor, withSpecs, withTables } from './poh'
import { CERTIFICATES, roleOf } from './pilot'
import { RefPanel, RefProvider, useRefs } from './RefPanel'
import { unitsForTail } from './units'
import { SELF } from './profiles'
import { WeatherSection } from './WeatherSection'
import { SubHead, fmtMin, fmtTime } from './ui'
import { Brief } from './BriefView'
import { DOMAIN_LABEL, DOMAIN_OF, FixesPane, WorkingsPane, worstStatus, type DomainKey } from './Sidebar'
import { assumptions, calculations, sources } from './workings'
import { explainRow, explainWb, inputSources } from './explain'
import { CgChart } from './ExplainView'
import { WbLimits } from './WbLimits'
import type { Focus } from './Sidebar'

import { relTime } from '@/lib/format'
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
// saved: the plan as last saved (JSON), to tell unsaved changes apart; savedAt: when.
interface Draft { plan: Plan; id: number | null; stage?: Stage; open?: DomainKey | null; saved?: string | null; savedAt?: string | null; wizard?: number | null }
function readDraft(): Draft | null {
  try {
    const s = localStorage.getItem(DRAFT_KEY) ?? localStorage.getItem('planner-draft-v2')
    if (!s) return null
    const d = JSON.parse(s) as Draft & { step?: number }
    // Drafts from the nine-step wizard: step 0 was the inputs, 8 the NavLog.
    const stage = d.stage ?? (d.step == null || d.step === 0 ? 'plan' : d.step === 8 ? 'navlog' : 'brief')
    return { plan: d.plan, id: d.id ?? null, stage, open: d.open ?? null, saved: d.saved ?? null, savedAt: d.savedAt ?? null, wizard: d.wizard ?? null }
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
  const [sel, setSel] = useState<{ kind: 'nav'; key: string } | { kind: 'wb'; i: number } | null>(null)
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
  // Your profile's weight fills an empty pilot seat (a new plan, or one started before it was saved).
  const selfInfo = usePilotInfo().data
  useEffect(() => {
    const wt = selfInfo?.weightLb
    if (wt && !(plan.seats?.pilot) && !plan.seatPeople?.pilot) set({ seats: { ...(plan.seats ?? { pilot: 0, front: 0, rearL: 0, rearR: 0 }), pilot: wt }, seatPeople: { ...plan.seatPeople, pilot: SELF } })
  }, [selfInfo?.weightLb, plan.seats?.pilot]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)) } catch { /* private mode */ } }, [state])

  // ── Data ──
  const tokens = useMemo(() => plan.route.map(r => parseRouteItem(r).id), [plan.route])
  // Alternate: yours, or the nearest suitable airport to the destination that
  // isn't on the route and isn't reporting IFR (worked out below, once known).
  const [autoAlt, setAutoAlt] = useState<string | null>(null)
  const effAlt = plan.alternate === false ? null : plan.alternate ?? autoAlt
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
  // This model's own tables when its POH was read; the 172P's for whatever wasn't.
  const pohDoc = pohQ.data?.doc
  const match = useMemo(() => (plan.tail ? applyEdits(withSpecs(withTables(profileFor(aircraft.model), pohDoc?.tables, pohDoc?.title), pohDoc?.specs, pohDoc?.title), edits) : null), [plan.tail, aircraft.model, edits, pohDoc])
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
  const planEff = useMemo(() => ({ ...plan, alternate: plan.alternate === false ? false as const : effAlt }), [plan, effAlt])

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
      setState(s => ({ ...s, saved: JSON.stringify(named), savedAt: new Date().toISOString() }))
      toast.success(`Saved "${named.name}" to your plans`)
    } catch (e) { toast.error((e as Error).message) }
  }
  const routeText = plan.route.map(r => { const id = parseRouteItem(r).id; return plan.labels?.[id]?.name ?? id }).join(' → ') || 'No route yet'
  const refOpen = refs.state.open
  const routeIds = plan.route.map(r => parseRouteItem(r).id).filter((_, i) => !routePts[i] || !isWaypoint(routePts[i]))
  const pohStatus = pohQ.isLoading ? `Downloading the ${aircraft.model} POH…` : pohQ.data?.uploaded ? `Your upload for ${plan.tail}.` : pohQ.data?.match && !pohQ.data.match.exact ? `${pohQ.data.match.title} is the closest public POH to the ${aircraft.model}.` : null
  const acName = [aircraft.make && aircraft.make.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), aircraft.model].filter(Boolean).join(' ') || d.profile?.model || 'Aircraft'
  const savePlanning = (p: typeof planning) => planningQ.save.mutate(p, { onSuccess: () => toast.success(`${plan.tail} saved`) })

  const stage: Stage = state.stage ?? 'plan'
  const dirty = state.saved !== JSON.stringify(plan)
  const [plansOpen, setPlansOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // A new plan starts in the guided setup: one question group at a time.
  const startNew = () => setState({ plan: blank(recentTail), id: null, stage: 'plan', saved: null, savedAt: null, wizard: 0 })
  const openDomain = state.open ?? null
  const go = (st: Stage, open?: DomainKey | null) => { setState(s => ({ ...s, stage: st, ...(open !== undefined ? { open } : {}) })); if (open === undefined) window.scrollTo({ top: 0 }) }
  const jump = (k: DomainKey) => { if (k === 'plan') go('plan'); else go('brief', k); if (!window.matchMedia('(min-width: 96rem)').matches) refs.close() }
  const altAirport = effAlt ? airports.find(a => a.icao === effAlt || a.id === effAlt) ?? null : null
  const role = roleOf(plan.crew, certs)
  const issues = d.checks.filter(c => c.status === 'nogo' || c.status === 'caution' || c.status === 'todo').length
  const worst = worstStatus(d.checks)

  // The sidebar's workings, from the same derive() output the brief shows.
  const wIn = { d, plan: planEff, minimums, weather: wx.data ?? null, cycle: apts.data?.cycle ?? null, pohNote: pohStatus, altAuto: !d.flights.some(f => f.altSet), altMode: plan.alternate === false ? 'none' as const : plan.alternate ? 'yours' as const : 'auto' as const, certsSaved: !!certs?.certificate, terrainAt: terrain.data?.fetchedAt ?? null, notams: notamSets }
  const topics = useMemo(() => calculations(wIn), [d, planEff, minimums, notamSets]) // eslint-disable-line react-hooks/exhaustive-deps
  const assumed = useMemo(() => assumptions(wIn), [d, planEff, minimums, certs]) // eslint-disable-line react-hooks/exhaustive-deps
  const srcs = useMemo(() => sources(wIn), [d, wx.data, apts.data, pohStatus, terrain.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // A NavLog row or W&B line selected in the brief: its workings fill the sidebar.
  const xIn = { d, plan: planEff, weather: wx.data ?? null, pohClosest: !!match && !match.exact }
  const inputs = useMemo(() => inputSources(xIn), [d, wx.data, match]) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (f: typeof sel) => { setSel(f); if (f) refs.show('workings') }
  const focus: Focus | null = useMemo(() => {
    if (!sel || !d.profile) return null
    const clear = () => setSel(null)
    if (sel.kind === 'nav') {
      const r = d.navlog.find(x => x.key === sel.key)
      if (!r) return null
      const ov = plan.overrides?.[r.key] ?? {}
      return {
        title: `${r.from} → ${r.to.label}`, subtitle: `${r.phase === 'climb' ? 'Climb' : r.phase === 'descent' ? 'Descent' : 'Cruise'} at ${r.alt} ft · ${r.distNm.toFixed(1)} nm · ETA ${fmtTime(r.eta)}`,
        items: explainRow(xIn, r), ov, onClear: clear,
        onEdit: (f, v) => set({ overrides: { ...plan.overrides, [r.key]: { ...ov, [f]: v != null && Number.isFinite(v) ? v : null } } }),
      }
    }
    const st = d.wb.steps[sel.i]
    return st ? { title: st.label, subtitle: 'Weight and balance', items: [explainWb(xIn, st, sel.i)], onClear: clear } : null
  }, [sel, d, plan.overrides, wx.data, match]) // eslint-disable-line react-hooks/exhaustive-deps

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
    airports: [dep?.runway && `${code(dep.airport)} RWY ${dep.runway.end.id}`, arr?.runway && `${code(arr.airport)} RWY ${arr.runway.end.id}`, effAlt ? `alternate ${effAlt}` : plan.alternate === false && 'no alternate'].filter(Boolean).join(' · ') || 'Runways, pattern, frequencies, NOTAMs and the alternate',
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
    if (k === 'route') return <RouteStep part="table" sources={inputs} focusKey={sel?.kind === 'nav' ? sel.key : null} onFocus={key => pick({ kind: 'nav', key })} plan={plan} set={set} d={d} routePts={routePts} alternate={altAirport} weather={wx.data ?? null} airspace={airspace.data} radar={radar.data} notams={notams} checkpoints={corridor.data ?? []} landmarks={landmarks.data ?? null} landmarksLoading={landmarks.isFetching} edit={edit} />
    if (k === 'airports') return <AirportsStep d={d} routePts={routePts} alternate={altAirport} noAlternate={plan.alternate === false} autoAlternate={autoAlt} setAlternate={v => set({ alternate: v })} minimums={minimums} notams={notamSets} cycle={apts.data?.cycle ?? null}
      nasr={apts.data?.airports ?? []} profiles={aptProfiles.data ?? {}} savingProfile={aptProfiles.save.isPending}
      saveProfile={(id, p) => aptProfiles.save.mutate({ id, profile: p }, { onSuccess: () => toast.success(p ? `${id} profile saved` : `${id} profile deleted`), onError: e => toast.error(e.message) })} />
    if (k === 'loading') return (
      <div className="space-y-8">
        <div><SubHead right={<span className="text-xs text-fg-3">Limits from POH Sec. 2 and Fig. 6-8</span>}>Weight and balance</SubHead><WbTable d={d} plan={plan} u={u} focus={sel?.kind === 'wb' ? sel.i : null} onFocus={i => pick({ kind: 'wb', i })} /></div>
        <div className="grid gap-8 min-[1800px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {d.wb.steps.length > 0 && d.profile && <div><SubHead right={<span className="text-[13px] text-fg-3">This flight against every weight, CG and loading limit</span>}>Limits</SubHead><WbLimits d={d} plan={plan} u={u} tank={d.profile.fuel.find(f => f.key === (planning.tanks || 'standard')) ?? d.profile.fuel[0]} /></div>}
        {d.wb.steps.length > 0 && <div><SubHead right={<span className="text-xs text-fg-3">Select a point for its workings</span>}>Center of gravity</SubHead><CgChart d={d} focus={sel?.kind === 'wb' ? sel.i : null} onFocus={i => pick({ kind: 'wb', i })} /></div>}
        </div>
        <div><SubHead>Takeoff and landing</SubHead><PerformanceSection d={d} profile={d.profile} /></div>
      </div>
    )
    return null
  }

  return (
    <div className="planner">
      <PageHeader className="[&>div:first-child]:basis-full xl:[&>div:first-child]:basis-0 max-sm:[&>div:nth-child(2)]:w-full"
        title={<label className="group flex min-w-0 items-center gap-2"><input value={plan.name} onChange={e => set({ name: e.target.value })} aria-label="Plan name" placeholder="Name this flight plan" size={Math.max(10, plan.name.length + 1)} className="field-sizing-content min-w-0 max-w-full bg-transparent outline-none placeholder:text-fg-3 focus:underline" /><Pencil className="size-5 shrink-0 text-fg-3 group-hover:text-fg print:hidden" aria-hidden /></label>}
        description={<span><span className="num">{routeText}</span>{d.departAt && <> · {d.departAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}{d.legs.length > 0 && <> · <span className="num">{Math.round(d.totals.distNm)} nm · {fmtMin(d.totals.eteMin)} · {d.totals.tripFuel.toFixed(1)} gal</span></>}</span>}
        actions={<div className="flex w-full flex-wrap items-center gap-2 sm:w-auto print:hidden">
          <Button asChild variant="ghost"><Link to="/flying/plan/profiles"><Users />Profiles</Link></Button>
          <Popover open={plansOpen} onOpenChange={setPlansOpen}>
            <PopoverTrigger asChild><Button variant="ghost">Plans<ChevronDown /></Button></PopoverTrigger>
            <PopoverContent align="end" className="max-h-[70dvh] w-80 overflow-hidden p-2">
              <PlanList plans={plans.data} loading={plans.isLoading} currentId={state.id} draft={state.id ? null : plan} unsaved={dirty && (state.id != null || plan.route.length > 1) ? plan.name : null}
                onSave={save} onOpen={p => { setPlansOpen(false); setState({ plan: p.data, id: p.id, stage: 'brief', saved: JSON.stringify(p.data), savedAt: p.updated_at }) }} onNew={() => { setPlansOpen(false); startNew() }} />
            </PopoverContent>
          </Popover>
          {dirty || !state.id
            ? <Button variant="primary" onClick={save} loading={plans.create.isPending || plans.update.isPending}><Save />{state.id ? 'Save changes' : 'Save'}</Button>
            : <span role="status" className="inline-flex h-9 items-center gap-1.5 px-1 text-[13px] text-fg-3"><Check className="size-4" />Saved {state.savedAt ? relTime(state.savedAt) : ''}</span>}
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => { go('navlog'); setTimeout(() => window.print(), 300) }}><Printer />Print NavLog</MenuItem>
              {state.id && <MenuItem danger onSelect={() => setConfirmDelete(true)}><Trash2 />Delete plan</MenuItem>}
            </MenuContent>
          </Menu>
          {confirmDelete && state.id && (
            <div role="alertdialog" aria-label="Delete this plan?" className="flex w-full items-center gap-2 text-[13px] sm:w-auto">
              <span className="text-fg-2">Delete "{plan.name}" for good?</span>
              <Button size="sm" variant="danger" onClick={() => { plans.remove.mutate(state.id!); setConfirmDelete(false); startNew() }}>Delete</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
            </div>
          )}
          {!refOpen && <Button variant="ghost" onClick={() => refs.show(refs.state.tab)}><PanelRightOpen />{issues ? <span className="num">{issues} checks</span> : 'Workings'}</Button>}
        </div>}
      />

      <nav aria-label="Planner stages" className="mb-4 flex items-center gap-1 border-b border-border print:hidden">
        {STAGES.map(st => {
          const on = stage === st.key
          return (
            <button key={st.key} onClick={() => go(st.key)} aria-current={on ? 'page' : undefined}
              className={cn('-mb-px flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[15px] transition-colors', on ? 'border-accent font-medium text-fg' : 'border-transparent text-fg-3 hover:text-fg')}>
              {st.label}
            </button>
          )
        })}
      </nav>

      <LoadingStrip loading={pending.filter(([, v]) => v).map(([n]) => n)} saving={saving} failed={failed} />

      {/* The sidebar keeps one width whatever its tab; widening it (for a PDF) is your choice. */}
      <div className={cn('grid gap-5', refOpen && (refs.state.wide ? '2xl:grid-cols-[minmax(0,1fr)_minmax(28rem,45%)]' : '2xl:grid-cols-[minmax(0,1fr)_26rem] min-[1920px]:grid-cols-[minmax(0,1fr)_30rem] min-[2560px]:grid-cols-[minmax(0,1fr)_34rem]'))}>
        <div className="min-w-0 space-y-5">
          {stage === 'plan' && state.wizard != null && (
            <Setup step={state.wizard} setStep={st => setState(s => ({ ...s, wizard: st }))} done={() => { setState(s => ({ ...s, wizard: null })); go('brief') }} skip={() => setState(s => ({ ...s, wizard: null }))}
              ready={[true, !!plan.tail && !!d.profile, plan.route.length > 1 && d.legs.length > 0, !!plan.departLocal, loadsOf(plan).front > 0]}
              hasRecords={!!certs?.certificate}>
              <FlightInputs step={state.wizard} plan={plan} set={set} d={d} fleet={fleet} registry={registry.data} registryLoading={registry.isLoading} poh={pohQ.data?.match} pohUploaded={pohQ.data?.uploaded ? pohQ.data.doc : null} pohLoading={pohQ.isLoading}
                pohError={pohQ.error ? (pohQ.error as Error).message : null} u={u} aircraft={aircraft} profile={d.profile} certs={certs ?? null} />
              {state.wizard === 2 && plan.route.length > 1 && (
                <div className="mt-5"><RouteStep part="chart" plan={plan} set={set} d={d} routePts={routePts} alternate={altAirport} weather={wx.data ?? null} airspace={airspace.data} radar={radar.data} notams={notams} checkpoints={corridor.data ?? []} landmarks={landmarks.data ?? null} landmarksLoading={landmarks.isFetching} edit={edit} /></div>
              )}
            </Setup>
          )}
          {stage === 'plan' && state.wizard == null && (
            <>
              <Card className="px-4 py-5 sm:px-7 sm:py-6">
                <FlightInputs plan={plan} set={set} d={d} fleet={fleet} registry={registry.data} registryLoading={registry.isLoading} poh={pohQ.data?.match} pohUploaded={pohQ.data?.uploaded ? pohQ.data.doc : null} pohLoading={pohQ.isLoading}
                  pohError={pohQ.error ? (pohQ.error as Error).message : null} u={u} aircraft={aircraft} profile={d.profile} certs={certs ?? null} />
              </Card>
              <Card className="space-y-4 px-4 py-5 sm:px-7 sm:py-6">
                <div><h3 className="text-[15px] font-medium text-fg">Route on the chart</h3><p className="mt-1 text-[13px] text-fg-3">Optional. Name a point by tapping it; the name goes on the NavLog.</p></div>
                <RouteStep part="chart" plan={plan} set={set} d={d} routePts={routePts} alternate={altAirport} weather={wx.data ?? null} airspace={airspace.data} radar={radar.data} notams={notams} checkpoints={corridor.data ?? []} landmarks={landmarks.data ?? null} landmarksLoading={landmarks.isFetching} edit={edit} />
              </Card>
            </>
          )}
          {stage === 'brief' && <Brief d={d} status={overall} label={verdict} open={openDomain} setOpen={k => setState(s => ({ ...s, open: k }))} summary={summary} detail={detail}
            next={<NextStep checks={d.checks} ready={plan.route.length > 1 && !d.checks.some(c => c.status === 'nogo' || c.status === 'todo')} onJump={jump} onNavlog={() => go('navlog')} onChecklist={() => refs.show('checklist')} />} />}
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
            {stage === 'plan' && state.wizard == null && <Button variant="primary" className="ml-auto" onClick={() => go('brief')}>Brief this flight<ChevronRight /></Button>}
            {stage === 'navlog' && <Button variant="primary" className="ml-auto" onClick={() => window.print()}><Printer />Print</Button>}
          </div>
          <style>{'@media print { @page { size: letter landscape; margin: 0.25in } .navlog-front > div { zoom: 0.74 } }'}</style>
        </div>

        {refOpen && (
          <aside aria-label="Fixes, workings and documents" className="fixed inset-0 z-40 bg-bg p-2 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[28rem] sm:border-l sm:border-border 2xl:sticky 2xl:inset-auto 2xl:top-20 2xl:z-auto 2xl:h-[calc(100dvh-6rem)] 2xl:w-auto 2xl:border-0 2xl:bg-transparent 2xl:p-0 print:hidden">
            <RefPanel className="h-full" tail={plan.tail} model={aircraft.model ?? match?.profile.key.replace(/^C/, '') ?? null} route={routeIds} date={plan.departLocal.slice(0, 10)} pohDoc={pohQ.data?.doc ?? null} pohLoading={pohQ.isFetching || registry.isLoading} pohStatus={pohStatus}
              fixCount={issues} fixTone={worst === 'nogo' ? 'bad' : worst === 'caution' ? 'warn' : 'neutral'} panes={{ fixes: <FixesPane checks={d.checks} onJump={jump} />, workings: <WorkingsPane topics={topics} assumptions={assumed} sources={srcs} onJump={jump} focus={focus} /> }} />
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
        <span className="text-sm font-medium text-fg">Flight plans</span>
        <Button variant="ghost" size="sm" onClick={() => guard(onNew)}><FilePlus2 />New plan</Button>
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

// Under the verdict, one action: the most important thing still open, or, once
// nothing is, what's left between a finished plan and engine start.
function NextStep({ checks, ready, onJump, onNavlog, onChecklist }: { checks: PlanCheck[]; ready: boolean; onJump: (k: DomainKey) => void; onNavlog: () => void; onChecklist: () => void }) {
  if (!ready) {
    const open = checks.filter(x => x.status === 'nogo' || x.status === 'todo').sort((a, b) => (a.status === 'nogo' ? 0 : 1) - (b.status === 'nogo' ? 0 : 1))
    const c = open[0]
    if (!c) return null
    return (
      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:gap-3">
        <p className="min-w-0 flex-1"><span className="text-fg-3">Next: </span><span className="text-fg">{c.title}</span>{c.fix ? <span className="text-fg-3"> · {c.fix}</span> : null}</p>
        <Button size="sm" variant="secondary" className="self-start sm:self-auto" onClick={() => onJump(DOMAIN_OF[c.section])}>Go to {DOMAIN_LABEL[DOMAIN_OF[c.section]].toLowerCase()}<ChevronRight /></Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:gap-3">
      <p className="min-w-0 flex-1 text-fg-2">
        Before you go: a standard briefing at <a className="text-accent hover:underline" href="https://www.1800wxbrief.com" target="_blank" rel="noreferrer">1800wxbrief.com</a> (§91.103),
        an optional VFR flight plan with Flight Service, and the <button className="text-accent hover:underline" onClick={onChecklist}>preflight checklist</button>.
      </p>
      <Button size="sm" variant="secondary" className="self-start sm:self-auto" onClick={onNavlog}><Printer />NavLog</Button>
    </div>
  )
}

const SETUP = [
  { title: 'Who\'s flying', hint: 'Solo, or dual with an instructor. Your certificate, medical and endorsements are kept from earlier plans.' },
  { title: 'Aircraft', hint: 'The tail number: its registry entry, POH, weights and speeds are looked up.' },
  { title: 'Route', hint: 'From, any points to fly over, and to. The chart shows the line and suggests checkpoints.' },
  { title: 'Time and power', hint: 'Engine-start time (local) and cruise RPM: the weather and winds are for this time.' },
  { title: 'Load', hint: 'People, bags and fuel: weight and balance and fuel reserve come from these.' },
]

// A new plan's guided setup: one group of questions per step, each with what it
// is for; done opens the brief. "Show every field" leaves it for the full form.
function Setup({ step, setStep, done, skip, ready, hasRecords, children }: { step: number; setStep: (n: number) => void; done: () => void; skip: () => void; ready: boolean[]; hasRecords: boolean; children: React.ReactNode }) {
  const last = step === SETUP.length - 1
  return (
    <Card className="px-4 py-5 sm:px-7 sm:py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[13px] font-medium uppercase tracking-wide text-fg-3">New flight · step {step + 1} of {SETUP.length}</div>
        <button className="text-[13px] text-accent hover:underline" onClick={skip}>Show every field</button>
      </div>
      <ol className="mt-3 grid grid-cols-5 gap-1.5" aria-label="Setup steps">
        {SETUP.map((st, i) => (
          <li key={st.title}>
            <button onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined} className="group w-full text-left">
              <span className={cn('block h-1 rounded-full', i === step ? 'bg-accent' : ready[i] && i < step ? 'bg-good' : 'bg-border')} />
              <span className={cn('mt-1.5 block truncate text-[13px] max-sm:hidden', i === step ? 'font-medium text-fg' : 'text-fg-3 group-hover:text-fg-2')}>{st.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-fg-2">{SETUP[step].hint}{step === 0 && !hasRecords && ' Add them once under Brief → Pilot and every plan uses them.'}</p>
      <div className="mt-2">{children}</div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}><ChevronLeft />Back</Button>}
        {!ready[step] && <span className="text-[13px] text-fg-3">{step === 1 ? 'Enter a tail number to look up the airplane.' : step === 2 ? 'Enter where you leave from and land.' : step === 4 ? 'Enter the pilot\'s weight.' : ''}</span>}
        <Button variant="primary" className="ml-auto" onClick={() => (last ? done() : setStep(step + 1))}>{last ? 'Brief this flight' : `Next: ${SETUP[step + 1].title}`}<ChevronRight /></Button>
      </div>
    </Card>
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

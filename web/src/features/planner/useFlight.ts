import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useNavigate } from 'react-router'
import { useAircraftList, useFlights, useRegistry } from '@/lib/queries'
import { get } from '@/lib/api'
import { homeAirport, notamBody } from '@/lib/weather'
import type { NotamResponse } from '@/lib/types'
import { computeCurrency } from '@/lib/flying'
import { bboxOf, useAirportProfiles, useAirports, useAirspace, useCorridor, useLandmarks, useMinimums, useNearby, usePlan, usePlanning, usePlans, usePohFind, useRadar, useResolve, useTerrain, useWeather, type SavedPlan } from './api'
import type { NotamSet } from './brief'
import { sampleRoute } from './calc'
import { explainRow, explainWb, inputSources, type Expl } from './explain'
import { DEFAULT_MINIMUMS, applyAirportProfile, derive, isWaypoint, makeResolver, parseRouteItem, type Airport, type Plan, type RowOverride, type Status } from './model'
import type { EditPoint, MapNotams, RouteEdit } from './PlannerMap'
import { applyEdits, profileFor, withSpecs, withTables } from './poh'
import { roleOf } from './pilot'
import { useCrew, type Person } from './profiles'
import { bestInsert, insertAt, removeAt, replaceAt } from './route'
import { readiness, type SectionKey } from './readiness'
import { unitsForTail } from './units'
import { useRefs } from './RefPanel'
import { assumptions, calculations, sources } from './workings'

// Everything one flight needs, fetched and derived in one place: the shell and
// every section read it from FlightContext instead of passing props down.

const pad = (n: number) => String(n).padStart(2, '0')
const nextHourLocal = () => { const d = new Date(Date.now() + 60 * 60_000); d.setMinutes(0, 0, 0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00` }
export const blankPlan = (tail: string | null): Plan => ({
  name: 'New flight', route: [homeAirport()], alternate: null, departLocal: nextHourLocal(), rpm: 2400, tail,
  seats: { pilot: 0, front: 0, rearL: 0, rearR: 0 }, loads: { front: 0, rear: 0, bag1: 0, bag2: 0 }, fuelGal: null, stopMinutes: 30, night: null, actuals: {}, setup: true,
})

// Creating, copying and deleting whole flights; each is its own page (/flying/plan/:id).
export function useFlightActions() {
  const plans = usePlans()
  const nav = useNavigate()
  const { data: flights = [] } = useFlights()
  const recentTail = [...flights].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.aircraft?.tail_number ?? null
  const create = async (p: Plan) => { try { const r = await plans.create.mutateAsync(p); nav(`/flying/plan/${r.id}`) } catch (e) { toast.error((e as Error).message) } }
  return {
    plans,
    newFlight: () => create(blankPlan(recentTail)),
    // A copy keeps the route, aircraft, crew and loading; the time moves to the next hour and the ticks are cleared.
    duplicate: (p: Plan) => create({ ...p, name: `${p.name} (copy)`, departLocal: nextHourLocal(), checklist: {}, actuals: {}, overrides: {}, setup: false }),
    restore: (p: Plan) => create({ ...p, setup: false }),
    remove: async (id: number, then?: () => void) => { try { await plans.remove.mutateAsync(id); toast.success('Flight deleted'); then?.() } catch (e) { toast.error((e as Error).message) } },
    creating: plans.create.isPending,
  }
}

// A flight left in this browser by the single-draft planner (never saved to
// the server): offered on the flights list to keep or discard.
export function legacyDraft(): Plan | null {
  try {
    for (const k of ['planner-draft-v4', 'planner-draft-v3']) {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const d = JSON.parse(raw) as { plan?: Plan; id?: number | null }
      if (d.plan && d.id == null && d.plan.route?.length > 1) return d.plan
    }
  } catch { /* unreadable: nothing to offer */ }
  return null
}
export const clearLegacyDraft = () => { try { localStorage.removeItem('planner-draft-v4'); localStorage.removeItem('planner-draft-v3') } catch { /* private mode */ } }
export const autoName = (p: Plan) => (p.route.length > 1 ? `${parseRouteItem(p.route[0]).id} → ${parseRouteItem(p.route.at(-1)!).id}` : 'New flight')

// What the work sheet explains: a NavLog row (opened at one of its figures), a
// W&B line, or one topic of the workings.
export type Focus = { kind: 'nav'; key: string; card?: string } | { kind: 'wb'; i: number } | { kind: 'topic'; key: string }
export interface FocusView { title: string; subtitle: string; items: Expl[]; card?: string; ov?: RowOverride; onEdit?: (f: keyof RowOverride, v: number | null) => void }

export function useFlightState({ saved, section, setSection }: { saved: SavedPlan; section: SectionKey; setSection: (k: SectionKey) => void }) {
  const { data: flights = [] } = useFlights()
  const { data: fleetRaw = [] } = useAircraftList()
  const recentTail = useMemo(() => [...flights].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.aircraft?.tail_number ?? null, [flights])
  const fleet = useMemo(() => {
    const used = new Map<string, string>()
    for (const f of flights) if (f.aircraft?.tail_number && (!used.has(f.aircraft.tail_number) || String(f.date) > used.get(f.aircraft.tail_number)!)) used.set(f.aircraft.tail_number, String(f.date))
    return [...fleetRaw].sort((a, b) => (used.get(b.tail_number) ?? '').localeCompare(used.get(a.tail_number) ?? '') || a.tail_number.localeCompare(b.tail_number))
  }, [fleetRaw, flights])

  const id = saved.id
  const [plan, setPlan] = useState<Plan>(saved.data)
  const set = (p: Partial<Plan>) => setPlan(x => ({ ...x, ...p }))

  // ── Saving: every change is saved a moment after you stop typing ──
  const planQ = usePlan(id)
  const lastSaved = useRef(JSON.stringify(saved.data))
  const latest = useRef(plan); latest.current = plan
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved')
  const [savedAt, setSavedAt] = useState(saved.updated_at)
  const persist = async (p: Plan) => {
    const named = !p.name.trim() || p.name === 'New flight' ? { ...p, name: autoName(p) } : p
    const j = JSON.stringify(p)
    setSaveState('saving')
    try { const r = await planQ.save.mutateAsync(named); lastSaved.current = j; setSavedAt(r.updated_at); setSaveState(JSON.stringify(latest.current) === j ? 'saved' : 'pending'); if (named.name !== p.name && latest.current.name === p.name) set({ name: named.name }) } catch { setSaveState('error') }
  }
  useEffect(() => {
    if (JSON.stringify(plan) === lastSaved.current) return
    setSaveState('pending')
    const t = setTimeout(() => persist(plan), 800)
    return () => clearTimeout(t)
  }, [plan]) // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the flight (another flight, another page, closing the tab) with a change not yet sent: send it.
  useEffect(() => {
    const flush = () => { if (JSON.stringify(latest.current) !== lastSaved.current) fetch(`/api/planner/plans/${id}`, { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: latest.current.name || 'Flight', data: latest.current }) }).catch(() => {}) }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [id])

  // ── Who's flying: the pilot and instructor profiles loaded into this flight ──
  const crew = useCrew()
  const pilot = crew.list.find(p => p.id === plan.crew?.pilotId) ?? (plan.crew?.pilotId ? null : crew.pilots[0] ?? null)
  const instructor = crew.list.find(p => p.id === plan.crew?.instructorId) ?? null
  // The pilot's weight fills an empty pilot seat.
  useEffect(() => {
    if (pilot?.weightLb && !(plan.seats?.pilot) && !plan.seatPeople?.pilot) set({ seats: { ...(plan.seats ?? { pilot: 0, front: 0, rearL: 0, rearR: 0 }), pilot: pilot.weightLb }, seatPeople: { ...plan.seatPeople, pilot: pilot.id } })
  }, [pilot?.id, pilot?.weightLb, plan.seats?.pilot]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Route and airports ──
  const tokens = useMemo(() => plan.route.map(r => parseRouteItem(r).id), [plan.route])
  // Alternate: yours, or the nearest suitable airport to the destination that
  // isn't on the route and isn't reporting IFR.
  const [autoAlt, setAutoAlt] = useState<string | null>(null)
  const effAlt = plan.alternate === false ? null : plan.alternate ?? autoAlt
  const resolved = useResolve(tokens)
  const points = useMemo(() => resolved.data?.points ?? [], [resolved.data])
  const ids = useMemo(() => {
    const fromRoute = tokens.map(t => { const p = points.find(x => x.token.replace(/\*$/, '') === t); return p ? (p.kind === 'airport' ? p.id : null) : /^[A-Z0-9]{3,4}$/.test(t) ? t : null }).filter(Boolean) as string[]
    return [...new Set([...fromRoute, ...(effAlt ? [effAlt] : [])])]
  }, [tokens, points, effAlt])
  const apts = useAirports(ids, plan.departLocal.slice(0, 10))
  const aptIds = useMemo(() => (apts.data?.airports ?? []).map(a => a.icao || a.id), [apts.data])
  const aptProfiles = useAirportProfiles(aptIds)
  const airports = useMemo(() => (apts.data?.airports ?? []).map(a => applyAirportProfile(a, aptProfiles.data?.[a.icao || a.id])), [apts.data, aptProfiles.data])
  const resolve = useMemo(() => makeResolver(airports, points), [airports, points])
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
  const putLabel = (p: EditPoint) => (p.label ? { ...plan.labels, [p.token]: { name: p.label, kind: p.kind ?? '' } } : plan.labels)
  const edit: RouteEdit = {
    insert: (at, p) => set({ route: insertAt(plan.route, routeIdx[at] ?? plan.route.length - 1, p.token), labels: putLabel(p) }),
    move: (i, p) => set({ route: replaceAt(plan.route, routeIdx[i], p.token), labels: putLabel(p) }),
    remove: i => set({ route: removeAt(plan.route, routeIdx[i]) }),
    rename: (i, name) => {
      const r = plan.route[routeIdx[i]]; if (r == null) return
      const id = parseRouteItem(r).id, labels = { ...plan.labels }
      if (name.trim()) labels[id] = { name: name.trim().slice(0, 40), kind: labels[id]?.kind ?? '' }
      else delete labels[id]
      set({ labels })
    },
    add: p => edit.insert(bestInsert(routePts, p), p),
  }

  // ── Aircraft and pilot ──
  const registry = useRegistry(plan.tail ?? undefined)
  const planningQ = usePlanning(plan.tail)
  const planning = useMemo(() => planningQ.data ?? {}, [planningQ.data])
  const minQ = useMinimums()
  // The Part 61 checks read the loaded pilot's certificate, medical and endorsements.
  const certs = crew.isLoading ? undefined : (pilot?.certs?.certificate ? pilot.certs : null)
  const minimums = useMemo(() => ({ ...DEFAULT_MINIMUMS, ...(minQ.data || {}) }), [minQ.data])
  const fleetRef = fleet.find(a => a.tail_number === plan.tail)
  const edits = planning.profile
  const aircraft = useMemo(() => ({
    make: plan.aircraft?.make || edits?.make || registry.data?.make || fleetRef?.make || null,
    model: plan.aircraft?.model || edits?.model || registry.data?.model || fleetRef?.model || null,
    year: plan.aircraft?.year ?? edits?.year ?? registry.data?.year ?? fleetRef?.year ?? null,
  }), [plan.aircraft, edits, registry.data, fleetRef])
  const pohQ = usePohFind(plan.tail ? { ...aircraft, tail: plan.tail } : null)
  const pohDoc = pohQ.data?.doc
  const match = useMemo(() => (plan.tail ? applyEdits(withSpecs(withTables(profileFor(aircraft.model), pohDoc?.tables, pohDoc?.title), pohDoc?.specs, pohDoc?.title), edits) : null), [plan.tail, aircraft.model, edits, pohDoc])
  const u = useMemo(() => unitsForTail(plan.tail), [plan.tail])
  const currency = useMemo(() => computeCurrency(flights), [flights])

  const destApt = routePts.length >= 2 && !isWaypoint(routePts[routePts.length - 1]) ? routePts[routePts.length - 1] : null
  const nearby = useNearby(destApt ? { lat: destApt.lat, lon: destApt.lon } : null)
  useEffect(() => {
    const onRoute = new Set(routePts.map(a => a.id))
    const cats = new Map((wx.data?.metars.data || []).map(m => [m.icaoId, m.fltCat]))
    const list = (nearby.data || []).filter(a => !onRoute.has(a.id))
    const pick = list.find(a => !/IFR/.test(cats.get(a.icao || '') || '')) ?? list[0]
    setAutoAlt(pick ? pick.icao || pick.id : null)
  }, [nearby.data, routePts, wx.data])

  const loading = ([
    ['route points', resolved.isFetching], ['airports', apts.isFetching], ['aircraft registry', registry.isLoading], ['POH', pohQ.isLoading],
    ['weather', wx.isFetching], ['terrain', terrain.isLoading], ['airspace', airspace.isFetching], ['checkpoints', corridor.isFetching], ['landmarks', landmarks.isFetching],
    ['NOTAMs', notamQs.some(q => q.isLoading)], ['alternates', nearby.isLoading],
  ] as [string, boolean][]).filter(([, v]) => v).map(([n]) => n)
  const failed = ([
    ['route points', resolved.isError, resolved.refetch], ['airports', apts.isError, apts.refetch], ['weather', wx.isError, wx.refetch], ['terrain', terrain.isError, terrain.refetch],
    ['airspace', airspace.isError, airspace.refetch], ['checkpoints', corridor.isError, corridor.refetch], ['landmarks', landmarks.isError, landmarks.refetch], ['POH', pohQ.isError, pohQ.refetch],
  ] as [string, boolean, () => void][]).filter(([, e]) => e).map(([n, , r]) => [n, r] as [string, () => void])
  const planEff = useMemo(() => ({ ...plan, alternate: plan.alternate === false ? false as const : effAlt }), [plan, effAlt])

  const d = useMemo(() => derive(planEff, {
    airports, weather: wx.data ?? null, match, planning, minimums, terrain: terrain.data?.elevations ?? null,
    currency, airspace: airspace.data ?? null, checkpoints: corridor.data ?? [], points, certs,
  }), [planEff, airports, wx.data, match, planning, minimums, terrain.data, currency, airspace.data, corridor.data, points, certs])
  const nightAuto = d.wx.some(w => w.night)
  useEffect(() => { if (plan.night === null && nightAuto) set({ night: true }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [nightAuto])

  // The verdict: any no-go rules it out; open items mean it isn't decided yet.
  const statuses = d.checks.map(c => c.status)
  const verdict: Status = statuses.includes('nogo') ? 'nogo' : statuses.includes('todo') || plan.route.length < 2 ? 'todo' : statuses.includes('caution') ? 'caution' : 'ok'
  const verdictLabel = verdict === 'nogo' ? 'No-go as planned' : verdict === 'caution' ? 'Go with caution' : verdict === 'todo' ? 'Brief incomplete' : 'Ready to fly'
  const role = roleOf(plan.crew, certs)

  // What's still needed for a complete brief and NavLog.
  const tasks = useMemo(() => readiness(d, plan, {
    tail: plan.tail, profileSaved: !!planningQ.data?.updatedAt, checklistSteps: (planning.checklist ?? []).reduce((n, s) => n + s.items.length, 0),
    pohExact: !!pohQ.data?.uploaded || !!(match?.exact && !match.note), inspections: Object.values(planning.inspections ?? {}).some(Boolean),
    certsSaved: !!certs?.certificate, briefed: plan.checklist?.['brief.standard'] === true,
  }), [d, plan, planning, planningQ.data, pohQ.data, match, certs])

  // ── Workings ──
  const pohStatus = pohQ.isLoading ? `Downloading the ${aircraft.model} POH…` : pohQ.data?.uploaded ? `Your upload for ${plan.tail}.` : pohQ.data?.match && !pohQ.data.match.exact ? `${pohQ.data.match.title} is the closest public POH to the ${aircraft.model}.` : null
  const wIn = { d, plan: planEff, minimums, weather: wx.data ?? null, cycle: apts.data?.cycle ?? null, pohNote: pohStatus, altAuto: !d.flights.some(f => f.altSet), altMode: plan.alternate === false ? 'none' as const : plan.alternate ? 'yours' as const : 'auto' as const, certsSaved: !!certs?.certificate, terrainAt: terrain.data?.fetchedAt ?? null, notams: notamSets }
  const topics = useMemo(() => calculations(wIn), [d, planEff, minimums, notamSets]) // eslint-disable-line react-hooks/exhaustive-deps
  const assumed = useMemo(() => assumptions(wIn), [d, planEff, minimums, certs]) // eslint-disable-line react-hooks/exhaustive-deps
  const srcs = useMemo(() => sources(wIn), [d, wx.data, apts.data, pohStatus, terrain.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const xIn = { d, plan: planEff, weather: wx.data ?? null, pohClosest: !!match && !match.exact }
  const inputs = useMemo(() => inputSources(xIn), [d, wx.data, match]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── The work sheet: what's being explained ──
  const refs = useRefs()!
  const [focus, setFocus] = useState<Focus | null>(null)
  const explain = (f: Focus) => { setFocus(f); refs.show('workings') }
  const focusView: FocusView | null = useMemo(() => {
    const f = focus
    if (!f || f.kind === 'topic' || !d.profile) return null
    if (f.kind === 'nav') {
      const r = d.navlog.find(x => x.key === f.key)
      if (!r) return null
      const ov = plan.overrides?.[r.key] ?? {}
      return {
        title: `${r.from} → ${r.to.label}`, subtitle: `${r.phase === 'climb' ? 'Climb' : r.phase === 'descent' ? 'Descent' : 'Cruise'} at ${r.alt} ft · ${r.distNm.toFixed(1)} nm`,
        items: explainRow(xIn, r), card: f.card, ov,
        onEdit: (k, v) => set({ overrides: { ...plan.overrides, [r.key]: { ...ov, [k]: v != null && Number.isFinite(v) ? v : null } } }),
      }
    }
    const st = d.wb.steps[f.i]
    return st ? { title: st.label, subtitle: 'Weight and balance', items: [explainWb(xIn, st, f.i)] } : null
  }, [focus, d, plan.overrides, wx.data, match]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── This flight ──
  const go = (k: SectionKey) => { setSection(k); setFocus(null); window.scrollTo({ top: 0 }) }
  const savePilot = (p: Partial<Person>) => pilot && crew.save({ ...pilot, ...p })
  const savePlanning = (p: typeof planning) => planningQ.save.mutate(p, { onSuccess: () => toast.success(`${plan.tail} saved`), onError: e => toast.error(e.message) })
  const altAirport = effAlt ? airports.find(a => a.icao === effAlt || a.id === effAlt) ?? null : null
  const acName = [aircraft.make && aircraft.make.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), aircraft.model].filter(Boolean).join(' ') || d.profile?.model || 'Aircraft'
  const routeText = plan.route.map(r => { const id = parseRouteItem(r).id; return plan.labels?.[id]?.name ?? id }).join(' → ') || 'No route yet'

  return {
    id, section, setup: !!plan.setup, saveState, savedAt, retrySave: () => persist(plan), plan, planEff, set, d, verdict, verdictLabel, role, tasks, go,
    finishSetup: () => { set({ setup: false }); go('overview') },
    crew, pilot, instructor, savePilot,
    fleet, recentTail, routePts, edit, airports, altAirport, autoAlt, effAlt, notams, notamSets, radar: radar.data, airspace: airspace.data, corridor: corridor.data ?? [], landmarks: landmarks.data ?? null, landmarksLoading: landmarks.isFetching,
    weather: wx.data ?? null, wxQ: wx, cycle: apts.data?.cycle ?? null, nasr: apts.data?.airports ?? [], aptProfiles,
    registry, planningQ, planning, savePlanning, certs, minQ, minimums, aircraft, acName, pohQ, pohDoc, match, u, currency, xIn,
    loading, failed, topics, assumed, srcs, inputs, pohStatus, routeText,
    refs, focus, setFocus, explain, focusView,
  }
}

export type FlightFile = ReturnType<typeof useFlightState>
export const FlightCtx = createContext<FlightFile | null>(null)
export const useFlight = () => useContext(FlightCtx)!

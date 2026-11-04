// Data for the planner: queries against /api/planner/* and the existing
// aviation endpoints, plus the saved plan / per-tail / minimums state.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/lib/api'
import type { AircraftPlanning, Airport, Minimums, Plan, WeatherBundle } from './model'
import type { LatLon } from './calc'

const MIN = 60_000

export const useAirports = (ids: string[], date: string) => useQuery({
  queryKey: ['planner', 'airports', ids.join(','), date], enabled: ids.length > 0, staleTime: 60 * MIN, placeholderData: keepPreviousData,
  queryFn: () => get<{ cycle: string | null; loadedAt: string | null; airports: Airport[] }>(`/api/planner/airports?ids=${ids.join(',')}&date=${date}`),
})

export const useAirportSearch = (q: string) => useQuery({
  queryKey: ['planner', 'search', q], enabled: q.trim().length >= 2, staleTime: 60 * MIN, placeholderData: keepPreviousData,
  queryFn: () => get<{ id: string; icao: string | null; name: string; city: string; state: string; towered: boolean }[]>(`/api/pattern/airports?q=${encodeURIComponent(q.trim())}`),
})

export const useNearby = (p: LatLon | null) => useQuery({
  queryKey: ['planner', 'nearby', p?.lat.toFixed(3), p?.lon.toFixed(3)], enabled: !!p, staleTime: 60 * MIN,
  queryFn: () => get<{ id: string; icao: string | null; name: string; city: string; towered: boolean; distNm: number; wx: { id: string } | null }[]>(`/api/planner/nearby?lat=${p!.lat}&lon=${p!.lon}&radius=40`),
})

export function bboxOf(points: LatLon[], padDeg = 0.6) {
  if (!points.length) return null
  const lats = points.map(p => p.lat), lons = points.map(p => p.lon)
  return { south: Math.min(...lats) - padDeg, north: Math.max(...lats) + padDeg, west: Math.min(...lons) - padDeg * 1.3, east: Math.max(...lons) + padDeg * 1.3 }
}

export const useWeather = (stations: string[], bbox: ReturnType<typeof bboxOf>) => useQuery({
  queryKey: ['planner', 'weather', stations.join(','), bbox && Object.values(bbox).map(v => v.toFixed(1)).join(',')],
  enabled: !!bbox, staleTime: 5 * MIN, refetchInterval: 5 * MIN, placeholderData: keepPreviousData,
  queryFn: () => post<WeatherBundle>('/api/planner/weather', { stations, bbox }),
})

export const useDatis = (icao: string | null, enabled: boolean) => useQuery({
  queryKey: ['planner', 'datis', icao], enabled: !!icao && enabled, staleTime: 2 * MIN, refetchInterval: 5 * MIN, retry: false,
  queryFn: () => get<{ data: { type: string; code: string; text: string; time: string; updatedAt: string }[] | null; fetchedAt: string }>(`/api/planner/datis/${icao}`),
})

export const useTerrain = (samples: LatLon[]) => useQuery({
  queryKey: ['planner', 'terrain', samples.length, samples[0]?.lat, samples.at(-1)?.lon], enabled: samples.length > 1, staleTime: Infinity, retry: 1,
  queryFn: () => post<{ elevations: number[]; fetchedAt: string; source: string }>('/api/planner/terrain', { points: samples.map(s => [s.lat, s.lon]) }),
})

export const useAirspace = () => useQuery({
  queryKey: ['planner', 'airspace'], staleTime: Infinity,
  queryFn: () => get<{ features: NonNullable<import('./model').Inputs['airspace']> }>('/api/external/faa-airspace').then(d => d.features).catch(() => null),
})

export function usePlanning(tail: string | null) {
  const qc = useQueryClient()
  const key = ['planner', 'aircraft', tail]
  const q = useQuery({ queryKey: key, enabled: !!tail, staleTime: Infinity, queryFn: () => get<AircraftPlanning>(`/api/planner/aircraft/${tail}`) })
  const save = useMutation({ mutationFn: (data: AircraftPlanning) => put<AircraftPlanning>(`/api/planner/aircraft/${tail}`, data), onSuccess: d => qc.setQueryData(key, d) })
  return { ...q, save }
}

export function useMinimums() {
  const qc = useQueryClient()
  const key = ['planner', 'settings', 'minimums']
  const q = useQuery({ queryKey: key, staleTime: Infinity, queryFn: () => get<Partial<Minimums> & { updatedAt?: string }>('/api/planner/settings/minimums') })
  const save = useMutation({ mutationFn: (m: Minimums) => put<Minimums>('/api/planner/settings/minimums', m), onSuccess: d => qc.setQueryData(key, d) })
  return { ...q, save }
}

export interface SavedPlan { id: number; name: string; data: Plan; updated_at: string }
export function usePlans() {
  const qc = useQueryClient()
  const key = ['planner', 'plans']
  const q = useQuery({ queryKey: key, staleTime: 5 * MIN, queryFn: () => get<SavedPlan[]>('/api/planner/plans') })
  const create = useMutation({ mutationFn: (p: Plan) => post<SavedPlan>('/api/planner/plans', { name: p.name, data: p }), onSuccess: () => qc.invalidateQueries({ queryKey: key }) })
  const update = useMutation({ mutationFn: ({ id, plan }: { id: number; plan: Plan }) => put<SavedPlan>(`/api/planner/plans/${id}`, { name: plan.name, data: plan }), onSuccess: () => qc.invalidateQueries({ queryKey: key }) })
  const remove = useMutation({ mutationFn: (id: number) => del(`/api/planner/plans/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: key }) })
  return { ...q, create, update, remove }
}

export const useCorridor = (bbox: ReturnType<typeof bboxOf>) => useQuery({
  queryKey: ['planner', 'corridor', bbox && Object.values(bbox).map(v => v.toFixed(2)).join(',')], enabled: !!bbox, staleTime: Infinity,
  queryFn: () => get<import('./model').Checkpoint[]>(`/api/planner/corridor?south=${bbox!.south}&west=${bbox!.west}&north=${bbox!.north}&east=${bbox!.east}`),
})

export interface PlannerDoc { id: number; kind: 'poh' | 'briefing' | 'other'; title: string; model: string | null; tail_number: string | null; route: string[] | null; filename: string | null; size: number; page_map: Record<string, number> | null; source: string; created_at: string }
export function useDocuments() {
  const qc = useQueryClient()
  const key = ['planner', 'documents']
  const q = useQuery({ queryKey: key, staleTime: 5 * MIN, queryFn: () => get<PlannerDoc[]>('/api/planner/documents') })
  const upload = useMutation({
    mutationFn: async ({ file, kind, model, route }: { file: File; kind: PlannerDoc['kind']; model?: string; route?: string }) => {
      const qs = new URLSearchParams({ kind, title: file.name.replace(/\.pdf$/i, ''), filename: file.name, ...(model ? { model } : {}), ...(route ? { route } : {}) })
      const r = await fetch(`/api/planner/documents?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file, credentials: 'same-origin' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Upload failed (${r.status})`)
      return r.json() as Promise<PlannerDoc>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })
  const importBriefings = useMutation({ mutationFn: () => post<{ added: number }>('/api/planner/briefings/import'), onSuccess: () => qc.invalidateQueries({ queryKey: key }) })
  const remove = useMutation({ mutationFn: (id: number) => del(`/api/planner/documents/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: key }) })
  return { ...q, upload, importBriefings, remove }
}

// Route tokens → points (airports, navaids, fixes, VFR waypoints, radial/DME, coordinates).
export const useResolve = (tokens: string[]) => useQuery({
  queryKey: ['planner', 'resolve', tokens.join(' ')], enabled: tokens.length > 0, staleTime: 60 * MIN, placeholderData: keepPreviousData,
  queryFn: () => post<{ cycle: string | null; points: import('./model').RoutePoint[] }>('/api/planner/resolve', { tokens }),
})

export interface PohMatch { key: string; title: string; variant: string; years: [number, number]; profile: string | null; url: string; units: string; exact: boolean; sameYears?: boolean }
// The closest public POH for the aircraft; the server downloads it once and keeps it.
export const usePohFind = (a: { make?: string | null; model?: string | null; year?: number | null } | null) => {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['planner', 'poh-find', a?.make, a?.model, a?.year], enabled: !!a?.model, staleTime: Infinity, retry: 1,
    queryFn: async () => {
      const r = await post<{ match: PohMatch | null; doc: PlannerDoc | null }>('/api/planner/poh/find', a)
      if (r.doc) qc.invalidateQueries({ queryKey: ['planner', 'documents'] })
      return r
    },
  })
}

export const useRadar = () => useQuery({
  queryKey: ['planner', 'radar'], staleTime: 2 * MIN, refetchInterval: 5 * MIN,
  queryFn: () => get<{ valid: string | null; fetchedAt: string; tiles: string; error?: string }>('/api/planner/radar'),
})

export interface PilotInfo { name?: string; phone?: string; address?: string; base?: string; updatedAt?: string }
export function usePilotInfo() {
  const qc = useQueryClient()
  const key = ['planner', 'settings', 'pilot']
  const q = useQuery({ queryKey: key, staleTime: Infinity, queryFn: () => get<PilotInfo>('/api/planner/settings/pilot') })
  const save = useMutation({ mutationFn: (p: PilotInfo) => put<PilotInfo>('/api/planner/settings/pilot', p), onSuccess: d => qc.setQueryData(key, d) })
  return { ...q, save }
}

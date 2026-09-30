import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { get } from './api'
import type {
  Activity, ActivityDetail, ActivityGpx, AircraftRegistry, AirportDetail, AirportInfo, Athlete, ChessStats, DailyStats,
  Flight, Holding, Instructor, LogbookStats, Metar, NetWorth, NiceAirSchedule, NotamResponse, PlaidItem,
  SleepLatest, SleepTrendRow, Taf, TrackPoint, TrackStats, AircraftRef,
} from './types'

const MIN = 60_000
const soft = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback)

export const qk = {
  flights: ['flights'] as const,
  logbook: ['stats', 'logbook'] as const,
  netWorth: (days: number) => ['finance', 'net-worth', days] as const,
}

// ── Garmin (each call reads Garmin live; keep them cached for the session) ───
export const useAthlete = () => useQuery({ queryKey: ['athlete'], queryFn: () => get<Athlete>('/api/athlete'), staleTime: 30 * MIN })
export const useActivities = () => useQuery({
  queryKey: ['activities'], staleTime: 10 * MIN,
  queryFn: async () => { const d = await get<Activity[]>('/api/activities?limit=200'); return Array.isArray(d) ? d : [] },
})
export const useDaily = () => useQuery({ queryKey: ['stats', 'daily'], queryFn: () => get<DailyStats>('/api/stats/daily'), staleTime: 10 * MIN })
export const useActivityDetail = (id?: string) => useQuery({ queryKey: ['activity', id], enabled: !!id, queryFn: () => get<ActivityDetail>(`/api/activities/${id}`), staleTime: 60 * MIN })
export const useActivityGpx = (id?: string, enabled = true) => useQuery({
  queryKey: ['activity', id, 'gpx'], enabled: !!id && enabled, staleTime: 60 * MIN, retry: false,
  queryFn: () => soft(get<ActivityGpx>(`/api/activities/${id}/gpx`), null),
})
export const useSleepLatest = () => useQuery({ queryKey: ['sleep', 'latest'], queryFn: () => soft(get<SleepLatest>('/api/sleep/latest'), null), staleTime: 10 * MIN })
export const useSleepTrend = (days = 30) => useQuery({
  queryKey: ['sleep', 'trend', days], staleTime: 10 * MIN,
  queryFn: async () => (await soft(get<{ trend: SleepTrendRow[] }>(`/api/sleep/trend?days=${days}`), { trend: [] })).trend || [],
})

// ── Flying ───────────────────────────────────────────────────────────────────
export const useFlights = () => useQuery({ queryKey: qk.flights, queryFn: () => get<Flight[]>('/api/flights'), staleTime: 5 * MIN })
export const useLogbookStats = () => useQuery({ queryKey: qk.logbook, queryFn: () => get<LogbookStats>('/api/stats/logbook'), staleTime: 5 * MIN })
export const useAircraftList = () => useQuery({ queryKey: ['aircraft'], queryFn: () => get<AircraftRef[]>('/api/aircraft'), staleTime: 10 * MIN })
export const useInstructors = () => useQuery({ queryKey: ['instructors'], queryFn: () => get<Instructor[]>('/api/instructors'), staleTime: 10 * MIN })
export const useTrack = (id?: number, enabled = true) => useQuery({
  queryKey: ['track', id], enabled: !!id && enabled, staleTime: Infinity,
  queryFn: () => soft(get<TrackPoint[]>(`/api/flights/${id}/track`), [] as TrackPoint[]),
})
export const useTrackStats = (id?: number, enabled = true) => useQuery({
  queryKey: ['track-stats', id], enabled: !!id && enabled, staleTime: Infinity,
  queryFn: () => soft(get<TrackStats>(`/api/flights/${id}/track-stats`), null),
})
export const useRegistry = (tail?: string) => useQuery({
  queryKey: ['registry', tail], enabled: !!tail, staleTime: Infinity, retry: false,
  queryFn: () => soft(get<AircraftRegistry>(`/api/external/aircraft/${encodeURIComponent((tail || '').replace(/^N/i, ''))}`), null),
})
export const useNiceAir = () => useQuery({
  queryKey: ['nice-air'], staleTime: 30 * MIN,
  queryFn: async () => (await soft(get<{ schedules: NiceAirSchedule[] }>('/api/gmail/nice-air'), { schedules: [] })).schedules || [],
})
export const useHistoricMetar = (icao?: string, time?: string) => useQuery({
  queryKey: ['metar-at', icao, time], enabled: !!icao && !!time, staleTime: Infinity, retry: false,
  queryFn: () => soft(get<{ metar: string; valid?: string }>(`/api/metar?station=${encodeURIComponent(icao!)}&time=${encodeURIComponent(time!)}`), null),
})

// ── Airport weather ──────────────────────────────────────────────────────────
export const useMetar = (icao: string) => useQuery({ queryKey: ['wx', 'metar', icao], queryFn: () => soft(get<{ metar: Metar | null }>(`/api/external/metar/${icao}`).then(d => d.metar), null), staleTime: 5 * MIN, placeholderData: keepPreviousData })
export const useAirportInfo = (icao: string) => useQuery({ queryKey: ['wx', 'airport', icao], queryFn: () => soft(get<AirportInfo>(`/api/external/airport/${icao}`), null), staleTime: 60 * MIN })
export const useAirportDetail = (icao: string) => useQuery({ queryKey: ['wx', 'detail', icao], queryFn: () => soft(get<AirportDetail>(`/api/external/airport-detail/${icao}`), { runways: [], frequencies: [] }), staleTime: 60 * MIN })
export const useTaf = (icao: string) => useQuery({ queryKey: ['wx', 'taf', icao], queryFn: () => soft(get<{ taf: Taf | null }>(`/api/external/taf/${icao}`).then(d => d.taf), null), staleTime: 15 * MIN })
export const useNotams = (icao: string) => useQuery({ queryKey: ['wx', 'notam', icao], queryFn: () => soft(get<NotamResponse>(`/api/external/notam/${icao}`), { count: 0, notams: [], unavailable: true }), staleTime: 30 * MIN })

// ── Money ────────────────────────────────────────────────────────────────────
export const useNetWorth = (days = 30) => useQuery({ queryKey: qk.netWorth(days), queryFn: () => soft(get<NetWorth>(`/api/finance/net-worth?days=${days}`), null), staleTime: 5 * MIN, placeholderData: keepPreviousData })
export const useHoldings = () => useQuery({ queryKey: ['finance', 'holdings'], queryFn: () => soft(get<Holding[]>('/api/finance/holdings'), []), staleTime: 5 * MIN })
export const usePlaidItems = () => useQuery({ queryKey: ['finance', 'items'], queryFn: () => soft(get<PlaidItem[]>('/api/finance/items'), null), staleTime: 5 * MIN })
export const useYtd = (tickers: string[]) => useQuery({
  queryKey: ['finance', 'ytd', tickers.join(',')], enabled: tickers.length > 0, staleTime: 60 * MIN,
  queryFn: () => soft(get<Record<string, { ytd?: number | null }>>(`/api/finance/ytd-prices?tickers=${encodeURIComponent(tickers.join(','))}`), {}),
})

// ── Chess ────────────────────────────────────────────────────────────────────
export const useChess = () => useQuery({ queryKey: ['chess'], queryFn: () => get<ChessStats>('/api/chess/stats'), staleTime: 30 * MIN, retry: 1 })

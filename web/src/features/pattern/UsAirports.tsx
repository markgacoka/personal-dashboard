import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CloudSun, Globe2, RefreshCw, Search, Shuffle } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/misc'
import { get, post } from '@/lib/api'
import { homeAirport, notamBody } from '@/lib/weather'
import { generateConditions, liveConditions, makeArrival, type AwcMetar, type Conditions } from './generate'
import { ident, titleCase, type NasrAirport, type NasrSummary } from './nasr'

export interface Filters { scope: 'public' | 'all'; tower: 'any' | 'yes' | 'no'; near: '0' | '150' | '400'; state: string; wx: 'live' | 'generated' }
const DEFAULT_FILTERS: Filters = { scope: 'public', tower: 'any', near: '0', state: '', wx: 'live' }

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d } catch { return d } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* per-browser only */ } }
export const visited = (): Record<string, { score: number; total: number; at: string }> => read('pattern-visited', {})
export function markVisited(id: string, score: number, total: number) { write('pattern-visited', { ...visited(), [id]: { score, total, at: new Date().toISOString() } }) }

interface Status { cycle: string | null; airports: number; public: number; suitable: number; refreshing: boolean }

export async function randomAirport(f: Filters): Promise<NasrAirport> {
  const q = new URLSearchParams({ public: f.scope === 'public' ? '1' : '0', towered: f.tower, exclude: Object.keys(visited()).slice(-400).join(',') })
  if (/^[A-Z]{2}$/.test(f.state)) q.set('state', f.state)
  if (f.near !== '0') {
    const home = await get<NasrAirport>(`/api/pattern/airport/${homeAirport()}`).catch(() => null)
    if (home) { q.set('lat', String(home.lat)); q.set('lon', String(home.lon)); q.set('radius', f.near) }
  }
  return get<NasrAirport>(`/api/pattern/random?${q}`)
}

export function AnyAirportCard() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [f, setF] = useState<Filters>(() => read('pattern-filters', DEFAULT_FILTERS))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t) }, [q])
  const status = useQuery({ queryKey: ['pattern', 'status'], queryFn: () => get<Status>('/api/pattern/status'), refetchInterval: s => (s.state.data?.airports ? false : 10_000) })
  const results = useQuery({ queryKey: ['pattern', 'search', debounced], queryFn: () => get<NasrSummary[]>(`/api/pattern/airports?q=${encodeURIComponent(debounced)}`), enabled: debounced.length >= 2 })
  const set = (p: Partial<Filters>) => { const n = { ...f, ...p }; setF(n); write('pattern-filters', n) }
  const done = Object.keys(visited()).length
  const go = (id: string) => navigate(`/flying/pattern/us/${id}?wx=${f.wx}`)
  const surprise = async () => {
    setBusy(true); setErr(null)
    try { go((await randomAirport(f)).id) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const s = status.data

  return (
    <Card className="md:col-span-2 2xl:col-span-3 3xl:col-span-4">
      <CardHeader icon={<Globe2 />} title="Any US airport"
        description={s?.airports ? `${s.suitable.toLocaleString()} airports a 172 can use, from ${s.airports.toLocaleString()} in the FAA’s NASR data (cycle ${s.cycle}). Real runways, traffic directions, pattern altitudes, frequencies and remarks; ${f.wx === 'live' ? 'live METAR and NOTAMs' : 'generated weather'}.` : 'The FAA airport data is loading on the server.'}
        action={done > 0 && <Badge tone="accent">{done} practised</Badge>} />
      <CardBody>
        {!s?.airports && !status.isLoading ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-fg-2">
            <span>{s?.refreshing ? 'Downloading this cycle’s NASR subscription from the FAA (about a minute)…' : 'No FAA data loaded yet.'}</span>
            {!s?.refreshing && <Button size="sm" onClick={() => post('/api/pattern/refresh').finally(() => status.refetch())}><RefreshCw />Load it now</Button>}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-medium text-fg-2">Find an airport</div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Identifier, name or city (e.g. KSEE, Bend, Truckee)" className="pl-8" aria-label="Search airports" />
              </div>
              <ul className="mt-2 divide-y divide-border">
                {results.isFetching && !results.data ? [0, 1, 2].map(i => <li key={i} className="py-2"><Skeleton className="h-9" /></li>) :
                  (results.data || []).slice(0, 8).map(a => (
                    <li key={a.id}>
                      <button onClick={() => go(a.id)} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-hover">
                        <span className="num w-12 shrink-0 font-semibold">{ident(a)}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm text-fg">{titleCase(a.name)}</span><span className="block text-xs text-fg-3">{titleCase(a.city)}, {a.state}</span></span>
                        {a.towered && <Badge>Towered</Badge>}
                        {!a.public && <Badge tone="warn">Private</Badge>}
                        {!a.suitable && <Badge tone="bad">No 172 runway</Badge>}
                      </button>
                    </li>
                  ))}
                {debounced.length >= 2 && results.data?.length === 0 && <li className="py-3 text-sm text-fg-3">No airport matches “{debounced}”.</li>}
              </ul>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-fg-2">Or practise somewhere you’ve never been</div>
              <div className="space-y-3 text-sm">
                <Row label="Airports"><Segmented size="sm" value={f.scope} onChange={v => set({ scope: v })} options={[{ value: 'public', label: 'Public use' }, { value: 'all', label: 'Include private' }]} /></Row>
                <Row label="Tower"><Segmented size="sm" value={f.tower} onChange={v => set({ tower: v })} options={[{ value: 'any', label: 'Any' }, { value: 'yes', label: 'Towered' }, { value: 'no', label: 'Non-towered' }]} /></Row>
                <Row label="Where"><Segmented size="sm" value={f.near} onChange={v => set({ near: v })} options={[{ value: '0', label: 'Anywhere' }, { value: '150', label: `≤150 nm of ${homeAirport()}` }, { value: '400', label: '≤400 nm' }]} /></Row>
                <Row label="State"><Input value={f.state} onChange={e => set({ state: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) })} placeholder="Any" className="num h-8 w-20 uppercase" aria-label="State" /></Row>
                <Row label="Weather"><Segmented size="sm" value={f.wx} onChange={v => set({ wx: v })} options={[{ value: 'live', label: 'Live METAR + NOTAMs' }, { value: 'generated', label: 'Generated' }]} /></Row>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <Button variant="primary" onClick={surprise} loading={busy}><Shuffle />Surprise me</Button>
                {err && <span className="text-sm text-bad">{err}</span>}
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-fg-3">{label}</span>{children}</div>
}

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

// Live conditions: the field's METAR, else its nearest reporting station; NOTAMs when they come back in time.
async function loadConditions(rec: NasrAirport, mode: 'live' | 'generated'): Promise<Conditions> {
  if (mode === 'generated') return generateConditions(rec, Math.random)
  const kPrefix = (x: string) => (/^[A-Z]{3}$/.test(x) && !['AK', 'HI'].includes(rec.state) ? `K${x}` : x)
  const stations = [...new Set([rec.icao, rec.wx ? kPrefix(rec.wx.id) : null].filter(Boolean) as string[])]
  const [metar, notams] = await Promise.all([
    (async () => {
      for (const st of stations) {
        const m = await get<{ metar: AwcMetar | null }>(`/api/external/metar/${st}`).catch(() => null)
        if (m?.metar?.rawOb) return { m: m.metar, st }
      }
      return null
    })(),
    rec.icao ? withTimeout(get<{ notams: { text?: string }[] }>(`/api/external/notam/${rec.icao}`), 25_000).then(d => d.notams.map(n => notamBody(n.text).replace(/^!\S+\s+\S+\s+\S+\s+/, '').trim()).filter(Boolean)).catch(() => []) : Promise.resolve([] as string[]),
  ])
  const localHour = (new Date().getUTCHours() + Math.round(rec.lon / 15) + 24) % 24
  if (!metar) return { ...generateConditions(rec, Math.random), notams, localHour }
  return liveConditions(rec, metar.m, metar.st, notams, localHour, Math.random)
}

export function useUsScenario(id: string) {
  const [params] = useSearchParams()
  const mode = params.get('wx') === 'generated' ? 'generated' : 'live'
  const [round, setRound] = useState(0)
  const rec = useQuery({ queryKey: ['pattern', 'airport', id], queryFn: () => get<NasrAirport>(`/api/pattern/airport/${id}`), staleTime: Infinity, retry: false })
  const cond = useQuery({ queryKey: ['pattern', 'cond', id, mode, round], queryFn: () => loadConditions(rec.data!, mode), enabled: !!rec.data, staleTime: Infinity, gcTime: 0 })
  const sc = useMemo(() => (rec.data && cond.data ? makeArrival(rec.data, cond.data) : null), [rec.data, cond.data])
  return { rec, cond, sc, mode, again: () => setRound(r => r + 1) }
}

export function UsLoading({ id, rec, mode, error }: { id: string; rec?: NasrAirport; mode: string; error?: string }) {
  return (
    <Card>
      {error ? <EmptyState icon={Globe2} title={`Couldn’t load ${id}`}>{error}</EmptyState> : (
        <EmptyState icon={CloudSun} title={rec ? `${titleCase(rec.name)} (${ident(rec)})` : `Loading ${id} from the FAA data…`}>
          {mode === 'live' ? 'Fetching the live METAR and today’s NOTAMs. NOTAMs can take up to 25 seconds.' : 'Generating the conditions.'}
        </EmptyState>
      )}
    </Card>
  )
}

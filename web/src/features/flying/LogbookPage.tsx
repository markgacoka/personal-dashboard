import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BookOpen, Check, MapPin, MoreHorizontal, Pencil, Plus, Route as RouteIcon, Search, Trash2, ExternalLink, Target } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { EmptyState, Progress, Segmented, Skeleton, Tooltip as Tip } from '@/components/ui/misc'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm } from '@/components/ui/overlay'
import { PageHeader, Stat } from '@/components/data/stat'
import { axisProps, cursorBand, gridProps, Legend, makeTip } from '@/components/data/chart'
import { MapView, fitTo, mapColor, maplibregl } from '@/components/data/MapView'
import { useFlights, useLogbookStats, qk } from '@/lib/queries'
import { del } from '@/lib/api'
import { calDate, hours } from '@/lib/format'
import { isDual, isNight, isSolo, isXC, pplProgress, route, trainingLabel } from '@/lib/flying'
import { num, cn } from '@/lib/utils'
import type { Flight } from '@/lib/types'
import { FlightFormDialog } from './FlightForm'

type Filter = 'all' | 'solo' | 'dual' | 'night' | 'xc'
const FILTERS: Record<Filter, (f: Flight) => boolean> = { all: () => true, solo: isSolo, dual: isDual, night: isNight, xc: isXC }

export function useDeleteFlight() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const m = useMutation({
    mutationFn: (id: number) => del(`/api/flights/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.flights }); qc.invalidateQueries({ queryKey: qk.logbook }); toast.success('Flight deleted') },
    onError: (e: Error) => toast.error(e.message),
  })
  return async (f: Flight) => {
    const ok = await confirm({ title: 'Delete this flight?', body: <>The {calDate(f.date, { month: 'long', day: 'numeric', year: 'numeric' })} flight <span className="num">{route(f).join(' → ')}</span> and its GPS track are removed from the logbook. This can’t be undone.</>, confirm: 'Delete flight', danger: true })
    if (ok) await m.mutateAsync(f.id)
    return ok
  }
}

export default function LogbookPage() {
  const { data: flights, isLoading, isError } = useFlights()
  const { data: stats } = useLogbookStats()
  const [params, setParams] = useSearchParams()
  const formOpen = params.get('log') === '1'
  const setFormOpen = (o: boolean) => setParams(p => { if (o) p.set('log', '1'); else p.delete('log'); return p }, { replace: true })
  const all = flights || []

  if (isError) return <EmptyState icon={BookOpen} title="The logbook is unavailable" className="py-24">The database didn’t respond.</EmptyState>

  return (
    <div>
      <PageHeader title="Logbook" description={stats ? `${stats.total_flights} flights · ${num(stats.total_hours).toFixed(1)} hours · private pilot training` : 'Loading…'}
        actions={<Button variant="primary" onClick={() => setFormOpen(true)}><Plus />Log flight</Button>} />

      <div className="grid gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardBody className="grid grid-cols-2 gap-x-6 gap-y-6 pt-5 sm:grid-cols-3 lg:grid-cols-6">
            {!stats ? <Skeleton className="col-span-full h-20" /> : <>
              <Stat label="Total time" value={num(stats.total_hours).toFixed(1)} unit="h" size="lg" sub={`${stats.total_flights} flights`} />
              <Stat label="Dual received" value={hours(stats.dual_received) ?? '0.0'} unit="h" size="lg" sub={num(stats.dual_given) ? `${hours(stats.dual_given)}h given` : undefined} />
              <Stat label="Solo" value={hours(stats.solo) ?? '0.0'} unit="h" size="lg" sub={num(stats.pic) > num(stats.solo) ? `${hours(stats.pic)}h PIC` : undefined} />
              <Stat label="Cross-country" value={hours(stats.cross_country) ?? '0.0'} unit="h" size="lg" sub={`${stats.airports_visited} airports`} />
              <Stat label="Night" value={hours(stats.night) ?? '0.0'} unit="h" size="lg" sub={stats.night_landings ? `${stats.night_landings} landings` : undefined} />
              <Stat label="Instrument" value={(num(stats.actual_instrument) + num(stats.simulated_instrument)).toFixed(1)} unit="h" size="lg" sub={`${hours(stats.actual_instrument) ?? '0.0'}h actual`} />
            </>}
          </CardBody>
          <div className="border-t border-border px-5 pb-5 pt-4">
            <div className="mb-3 text-sm font-medium text-fg-2">Hours by month</div>
            {isLoading ? <Skeleton className="h-44" /> : <MonthlyHours flights={all} />}
          </div>
        </Card>
        <PplCard flights={all} loading={isLoading} className="xl:col-span-4" />
      </div>

      <Card className="mt-5 overflow-hidden">
        <CardHeader icon={<RouteIcon />} title="Where you’ve flown" description="Every airport in the logbook, connected by the routes flown" />
        {isLoading ? <Skeleton className="h-[360px] rounded-none" /> : all.length ? <RoutesMap flights={all} /> : <p className="border-t border-border px-5 py-10 text-center text-sm text-fg-3">Airports appear here once flights are logged.</p>}
      </Card>

      <FlightTable flights={all} loading={isLoading} />
      <FlightFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  )
}

function PplCard({ flights, loading, className }: { flights: Flight[]; loading: boolean; className?: string }) {
  const reqs = useMemo(() => pplProgress(flights), [flights])
  const met = reqs.filter(r => r.have >= r.need).length
  return (
    <Card className={className}>
      <CardHeader icon={<Target />} title="Private pilot minimums" description="14 CFR 61.109(a), from logbook totals" action={!loading && <Badge tone={met === reqs.length ? 'good' : 'neutral'} size="md">{met}/{reqs.length} met</Badge>} />
      <CardBody className="space-y-3.5">
        {loading ? <Skeleton className="h-72" /> : reqs.map(r => {
          const done = r.have >= r.need
          return (
            <div key={r.label}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                <span className={cn('flex items-center gap-1.5', done ? 'text-fg' : 'text-fg-2')}>{done && <Check className="size-3.5 text-good" />}{r.label}</span>
                <span className="num text-fg-3"><span className={done ? 'text-fg' : 'text-fg-2'}>{r.unit ? r.have.toFixed(1) : r.have}</span> / {r.need}{r.unit}</span>
              </div>
              <Progress value={(r.have / r.need) * 100} tone={done ? 'good' : 'accent'} />
            </div>
          )
        })}
        {!loading && <p className="pt-1 text-xs text-fg-3">Dual and solo cross-country are the cross-country hours on dual and solo flights. The 150 nm solo cross-country, towered-airport landings and checkride prep aren’t tracked here.</p>}
      </CardBody>
    </Card>
  )
}

function MonthlyHours({ flights }: { flights: Flight[] }) {
  const data = useMemo(() => {
    if (!flights.length) return []
    const keys = flights.map(f => f.date.slice(0, 7)).sort()
    const [y0, m0] = keys[0].split('-').map(Number), [y1, m1] = keys[keys.length - 1].split('-').map(Number)
    const rows: { month: string; dual: number; solo: number; other: number }[] = []
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) rows.push({ month: `${y}-${String(m).padStart(2, '0')}`, dual: 0, solo: 0, other: 0 })
    const idx = new Map(rows.map((r, i) => [r.month, i]))
    for (const f of flights) {
      const r = rows[idx.get(f.date.slice(0, 7))!]
      const tot = num(f.total_duration), dual = num(f.dual_received), solo = num(f.solo)
      r.dual += dual; r.solo += solo; r.other += Math.max(0, tot - dual - solo)
    }
    return rows.map(r => ({ ...r, dual: +r.dual.toFixed(1), solo: +r.solo.toFixed(1), other: +r.other.toFixed(1) }))
  }, [flights])
  const series = [{ k: 'dual', label: 'Dual', color: 'var(--c1)' }, { k: 'solo', label: 'Solo', color: 'var(--c3)' }, { k: 'other', label: 'Other', color: 'var(--c7)' }].filter(s => data.some(d => (d as Record<string, number | string>)[s.k] as number > 0))
  const mlabel = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  const T = makeTip<Record<string, number | string>>({
    title: r => new Date(r.month + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    rows: r => series.filter(s => (r[s.k] as number) > 0).map(s => ({ color: s.color, label: s.label, value: `${(r[s.k] as number).toFixed(1)}h` })),
    footer: r => `Total ${series.reduce((a, s) => a + (r[s.k] as number), 0).toFixed(1)}h`,
  })
  if (!data.length) return <p className="py-8 text-center text-sm text-fg-3">No flights yet</p>
  return (
    <div>
      <div className="h-44"><ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="month" {...axisProps} tickFormatter={mlabel} />
          <YAxis {...axisProps} width={44} tickFormatter={v => `${v}h`} />
          <Tooltip content={T} cursor={cursorBand} />
          {series.map((s, i) => <Bar key={s.k} dataKey={s.k} name={s.label} stackId="m" fill={s.color} stroke="var(--card)" strokeWidth={1} maxBarSize={24} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer></div>
      <Legend className="mt-2" items={series.map(s => ({ label: s.label, color: s.color }))} />
    </div>
  )
}

function RoutesMap({ flights }: { flights: Flight[] }) {
  const navigate = useNavigate()
  return (
    <MapView className="h-[360px] border-t border-border" onLoad={map => {
      const apts = new Map<string, { icao: string; name?: string; lon: number; lat: number; n: number }>()
      const legs = new Map<string, { a: [number, number]; b: [number, number]; n: number }>()
      for (const f of flights) {
        const stops = [f.departure, ...(f.via_airports || []), f.arrival].filter(a => a?.lon != null && a?.lat != null)
        stops.forEach(a => { const e = apts.get(a.icao); if (e) e.n++; else apts.set(a.icao, { icao: a.icao, name: a.name, lon: a.lon!, lat: a.lat!, n: 1 }) })
        for (let i = 1; i < stops.length; i++) {
          if (stops[i].icao === stops[i - 1].icao) continue
          const k = [stops[i - 1].icao, stops[i].icao].sort().join('-')
          const e = legs.get(k)
          if (e) e.n++; else legs.set(k, { a: [stops[i - 1].lon!, stops[i - 1].lat!], b: [stops[i].lon!, stops[i].lat!], n: 1 })
        }
      }
      const accent = mapColor('--accent')
      map.addSource('legs', { type: 'geojson', data: { type: 'FeatureCollection', features: [...legs.values()].map(l => ({ type: 'Feature', properties: { n: l.n }, geometry: { type: 'LineString', coordinates: [l.a, l.b] } })) } })
      map.addLayer({ id: 'legs', type: 'line', source: 'legs', layout: { 'line-cap': 'round' }, paint: { 'line-color': accent, 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['get', 'n'], 1, 1.5, 10, 4] } })
      map.addSource('apts', { type: 'geojson', data: { type: 'FeatureCollection', features: [...apts.values()].map(a => ({ type: 'Feature', properties: { icao: a.icao, name: a.name || '', n: a.n }, geometry: { type: 'Point', coordinates: [a.lon, a.lat] } })) } })
      map.addLayer({ id: 'apts', type: 'circle', source: 'apts', paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 1, 4, 30, 9], 'circle-color': accent, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
      map.addLayer({ id: 'apt-labels', type: 'symbol', source: 'apts', layout: { 'text-field': ['get', 'icao'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold', 'Noto Sans Regular'] }, paint: { 'text-color': mapColor('--fg'), 'text-halo-color': mapColor('--card'), 'text-halo-width': 1.5 } })
      const popup = new maplibregl.Popup({ closeButton: false, offset: 10 })
      map.on('mouseenter', 'apts', e => {
        map.getCanvas().style.cursor = 'pointer'
        const p = e.features?.[0]?.properties as { icao: string; name: string; n: number }
        popup.setLngLat(e.lngLat).setHTML(`<div style="font-weight:600;font-family:var(--font-mono)">${p.icao}</div><div style="font-size:12px;color:var(--fg-3)">${p.name}</div><div style="font-size:12px;margin-top:2px">${p.n} visit${p.n === 1 ? '' : 's'}</div>`).addTo(map)
      })
      map.on('mouseleave', 'apts', () => { map.getCanvas().style.cursor = ''; popup.remove() })
      map.on('click', 'apts', e => {
        const icao = (e.features?.[0]?.properties as { icao: string }).icao
        const f = flights.find(fl => route(fl).includes(icao))
        if (f) navigate(`/flying/${f.id}`)
      })
      fitTo(map, [...apts.values()].map(a => [a.lon, a.lat]), 48, 10)
    }} />
  )
}

function FlightTable({ flights, loading }: { flights: Flight[]; loading: boolean }) {
  const navigate = useNavigate()
  const remove = useDeleteFlight()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(25)
  const [editing, setEditing] = useState<Flight | null>(null)

  const rows = useMemo(() => flights.filter(FILTERS[filter]).filter(f => {
    if (!q) return true
    const hay = `${route(f).join(' ')} ${f.aircraft?.tail_number} ${f.aircraft?.make} ${f.aircraft?.model} ${trainingLabel(f.training_type)} ${f.instructor_name || ''} ${f.remarks || ''}`.toLowerCase()
    return hay.includes(q.toLowerCase())
  }), [flights, filter, q])
  const counts = useMemo(() => Object.fromEntries((Object.keys(FILTERS) as Filter[]).map(k => [k, flights.filter(FILTERS[k]).length])), [flights])
  const page = rows.slice(0, shown)
  let lastMonth = ''

  return (
    <Card className="mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 pb-3 pt-4">
        <h2 className="mr-auto text-base font-semibold tracking-tight">Flights</h2>
        <Segmented size="sm" value={filter} onChange={v => { setFilter(v); setShown(25) }} options={[
          { value: 'all', label: 'All', count: counts.all }, { value: 'dual', label: 'Dual', count: counts.dual }, { value: 'solo', label: 'Solo', count: counts.solo },
          { value: 'xc', label: 'Cross-country', count: counts.xc }, { value: 'night', label: 'Night', count: counts.night },
        ]} />
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Airport, tail, instructor…" className="h-8 pl-8" aria-label="Search flights" />
        </div>
      </div>
      {loading ? <div className="space-y-2 p-5 pt-0">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div> : !flights.length ? <EmptyState icon={BookOpen} title="No flights logged yet">Use Log flight to add the first entry.</EmptyState> : !rows.length ? <EmptyState icon={Search} title="No flights match" /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-y border-border bg-sunken text-left text-xs text-fg-3">
                <th className="py-2 pl-5 pr-3 font-medium">Date</th><th className="px-3 font-medium">Route</th><th className="px-3 font-medium">Aircraft</th><th className="px-3 font-medium">Lesson</th>
                <th className="px-3 text-right font-medium">Total</th><th className="px-3 text-right font-medium">Dual</th><th className="px-3 text-right font-medium">Solo</th><th className="px-3 text-right font-medium">XC</th><th className="px-3 text-right font-medium">Night</th><th className="px-3 text-right font-medium">Ldg</th><th className="w-12 pr-3" />
              </tr></thead>
              <tbody>
                {page.flatMap(f => {
                  const month = calDate(f.date, { month: 'long', year: 'numeric' })
                  const out = []
                  if (month !== lastMonth) { lastMonth = month; out.push(<tr key={month}><td colSpan={11} className="px-5 pb-1.5 pt-4 text-xs font-medium text-fg-3">{month}</td></tr>) }
                  const cell = (v: unknown) => <td className="num px-3 text-right text-fg-2">{hours(v) ?? <span className="text-fg-3">—</span>}</td>
                  out.push(
                    <tr key={f.id} onClick={() => navigate(`/flying/${f.id}`)} className="group cursor-pointer border-b border-border last:border-0 hover:bg-hover">
                      <td className="num whitespace-nowrap py-2.5 pl-5 pr-3 text-fg-2">{calDate(f.date, { month: 'short', day: 'numeric' })}</td>
                      <td className="px-3">
                        <Link to={`/flying/${f.id}`} onClick={e => e.stopPropagation()} className="flex items-center gap-2">
                          <span className="num font-medium text-fg group-hover:text-accent">{route(f).join(' → ')}</span>
                          {f.has_track && <Tip content="GPS track recorded"><MapPin className="size-3.5 text-fg-3" /></Tip>}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3"><span className="num text-fg">{f.aircraft?.tail_number}</span> <span className="text-fg-3">{f.aircraft?.model}</span></td>
                      <td className="px-3"><span className="flex flex-wrap gap-1"><Badge>{trainingLabel(f.training_type)}</Badge>{f.flight_review && <Badge tone="accent">Review</Badge>}{f.checkride && <Badge tone="good">Checkride</Badge>}</span></td>
                      <td className="num px-3 text-right font-medium text-fg">{num(f.total_duration).toFixed(1)}</td>
                      {cell(f.dual_received)}{cell(f.solo)}{cell(f.cross_country)}{cell(f.night)}
                      <td className="num px-3 text-right text-fg-2">{f.landings || <span className="text-fg-3">—</span>}</td>
                      <td className="pr-3" onClick={e => e.stopPropagation()}>
                        <Menu>
                          <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Flight actions" className="opacity-60 group-hover:opacity-100"><MoreHorizontal /></Button></MenuTrigger>
                          <MenuContent>
                            <MenuItem onSelect={() => navigate(`/flying/${f.id}`)}><ExternalLink />Open</MenuItem>
                            <MenuItem onSelect={() => setEditing(f)}><Pencil />Edit</MenuItem>
                            <MenuSeparator />
                            <MenuItem danger onSelect={() => remove(f)}><Trash2 />Delete</MenuItem>
                          </MenuContent>
                        </Menu>
                      </td>
                    </tr>,
                  )
                  return out
                })}
              </tbody>
              <tfoot><tr className="border-t border-border bg-sunken text-sm">
                <td colSpan={4} className="py-2.5 pl-5 text-fg-3">{rows.length === flights.length ? 'All flights' : `${rows.length} matching flights`}</td>
                {(['total_duration', 'dual_received', 'solo', 'cross_country', 'night'] as const).map(k => <td key={k} className="num px-3 text-right font-medium">{rows.reduce((s, f) => s + num(f[k]), 0).toFixed(1)}</td>)}
                <td className="num px-3 text-right font-medium">{rows.reduce((s, f) => s + (f.landings || 0), 0)}</td><td />
              </tr></tfoot>
            </table>
          </div>
          {shown < rows.length && <div className="flex justify-center border-t border-border p-3"><Button size="sm" onClick={() => setShown(s => s + 25)}>Show {Math.min(25, rows.length - shown)} more</Button></div>}
        </>
      )}
      <FlightFormDialog open={!!editing} onOpenChange={o => !o && setEditing(null)} flight={editing} />
    </Card>
  )
}

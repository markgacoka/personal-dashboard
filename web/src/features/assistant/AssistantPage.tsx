import { useDeferredValue, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ChartNoAxesColumn, Cpu, Languages, MessageSquareText, Mic, Search, Watch } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/misc'
import { PageHeader, Stat } from '@/components/data/stat'
import { get } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { AssistantExchange, AssistantLog, AssistantMode, AssistantModels } from '@/lib/types'

const PAGE = 50
const MIN = 60_000
type Filter = 'all' | AssistantMode

const MODE: Record<AssistantMode, { label: string; icon: typeof Mic }> = {
  ask: { label: 'Ask', icon: MessageSquareText },
  translate: { label: 'Translate', icon: Languages },
  transcribe: { label: 'Captions', icon: Mic },
}
// How each answer was produced, in words.
const ROUTE: Record<string, string> = {
  direct: 'Answered directly', search: 'Searched the web', watch: 'Watch action', fallback: 'Backup model with search',
  'search-only': 'Search result only', error: 'Failed', translate: 'Translated', transcribe: 'Transcribed',
}

const seconds = (ms: number | null | undefined) => (ms == null ? '—' : (ms / 1000).toFixed(1))
const shortModel = (m: string) => m.replace(/^[a-z]+\//, '')
const when = (at: number) => {
  const d = new Date(at * 1000)
  const today = new Date().toDateString() === d.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return today ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

function useLog(mode: Filter, q: string) {
  return useInfiniteQuery({
    queryKey: ['assistant', 'log', mode, q],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: String(PAGE) })
      if (pageParam) qs.set('before', String(pageParam))
      if (mode !== 'all') qs.set('mode', mode)
      if (q) qs.set('q', q)
      return get<AssistantLog>(`/api/assistant/log?${qs}`)
    },
    getNextPageParam: last => (last.exchanges.length === PAGE ? last.exchanges[last.exchanges.length - 1].at : undefined),
    refetchInterval: MIN,
    retry: 1,
  })
}

const useModels = () => useQuery({ queryKey: ['assistant', 'models'], queryFn: () => get<AssistantModels>('/api/assistant/models'), refetchInterval: 5 * MIN, retry: 1 })

export default function AssistantPage() {
  const [mode, setMode] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search.trim())
  const log = useLog(mode, q)
  const models = useModels()
  const rows = useMemo(() => log.data?.pages.flatMap(p => p.exchanges) ?? [], [log.data])
  const summary = log.data?.pages[0]?.summary
  // Older rows stored the model without its provider prefix: count them together.
  const answeredBy = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of summary?.models ?? []) counts.set(shortModel(m.model), (counts.get(shortModel(m.model)) ?? 0) + m.count)
    return [...counts].map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count)
  }, [summary])

  if (log.isError && !log.data) {
    return (
      <>
        <PageHeader title="Assistant" description="Requests from your watch" />
        <EmptyState icon={Watch} title="The watch assistant isn't reachable" className="py-24" action={<Button onClick={() => log.refetch()}>Try again</Button>}>
          {(log.error as Error)?.message}
        </EmptyState>
      </>
    )
  }

  return (
    <div>
      <PageHeader title="Assistant" description="Every question you asked your watch, and how it was answered" />

      <Card className="mb-5">
        <CardBody className="grid grid-cols-2 gap-5 pt-5 md:grid-cols-4">
          <Stat label="Today" value={summary?.today} sub="requests" />
          <Stat label="Last 7 days" value={summary?.week} sub={summary ? `${summary.total.toLocaleString()} all time` : undefined} />
          <Stat label="Typical answer" value={seconds(summary?.medianMs)} unit="s" sub="median, last 200" />
          <Stat label="Slow answers" value={seconds(summary?.p90Ms)} unit="s" sub="90th percentile" />
        </CardBody>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader icon={<MessageSquareText />} title="Requests" description="Newest first. Updates every minute."
            action={<Segmented size="sm" value={mode} onChange={setMode} options={[
              { value: 'all', label: 'All' }, { value: 'ask', label: 'Ask' }, { value: 'translate', label: 'Translate' }, { value: 'transcribe', label: 'Captions' },
            ]} />} />
          <CardBody className="px-3 sm:px-4">
            <div className="relative mb-3 px-2">
              <Search className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-fg-3" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search questions and answers" className="pl-9" aria-label="Search requests" />
            </div>
            {log.isLoading ? <div className="space-y-3 px-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>
              : !rows.length ? <EmptyState icon={Watch} title={q || mode !== 'all' ? 'No matching requests' : 'No requests yet'} className="py-16">
                  {q || mode !== 'all' ? 'Try another search or filter.' : 'Ask your watch something and it shows up here.'}
                </EmptyState>
              : <ul className="divide-y divide-border">{rows.map(r => <Row key={`${r.at}-${r.question}`} r={r} />)}</ul>}
            {log.hasNextPage && (
              <div className="px-2 pt-4">
                <Button variant="secondary" onClick={() => log.fetchNextPage()} disabled={log.isFetchingNextPage}>
                  {log.isFetchingNextPage ? 'Loading…' : 'Show older requests'}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="space-y-5 xl:col-span-4">
          <Card>
            <CardHeader icon={<Cpu />} title="Models" description={models.data
              ? `Ranked by probe score, then speed. Budget ${models.data.speedBudget}s. Providers: ${models.data.providers.join(', ') || 'none'}.`
              : 'Ranked by probe score, then speed'} />
            <CardBody className="px-3 sm:px-4">
              {models.isLoading ? <Skeleton className="h-40" /> : !models.data?.ranked.length ? <p className="px-2 text-sm text-fg-3">No model data yet.</p> : (
                <ul>
                  {models.data.ranked.filter(m => m.usable).map((m, i) => (
                    <li key={m.model} className="flex items-center gap-3 rounded-md px-2 py-2">
                      <span className="num w-5 text-sm text-fg-3">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{shortModel(m.model)}</div>
                        <div className="text-xs text-fg-3">{m.model.split('/')[0]}{m.tools ? ' · tools' : ' · backup only'}</div>
                      </div>
                      {m.failures >= 0.75 && <Badge tone="warn">busy</Badge>}
                      <span className="num w-12 text-right text-sm text-fg-2">{m.latency.toFixed(1)}s</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {!!summary && !!answeredBy.length && (
            <Card>
              <CardHeader icon={<ChartNoAxesColumn />} title="Answered by" description="Last 7 days" />
              <CardBody className="space-y-2.5">
                {answeredBy.slice(0, 8).map(m => {
                  const pct = Math.round((m.count / Math.max(1, summary.week)) * 100)
                  return (
                    <div key={m.model}>
                      <div className="flex justify-between gap-3 text-sm"><span className="truncate">{m.model === 'none' ? 'No model' : m.model}</span><span className="num text-fg-3">{m.count}</span></div>
                      <div className="mt-1 h-1.5 rounded-full bg-sunken"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
                    </div>
                  )
                })}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ r }: { r: AssistantExchange }) {
  const m = MODE[r.mode] ?? MODE.ask
  const failed = r.route === 'error'
  return (
    <li className="px-2 py-3.5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-pill text-fg-2 [&_svg]:size-3.5" title={m.label}><m.icon /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-medium text-fg">{r.question || '(no speech)'}</p>
            <span className="num shrink-0 text-xs text-fg-3">{when(r.at)}</span>
          </div>
          <p className={cn('mt-1 text-sm leading-relaxed', failed ? 'text-bad' : 'text-fg-2')}>{r.answer}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-2 text-xs text-fg-3">
            <span>{ROUTE[r.route] ?? r.route}</span>
            {r.model && r.model !== 'none' && r.mode === 'ask' && <><span>·</span><span>{shortModel(r.model)}</span></>}
            {r.mode === 'translate' && r.model && <><span>·</span><span>to {r.model}</span></>}
            {!!r.tools.length && <><span>·</span><span>{[...new Set(r.tools)].join(', ').replaceAll('_', ' ')}</span></>}
            {r.ms != null && <><span>·</span><span className="num">{seconds(r.ms)}s</span></>}
          </div>
        </div>
      </div>
    </li>
  )
}

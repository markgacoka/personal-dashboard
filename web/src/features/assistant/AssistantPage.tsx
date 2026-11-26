import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChartNoAxesColumn, Cpu } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/misc'
import { PageHeader, Stat } from '@/components/data/stat'
import { get } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { AssistantLog, AssistantModels } from '@/lib/types'
import { LogTable, shortModel } from './LogTable'

const MIN = 60_000
const seconds = (ms: number | null | undefined) => (ms == null ? '—' : (ms / 1000).toFixed(1))

// The headline numbers come with any log page; one row is enough to get them.
const useSummary = () => useQuery({ queryKey: ['assistant', 'summary'], queryFn: () => get<AssistantLog>('/api/assistant/log?limit=1'), refetchInterval: MIN, retry: 1 })
const useModels = () => useQuery({ queryKey: ['assistant', 'models'], queryFn: () => get<AssistantModels>('/api/assistant/models'), refetchInterval: 5 * MIN, retry: 1 })

export default function AssistantPage() {
  const models = useModels()
  const summary = useSummary().data?.summary
  // Older rows stored the model without its provider prefix: count them together.
  const answeredBy = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of summary?.models ?? []) counts.set(shortModel(m.model), (counts.get(shortModel(m.model)) ?? 0) + m.count)
    return [...counts].map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count)
  }, [summary])

  return (
    <div className="@container">
      <PageHeader title="Assistant" />

      <Card className="mb-5">
        <CardBody className="grid grid-cols-2 gap-5 pt-5 md:grid-cols-4">
          <Stat label="Today" value={summary?.today} sub="requests" />
          <Stat label="Last 7 days" value={summary?.week} sub={summary ? `${summary.total.toLocaleString()} all time` : undefined} />
          <Stat label="Stop to answer" value={seconds(summary?.watchMedianMs ?? summary?.medianMs)} unit="s"
            hint="Measured on the watch: from when you stop talking until the answer is on screen. Median of recent requests."
            sub={summary?.watchP90Ms != null ? `90% under ${seconds(summary.watchP90Ms)}s` : `server ${seconds(summary?.medianMs)}s`} />
          <Stat label="Stop to voice" value={seconds(summary?.audioMedianMs)} unit="s"
            hint="Measured on the watch: from when you stop talking until the spoken reply starts."
            sub={`server answer ${seconds(summary?.medianMs)}s median`} />
        </CardBody>
      </Card>

      <LogTable />

      <div className="mt-5 grid items-start gap-5 @4xl:grid-cols-2">
          <Card>
            <CardHeader icon={<Cpu />} title="Models" description={models.data
              ? `Ranked by probe score, then speed. Budget ${models.data.speedBudget}s. Providers: ${models.data.providers.join(', ') || 'none'}.`
              : 'Ranked by probe score, then speed'} />
            <CardBody className="px-3 sm:px-4">
              {Object.entries(models.data?.budgets ?? {}).map(([name, b]) => (
                <div key={name} className="mb-3 px-2">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="capitalize">{name} credit used</span>
                    <span className="num text-fg-2">${b.spent.toFixed(2)} of ${b.cap.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-sunken"><div className={cn('h-full rounded-full', b.spent / b.cap > 0.8 ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.min(100, (b.spent / b.cap) * 100)}%` }} /></div>
                  <p className="mt-1 text-xs text-fg-3">Stops using {name} at the cap. Spend is estimated high, so the real charge stays below it.</p>
                </div>
              ))}
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
  )
}

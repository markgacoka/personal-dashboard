import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Activity as ActivityIcon, CalendarDays, HeartPulse, Search, BarChart3 } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/misc'
import { PageHeader, Stat } from '@/components/data/stat'
import { useActivities } from '@/lib/queries'
import { usePrefs } from '@/lib/prefs'
import { actDuration, PRIMARY, sportOf, SPORTS, TE_LABEL, type Sport } from '@/lib/sports'
import { hm, miles, speedFor } from '@/lib/format'
import type { Activity } from '@/lib/types'
import { HeartRateChart, LoadCalendar, VolumeChart, ZoneBars, zoneMinutes } from './charts'

type Filter = 'all' | Sport
const PAGE = 25

export default function TrainingPage() {
  const { data: acts, isLoading, isError } = useActivities()
  const { resolved } = usePrefs()
  const all = acts || []

  const weeks = useMemo(() => {
    const monday = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return +x }
    const thisWeek = monday(new Date())
    const hrs = (from: number, to: number) => all.filter(a => { const t = +new Date(a.startTimeLocal); return t >= from && t < to }).reduce((s, a) => s + actDuration(a) / 3600, 0)
    const w = 7 * 864e5
    const prev4 = [1, 2, 3, 4].map(i => hrs(thisWeek - i * w, thisWeek - (i - 1) * w))
    return { current: hrs(thisWeek, thisWeek + w), avg4: prev4.reduce((s, v) => s + v, 0) / 4, sessions: all.filter(a => +new Date(a.startTimeLocal) >= thisWeek).length }
  }, [all])

  if (isError) return <EmptyState icon={ActivityIcon} title="Activities are unavailable" className="py-24">Garmin didn’t respond. Try again in a minute.</EmptyState>

  return (
    <div>
      <PageHeader title="Training" description={isLoading ? 'Loading from Garmin…' : `${all.length} recent sessions from Garmin Connect`} />

      <div className="grid gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader icon={<CalendarDays />} title="Consistency" description="Last six months" />
          <CardBody>{isLoading ? <Skeleton className="h-36" /> : <LoadCalendar activities={all} dark={resolved === 'dark'} />}</CardBody>
        </Card>
        <Card className="xl:col-span-4">
          <CardHeader title="This week" description="Monday to today" />
          <CardBody className="grid grid-cols-2 gap-5">
            {isLoading ? <Skeleton className="col-span-2 h-28" /> : <>
              <Stat label="Time" value={weeks.current.toFixed(1)} unit="h" size="lg" />
              <Stat label="Sessions" value={weeks.sessions} size="lg" />
              <Stat label="4-week average" value={weeks.avg4.toFixed(1)} unit="h / week" size="sm"
                sub={weeks.avg4 ? `${weeks.current >= weeks.avg4 ? 'On pace' : `${(weeks.avg4 - weeks.current).toFixed(1)}h to match`}` : undefined} />
              <Stat label="Last 7 days load" value={Math.round(all.filter(a => Date.now() - +new Date(a.startTimeLocal) < 7 * 864e5).reduce((s, a) => s + (a.activityTrainingLoad || 0), 0)) || null} size="sm" />
            </>}
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-6">
          <CardHeader icon={<BarChart3 />} title="Volume" description="Hours per day, last 30 days" />
          <CardBody>{isLoading ? <Skeleton className="h-52" /> : <VolumeChart activities={all} />}</CardBody>
        </Card>
        <Card className="xl:col-span-3">
          <CardHeader icon={<HeartPulse />} title="Heart rate" description="Last 7 training days" />
          <CardBody>{isLoading ? <Skeleton className="h-52" /> : <HeartRateChart activities={all} height={180} />}</CardBody>
        </Card>
        <Card className="xl:col-span-3">
          <CardHeader title="Time in zones" description="Last 7 training days" />
          <CardBody>{isLoading ? <Skeleton className="h-52" /> : <ZoneBars minutes={zoneMinutes(all)} className="pt-2" />}</CardBody>
        </Card>
      </div>

      <ActivityTable activities={all} loading={isLoading} />
    </div>
  )
}

function ActivityTable({ activities, loading }: { activities: Activity[]; loading: boolean }) {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: activities.length }
    for (const a of activities) { const s = sportOf(a); const k = PRIMARY.includes(s) ? s : 'other'; c[k] = (c[k] || 0) + 1 }
    return c
  }, [activities])

  const rows = useMemo(() => activities.filter(a => {
    const s = sportOf(a)
    if (filter !== 'all' && (filter === 'other' ? PRIMARY.includes(s) : s !== filter)) return false
    return !q || (a.activityName || '').toLowerCase().includes(q.toLowerCase())
  }), [activities, filter, q])

  const options = (['all', ...PRIMARY, 'other'] as Filter[]).filter(f => f === 'all' || counts[f]).map(f => ({ value: f, label: f === 'all' ? 'All' : SPORTS[f as Sport].short, count: counts[f] }))
  const page = rows.slice(0, shown)
  let lastMonth = ''

  return (
    <Card className="mt-5">
      <div className="flex flex-wrap items-center gap-3 px-5 pb-3 pt-4">
        <h2 className="mr-auto text-base font-semibold tracking-tight">Activities</h2>
        <Segmented value={filter} onChange={v => { setFilter(v); setShown(PAGE) }} options={options} size="sm" />
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <Input value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} placeholder="Search by name" className="h-8 pl-8" aria-label="Search activities" />
        </div>
      </div>
      {loading ? <div className="space-y-2 p-5 pt-0">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div> : !rows.length ? (
        <EmptyState icon={Search} title="No activities match" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-y border-border bg-sunken text-left text-xs font-medium text-fg-3">
                <th className="py-2 pl-5 pr-3 font-medium">Activity</th>
                <th className="px-3 font-medium">Distance</th>
                <th className="px-3 font-medium">Time</th>
                <th className="px-3 font-medium">Pace / speed</th>
                <th className="px-3 font-medium">Avg HR</th>
                <th className="px-3 font-medium">Load</th>
                <th className="py-2 pl-3 pr-5 font-medium">Effect</th>
              </tr>
            </thead>
            <tbody>
              {page.flatMap(a => {
                const d = new Date(a.startTimeLocal)
                const month = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                const s = sportOf(a), cfg = SPORTS[s]
                const out = []
                if (month !== lastMonth) {
                  lastMonth = month
                  out.push(<tr key={month}><td colSpan={7} className="px-5 pb-1.5 pt-4 text-xs font-medium text-fg-3">{month}</td></tr>)
                }
                out.push(
                  <tr key={a.activityId} onClick={() => navigate(`/training/${a.activityId}`)} className="group cursor-pointer border-b border-border last:border-0 hover:bg-hover">
                    <td className="py-2.5 pl-5 pr-3">
                      <Link to={`/training/${a.activityId}`} className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                        <span className="grid size-8 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in oklch, ${cfg.color} 14%, transparent)`, color: cfg.color }}><cfg.icon className="size-4" /></span>
                        <span className="min-w-0">
                          <span className="block max-w-[320px] truncate font-medium text-fg group-hover:text-accent">{a.activityName || cfg.label}</span>
                          <span className="block text-xs text-fg-3">{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {cfg.label}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="num px-3 text-fg-2">{miles(a.distance) ?? '—'}</td>
                    <td className="num px-3 text-fg-2">{hm(actDuration(a)) ?? '—'}</td>
                    <td className="num px-3 text-fg-2">{a.distance ? speedFor(a.averageSpeed, s) ?? '—' : '—'}</td>
                    <td className="num px-3 text-fg-2">{a.averageHR ? `${Math.round(a.averageHR)}` : '—'}</td>
                    <td className="num px-3 text-fg-2">{a.activityTrainingLoad ? Math.round(a.activityTrainingLoad) : '—'}</td>
                    <td className="py-2.5 pl-3 pr-5">{a.trainingEffectLabel ? <Badge>{TE_LABEL[a.trainingEffectLabel] || a.trainingEffectLabel.replace(/_/g, ' ').toLowerCase()}</Badge> : <span className="text-fg-3">—</span>}</td>
                  </tr>,
                )
                return out
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-fg-3">
            <span>Showing {page.length} of {rows.length}</span>
            {shown < rows.length && <Button size="sm" onClick={() => setShown(s => s + PAGE)}>Show more</Button>}
          </div>
        </div>
      )}
    </Card>
  )
}

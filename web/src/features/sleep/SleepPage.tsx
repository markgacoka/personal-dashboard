import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BedDouble, Moon } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState, Skeleton } from '@/components/ui/misc'
import { PageHeader, Stat } from '@/components/data/stat'
import { Ring } from '@/components/data/spark'
import { axisProps, cursorBand, cursorLine, gridProps, Legend, makeTip } from '@/components/data/chart'
import { useSleepLatest, useSleepTrend } from '@/lib/queries'
import { calDate, hm, titleCase } from '@/lib/format'
import { num } from '@/lib/utils'
import type { SleepLatest, SleepTrendRow } from '@/lib/types'

const STAGES = [
  { level: 3, key: 'awake_sec', name: 'Awake', color: 'var(--c2)' },
  { level: 2, key: 'rem_sec', name: 'REM', color: 'var(--c3)' },
  { level: 1, key: 'light_sec', name: 'Light', color: 'var(--c1)' },
  { level: 0, key: 'deep_sec', name: 'Deep', color: 'var(--c7)' },
] as const
const stageOf = (lvl: number) => STAGES.find(s => s.level === lvl) || STAGES[2]

// Garmin's "...Local" epoch fields are local wall time labelled as UTC: read them back in UTC.
const clockLocal = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) : '—')
// sleepLevels' GMT strings lack a trailing Z but are UTC.
const gmt = (s: string) => new Date(s.endsWith('Z') ? s : s + 'Z').getTime()
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

export default function SleepPage() {
  const latest = useSleepLatest()
  const trend = useSleepTrend(30)
  const nights = (trend.data || []).filter(t => t.duration_sec)
  if (!latest.isLoading && !trend.isLoading && !latest.data && !nights.length)
    return <><PageHeader title="Sleep" /><EmptyState icon={BedDouble} title="No sleep data yet" className="py-24">Nights recorded by the Garmin watch appear here.</EmptyState></>

  const avg = (k: keyof SleepTrendRow) => { const v = nights.map(n => num(n[k])).filter(Boolean); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }

  return (
    <div>
      <PageHeader title="Sleep" description="Nightly recovery from Garmin" />
      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-8">{latest.isLoading ? <Skeleton className="h-[420px]" /> : latest.data ? <LastNight s={latest.data} /> : <Card className="grid h-full place-items-center p-10 text-sm text-fg-3">No detail for the most recent night.</Card>}</div>
        <Card className="xl:col-span-4">
          <CardHeader title="30-night averages" description={`${nights.length} nights recorded`} />
          <CardBody className="grid grid-cols-2 gap-5">
            {trend.isLoading ? <Skeleton className="col-span-2 h-40" /> : <>
              <Stat label="Duration" value={hm(avg('duration_sec'))} size="md" />
              <Stat label="Score" value={avg('score') != null ? Math.round(avg('score')!) : null} size="md" />
              <Stat label="Deep" value={hm(avg('deep_sec'))} size="sm" />
              <Stat label="REM" value={hm(avg('rem_sec'))} size="sm" />
              <Stat label="Nights under 7h" value={nights.filter(n => num(n.duration_sec) < 7 * 3600).length} size="sm" sub={`of ${nights.length}`} />
              <Stat label="Avg overnight HRV" value={avg('avg_hrv') != null ? Math.round(avg('avg_hrv')!) : null} unit="ms" size="sm" />
            </>}
          </CardBody>
        </Card>
      </div>

      {nights.length > 0 && (
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <Card><CardHeader title="Duration" description="Hours asleep · shaded band is 7–9 h" /><CardBody><DurationChart rows={trend.data || []} /></CardBody></Card>
          <Card><CardHeader title="Sleep score" description="Garmin overall score, 0–100" /><CardBody><ScoreChart rows={trend.data || []} /></CardBody></Card>
          <Card className="xl:col-span-2"><CardHeader title="Stage composition" description="Hours per stage each night" /><CardBody><StageChart rows={trend.data || []} /></CardBody></Card>
        </div>
      )}
    </div>
  )
}

function LastNight({ s }: { s: SleepLatest }) {
  const d = s.dailySleepDTO || {}
  const secs = { deep_sec: d.deepSleepSeconds || 0, light_sec: d.lightSleepSeconds || 0, rem_sec: d.remSleepSeconds || 0, awake_sec: d.awakeSleepSeconds || 0 }
  const total = Object.values(secs).reduce((a, b) => a + b, 0) || 1
  const score = d.sleepScores?.overall?.value ?? null
  const q = d.sleepScores?.overall?.qualifierKey
  const hrvVals = (s.hrvData || []).map(h => h.value).filter((v): v is number => v != null)
  const hrv = hrvVals.length ? Math.round(hrvVals.reduce((a, b) => a + b, 0) / hrvVals.length) : null
  const ringColor = score == null ? 'var(--fg-3)' : score >= 80 ? 'var(--good)' : score >= 60 ? 'var(--warn)' : 'var(--bad)'
  return (
    <Card>
      <CardHeader icon={<Moon />} title="Last night" description={calDate(s.date, { weekday: 'long', month: 'long', day: 'numeric' })} action={q && <Badge tone={score != null && score >= 80 ? 'good' : score != null && score >= 60 ? 'warn' : 'bad'} size="md">{titleCase(q)}</Badge>} />
      <CardBody>
        <div className="flex flex-wrap items-center gap-6">
          <Ring value={score} size={96} stroke={8} color={ringColor}><div className="text-center"><div className="num text-2xl font-semibold">{score ?? '—'}</div><div className="text-[11px] text-fg-3">score</div></div></Ring>
          <div>
            <div className="num text-4xl font-semibold tracking-tight">{hm(d.sleepTimeSeconds) ?? '—'}</div>
            <div className="mt-1 text-sm text-fg-2"><span className="num">{clockLocal(d.sleepStartTimestampLocal)}</span> → <span className="num">{clockLocal(d.sleepEndTimestampLocal)}</span>{d.awakeCount ? <span className="text-fg-3"> · woke {d.awakeCount}×</span> : null}</div>
          </div>
          <div className="ml-auto grid grid-cols-3 gap-x-6 gap-y-3 sm:grid-cols-5">
            <Stat size="sm" label="Avg HR" value={d.avgHeartRate ? Math.round(d.avgHeartRate) : null} />
            <Stat size="sm" label="HRV" value={hrv} unit="ms" />
            <Stat size="sm" label="SpO₂" value={d.averageSpO2Value != null ? `${d.averageSpO2Value}%` : null} />
            <Stat size="sm" label="Breaths/min" value={d.averageRespirationValue ?? null} />
            <Stat size="sm" label="Stress" value={d.avgSleepStress != null ? Math.round(d.avgSleepStress) : null} />
          </div>
        </div>

        <div className="mt-6 flex h-3 gap-0.5 overflow-hidden rounded-full">
          {[...STAGES].reverse().map(st => <div key={st.key} style={{ width: `${(secs[st.key] / total) * 100}%`, background: st.color }} />)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...STAGES].reverse().map(st => (
            <div key={st.key}>
              <div className="flex items-center gap-1.5 text-sm text-fg-3"><span className="size-2.5 rounded-[3px]" style={{ background: st.color }} />{st.name}</div>
              <div className="mt-0.5 text-sm"><span className="num font-medium">{hm(secs[st.key]) ?? '0m'}</span> <span className="text-fg-3">· {Math.round((secs[st.key] / total) * 100)}%</span></div>
            </div>
          ))}
        </div>

        {!!s.sleepLevels?.length && <Hypnogram levels={s.sleepLevels} />}
      </CardBody>
    </Card>
  )
}

// Stage bands: each segment sits on its stage's row, so the night reads left to right.
function Hypnogram({ levels }: { levels: NonNullable<SleepLatest['sleepLevels']> }) {
  const [hover, setHover] = useState<number | null>(null)
  const t0 = gmt(levels[0].startGMT), t1 = gmt(levels[levels.length - 1].endGMT)
  const span = t1 - t0 || 1
  const ticks = useMemo(() => {
    const out: number[] = []
    const d = new Date(t0); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1)
    for (; +d < t1; d.setHours(d.getHours() + 1)) out.push(+d)
    return out.filter((_, i, a) => a.length <= 8 || i % 2 === 0)
  }, [t0, t1])
  const rowH = 26
  const seg = hover != null ? levels[hover] : null
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-sm font-medium text-fg-2">Stages through the night</div>
        <div className="text-xs text-fg-3 tnum">{seg ? `${stageOf(seg.activityLevel).name} · ${clock(gmt(seg.startGMT))}–${clock(gmt(seg.endGMT))} · ${Math.round((gmt(seg.endGMT) - gmt(seg.startGMT)) / 60000)} min` : 'Hover a segment'}</div>
      </div>
      <div className="flex">
        <div className="w-14 shrink-0">
          {STAGES.map(st => <div key={st.key} className="flex items-center text-xs text-fg-3" style={{ height: rowH }}>{st.name}</div>)}
        </div>
        <div className="relative min-w-0 flex-1" onMouseLeave={() => setHover(null)}>
          {STAGES.map((st, i) => <div key={st.key} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: i * rowH + rowH / 2 }} />)}
          <div className="relative" style={{ height: rowH * 4 }}>
            {levels.map((l, i) => {
              const st = stageOf(l.activityLevel)
              const row = STAGES.indexOf(st)
              const left = ((gmt(l.startGMT) - t0) / span) * 100
              const width = ((gmt(l.endGMT) - gmt(l.startGMT)) / span) * 100
              return <div key={i} onMouseEnter={() => setHover(i)} className="absolute rounded-[3px] transition-opacity"
                style={{ left: `${left}%`, width: `max(${width}%, 2px)`, top: row * rowH + 5, height: rowH - 10, background: st.color, opacity: hover == null || hover === i ? 1 : 0.35 }} />
            })}
          </div>
          <div className="relative mt-1 h-4 text-xs text-fg-3">
            {ticks.map(t => <span key={t} className="num absolute -translate-x-1/2" style={{ left: `${((t - t0) / span) * 100}%` }}>{clock(t).replace(':00', '')}</span>)}
          </div>
        </div>
      </div>
    </div>
  )
}

const label = (d: string) => calDate(d)
function DurationChart({ rows }: { rows: SleepTrendRow[] }) {
  const data = rows.map(r => ({ date: r.date, h: r.duration_sec ? +(r.duration_sec / 3600).toFixed(2) : null }))
  const Tip = makeTip<{ date: string; h: number | null }>({ title: r => calDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' }), rows: r => [{ color: 'var(--c1)', label: 'Asleep', value: r.h != null ? hm(r.h * 3600)! : 'No data' }] })
  return (
    <div className="h-56"><ResponsiveContainer>
      <BarChart data={data} margin={{ top: 4, right: 0, left: -18, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <ReferenceArea y1={7} y2={9} fill="var(--good)" fillOpacity={0.07} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={label} minTickGap={24} />
        <YAxis {...axisProps} width={44} tickFormatter={v => `${v}h`} domain={[0, 10]} ticks={[0, 3, 6, 9]} />
        <Tooltip content={Tip} cursor={cursorBand} />
        <Bar dataKey="h" fill="var(--c1)" radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer></div>
  )
}

function ScoreChart({ rows }: { rows: SleepTrendRow[] }) {
  const data = rows.map(r => ({ date: r.date, score: r.score ?? null }))
  const Tip = makeTip<{ date: string; score: number | null }>({ title: r => calDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' }), rows: r => [{ color: 'var(--c7)', label: 'Score', value: r.score ?? 'No data' }] })
  return (
    <div className="h-56"><ResponsiveContainer>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={label} minTickGap={24} />
        <YAxis {...axisProps} width={44} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
        <Tooltip content={Tip} cursor={cursorLine} />
        <Line dataKey="score" stroke="var(--c7)" strokeWidth={2} connectNulls dot={{ r: 3.5, fill: 'var(--c7)', stroke: 'var(--card)', strokeWidth: 2 }} activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer></div>
  )
}

function StageChart({ rows }: { rows: SleepTrendRow[] }) {
  const order = [...STAGES].reverse()
  const data = rows.map(r => ({ date: r.date, ...Object.fromEntries(order.map(s => [s.key, r[s.key] != null ? +(num(r[s.key]) / 3600).toFixed(2) : null])) }))
  const Tip = makeTip<Record<string, number | string | null>>({
    title: r => calDate(r.date as string, { weekday: 'short', month: 'short', day: 'numeric' }),
    rows: r => order.filter(s => r[s.key] != null).map(s => ({ color: s.color, label: s.name, value: hm((r[s.key] as number) * 3600) })),
  })
  return (
    <div>
      <div className="h-64"><ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 0, left: -18, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" {...axisProps} tickFormatter={label} minTickGap={24} />
          <YAxis {...axisProps} width={44} tickFormatter={v => `${v}h`} />
          <Tooltip content={Tip} cursor={cursorBand} />
          {order.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.name} stackId="s" fill={s.color} stroke="var(--card)" strokeWidth={1} maxBarSize={22} radius={i === order.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer></div>
      <Legend className="mt-3" items={order.map(s => ({ label: s.name, color: s.color }))} />
    </div>
  )
}

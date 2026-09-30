import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Activity } from '@/lib/types'
import { actDay, actDuration, bucketOf, HR_ZONES, PRIMARY, sportOf, SPORTS, type Sport } from '@/lib/sports'
import { axisProps, cursorBand, cursorLine, gridProps, Legend, makeTip } from '@/components/data/chart'
import { Tooltip as Tip } from '@/components/ui/misc'
import { cn } from '@/lib/utils'

const dayStr = (d: Date) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
const lastDays = (n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return dayStr(d) })
const short = (day: string, o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => new Date(day + 'T12:00:00').toLocaleDateString('en-US', o)

const BUCKETS: Sport[] = [...PRIMARY, 'other']

// ── Daily training volume, stacked by sport, over a continuous day axis ──────
export function useVolume(activities: Activity[], days = 30) {
  return useMemo(() => {
    const axis = lastDays(days)
    const rows = axis.map(day => ({ day, ...Object.fromEntries(BUCKETS.map(b => [b, 0])) } as Record<string, number | string>))
    const idx = new Map(axis.map((d, i) => [d, i]))
    let hours = 0, sessions = 0
    for (const a of activities) {
      const i = idx.get(actDay(a))
      const h = actDuration(a) / 3600
      if (i == null || h <= 0) continue
      const b = bucketOf(sportOf(a))
      rows[i][b] = +((rows[i][b] as number) + h).toFixed(2)
      hours += h; sessions++
    }
    const present = BUCKETS.filter(b => rows.some(r => (r[b] as number) > 0))
    return { rows, present, hours, sessions }
  }, [activities, days])
}

export function VolumeChart({ activities, days = 30, height = 200 }: { activities: Activity[]; days?: number; height?: number }) {
  const { rows, present } = useVolume(activities, days)
  const Tipc = useMemo(() => makeTip<Record<string, number | string>>({
    title: r => short(r.day as string, { weekday: 'short', month: 'short', day: 'numeric' }),
    rows: r => present.filter(p => (r[p] as number) > 0).map(p => ({ color: SPORTS[p].color, label: SPORTS[p].label, value: `${(r[p] as number).toFixed(1)}h` })),
    footer: r => { const t = present.reduce((s, p) => s + (r[p] as number), 0); return t ? `Total ${t.toFixed(1)}h` : 'Rest day' },
  }), [present])
  if (!present.length) return <div className="grid place-items-center text-sm text-fg-3" style={{ height }}>No activities in the last {days} days</div>
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 4, right: 0, left: -18, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="day" {...axisProps} tickFormatter={d => short(d)} interval="preserveStartEnd" minTickGap={28} />
            <YAxis {...axisProps} tickFormatter={v => (v ? `${v}h` : '0')} width={44} allowDecimals />
            <Tooltip content={Tipc} cursor={cursorBand} />
            {present.map((p, i) => (
              <Bar key={p} dataKey={p} name={SPORTS[p].label} stackId="v" fill={SPORTS[p].color} maxBarSize={22}
                stroke="var(--card)" strokeWidth={1} radius={i === present.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {present.length > 1 && <Legend className="mt-3" items={present.map(p => ({ label: SPORTS[p].label, color: SPORTS[p].color }))} />}
    </div>
  )
}

// ── Training-load calendar: one cell per day, darker = more load ─────────────
const RAMP = ['var(--sunken)', '#cde2fb', '#9ec5f4', '#5598e7', '#256abf', '#104281']
const RAMP_DARK = ['var(--sunken)', '#0d366b', '#184f95', '#256abf', '#3987e5', '#86b6ef']

export function LoadCalendar({ activities, weeks = 26, dark }: { activities: Activity[]; weeks?: number; dark?: boolean }) {
  const { cols, max, months } = useMemo(() => {
    const byDay = new Map<string, { load: number; mins: number; n: number }>()
    for (const a of activities) {
      const k = actDay(a)
      const e = byDay.get(k) || { load: 0, mins: 0, n: 0 }
      e.load += a.activityTrainingLoad || 0; e.mins += actDuration(a) / 60; e.n++
      byDay.set(k, e)
    }
    const today = new Date(); today.setHours(12, 0, 0, 0)
    const start = new Date(today); start.setDate(start.getDate() - (weeks * 7 - 1))
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) // back to Monday
    const end = new Date(today); end.setDate(end.getDate() + (6 - ((today.getDay() + 6) % 7))) // through Sunday
    const cols: { day: string; v: { load: number; mins: number; n: number } | null; future: boolean }[][] = []
    const months: { col: number; label: string }[] = []
    let max = 0
    for (const d = new Date(start); d <= end;) {
      const c = cols.length
      const col = []
      for (let r = 0; r < 7; r++) {
        const k = dayStr(d)
        const v = byDay.get(k) || null
        if (v) max = Math.max(max, v.load || v.mins)
        if (d.getDate() === 1 && c > 0) months.push({ col: c, label: d.toLocaleDateString('en-US', { month: 'short' }) })
        col.push({ day: k, v, future: d > today })
        d.setDate(d.getDate() + 1)
      }
      cols.push(col)
    }
    return { cols, max, months }
  }, [activities, weeks])
  const ramp = dark ? RAMP_DARK : RAMP
  const level = (v: number) => (v <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / (max || 1)) * 4.999)))
  return (
    <div className="overflow-x-auto scrollbar-none">
      <div className="inline-flex flex-col gap-1.5">
        <div className="relative ml-7 h-4 text-xs text-fg-3">
          {months.map(m => <span key={m.col + m.label} className="absolute" style={{ left: m.col * 15 }}>{m.label}</span>)}
        </div>
        <div className="flex gap-[3px]">
          <div className="mr-1 grid w-6 grid-rows-7 gap-[3px] text-[10px] leading-3 text-fg-3">
            {['Mon', '', 'Wed', '', 'Fri', '', ''].map((l, i) => <span key={i} className="h-3">{l}</span>)}
          </div>
          {cols.map((col, ci) => (
            <div key={ci} className="grid grid-rows-7 gap-[3px]">
              {col.map(cell => (
                <Tip key={cell.day} content={cell.future ? null : `${short(cell.day, { weekday: 'short', month: 'short', day: 'numeric' })} · ${cell.v ? `${cell.v.n} session${cell.v.n > 1 ? 's' : ''}, ${Math.round(cell.v.mins)} min${cell.v.load ? `, load ${Math.round(cell.v.load)}` : ''}` : 'Rest'}`}>
                  <span className={cn('size-3 rounded-[3px]', cell.future && 'opacity-0')} style={{ background: ramp[cell.v ? level(cell.v.load || cell.v.mins) : 0], boxShadow: 'inset 0 0 0 1px color-mix(in oklch, var(--fg) 6%, transparent)' }} />
                </Tip>
              ))}
            </div>
          ))}
        </div>
        <div className="ml-7 flex items-center gap-1.5 text-xs text-fg-3">
          Less {ramp.map((c, i) => <span key={i} className="size-3 rounded-[3px]" style={{ background: c, boxShadow: 'inset 0 0 0 1px color-mix(in oklch, var(--fg) 6%, transparent)' }} />)} More
          <span className="ml-2">· shaded by Garmin training load</span>
        </div>
      </div>
    </div>
  )
}

// ── Heart rate on the last seven days with HR data ───────────────────────────
export function HeartRateChart({ activities, height = 200 }: { activities: Activity[]; height?: number }) {
  const rows = useMemo(() => {
    const by = new Map<string, { avg: number[]; max: number }>()
    for (const a of activities) {
      if (!a.averageHR) continue
      const k = actDay(a)
      const e = by.get(k) || { avg: [], max: 0 }
      e.avg.push(a.averageHR); e.max = Math.max(e.max, a.maxHR || 0)
      by.set(k, e)
    }
    return [...by.keys()].sort().slice(-7).map(day => {
      const e = by.get(day)!
      return { day, avg: Math.round(e.avg.reduce((s, v) => s + v, 0) / e.avg.length), max: e.max || null }
    })
  }, [activities])
  const Tipc = useMemo(() => makeTip<{ day: string; avg: number; max: number | null }>({
    title: r => short(r.day, { weekday: 'short', month: 'short', day: 'numeric' }),
    rows: r => [{ color: 'var(--c8)', label: 'Average', value: `${r.avg} bpm` }, ...(r.max ? [{ color: 'var(--c4)', label: 'Max', value: `${r.max} bpm` }] : [])],
  }), [])
  if (!rows.length) return <div className="grid place-items-center text-sm text-fg-3" style={{ height }}>No heart-rate data</div>
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="day" {...axisProps} tickFormatter={d => short(d)} />
            <YAxis {...axisProps} width={44} domain={['dataMin - 10', 'dataMax + 5']} allowDecimals={false} />
            <Tooltip content={Tipc} cursor={cursorLine} />
            <Line dataKey="max" name="Max" stroke="var(--c4)" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="avg" name="Average" stroke="var(--c8)" strokeWidth={2} dot={{ r: 4, fill: 'var(--c8)', stroke: 'var(--card)', strokeWidth: 2 }} activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend className="mt-3" items={[{ label: 'Average HR', color: 'var(--c8)' }, { label: 'Max HR', color: 'var(--c4)', dashed: true }]} />
    </div>
  )
}

// ── Time in HR zones over the last seven days with zone data ─────────────────
export function zoneMinutes(activities: Activity[]) {
  const days = [...new Set(activities.filter(a => [1, 2, 3, 4, 5].some(i => (a[`hrTimeInZone_${i}`] || 0) > 0)).map(actDay))].sort().slice(-7)
  const set = new Set(days)
  const mins = [0, 0, 0, 0, 0]
  for (const a of activities) if (set.has(actDay(a))) for (let i = 0; i < 5; i++) mins[i] += (a[`hrTimeInZone_${i + 1}`] || 0) / 60
  return mins.map(m => Math.round(m))
}

export function ZoneBars({ minutes, className }: { minutes: number[]; className?: string }) {
  const total = minutes.reduce((s, v) => s + v, 0)
  if (!total) return <div className={cn('py-8 text-center text-sm text-fg-3', className)}>No zone data for this period</div>
  const max = Math.max(...minutes)
  const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)
  return (
    <div className={cn('space-y-2.5', className)}>
      {HR_ZONES.map((z, i) => (
        <div key={z.name} className="grid grid-cols-[88px_1fr_64px] items-center gap-3 text-sm">
          <span className="text-fg-2"><span className="num font-medium text-fg">{z.name}</span> {z.long}</span>
          <div className="h-2 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full" style={{ width: `${(minutes[i] / max) * 100}%`, background: z.color }} /></div>
          <span className="num text-right text-fg-2">{fmt(minutes[i])}</span>
        </div>
      ))}
    </div>
  )
}

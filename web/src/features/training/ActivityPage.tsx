import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, Mountain } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/misc'
import { Stat } from '@/components/data/stat'
import { MapView, fitTo, mapColor, maplibregl } from '@/components/data/MapView'
import { axisProps, cursorLine, gridProps, makeTip } from '@/components/data/chart'
import { useActivities, useActivityDetail, useActivityGpx } from '@/lib/queries'
import { actDuration, HR_ZONES, sportOf, SPLIT_LABEL, SPORTS, TE_LABEL } from '@/lib/sports'
import { duration, hm, miles, sentence, speedFor } from '@/lib/format'
import type { Activity, ActivityDetail } from '@/lib/types'

export default function ActivityPage() {
  const { id } = useParams()
  const { data: acts, isLoading } = useActivities()
  const a = acts?.find(x => String(x.activityId) === id)
  const detail = useActivityDetail(a ? id : undefined)
  const gpx = useActivityGpx(id, !!a?.hasPolyline)

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-96" /></div>
  if (!a) return <EmptyState title="Activity not found" className="py-24" action={<Button asChild><Link to="/training">Back to training</Link></Button>}>It may be older than the 200 most recent activities.</EmptyState>

  const sport = sportOf(a), cfg = SPORTS[sport]
  const pts = gpx.data?.points || []
  const hasMap = !!a.hasPolyline && (gpx.isLoading || pts.length >= 2)

  return (
    <div>
      <Link to="/training" className="mb-3 inline-flex items-center gap-1 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="size-4" />Training</Link>
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <span className="grid size-12 place-items-center rounded-xl" style={{ background: `color-mix(in oklch, ${cfg.color} 14%, transparent)`, color: cfg.color }}><cfg.icon className="size-6" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{a.activityName || cfg.label}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-3">
            <span>{cfg.label}</span><span>·</span>
            <span>{new Date(a.startTimeLocal).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            {a.trainingEffectLabel && <Badge tone="accent">{TE_LABEL[a.trainingEffectLabel] || sentence(a.trainingEffectLabel)}</Badge>}
          </div>
        </div>
      </div>

      <Card className="mb-5">
        <CardBody className="grid grid-cols-2 gap-6 pt-5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Distance" value={miles(a.distance)} size="lg" />
          <Stat label="Moving time" value={hm(actDuration(a))} size="lg" />
          <Stat label={sport === 'cycling' ? 'Avg speed' : 'Avg pace'} value={a.distance ? speedFor(a.averageSpeed, sport) : null} size="lg" />
          <Stat label="Avg heart rate" value={a.averageHR ? Math.round(a.averageHR) : null} unit="bpm" size="lg" />
          <Stat label="Training load" value={a.activityTrainingLoad ? Math.round(a.activityTrainingLoad) : null} size="lg" />
          <Stat label="Calories" value={a.calories ? a.calories.toLocaleString() : null} unit="kcal" size="lg" />
        </CardBody>
      </Card>

      {hasMap && (
        <div className="mb-5 grid gap-5 xl:grid-cols-12">
          <Card className="overflow-hidden xl:col-span-8">
            {gpx.isLoading ? <Skeleton className="h-[420px] rounded-none" /> : <RouteMap points={pts} color={cfg.color} />}
          </Card>
          <Card className="xl:col-span-4">
            <CardHeader icon={<Mountain />} title="Elevation" description={a.elevationGain ? `${Math.round(a.elevationGain * 3.28084).toLocaleString()} ft gained` : undefined} />
            <CardBody>{gpx.isLoading ? <Skeleton className="h-64" /> : <ElevationChart points={pts} />}</CardBody>
          </Card>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHeader title="Performance" />
          <CardBody>{detail.isLoading ? <Skeleton className="h-48" /> : <Metrics a={a} d={detail.data} />}</CardBody>
        </Card>
        <div className="space-y-5 xl:col-span-5">
          <Effect a={a} />
          <Zones a={a} />
        </div>
      </div>

      <Splits a={a} d={detail.data} />
      {a.description && <Card className="mt-5"><CardHeader title="Notes" /><CardBody className="whitespace-pre-wrap text-sm leading-relaxed text-fg-2">{a.description}</CardBody></Card>}
    </div>
  )
}

function RouteMap({ points, color }: { points: [number, number, number | null][]; color: string }) {
  const line = mapColor(color.startsWith('var(') ? color.slice(4, -1) : color)
  return (
    <MapView className="h-[420px]" fullscreen center={[points[0][0], points[0][1]]} zoom={12} onLoad={map => {
      const coords = points.map(p => [p[0], p[1]] as [number, number])
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } })
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.9 } })
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': line, 'line-width': 3.5 } })
      const dot = (bg: string) => { const el = document.createElement('div'); el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${bg};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)`; return el }
      new maplibregl.Marker({ element: dot('#16a34a') }).setLngLat(coords[0]).addTo(map)
      new maplibregl.Marker({ element: dot('#111827') }).setLngLat(coords[coords.length - 1]).addTo(map)
      fitTo(map, coords, 48, 16)
    }} />
  )
}

function ElevationChart({ points }: { points: [number, number, number | null][] }) {
  const rows = useMemo(() => {
    const hav = (a: [number, number, number | null], b: [number, number, number | null]) => {
      const R = 3958.8, dLat = ((b[1] - a[1]) * Math.PI) / 180, dLon = ((b[0] - a[0]) * Math.PI) / 180
      const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
      return R * 2 * Math.asin(Math.sqrt(s))
    }
    let dist = 0
    return points.map((p, i) => { if (i) dist += hav(points[i - 1], p); return { mi: +dist.toFixed(2), ft: p[2] != null ? Math.round(p[2] * 3.28084) : null } }).filter(r => r.ft != null)
  }, [points])
  const Tip = useMemo(() => makeTip<{ mi: number; ft: number }>({ title: r => `${r.mi} mi`, rows: r => [{ color: 'var(--c3)', label: 'Elevation', value: `${r.ft.toLocaleString()} ft` }] }), [])
  if (rows.length < 2) return <p className="py-10 text-center text-sm text-fg-3">No elevation in this track.</p>
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="mi" type="number" domain={['dataMin', 'dataMax']} {...axisProps} tickFormatter={v => `${v} mi`} tickCount={5} />
          <YAxis {...axisProps} width={52} tickFormatter={v => `${v} ft`} domain={['dataMin - 20', 'dataMax + 20']} />
          <Tooltip content={Tip} cursor={cursorLine} />
          <Area dataKey="ft" type="monotone" stroke="var(--c3)" strokeWidth={2} fill="var(--c3)" fillOpacity={0.12} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function Metrics({ a, d }: { a: Activity; d?: ActivityDetail }) {
  const s = d?.summaryDTO || {}
  const sport = sportOf(a)
  const bb = s.differenceBodyBattery ?? a.differenceBodyBattery
  const pick = <T,>(...v: (T | undefined | null)[]) => v.find(x => x != null && x !== 0) ?? null
  const rows: [string, string | null][] = [
    ['Max heart rate', a.maxHR ? `${Math.round(a.maxHR)} bpm` : null],
    ['Min heart rate', s.minHR ? `${Math.round(s.minHR)} bpm` : null],
    ['Avg power', pick(s.averagePower, a.avgPower) ? `${Math.round(pick(s.averagePower, a.avgPower)!)} W` : null],
    ['Normalized power', pick(s.normalizedPower, a.normPower) ? `${Math.round(pick(s.normalizedPower, a.normPower)!)} W` : null],
    ['Max power', pick(s.maxPower, a.maxPower) ? `${Math.round(pick(s.maxPower, a.maxPower)!)} W` : null],
    [sport === 'cycling' ? 'Max speed' : 'Best pace', speedFor(pick(s.maxSpeed, a.maxSpeed), sport)],
    ['Cadence', pick(s.averageRunCadence, a.averageRunningCadenceInStepsPerMinute) ? `${Math.round(pick(s.averageRunCadence, a.averageRunningCadenceInStepsPerMinute)!)} spm` : null],
    ['Stride length', pick(s.strideLength, a.avgStrideLength) ? `${(pick(s.strideLength, a.avgStrideLength)! / 100).toFixed(2)} m` : null],
    ['Ground contact', pick(s.groundContactTime, a.avgGroundContactTime) ? `${Math.round(pick(s.groundContactTime, a.avgGroundContactTime)!)} ms` : null],
    ['Vertical oscillation', pick(s.verticalOscillation, a.avgVerticalOscillation) ? `${pick(s.verticalOscillation, a.avgVerticalOscillation)!.toFixed(1)} cm` : null],
    ['Body Battery', bb != null ? `${bb > 0 ? '+' : ''}${bb}` : null],
    ['Total work', s.totalWork ? `${s.totalWork.toFixed(1)} kJ` : null],
    ['Steps', pick(s.steps, a.steps) ? pick(s.steps, a.steps)!.toLocaleString() : null],
    ['Elevation gain', a.elevationGain ? `${Math.round(a.elevationGain * 3.28084).toLocaleString()} ft` : null],
    ['Elapsed time', duration(a.duration)],
    ['Laps', d?.metadataDTO?.lapCount != null ? String(d.metadataDTO.lapCount) : null],
  ]
  const shown = rows.filter(([, v]) => v)
  if (!shown.length) return <p className="text-sm text-fg-3">No additional metrics for this activity.</p>
  return (
    <dl className="grid gap-x-8 sm:grid-cols-2">
      {shown.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 border-b border-border py-2.5">
          <dt className="text-sm text-fg-3">{k}</dt><dd className="num text-sm text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Effect({ a }: { a: Activity }) {
  if (!(a.aerobicTrainingEffect || a.anaerobicTrainingEffect)) return null
  const bar = (v: number) => <div className="mt-2 flex gap-0.5">{[1, 2, 3, 4, 5].map(i => <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: v >= i ? 'var(--accent)' : v > i - 1 ? `color-mix(in oklch, var(--accent) ${Math.round((v - i + 1) * 100)}%, var(--sunken))` : 'var(--sunken)' }} />)}</div>
  return (
    <Card>
      <CardHeader title="Training effect" description="Garmin, on a 0–5 scale" />
      <CardBody className="grid gap-5 sm:grid-cols-2">
        {!!a.aerobicTrainingEffect && <div><Stat label="Aerobic" value={a.aerobicTrainingEffect.toFixed(1)} size="md" sub={sentence(a.aerobicTrainingEffectMessage)} />{bar(a.aerobicTrainingEffect)}</div>}
        {!!a.anaerobicTrainingEffect && <div><Stat label="Anaerobic" value={a.anaerobicTrainingEffect.toFixed(1)} size="md" sub={sentence(a.anaerobicTrainingEffectMessage)} />{bar(a.anaerobicTrainingEffect)}</div>}
      </CardBody>
    </Card>
  )
}

function Zones({ a }: { a: Activity }) {
  const hr = HR_ZONES.map((z, i) => ({ ...z, s: a[`hrTimeInZone_${i + 1}`] || 0 }))
  const pw = HR_ZONES.map((z, i) => ({ ...z, name: `P${i + 1}`, s: a[`powerTimeInZone_${i + 1}`] || 0 }))
  const sets = [['Heart rate zones', hr], ['Power zones', pw]] as const
  const visible = sets.filter(([, z]) => z.some(x => x.s > 0))
  if (!visible.length) return null
  return (
    <Card>
      <CardHeader title="Zones" />
      <CardBody className="space-y-5">
        {visible.map(([title, zones]) => {
          const total = zones.reduce((s, z) => s + z.s, 0)
          return (
            <div key={title}>
              <div className="mb-2 text-sm font-medium text-fg-2">{title}</div>
              <div className="mb-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full">{zones.filter(z => z.s > 0).map(z => <div key={z.name} style={{ width: `${(z.s / total) * 100}%`, background: z.color }} />)}</div>
              <div className="grid grid-cols-5 gap-2">
                {zones.map(z => <div key={z.name}><div className="flex items-center gap-1.5 text-xs text-fg-3"><span className="size-2 rounded-[2px]" style={{ background: z.color }} />{z.name}</div><div className="num text-sm">{z.s ? hm(z.s) : '—'}</div></div>)}
              </div>
            </div>
          )
        })}
      </CardBody>
    </Card>
  )
}

function Splits({ a, d }: { a: Activity; d?: ActivityDetail }) {
  const splits = (d?.splitSummaries || []).filter(s => (s.distance || 0) > 0 || (s.duration || 0) > 0)
  if (!splits.length) return null
  const sport = sportOf(a)
  return (
    <Card className="mt-5 overflow-hidden">
      <CardHeader title="Intervals and splits" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-y border-border bg-sunken text-left text-xs text-fg-3">
            {['Type', 'Count', 'Distance', 'Time', 'Pace', 'Avg HR', 'Max HR', 'Avg power', 'NP', 'Cadence', 'Calories'].map((h, i) => <th key={h} className={`py-2 font-medium ${i === 0 ? 'pl-5' : 'px-3'}`}>{h}</th>)}
          </tr></thead>
          <tbody>
            {splits.map((s, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="py-2.5 pl-5"><Badge>{SPLIT_LABEL[s.splitType] || sentence(s.splitType)}</Badge></td>
                <td className="num px-3 text-fg-2">{s.noOfSplits || 1}</td>
                <td className="num px-3">{miles(s.distance) ?? '—'}</td>
                <td className="num px-3">{duration(s.movingDuration || s.duration) ?? '—'}</td>
                <td className="num px-3">{speedFor(s.averageMovingSpeed || s.averageSpeed, sport) ?? '—'}</td>
                <td className="num px-3">{s.averageHR ? Math.round(s.averageHR) : '—'}</td>
                <td className="num px-3">{s.maxHR ? Math.round(s.maxHR) : '—'}</td>
                <td className="num px-3">{s.averagePower ? `${Math.round(s.averagePower)} W` : '—'}</td>
                <td className="num px-3">{s.normalizedPower ? `${Math.round(s.normalizedPower)} W` : '—'}</td>
                <td className="num px-3">{s.averageRunCadence ? Math.round(s.averageRunCadence) : '—'}</td>
                <td className="num px-3">{s.calories || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

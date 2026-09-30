import { useMemo } from 'react'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { useAirportDetail, useAirportInfo, useMetar } from '@/lib/queries'
import { brief, type Verdict } from '@/lib/weather'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function useAirportBrief(icao: string) {
  const metar = useMetar(icao)
  const info = useAirportInfo(icao)
  const detail = useAirportDetail(icao)
  const b = useMemo(() => (metar.data ? brief(metar.data, info.data ?? null, detail.data?.runways ?? []) : null), [metar.data, info.data, detail.data])
  const nice = useMemo(() => (info.data ? { ...info.data, name: niceName(info.data.name), city: niceName(info.data.city) } : info.data), [info.data])
  return { brief: b, metar: metar.data, info: nice, detail: detail.data, isLoading: metar.isLoading }
}

// The FAA feed shouts ("SAN JOSE/REID-HILLVIEW OF SANTA CLARA COUNTY"); title-case it for reading.
function niceName(s?: string) {
  if (!s || s !== s.toUpperCase()) return s
  return s.toLowerCase().replace(/(^|[\s/(-])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase()).replace(/\b(Of|The|And)\b/g, w => w.toLowerCase())
}

const CAT_TONE: Record<string, string> = {
  VFR: 'bg-good-soft text-good', MVFR: 'bg-accent-soft text-accent', IFR: 'bg-bad-soft text-bad', LIFR: 'bg-[color-mix(in_oklch,var(--c5)_16%,transparent)] text-c5',
}
export function CategoryBadge({ cat }: { cat: string }) {
  return <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 font-mono text-xs font-semibold', CAT_TONE[cat] || 'bg-sunken text-fg-2')}>{cat}</span>
}

export function VerdictBadge({ verdict, reasons, large }: { verdict: Verdict; reasons?: string[]; large?: boolean }) {
  const m = verdict === 'GO' ? { tone: 'good' as const, icon: CheckCircle2, label: 'Go' } : verdict === 'CAUTION' ? { tone: 'warn' as const, icon: AlertTriangle, label: 'Caution' } : { tone: 'bad' as const, icon: XCircle, label: 'No-go' }
  return (
    <Badge tone={m.tone} size="md" className={cn(large && 'h-7 px-3 text-sm [&_svg]:size-4')}>
      <m.icon />{m.label}{reasons?.length ? <span className="font-normal opacity-80">· {reasons.join(' · ')}</span> : null}
    </Badge>
  )
}

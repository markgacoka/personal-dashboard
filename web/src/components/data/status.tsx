import { AlertTriangle, CheckCircle2, Clock, MinusCircle, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { CurrencyState } from '@/lib/flying'

const MAP: Record<CurrencyState, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; icon: typeof CheckCircle2 }> = {
  current: { label: 'Current', tone: 'good', icon: CheckCircle2 },
  expiring: { label: 'Expiring', tone: 'warn', icon: AlertTriangle },
  grace: { label: 'Grace period', tone: 'warn', icon: Clock },
  lapsed: { label: 'Lapsed', tone: 'bad', icon: XCircle },
  na: { label: 'Not applicable', tone: 'neutral', icon: MinusCircle },
}

export function StatusBadge({ state, label }: { state: CurrencyState; label?: string }) {
  const m = MAP[state]
  return <Badge tone={m.tone} size="md"><m.icon />{label || m.label}</Badge>
}

export const stateTone = (s: CurrencyState) => MAP[s].tone

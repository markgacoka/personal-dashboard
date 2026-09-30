import type { Activity, DailyStats } from '@/lib/types'

export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

export interface Readiness {
  date?: string
  sleep: { seconds: number | null; score: number | null; qualifier: string | null; deep: number | null; light: number | null; rem: number | null }
  hrv: { status: string | null; label: string | null; tone: Tone; lastNight: number | null; weekly: number | null }
  bodyBattery: { value: number | null; label: string | null; tone: Tone }
  rhr: { value: number | null; baseline: number | null; delta: number | null; label: string | null; tone: Tone }
  vo2max: { value: number | null; label: string | null; tone: Tone }
  spo2: { value: number | null; label: string | null; tone: Tone }
  load7: number
  headline: string
  tone: Tone
}

const HRV: Record<string, [string, Tone]> = {
  OPTIMAL: ['Optimal', 'good'], BALANCED: ['Balanced', 'good'], UNBALANCED: ['Unbalanced', 'warn'],
  LOW_POOR_SLEEP: ['Low', 'bad'], POOR_SLEEP_QUALITY: ['Low', 'bad'], LOW: ['Low', 'bad'],
}
const SLEEPQ: Record<string, Tone> = { EXCELLENT: 'good', GOOD: 'good', FAIR: 'warn', POOR: 'bad' }

export function readiness(activities: Activity[], d: DailyStats | undefined, now = Date.now()): Readiness {
  const load7 = Math.round(activities
    .filter(a => now - new Date(a.startTimeLocal).getTime() < 7 * 86_400_000)
    .reduce((s, a) => s + (a.activityTrainingLoad || 0), 0))

  const s = d?.sleep?.dailySleepDTO
  const secs = s?.sleepTimeSeconds || null
  const pct = (v?: number) => (secs && v != null ? Math.round((v / secs) * 100) : null)
  const q = s?.sleepScores?.overall

  const hrvStatus = d?.hrv?.hrvSummary?.status ?? null
  const [hrvLabel, hrvTone] = hrvStatus ? HRV[hrvStatus] ?? [hrvStatus.replace(/_/g, ' ').toLowerCase(), 'neutral' as Tone] : [null, 'neutral' as Tone]

  const bb = d?.daily_summary?.bodyBatteryMostRecentValue ?? null
  const bbTone: Tone = bb == null ? 'neutral' : bb >= 50 ? 'good' : bb >= 25 ? 'warn' : 'bad'
  const bbLabel = bb == null ? null : bb >= 75 ? 'High' : bb >= 50 ? 'Moderate' : bb >= 25 ? 'Low' : 'Very low'

  const rhr = d?.heart_rate?.restingHeartRate ?? null
  const base = d?.heart_rate?.lastSevenDaysAvgRestingHeartRate ?? null
  const delta = rhr != null && base != null ? rhr - base : null
  const [rhrLabel, rhrTone]: [string | null, Tone] = delta == null ? [null, 'neutral']
    : delta > 4 ? ['Elevated', 'bad'] : delta > 1 ? ['Slightly elevated', 'warn'] : delta <= -2 ? ['Well recovered', 'good'] : ['At baseline', 'neutral']

  const vo2 = d?.vo2max ? Math.round(d.vo2max) : null
  const [vo2Label, vo2Tone]: [string | null, Tone] = vo2 == null ? [null, 'neutral']
    : vo2 >= 55 ? ['Excellent', 'good'] : vo2 >= 48 ? ['Good', 'good'] : vo2 >= 40 ? ['Average', 'neutral'] : ['Below average', 'warn']

  const spo2raw = d?.sleep?.wellnessSpO2SleepSummaryDTO?.averageSPO2 ?? s?.averageSpO2Value ?? null
  const spo2 = spo2raw != null ? Math.round(spo2raw) : null
  const [spo2Label, spo2Tone]: [string | null, Tone] = spo2 == null ? [null, 'neutral'] : spo2 >= 97 ? ['Optimal', 'good'] : spo2 >= 95 ? ['Normal', 'neutral'] : ['Low', 'bad']

  const sleepTone: Tone = q?.qualifierKey ? SLEEPQ[q.qualifierKey] ?? 'neutral' : secs ? (secs < 7 * 3600 ? 'warn' : 'good') : 'neutral'

  // One-line summary, worst signal first.
  const tones = [sleepTone, hrvTone, bbTone, rhrTone]
  const tone: Tone = tones.includes('bad') ? 'bad' : tones.includes('warn') ? 'warn' : tones.includes('good') ? 'good' : 'neutral'
  const headline = tone === 'good' ? 'Recovered and ready to train'
    : tone === 'warn' ? 'Partly recovered — keep today moderate'
    : tone === 'bad' ? 'Recovery is low — favour rest or easy work'
    : 'Waiting for today’s recovery data'

  return {
    date: d?.date,
    sleep: { seconds: secs, score: q?.value ?? null, qualifier: q?.qualifierKey ?? null, deep: pct(s?.deepSleepSeconds), light: pct(s?.lightSleepSeconds), rem: pct(s?.remSleepSeconds) },
    hrv: { status: hrvStatus, label: hrvLabel, tone: hrvTone, lastNight: d?.hrv?.hrvSummary?.lastNightAvg ?? null, weekly: d?.hrv?.hrvSummary?.weeklyAvg ?? null },
    bodyBattery: { value: bb, label: bbLabel, tone: bbTone },
    rhr: { value: rhr, baseline: base, delta, label: rhrLabel, tone: rhrTone },
    vo2max: { value: vo2, label: vo2Label, tone: vo2Tone },
    spo2: { value: spo2, label: spo2Label, tone: spo2Tone },
    load7, headline, tone,
  }
}

import { Activity as ActivityIcon, Bike, Dumbbell, Footprints, Mountain, Sailboat, Waves, Flower2, HeartPulse, Snowflake, Flag, type LucideIcon } from 'lucide-react'
import type { Activity } from './types'

export type Sport = 'running' | 'cycling' | 'swimming' | 'strength' | 'rowing' | 'walking' | 'hiking' | 'yoga' | 'cardio' | 'skiing' | 'golf' | 'other'

// Chart colours follow the validated categorical order; the five primary sports
// take the first slots so the volume chart never needs more than six series.
export const SPORTS: Record<Sport, { label: string; short: string; icon: LucideIcon; color: string }> = {
  running:  { label: 'Running',  short: 'Run',      icon: Footprints, color: 'var(--c1)' },
  cycling:  { label: 'Cycling',  short: 'Ride',     icon: Bike,       color: 'var(--c2)' },
  swimming: { label: 'Swimming', short: 'Swim',     icon: Waves,      color: 'var(--c3)' },
  strength: { label: 'Strength', short: 'Strength', icon: Dumbbell,   color: 'var(--c4)' },
  rowing:   { label: 'Rowing',   short: 'Row',      icon: Sailboat,   color: 'var(--c5)' },
  walking:  { label: 'Walking',  short: 'Walk',     icon: Footprints, color: 'var(--c7)' },
  hiking:   { label: 'Hiking',   short: 'Hike',     icon: Mountain,   color: 'var(--c7)' },
  yoga:     { label: 'Yoga',     short: 'Yoga',     icon: Flower2,    color: 'var(--c7)' },
  cardio:   { label: 'Cardio',   short: 'Cardio',   icon: HeartPulse, color: 'var(--c7)' },
  skiing:   { label: 'Skiing',   short: 'Ski',      icon: Snowflake,  color: 'var(--c7)' },
  golf:     { label: 'Golf',     short: 'Golf',     icon: Flag,       color: 'var(--c7)' },
  other:    { label: 'Other',    short: 'Other',    icon: ActivityIcon, color: 'var(--c7)' },
}

export const PRIMARY: Sport[] = ['running', 'cycling', 'swimming', 'strength', 'rowing']

export function sportOf(a: Pick<Activity, 'activityType'>): Sport {
  const l = (a.activityType?.typeKey || '').toLowerCase()
  if (!l) return 'other'
  if (l.includes('run')) return 'running'
  if (/cycl|bike|ride|biking|gravel/.test(l)) return 'cycling'
  if (l.includes('swim')) return 'swimming'
  if (l.includes('row')) return 'rowing'
  if (l.includes('walk')) return 'walking'
  if (l.includes('hik')) return 'hiking'
  if (/strength|weight|crossfit|circuit|core|functional|power|bouldering_indoor/.test(l)) return 'strength'
  if (/yoga|pilates|flex|stretch|breath|meditat/.test(l)) return 'yoga'
  if (/elliptical|stair|cardio|hiit|aerobic|jump_rope|box|martial|dance|gymnastic/.test(l)) return 'cardio'
  if (/ski|snowboard|backcountry/.test(l)) return 'skiing'
  if (l.includes('golf')) return 'golf'
  return 'other'
}

// Volume-chart bucket: primary sports keep their colour, everything else is Other.
export const bucketOf = (s: Sport): Sport => (PRIMARY.includes(s) ? s : 'other')

export const HR_ZONES = [
  { name: 'Z1', long: 'Recovery', color: 'var(--c1)' },
  { name: 'Z2', long: 'Base', color: 'var(--c3)' },
  { name: 'Z3', long: 'Tempo', color: 'var(--c4)' },
  { name: 'Z4', long: 'Threshold', color: 'var(--c2)' },
  { name: 'Z5', long: 'VO₂ max', color: 'var(--c8)' },
]

export const TE_LABEL: Record<string, string> = {
  vo2max: 'VO₂ max', aerobic_base: 'Base', aerobic_capacity: 'Capacity', lactate_threshold: 'Threshold',
  anaerobic: 'Anaerobic', tempo: 'Tempo', recovery: 'Recovery',
}

export const SPLIT_LABEL: Record<string, string> = {
  INTERVAL_WARMUP: 'Warm-up', INTERVAL_ACTIVE: 'Active', INTERVAL_RECOVERY: 'Recovery', INTERVAL_COOLDOWN: 'Cool-down',
  RWD_RUN: 'Run', RWD_STAND: 'Stand', RWD_WALK: 'Walk',
}

export const actDuration = (a: Activity) => a.movingDuration || a.duration || 0
export const actDay = (a: Activity) => (a.startTimeLocal || '').slice(0, 10)

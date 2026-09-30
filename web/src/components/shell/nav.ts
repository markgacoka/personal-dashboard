import { Activity, BedDouble, BookOpen, CloudSun, Crown, Home, IdCard, Inbox, Landmark, PlugZap, UserRound, type LucideIcon } from 'lucide-react'

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; keywords?: string }
export interface NavGroup { label?: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { items: [{ to: '/', label: 'Today', icon: Home, end: true, keywords: 'overview home brief' }] },
  { label: 'Body', items: [
    { to: '/training', label: 'Training', icon: Activity, keywords: 'activities fitness garmin workouts' },
    { to: '/sleep', label: 'Sleep', icon: BedDouble, keywords: 'recovery hrv' },
  ] },
  { label: 'Flying', items: [
    { to: '/flying', label: 'Logbook', icon: BookOpen, end: true, keywords: 'flights log' },
    { to: '/flying/weather', label: 'Airport brief', icon: CloudSun, keywords: 'weather metar taf notam wind' },
    { to: '/flying/pilot', label: 'Pilot', icon: IdCard, keywords: 'credentials certificate medical currency' },
  ] },
  { label: 'Money', items: [
    { to: '/money', label: 'Net worth', icon: Landmark, end: true, keywords: 'finance accounts holdings' },
    { to: '/money/connections', label: 'Connections', icon: PlugZap, keywords: 'plaid link accounts institutions' },
  ] },
  { label: 'Play', items: [{ to: '/chess', label: 'Chess', icon: Crown, keywords: 'rating games chess.com' }] },
  { label: 'Communicate', items: [{ to: '/mail', label: 'Mail', icon: Inbox, keywords: 'email inbox' }] },
]

export const ACCOUNT: NavItem = { to: '/account', label: 'Account', icon: UserRound, keywords: 'security sign out two-factor passkey' }

export const ALL_NAV = [...NAV.flatMap(g => g.items), ACCOUNT]

// Title for the top bar's first crumb, by path prefix.
export function sectionFor(path: string) {
  if (path === '/') return 'Today'
  const best = ALL_NAV.filter(n => n.to !== '/' && (path === n.to || path.startsWith(n.to + '/')))
    .sort((a, b) => b.to.length - a.to.length)[0]
  if (path.startsWith('/mail/settings')) return 'Mail settings'
  return best?.label ?? ''
}

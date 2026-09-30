import { num } from './utils'

const M_PER_MI = 1609.344

export function miles(m?: number | null) {
  if (!m) return null
  const mi = m / M_PER_MI
  return mi >= 0.05 ? `${mi.toFixed(mi >= 100 ? 0 : 2)} mi` : `${Math.round(m)} m`
}

export function duration(sec?: number | null, { seconds = true } = {}) {
  if (!sec) return null
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return seconds ? `${m}m ${String(s).padStart(2, '0')}s` : `${m}m`
  return `${s}s`
}

export function hm(sec?: number | null) {
  if (!sec) return null
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function pace(mps?: number | null) {
  if (!mps || mps <= 0) return null
  const spm = M_PER_MI / mps
  return `${Math.floor(spm / 60)}:${String(Math.round(spm % 60)).padStart(2, '0')} /mi`
}

export function speedFor(mps: number | undefined | null, sport: string) {
  if (!mps) return null
  return sport === 'cycling' ? `${(mps * 2.23694).toFixed(1)} mph` : pace(mps)
}

export function hours(v: unknown, digits = 1) {
  const n = num(v)
  return n > 0 ? n.toFixed(digits) : null
}

export const int = (n: number) => Math.round(n).toLocaleString('en-US')

// Flight and daily-stat dates are calendar dates ("2026-08-19" or midnight UTC).
// Anchor at UTC noon and format in UTC so the day never shifts with the viewer's zone.
export function calDate(value: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
}

export const calKey = (value: string) => String(value).slice(0, 10)

export function localDate(value: string | number | Date, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  return new Date(value).toLocaleDateString('en-US', opts)
}

export function relTime(value: string | number | Date, now = Date.now()) {
  const diff = (now - new Date(value).getTime()) / 1000
  const abs = Math.abs(diff)
  const fmt = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`
  const s = abs < 60 ? 'just now'
    : abs < 3600 ? fmt(Math.round(abs / 60), 'min')
    : abs < 86400 ? fmt(Math.round(abs / 3600), 'hour')
    : abs < 86400 * 30 ? fmt(Math.round(abs / 86400), 'day')
    : abs < 86400 * 365 ? fmt(Math.round(abs / 86400 / 30), 'month')
    : fmt(Math.round(abs / 86400 / 365), 'year')
  if (s === 'just now') return s
  return diff >= 0 ? `${s} ago` : `in ${s}`
}

export function dollars(n: number | null | undefined, { compact = false, cents = true } = {}) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (compact) {
    const abs = Math.abs(n)
    const s = abs >= 1e6 ? `$${(abs / 1e6).toFixed(2)}M` : abs >= 1e4 ? `$${(abs / 1e3).toFixed(1)}k` : `$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    return n < 0 ? `−${s}` : s
  }
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })
  return `${n < 0 ? '−' : ''}$${s}`
}

export function signed(n: number, f: (n: number) => string = v => String(v)) {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${f(Math.abs(n))}`
}

export function pct(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}%`
}

export function bytes(n?: number) {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function titleCase(s?: string | null) {
  if (!s) return ''
  return s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function sentence(s?: string | null) {
  if (!s) return ''
  const t = s.toLowerCase().replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// Mail list date: time today, "Sep 28" this year, "Sep 28, 2025" before.
export function mailDate(iso: string, now = new Date()) {
  const d = new Date(iso)
  if (isNaN(+d)) return ''
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

export function mailDateLong(iso: string) {
  const d = new Date(iso)
  if (isNaN(+d)) return ''
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined, hour: 'numeric', minute: '2-digit' })
}

export function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

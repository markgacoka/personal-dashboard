import type { Addr } from './api'

// One typed recipient ("Ana Lee <ana@x.com>" or a bare address) → {name, email}, or null when it isn't an address.
export const parseToken = (text: string): Addr | null => {
  const t = text.trim().replace(/[,;]+$/, '')
  const m = t.match(/^(.*?)<([^>]+)>$/)
  const email = (m ? m[2] : t).trim()
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(email)) return null
  const name = m ? m[1].trim().replace(/^"(.*)"$/, '$1').trim() : ''
  return { name: name || null, email }
}

export function schedulePresets(now = new Date()) {
  const at = (days: number, hour: number) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d }
  const out: { label: string; at: Date }[] = []
  if (now.getHours() < 17) out.push({ label: 'This evening', at: at(0, 18) })
  out.push({ label: 'Tomorrow morning', at: at(1, 8) }, { label: 'Tomorrow afternoon', at: at(1, 13) }, { label: 'Monday morning', at: at(((8 - now.getDay()) % 7) || 7, 8) })
  return out
}

import { useState } from 'react'
import { cn } from '@/lib/utils'

const INST: [string, { domain: string; kind: string }][] = [
  ['wealthfront', { domain: 'wealthfront.com', kind: 'Automated investing' }],
  ['fidelity', { domain: 'fidelity.com', kind: 'Brokerage · 401(k)' }],
  ['sofi', { domain: 'sofi.com', kind: 'Banking · investing' }],
  ['e*trade', { domain: 'etrade.com', kind: 'Brokerage' }],
  ['morgan stanley', { domain: 'morganstanley.com', kind: 'Wealth management' }],
  ['chase', { domain: 'chase.com', kind: 'Banking' }],
  ['bank of america', { domain: 'bankofamerica.com', kind: 'Banking' }],
  ['wells fargo', { domain: 'wellsfargo.com', kind: 'Banking' }],
  ['vanguard', { domain: 'vanguard.com', kind: 'Brokerage · retirement' }],
  ['schwab', { domain: 'schwab.com', kind: 'Brokerage' }],
  ['robinhood', { domain: 'robinhood.com', kind: 'Brokerage' }],
  ['betterment', { domain: 'betterment.com', kind: 'Robo-advisor' }],
  ['ally', { domain: 'ally.com', kind: 'Banking' }],
  ['american express', { domain: 'americanexpress.com', kind: 'Credit card' }],
  ['usaa', { domain: 'usaa.com', kind: 'Banking' }],
]

export function institutionMeta(name?: string | null) {
  const key = (name || '').toLowerCase()
  return INST.find(([k]) => key.includes(k))?.[1] || { domain: null, kind: 'Financial institution' }
}

export function InstitutionAvatar({ name, size = 'md' }: { name?: string | null; size?: 'sm' | 'md' }) {
  const { domain } = institutionMeta(name)
  const [broken, setBroken] = useState(false)
  const cls = size === 'sm' ? 'size-8 rounded-md text-xs' : 'size-11 rounded-lg text-sm'
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden bg-sunken font-semibold text-fg-2 ring-1 ring-inset ring-border', cls)}>
      {domain && !broken
        ? <img src={`https://www.google.com/s2/favicons?domain_url=https://${domain}&sz=64`} alt="" className="size-3/5 object-contain" onError={() => setBroken(true)} />
        : (name || '?')[0].toUpperCase()}
    </span>
  )
}

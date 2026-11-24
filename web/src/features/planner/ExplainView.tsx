import { AlertTriangle, Check, X } from 'lucide-react'
import { Dot } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/misc'
import { relTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { inEnvelope } from './calc'
import type { Expl, InputSource, Tier } from './explain'
import { TIER_LABEL } from './explain'
import type { Derived, RowOverride } from './model'

export const TIER_COLOR: Record<Tier, string> = { primary: 'var(--good)', backup: 'var(--warn)', yours: 'var(--accent)', standin: 'var(--warn)' }

export function TierTag({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-[13px]', tier === 'standin' ? 'text-fg-2' : 'text-fg-3', className)}>
      <Dot color={TIER_COLOR[tier]} />{TIER_LABEL[tier]}
    </span>
  )
}

// What the NavLog and W&B rest on, one chip per input, colored by what was used.
export function SourceStrip({ list }: { list: InputSource[] }) {
  if (!list.length) return null
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-fg-2">Inputs</h3>
        <span className="text-[13px] text-fg-3 max-sm:hidden">Select a row to see how it was worked out</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {list.map(s => (
          <li key={s.key}>
            <Tooltip content={<span className="block text-[13px] leading-snug">{s.detail}{s.at && <span className="mt-1 block text-fg-3">Fetched {relTime(new Date(s.at))}</span>}</span>}>
              <span tabIndex={0} className={cn('inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] ring-1 ring-inset', s.tier === 'standin' ? 'bg-hover ring-border-strong' : 'ring-border')}>
                <Dot color={TIER_COLOR[s.tier]} />
                <span className="text-fg-3">{s.label}</span>
                <span className={'text-fg-2'}>{s.value}</span>
              </span>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  )
}

const EDIT_LABEL: Record<keyof RowOverride, { label: string; unit: string }> = { wdir: { label: 'Wind from', unit: '°' }, wspd: { label: 'Speed', unit: 'kt' }, temp: { label: 'Temp', unit: '°C' }, cas: { label: 'CAS', unit: 'kt' } }

// One quantity: its answer, the arithmetic, the source and its backup, what it
// assumes, and whether the answer lands where a right one should.
export function ExplCard({ e, ov, onEdit, className }: { e: Expl; ov?: RowOverride; onEdit?: (f: keyof RowOverride, v: number | null) => void; className?: string }) {
  const ok = e.expect.ok
  return (
    <li className={cn('px-3 py-3', className)}>
      <div className="flex items-baseline gap-3">
        <h4 className="min-w-0 flex-1 text-sm font-medium text-fg">{e.title}</h4>
        <span className="num shrink-0 text-[13px] font-medium text-fg">{e.value}</span>
      </div>
      <dl className="mt-2 space-y-1.5">
        {e.steps.map((l, k) => {
          const at = l.v.lastIndexOf(' = ')
          const [expr, res] = at > 0 ? [l.v.slice(0, at), l.v.slice(at + 3)] : [null, l.v]
          return (
            <div key={k} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 text-[13px] leading-snug">
              <dt className="text-fg-3">{l.k}</dt>
              <dd className="num min-w-0 break-words">{expr && <span className="text-fg-3">{expr} = </span>}<span className={expr ? 'font-medium text-fg' : 'text-fg-2'}>{res}</span></dd>
            </div>
          )
        })}
      </dl>
      <div className="mt-3 space-y-1.5 border-t border-border pt-2.5 text-[13px] leading-snug">
        <div className="flex items-start gap-3">
          <span className="w-[7.5rem] shrink-0 text-fg-3">Source</span>
          <span className="min-w-0 flex-1 text-fg-2">{e.source.used}{e.source.at && <span className="text-fg-3"> · {relTime(new Date(e.source.at))}</span>}</span>
          <TierTag tier={e.source.tier} />
        </div>
        {e.source.backup && <div className="flex gap-3"><span className="w-[7.5rem] shrink-0 text-fg-3">Backup</span><span className="min-w-0 flex-1 text-fg-3">{e.source.backup}</span></div>}
        {e.assumes.length > 0 && (
          <div className="flex gap-3"><span className="w-[7.5rem] shrink-0 text-fg-3">Assumes</span>
            <ul className="min-w-0 flex-1 space-y-0.5 text-fg-3">{e.assumes.map((a, k) => <li key={k}>{a}</li>)}</ul></div>
        )}
        <div className="flex gap-3">
          <span className="w-[7.5rem] shrink-0 text-fg-3">Expect</span>
          <span className={cn('flex min-w-0 flex-1 items-start gap-1.5', ok === false ? 'text-warn' : 'text-fg-3')}>
            {ok === true && <Check className="mt-0.5 size-3.5 shrink-0 text-good" aria-label="Within range" />}
            {ok === false && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-label="Outside range" />}
            {e.expect.text}
          </span>
        </div>
      </div>
      {e.edit && onEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {e.edit.map(f => (
            <label key={f} className="block w-24">
              <span className="mb-1 block text-[13px] text-fg-3">{EDIT_LABEL[f].label}</span>
              <span className="relative block">
                <input type="number" inputMode="decimal" value={ov?.[f] ?? ''} placeholder="—" onChange={ev => onEdit(f, ev.target.value === '' ? null : Number(ev.target.value))} onWheel={ev => ev.currentTarget.blur()}
                  className={cn('num h-8 w-full rounded-md bg-sunken pl-2 pr-7 text-[13px] text-fg outline-none ring-1 ring-inset ring-border focus:ring-accent', ov?.[f] != null && 'text-accent ring-accent/50')} />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[13px] text-fg-3">{EDIT_LABEL[f].unit}</span>
              </span>
            </label>
          ))}
          {e.edit.some(f => ov?.[f] != null) && <button onClick={() => e.edit!.forEach(f => onEdit(f, null))} className="inline-flex h-8 items-center gap-1 px-1 text-[13px] text-fg-3 hover:text-fg"><X className="size-3.5" />Use the source</button>}
        </div>
      )}
    </li>
  )
}

// The CG envelope with this flight's loading: ramp, each takeoff and landing,
// joined in order (fuel burn moves the CG along the line). Points outside are red.
export function CgChart({ d, focus, onFocus }: { d: Derived; focus: number | null; onFocus: (i: number) => void }) {
  const p = d.profile
  if (!p || !d.wb.steps.length) return null
  const env = p.envelope.normal
  const pts = d.wb.steps.map((s, i) => ({ s, i })).filter(x => x.s.total && x.s.weight > 0).map(x => ({ ...x, cg: x.s.moment / x.s.weight }))
  const xs = [...env.map(e => e[0]), ...pts.map(q => q.cg)], ys = [...env.map(e => e[1]), ...pts.map(q => q.s.weight)]
  const x0 = Math.floor(Math.min(...xs) - 1), x1 = Math.ceil(Math.max(...xs) + 1)
  const y0 = Math.floor((Math.min(...ys) - 50) / 100) * 100, y1 = Math.ceil((Math.max(...ys) + 50) / 100) * 100
  const W = 560, H = 260, L = 44, R = 12, T = 12, B = 30
  const sx = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R), sy = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B)
  const xt = Array.from({ length: x1 - x0 + 1 }, (_, k) => x0 + k).filter(v => v % 2 === 0)
  const yt = Array.from({ length: (y1 - y0) / 100 + 1 }, (_, k) => y0 + k * 100).filter(v => v % 200 === 0)
  return (
    <figure className="max-w-3xl">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`CG envelope with ${pts.map(q => `${q.s.label} ${Math.round(q.s.weight)} lb at ${q.cg.toFixed(1)} in`).join(', ')}`}>
        {yt.map(v => <g key={v}><line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} stroke="var(--border)" strokeWidth={1} /><text x={L - 6} y={sy(v)} dy="0.32em" textAnchor="end" className="num fill-fg-3 text-[11px]">{v.toLocaleString()}</text></g>)}
        {xt.map(v => <text key={v} x={sx(v)} y={H - 10} textAnchor="middle" className="num fill-fg-3 text-[11px]">{v}</text>)}
        <polygon points={env.map(([a, w]) => `${sx(a)},${sy(w)}`).join(' ')} fill="var(--fg)" fillOpacity={0.06} stroke="var(--border-strong)" strokeWidth={1.5} />
        <polygon points={p.envelope.utility.map(([a, w]) => `${sx(a)},${sy(w)}`).join(' ')} fill="none" stroke="var(--fg-3)" strokeDasharray="4 3" strokeWidth={1} />
        {([[p.limits.maxTakeoff, p.limits.maxLanding === p.limits.maxTakeoff ? 'takeoff and landing' : 'takeoff'], ...(Math.abs(p.limits.maxLanding - p.limits.maxTakeoff) > 40 ? [[p.limits.maxLanding, 'landing']] : [])] as [number, string][]).map(([w, l]) => (
          <text key={String(l)} x={W - R - 2} y={sy(Number(w)) - 4} textAnchor="end" className="num fill-fg-3 text-[11px]">max {l} {Number(w).toLocaleString()}</text>
        ))}
        <polyline points={pts.map(q => `${sx(q.cg)},${sy(q.s.weight)}`).join(' ')} fill="none" stroke="var(--fg-3)" strokeWidth={2} strokeLinejoin="round" />
        {pts.map(q => {
          const out = q.s.over || !inEnvelope(env, q.cg, q.s.weight), on = focus === q.i
          return (
            <g key={q.i} className="cursor-pointer" onClick={() => onFocus(q.i)}>
              <title>{`${q.s.label}: ${Math.round(q.s.weight).toLocaleString()} lb, CG ${q.cg.toFixed(2)} in${out ? ' (outside)' : ''}`}</title>
              <circle cx={sx(q.cg)} cy={sy(q.s.weight)} r={14} fill="transparent" />
              <circle cx={sx(q.cg)} cy={sy(q.s.weight)} r={on ? 6 : 4.5} fill={out ? 'var(--bad)' : on ? 'var(--accent)' : 'var(--fg)'} stroke="var(--card)" strokeWidth={2} />
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap justify-between gap-2 text-[13px] text-fg-3">
        <span>Weight (lb) against CG (in aft of datum). Shaded: normal category; dashed: utility category.</span>
        <span className="num">{pts.map(q => `${q.s.label.replace(/^Takeoff$/, 'T/O')} ${q.cg.toFixed(1)}`).join(' · ')}</span>
      </figcaption>
    </figure>
  )
}

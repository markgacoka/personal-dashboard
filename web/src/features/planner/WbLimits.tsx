import { cn } from '@/lib/utils'
import { cgRangeAt } from './calc'
import type { Derived, Plan, Status } from './model'
import { loadsOf } from './model'
import { StatusIcon } from './ui'
import { toW, type Units, US } from './units'

interface Row { key: string; label: string; sub?: string; domain: [number, number]; band: [number, number] | null; value: number; status: Status; text: string; margin: string }

// Within this of a limit counts as close: 1 % of the maximum weight, 0.3 in of CG.
const NEAR_LB = 0.01, NEAR_IN = 0.3

// Each limit as a bar: the allowed range shaded, this flight's value as a line,
// and the margin to the nearest edge in words.
export function WbLimits({ d, plan, tank, u = US }: { d: Derived; plan: Plan; tank?: { label: string; usable: number; total: number }; u?: Units }) {
  const p = d.profile
  const totals = d.wb.steps.filter(s => s.total && s.weight > 0)
  if (!p || !totals.length) return null
  const env = p.envelope.normal, util = p.envelope.utility
  const W = (lb: number) => `${Math.round(toW(lb, u)).toLocaleString()} ${u.weight}`
  const bew = d.wb.items[0]?.weight ?? 0
  const maxW = Math.max(p.limits.maxRamp, ...totals.map(t => t.weight))
  const wDomain: [number, number] = [Math.floor(bew / 100) * 100, Math.ceil((maxW * 1.03) / 50) * 50]
  const arms = env.map(([a]) => a)
  const cgDomain: [number, number] = [Math.floor(Math.min(...arms, ...totals.map(t => t.arm ?? 0)) - 1), Math.ceil(Math.max(...arms, ...totals.map(t => t.arm ?? 0)) + 1)]

  const weightRows: Row[] = totals.map(t => {
    const max = t.max ?? p.limits.maxTakeoff, left = max - t.weight
    const status: Status = left < -1e-6 ? 'nogo' : left < max * NEAR_LB ? 'caution' : 'ok'
    return { key: `w${t.label}`, label: t.label, sub: `max ${W(max)}`, domain: wDomain, band: [wDomain[0], max], value: t.weight, status, text: W(t.weight), margin: left >= 0 ? `${W(left)} under` : `${W(-left)} over` }
  })
  const cgRows: Row[] = totals.map(t => {
    const cg = t.arm ?? 0, r = cgRangeAt(env, t.weight)
    const fwd = r ? cg - r.fwd : -1, aft = r ? r.aft - cg : -1
    const status: Status = !r || fwd < -1e-6 || aft < -1e-6 ? 'nogo' : Math.min(fwd, aft) < NEAR_IN ? 'caution' : 'ok'
    const ur = cgRangeAt(util, t.weight), utility = !!ur && cg >= ur.fwd - 1e-6 && cg <= ur.aft + 1e-6
    const margin = !r ? 'weight above the envelope' : fwd < 0 ? `${(-fwd).toFixed(1)} in forward of the limit` : aft < 0 ? `${(-aft).toFixed(1)} in aft of the limit` : `${fwd.toFixed(1)} in from forward · ${aft.toFixed(1)} from aft`
    return { key: `c${t.label}`, label: t.label, sub: r ? `${r.fwd.toFixed(1)}–${r.aft.toFixed(1)} in${utility ? ' · utility too' : ''}` : 'no range', domain: cgDomain, band: r ? [r.fwd, r.aft] : null, value: cg, status, text: `${cg.toFixed(1)} in`, margin }
  })
  const loads = loadsOf(plan)
  const bag = (key: string, label: string, v: number, max: number): Row => ({
    key, label, sub: `max ${W(max)}`, domain: [0, Math.max(max * 1.25, v * 1.05)], band: [0, max], value: v,
    status: v > max ? 'nogo' : 'ok', text: W(v), margin: v > max ? `${W(v - max)} over` : `${W(max - v)} spare`,
  })
  const st = Object.fromEntries(p.stations.map(s => [s.key, s]))
  const fuelGal = (d.wb.items[1]?.weight ?? 0) / 6
  const loadRows: Row[] = [
    bag('b1', 'Baggage area 1', loads.bag1, st.bag1?.max ?? 120),
    bag('b2', 'Baggage area 2', loads.bag2, st.bag2?.max ?? 50),
    bag('bc', 'Baggage combined', loads.bag1 + loads.bag2, p.limits.baggageCombined),
    ...(tank ? [{
      key: 'fuel', label: 'Fuel at the ramp', sub: `${tank.label.toLowerCase()} · ${tank.usable} gal usable`, domain: [0, tank.total] as [number, number], band: [0, tank.usable] as [number, number], value: fuelGal,
      status: (fuelGal > tank.usable + 1e-6 ? 'caution' : 'ok') as Status, text: `${+fuelGal.toFixed(1)} gal`, margin: fuelGal > tank.usable + 1e-6 ? 'more than the tanks hold' : tank.usable - fuelGal < 0.05 ? 'full' : `${+(tank.usable - fuelGal).toFixed(1)} gal room`,
    }] : []),
  ]
  return (
    <div className="max-w-4xl space-y-5">
      <Group title="Weight" note={`Each total against its maximum (POH Sec. 2). Scale from the empty weight, ${W(bew)}.`} rows={weightRows} />
      <Group title="Center of gravity" note="The allowed CG range at that weight, read off the normal-category envelope (it narrows above the knee)." rows={cgRows} />
      <Group title="Loading" note="Baggage areas and fuel." rows={loadRows} />
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-3">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-5 rounded-full bg-good-soft ring-1 ring-inset ring-good/40" />Allowed</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3.5 w-0.5 rounded-full bg-fg" />This flight</span>
        <span>Caution within 1 % of a weight limit or 0.3 in of a CG limit</span>
      </p>
    </div>
  )
}

function Group({ title, note, rows }: { title: string; note: string; rows: Row[] }) {
  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3"><h4 className="text-sm font-medium text-fg">{title}</h4><span className="text-[13px] text-fg-3">{note}</span></div>
      <ul className="divide-y divide-border">
        {rows.map(r => (
          <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-2 sm:grid-cols-[10rem_minmax(0,1fr)_14.5rem]">
            <div className="min-w-0"><div className="text-sm text-fg">{r.label}</div>{r.sub && <div className="num text-[13px] text-fg-3">{r.sub}</div>}</div>
            <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto"><Bar row={r} /></div>
            <div className="flex items-center justify-end gap-2 text-right sm:row-start-auto">
              <StatusIcon status={r.status} />
              <div className="sm:w-48"><div className="num text-sm text-fg">{r.text}</div><div className={cn('text-[13px]', r.status === 'nogo' ? 'text-bad' : r.status === 'caution' ? 'text-warn' : 'text-fg-3')}>{r.margin}</div></div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Bar({ row }: { row: Row }) {
  const [a, b] = row.domain
  const x = (v: number) => `${Math.min(100, Math.max(0, ((v - a) / (b - a)) * 100))}%`
  const out = row.status === 'nogo'
  return (
    <div className="relative h-4" role="img" aria-label={`${row.label}: ${row.text}${row.band ? `, allowed ${+row.band[0].toFixed(1)} to ${+row.band[1].toFixed(1)}` : ''}`}>
      <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-border" />
      {row.band && <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-good-soft ring-1 ring-inset ring-good/40" style={{ left: x(row.band[0]), width: `calc(${x(row.band[1])} - ${x(row.band[0])})` }} />}
      <div className={cn('absolute top-0 h-4 w-0.5 -translate-x-1/2 rounded-full ring-2 ring-card', out ? 'bg-bad' : 'bg-fg')} style={{ left: x(row.value) }} />
    </div>
  )
}

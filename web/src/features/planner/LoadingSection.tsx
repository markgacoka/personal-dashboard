import { Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { inEnvelope } from './calc'
import type { AircraftPlanning, Derived, Plan } from './model'
import type { AircraftProfile } from './poh'
import { NumField, SubHead } from './ui'
import { PohLink } from './RefPanel'
import { fromF, fromW, toF, toW, type Units, US } from './units'

export function LoadingSection({ plan, set, d, profile, planning, savePlanning, readOnly, u = US }: { plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; profile: AircraftProfile | null; planning: AircraftPlanning; savePlanning: (p: AircraftPlanning) => void; readOnly?: boolean; u?: Units }) {
  if (!profile) return <p className="text-sm text-fg-3">Choose the aircraft first.</p>
  const tank = profile.fuel.find(f => f.key === (planning.tanks || 'standard')) ?? profile.fuel[0]
  const loads = (k: keyof Plan['loads']) => (v: number) => set({ loads: { ...plan.loads, [k]: Math.max(0, fromW(v, u)) } })
  const W = (lb: number) => Math.round(toW(lb, u))
  const st = Object.fromEntries(profile.stations.map(s => [s.key, s]))
  const rows: [string, number, number][] = [
    ['Ramp', d.wb.ramp.weight, d.wb.ramp.cg], ['Takeoff', d.wb.takeoff.weight, d.wb.takeoff.cg], ['Landing', d.wb.landing.weight, d.wb.landing.cg],
  ]
  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <div className="space-y-5 xl:col-span-2">
        {!readOnly && <div className="grid grid-cols-2 gap-3">
          <NumField label={st.front.label} value={W(plan.loads.front)} onChange={loads('front')} unit={u.weight} hint={`Arm ${st.front.arm} in (${st.front.range})`} />
          <NumField label={st.rear.label} value={W(plan.loads.rear)} onChange={loads('rear')} unit={u.weight} hint={`Arm ${st.rear.arm} in`} />
          <NumField label={st.bag1.label} value={W(plan.loads.bag1)} onChange={loads('bag1')} unit={u.weight} hint={`Arm ${st.bag1.arm} in · max ${W(st.bag1.max ?? 0)} ${u.weight}`} />
          <NumField label={st.bag2.label} value={W(plan.loads.bag2)} onChange={loads('bag2')} unit={u.weight} hint={`Arm ${st.bag2.arm} in · max ${W(st.bag2.max ?? 0)} ${u.weight}`} />
          <NumField label="Fuel on board (usable)" value={Math.round(toF(plan.fuelGal, u) * 10) / 10} onChange={v => set({ fuelGal: Math.max(0, fromF(v, u)) })} unit={u.fuel} hint={`${W(plan.fuelGal * 6)} ${u.weight} at 6 lb/US gal · arm ${profile.fuelArm} in (POH)`} />
          <label className="block"><span className="mb-1 block text-sm text-fg-2">Tanks</span>
            <Select value={planning.tanks || 'standard'} onChange={e => savePlanning({ ...planning, tanks: e.target.value })}>{profile.fuel.map(f => <option key={f.key} value={f.key}>{f.label} — {Math.round(toF(f.usable, u))} {u.fuel} usable</option>)}</Select>
            <button className="mt-1 text-xs text-accent hover:underline" onClick={() => set({ fuelGal: tank.usable })}>Full ({Math.round(toF(tank.usable, u))} {u.fuel})</button>
          </label>
        </div>}
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-fg-3"><th className="pb-1.5 font-medium">Item</th><th className="pb-1.5 text-right font-medium">Weight {u.weight}</th><th className="pb-1.5 text-right font-medium">Arm</th><th className="pb-1.5 text-right font-medium">Moment/1000</th></tr></thead>
          <tbody className="num">
            {d.wb.items.map(i => (
              <tr key={i.label} className="border-t border-border"><td className="py-1.5 font-sans text-fg-2">{i.label}{i.label.startsWith('Basic') && d.wb.emptySample && <span className="ml-1 text-xs text-warn">sample</span>}</td><td className="text-right">{W(i.weight)}</td><td className="text-right text-fg-3">{i.arm.toFixed(1)}</td><td className="text-right">{(i.moment / 1000).toFixed(1)}</td></tr>
            ))}
            <tr className="border-t border-border"><td className="py-1.5 font-sans text-fg-3">Start, taxi, runup</td><td className="text-right">−{W(profile.taxiFuelLb)}</td><td className="text-right text-fg-3">{profile.fuelArm.toFixed(1)}</td><td className="text-right">{(-(profile.taxiFuelLb * profile.fuelArm) / 1000).toFixed(1)}</td></tr>
            {rows.map(([l, w, cg]) => {
              const max = l === 'Ramp' ? profile.limits.maxRamp : l === 'Takeoff' ? profile.limits.maxTakeoff : profile.limits.maxLanding
              const okW = w <= max, okCg = l === 'Ramp' || inEnvelope(profile.envelope.normal, cg, w)
              return (
                <tr key={l} className="border-t border-border-strong font-medium"><td className="py-1.5 font-sans">{l}</td><td className={cn('text-right', !okW && 'text-bad')}>{W(w)}<span className="text-xs font-normal text-fg-3"> / {W(max)}</span></td><td className={cn('text-right', !okCg && 'text-bad')}>{cg.toFixed(1)}</td><td className="text-right">{((w * cg) / 1000).toFixed(1)}</td></tr>
              )
            })}
          </tbody>
        </table>
        <p className="text-xs text-fg-3">Landing subtracts the navlog's trip fuel ({toF(d.totals.tripFuel, u).toFixed(1)} {u.fuel}). Moments in lb-in/1000 (POH). <PohLink fig="wb">POH Fig. 6-5</PohLink> · <PohLink fig="cg">CG limits p. 2-7</PohLink></p>
      </div>
      <div className="xl:col-span-3">
        <SubHead right={<span className="text-xs text-fg-3">Normal (solid) and utility (dashed) category</span>}>Center of gravity envelope</SubHead>
        <Envelope profile={profile} points={[{ label: 'Takeoff', ...d.wb.takeoff }, { label: 'Landing', ...d.wb.landing }]} />
      </div>
    </div>
  )
}

function Envelope({ profile, points }: { profile: AircraftProfile; points: { label: string; weight: number; cg: number }[] }) {
  const W = 640, H = 360, P = { l: 52, r: 16, t: 14, b: 40 }
  const x0 = 33, x1 = 49, y0 = 1400, y1 = Math.max(2500, ...points.map(p => p.weight + 50))
  const sx = (cg: number) => P.l + ((cg - x0) / (x1 - x0)) * (W - P.l - P.r)
  const sy = (w: number) => H - P.b - ((w - y0) / (y1 - y0)) * (H - P.t - P.b)
  const path = (env: [number, number][]) => env.map(([a, w], i) => `${i ? 'L' : 'M'}${sx(a)},${sy(w)}`).join('') + 'Z'
  const xs = Array.from({ length: x1 - x0 + 1 }, (_, i) => x0 + i).filter(v => v % 2 === 1)
  const ys = Array.from({ length: Math.floor((y1 - y0) / 100) + 1 }, (_, i) => y0 + i * 100).filter(v => v % 200 === 0)
  const [to, ld] = points
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="CG envelope with takeoff and landing points">
      {xs.map(v => <g key={v}><line x1={sx(v)} x2={sx(v)} y1={P.t} y2={H - P.b} stroke="var(--grid)" /><text x={sx(v)} y={H - P.b + 18} textAnchor="middle" className="fill-fg-3 text-[12px]">{v}</text></g>)}
      {ys.map(v => <g key={v}><line x1={P.l} x2={W - P.r} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" /><text x={P.l - 8} y={sy(v) + 4} textAnchor="end" className="fill-fg-3 text-[12px]">{v}</text></g>)}
      <text x={(W + P.l) / 2} y={H - 6} textAnchor="middle" className="fill-fg-3 text-[12px]">CG, inches aft of datum</text>
      <path d={path(profile.envelope.normal)} fill="color-mix(in oklch, var(--accent) 12%, transparent)" stroke="var(--accent)" strokeWidth={2} />
      <path d={path(profile.envelope.utility)} fill="none" stroke="var(--fg-3)" strokeWidth={1.5} strokeDasharray="5 4" />
      <line x1={sx(to.cg)} y1={sy(to.weight)} x2={sx(ld.cg)} y2={sy(ld.weight)} stroke="var(--fg-2)" strokeWidth={1.5} strokeDasharray="3 3" />
      {points.map((p, i) => {
        const ok = inEnvelope(profile.envelope.normal, p.cg, p.weight)
        return (
          <g key={p.label}>
            <circle cx={sx(p.cg)} cy={sy(p.weight)} r={6} fill={ok ? (i ? 'var(--c3)' : 'var(--c1)') : 'var(--bad)'} stroke="var(--card)" strokeWidth={2} />
            <text x={sx(p.cg) + 10} y={sy(p.weight) + (i ? 14 : -6)} className="fill-fg text-[12px]">{p.label} {Math.round(p.weight)} lb @ {p.cg.toFixed(1)}</text>
          </g>
        )
      })}
    </svg>
  )
}

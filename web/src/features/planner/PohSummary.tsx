import { cn } from '@/lib/utils'
import { cruiseAt } from './calc'
import type { AircraftPlanning, Derived, Plan } from './model'
import { loadsOf } from './model'
import type { AircraftProfile } from './poh'
import { PohLink } from './RefPanel'
import { SubHead } from './ui'
import { toF, toW, type Units, US } from './units'

const ARM_LABEL: Record<string, string> = { front: 'front', rear: 'rear', bag1: 'baggage 1', bag2: 'baggage 2' }

// The "Performance (POH)" page of a hand-written plan: limits, fuel, arms, CG
// range, then climb and cruise at this flight's altitudes and power, every
// number from the POH tables (figure linked) or this airplane's W&B record.
export function PohSummary({ d, profile, plan, planning, u = US }: { d: Derived; profile: AircraftProfile; plan: Plan; planning: AircraftPlanning; u?: Units }) {
  const L = profile.limits
  const tank = profile.fuel.find(f => f.key === (planning.tanks || 'standard')) ?? profile.fuel[0]
  const bew = d.wb.items[0]
  const env = profile.envelope.normal
  const minArm = Math.min(...env.map(([a]) => a))
  const knee = Math.max(...env.filter(([a]) => a === minArm).map(([, w]) => w))
  const fwdTop = env.filter(([, w]) => w === L.maxTakeoff).sort((a, b) => a[0] - b[0])[0]
  const aft = Math.max(...env.map(([a]) => a))
  const W = (lb: number) => `${Math.round(toW(lb, u)).toLocaleString()} ${u.weight}`
  const Fu = (gal: number, dp = 1) => `${toF(gal, u).toFixed(u.fuel === 'L' ? 0 : dp)} ${u.fuel}`
  const pattern = cruiseAt(profile, 2000, 0, 2200)
  const alts = [...new Map(d.flights.map(f => [f.alt, f])).values()]
  const rows: [string, React.ReactNode, React.ReactNode?][] = [
    ['MTOW', `${W(L.maxTakeoff)} (ramp ${W(L.maxRamp)}, landing ${W(L.maxLanding)})`, <PohLink key="l" fig="wb">Sec. 2</PohLink>],
    ['BEW', `${W(bew.weight)} · arm ${bew.arm.toFixed(2)} · moment ${(bew.moment / 1000).toFixed(1)}`, d.wb.emptySample ? <span key="s" className="text-warn">POH sample airplane</span> : 'W&B record'],
    ['Usable fuel', `${Fu(tank.usable, 0)} (${Fu(tank.total, 0)} total) · ${profile.fuelGrade}`, tank.label],
    ['Fuel weight', u.weight === 'kg' ? '0.72 kg/L' : '6 lb/gal'],
    ['Start, taxi, takeoff', `${Fu(profile.climbStartFuelGal)} or ${W(profile.taxiFuelLb)}`, <PohLink key="c" fig="climb">Fig. 5-7 note</PohLink>],
    ...(pattern ? [['Pattern burn', `${pattern.gph} GPH at 2200 RPM, 2,000 ft`, <PohLink key="p" fig="cruise">Fig. 5-8</PohLink>] as [string, React.ReactNode, React.ReactNode]] : []),
    ['Arms', `${profile.stations.map(s => `${ARM_LABEL[s.key] ?? s.label} ${s.arm}`).join(' · ')} · fuel ${profile.fuelArm}`],
    ['CG range', `forward ${minArm} in ≤ ${W(knee)} → ${fwdTop[0]} in at ${W(fwdTop[1])} · aft ${aft} in`, <PohLink key="e" fig="wb">Fig. 6-8</PohLink>],
  ]
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <SubHead right={<span className="text-xs text-fg-3">{profile.source}</span>}>Performance (POH)</SubHead>
        <dl className="grid grid-cols-[9rem_1fr_auto] gap-x-3 gap-y-1.5 text-sm">
          {rows.map(([k, v, s]) => <div key={k} className="contents"><dt className="text-fg-3">{k}</dt><dd className="num min-w-0 text-fg">{v}</dd><dd className="text-right text-xs text-fg-3">{s}</dd></div>)}
        </dl>
      </div>
      <div>
        <SubHead right={<PohLink fig="cruise">Fig. 5-7, 5-8</PohLink>}>Climb, cruise and descent</SubHead>
        <table className="num w-full text-sm">
          <thead><tr className="text-left text-xs text-fg-3"><th className="pb-1 font-medium">Flight</th><th className="pb-1 font-medium">Climb to cruise</th><th className="pb-1 font-medium">Cruise at {plan.rpm} RPM</th><th className="pb-1 text-right font-medium">%BHP</th></tr></thead>
          <tbody>
            {alts.map(f => (
              <tr key={f.n} className="border-t border-border">
                <td className="py-1.5">{f.alt.toLocaleString()} ft<div className="font-sans text-xs text-fg-3">{f.from.icao || f.from.id}→{f.to.icao || f.to.id}</div></td>
                <td className="py-1.5">{f.climb ? `${Math.round(f.climb.min)} min / ${Fu(f.climb.gal)} / ${Math.round(f.climb.nm)} nm` : '—'}</td>
                <td className="py-1.5">{f.cruise ? `${f.cruise.ktas} KTAS / ${f.cruise.gph} GPH` : '—'}</td>
                <td className="py-1.5 text-right">{f.cruise?.bhp ?? '—'}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm text-fg-3">Climb from the POH table between field and cruise pressure altitude, +10 % per 10 °C above standard. Cruise at the forecast temperature (FB winds aloft), recommended lean. Descent 500 fpm at cruise speed to pattern altitude (planning figure; the POH has no descent table).</p>
      </div>
    </div>
  )
}

// The W&B sheet line by line: item, source, weight, arm, moment/1000, then
// ramp, run-up fuel, takeoff, flight burn and landing for each flight.
export function WbTable({ d, plan, u = US }: { d: Derived; plan: Plan; u?: Units }) {
  if (!d.wb.steps.length) return <p className="text-sm text-fg-3">Weight and balance fills in once the aircraft is known.</p>
  const W = (lb: number) => (u.weight === 'kg' ? toW(lb, u).toFixed(1) : (Math.round(lb * 10) / 10).toLocaleString())
  const loads = loadsOf(plan)
  return (
    <div className="overflow-x-auto">
      <table className="num w-full min-w-[36rem] text-sm">
        <thead><tr className="text-left text-xs text-fg-3"><th className="pb-1.5 font-medium">Item</th><th className="pb-1.5 font-medium">Source</th><th className="pb-1.5 text-right font-medium">Weight ({u.weight})</th><th className="pb-1.5 text-right font-medium">Arm (in)</th><th className="pb-1.5 text-right font-medium">Moment / 1000</th></tr></thead>
        <tbody>
          {d.wb.steps.map((s, i) => (
            <tr key={i} className={cn('border-t border-border', s.total && 'border-fg/40 font-semibold', s.over && 'text-bad')}>
              <td className="py-1.5 font-sans">{s.label}</td>
              <td className="py-1.5 font-sans text-fg-3">{s.source}{s.over ? ' · over' : ''}</td>
              <td className="py-1.5 text-right">{W(s.weight)}</td>
              <td className="py-1.5 text-right">{s.arm == null ? '' : s.total ? s.arm.toFixed(2) : +s.arm.toFixed(2)}</td>
              <td className="py-1.5 text-right">{(s.moment / 1000).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {loads.front <= 0 && <p className="mt-2 text-sm text-warn">Enter the pilot's weight to complete the weight and balance.</p>}
    </div>
  )
}

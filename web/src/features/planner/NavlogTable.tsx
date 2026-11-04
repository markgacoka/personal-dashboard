import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import type { Derived, Plan } from './model'
import { deg3, fmtMin, fmtTime, fmtZ } from './ui'

// The full navlog in the shape of the NICE AIR / Jeppesen VFR NavLog: one row
// per checkpoint, with blank actual columns (GS, ATE, ATA, fuel) to fill in
// flight. Deviation comes from the airplane's compass card.
export function NavlogTable({ plan, set, d, readOnly }: { plan: Plan; set?: (p: Partial<Plan>) => void; d: Derived; readOnly?: boolean }) {
  if (!d.navlog.length) return <p className="text-sm text-fg-3">Add at least two airports, a departure time and the aircraft to build the navlog.</p>
  const act = plan.actuals || {}
  const put = (key: string, field: 'ata' | 'gs' | 'fuel' | 'dev', v: string) => set?.({ actuals: { ...act, [key]: { ...act[key], [field]: v } } })
  const startFuel = d.totals.usableFuel - (d.profile?.climbStartFuelGal ?? 1.1)
  const th = 'px-1.5 pb-1 pt-1.5 text-right font-medium'
  const cell = 'px-1.5 py-2 text-right'
  const field = (k: string, f: 'ata' | 'gs' | 'fuel' | 'dev', w = 'w-14', ph?: string) => readOnly
    ? <span className="inline-block min-h-5 min-w-10 border-b border-dashed border-border-strong">{act[k]?.[f] ?? ''}</span>
    : <input value={act[k]?.[f] ?? ''} placeholder={ph} onChange={e => put(k, f, e.target.value)} className={cn('num h-7 rounded-md bg-transparent px-1.5 text-right text-sm ring-1 ring-inset ring-border focus:ring-accent print:ring-0', w)} />
  return (
    <div className="overflow-x-auto">
      <table className="num w-full min-w-[78rem] border-collapse text-[13px]">
        <thead className="text-xs text-fg-3">
          <tr className="border-b border-border">
            <th className="px-1.5 pb-1 pt-1.5 text-left font-medium" rowSpan={2}>Checkpoint</th><th className="px-1.5 text-left font-medium" rowSpan={2}>Freq</th>
            <th className={th} rowSpan={2}>Alt</th><th className={th} colSpan={2}>Wind</th><th className={th} rowSpan={2}>TAS</th>
            <th className={th} rowSpan={2}>TC</th><th className={th} rowSpan={2}>WCA<div className="font-normal">−L/+R</div></th><th className={th} rowSpan={2}>TH</th><th className={th} rowSpan={2}>Var<div className="font-normal">−E/+W</div></th>
            <th className={cn(th, 'text-fg')} rowSpan={2}>MH</th><th className={th} rowSpan={2}>Dev</th><th className={th} rowSpan={2}>CH</th>
            <th className={th} colSpan={2}>Dist nm</th><th className={th} colSpan={2}>GS kt</th><th className={th} colSpan={2}>Time</th><th className={th} colSpan={2}>Clock</th><th className={th} colSpan={3}>Fuel gal</th><th className={th} rowSpan={2}>Terrain</th>
          </tr>
          <tr className="border-b border-border-strong">
            <th className={th}>Dir/kt</th><th className={th}>Temp</th><th className={th}>Leg</th><th className={th}>Rem</th><th className={th}>Est</th><th className={th}>Act</th>
            <th className={th}>ETE</th><th className={th}>ATE</th><th className={th}>ETA</th><th className={th}>ATA</th><th className={th}>Leg</th><th className={th}>Rem</th><th className={th}>Act</th>
          </tr>
        </thead>
        <tbody>
          {d.legs.map((leg, li) => {
            const rows = d.navlog.filter(r => r.leg === li + 1)
            const isFirst = li === 0, afterStop = li > 0 && d.legs[li - 1].stop
            return (
              <Fragment key={li}>
                {(isFirst || afterStop) && (
                  <tr className="border-b border-border bg-sunken/60">
                    <td className="px-1.5 py-2 font-sans" colSpan={2}><span className="num font-medium text-fg">{leg.from.icao || leg.from.id}</span> <span className="text-fg-3">{isFirst ? 'departure' : 'depart after stop'}</span></td>
                    <td className={cn(cell, 'font-sans text-fg-3')} colSpan={17}>ETD {fmtZ(leg.departAt)}</td>
                    <td className={cn(cell, 'font-medium text-fg')}>{fmtTime(leg.departAt)}</td>
                    <td className={cell}>{field(`${li}-dep`, 'ata', undefined, 'ATD')}</td>
                    <td className={cell} colSpan={2}><span className="font-sans text-xs text-fg-3">after start/taxi </span>{isFirst ? startFuel.toFixed(1) : ''}</td><td className={cell} /><td className={cell} />
                  </tr>
                )}
                {rows.map(r => {
                  const dev = Number(act[r.key]?.dev) || 0
                  return (
                    <tr key={r.key} className={cn('border-b border-border', r.to.kind === 'airport' && 'border-border-strong')}>
                      <td className="px-1.5 py-2 text-left font-sans">
                        <span className={cn('num', r.to.kind === 'airport' || r.to.kind === 'overfly' ? 'font-medium text-fg' : 'text-fg-2')}>{r.to.label}</span>
                        <span className="ml-1 text-xs text-fg-3">{r.to.kind === 'toc' ? 'top of climb' : r.to.kind === 'tod' ? 'top of descent' : r.to.kind === 'checkpoint' ? 'checkpoint' : r.to.kind === 'overfly' ? 'overfly' : ''}</span>
                      </td>
                      <td className="px-1.5 py-2 text-left">{r.to.freq ?? ''}</td>
                      <td className={cell}>{r.alt}</td>
                      <td className={cell}>{r.wind ? `${r.wind.dir == null ? 'L&V' : deg3(r.wind.dir)}/${r.wind.spd}` : '—'}</td>
                      <td className={cn(cell, 'text-fg-3')}>{r.wind?.temp != null ? `${r.wind.temp > 0 ? '+' : ''}${r.wind.temp}` : ''}</td>
                      <td className={cell}>{r.tas}</td>
                      <td className={cell}>{deg3(r.tc)}</td>
                      <td className={cell}>{Number.isNaN(r.wca) ? '—' : `${r.wca >= 0 ? '+' : '−'}${Math.abs(Math.round(r.wca))}`}</td>
                      <td className={cell}>{deg3(r.th)}</td>
                      <td className={cell}>{r.varEast >= 0 ? '−' : '+'}{Math.abs(Math.round(r.varEast))}</td>
                      <td className={cn(cell, 'text-base font-semibold text-fg')}>{deg3(r.mh)}</td>
                      <td className={cell}>{field(r.key, 'dev', 'w-10', '0')}</td>
                      <td className={cell}>{deg3(r.mh + dev)}</td>
                      <td className={cell}>{r.distNm.toFixed(1)}</td>
                      <td className={cn(cell, 'text-fg-3')}>{r.remNm.toFixed(1)}</td>
                      <td className={cell}>{Math.round(r.gs)}</td>
                      <td className={cell}>{field(r.key, 'gs', 'w-12')}</td>
                      <td className={cell}>{fmtMin(r.eteMin)}</td>
                      <td className={cell} />
                      <td className={cn(cell, 'font-medium text-fg')}>{fmtTime(r.eta)}</td>
                      <td className={cell}>{field(r.key, 'ata')}</td>
                      <td className={cell}>{r.fuelGal.toFixed(1)}</td>
                      <td className={cn(cell, r.fuelRem < d.totals.reserveFuel ? 'text-bad' : '')}>{r.fuelRem.toFixed(1)}</td>
                      <td className={cell}>{field(r.key, 'fuel', 'w-12')}</td>
                      <td className={cn(cell, 'text-fg-3')}>{r.terrainMax != null ? r.terrainMax.toLocaleString() : ''}</td>
                    </tr>
                  )
                })}
                {leg.stop && li < d.legs.length - 1 && (
                  <tr className="border-b border-border bg-sunken/60"><td className="px-1.5 py-2 font-sans text-fg-3" colSpan={25}>On the ground at <span className="num text-fg">{leg.to.icao || leg.to.id}</span> {plan.stopMinutes} min · next start and taxi {d.profile?.climbStartFuelGal ?? 1.1} gal</td></tr>
                )}
              </Fragment>
            )
          })}
          <tr className="border-t-2 border-border-strong font-medium">
            <td className="px-1.5 py-2 text-left font-sans" colSpan={13}>Totals · {d.navlog.length} checkpoints</td>
            <td className={cell}>{d.totals.distNm.toFixed(1)}</td><td className={cell} /><td className={cell} /><td className={cell} />
            <td className={cell}>{fmtMin(d.totals.eteMin)}</td><td className={cell} /><td className={cell}>{fmtTime(d.legs.at(-1)!.arriveAt)}</td><td className={cell} />
            <td className={cell}>{d.totals.tripFuel.toFixed(1)}</td><td className={cell}>{d.navlog.at(-1)!.fuelRem.toFixed(1)}</td><td className={cell} /><td className={cell} />
          </tr>
        </tbody>
      </table>
      <p className="mt-2 font-sans text-xs text-fg-3">Climb: POH Fig. 5-7 time and fuel, ground distance from climb TAS and the wind at mid-climb. Descent: planned at 500 fpm to pattern altitude at cruise speed and fuel flow. Checkpoints: airports within 5 nm of the line, at least 8 nm apart — pick your own visual checkpoints on the sectional and add them as fly-over points. Var: −E/+W (east is least). Fuel remaining turns red below the legal reserve.</p>
    </div>
  )
}

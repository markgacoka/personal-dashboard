import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import type { AircraftRegistry } from '@/lib/types'
import type { PilotInfo } from './api'
import { windAt } from './calc'
import type { AircraftPlanning, Airport, Derived, NavRow, Plan, WxAt } from './model'
import { isWaypoint } from './model'
import { deg3, fmtMin, fmtTime, fmtZ } from './ui'
import { fmtP, toF, type Units, US } from './units'

// The NICE AIR VFR Navigation Log (Jeppesen VFR NavLog layout), front and
// reverse, filled from the plan. Blank cells are for the cockpit: ATIS code,
// actual times, ground speeds and fuel, position reports.
export function NavlogSheet({ plan, set, d, airports, planning, savePlanning, registry, pilot, savePilot, u = US, readOnly }: {
  plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; airports: Airport[]; planning: AircraftPlanning; savePlanning: (p: AircraftPlanning) => void
  registry: AircraftRegistry | null | undefined; pilot: PilotInfo | undefined; savePilot: (p: PilotInfo) => void; u?: Units; readOnly?: boolean
}) {
  if (!d.legs.length) return <p className="text-sm text-fg-3">The NavLog fills in once the route, departure time and aircraft are set.</p>
  const act = plan.actuals || {}
  const F = (gal: number) => toF(gal, u).toFixed(u.fuel === 'L' ? 0 : 1)
  const dep = d.legs[0].from, dest = d.legs.at(-1)!.to
  const alt = plan.alternate ? airports.find(a => a.icao === plan.alternate || a.id === plan.alternate) ?? null : null
  const wxDep = d.wx.find(w => w.role === 'departure'), wxDest = d.wx.find(w => w.role === 'destination'), wxAlt = d.wx.find(w => w.role === 'alternate')
  const gph = d.legs[0].gph
  const rows = d.navlog
  const B = 'border border-fg/45'
  const H = cn(B, 'bg-fg/[0.07] px-1 py-0.5 text-center text-[11px] font-semibold uppercase tracking-wide text-fg-2')
  const C = cn(B, 'px-1 py-0.5 text-center')
  const inp = (value: string, onChange: (v: string) => void, cls = '', ph = '') => readOnly
    ? <span className={cls}>{value}</span>
    : <input value={value} placeholder={ph} onChange={e => onChange(e.target.value)} className={cn('w-full min-w-0 bg-transparent text-center outline-none focus:bg-accent-soft print:placeholder:text-transparent', cls)} />
  const putAct = (k: string, f: 'ata' | 'gs' | 'fuel' | 'dev', v: string) => set({ actuals: { ...act, [k]: { ...act[k], [f]: v } } })
  const runwayFor = (a: Airport, kind: 'takeoff' | 'landing') => d.perf.find(p => p.airport.id === a.id && p.kind === kind)?.runway?.end.id ?? ''
  const fp = flightPlan(plan, d, alt, planning, registry, pilot)

  return (
    <div className="navlog-sheet space-y-6 text-[13px] text-fg">
      <style>{'@media print { @page { size: letter landscape; margin: 0.25in } .navlog-sheet section { break-after: page; overflow: visible } .navlog-sheet section > div { zoom: 0.74 } }'}</style>

      {/* ── Front ── */}
      <section className="overflow-x-auto">
        <div className="min-w-[80rem]">
          <div className={cn(B, 'bg-fg py-1 text-center text-base font-bold tracking-wide text-bg')}>VFR NAVIGATION LOG</div>
          <div className="grid grid-cols-[auto_8rem_auto_1fr]">
            <div className={cn(B, 'px-2 py-1 font-medium')}>Aircraft Number</div>
            <div className={cn(B, 'num px-2 py-1 font-semibold')}>{plan.tail ?? ''}</div>
            <div className={cn(B, 'px-2 py-1 font-medium')}>Notes</div>
            <div className={cn(B, 'px-1')}>{inp(plan.notes ?? '', v => set({ notes: v }), 'text-left', 'Notes (route remarks, checkpoints, reminders)')}</div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_20rem] gap-0">
            <table className="num w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className={H} rowSpan={3}>Check Points<div className="normal-case">(Fixes)</div></th>
                  <th className={cn(H, 'bg-fg text-bg')}>VOR</th>
                  <th className={H} rowSpan={3}>Course<div className="normal-case">(Route)</div></th>
                  <th className={H} rowSpan={3}>Altitude</th>
                  <th className={cn(H, 'bg-fg text-bg')} colSpan={2}>Wind</th>
                  <th className={H}>CAS</th>
                  <th className={H} rowSpan={2}>TC</th><th className={H} rowSpan={2}>TH</th><th className={H} rowSpan={2}>MH</th>
                  <th className={H} rowSpan={3}>CH</th>
                  <th className={cn(H, 'bg-fg text-bg')}>Dist.</th><th className={cn(H, 'bg-fg text-bg')}>GS</th>
                  <th className={H} colSpan={2}>Time Off</th><th className={H}>GPH</th>
                </tr>
                <tr>
                  <th className={H}>Ident</th>
                  <th className={H}>Dir.</th><th className={H}>Vel.</th>
                  <th className={cn(B, 'px-1 text-center font-normal')} rowSpan={1}>{''}</th>
                  <th className={H}>Leg</th><th className={H} rowSpan={2}>Est.<br />Act.</th>
                  <th className={cn(B, 'px-1')} colSpan={2}>{inp(plan.timeOff ?? '', v => set({ timeOff: v }), 'font-medium', fmtTime(d.legs[0].departAt))}</th>
                  <th className={cn(B, 'px-1 text-center font-medium')}>{F(gph)}</th>
                </tr>
                <tr>
                  <th className={H}>Freq.</th>
                  <th className={H} colSpan={2}>Temp</th>
                  <th className={H}>TAS</th>
                  <th className={H}>−L/+R<br />WCA</th><th className={H}>−E/+W<br />Var.</th><th className={H}>± Dev.</th>
                  <th className={H}>Rem.</th>
                  <th className={H}>ETE<br />ATE</th><th className={H}>ETA<br />ATA</th><th className={H}>Fuel<br />Rem.</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={cn(C, 'text-left font-semibold')} rowSpan={2}>{dep.icao || dep.id}</td>
                  <td className={C} /><td className={C} rowSpan={2} /><td className={C} rowSpan={2}>{Math.round(dep.elev)}</td>
                  <td className={C} colSpan={2} rowSpan={2} /><td className={C} rowSpan={2} /><td className={C} rowSpan={2} /><td className={C} rowSpan={2} /><td className={C} rowSpan={2} /><td className={C} rowSpan={2} />
                  <td className={C} rowSpan={2} /><td className={C} rowSpan={2} />
                  <td className={C} colSpan={2}>ETD {fmtTime(d.legs[0].departAt)}</td><td className={C}>{F(d.totals.usableFuel)}</td>
                </tr>
                <tr><td className={C} /><td className={C} colSpan={2}>{inp(act['0-dep']?.ata ?? '', v => putAct('0-dep', 'ata', v), '', 'ATD')}</td><td className={C}>{F(d.totals.usableFuel - (d.profile?.climbStartFuelGal ?? 1.1))}</td></tr>
                {rows.map(r => <SheetRow key={r.key} r={r} act={act} putAct={putAct} F={F} C={C} inp={inp} d={d} />)}
                <tr>
                  <td className={cn(C, 'bg-fg/[0.07] text-right font-semibold')} colSpan={11}>Totals »</td>
                  <td className={cn(C, 'font-semibold')}>{d.totals.distNm.toFixed(1)}</td><td className={cn(C, 'bg-fg/[0.07]')} />
                  <td className={cn(C, 'font-semibold')}>{fmtMin(d.totals.eteMin)}</td><td className={cn(C, 'bg-fg/[0.07]')} /><td className={cn(C, 'font-semibold')}>{F(d.totals.tripFuel)}</td>
                </tr>
              </tbody>
            </table>

            <div className="flex flex-col">
              <div className={cn(B, 'bg-fg py-0.5 text-center text-xs font-bold text-bg')}>Airport &amp; ATIS Advisories</div>
              <AdvisoryGrid dep={wxDep} dest={wxDest} u={u} rwyDep={runwayFor(dep, 'takeoff')} rwyDest={runwayFor(dest, 'landing')} B={B} />
              <div className={cn(B, 'bg-fg py-0.5 text-center text-xs font-bold text-bg')}>Airport Frequencies</div>
              <FreqGrid dep={dep} dest={dest} B={B} />
              <div className="grid grid-cols-[5rem_1fr_1fr]">
                <div className={cn(B, 'bg-fg/[0.07] px-1 text-xs font-semibold')}>Block Out</div><div className={B}>{inp(act.blockOut?.ata ?? '', v => putAct('blockOut', 'ata', v))}</div>
                <div className={cn(B, 'row-span-2 grid place-items-center bg-fg/[0.07] text-xs font-semibold')}>Log Time</div>
                <div className={cn(B, 'bg-fg/[0.07] px-1 text-xs font-semibold')}>Block In</div><div className={B}>{inp(act.blockIn?.ata ?? '', v => putAct('blockIn', 'ata', v))}</div>
              </div>
            </div>
          </div>
          <p className="mt-1 text-xs text-fg-3 print:hidden">Forecast values at each ETA (METAR/TAF, FB winds aloft, POH). Fill the blank cells in flight; what you type here is saved with the plan.</p>
        </div>
      </section>

      {/* ── Reverse ── */}
      <section className="overflow-x-auto">
        <div className="min-w-[80rem]">
          <div className={cn(B, 'bg-fg py-1 text-center text-base font-bold tracking-wide text-bg')}>WEATHER LOG</div>
          <table className="w-full border-collapse">
            <thead>
              <tr><th className={H} rowSpan={2} /><th className={H} colSpan={2}>Ceiling, Visibility and Precipitation</th><th className={H} rowSpan={2}>Winds Aloft</th><th className={H} rowSpan={2}>Icing and Freezing Level</th><th className={H} rowSpan={2}>Turbulence and Cloud Tops</th><th className={H} rowSpan={2}>Position of Fronts, Lows and Highs</th></tr>
              <tr><th className={H}>Reported</th><th className={H}>Forecast</th></tr>
            </thead>
            <tbody className="align-top text-xs">
              {weatherLog(d, wxDep, wxDest, wxAlt, plan.cruiseAlt).map(r => (
                <tr key={r.label}>
                  <th className={cn(H, 'w-24 align-middle')}>{r.label}</th>
                  {[r.reported, r.forecast, r.winds, r.icing, r.turb].map((v, i) => <td key={i} className={cn(B, 'h-16 p-1')}><span className={i === 0 ? 'num' : ''}>{v}</span></td>)}
                  <td className={cn(B, 'h-16 p-1')}>{inp(plan.actuals?.[`fronts-${r.label}`]?.ata ?? '', v => putAct(`fronts-${r.label}`, 'ata', v), 'text-left', 'From the surface analysis')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_17rem] gap-3">
            <div>
              <div className={cn(B, 'bg-fg py-1 text-center text-base font-bold tracking-wide text-bg')}>FLIGHT PLAN</div>
              <div className="grid grid-cols-12 text-xs">
                <Cell B={B} span="col-span-1" label="1. Type"><b>VFR</b></Cell>
                <Cell B={B} span="col-span-2" label="2. Aircraft Identification"><span className="num">{fp.ident}</span></Cell>
                <Cell B={B} span="col-span-2" label="3. Aircraft Type / Special Equipment"><span className="num">{fp.type}</span></Cell>
                <Cell B={B} span="col-span-1" label="4. True Airspeed"><span className="num">{fp.tas} kt</span></Cell>
                <Cell B={B} span="col-span-2" label="5. Departure Point"><span className="num">{fp.departure}</span></Cell>
                <Cell B={B} span="col-span-2" label="6. Departure Time (Z)"><span className="num">Proposed {fp.depTime}</span><div className="text-fg-3">Actual ____</div></Cell>
                <Cell B={B} span="col-span-2" label="7. Cruising Altitude"><span className="num">{fp.altitude}</span></Cell>
                <Cell B={B} span="col-span-12" label="8. Route of Flight"><span className="num">{fp.route}</span></Cell>
                <Cell B={B} span="col-span-4" label="9. Destination (Name of airport and city)">{fp.destination}</Cell>
                <Cell B={B} span="col-span-2" label="10. Est. Time Enroute"><span className="num">{fp.ete}</span></Cell>
                <Cell B={B} span="col-span-6" label="11. Remarks">{fp.remarks}</Cell>
                <Cell B={B} span="col-span-2" label="12. Fuel on Board"><span className="num">{fp.fuel}</span></Cell>
                <Cell B={B} span="col-span-3" label="13. Alternate Airport(s)"><span className="num">{fp.alternate}</span></Cell>
                <Cell B={B} span="col-span-5" label="14. Pilot's Name, Address, Tel # & Aircraft Home Base">
                  <div className="grid grid-cols-2 gap-x-2">
                    {inp(pilot?.name ?? '', v => savePilot({ ...pilot, name: v }), 'text-left', 'Name')}
                    {inp(pilot?.phone ?? '', v => savePilot({ ...pilot, phone: v }), 'text-left', 'Phone')}
                    {inp(pilot?.address ?? '', v => savePilot({ ...pilot, address: v }), 'text-left', 'Address')}
                    {inp(pilot?.base ?? '', v => savePilot({ ...pilot, base: v }), 'text-left', 'Home base')}
                  </div>
                </Cell>
                <Cell B={B} span="col-span-2" label="15. # Aboard"><span className="num">{fp.aboard}</span></Cell>
                <Cell B={B} span="col-span-5" label="16. Color of Aircraft">{inp(planning.color ?? '', v => savePlanning({ ...planning, color: v }), 'text-left', 'e.g. White/Blue')}</Cell>
                <Cell B={B} span="col-span-7" label="17. Destination Contact / Telephone (Optional)">{inp(act.contact?.ata ?? '', v => putAct('contact', 'ata', v), 'text-left')}</Cell>
              </div>
              <div className={cn(B, 'bg-fg/[0.07] px-2 py-1 text-center text-xs font-semibold')}>CLOSE VFR FLIGHT PLAN WITH <span className="num">{fp.fss}</span> FSS ON ARRIVAL</div>
            </div>
            <div className="flex flex-col">
              <div className={cn(B, 'bg-fg py-0.5 text-center text-xs font-bold text-bg')}>Notes and NOTAMs</div>
              <ul className={cn(B, 'min-h-40 flex-1 space-y-1 p-1.5 text-xs')}>
                {d.checks.filter(c => (c.section === 'weather' || c.section === 'navlog') && (c.status === 'nogo' || c.status === 'caution')).slice(0, 9).map((c, i) => <li key={i}>• {c.title}</li>)}
              </ul>
              <div className={cn(B, 'bg-fg py-0.5 text-center text-xs font-bold text-bg')}>Position Report</div>
              <div className="grid grid-cols-7 text-[10px]">{['Acft. Ident.', 'Position', 'Time', 'Alt.', 'IFR/VFR', 'Est. Next Fix', 'Name Following Fix'].map(h => <div key={h} className={cn(B, 'bg-fg/[0.07] px-0.5 text-center font-semibold')}>{h}</div>)}{Array.from({ length: 7 }).map((_, i) => <div key={i} className={cn(B, 'h-6')} />)}</div>
              <p className={cn(B, 'p-1 text-[10px] text-fg-3')}>Report conditions aloft — cloud tops, bases, layers, visibility, turbulence, haze, ice, thunderstorms.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function SheetRow({ r, act, putAct, F, C, inp, d }: {
  r: NavRow; act: NonNullable<Plan['actuals']>; putAct: (k: string, f: 'ata' | 'gs' | 'fuel' | 'dev', v: string) => void; F: (g: number) => string; C: string
  inp: (value: string, onChange: (v: string) => void, cls?: string, ph?: string) => React.ReactNode; d: Derived
}) {
  const dev = Number(act[r.key]?.dev) || 0
  const label = r.to.kind === 'toc' ? 'TOC' : r.to.kind === 'tod' ? 'TOD' : r.to.label
  const varW = -r.varEast
  return (
    <Fragment>
      <tr>
        <td className={cn(C, 'text-left font-semibold')} rowSpan={2}>{label}{r.to.kind === 'toc' || r.to.kind === 'tod' ? <div className="text-[10px] font-normal text-fg-3">{r.to.kind === 'toc' ? 'top of climb' : 'top of descent'}</div> : null}</td>
        <td className={C}>{r.to.navType && r.to.kind === 'waypoint' ? r.to.label : ''}</td>
        <td className={C} rowSpan={2}>{r.from}→{label}</td>
        <td className={C} rowSpan={2}>{r.alt}</td>
        <td className={C}>{r.wind?.dir == null ? (r.wind ? 'L&V' : '') : deg3(r.wind.dir)}</td><td className={C}>{r.wind?.spd ?? ''}</td>
        <td className={C}>{r.cas}</td>
        <td className={C}>{deg3(r.tc)}</td><td className={C}>{deg3(r.th)}</td><td className={cn(C, 'font-bold')}>{deg3(r.mh)}</td>
        <td className={cn(C, 'font-semibold')} rowSpan={2}>{deg3(r.mh + dev)}</td>
        <td className={C}>{r.distNm.toFixed(1)}</td><td className={C}>{Math.round(r.gs)}</td>
        <td className={C}>{fmtMin(r.eteMin)}</td><td className={C}>{fmtTime(r.eta)}</td><td className={C}>{F(r.fuelGal)}</td>
      </tr>
      <tr>
        <td className={C}>{r.to.freq ?? ''}</td>
        <td className={C} colSpan={2}>{r.wind?.temp != null ? `${r.wind.temp > 0 ? '+' : ''}${r.wind.temp}°` : ''}</td>
        <td className={C}>{r.tas}</td>
        <td className={C}>{Number.isNaN(r.wca) ? '—' : `${r.wca >= 0 ? '+' : '−'}${Math.abs(Math.round(r.wca))}`}</td>
        <td className={C}>{varW >= 0 ? '+' : '−'}{Math.abs(Math.round(varW))}</td>
        <td className={C}>{inp(act[r.key]?.dev ?? '', v => putAct(r.key, 'dev', v), '', '±')}</td>
        <td className={C}>{r.remNm.toFixed(1)}</td><td className={C}>{inp(act[r.key]?.gs ?? '', v => putAct(r.key, 'gs', v))}</td>
        <td className={C} /><td className={C}>{inp(act[r.key]?.ata ?? '', v => putAct(r.key, 'ata', v))}</td>
        <td className={cn(C, r.fuelRem < d.totals.reserveFuel && 'text-bad')}>{F(r.fuelRem)}</td>
      </tr>
    </Fragment>
  )
}

function Cell({ B, span, label, children }: { B: string; span: string; label: string; children: React.ReactNode }) {
  return <div className={cn(B, span, 'min-h-12 px-1.5 py-1')}><div className="text-[10px] font-semibold text-fg-2">{label}</div><div className="mt-0.5">{children}</div></div>
}

function AdvisoryGrid({ dep, dest, u, rwyDep, rwyDest, B }: { dep?: WxAt; dest?: WxAt; u: Units; rwyDep: string; rwyDest: string; B: string }) {
  const cv = (w?: WxAt) => (w ? `${w.ceiling != null ? `${w.ceiling.toLocaleString()} ft` : 'No ceiling'} · ${w.visib ?? '—'} SM` : '')
  const wind = (w?: WxAt) => (w ? `${w.wind.dir == null ? (w.wind.spd ? 'VRB' : 'Calm') : deg3(w.wind.dir)}${w.wind.spd ? `/${w.wind.spd}${w.wind.gust ? `G${w.wind.gust}` : ''}` : ''}` : '')
  const rows: [string, string, string][] = [
    ['ATIS Code', '', ''], ['Ceiling & Visibility', cv(dep), cv(dest)], ['Wind', wind(dep), wind(dest)],
    ['Altimeter', dep ? fmtP(dep.altimInHg, u) : '', dest ? fmtP(dest.altimInHg, u) : ''], ['Approach', 'VFR', 'VFR'], ['Runway', rwyDep, rwyDest],
    ['Time Check', dep ? fmtTime(dep.at) : '', dest ? fmtTime(dest.at) : ''],
  ]
  return (
    <div className="num grid grid-cols-[1fr_6.5rem_1fr] text-xs">
      <div className={cn(B, 'bg-fg/[0.07] px-1 text-center font-semibold')}>Departure</div><div className={cn(B, 'bg-fg')} /><div className={cn(B, 'bg-fg/[0.07] px-1 text-center font-semibold')}>Destination</div>
      {rows.map(([l, a, b]) => <Fragment key={l}><div className={cn(B, 'min-h-6 px-1 text-center')}>{a}</div><div className={cn(B, 'bg-fg/[0.07] px-1 text-center font-sans font-semibold')}>{l}</div><div className={cn(B, 'min-h-6 px-1 text-center')}>{b}</div></Fragment>)}
    </div>
  )
}

const pick = (a: Airport, re: RegExp) => a.frequencies.find(f => re.test(f.use))?.freq ?? ''
function FreqGrid({ dep, dest, B }: { dep: Airport; dest: Airport; B: string }) {
  const atis = (a: Airport) => pick(a, /^D?-?ATIS$/) || (a.wx?.freq ? `${a.wx.type} ${a.wx.freq}` : '')
  const appr = (a: Airport) => pick(a, /APCH|DEP/) || a.approach?.frequencies[0]?.freq || ''
  const left: [string, string][] = [['ATIS', atis(dep)], ['Ground', pick(dep, /^GND/)], ['Tower', pick(dep, /^LCL/)], ['Departure', appr(dep)], ['CTAF', pick(dep, /^CTAF/)], ['FSS', '122.2'], ['UNICOM', pick(dep, /^UNICOM/)], ['Field Elev', `${Math.round(dep.elev)}`]]
  const right: [string, string][] = [['ATIS', atis(dest)], ['Approach', appr(dest)], ['Tower', pick(dest, /^LCL/)], ['Ground', pick(dest, /^GND/)], ['CTAF', pick(dest, /^CTAF/)], ['FSS', '122.2'], ['UNICOM', pick(dest, /^UNICOM/)], ['Field Elev', `${Math.round(dest.elev)}`]]
  return (
    <div className="num grid grid-cols-[4.5rem_1fr_4.5rem_1fr] text-xs">
      <div className={cn(B, 'col-span-2 bg-fg/[0.07] text-center font-sans font-semibold')}>Departure <span className="num">{dep.icao || dep.id}</span></div>
      <div className={cn(B, 'col-span-2 bg-fg/[0.07] text-center font-sans font-semibold')}>Destination <span className="num">{dest.icao || dest.id}</span></div>
      {left.map(([l, v], i) => <Fragment key={l + i}><div className={cn(B, 'bg-fg/[0.07] px-1 font-sans font-semibold')}>{l}</div><div className={cn(B, 'min-h-6 px-1')}>{v}</div><div className={cn(B, 'bg-fg/[0.07] px-1 font-sans font-semibold')}>{right[i][0]}</div><div className={cn(B, 'min-h-6 px-1')}>{right[i][1]}</div></Fragment>)}
    </div>
  )
}

function weatherLog(d: Derived, dep?: WxAt, dest?: WxAt, alt?: WxAt, cruiseAlt = 4500) {
  const rep = (w?: WxAt) => w?.metar?.rawOb ?? (w ? 'No METAR nearby' : '')
  const fc = (w?: WxAt) => {
    if (!w) return ''
    const p = w.tafMoment?.prevailing
    if (!p) return w.taf ? 'TAF ends before the ETA' : 'No TAF nearby'
    return `${w.category ?? ''} at ${fmtTime(w.at)} (TAF ${w.tafStation}): ${p.wdir ?? 'VRB'}/${p.wspd ?? 0}${p.wgst ? `G${p.wgst}` : ''} · vis ${p.visib ?? '—'} · ${(p.clouds || []).map(c => `${c.cover}${c.base != null ? String(Math.round(c.base / 100)).padStart(3, '0') : ''}`).join(' ') || 'SKC'}${p.wxString ? ` · ${p.wxString}` : ''}`
  }
  const winds = (w?: { airport: Airport }) => {
    if (!d.fb || !w) return ''
    const x = windAt(d.fb.product, w.airport, cruiseAlt)
    return x ? `${cruiseAlt.toLocaleString()} ft: ${x.dir == null ? 'L&V' : deg3(x.dir)}/${x.spd} kt${x.temp != null ? `, ${x.temp > 0 ? '+' : ''}${x.temp}°C` : ''} (FB ${x.stations.join('/')})` : ''
  }
  const fz = d.freezing ? `Freezing level ~${d.freezing.altFt.toLocaleString()} ft${d.freezing.approx ? ' (approx.)' : ''}` : 'No freezing level below the FB levels'
  const ice = d.hazards.gairmets.filter(g => g.hazard === 'ICE').length ? 'G-AIRMET Zulu icing on the route' : 'No icing advisories on the route'
  const turbP = d.hazards.pireps.filter(p => p.tbInt1)
  const turb = [d.hazards.gairmets.some(g => /TURB/.test(g.hazard)) ? 'G-AIRMET Tango turbulence' : '', turbP.length ? `${turbP.length} PIREP${turbP.length > 1 ? 's' : ''}: ${turbP.slice(0, 2).map(p => p.tbInt1).join(', ')}` : 'No turbulence PIREPs'].filter(Boolean).join(' · ')
  const mp = d.samples[Math.floor(d.samples.length / 2)]
  const mid = mp && d.legs.length ? { airport: { ...d.legs[0].from, lat: mp.lat, lon: mp.lon } } : undefined
  const enrouteAdv = [...d.hazards.sigmets.map(s => `SIGMET ${s.hazard}`), ...new Set(d.hazards.gairmets.filter(g => g.hazard === 'IFR' || g.hazard === 'MT_OBSC').map(g => `G-AIRMET ${g.hazard === 'IFR' ? 'IFR' : 'mountain obscuration'}`)), ...d.hazards.cwas.map(() => 'CWA')].join(' · ')
  const stops = d.wx.filter(w => w.role === 'stop').map(w => `${w.airport.icao || w.airport.id} ${w.category ?? '—'}`).join(' · ')
  return [
    { label: 'Departure', reported: rep(dep), forecast: fc(dep), winds: winds(dep), icing: fz, turb },
    { label: 'Enroute', reported: [stops, d.hazards.pireps.length ? `${d.hazards.pireps.length} PIREPs near the route` : ''].filter(Boolean).join(' · ') || 'See PIREPs', forecast: enrouteAdv || 'No SIGMET, IFR or mountain-obscuration advisories on the route', winds: winds(mid), icing: ice, turb },
    { label: 'Destination', reported: rep(dest), forecast: fc(dest), winds: winds(dest), icing: fz, turb: '' },
    { label: 'Alternate', reported: rep(alt), forecast: fc(alt), winds: winds(alt), icing: '', turb: '' },
  ]
}

function flightPlan(plan: Plan, d: Derived, alt: Airport | null, planning: AircraftPlanning, registry: AircraftRegistry | null | undefined, pilot: PilotInfo | undefined) {
  const pts = [d.legs[0].from, ...d.legs.map(l => l.to)]
  const dest = pts.at(-1)!
  const souls = (plan.loads.front > 250 ? 2 : plan.loads.front > 0 ? 1 : 0) + (plan.loads.rear > 0 ? Math.max(1, Math.round(plan.loads.rear / 170)) : 0)
  const equip = planning.equipment?.equipCode || (planning.equipment?.gps?.includes('IFR') ? 'G' : planning.equipment?.transponder ? 'U' : 'U')
  const typeCode = registry?.model ? `C${String(registry.model).replace(/\D/g, '').slice(0, 3)}` : 'C172'
  const stops = plan.route.slice(1, -1).filter(t => !t.endsWith('*'))
  return {
    ident: plan.tail ?? '', type: `${typeCode}/${equip}`, tas: d.legs[0].tas, departure: pts[0].icao || pts[0].id, depTime: fmtZ(d.legs[0].departAt).replace('Z', ''),
    altitude: plan.cruiseAlt, route: pts.slice(1, -1).map(p => (isWaypoint(p) ? p.id : p.icao || p.id)).join(' ') || 'DCT',
    destination: `${dest.icao || dest.id} · ${dest.name}, ${dest.city}`, ete: fmtMin(d.totals.eteMin).replace(':', ' h ') + ' min',
    remarks: stops.length ? `Stops ${stops.join(' ')}` : '', fuel: fmtMin(d.totals.enduranceMin).replace(':', ' h ') + ' min', alternate: alt ? alt.icao || alt.id : '',
    aboard: souls || '', fss: 'Leidos Flight Service (1-800-WX-BRIEF / 122.2)', pilot,
  }
}

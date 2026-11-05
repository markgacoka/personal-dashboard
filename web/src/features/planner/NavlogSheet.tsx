import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import type { AircraftRegistry } from '@/lib/types'
import type { PilotInfo } from './api'
import type { flightNotes } from './brief'
import { windAt } from './calc'
import type { AircraftPlanning, Airport, Derived, Flight, NavRow, Plan, RowOverride, WxAt } from './model'
import { isWaypoint, soulsOf } from './model'
import { deg3, fmtMin, fmtTime, fmtZ, hhmm } from './ui'
import { fmtP, toF, type Units, US } from './units'

const B = 'border border-fg/45'
const H = cn(B, 'bg-fg/[0.07] px-1 py-0.5 text-center text-[11px] font-semibold uppercase tracking-wide text-fg-2')
const C = cn(B, 'px-1 py-0.5 text-center')
type Inp = (value: string, onChange: (v: string) => void, cls?: string, ph?: string) => React.ReactNode
type Act = NonNullable<Plan['actuals']>
type ActField = 'ata' | 'gs' | 'fuel' | 'dev'

function useCells(plan: Plan, set: (p: Partial<Plan>) => void, readOnly?: boolean) {
  const act = plan.actuals || {}
  const inp: Inp = (value, onChange, cls = '', ph = '') => readOnly
    ? <span className={cls}>{value}</span>
    : <input value={value} placeholder={ph} onChange={e => onChange(e.target.value)} className={cn('w-full min-w-0 bg-transparent text-center outline-none placeholder:text-fg-3/70 focus:bg-accent-soft print:placeholder:text-transparent', cls)} />
  const putAct = (k: string, f: ActField, v: string) => set({ actuals: { ...act, [k]: { ...act[k], [f]: v } } })
  return { act, inp, putAct }
}

// One flight (takeoff to landing) on the front of the Jeppesen VFR Navigation
// Log, laid out the way it's filled in by hand: pattern altitudes and the
// highest terrain above the sheet, the briefing notes, the navlog rows with
// TOC and TOD, and the airport frequencies. Wind cells take your own numbers
// (E6B style) and the row recomputes; blank cells are for the cockpit.
export function NavlogFront({ plan, set, d, flight, notes, u = US, readOnly }: {
  plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; flight: Flight; notes: ReturnType<typeof flightNotes>; u?: Units; readOnly?: boolean
}) {
  const { act, inp, putAct } = useCells(plan, set, readOnly)
  const F = (gal: number) => toF(gal, u).toFixed(u.fuel === 'L' ? 1 : 2)
  const dep = flight.from, dest = flight.to
  const wxDep = d.wx[flight.n], wxDest = d.wx[flight.n + 1]
  const runwayFor = (a: Airport, kind: 'takeoff' | 'landing') => d.perf.find(p => p.airport.id === a.id && p.kind === kind)?.runway?.end.id ?? ''
  const taxi = d.profile?.climbStartFuelGal ?? 1.1
  const k = `f${flight.n}`
  const ov = plan.overrides || {}
  const putOv = (key: string, f: keyof RowOverride, v: string) => {
    const n = v.trim() === '' ? null : Number(v)
    set({ overrides: { ...ov, [key]: { ...ov[key], [f]: n != null && Number.isFinite(n) ? n : null } } })
  }
  const code = (a: Airport) => a.icao || a.id
  const notesLines = [notes.day, notes.aircraft, `WX: ${notes.wx[0]}`, ...notes.wx.slice(1), `NOTAMs: ${notes.notams.join(' · ')}`]

  return (
    <section className="navlog-front overflow-x-auto">
      <div className="min-w-[68rem]">
        <div className="mb-2 flex flex-wrap items-end gap-x-10 gap-y-1 text-sm">
          {[dep, dest].map((a, i) => (
            <div key={i} className="min-w-36">
              <div className="num border-b border-fg/45 pb-0.5 text-base font-semibold">{code(a)}</div>
              <div className="num pt-0.5">TPA {Math.round(i ? flight.tpaTo : flight.tpaFrom).toLocaleString()}{a.tpaAgl == null && <span className="text-fg-3"> (1,000 AGL)</span>}</div>
            </div>
          ))}
          <div className="num pb-0.5">Terrain @ {flight.terrainMax != null ? `${Math.round(flight.terrainMax).toLocaleString()} MSL` : '—'}</div>
          <div className="num pb-0.5 text-fg-2">Cruise {flight.alt.toLocaleString()} ft · {plan.rpm} RPM{flight.cruise ? ` · ${flight.cruise.ktas} KTAS · ${flight.cruise.gph} GPH · ${flight.cruise.bhp}% BHP` : ''}</div>
        </div>
        <div className={cn(B, 'bg-fg py-1 text-center text-base font-bold tracking-wide text-bg')}>VFR NAVIGATION LOG</div>
        <div className="grid grid-cols-[auto_8rem_auto_1fr]">
          <div className={cn(B, 'px-2 py-1 font-medium')}>Aircraft Number</div>
          <div className={cn(B, 'num px-2 py-1 font-semibold')}>{plan.tail ?? ''}</div>
          <div className={cn(B, 'px-2 py-1 font-medium')}>Notes</div>
          <div className={B} />
        </div>
        <div className={cn(B, 'border-t-0')}>
          {notesLines.map((l, i) => <div key={i} className="border-b border-fg/25 px-2 py-0.5 text-[13px]">{l}</div>)}
          <div className="px-1">{inp(act[`${k}-notes`]?.ata ?? '', v => putAct(`${k}-notes`, 'ata', v), 'text-left', 'Your notes')}</div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_17rem] gap-0">
          <table className="num w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={H} rowSpan={3}>Check Points<div className="normal-case">(Fixes)</div></th>
                <th className={cn(H, 'bg-fg text-bg')}>VOR</th>
                <th className={H} rowSpan={3}>Course<div className="normal-case">(Route)</div></th>
                <th className={H} rowSpan={2}>Altitude</th>
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
                <th className={cn(B, 'px-1 text-center font-normal')} />
                <th className={H}>Leg</th><th className={H} rowSpan={2}>Est.<br />Act.</th>
                <th className={cn(B, 'px-1')} colSpan={2}>{inp(act[`${k}-off`]?.ata ?? '', v => putAct(`${k}-off`, 'ata', v), 'font-medium', hhmm(flight.departAt))}</th>
                <th className={cn(B, 'px-1 text-center font-medium')}>{flight.cruise ? F(flight.cruise.gph) : ''}</th>
              </tr>
              <tr>
                <th className={H}>Freq.</th>
                <th className={cn(B, 'px-1 text-center font-semibold')} title="Field elevation">{Math.round(dep.elev)}</th>
                <th className={H} colSpan={2}>Temp</th>
                <th className={H}>TAS</th>
                <th className={H}>−L/+R<br />WCA</th><th className={H}>−E/+W<br />Var.</th><th className={H}>± Dev.</th>
                <th className={cn(B, 'px-1 text-center font-semibold')} title="Total distance">{flight.distNm.toFixed(1)}</th>
                <th className={H}>ETE<br />ATE</th><th className={H}>ETA<br />ATA</th><th className={H}>Fuel<br />Rem.</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={cn(C, 'text-left text-sm font-semibold')} rowSpan={2}>{code(dep)}</td>
                <td className={C} /><td className={C} rowSpan={2} /><td className={C} rowSpan={2} />
                <td className={C} colSpan={2} rowSpan={2} /><td className={C} rowSpan={2} /><td className={C} rowSpan={2} /><td className={C} rowSpan={2} /><td className={C} rowSpan={2} /><td className={C} rowSpan={2} />
                <td className={C} rowSpan={2} /><td className={C} rowSpan={2} />
                <td className={C} colSpan={2}>ETD {hhmm(flight.departAt)}</td><td className={C}>{F(flight.fuelStart)}</td>
              </tr>
              <tr><td className={C} /><td className={C} colSpan={2}>{inp(act[`${k}-atd`]?.ata ?? '', v => putAct(`${k}-atd`, 'ata', v), '', 'ATD')}</td><td className={C} title="After start, taxi and takeoff">{F(flight.fuelStart - taxi)}</td></tr>
              {flight.rows.map(r => <SheetRow key={r.key} r={r} act={act} putAct={putAct} F={F} inp={inp} reserve={d.totals.reserveFuel} ov={ov[r.key] || {}} putOv={(f, v) => putOv(r.key, f, v)} readOnly={readOnly} />)}
              <tr>
                <td className={cn(C, 'bg-fg/[0.07] text-right font-semibold')} colSpan={11}>Totals »</td>
                <td className={cn(C, 'font-semibold')}>{flight.distNm.toFixed(1)}</td><td className={cn(C, 'bg-fg/[0.07]')} />
                <td className={cn(C, 'font-semibold')}>{Math.round(flight.eteMin)}</td><td className={cn(C, 'bg-fg/[0.07]')} /><td className={cn(C, 'font-semibold')}>{F(flight.fuelGal)}</td>
              </tr>
            </tbody>
          </table>

          <div className="flex flex-col">
            <div className={cn(B, 'bg-fg py-0.5 text-center text-xs font-bold text-bg')}>Airport &amp; ATIS Advisories</div>
            <AdvisoryGrid dep={wxDep} dest={wxDest} u={u} rwyDep={runwayFor(dep, 'takeoff')} rwyDest={runwayFor(dest, 'landing')} />
            <div className={cn(B, 'bg-fg py-0.5 text-center text-xs font-bold text-bg')}>Airport Frequencies</div>
            <FreqGrid dep={dep} dest={dest} />
            <div className="grid grid-cols-[5rem_1fr_1fr]">
              <div className={cn(B, 'bg-fg/[0.07] px-1 text-xs font-semibold')}>Block In</div><div className={B}>{inp(act[`${k}-in`]?.ata ?? '', v => putAct(`${k}-in`, 'ata', v))}</div>
              <div className={cn(B, 'row-span-2 grid place-items-center bg-fg/[0.07] text-xs font-semibold')}>Log Time</div>
              <div className={cn(B, 'bg-fg/[0.07] px-1 text-xs font-semibold')}>Block Out</div><div className={B}>{inp(act[`${k}-out`]?.ata ?? '', v => putAct(`${k}-out`, 'ata', v))}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function SheetRow({ r, act, putAct, F, inp, reserve, ov, putOv, readOnly }: {
  r: NavRow; act: Act; putAct: (k: string, f: ActField, v: string) => void; F: (g: number) => string; inp: Inp; reserve: number
  ov: RowOverride; putOv: (f: keyof RowOverride, v: string) => void; readOnly?: boolean
}) {
  const dev = Number(act[r.key]?.dev) || 0
  const label = r.to.kind === 'toc' ? 'TOC' : r.to.kind === 'tod' ? 'TOD' : r.to.label
  const varW = -r.varEast
  // The forecast is the placeholder; a number you type replaces it for this row.
  const e6b = (f: keyof RowOverride, forecast: string) => readOnly
    ? <span>{ov[f] ?? forecast}</span>
    : <input value={ov[f] ?? ''} placeholder={forecast} inputMode="numeric" onChange={e => putOv(f, e.target.value)} aria-label={`${label} ${f}`}
        className={cn('w-full min-w-0 bg-transparent text-center outline-none placeholder:text-fg focus:bg-accent-soft', ov[f] != null && 'font-semibold text-accent')} />
  const sign = (x: number) => { const n = Math.round(x); return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}` }
  return (
    <Fragment>
      <tr>
        <td className={cn(C, 'text-left text-sm font-semibold')} rowSpan={2}>{label}{r.to.kind === 'toc' || r.to.kind === 'tod' ? <div className="text-[10px] font-normal text-fg-3">{r.to.kind === 'toc' ? 'top of climb' : 'top of descent'}</div> : null}</td>
        <td className={C}>{r.to.kind === 'waypoint' && /VOR|NDB|TACAN|DME/.test(r.to.navType ?? '') ? r.to.label.replace(/\d{6}$/, '') : ''}</td>
        <td className={C} rowSpan={2}>{r.from}→{label}</td>
        <td className={C} rowSpan={2}>{r.alt}</td>
        <td className={C}>{e6b('wdir', r.wind?.dir == null ? (r.wind ? 'VRB' : '') : deg3(r.wind.dir))}</td><td className={C}>{e6b('wspd', r.wind ? String(r.wind.spd) : '')}</td>
        <td className={C}>{e6b('cas', String(r.cas))}</td>
        <td className={C}>{deg3(r.tc)}</td><td className={C}>{deg3(r.th)}</td><td className={cn(C, 'font-bold')}>{deg3(r.mh)}</td>
        <td className={cn(C, 'font-semibold')} rowSpan={2}>{dev ? deg3(r.mh + dev) : ''}</td>
        <td className={C}>{r.distNm.toFixed(1)}</td><td className={C}>{Math.round(r.gs)}</td>
        <td className={C}>{r.eteMin.toFixed(1)}</td><td className={C}>{hhmm(r.eta)}</td><td className={C}>{F(r.fuelGal)}</td>
      </tr>
      <tr>
        <td className={C}>{r.to.freq ?? ''}</td>
        <td className={C} colSpan={2}>{e6b('temp', r.wind?.temp != null ? sign(r.wind.temp) : '')}</td>
        <td className={C}>{r.tas}</td>
        <td className={C}>{Number.isNaN(r.wca) ? '—' : sign(r.wca)}</td>
        <td className={C}>{sign(varW)}</td>
        <td className={C}>{inp(act[r.key]?.dev ?? '', v => putAct(r.key, 'dev', v), '', '±')}</td>
        <td className={C}>{r.remNm.toFixed(1)}</td><td className={C}>{inp(act[r.key]?.gs ?? '', v => putAct(r.key, 'gs', v))}</td>
        <td className={C} /><td className={C}>{inp(act[r.key]?.ata ?? '', v => putAct(r.key, 'ata', v))}</td>
        <td className={cn(C, r.fuelRem < reserve && 'text-bad')}>{F(r.fuelRem)}</td>
      </tr>
    </Fragment>
  )
}

// The reverse side, once for the trip: weather log, the FAA flight plan
// (fields 1–17), notes and NOTAMs, and the position report box.
export function NavlogReverse({ plan, set, d, airports, planning, savePlanning, registry, pilot, savePilot, readOnly }: {
  plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; airports: Airport[]; planning: AircraftPlanning; savePlanning: (p: AircraftPlanning) => void
  registry: AircraftRegistry | null | undefined; pilot: PilotInfo | undefined; savePilot: (p: PilotInfo) => void; readOnly?: boolean
}) {
  const { act, inp, putAct } = useCells(plan, set, readOnly)
  if (!d.flights.length) return null
  const alt = plan.alternate ? airports.find(a => a.icao === plan.alternate || a.id === plan.alternate) ?? null : null
  const wxDep = d.wx.find(w => w.role === 'departure'), wxDest = d.wx.find(w => w.role === 'destination'), wxAlt = d.wx.find(w => w.role === 'alternate')
  const fp = flightPlan(plan, d, alt, planning, registry)
  return (
    <section className="overflow-x-auto">
      <div className="min-w-[80rem]">
        <div className={cn(B, 'bg-fg py-1 text-center text-base font-bold tracking-wide text-bg')}>WEATHER LOG</div>
        <table className="w-full border-collapse">
          <thead>
            <tr><th className={H} rowSpan={2} /><th className={H} colSpan={2}>Ceiling, Visibility and Precipitation</th><th className={H} rowSpan={2}>Winds Aloft</th><th className={H} rowSpan={2}>Icing and Freezing Level</th><th className={H} rowSpan={2}>Turbulence and Cloud Tops</th><th className={H} rowSpan={2}>Position of Fronts, Lows and Highs</th></tr>
            <tr><th className={H}>Reported</th><th className={H}>Forecast</th></tr>
          </thead>
          <tbody className="align-top text-xs">
            {weatherLog(d, wxDep, wxDest, wxAlt, d.flights[0].alt).map(r => (
              <tr key={r.label}>
                <th className={cn(H, 'w-24 align-middle')}>{r.label}</th>
                {[r.reported, r.forecast, r.winds, r.icing, r.turb].map((v, i) => <td key={i} className={cn(B, 'h-16 p-1')}><span className={i === 0 ? 'num' : ''}>{v}</span></td>)}
                <td className={cn(B, 'h-16 p-1')}>{inp(act[`fronts-${r.label}`]?.ata ?? '', v => putAct(`fronts-${r.label}`, 'ata', v), 'text-left', 'From the surface analysis')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_17rem] gap-3">
          <div>
            <div className={cn(B, 'bg-fg py-1 text-center text-base font-bold tracking-wide text-bg')}>FLIGHT PLAN</div>
            <div className="grid grid-cols-12 text-xs">
              <Cell span="col-span-1" label="1. Type"><b>VFR</b></Cell>
              <Cell span="col-span-2" label="2. Aircraft Identification"><span className="num">{fp.ident}</span></Cell>
              <Cell span="col-span-2" label="3. Aircraft Type / Special Equipment"><span className="num">{fp.type}</span></Cell>
              <Cell span="col-span-1" label="4. True Airspeed"><span className="num">{fp.tas} kt</span></Cell>
              <Cell span="col-span-2" label="5. Departure Point"><span className="num">{fp.departure}</span></Cell>
              <Cell span="col-span-2" label="6. Departure Time (Z)"><span className="num">Proposed {fp.depTime}</span><div className="text-fg-3">Actual ____</div></Cell>
              <Cell span="col-span-2" label="7. Cruising Altitude"><span className="num">{fp.altitude}</span></Cell>
              <Cell span="col-span-12" label="8. Route of Flight"><span className="num">{fp.route}</span></Cell>
              <Cell span="col-span-4" label="9. Destination (Name of airport and city)">{fp.destination}</Cell>
              <Cell span="col-span-2" label="10. Est. Time Enroute"><span className="num">{fp.ete}</span></Cell>
              <Cell span="col-span-6" label="11. Remarks">{fp.remarks}</Cell>
              <Cell span="col-span-2" label="12. Fuel on Board"><span className="num">{fp.fuel}</span></Cell>
              <Cell span="col-span-3" label="13. Alternate Airport(s)"><span className="num">{fp.alternate}</span></Cell>
              <Cell span="col-span-5" label="14. Pilot's Name, Address, Tel # & Aircraft Home Base">
                <div className="grid grid-cols-2 gap-x-2">
                  {inp(pilot?.name ?? '', v => savePilot({ ...pilot, name: v }), 'text-left', 'Name')}
                  {inp(pilot?.phone ?? '', v => savePilot({ ...pilot, phone: v }), 'text-left', 'Phone')}
                  {inp(pilot?.address ?? '', v => savePilot({ ...pilot, address: v }), 'text-left', 'Address')}
                  {inp(pilot?.base ?? '', v => savePilot({ ...pilot, base: v }), 'text-left', 'Home base')}
                </div>
              </Cell>
              <Cell span="col-span-2" label="15. # Aboard"><span className="num">{fp.aboard}</span></Cell>
              <Cell span="col-span-5" label="16. Color of Aircraft">{inp(planning.color ?? '', v => savePlanning({ ...planning, color: v }), 'text-left', 'e.g. White/Blue')}</Cell>
              <Cell span="col-span-7" label="17. Destination Contact / Telephone (Optional)">{inp(act.contact?.ata ?? '', v => putAct('contact', 'ata', v), 'text-left')}</Cell>
            </div>
            <div className={cn(B, 'bg-fg/[0.07] px-2 py-1 text-center text-xs font-semibold')}>CLOSE VFR FLIGHT PLAN WITH <span className="num">{fp.fss}</span> ON ARRIVAL</div>
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
  )
}

function Cell({ span, label, children }: { span: string; label: string; children: React.ReactNode }) {
  return <div className={cn(B, span, 'min-h-12 px-1.5 py-1')}><div className="text-[10px] font-semibold text-fg-2">{label}</div><div className="mt-0.5">{children}</div></div>
}

function AdvisoryGrid({ dep, dest, u, rwyDep, rwyDest }: { dep?: WxAt; dest?: WxAt; u: Units; rwyDep: string; rwyDest: string }) {
  const cv = (w?: WxAt) => (w ? `${w.ceiling != null ? `${w.ceiling.toLocaleString()} ft` : 'No ceiling'} · ${w.visib ?? '—'} SM` : '')
  const wind = (w?: WxAt) => (w ? `${w.wind.dir == null ? (w.wind.spd ? 'VRB' : 'Calm') : deg3(w.wind.dir)}${w.wind.spd ? `/${w.wind.spd}${w.wind.gust ? `G${w.wind.gust}` : ''}` : ''}` : '')
  const rows: [string, string, string][] = [
    ['ATIS Code', '', ''], ['Ceiling & Visibility', cv(dep), cv(dest)], ['Wind', wind(dep), wind(dest)],
    ['Altimeter', dep ? fmtP(dep.altimInHg, u) : '', dest ? fmtP(dest.altimInHg, u) : ''], ['Approach', 'VFR', 'VFR'], ['Runway', rwyDep, rwyDest],
    ['Time Check', dep ? hhmm(dep.at) : '', dest ? hhmm(dest.at) : ''],
  ]
  return (
    <div className="num grid grid-cols-[1fr_6.5rem_1fr] text-xs">
      <div className={cn(B, 'bg-fg/[0.07] px-1 text-center font-semibold')}>Departure</div><div className={cn(B, 'bg-fg')} /><div className={cn(B, 'bg-fg/[0.07] px-1 text-center font-semibold')}>Destination</div>
      {rows.map(([l, a, b]) => <Fragment key={l}><div className={cn(B, 'min-h-6 px-1 text-center')}>{a}</div><div className={cn(B, 'bg-fg/[0.07] px-1 text-center font-sans font-semibold')}>{l}</div><div className={cn(B, 'min-h-6 px-1 text-center')}>{b}</div></Fragment>)}
    </div>
  )
}

// Frequencies straight from FAA NASR (the Chart Supplement's source), joined
// with "/" where there are several (e.g. NorCal 120.1/133.95/134.5).
const freqs = (a: Airport, re: RegExp, max = 3) => [...new Set(a.frequencies.filter(f => re.test(f.use)).map(f => f.freq))].slice(0, max).join('/')
const atisOf = (a: Airport) => freqs(a, /^D?-?ATIS$/, 1) || (a.wx?.freq ? `${a.wx.type} ${a.wx.freq}` : '')
const departureOf = (a: Airport) => freqs(a, /DEP\/P/, 2) || freqs(a, /^APCH\/P/, 1) || freqs(a, /^CLASS [BC]$/, 1) || a.approach?.frequencies[0]?.freq || ''
const approachOf = (a: Airport) => freqs(a, /^APCH\/[PS]|^CLASS [BC]$/) || a.approach?.frequencies.map(f => f.freq).slice(0, 3).join('/') || ''
const elevOf = (a: Airport) => `${Number.isInteger(a.elev) ? a.elev : a.elev.toFixed(1)} ft`
function FreqGrid({ dep, dest }: { dep: Airport; dest: Airport }) {
  const left: [string, string][] = [['ATIS', atisOf(dep)], ['Ground', freqs(dep, /^GND/, 1)], ['Tower', freqs(dep, /^LCL\/P/, 1)], ['Departure', departureOf(dep)], ['CTAF', freqs(dep, /^CTAF/, 1)], ['FSS', dep.fss?.id ?? ''], ['UNICOM', freqs(dep, /^UNICOM/, 1)], ['Field Elev', elevOf(dep)]]
  const right: [string, string][] = [['ATIS', atisOf(dest)], ['Approach', approachOf(dest)], ['Tower', freqs(dest, /^LCL\/P/, 1)], ['Ground', freqs(dest, /^GND/, 1)], ['CTAF', freqs(dest, /^CTAF/, 1)], ['FSS', dest.fss?.id ?? ''], ['UNICOM', freqs(dest, /^UNICOM/, 1)], ['Field Elev', elevOf(dest)]]
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
    return x ? `${cruiseAlt.toLocaleString()} ft: ${x.dir == null ? 'L&V' : deg3(x.dir)}/${x.spd} kt${x.temp != null ? `, ${x.temp > 0 ? '+' : ''}${x.temp}°C` : ''} (${d.fb.product.source ? 'model' : `FB ${x.stations.join('/')}`})` : ''
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

function flightPlan(plan: Plan, d: Derived, alt: Airport | null, planning: AircraftPlanning, registry: AircraftRegistry | null | undefined) {
  const pts = [d.legs[0].from, ...d.legs.map(l => l.to)]
  const dest = pts[pts.length - 1]
  const equip = planning.equipment?.equipCode || (planning.equipment?.gps?.includes('IFR') ? 'G' : 'U')
  const typeCode = registry?.model ? `C${String(registry.model).replace(/\D/g, '').slice(0, 3)}` : 'C172'
  const stops = d.flights.slice(0, -1).map(f => f.to.icao || f.to.id)
  const fss = d.legs[0].from.fss
  return {
    ident: plan.tail ?? '', type: `${typeCode}/${equip}`, tas: d.legs[0].tas, departure: pts[0].icao || pts[0].id, depTime: fmtZ(d.legs[0].departAt).replace('Z', ''),
    altitude: [...new Set(d.flights.map(f => f.alt))].join(' / '), route: pts.slice(1, -1).map(p => (p.kind === 'gps' ? icaoCoord(p) : isWaypoint(p) ? p.id : p.icao || p.id)).join(' ') || 'DCT',
    destination: `${dest.icao || dest.id} · ${dest.name}, ${dest.city}`, ete: fmtMin(d.totals.eteMin).replace(':', ' h ') + ' min',
    remarks: stops.length ? `Stops ${stops.join(' ')}` : '', fuel: fmtMin(d.totals.enduranceMin).replace(':', ' h ') + ' min', alternate: alt ? alt.icao || alt.id : '',
    aboard: soulsOf(plan) || '', fss: fss ? `${fss.id} FSS (1-800-WX-BRIEF / 122.2)` : 'FLIGHT SERVICE (1-800-WX-BRIEF / 122.2)',
  }
}

// A coordinate the way a flight plan takes it: 3658N12128W.
function icaoCoord(p: { lat: number; lon: number }) {
  const dm = (v: number, w: number) => { const a = Math.abs(v), d = Math.floor(a), m = Math.round((a - d) * 60); return m === 60 ? `${String(d + 1).padStart(w, '0')}00` : `${String(d).padStart(w, '0')}${String(m).padStart(2, '0')}` }
  return `${dm(p.lat, 2)}${p.lat >= 0 ? 'N' : 'S'}${dm(p.lon, 3)}${p.lon >= 0 ? 'E' : 'W'}`
}

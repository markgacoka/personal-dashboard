import { cn } from '@/lib/utils'
import type { AircraftPlanning, Derived } from './model'
import type { AircraftProfile } from './poh'
import { PohLink } from './RefPanel'
import type { AircraftSpecs } from './specs'
import { SubHead } from './ui'

type VS = AircraftProfile['vspeeds']

// The airspeed indicator laid flat: the white, green and yellow arcs and the red
// line from the POH (Fig. 2-2), with each V-speed marked under it.
export function AirspeedTape({ vs, arcs }: { vs: VS; arcs?: AircraftSpecs['arcs'] | null }) {
  const white: [number, number] = arcs?.white ?? [vs.vso, Number(String(vs.vfe).match(/\d+/)?.[0] ?? 85)]
  const green: [number, number] = arcs?.green ?? [vs.vs1, vs.vno]
  const yellow: [number, number] = arcs?.yellow ?? [vs.vno, vs.vne]
  const red = arcs?.red ?? vs.vne
  const lo = Math.floor((white[0] - 10) / 10) * 10, hi = Math.ceil((red + 10) / 10) * 10
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`
  const span = (a: number, b: number) => ({ left: x(a), width: `calc(${x(b)} - ${x(a)})` })
  const vfeTop = Number(String(vs.vfe).match(/\d+/)?.[0] ?? white[1])
  const marks = ([['Vso', vs.vso], ['Vs1', vs.vs1], ['Vx', vs.vx], ['Vy', vs.vy], ['Vfe', vfeTop], ['Va', vs.va[0]?.[1] ?? 0], ['Vno', vs.vno], ['Vne', vs.vne]] as [string, number][])
    .filter(([, v]) => v > 0).sort((a, b) => a[1] - b[1])
  const ticks = Array.from({ length: (hi - lo) / 20 + 1 }, (_, i) => lo + i * 20)
  return (
    <figure>
      <div className="relative h-[6rem]" role="img" aria-label={`Airspeed indicator: white arc ${white[0]}–${white[1]}, green ${green[0]}–${green[1]}, yellow ${yellow[0]}–${yellow[1]}, red line ${red} KIAS`}>
        <div className="absolute inset-x-0 top-0 h-2 rounded-full bg-border" />
        <div className="absolute top-0 h-2 rounded-full bg-fg-2" style={span(white[0], white[1])} />
        <div className="absolute inset-x-0 top-3 h-2.5 rounded-full bg-border" />
        <div className="absolute top-3 h-2.5 rounded-l-full bg-good" style={span(green[0], green[1])} />
        <div className="absolute top-3 h-2.5 rounded-r-full bg-warn" style={span(yellow[0], yellow[1])} />
        <div className="absolute -top-0.5 h-7 w-[3px] -translate-x-1/2 rounded-full bg-bad" style={{ left: x(red) }} />
        {ticks.map(t => <span key={t} className="num absolute top-[1.375rem] -translate-x-1/2 text-[11px] leading-none text-fg-3" style={{ left: x(t) }}>{t}</span>)}
        {marks.map(([k, v], i) => (
          <div key={k} className="absolute -translate-x-1/2 text-center" style={{ left: x(v), top: i % 2 ? '4.25rem' : '2.75rem' }}>
            <div className="mx-auto h-1.5 w-px bg-fg-3" />
            <div className="num whitespace-nowrap text-[13px] leading-tight text-fg"><span className="text-fg-3">{k}</span> {v}</div>
          </div>
        ))}
      </div>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-3">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-full bg-fg-2" />Flaps {white[0]}–{white[1]}</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-full bg-good" />Normal {green[0]}–{green[1]}</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-full bg-warn" />Smooth air only {yellow[0]}–{yellow[1]}</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-[3px] rounded-full bg-bad" />Never exceed {red}</span>
        <span>KIAS{arcs ? ` · ${arcs.ref}` : ' · from the speeds (no marking table for this model)'}</span>
      </figcaption>
    </figure>
  )
}

type Item = [string, React.ReactNode]
function Group({ title, refs, items, children, className }: { title: string; refs?: React.ReactNode; items?: Item[]; children?: React.ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0', className)}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border-strong pb-1"><h4 className="text-sm font-medium text-fg">{title}</h4><span className="text-[13px] text-fg-3">{refs}</span></div>
      {items && (
        <dl className="text-sm">
          {items.filter(([, v]) => v != null && v !== '').map(([k, v]) => (
            <div key={k} className="grid grid-cols-[minmax(6.5rem,34%)_1fr] gap-x-3 border-b border-border py-1.5 last:border-0"><dt className="text-fg-3">{k}</dt><dd className="min-w-0 text-fg">{v}</dd></div>
          ))}
        </dl>
      )}
      {children}
    </section>
  )
}

const FUEL_DOT: Record<string, string> = { Blue: '#3b82f6', Green: '#22a35a', Red: '#e5484d' }

// Everything the POH says about the airplane, grouped the way a preflight goes:
// engine and propeller, oil, fuel, gear and brakes, electrical, limits, stall
// speeds and the published performance. Pitot heat is optional equipment, so
// whether this airplane has it is yours to say.
export function SpecSheet({ s, p, d, rpm, planning, savePlanning, tail }: { s: AircraftSpecs; p: AircraftProfile; d: Derived; rpm: number; planning: AircraftPlanning; savePlanning: (p: AircraftPlanning) => void; tail: string }) {
  const tank = p.fuel.find(f => f.key === (planning.tanks || 'standard')) ?? p.fuel[0]
  const gphs = p.cruise.flatMap(r => r.cols.filter(c => !!c).map(c => c![2])).filter(g => g > 0)
  const f0 = d.flights[0]
  const gph = f0?.cruise?.gph ?? null
  const pitot = planning.equipment?.pitotHeat
  const setPitot = (v: boolean | undefined) => savePlanning({ ...planning, equipment: { ...planning.equipment, pitotHeat: v } })
  return (
    <div>
      <SubHead right={<span className="flex flex-wrap gap-3 text-[13px]"><PohLink fig="limits">Sec. 2 Limitations</PohLink><PohLink fig="stall">Fig. 5-3</PohLink></span>}>Specifications · {s.book}</SubHead>
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 2xl:grid-cols-3">
        <Group title="Engine and propeller" refs={`${s.engine.ref}, 2`} items={[
          ['Engine', `${s.engine.make} ${s.engine.model}`],
          ['Power', `${s.engine.hp} hp at ${s.engine.rpm.toLocaleString()} RPM`],
          ['Type', `${s.engine.type}; ${s.engine.displacement}`],
          ['Tachometer green', s.tach.map(t => `${t.green[0]}–${t.green[1]} at ${t.label.toLowerCase()}`).join(' · ')],
          ['Propeller', `${s.propeller.make} ${s.propeller.model}, ${s.propeller.blades} blades, ${s.propeller.type.toLowerCase()}`],
          ['Propeller diameter', `${s.propeller.diameterIn[1]} in maximum, ${s.propeller.diameterIn[0]} in minimum`],
          ['Ground clearance', s.propeller.groundClearance],
        ]} />
        <Group title="Oil" refs={s.oil.ref} items={[
          ['Sump capacity', `${s.oil.sumpQt} qt (${s.oil.totalQt} qt with the filter change)`],
          ['On the dipstick', `Not less than ${s.oil.minQt} qt; ${s.oil.extendedQt} qt for longer flights`],
          ['Pressure', `${s.oil.pressurePsi.min} psi minimum · ${s.oil.pressurePsi.green[0]}–${s.oil.pressurePsi.green[1]} psi normal · ${s.oil.pressurePsi.max} psi maximum`],
          ['Temperature', `${s.oil.maxTempF} °F maximum`],
          ['Type', s.oil.spec],
          ['Viscosity', <ul key="v" className="space-y-0.5">{s.oil.viscosity.map(v => <li key={v}>{v}</li>)}</ul>],
        ]} />
        <Group title="Fuel system" refs={s.fuel.ref} items={[
          ['Tanks', s.fuel.system],
          ['Selector', s.fuel.selector],
          ['Grades', <span key="g" className="flex flex-wrap gap-x-3 gap-y-1">{s.fuel.grades.map(g => <span key={g.grade} className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-full ring-1 ring-inset ring-border" style={{ background: FUEL_DOT[g.color] }} />{g.grade} · {g.color.toLowerCase()}</span>)}</span>],
          ['', s.fuel.gradeNote],
          ['Burn', gph ? `${gph} GPH planned at ${f0.alt.toLocaleString()} ft and ${rpm} RPM · ${Math.min(...gphs)}–${Math.max(...gphs)} GPH across the cruise table` : gphs.length ? `${Math.min(...gphs)}–${Math.max(...gphs)} GPH across the cruise table` : null],
          ['Endurance', gph && tank ? `${(tank.usable / gph).toFixed(1)} h on ${tank.usable} gal usable at ${gph} GPH, no reserve` : null],
        ]}>
          <table className="num mt-2 w-full text-sm text-fg-2">
            <thead><tr className="text-left text-[13px] text-fg-3"><th className="pb-1 font-medium">Tanks</th><th className="pb-1 pl-3 text-right font-medium">Each</th><th className="pb-1 pl-3 text-right font-medium">Total</th><th className="pb-1 pl-3 text-right font-medium">Unusable</th><th className="pb-1 pl-3 text-right font-medium">Usable</th></tr></thead>
            <tbody>{s.fuel.tanks.map(t => (
              <tr key={t.key} className={cn('border-t border-border', t.key === tank?.key && 'text-fg')}>
                <td className="py-1 font-sans">{t.label}{t.key === tank?.key && <span className="text-[13px] text-fg-3"> · this airplane</span>}</td><td className="py-1 pl-3 text-right">{t.each}</td><td className="py-1 pl-3 text-right">{t.total}</td><td className="py-1 pl-3 text-right">{t.unusable}</td><td className="py-1 pl-3 text-right">{t.usable} gal</td>
              </tr>
            ))}</tbody>
          </table>
        </Group>
        <Group title="Landing gear and brakes" refs={s.gear.ref} items={[
          ['Gear', `${s.gear.type}; ${s.gear.nose.toLowerCase()}`],
          ['Shock absorption', s.gear.shock],
          ['Nose tire', s.gear.tires.nose],
          ['Main tires', s.gear.tires.main],
          ['Nose strut', s.gear.strut],
          ['Brakes', s.brakes.type],
          ['Parking brake', `Yes. ${s.brakes.parking}`],
          ['Brake fluid', s.brakes.fluid],
          ['Wheel base', `${s.dims.wheelBaseIn} in`],
          ['Turning radius', s.dims.turningRadius],
        ]} />
        <Group title="Electrical and pitot heat" refs={s.electrical.ref} items={[
          ['System', `${s.electrical.volts}-volt DC`],
          ['Alternator', `${s.electrical.alternatorAmps} A, engine driven`],
          ['Battery', s.electrical.battery],
          ['Buses', s.electrical.bus],
          ['Warning', s.electrical.warning],
          ['Pitot heat (book)', s.pitotHeat],
        ]}>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-fg-3">Pitot heat on {tail}</span>
            {([[true, 'Installed'], [false, 'Not installed'], [undefined, 'Not sure']] as [boolean | undefined, string][]).map(([v, l]) => (
              <button key={l} onClick={() => setPitot(v)} aria-pressed={pitot === v}
                className={cn('press inline-flex h-8 items-center rounded-full px-3 text-sm ring-1 ring-inset', pitot === v ? 'bg-accent-soft text-accent ring-accent/40' : 'text-fg-2 ring-border hover:bg-hover')}>{l}</button>
            ))}
          </div>
        </Group>
        <Group title="Limits" refs={s.loadFactors.ref} items={[
          ['Load factor, normal', `${s.loadFactors.normal.flapsUp} flaps up · ${s.loadFactors.normal.flapsDown} flaps down (${s.loadFactors.normal.weight.toLocaleString()} lb)`],
          ['Load factor, utility', `${s.loadFactors.utility.flapsUp} flaps up · ${s.loadFactors.utility.flapsDown} flaps down (${s.loadFactors.utility.weight.toLocaleString()} lb)`],
          ['Flaps extended', s.vfe.map(v => `${v.kias} KIAS ${v.label.toLowerCase()}`).join(' · ')],
          ['Windows open', `${s.windowOpenKias} KIAS`],
          ['Maneuvering (Va)', p.vspeeds.va.map(([w, v]) => `${v} at ${w.toLocaleString()} lb`).join(' · ')],
          ['Crosswind demonstrated', `${p.crosswindDemo} kt`],
          ['Icing', s.icing],
        ]} />
        <Group title="Stall speeds" refs={`${s.stall.ref} · power off, ${s.stall.weight.toLocaleString()} lb`}>
          <table className="num w-full text-sm text-fg-2">
            <thead>
              <tr className="text-left text-[13px] text-fg-3"><th className="pb-1 font-medium">Flaps</th><th className="pb-1 font-medium">CG</th>{['0°', '30°', '45°', '60°'].map(b => <th key={b} className="pb-1 text-right font-medium">{b} bank</th>)}</tr>
            </thead>
            <tbody>
              {s.stall.rows.flatMap(r => [['Aft', r.aft], ['Fwd', r.fwd]].map(([cg, v], i) => (
                <tr key={`${r.flaps}${cg}`} className={cn(i === 0 && 'border-t border-border')}>
                  <td className="py-1 font-sans">{i === 0 ? r.flaps : ''}</td><td className="py-1 font-sans text-fg-3">{cg as string}</td>
                  {(v as number[]).map((k, j) => <td key={j} className="py-1 text-right">{k}</td>)}
                </tr>
              )))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[13px] text-fg-3">KIAS (approximate). {s.stall.altitudeLoss}. A forward CG stalls faster.</p>
        </Group>
        <Group title="Published performance" refs="Sec. 1 · standard day, maximum weight" items={[...s.summary.map(x => [x.label, x.value] as Item), ['Standard empty weight', `${s.emptyStandard.toLocaleString()} lb`], ['Wing area', `${s.dims.wingAreaSqFt} sq ft`]]} />
      </div>
    </div>
  )
}

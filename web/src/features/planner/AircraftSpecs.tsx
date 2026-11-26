import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { AircraftPlanning, Derived } from './model'
import type { AircraftProfile } from './poh'
import { PohLink } from './RefPanel'
import type { PohSpecs } from './specs'
import { SubHead } from './ui'

type VS = AircraftProfile['vspeeds']

// The airspeed indicator laid flat: the white, green and yellow arcs and the red
// line from the POH (Fig. 2-2), with each V-speed marked under it.
export function AirspeedTape({ vs, arcs }: { vs: VS; arcs?: PohSpecs['arcs'] }) {
  const white: [number, number] = arcs?.white ?? [vs.vso, Number(String(vs.vfe).match(/\d+/)?.[0] ?? 85)]
  const green: [number, number] = arcs?.green ?? [vs.vs1, vs.vno]
  const yellow: [number, number] = arcs?.yellow ?? [vs.vno, vs.vne]
  const red = arcs?.red ?? vs.vne
  const lo = Math.floor((white[0] - 10) / 10) * 10, hi = Math.ceil((red + 10) / 10) * 10
  const f = (v: number) => (v - lo) / (hi - lo)
  const x = (v: number) => `${f(v) * 100}%`
  const span = (a: number, b: number) => ({ left: x(a), width: `calc(${x(b)} - ${x(a)})` })
  const vfeTop = Number(String(vs.vfe).match(/\d+/)?.[0] ?? white[1])
  const marks = ([['Vso', vs.vso], ['Vs1', vs.vs1], ['Vx', vs.vx], ['Vy', vs.vy], ['Vfe', vfeTop], ['Va', vs.va[0]?.[1] ?? 0], ['Vno', vs.vno], ['Vne', vs.vne]] as [string, number][])
    .filter(([, v]) => v > 0).sort((a, b) => a[1] - b[1])
  const ticks = Array.from({ length: (hi - lo) / 10 + 1 }, (_, i) => lo + i * 10)
  // Labels go above the tape, each in the first row where it doesn't touch its neighbour at this width.
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth); return () => ro.disconnect() }, [])
  const rowEnds: number[] = []
  const placed = marks.map(([k, v]) => {
    const half = ((k.length + String(v).length + 1) * 7.2 + 6) / 2, c = f(v) * w
    let row = rowEnds.findIndex(end => c - half > end + 6)
    if (row < 0) { row = rowEnds.length; rowEnds.push(-Infinity) }
    rowEnds[row] = c + half
    return { k, v, row }
  })
  const rows = Math.max(1, rowEnds.length), ROW = 20, top = rows * ROW + 8
  return (
    <figure>
      <div ref={ref} className="relative" style={{ height: top + 40 }} role="img" aria-label={`Airspeed indicator: white arc ${white[0]}–${white[1]}, green ${green[0]}–${green[1]}, yellow ${yellow[0]}–${yellow[1]}, red line ${red} KIAS`}>
        {placed.map(({ k, v, row }) => (
          <div key={k} className="absolute -translate-x-1/2" style={{ left: x(v), top: (rows - 1 - row) * ROW }}>
            <div className="num whitespace-nowrap text-[13px] leading-[18px] text-fg"><span className="text-fg-3">{k}</span> {v}</div>
            <div className="absolute left-1/2 w-px -translate-x-1/2 bg-fg-3/60" style={{ top: 18, height: row * ROW + 8 }} />
          </div>
        ))}
        {/* The tape: green and yellow arcs, the white (flap) arc along its top edge, the red line. */}
        <div className="absolute inset-x-0 h-3 rounded-full bg-border" style={{ top }} />
        <div className="absolute h-3 rounded-l-full bg-good" style={{ top, ...span(green[0], green[1]) }} />
        <div className="absolute h-3 rounded-r-full bg-warn" style={{ top, ...span(yellow[0], yellow[1]) }} />
        <div className="absolute h-1.5 rounded-full bg-fg ring-1 ring-card" style={{ top: top - 3, ...span(white[0], white[1]) }} />
        <div className="absolute w-[3px] -translate-x-1/2 rounded-full bg-bad" style={{ top: top - 5, height: 22, left: x(red) }} />
        {ticks.map(t => (
          <div key={t} className="absolute -translate-x-1/2" style={{ left: x(t), top: top + 14 }}>
            <div className={cn('mx-auto w-px bg-fg-3', t % 20 === 0 ? 'h-2' : 'h-1')} />
            {t % 20 === 0 && <div className="num mt-0.5 text-[11px] leading-none text-fg-3">{t}</div>}
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-3">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-1.5 w-4 rounded-full bg-fg" />Flaps {white[0]}–{white[1]}</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-full bg-good" />Normal {green[0]}–{green[1]}</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-full bg-warn" />Smooth air only {yellow[0]}–{yellow[1]}</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-[3px] rounded-full bg-bad" />Never exceed {red}</span>
        <span>KIAS{arcs ? ` · the POH's airspeed indicator markings${arcs.unit === 'mph' ? ', converted from MPH' : ''}` : ' · from the speeds (the markings weren\'t read from the POH)'}</span>
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
// speeds and the published performance, as read from the book's text. A line
// the book didn't yield is left out. Pitot heat is optional equipment, so
// whether this airplane has it is yours to say.
export function SpecSheet({ s, book, p, d, rpm, planning, savePlanning, tail }: { s: PohSpecs; book: string; p: AircraftProfile; d: Derived; rpm: number; planning: AircraftPlanning; savePlanning: (p: AircraftPlanning) => void; tail: string }) {
  const tank = p.fuel.find(f => f.key === (planning.tanks || 'standard')) ?? p.fuel[0]
  const gphs = p.cruise.flatMap(r => r.cols.filter(c => !!c).map(c => c![2])).filter(g => g > 0)
  const f0 = d.flights[0]
  const gph = f0?.cruise?.gph ?? null
  const pitot = planning.equipment?.pitotHeat
  const setPitot = (v: boolean | undefined) => savePlanning({ ...planning, equipment: { ...planning.equipment, pitotHeat: v } })
  const e = s.engine, pr = s.propeller, o = s.oil, fu = s.fuel, g = s.gear, b = s.brakes, el = s.electrical, l = s.limits, lf = s.loadFactors
  const lfLine = (x?: { weight: number | null; flapsUp: string | null; flapsDown: string | null } | null) => (x ? [x.flapsUp && `${x.flapsUp} flaps up`, x.flapsDown && `${x.flapsDown} flaps down`].filter(Boolean).join(' · ') + (x.weight ? ` (${x.weight.toLocaleString()} lb)` : '') : null)
  return (
    <div>
      <SubHead right={<span className="flex flex-wrap gap-3 text-[13px]"><span className="text-fg-3">Read from the {s.ocr ? 'scanned ' : ''}book{s.ocr ? ' by OCR' : ''}</span><PohLink fig="limits">Sec. 2 Limitations</PohLink><PohLink fig="stall">Stall speeds</PohLink></span>}>Specifications · {book}</SubHead>
      <div className="grid gap-x-8 gap-y-6 @2xl:grid-cols-2 @5xl:grid-cols-3">
        {(e || pr) && <Group title="Engine and propeller" refs="Sec. 1, 2" items={[
          ['Engine', e?.model ? `${e.make ? `${e.make} ` : ''}${e.model}` : null],
          ['Power', e?.hp ? `${e.hp} hp${e.rpm ? ` at ${e.rpm.toLocaleString()} RPM` : ''}` : null],
          ['Type', e?.type ? `${e.type}${e.displacement ? `; ${e.displacement}` : ''}` : e?.displacement],
          ['Propeller', pr?.model ? `${pr.make ? `${pr.make} ` : ''}${pr.model}${pr.blades ? `, ${pr.blades} blades` : ''}${pr.type ? `, ${pr.type.toLowerCase()}` : ''}` : null],
          ['Propeller diameter', pr?.diameterIn ? `${pr.diameterIn[1]} in maximum, ${pr.diameterIn[0]} in minimum` : null],
          ['Ground clearance', pr?.groundClearance],
        ]} />}
        {o && <Group title="Oil" refs="Sec. 1, 2, 8" items={[
          ['Sump capacity', o.sumpQt ? `${o.sumpQt} qt${o.totalQt ? ` (${o.totalQt} qt with the filter change)` : ''}` : null],
          ['On the dipstick', o.minQt ? `Not less than ${o.minQt} qt${o.extendedQt ? `; ${o.extendedQt} qt for longer flights` : ''}` : null],
          ['Pressure', o.pressurePsi ? [o.pressurePsi.min && `${o.pressurePsi.min} psi minimum`, o.pressurePsi.green && `${o.pressurePsi.green[0]}–${o.pressurePsi.green[1]} psi normal`, o.pressurePsi.max && `${o.pressurePsi.max} psi maximum`].filter(Boolean).join(' · ') : null],
          ['Temperature', o.maxTempF ? `${o.maxTempF} °F maximum` : null],
          ['Type', o.spec],
          ['Viscosity', o.viscosity.length ? <ul key="v" className="space-y-0.5">{o.viscosity.map(v => <li key={v}>{v}</li>)}</ul> : null],
        ]} />}
        {(fu || tank) && <Group title="Fuel system" refs="Sec. 1, 2, 7" items={[
          ['Tanks', fu?.system],
          ['Selector', fu?.selector],
          ['Grades', fu?.grades.length ? <span key="g" className="flex flex-wrap gap-x-3 gap-y-1">{fu.grades.map(x => <span key={x.grade} className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-full ring-1 ring-inset ring-border" style={{ background: FUEL_DOT[x.color] }} />{x.grade} · {x.color.toLowerCase()}</span>)}</span> : null],
          ['Burn', gph && f0 ? `${gph} GPH planned at ${f0.alt.toLocaleString()} ft and ${rpm} RPM${gphs.length ? ` · ${Math.min(...gphs)}–${Math.max(...gphs)} GPH across the cruise table` : ''}` : gphs.length ? `${Math.min(...gphs)}–${Math.max(...gphs)} GPH across the cruise table` : null],
          ['Endurance', gph && tank ? `${(tank.usable / gph).toFixed(1)} h on ${tank.usable} gal usable at ${gph} GPH, no reserve` : null],
        ]}>
          {fu && fu.tanks.length > 0 && (
            <table className="num mt-2 w-full text-sm text-fg-2">
              <thead><tr className="text-left text-[13px] text-fg-3"><th className="pb-1 font-medium">Tanks</th><th className="pb-1 pl-3 text-right font-medium">Each</th><th className="pb-1 pl-3 text-right font-medium">Total</th><th className="pb-1 pl-3 text-right font-medium">Unusable</th><th className="pb-1 pl-3 text-right font-medium">Usable</th></tr></thead>
              <tbody>{fu.tanks.map(t => (
                <tr key={t.key} className={cn('border-t border-border', t.key === tank?.key && 'text-fg')}>
                  <td className="py-1 font-sans">{t.label}{t.key === tank?.key && <span className="text-[13px] text-fg-3"> · this airplane</span>}</td><td className="py-1 pl-3 text-right">{t.each}</td><td className="py-1 pl-3 text-right">{t.total}</td><td className="py-1 pl-3 text-right">{t.unusable}</td><td className="py-1 pl-3 text-right">{t.usable} gal</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Group>}
        {(g || b) && <Group title="Landing gear and brakes" refs="Sec. 7, 8" items={[
          ['Gear', g?.type ? `${g.type}${g.nose ? `; ${g.nose.toLowerCase()}` : ''}` : null],
          ['Shock absorption', g?.shock],
          ['Nose tire', g?.tires?.nose],
          ['Main tires', g?.tires?.main],
          ['Nose strut', g?.strut],
          ['Brakes', b?.type],
          ['Parking brake', b?.parking ? `Yes. ${b.parking}` : null],
          ['Brake fluid', b?.fluid],
          ['Wheel base', s.dims?.wheelBaseIn ? `${s.dims.wheelBaseIn} in` : null],
        ]} />}
        <Group title="Electrical and pitot heat" refs="Sec. 7" items={[
          ['System', el?.volts ? `${el.volts}-volt DC` : null],
          ['Alternator', el?.alternatorAmps ? `${el.alternatorAmps} A, engine driven` : null],
          ['Battery', el?.battery],
          ['Buses', el?.bus],
          ['Warning', el?.warning],
          ['Pitot heat (book)', s.pitotHeat],
        ]}>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-fg-3">Pitot heat on {tail}</span>
            {([[true, 'Installed'], [false, 'Not installed'], [undefined, 'Not sure']] as [boolean | undefined, string][]).map(([v, lb]) => (
              <button key={lb} onClick={() => setPitot(v)} aria-pressed={pitot === v}
                className={cn('press inline-flex h-8 items-center rounded-full px-3 text-sm ring-1 ring-inset', pitot === v ? 'bg-accent-soft text-accent ring-accent/40' : 'text-fg-2 ring-border hover:bg-hover')}>{lb}</button>
            ))}
          </div>
        </Group>
        <Group title="Limits" refs="Sec. 2" items={[
          [lf?.single ? 'Load factor' : 'Load factor, normal', lfLine(lf?.normal)],
          ['Load factor, utility', lfLine(lf?.utility)],
          ['Flaps extended', l?.vfe.length ? l.vfe.map(v => `${v.kias} KIAS ${v.label.toLowerCase()}`).join(' · ') : null],
          ['Windows open', l?.windowOpen ? `${l.windowOpen} KIAS` : null],
          ['Maneuvering (Va)', p.vspeeds.va.map(([w, v]) => `${v} at ${w.toLocaleString()} lb`).join(' · ')],
          ['Crosswind demonstrated', `${p.crosswindDemo} kt`],
          ['Icing', s.icing ? `${s.icing}. If you meet it anyway: pitot heat on (if installed), turn back or change altitude, cabin heat and defrost full.` : null],
        ]} />
        {s.stall && <Group title="Stall speeds" refs={`power off${s.stall.weight ? `, ${s.stall.weight.toLocaleString()} lb` : ''}`}>
          <table className="num w-full text-sm text-fg-2">
            <thead>
              <tr className="text-left text-[13px] text-fg-3"><th className="pb-1 font-medium">Flaps</th><th className="pb-1 font-medium">CG</th>{['0°', '30°', '45°', '60°'].map(x => <th key={x} className="pb-1 pl-2 text-right font-medium">{x} bank</th>)}</tr>
            </thead>
            <tbody>
              {s.stall.rows.flatMap(r => ([['Aft', r.aft], ['Fwd', r.fwd]] as [string, number[]][]).map(([cg, v], i) => (
                <tr key={`${r.flaps}${cg}`} className={cn(i === 0 && 'border-t border-border')}>
                  <td className="py-1 font-sans">{i === 0 ? r.flaps : ''}</td><td className="py-1 font-sans text-fg-3">{cg}</td>
                  {v.map((k, j) => <td key={j} className="py-1 pl-2 text-right">{k}</td>)}
                </tr>
              )))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[13px] text-fg-3">KIAS (approximate).{s.stall.altitudeLoss ? ` ${s.stall.altitudeLoss}.` : ''} A forward CG stalls faster.</p>
        </Group>}
        {(s.summary?.length || s.emptyStandard) ? <Group title="Published performance" refs="Sec. 1 · standard day, maximum weight" items={[...(s.summary ?? []).map(x => [x.label, x.value] as Item), ['Standard empty weight', s.emptyStandard ? `${s.emptyStandard.toLocaleString()} lb` : null], ['Wing area', s.dims?.wingAreaSqFt ? `${s.dims.wingAreaSqFt} sq ft` : null]]} /> : null}
      </div>
    </div>
  )
}

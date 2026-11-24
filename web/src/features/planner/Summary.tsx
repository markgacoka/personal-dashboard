import { useState } from 'react'
import { ArrowRight, ChevronDown, CloudSun, Fuel, Navigation, Printer, Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PerfAt } from './model'
import type { SectionKey } from './readiness'
import { RunwayDiagram, RunwayFacts } from './RunwayDiagram'
import { TaskRow } from './Sections'
import { Cat, VerdictIcon, deg3, fmtMin, fmtTime } from './ui'
import { useFlight } from './useFlight'

// The flight at a glance: the verdict, what's left to do, and one tile per
// thing a pilot checks before going (route, fuel, weight and CG, each runway,
// the weather). Each tile opens the section that holds it.

const code = (a: { icao: string | null; id: string }) => a.icao || a.id

function Tile({ title, icon: I, go, className, children }: { title: React.ReactNode; icon?: typeof Fuel; go: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={go} className={cn('group flex min-w-0 flex-col rounded-xl bg-card p-4 text-left ring-1 ring-inset ring-white/[0.04] transition-colors hover:bg-hover', className)}>
      <span className="mb-3 flex items-center gap-2 text-[13px] text-fg-3">{I && <I className="size-4" />}<span className="min-w-0 flex-1 truncate">{title}</span><ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></span>
      {children}
    </button>
  )
}

// Fuel as one bar against what's usable: taxi, trip, the reserve, and what's left over.
function FuelBar({ taxi, trip, reserve, usable }: { taxi: number; trip: number; reserve: number; usable: number }) {
  const total = Math.max(usable, taxi + trip + reserve)
  const extra = Math.max(0, usable - taxi - trip - reserve)
  const short = taxi + trip + reserve > usable
  const parts = [
    { k: 'Taxi', v: taxi, c: 'bg-fg-3/60' }, { k: 'Trip', v: trip, c: 'bg-accent' }, { k: 'Reserve', v: reserve, c: 'bg-warn' }, { k: 'Extra', v: extra, c: 'bg-good/50' },
  ].filter(p => p.v > 0.05)
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-pill" role="img" aria-label={parts.map(p => `${p.k} ${p.v.toFixed(1)} gallons`).join(', ')}>
        {parts.map(p => <span key={p.k} className={cn('h-full first:rounded-l-full last:rounded-r-full', p.c)} style={{ width: `${(p.v / total) * 100}%` }} />)}
      </div>
      <ul className="num mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
        {parts.map(p => <li key={p.k} className="flex items-center gap-1.5"><span className={cn('size-2 shrink-0 rounded-full', p.c)} /><span className="text-fg-3">{p.k}</span><span className="ml-auto text-fg-2">{p.v.toFixed(1)}</span></li>)}
      </ul>
      {short && <p className="mt-2 text-[13px] font-medium text-bad">Not enough fuel aboard</p>}
    </div>
  )
}

// Weight against the maximum, and the CG between the envelope's forward and aft limits at that weight.
function cgRange(env: [number, number][], w: number): [number, number] | null {
  const xs: number[] = []
  for (let i = 0; i < env.length; i++) {
    const [x1, y1] = env[i], [x2, y2] = env[(i + 1) % env.length]
    if ((w - y1) * (w - y2) <= 0 && y1 !== y2) xs.push(x1 + ((w - y1) / (y2 - y1)) * (x2 - x1))
  }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null
}
function WbGauge({ weight, max, cg, env }: { weight: number; max: number; cg: number | null; env: [number, number][] }) {
  const r = cg != null ? cgRange(env, Math.min(weight, max)) : null
  const pctW = Math.min(100, (weight / max) * 100)
  const over = weight > max
  const lo = r ? r[0] - 2 : 0, hi = r ? r[1] + 2 : 1
  const at = r && cg != null ? Math.max(0, Math.min(100, ((cg - lo) / (hi - lo)) * 100)) : null
  const inside = r && cg != null && cg >= r[0] && cg <= r[1]
  return (
    <div className="space-y-3.5">
      <div>
        <div className="num mb-1.5 flex items-baseline justify-between text-[13px]"><span className="text-fg-3">Takeoff weight</span><span className={over ? 'font-medium text-bad' : 'text-fg'}>{Math.round(weight).toLocaleString()} <span className="text-fg-3">/ {max.toLocaleString()} lb</span></span></div>
        <div className="h-2 overflow-hidden rounded-full bg-pill"><span className={cn('block h-full rounded-full', over ? 'bg-bad' : 'bg-accent')} style={{ width: `${pctW}%` }} /></div>
      </div>
      {r && cg != null && (
        <div>
          <div className="num mb-1.5 flex items-baseline justify-between text-[13px]"><span className="text-fg-3">CG</span><span className={inside ? 'text-fg' : 'font-medium text-bad'}>{cg.toFixed(1)} in</span></div>
          <div className="relative h-2 rounded-full bg-pill">
            <span className="absolute inset-y-0 rounded-full bg-good/40" style={{ left: `${((r[0] - lo) / (hi - lo)) * 100}%`, right: `${100 - ((r[1] - lo) / (hi - lo)) * 100}%` }} />
            <span className={cn('absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card', inside ? 'bg-fg' : 'bg-bad')} style={{ left: `${at}%` }} />
          </div>
          <div className="num mt-1 flex justify-between text-[12px] text-fg-3"><span>fwd {r[0].toFixed(1)}</span><span>aft {r[1].toFixed(1)}</span></div>
        </div>
      )}
    </div>
  )
}

function RunwayTile({ p, label, go }: { p: PerfAt; label: string; go: () => void }) {
  const a = p.airport, w = p.wx.wind
  const wind = p.wx.wind.from ? { dir: w.dir, spd: w.spd, gust: w.gust } : null
  return (
    <Tile title={<>{label} · <span className="num text-fg-2">{code(a)}</span> {fmtTime(p.wx.at)}</>} go={go}>
      <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-4">
        <RunwayDiagram compact airport={a} wind={wind} active={p.runway ? [p.runway.end.id] : []} />
        <RunwayFacts compact airport={a} wind={wind} end={p.runway?.end ?? null} />
      </div>
      {p.dist && p.runway && (
        <div className="num mt-3 text-[13px] text-fg-3">{p.kind === 'takeoff' ? 'Over 50 ft in' : 'Landing over 50 ft'} <span className="text-fg-2">{p.dist.total.toLocaleString()} ft</span> of {(p.kind === 'takeoff' ? p.runway.toraFt : p.runway.ldaFt).toLocaleString()}</div>
      )}
    </Tile>
  )
}

// Column counts that divide the tiles evenly at each width (6 → 1, 2, 3 or 6
// across; 4 → 2 or 4), so no row is left with a hole; five put the last one
// across two columns.
const COLS: Record<number, string> = {
  6: '@2xl:grid-cols-2 @5xl:grid-cols-3 @[104rem]:grid-cols-6',
  5: '@2xl:grid-cols-2 @5xl:grid-cols-3 @2xl:[&>*:last-child]:col-span-2',
  4: '@2xl:grid-cols-2 @[80rem]:grid-cols-4',
  3: '@4xl:grid-cols-3',
  2: '@2xl:grid-cols-2',
}
function TileGrid({ children }: { children: (React.ReactNode | false | null | undefined)[] }) {
  const list = children.filter(Boolean)
  return <div className={cn('grid gap-3', COLS[list.length])}>{list}</div>
}

export function Summary({ printAll }: { printAll: () => void }) {
  const f = useFlight()
  const { d, plan } = f
  const t = d.totals
  const [showRec, setShowRec] = useState(false)
  const must = f.tasks.filter(x => x.kind !== 'recommended'), rec = f.tasks.filter(x => x.kind === 'recommended')
  const to = d.wb.steps.find(x => x.total && x.label.startsWith('Takeoff'))
  const dep = d.perf.find(p => p.kind === 'takeoff'), arr = [...d.perf].reverse().find(p => p.kind === 'landing' && p.wx.role !== 'alternate')
  const go = (k: SectionKey) => () => f.go(k)
  const ready = !must.length && plan.route.length > 1
  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <VerdictIcon status={f.verdict} className="size-6" />
        <h2 className="text-xl font-medium tracking-[-0.015em] text-fg">{f.verdictLabel}</h2>
        {must.length > 0 && <span className="text-sm text-fg-3">{must.length} to resolve</span>}
        {ready && <Button className="ml-auto" variant="primary" onClick={printAll}><Printer />Print all three</Button>}
      </section>

      {d.legs.length > 0 ? (
        <div className="@container">
          <TileGrid>{[
            <Tile key="route" title="Route" icon={Navigation} go={go('route')}>
              <div className="num truncate text-lg font-medium text-fg">{f.routeText}</div>
              <dl className="num mt-3 grid grid-cols-3 gap-2 text-[13px]">
                <div><dt className="text-fg-3">Distance</dt><dd className="text-fg">{Math.round(t.distNm)} nm</dd></div>
                <div><dt className="text-fg-3">Time</dt><dd className="text-fg">{fmtMin(t.eteMin)}</dd></div>
                <div><dt className="text-fg-3">Cruise</dt><dd className="truncate text-fg">{d.flights.map(x => `${(x.alt / 1000).toFixed(1)}k`).join(' / ')} ft</dd></div>
              </dl>
              <div className="num mt-3 text-[13px] text-fg-3">Off {fmtTime(d.takeoffAt)} · on {fmtTime(d.legs.at(-1)!.arriveAt)}{d.flights[0]?.cruise ? ` · ${d.flights[0].cruise.ktas} KTAS` : ''}</div>
            </Tile>,
            <Tile key="fuel" title={<>Fuel · <span className="num text-fg-2">{t.requiredFuel.toFixed(1)} of {t.usableFuel.toFixed(1)} gal</span></>} icon={Fuel} go={() => f.explain({ kind: 'topic', key: 'fuel' })}>
              <FuelBar taxi={t.taxiFuel} trip={t.tripFuel} reserve={t.reserveFuel} usable={t.usableFuel} />
            </Tile>,
            to && d.profile && (
              <Tile key="wb" title="Weight and balance" icon={Scale} go={go('loading')}>
                <WbGauge weight={to.weight} max={d.profile.limits.maxTakeoff} cg={to.arm} env={d.profile.envelope.normal} />
              </Tile>
            ),
            dep && <RunwayTile key="dep" p={dep} label="Departure" go={go('airports')} />,
            arr && <RunwayTile key="arr" p={arr} label="Arrival" go={go('airports')} />,
            <Tile key="wx" title="Weather" icon={CloudSun} go={go('weather')}>
              <ul className="space-y-2">
                {d.wx.map(w => (
                  <li key={`${w.role}-${code(w.airport)}`} className="num flex items-center gap-2 text-[13px]">
                    <span className="w-12 font-medium text-fg">{code(w.airport)}</span>
                    {w.category ? <Cat cat={w.category} /> : <span className="text-fg-3">no report</span>}
                    <span className="ml-auto truncate text-fg-2">{w.wind.from ? (!w.wind.spd ? 'calm' : w.wind.dir == null ? `VRB${w.wind.spd}` : `${deg3(w.wind.dir)}/${w.wind.spd}${w.wind.gust ? `G${w.wind.gust}` : ''}`) : '—'}</span>
                    <span className="w-16 text-right text-fg-3">{fmtTime(w.at)}</span>
                  </li>
                ))}
              </ul>
            </Tile>,
          ]}</TileGrid>
        </div>
      ) : <p className="text-sm text-fg-3">Tiles appear once the route resolves.</p>}

      {must.length > 0 && (
        <section><h3 className="mb-2 text-[15px] font-medium text-fg">To resolve</h3><ul className="grid gap-x-8 rounded-xl px-4 ring-1 ring-inset ring-border sm:px-5 @5xl:grid-cols-2 [&>li]:border-b [&>li]:border-border [&>li:last-child]:border-0 2xl:[&>li:nth-last-child(2):nth-child(odd)]:border-0">{must.map(x => <TaskRow key={x.id} t={x} compact onGo={() => f.go(x.section)} />)}</ul></section>
      )}

      {rec.length > 0 && (
        <section>
          <button onClick={() => setShowRec(v => !v)} aria-expanded={showRec} className="inline-flex items-center gap-1.5 text-[13px] text-fg-3 hover:text-fg">
            <ChevronDown className={cn('size-3.5 transition-transform', !showRec && '-rotate-90')} />{rec.length} suggestion{rec.length > 1 ? 's' : ''} for a fuller brief
          </button>
          {showRec && <ul className="mt-2 divide-y divide-border rounded-xl px-4 ring-1 ring-inset ring-border sm:px-5">{rec.map(x => <TaskRow key={x.id} t={x} onGo={() => f.go(x.section)} />)}</ul>}
        </section>
      )}
    </div>
  )
}

import { Pencil } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { titleCase } from '@/lib/format'
import type { CurrencyItem } from '@/lib/flying'
import type { AircraftRegistry } from '@/lib/types'
import { IMSAFE, PAVE } from './checklists'
import type { AircraftPlanning, Airport, Derived, Minimums, Plan, SectionKey, Status, WeatherBundle } from './model'
import type { ProfileMatch } from './poh'
import { LoadingSection } from './LoadingSection'
import { NavlogSection } from './NavlogSection'
import { PerformanceSection } from './PerformanceSection'
import { PlannerMap } from './PlannerMap'
import { WeatherSection } from './WeatherSection'
import { freqLabel } from './TripSection'
import { Cat, CheckRows, KV, StatusBadge, StatusIcon, fmtMin, fmtTime, fmtZ } from './ui'

const TITLES: Record<SectionKey, string> = {
  trip: '1 · Where am I going?', pilot: '2 · Am I okay to go?', aircraft: '3 · What am I going with?', loading: '4 · Can it carry the load?',
  performance: '5 · Can it get off and back on the ground?', navlog: '6 · How do I get there?', weather: '7 · Is it safe there and back?',
}

export function ReviewStep({ plan, d, overall, verdict, airports, weather, airspace, currency, minimums, planning, registry, match, terrainAt, onJump }: {
  plan: Plan; d: Derived; overall: Status; verdict: { label: string; sub: string }; airports: Airport[]; weather: WeatherBundle | null; airspace: unknown
  currency: CurrencyItem[]; minimums: Minimums; planning: AircraftPlanning; registry: AircraftRegistry | null | undefined; match: ProfileMatch | null; terrainAt?: string
  onJump: (k: SectionKey) => void
}) {
  const route = d.legs.length ? [d.legs[0].from, ...d.legs.map(l => l.to)] : []
  const alt = plan.alternate ? airports.find(a => a.icao === plan.alternate || a.id === plan.alternate) ?? null : null
  const tone = overall === 'nogo' ? 'bg-bad-soft ring-bad/30' : overall === 'caution' ? 'bg-warn-soft ring-warn/30' : overall === 'ok' ? 'bg-good-soft ring-good/30' : 'bg-card ring-border'
  const noop = () => {}
  return (
    <div className="space-y-5">
      <section className={`rounded-xl p-5 ring-1 ring-inset sm:p-6 ${tone}`}>
        <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-medium text-fg">Go or no-go: {verdict.label}</h1><StatusBadge status={overall} size="md" /></div>
        <p className="mt-1 text-sm text-fg-2">{verdict.sub} This page doesn't replace a standard briefing from Flight Service, your CFI's judgment or the POH in the airplane.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {(['nogo', 'caution', 'todo'] as Status[]).map(s => {
            const list = d.checks.filter(c => c.status === s)
            if (!list.length) return null
            return (
              <div key={s}>
                <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-fg"><StatusIcon status={s} />{{ nogo: 'No-go', caution: 'Caution', todo: 'Still to do', ok: '' }[s]} ({list.length})</div>
                <div className="rounded-lg bg-card"><CheckRows checks={list} onJump={c => onJump(c.section)} /></div>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-sm text-fg-3">{d.checks.filter(c => c.status === 'ok').length} checks passed.</p>
      </section>

      <ReviewBlock k="trip" status={d.sections.trip} onEdit={() => onJump('trip')}>
        <div className="grid gap-5 lg:grid-cols-5">
          <KV className="lg:col-span-2" items={[
            ['Route', <span className="num">{plan.route.map(r => r.replace(/\*$/, ' (fly over)')).join(' → ')}</span>],
            ['Alternate', alt ? <span className="num">{alt.icao || alt.id}</span> : 'None'],
            ['Departure', d.departAt ? <span className="num">{d.departAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ({fmtZ(d.departAt)})</span> : '—'],
            ['Arrival', d.legs.length ? <span className="num">{fmtTime(d.legs.at(-1)!.arriveAt)} ({fmtZ(d.legs.at(-1)!.arriveAt)})</span> : '—'],
            ['Distance / time', <span className="num">{d.totals.distNm.toFixed(0)} nm · {fmtMin(d.totals.eteMin)} en route</span>],
            ['Cruise', <span className="num">{plan.cruiseAlt.toLocaleString()} ft MSL · {plan.rpm} RPM</span>],
            ['Ground time at stops', `${plan.stopMinutes} min`],
          ]} />
          {route.length > 1 && <PlannerMap className="h-72 lg:col-span-3" route={route} alternate={alt} weather={weather} d={d} airspace={airspace} />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead><tr className="text-left text-xs text-fg-3"><th className="pb-1.5 font-medium">Airport</th><th className="pb-1.5 font-medium">ETA</th><th className="pb-1.5 font-medium">Control</th><th className="pb-1.5 font-medium">Frequencies</th><th className="pb-1.5 font-medium">Runways</th><th className="pb-1.5 text-right font-medium">Elev / TPA</th></tr></thead>
            <tbody>{[...new Map([...route, ...(alt ? [alt] : [])].map(a => [a.id, a])).values()].map(a => {
              const w = d.wx.find(x => x.airport.id === a.id)
              return (
                <tr key={a.id} className="border-t border-border align-top">
                  <td className="py-2"><span className="num font-medium">{a.icao || a.id}</span> <span className="text-fg-3">{titleCase(a.name)}</span></td>
                  <td className="num py-2">{w ? fmtTime(w.at) : '—'}</td>
                  <td className="py-2">{a.towered ? `Tower ${a.towerHrs ?? ''}` : 'CTAF'}{a.airspace?.C ? ' · Class C' : a.airspace?.D ? ' · Class D' : ''}</td>
                  <td className="num py-2 text-fg-2">{a.frequencies.filter(f => /ATIS|LCL\/P|GND\/P|CTAF/.test(f.use)).map(f => `${freqLabel(f.use)} ${f.freq}`).join(' · ')}{a.wx?.phone ? ` · ${a.wx.type} ${a.wx.phone}` : ''}</td>
                  <td className="num py-2 text-fg-2">{a.runways.map(r => `${r.id} ${r.len}×${r.wid ?? '—'}`).join(', ')}</td>
                  <td className="num py-2 text-right">{Math.round(a.elev)} / {Math.round((a.elev + (a.tpaAgl || 1000)) / 10) * 10}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      </ReviewBlock>

      <ReviewBlock k="pilot" status={d.sections.pilot} onEdit={() => onJump('pilot')}>
        <div className="grid gap-5 lg:grid-cols-3">
          <div><div className="mb-1 text-sm font-medium text-fg-2">IMSAFE</div><ul className="space-y-1 text-sm">{IMSAFE.map(i => <li key={i.key} className="flex items-center gap-2"><StatusIcon status={plan.imsafe[i.key] === true ? 'ok' : plan.imsafe[i.key] === false ? 'nogo' : 'todo'} />{i.label}</li>)}</ul></div>
          <div><div className="mb-1 text-sm font-medium text-fg-2">PAVE</div><KV items={PAVE.map(p => [p.label, plan.pave[p.key] || <span className="text-fg-3">Not reviewed</span>])} /></div>
          <div><div className="mb-1 text-sm font-medium text-fg-2">Currency · minimums</div>
            <ul className="space-y-1 text-sm">{currency.filter(c => c.key !== 'ifr').map(c => <li key={c.key} className="flex items-center gap-2"><StatusIcon status={c.state === 'current' ? 'ok' : 'caution'} />{c.name}: {c.state}</li>)}</ul>
            <p className="num mt-2 text-sm text-fg-3">Wind {minimums.maxWind}G{minimums.maxGust} · xwind {minimums.maxCrosswind} kt · ceiling {minimums.ceilingDay.toLocaleString()} ft · vis {minimums.visDay} SM · runway {minimums.runwayLength.toLocaleString()} ft · reserve {minimums.reserveDay} min</p>
          </div>
        </div>
      </ReviewBlock>

      <ReviewBlock k="aircraft" status={d.sections.aircraft} onEdit={() => onJump('aircraft')}>
        <KV items={[
          ['Aircraft', <span><span className="num">{plan.tail ?? '—'}</span> · {registry?.make} {registry?.model}{registry?.year ? ` (${registry.year})` : ''}</span>],
          ['POH used', match ? `${match.profile.source}${match.exact ? '' : ' — closest available'}` : '—'],
          ['Equipment', [planning.equipment?.transponder, planning.equipment?.adsbOut ? 'ADS-B Out' : null, planning.equipment?.gps, planning.equipment?.equipCode && `/${planning.equipment.equipCode}`].filter(Boolean).join(' · ') || 'Not recorded'],
          ['Required equipment', `${Object.values(plan.equipment).filter(Boolean).length} items checked`],
          ['Checklists reviewed', `${Object.values(plan.phases).filter(Boolean).length} phases`],
        ]} />
        <CheckRows checks={d.checks.filter(c => c.section === 'aircraft' && c.status !== 'ok')} />
      </ReviewBlock>

      <ReviewBlock k="loading" status={d.sections.loading} onEdit={() => onJump('loading')}><LoadingSection plan={plan} set={noop} d={d} profile={d.profile} planning={planning} savePlanning={noop} readOnly /></ReviewBlock>
      <ReviewBlock k="performance" status={d.sections.performance} onEdit={() => onJump('performance')}><PerformanceSection d={d} profile={d.profile} /></ReviewBlock>
      <ReviewBlock k="navlog" status={d.sections.navlog} onEdit={() => onJump('navlog')}><NavlogSection plan={plan} set={noop} d={d} airports={airports} terrainAt={terrainAt} planning={planning} registry={registry} readOnly /></ReviewBlock>
      <ReviewBlock k="weather" status={d.sections.weather} onEdit={() => onJump('weather')}>
        <div className="flex flex-wrap gap-2">{d.wx.map((w, i) => <span key={i} className="inline-flex items-center gap-1.5 text-sm"><span className="num">{w.airport.icao || w.airport.id}</span><Cat cat={w.category} /></span>)}</div>
        <WeatherSection d={d} weather={weather} loading={false} refetch={noop} fetching={false} />
      </ReviewBlock>
    </div>
  )
}

function ReviewBlock({ k, status, onEdit, children }: { k: SectionKey; status: Status; onEdit: () => void; children: React.ReactNode }) {
  return (
    <Card className="break-inside-avoid-page">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3 sm:px-6">
        <StatusIcon status={status} />
        <h2 className="flex-1 text-base font-medium text-fg">{TITLES[k]}</h2>
        <Button size="sm" variant="ghost" className="print:hidden" onClick={onEdit}><Pencil />Edit</Button>
      </header>
      <div className="space-y-5 px-5 py-4 sm:px-6">{children}</div>
    </Card>
  )
}

import { useState } from 'react'
import { ArrowRight, ExternalLink, Plus, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChecklistPrint } from './AircraftChecklist'
import { AircraftStep } from './AircraftStep'
import { AirportsStep } from './AirportsStep'
import { flightNotes } from './brief'
import { CgChart } from './ExplainView'
import { FlightInputs } from './FlightInputs'
import { NavlogFront, NavlogReverse } from './NavlogSheet'
import { PerformanceSection } from './PerformanceSection'
import { PilotStep } from './PilotStep'
import { AircraftPicker, CrewPicker, NeedsPilotProfile } from './Pickers'
import { PlannerMap } from './PlannerMap'
import { WbTable } from './PohSummary'
import { PersonForm } from './ProfileForms'
import { seatPerson } from './profiles'
import { SECTION_LABEL, type SectionKey, type Task } from './readiness'
import { RouteStep } from './RouteStep'
import { StatusIcon, SubHead, fmtTime } from './ui'
import { useFlight } from './useFlight'
import { WbLimits } from './WbLimits'
import { WeatherSection as WeatherBrief } from './WeatherSection'

// Each section of the flight file: a heading, what's still open in it (with
// what to do), the inputs that belong to it, then the brief.

const TASK_STATUS = { nogo: 'nogo', caution: 'caution', todo: 'todo', recommended: 'note' } as const
export function TaskRow({ t, onGo }: { t: Task; onGo?: () => void }) {
  return (
    <li className="flex gap-3 py-2">
      <StatusIcon status={TASK_STATUS[t.kind]} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className={cn('text-sm', t.kind === 'nogo' ? 'text-fg' : 'text-fg-2')}>{t.title}</div>
        {t.detail && <div className="mt-0.5 text-[13px] leading-snug text-fg-3">{t.detail}</div>}
      </div>
      {onGo && <button onClick={onGo} className="inline-flex shrink-0 items-center gap-1 self-start text-[13px] text-accent hover:underline">{SECTION_LABEL[t.section]}<ArrowRight className="size-3.5" /></button>}
    </li>
  )
}

export function Section({ k, lead, right, children }: { k: SectionKey; lead?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  const f = useFlight()
  const open = f.tasks.filter(t => t.section === k)
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0"><h2 className="text-xl font-medium tracking-[-0.015em] text-fg">{SECTION_LABEL[k]}</h2>{lead && <p className="mt-1 max-w-3xl text-sm text-fg-3">{lead}</p>}</div>
        {right}
      </header>
      {open.length > 0 && (
        <section aria-label="Still open" className="rounded-xl px-4 py-2 ring-1 ring-inset ring-border sm:px-5">
          <ul className="divide-y divide-border">{open.map(t => <TaskRow key={t.id} t={t} />)}</ul>
        </section>
      )}
      {children}
    </div>
  )
}

const Panel = ({ title, lead, children, className }: { title?: React.ReactNode; lead?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={cn('rounded-xl bg-card px-4 py-5 ring-1 ring-inset ring-white/[0.04] sm:px-6', className)}>
    {title && <div className="mb-4"><h3 className="text-[15px] font-medium text-fg">{title}</h3>{lead && <p className="mt-0.5 text-[13px] text-fg-3">{lead}</p>}</div>}
    {children}
  </section>
)

export function PilotSection() {
  const f = useFlight()
  return (
    <Section k="pilot" lead="Who's flying, what the FAA rules allow on this flight for that role, whether you're fit to fly, and the weather against your personal minimums.">
      <NeedsPilotProfile />
      <Panel title="Who's flying"><CrewPicker /></Panel>
      <PilotStep plan={f.plan} set={f.set} d={f.d} currency={f.currency} certs={f.certs ?? null}
        saveCerts={c => f.certsQ.save.mutate(c, { onSuccess: () => toast.success('Certificates saved'), onError: e => toast.error(e.message) })} savingCerts={f.certsQ.save.isPending}
        minimums={f.minimums} savedAt={f.minQ.data?.updatedAt} saveMinimums={m => f.minQ.save.mutate(m, { onSuccess: () => toast.success('Minimums saved') })} saving={f.minQ.save.isPending} />
    </Section>
  )
}

export function AircraftSection() {
  const f = useFlight()
  return (
    <Section k="aircraft" lead="The airplane from its registry, its POH and its profile: what it is, its speeds and systems, its performance today, its checklist and whether it's airworthy for this flight.">
      <Panel title="Aircraft"><AircraftPicker /></Panel>
      {f.plan.tail && (
        <AircraftStep plan={f.plan} set={f.set} d={f.d} registry={f.registry.data} match={f.match} poh={f.pohQ.data?.match} pohDoc={f.pohDoc} pohUploaded={!!f.pohQ.data?.uploaded}
          savingPlanning={f.planningQ.save.isPending} pohLoading={f.pohQ.isLoading} pohError={f.pohQ.error ? (f.pohQ.error as Error).message : null} aircraft={f.aircraft} planning={f.planning} savePlanning={f.savePlanning} u={f.u} />
      )}
    </Section>
  )
}

export function WeatherSectionView() {
  const f = useFlight()
  const briefed = f.plan.checklist?.['brief.standard'] === true
  return (
    <Section k="weather" lead="Weather at each airport at the time you're there, hazards on the route, winds aloft and NOTAMs. The planner is not a substitute for a standard briefing.">
      {f.routePts.length > 1 && <PlannerMap className="h-[24rem] rounded-xl print:hidden" route={f.routePts} alternate={f.altAirport} weather={f.weather} d={f.d} airspace={f.airspace} radar={f.radar} notams={f.notams} />}
      <WeatherBrief d={f.d} weather={f.weather} loading={f.wxQ.isLoading} refetch={() => f.wxQ.refetch()} fetching={f.wxQ.isFetching} />
      <Panel title="Standard briefing" lead="§91.103: all available information for a flight away from the airport. Get it from Flight Service, then keep the PDF beside the plan.">
        <div className="flex flex-wrap items-center gap-3">
          <a href="https://www.1800wxbrief.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline">1800wxbrief.com<ExternalLink className="size-3.5" /></a>
          <span className="text-sm text-fg-3">or 1-800-992-7433</span>
          <Button size="sm" variant="ghost" onClick={() => f.refs.show('briefing')}>Briefing PDF</Button>
          <label className="ml-auto flex items-center gap-2 text-sm text-fg-2">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={briefed} onChange={e => f.set({ checklist: { ...f.plan.checklist, 'brief.standard': e.target.checked } })} />
            I got a standard briefing for this flight
          </label>
        </div>
      </Panel>
    </Section>
  )
}

export function AirportsSection() {
  const f = useFlight()
  return (
    <Section k="airports" lead="Each airport at the time you're there: runways and the wind on them, pattern, frequencies and when to use them, NOTAMs, and your alternate. Your notes for an airport are kept in its profile.">
      <AirportsStep d={f.d} routePts={f.routePts} alternate={f.altAirport} noAlternate={f.plan.alternate === false} autoAlternate={f.autoAlt} setAlternate={v => f.set({ alternate: v })} minimums={f.minimums} notams={f.notamSets} cycle={f.cycle}
        nasr={f.nasr} profiles={f.aptProfiles.data ?? {}} savingProfile={f.aptProfiles.save.isPending}
        saveProfile={(id, p) => f.aptProfiles.save.mutate({ id, profile: p }, { onSuccess: () => toast.success(p ? `${id} profile saved` : `${id} profile deleted`), onError: e => toast.error(e.message) })} />
    </Section>
  )
}

export function RouteSection() {
  const f = useFlight()
  const common = { plan: f.plan, set: f.set, d: f.d, routePts: f.routePts, alternate: f.altAirport, weather: f.weather, airspace: f.airspace, radar: f.radar, notams: f.notams, checkpoints: f.corridor, landmarks: f.landmarks, landmarksLoading: f.landmarksLoading, edit: f.edit }
  return (
    <Section k="route" lead="Where and when: the route on the chart with checkpoints you can see, altitudes, winds aloft and fuel. Select a row for how it was worked out.">
      <Panel>
        <FlightInputs step={2} plan={f.plan} set={f.set} d={f.d} u={f.u} profile={f.d.profile} certs={f.certs ?? null} />
        <FlightInputs step={3} plan={f.plan} set={f.set} d={f.d} u={f.u} profile={f.d.profile} certs={f.certs ?? null} />
      </Panel>
      <RouteStep part="chart" {...common} />
      <RouteStep part="table" {...common} sources={f.inputs} focusKey={f.focus?.kind === 'nav' ? f.focus.key : null} onFocus={key => f.explain({ kind: 'nav', key })} />
    </Section>
  )
}

export function LoadingSection() {
  const f = useFlight()
  const [adding, setAdding] = useState(false)
  const d = f.d
  const tank = d.profile ? d.profile.fuel.find(x => x.key === (f.planning.tanks || 'standard')) ?? d.profile.fuel[0] : undefined
  const seatFree = (['rearL', 'rearR', 'front'] as const).find(s => !(f.plan.seats?.[s]) && !f.plan.seatPeople?.[s])
  return (
    <Section k="loading" lead="Who and what is on board, the weight and balance from ramp to landing against every limit, and the takeoff and landing distances at each runway.">
      <Panel>
        <FlightInputs step={4} plan={f.plan} set={f.set} d={d} u={f.u} profile={d.profile} certs={f.certs ?? null} />
        <div className="mt-3">
          {adding
            ? <PersonForm role="passenger" onCancel={() => setAdding(false)} onDone={p => { if (seatFree) f.set(seatPerson(f.plan, seatFree, p)); setAdding(false) }} />
            : <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus />New passenger profile</Button>}
        </div>
      </Panel>
      {d.wb.steps.length > 0 ? (
        <>
          <div className="grid gap-8 min-[1700px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div><SubHead right={<span className="text-[13px] text-fg-3">Select a point for its workings</span>}>Center of gravity envelope</SubHead><CgChart d={d} focus={f.focus?.kind === 'wb' ? f.focus.i : null} onFocus={i => f.explain({ kind: 'wb', i })} /></div>
            {d.profile && <div><SubHead right={<span className="text-[13px] text-fg-3">This flight against every limit</span>}>Limits</SubHead><WbLimits d={d} plan={f.plan} u={f.u} tank={tank} /></div>}
          </div>
          <div><SubHead right={<span className="text-[13px] text-fg-3">Select a line for its workings · POH Sec. 6</span>}>Weight and balance, line by line</SubHead><WbTable d={d} plan={f.plan} u={f.u} focus={f.focus?.kind === 'wb' ? f.focus.i : null} onFocus={i => f.explain({ kind: 'wb', i })} /></div>
        </>
      ) : <p className="text-sm text-fg-3">The weight and balance appears once the aircraft is chosen.</p>}
      <div><SubHead>Takeoff and landing</SubHead><PerformanceSection d={d} profile={d.profile} /></div>
    </Section>
  )
}

export function NavlogSection() {
  const f = useFlight()
  const role = f.role
  const list = f.planning.checklist ?? []
  return (
    <Section k="navlog" lead={<>The NavLog you fly with: one sheet per flight, then the weather log and flight plan, then {f.plan.tail ?? 'the airplane'}'s checklist when it has one. <span className="text-fg-2">Select any underlined figure</span> to see how it was worked out, where its inputs came from and what was assumed.</>}
      right={<Button variant="primary" onClick={() => window.print()} disabled={!f.d.flights.length}><Printer />Print</Button>}>
      {f.tasks.some(t => t.kind !== 'recommended') && <p className="-mt-4 text-[13px] text-fg-3">Some items are still open (<button className="text-accent hover:underline" onClick={() => f.go('overview')}>Overview</button>); the sheet prints either way, with what's known.</p>}
      <div className="space-y-10 rounded-xl bg-card px-3 py-4 ring-1 ring-inset ring-white/[0.04] sm:px-5 sm:py-5">
        {f.d.flights.length > 0 && <p className="text-sm text-fg-3 xl:hidden print:hidden">The sheet is the paper NavLog at full size; scroll it sideways. Print puts it on one landscape page.</p>}
        {f.d.flights.map(fl => (
          <div key={fl.n} className="break-after-page">
            <SubHead right={<span className="num text-xs text-fg-3">{fl.distNm.toFixed(1)} nm · {Math.round(fl.eteMin)} min · {fl.fuelGal.toFixed(2)} gal · arrive {fmtTime(fl.arriveAt)}</span>}>
              NavLog {f.d.flights.length > 1 ? `${fl.n + 1} of ${f.d.flights.length} · ` : ''}<span className="num">{fl.from.icao || fl.from.id} → {fl.to.icao || fl.to.id}</span>
            </SubHead>
            <NavlogFront plan={f.planEff} set={f.set} d={f.d} flight={fl} u={f.u} onExplain={(key, card) => f.explain({ kind: 'nav', key, card })}
              notes={flightNotes(f.d, fl, f.acName, f.notamSets, role === 'dual' ? f.plan.crew?.instructor?.trim() || 'instructor' : null)} />
          </div>
        ))}
        {!f.d.flights.length && <p className="text-sm text-fg-3">The NavLog fills in once the route resolves and the aircraft is chosen.</p>}
        {f.d.flights.length > 0 && (
          <div className="break-before-page">
            <SubHead>Reverse · weather log and flight plan</SubHead>
            <NavlogReverse plan={f.planEff} set={f.set} d={f.d} airports={f.airports} planning={f.planning} savePlanning={p => f.planningQ.save.mutate(p)} registry={f.registry.data} pilot={f.pilotQ.data} savePilot={p => f.pilotQ.save.mutate(p)} />
          </div>
        )}
        {f.plan.tail && list.length > 0 && <ChecklistPrint tail={f.plan.tail} secs={list} />}
      </div>
      <style>{'@media print { @page { size: letter landscape; margin: 0.25in } .navlog-front > div { zoom: 0.74 } }'}</style>
    </Section>
  )
}

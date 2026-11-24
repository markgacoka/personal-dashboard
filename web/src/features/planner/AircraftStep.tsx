import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Input, Select } from '@/components/ui/input'
import { titleCase } from '@/lib/format'
import type { AircraftRegistry } from '@/lib/types'
import type { PlannerDoc, PohMatch } from './api'
import { AircraftDocs, ProfileEditor } from './AircraftProfile'
import { AV1ATES, EQUIPMENT_DAY, EQUIPMENT_NIGHT, MX_DOCS } from './checklists'
import { Checklist } from './Checklist'
import { EmptyWeight, PohStatus } from './FlightInputs'
import type { AircraftPlanning, Derived, Plan } from './model'
import { PohSummary } from './PohSummary'
import type { ProfileMatch } from './poh'
import { PohLink } from './RefPanel'
import { KV, NumField, StatusIcon, SubHead, Synced } from './ui'
import { AirspeedTape, SpecSheet } from './AircraftSpecs'
import { RecordsList } from './RecordsList'
import { AIRCRAFT_RECORDS } from './records'
import { hasSpecs } from './specs'
import type { Units } from './units'

// Step 2: everything known about the airplane from its tail number — FAA
// registry, the matched POH and its limits, speeds and performance at this
// flight's altitudes, its W&B record — then the maintenance, documents and
// equipment checklists.
export function AircraftStep({ plan, set, d, registry, match, poh, pohDoc, pohUploaded, pohLoading, pohError, aircraft, planning, savePlanning, savingPlanning, u }: {
  plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; registry: AircraftRegistry | null | undefined; match: ProfileMatch | null
  poh: PohMatch | null | undefined; pohDoc: PlannerDoc | null | undefined; pohUploaded: boolean; pohLoading: boolean; pohError: string | null; aircraft: { make?: string | null; model?: string | null; year?: number | null }
  planning: AircraftPlanning; savePlanning: (p: AircraftPlanning) => void; savingPlanning: boolean; u: Units
}) {
  const p = d.profile
  if (!plan.tail) return <p className="text-sm text-fg-3">Enter the tail number under Plan.</p>
  const night = !!plan.night || d.wx.some(w => w.night)
  const raw = pohDoc?.specs
  const specs = hasSpecs(raw) ? raw : null
  const reg = registry?.registration
  return (
    <div className="space-y-8">
      <div className="@container"><div className="grid gap-6 @4xl:grid-cols-5">
        <div className="grid content-start gap-4 @2xl:grid-cols-2 @4xl:col-span-2 @4xl:grid-cols-1">
          {registry?.photo_url && <img src={registry.photo_url} alt={plan.tail} className="aspect-[16/9] w-full rounded-lg object-cover ring-1 ring-border" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} />}
          <div className="min-w-0 space-y-4">
          <KV items={[
            ['Aircraft', `${titleCase(aircraft.make ?? '')} ${aircraft.model ?? ''}${aircraft.year ? `, ${aircraft.year}` : ''}`],
            ['Engine', planning.profile?.engine ? p?.engine : reg?.engine_model ? `${titleCase(reg.engine_make ?? '')} ${reg.engine_model.replace(/^0-/, 'O-').toLowerCase().replace(/^o-/, 'O-')}${specs?.engine?.model ? ` (book: ${specs.engine.model}${specs.engine.hp ? `, ${specs.engine.hp} hp` : ''})` : ''}` : registry?.engine_type ? `${registry.engine_type}${registry.engine_hp ? `, ${registry.engine_hp} hp` : ''}` : p?.engine],
            ['Seats', registry?.seats], ['Serial', registry?.serial && <span className="num">{registry.serial}</span>], ['Mode S', registry?.mode_s_hex && <span className="num uppercase">{registry.mode_s_hex}</span>],
            ['Registered owner', registry?.owner ? `${titleCase(registry.owner)}${reg?.type ? ` (${reg.type.toLowerCase()})` : ''}${reg?.city ? `, ${titleCase(reg.city)}${reg.state ? `, ${titleCase(reg.state)}` : ''}` : ''}` : null],
            ['Registration', registry?.status || reg?.expires ? <RegistrationLine status={registry?.status} issued={reg?.issued} expires={reg?.expires} /> : null],
            ['Airworthiness', reg?.aw_class ? `${reg.aw_class}${reg.aw_category ? `, ${reg.aw_category.toLowerCase()} category` : ''}${reg.aw_date ? ` · issued ${fmtDay(reg.aw_date)}` : ''}` : null],
          ]} />
          {registry && <Synced label="" source="FAA aircraft registry" />}
          <PohStatus poh={poh} loading={pohLoading} error={pohError} model={aircraft.model} uploaded={pohUploaded ? pohDoc : null} read={match?.profile.read} />
          </div>
        </div>
        <div className="space-y-4 @4xl:col-span-3">
          {match?.note && <div className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-sm text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{match.note}</div>}
          {p && (
            <div>
              <SubHead right={<span className="flex flex-wrap gap-3 text-xs"><PohLink fig="limits">Limitations</PohLink><PohLink fig="speeds">Speeds</PohLink><PohLink fig="emergency">Emergency</PohLink></span>}>{p.model} · {p.engine}</SubHead>
              <p className="-mt-1 mb-3 text-[13px] text-fg-3">{p.source}</p>
              <AirspeedTape vs={p.vspeeds} arcs={specs?.arcs} />
              <div className="mt-3" />
              <Rows items={[
                ['Vso / Vs1', `${p.vspeeds.vso} / ${p.vspeeds.vs1} KIAS`],
                ['Vr', `${p.vspeeds.vr} KIAS`],
                ['Vx / Vy', `${p.vspeeds.vx} / ${p.vspeeds.vy} KIAS`],
                ['Va', p.vspeeds.va.map(([w, v]) => `${v} at ${w} lb`).join(' · ')],
                ['Vfe', `${p.vspeeds.vfe} KIAS`],
                ['Vno / Vne', `${p.vspeeds.vno} / ${p.vspeeds.vne} KIAS`],
                ['Best glide', `${p.vspeeds.glide} KIAS · ~${p.glideNmPer1000} nm per 1,000 ft`],
                ['Normal approach', `${p.vspeeds.approach} KIAS · short field ${p.vspeeds.shortApproach}`],
                ['Max demonstrated crosswind', `${p.crosswindDemo} kt`],
                ['Oil', specs?.oil ? null : p.oil],
              ]} />
            </div>
          )}
        </div>
      </div></div>

      {p && specs && <SpecSheet s={specs} book={pohDoc?.title ?? 'POH'} p={p} d={d} rpm={plan.rpm} planning={planning} savePlanning={savePlanning} tail={plan.tail} />}
      {p && !specs && <p className="rounded-lg px-3 py-2.5 text-sm text-fg-3 ring-1 ring-inset ring-border">{raw?.pending ? `${raw.pending}: the engine, oil, fuel, tire, electrical and speed sheet appears here when it's done.` : pohDoc ? `The engine, oil, fuel, tire, electrical and speed sheet couldn't be read from ${pohDoc.title}. Upload a clearer copy of this airplane's POH, or read Sections 1, 2, 7 and 8 in it.` : 'No POH found for this airplane yet: upload it and its engine, oil, fuel, tire, electrical and speed sheet is read from it.'}</p>}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ProfileEditor tail={plan.tail} planning={planning} save={savePlanning} saving={savingPlanning} registry={{ make: registry?.make, model: registry?.model, year: registry?.year }} />
        <div className="space-y-6">
          <AircraftDocs tail={plan.tail} model={aircraft.model ?? null} poh={pohDoc} pohUploaded={pohUploaded} />
          <RecordsList title={<>Aircraft records · <span className="num">{plan.tail}</span></>} records={AIRCRAFT_RECORDS} tail={plan.tail} />
        </div>
      </div>

      {p && <PohSummary d={d} profile={p} plan={plan} planning={planning} u={u} />}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <EmptyWeight tail={plan.tail} planning={planning} save={savePlanning} u={u} />
          {p && p.fuel.length > 1 && (
            <label className="block max-w-md"><span className="mb-1 block text-sm text-fg-2">Fuel tanks</span>
              <Select value={planning.tanks || 'standard'} onChange={e => savePlanning({ ...planning, tanks: e.target.value })}>{p.fuel.map(f => <option key={f.key} value={f.key}>{f.label} ({f.usable} gal usable)</option>)}</Select>
            </label>
          )}
        </div>
        <InspectionDates tail={plan.tail} planning={planning} save={savePlanning} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Checklist title="Maintenance, inspections and documents" right={<span className="text-xs text-fg-3">Aircraft logbooks / dispatch</span>} items={MX_DOCS} prefix="mx" plan={plan} set={set} yes="Checked" no="Problem" />
        <Checklist title={night ? 'Required equipment · day and night VFR' : 'Required equipment · day VFR'} right={<span className="text-xs text-fg-3">§91.205</span>} items={night ? [...EQUIPMENT_DAY, ...EQUIPMENT_NIGHT] : EQUIPMENT_DAY} prefix="eq" plan={plan} set={set} yes="Working" no="Inop" />
      </div>
    </div>
  )
}

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// Registration status with its expiry: overdue is a no-go (§91.203(a)(2)), the last 90 days a caution.
function RegistrationLine({ status, issued, expires }: { status?: string | null; issued?: string | null; expires?: string | null }) {
  const days = expires ? (new Date(`${expires}T23:59:59`).getTime() - Date.now()) / 86_400_000 : null
  const st = days == null ? null : days < 0 ? 'nogo' : days < 90 ? 'caution' : 'ok'
  return (
    <span className="flex items-start gap-1.5">
      {st && <StatusIcon status={st} className="mt-0.5" />}
      <span>{status ?? 'Unknown'}{issued ? ` · issued ${fmtDay(issued)}` : ''}{expires ? ` · ${days! < 0 ? 'expired' : 'expires'} ${fmtDay(expires)}` : ''}</span>
    </span>
  )
}

function Rows({ items }: { items: [string, string | number | null | undefined][] }) {
  return (
    <div className="grid gap-x-6 text-sm 2xl:grid-cols-2">
      {items.filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-border py-1.5"><span className="text-fg-3">{k}</span><span className="num text-right text-fg">{v}</span></div>)}
    </div>
  )
}

// Inspection dates from the aircraft logbooks, saved per tail; the review step
// flags anything due before the flight.
function InspectionDates({ tail, planning, save }: { tail: string; planning: AircraftPlanning; save: (p: AircraftPlanning) => void }) {
  const [insp, setInsp] = useState(planning.inspections || {})
  useEffect(() => setInsp(planning.inspections || {}), [planning.inspections])
  const commit = () => { if (JSON.stringify(insp) !== JSON.stringify(planning.inspections || {})) save({ ...planning, inspections: insp }) }
  const due = (k: string, months: number) => {
    const v = insp[k]; if (!v) return null
    const d = new Date(String(v)); d.setMonth(d.getMonth() + months + 1, 0)
    return d
  }
  return (
    <div onBlur={commit}>
      <SubHead right={<Synced at={planning.updatedAt} label="Saved" source={`${tail}'s logbook dates, kept for every plan`} />}>Inspection dates (optional)</SubHead>
      <div className="grid grid-cols-2 gap-3">
        {AV1ATES.filter(i => i.months && !i.ifrOnly).map(i => {
          const dd = due(i.key, i.months!)
          return (
            <label key={i.key} className="block text-sm">
              <span className="mb-1 block text-fg-2">{i.label}</span>
              <Input type="date" className="num" value={String(insp[i.key] ?? '')} onChange={e => setInsp(x => ({ ...x, [i.key]: e.target.value }))} />
              <span className="mt-0.5 block text-xs text-fg-3">{dd ? `Due by ${dd.toLocaleDateString()}` : `Every ${i.months} calendar months`}</span>
            </label>
          )
        })}
        <NumField label="Hours to the next 100-hour" value={insp.hundredHoursLeft === undefined || insp.hundredHoursLeft === '' ? '' : Number(insp.hundredHoursLeft)} onChange={v => setInsp(x => ({ ...x, hundredHoursLeft: v }))} unit="h" step={0.1} />
      </div>
    </div>
  )
}

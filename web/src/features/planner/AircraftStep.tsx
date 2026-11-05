import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Input, Select } from '@/components/ui/input'
import { titleCase } from '@/lib/format'
import type { AircraftRegistry } from '@/lib/types'
import type { PohMatch } from './api'
import { AV1ATES, EQUIPMENT_DAY, EQUIPMENT_NIGHT, MX_DOCS } from './checklists'
import { Checklist } from './Checklist'
import { EmptyWeight, PohStatus } from './FlightInputs'
import type { AircraftPlanning, Derived, Plan } from './model'
import { PohSummary } from './PohSummary'
import type { ProfileMatch } from './poh'
import { PohLink } from './RefPanel'
import { KV, NumField, SubHead, Synced } from './ui'
import type { Units } from './units'

// Step 2: everything known about the airplane from its tail number — FAA
// registry, the matched POH and its limits, speeds and performance at this
// flight's altitudes, its W&B record — then the maintenance, documents and
// equipment checklists.
export function AircraftStep({ plan, set, d, registry, match, poh, pohLoading, pohError, aircraft, planning, savePlanning, u }: {
  plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; registry: AircraftRegistry | null | undefined; match: ProfileMatch | null
  poh: PohMatch | null | undefined; pohLoading: boolean; pohError: string | null; aircraft: { make?: string | null; model?: string | null; year?: number | null }
  planning: AircraftPlanning; savePlanning: (p: AircraftPlanning) => void; u: Units
}) {
  const p = d.profile
  if (!plan.tail) return <p className="text-sm text-fg-3">Enter the tail number in step 1.</p>
  const night = !!plan.night || d.wx.some(w => w.night)
  return (
    <div className="space-y-8">
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-2">
          {registry?.photo_url && <img src={registry.photo_url} alt={plan.tail} className="aspect-[16/9] w-full rounded-lg object-cover ring-1 ring-border" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} />}
          <KV items={[
            ['Aircraft', `${titleCase(aircraft.make ?? '')} ${aircraft.model ?? ''}${aircraft.year ? `, ${aircraft.year}` : ''}`],
            ['Engine', registry?.engine_type ? `${registry.engine_type}${registry.engine_hp ? `, ${registry.engine_hp} hp` : ''}` : p?.engine],
            ['Seats', registry?.seats], ['Serial', registry?.serial], ['Mode S', registry?.mode_s_hex && <span className="num uppercase">{registry.mode_s_hex}</span>],
            ['Registered owner', registry?.owner ? titleCase(registry.owner) : null], ['Registration status', registry?.status],
          ]} />
          {registry && <Synced label="" source="FAA aircraft registry" />}
          <PohStatus poh={poh} loading={pohLoading} error={pohError} model={aircraft.model} />
        </div>
        <div className="space-y-4 xl:col-span-3">
          {match?.note && <div className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-sm text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{match.note}</div>}
          {p && (
            <div>
              <SubHead right={<span className="flex flex-wrap gap-3 text-xs"><PohLink fig="limits">Limitations</PohLink><PohLink fig="speeds">Speeds</PohLink><PohLink fig="emergency">Emergency</PohLink></span>}>{p.model} · {p.engine}</SubHead>
              <p className="-mt-1 mb-2 text-xs text-fg-3">{p.source}</p>
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
                ['Oil', p.oil],
                ['Load factors', '+3.8 / −1.52 g flaps up · +3.0 g flaps down'],
                ['Icing', 'Flight into known icing prohibited'],
              ]} />
            </div>
          )}
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

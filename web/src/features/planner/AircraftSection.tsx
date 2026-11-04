import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import type { AircraftRef, AircraftRegistry } from '@/lib/types'
import { ATOMATOFLAMES, AV1ATES, FLAPS, POH_CHECKLISTS } from './checklists'
import type { AircraftPlanning, Plan } from './model'
import type { ProfileMatch } from './poh'
import { KV, NumField, StatusIcon, SubHead, Synced } from './ui'

export function AircraftSection({ plan, set, fleet, registry, match, planning, savePlanning, saving, night }: {
  plan: Plan; set: (p: Partial<Plan>) => void; fleet: AircraftRef[]; registry: AircraftRegistry | null | undefined; match: ProfileMatch | null
  planning: AircraftPlanning; savePlanning: (p: AircraftPlanning) => void; saving: boolean; night: boolean
}) {
  const p = match?.profile
  return (
    <>
      <div className="grid gap-5 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-2">
          <label className="block">
            <span className="mb-1 block text-sm text-fg-2">Tail number</span>
            <Select value={plan.tail ?? ''} onChange={e => set({ tail: e.target.value || null })} className="num">
              <option value="">Choose…</option>
              {fleet.map(a => <option key={a.id} value={a.tail_number}>{a.tail_number} · {a.make} {a.model}{a.year ? ` (${a.year})` : ''}</option>)}
            </Select>
          </label>
          {registry?.photo_url && <img src={registry.photo_url} alt={plan.tail ?? ''} className="aspect-[16/9] w-full rounded-lg object-cover ring-1 ring-border" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} />}
          {registry && (
            <KV items={[
              ['Registered', `${registry.make ?? ''} ${registry.model ?? ''}${registry.year ? `, ${registry.year}` : ''}`],
              ['Engine', registry.engine_type ? `${registry.engine_type}${registry.engine_hp ? `, ${registry.engine_hp} hp` : ''}` : null],
              ['Seats', registry.seats], ['Serial', registry.serial], ['Mode S', registry.mode_s_hex && <span className="num uppercase">{registry.mode_s_hex}</span>],
              ['Owner', registry.owner], ['Status', registry.status],
            ]} />
          )}
          {registry && <Synced label="" source="FAA aircraft registry" />}
        </div>
        <div className="space-y-4 xl:col-span-3">
          {match?.note && (
            <div className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-sm text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{match.note}</div>
          )}
          {p && (
            <>
              <div>
                <SubHead right={<span className="text-xs text-fg-3">{p.source}</span>}>{p.model} · {p.engine}</SubHead>
                <Rows items={[
                  ['Vso / Vs1', `${p.vspeeds.vso} / ${p.vspeeds.vs1} KIAS`],
                  ['Vr (lift-off, short field)', `${p.vspeeds.vr} KIAS`],
                  ['Vx / Vy (sea level)', `${p.vspeeds.vx} / ${p.vspeeds.vy} KIAS`],
                  ['Va', p.vspeeds.va.map(([w, v]) => `${v} at ${w} lb`).join(' · ')],
                  ['Vfe', `${p.vspeeds.vfe} KIAS`],
                  ['Vno / Vne', `${p.vspeeds.vno} / ${p.vspeeds.vne} KIAS`],
                  ['Best glide', `${p.vspeeds.glide} KIAS · ~${p.glideNmPer1000} nm per 1,000 ft`],
                  ['Max demonstrated crosswind', `${p.crosswindDemo} kt`],
                  ['Max ramp / takeoff / landing', `${p.limits.maxRamp} / ${p.limits.maxTakeoff} / ${p.limits.maxLanding} lb`],
                  ['Utility category', `${p.limits.utilityMax} lb · no rear seat or baggage`],
                  ['Baggage', 'Area 1 120 lb · area 2 50 lb · 120 lb combined'],
                  ...p.fuel.map(f => [f.label, `${f.usable} gal usable / ${f.total} total`] as [string, string]),
                  ['Oil', p.oil], ['Fuel grade', '100LL (blue) or 100 (green)'],
                  ['Load factors', '+3.8 / −1.52 g flaps up · +3.0 g flaps down'],
                  ['Icing', 'Flight into known icing prohibited'],
                ]} />
              </div>
              <div>
                <SubHead>Speeds for normal operation</SubHead>
                <Rows items={p.speeds.map(s => [s.label, `${s.kias} KIAS`] as [string, string])} />
              </div>
            </>
          )}
        </div>
      </div>

      {plan.tail && <PlanningEditor tail={plan.tail} planning={planning} onSave={savePlanning} saving={saving} profile={p ?? null} />}

      <div className="grid gap-6 xl:grid-cols-2">
        <EquipmentList plan={plan} set={set} night={night} />
        <PohChecklists plan={plan} set={set} />
      </div>
    </>
  )
}

function Rows({ items }: { items: [string, string | number | null | undefined][] }) {
  return (
    <div className="grid gap-x-6 text-sm 2xl:grid-cols-2">
      {items.filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-border py-1.5"><span className="text-fg-3">{k}</span><span className="num text-right text-fg">{v}</span></div>)}
    </div>
  )
}

function PlanningEditor({ tail, planning, onSave, saving, profile }: { tail: string; planning: AircraftPlanning; onSave: (p: AircraftPlanning) => void; saving: boolean; profile: import('./poh').AircraftProfile | null }) {
  const [p, setP] = useState(planning)
  useEffect(() => setP(planning), [planning])
  const dirty = JSON.stringify(p) !== JSON.stringify(planning)
  const insp = p.inspections || {}
  const setInsp = (k: string, v: string | number) => setP(x => ({ ...x, inspections: { ...x.inspections, [k]: v } }))
  const eq = p.equipment || {}
  const setEq = (k: string, v: unknown) => setP(x => ({ ...x, equipment: { ...x.equipment, [k]: v } }))
  return (
    <div>
      <SubHead right={<Synced at={planning.updatedAt} label="Saved" source={`${tail}'s records — saved for every plan with this airplane`} />}>Airworthiness and equipment ({tail})</SubHead>
      <div className="grid gap-4 rounded-lg p-4 ring-1 ring-inset ring-border xl:grid-cols-3">
        <div className="space-y-3">
          <div className="text-sm font-medium text-fg-2">Weight and balance record</div>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Basic empty weight" value={p.emptyWeight ?? ''} onChange={v => setP(x => ({ ...x, emptyWeight: v || undefined }))} unit="lb" />
            <NumField label="Moment / 1000" value={p.emptyMoment ?? ''} onChange={v => setP(x => ({ ...x, emptyMoment: v || undefined }))} unit="lb-in" step={0.1} />
          </div>
          {p.emptyWeight && p.emptyMoment ? <div className="text-xs text-fg-3">Empty CG {((p.emptyMoment * 1000) / p.emptyWeight).toFixed(2)} in aft of datum</div> : <div className="text-xs text-warn">Using the POH sample airplane (1,467 lb, 57.3) until you enter this airplane's numbers.</div>}
          {profile && (
            <label className="block"><span className="mb-1 block text-sm text-fg-2">Fuel tanks</span>
              <Select value={p.tanks || 'standard'} onChange={e => setP(x => ({ ...x, tanks: e.target.value }))}>{profile.fuel.map(f => <option key={f.key} value={f.key}>{f.label} ({f.usable} gal usable)</option>)}</Select>
            </label>
          )}
        </div>
        <div className="space-y-3">
          <div className="text-sm font-medium text-fg-2">Inspections (AV1ATES)</div>
          {AV1ATES.filter(i => i.months).map(i => (
            <label key={i.key} className="block text-sm">
              <span className="text-fg-2">{i.label}{i.ifrOnly && <span className="text-fg-3"> · IFR only</span>}</span>
              <Input type="date" className="num mt-1" value={String(insp[i.key] ?? '')} onChange={e => setInsp(i.key, e.target.value)} />
              <span className="mt-0.5 block text-xs text-fg-3">{i.detail}</span>
            </label>
          ))}
          <NumField label="Hours to the next 100-hour" value={insp.hundredHoursLeft === undefined || insp.hundredHoursLeft === '' ? '' : Number(insp.hundredHoursLeft)} onChange={v => setInsp('hundredHoursLeft', v)} unit="h" step={0.1} />
          <label className="flex items-center justify-between gap-3 text-sm text-fg-2">Recurring ADs complied with<Switch checked={!!insp.ad} onCheckedChange={v => setInsp('ad', v ? 'yes' : '')} /></label>
        </div>
        <div className="space-y-3">
          <div className="text-sm font-medium text-fg-2">Equipment on board</div>
          <label className="block"><span className="mb-1 block text-sm text-fg-2">Transponder</span>
            <Select value={eq.transponder || ''} onChange={e => setEq('transponder', e.target.value)}><option value="">Unknown</option><option>Mode C</option><option>Mode S</option></Select></label>
          <label className="flex items-center justify-between gap-3 text-sm text-fg-2">ADS-B Out (§91.225)<Switch checked={eq.adsbOut ?? false} onCheckedChange={v => setEq('adsbOut', v)} /></label>
          <label className="block"><span className="mb-1 block text-sm text-fg-2">GPS</span>
            <Select value={eq.gps || ''} onChange={e => setEq('gps', e.target.value)}><option value="">None / handheld</option><option>VFR panel GPS</option><option>IFR GPS (TSO-C129)</option><option>IFR WAAS GPS (TSO-C146)</option></Select></label>
          <label className="flex items-center justify-between gap-3 text-sm text-fg-2">Autopilot<Switch checked={eq.autopilot ?? false} onCheckedChange={v => setEq('autopilot', v)} /></label>
          <label className="block"><span className="mb-1 block text-sm text-fg-2">Flight plan equipment (item 10)</span><Input value={eq.equipCode || ''} placeholder="e.g. SDG/C or SG/B1" onChange={e => setEq('equipCode', e.target.value)} className="num" /></label>
        </div>
        <div className="flex gap-2 xl:col-span-3">
          <Button size="sm" variant="primary" disabled={!dirty} loading={saving} onClick={() => onSave(p)}>Save {tail} records</Button>
          {dirty && <Button size="sm" variant="ghost" onClick={() => setP(planning)}>Discard</Button>}
        </div>
      </div>
    </div>
  )
}

function EquipmentList({ plan, set, night }: { plan: Plan; set: (p: Partial<Plan>) => void; night: boolean }) {
  const list = useMemo(() => [...ATOMATOFLAMES.map(i => ({ ...i, group: 'Day VFR — ATOMATOFLAMES (§91.205(b))' })), ...(night ? FLAPS.map(i => ({ ...i, key: `n-${i.key}`, group: 'Night VFR — FLAPS (§91.205(c))' })) : [])], [night])
  const groups = [...new Set(list.map(i => i.group))]
  const allOn = list.every(i => plan.equipment[i.key])
  return (
    <div>
      <SubHead right={<Button size="sm" variant="ghost" onClick={() => set({ equipment: Object.fromEntries(list.map(i => [i.key, !allOn])) })}>{allOn ? 'Clear' : 'Mark all present'}</Button>}>Required equipment working</SubHead>
      {groups.map(g => (
        <div key={g} className="mb-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-3">{g}</div>
          <ul className="grid gap-x-4 sm:grid-cols-2">
            {list.filter(i => i.group === g).map(i => (
              <li key={i.key}><label className="flex cursor-pointer items-start gap-2 py-1 text-sm">
                <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={!!plan.equipment[i.key]} onChange={e => set({ equipment: { ...plan.equipment, [i.key]: e.target.checked } })} />
                <span><span className="text-fg">{i.label}</span>{i.detail && <span className="block text-xs text-fg-3">{i.detail}</span>}</span>
              </label></li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-fg-3">Inoperative equipment: §91.213(d) — placard and deactivate it, or don't fly. Night: FLAPS shown when any ETA is after civil twilight.</p>
    </div>
  )
}

function PohChecklists({ plan, set }: { plan: Plan; set: (p: Partial<Plan>) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const phases = ['preflight', 'ground', 'departure', 'enroute', 'arrival'] as const
  const label = { preflight: 'Preflight inspection', ground: 'On the ground', departure: 'Departure', enroute: 'En route', arrival: 'Arrival' }
  return (
    <div>
      <SubHead right={<span className="text-xs text-fg-3">172P POH Section 4</span>}>Checklists by phase</SubHead>
      <div className="space-y-3">
        {phases.map(ph => (
          <div key={ph}>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-3">{label[ph]}</div>
            <div className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
              {POH_CHECKLISTS.filter(c => c.when === ph).map(c => {
                const done = !!plan.phases[c.key]
                return (
                  <div key={c.key}>
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button onClick={() => set({ phases: { ...plan.phases, [c.key]: !done } })} aria-label={done ? 'Mark not done' : 'Mark done'}><StatusIcon status={done ? 'ok' : 'todo'} /></button>
                      <button className="flex min-w-0 flex-1 items-center justify-between text-left text-sm text-fg" onClick={() => setOpen(o => (o === c.key ? null : c.key))}>
                        {c.label}<span className="flex items-center gap-2 text-xs text-fg-3">{c.items.length} items<ChevronDown className={cn('size-4 transition-transform', open === c.key && 'rotate-180')} /></span>
                      </button>
                    </div>
                    {open === c.key && (
                      <ol className="space-y-0.5 px-10 pb-3 text-sm">
                        {c.items.map(([k, v], i) => <li key={i} className="flex gap-2"><span className="num w-5 shrink-0 text-fg-3">{i + 1}.</span><span className="text-fg-2">{k}</span><span className="ml-auto text-right text-fg">{v}</span></li>)}
                      </ol>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <Badge className="mt-2" tone="outline">Use the checklist in the airplane; this is the briefing copy</Badge>
    </div>
  )
}

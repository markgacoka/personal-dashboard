import { useEffect, useRef, useState } from 'react'
import { BookOpen, ClipboardList, Pencil, RotateCcw, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { titleCase } from '@/lib/format'
import { useDocuments, type PlannerDoc } from './api'
import { OptNum } from './FlightInputs'
import type { AircraftPlanning } from './model'
import { editCount, profileFor, type ProfileEdits } from './poh'
import { aircraftClass } from './pilot'
import { useRefs } from './RefPanel'
import { stepCount } from './checklistParse'
import { SubHead, Synced } from './ui'

type Ident = { make?: string | null; model?: string | null; year?: number | null }

// The tail's own numbers over the POH / TCDS / registry ones: identity, weights,
// fuel, arms, V-speeds, crosswind and cruise. Saved per tail, used by every plan.
export function ProfileEditor({ tail, planning, save, registry, saving }: {
  tail: string; planning: AircraftPlanning; save: (p: AircraftPlanning) => void; registry: Ident; saving?: boolean
}) {
  const saved = planning.profile ?? {}
  const [open, setOpen] = useState(false)
  const [e, setE] = useState<ProfileEdits>(saved)
  useEffect(() => { if (!open) setE(planning.profile ?? {}) }, [planning.profile, open])
  // Placeholders: what the planner would use without your values.
  const base = profileFor(e.model || registry.model).profile
  const n = editCount(saved)
  const num = (k: keyof ProfileEdits) => (e[k] as number | null | undefined) ?? null
  const setN = (k: keyof ProfileEdits) => (v: number | null) => setE(x => ({ ...x, [k]: v }))
  const arm = (k: 'front' | 'rear' | 'bag1' | 'bag2') => base.stations.find(s => s.key === k)?.arm ?? 0
  const F = ({ k, label, ph, unit, step }: { k: keyof ProfileEdits; label: string; ph: number | string; unit?: string; step?: number }) => (
    <label key={k} className="block min-w-0"><span className="mb-1 block text-sm text-fg-2">{label}</span><OptNum value={num(k)} placeholder={ph} unit={unit} step={step} onChange={setN(k)} label={label} /></label>
  )
  const T = ({ k, label, ph }: { k: 'make' | 'model' | 'engine' | 'oil' | 'vfe' | 'approach'; label: string; ph: string }) => (
    <label key={k} className="block min-w-0"><span className="mb-1 block text-sm text-fg-2">{label}</span><Input value={e[k] ?? ''} placeholder={ph} onChange={ev => setE(x => ({ ...x, [k]: k === 'model' ? ev.target.value.toUpperCase() : ev.target.value }))} /></label>
  )
  const commit = () => { save({ ...planning, profile: e }); setOpen(false) }
  const reset = () => { save({ ...planning, profile: undefined }); setE({}); setOpen(false) }

  return (
    <div>
      <SubHead right={planning.updatedAt && n > 0 ? <Synced at={planning.updatedAt} label="Saved" source={`${tail}'s profile`} /> : null}>Aircraft profile · <span className="num">{tail}</span></SubHead>
      {!open && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ring-border">
          <span className="min-w-0 flex-1 text-fg-2">{n ? `${n === 1 ? 'One of your values replaces' : `${n} of your values replace`} the POH, TCDS and registry ones for ${tail}, in every plan.` : `Using the POH, TCDS and FAA registry values. Edit to put in ${tail}'s own numbers; they're kept for every plan.`}</span>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Pencil />Edit profile</Button>
          {n > 0 && <Button size="sm" variant="ghost" onClick={reset}><RotateCcw />Reset</Button>}
        </div>
      )}
      {open && (
        <div className="space-y-5 rounded-lg px-3 py-3 ring-1 ring-inset ring-border">
          <p className="text-sm text-fg-3">Blank fields keep the value shown in grey. Weights in lb, arms in inches, fuel in gallons, speeds in KIAS.</p>
          <Group title="Aircraft">
            {T({ k: 'make', label: 'Make', ph: titleCase(registry.make ?? 'Cessna') })}
            {T({ k: 'model', label: 'Model', ph: registry.model ?? '172P' })}
            {F({ k: 'year', label: 'Year', ph: registry.year ?? 1982 })}
            {T({ k: 'engine', label: 'Engine', ph: base.engine })}
            {F({ k: 'hp', label: 'Horsepower', ph: aircraftClass(base).hp ?? '' })}
            <div className="col-span-full flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg-2">
              {(['complex', 'tailwheel'] as const).map(k => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={!!e[k]} onChange={ev => setE(x => ({ ...x, [k]: ev.target.checked }))} />
                  {k === 'complex' ? 'Complex: retractable gear, flaps and a constant-speed prop' : 'Tailwheel'}</label>
              ))}
            </div>
          </Group>
          <p className="-mt-3 text-xs text-fg-3">Horsepower over 200, complex and tailwheel each need an endorsement to act as PIC (§61.31); the Pilot step checks them.</p>
          <Group title="Weights and fuel">
            {F({ k: 'maxRamp', label: 'Max ramp', ph: base.limits.maxRamp, unit: 'lb' })}
            {F({ k: 'maxTakeoff', label: 'Max takeoff', ph: base.limits.maxTakeoff, unit: 'lb' })}
            {F({ k: 'maxLanding', label: 'Max landing', ph: base.limits.maxLanding, unit: 'lb' })}
            {F({ k: 'utilityMax', label: 'Utility category max', ph: base.limits.utilityMax, unit: 'lb' })}
            {F({ k: 'fuelUsable', label: 'Usable fuel', ph: base.fuel[0].usable, unit: 'gal' })}
            {F({ k: 'fuelTotal', label: 'Total fuel', ph: base.fuel[0].total, unit: 'gal' })}
            {F({ k: 'cruiseKtas', label: 'Cruise TAS', ph: 'POH table', unit: 'kt' })}
            {F({ k: 'cruiseGph', label: 'Cruise fuel burn', ph: 'POH table', unit: 'gph', step: 0.1 })}
          </Group>
          <p className="-mt-3 text-xs text-fg-3">Cruise TAS and burn replace the POH cruise table at every altitude and RPM; leave them blank to use the table.</p>
          <Group title="Arms">
            {(['front', 'rear', 'bag1', 'bag2'] as const).map(k => (
              <label key={k} className="block min-w-0"><span className="mb-1 block text-sm text-fg-2">{base.stations.find(s => s.key === k)?.label ?? k}</span>
                <OptNum value={e.arms?.[k] ?? null} placeholder={arm(k)} unit="in" step={0.1} onChange={v => setE(x => ({ ...x, arms: { ...x.arms, [k]: v } }))} label={`${k} arm`} /></label>
            ))}
            {F({ k: 'fuelArm', label: 'Fuel', ph: base.fuelArm, unit: 'in', step: 0.1 })}
          </Group>
          <Group title="Speeds">
            {F({ k: 'vso', label: 'Vso', ph: base.vspeeds.vso })}{F({ k: 'vs1', label: 'Vs1', ph: base.vspeeds.vs1 })}
            {F({ k: 'vr', label: 'Vr', ph: base.vspeeds.vr })}{F({ k: 'vx', label: 'Vx', ph: base.vspeeds.vx })}{F({ k: 'vy', label: 'Vy', ph: base.vspeeds.vy })}
            {F({ k: 'va', label: 'Va (max weight)', ph: base.vspeeds.va[0]?.[1] ?? 0 })}{T({ k: 'vfe', label: 'Vfe', ph: base.vspeeds.vfe })}
            {F({ k: 'vno', label: 'Vno', ph: base.vspeeds.vno })}{F({ k: 'vne', label: 'Vne', ph: base.vspeeds.vne })}
            {F({ k: 'glide', label: 'Best glide', ph: base.vspeeds.glide })}{F({ k: 'glideNmPer1000', label: 'Glide nm per 1,000 ft', ph: base.glideNmPer1000, step: 0.1 })}
            {T({ k: 'approach', label: 'Normal approach', ph: base.vspeeds.approach })}{F({ k: 'shortApproach', label: 'Short-field approach', ph: base.vspeeds.shortApproach })}
            {F({ k: 'crosswindDemo', label: 'Max demonstrated crosswind', ph: base.crosswindDemo, unit: 'kt' })}
          </Group>
          <Group title="Other">{T({ k: 'oil', label: 'Oil', ph: base.oil })}</Group>
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button variant="primary" onClick={commit} loading={saving}>Save {tail} profile</Button>
            <Button variant="ghost" onClick={() => { setE(planning.profile ?? {}); setOpen(false) }}>Cancel</Button>
            {n > 0 && <Button variant="ghost" className="ml-auto" onClick={reset}><RotateCcw />Reset to POH values</Button>}
          </div>
        </div>
      )}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-fg">{title}</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">{children}</div>
    </fieldset>
  )
}

// The POH and checklist PDFs for this tail. Uploading one makes it the one used
// (newest wins over the catalog POH and over older uploads).
export function AircraftDocs({ tail, model, poh, pohUploaded }: { tail: string; model: string | null; poh: PlannerDoc | null | undefined; pohUploaded: boolean }) {
  const docs = useDocuments()
  const refs = useRefs()
  const checklist = (docs.data ?? []).filter(d => d.kind === 'checklist' && (d.tail_number === tail || (!d.tail_number && model && d.model === model.toUpperCase())))
    .sort((a, b) => Number(b.tail_number === tail) - Number(a.tail_number === tail) || b.created_at.localeCompare(a.created_at))[0]
  const row = (kind: 'poh' | 'checklist', doc: PlannerDoc | null | undefined, note: string) => (
    <DocRow key={kind} kind={kind} doc={doc} note={note} uploading={docs.upload.isPending && docs.upload.variables?.kind === kind}
      onOpen={() => refs?.show(kind)} onUpload={f => docs.upload.mutate({ file: f, kind, tail, model: model ?? undefined, title: `${tail} ${kind === 'poh' ? 'POH' : 'checklist'} (${f.name.replace(/\.(pdf|png|jpe?g)$/i, '')})` },
        { onSuccess: d => {
          toast.success(`${kind === 'poh' ? 'POH' : 'Checklist'} uploaded; it's now the one used for ${tail}`)
          if (kind === 'checklist') docs.extract.mutate(d.id, { onSuccess: r => toast.success(`${stepCount(r.doc.steps)} checklist steps read${r.method === 'ocr' ? ' by OCR: check them in the Checklist tab' : ''}`), onError: e => toast.error(`Couldn't read the steps: ${e.message}`) })
        }, onError: e => toast.error(e.message) })} />
  )
  return (
    <div>
      <SubHead>Documents · <span className="num">{tail}</span></SubHead>
      <div className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
        {row('poh', poh, poh ? (pohUploaded ? 'Your upload, used for this tail' : 'Public copy for the model; upload this airplane\'s own to replace it') : 'None found; upload this airplane\'s POH')}
        {row('checklist', checklist, checklist ? `Uploaded ${new Date(checklist.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${docs.extract.isPending ? 'reading steps…' : checklist.steps ? `${stepCount(checklist.steps)} steps in ${checklist.steps.length} sections` : 'steps not read yet: Open → Extract steps'}` : 'Upload the checklist you fly with (PDF or photo); its steps are read out automatically')}
      </div>
      <p className="mt-1.5 text-xs text-fg-3">The newest upload is the one used. Uploads open beside the plan; performance numbers still come from the transcribed POH tables and your aircraft profile.</p>
    </div>
  )
}

function DocRow({ kind, doc, note, onOpen, onUpload, uploading }: { kind: 'poh' | 'checklist'; doc: PlannerDoc | null | undefined; note: string; onOpen: () => void; onUpload: (f: File) => void; uploading: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const Icon = kind === 'poh' ? BookOpen : ClipboardList
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-fg-3" />
      <div className="min-w-0 flex-1 basis-48">
        <div className="truncate text-sm text-fg">{kind === 'poh' ? 'POH' : 'Checklist'}{doc ? ` · ${doc.title}` : ''}</div>
        <div className="text-xs text-fg-3">{note}</div>
      </div>
      <input ref={ref} type="file" accept={kind === 'checklist' ? 'application/pdf,image/png,image/jpeg' : 'application/pdf'} hidden onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }} />
      {doc && <Button size="sm" variant="ghost" onClick={onOpen}>Open</Button>}
      <Button size="sm" variant="secondary" loading={uploading} onClick={() => ref.current?.click()}><Upload />{doc ? 'Replace' : 'Upload'}</Button>
    </div>
  )
}

import { useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/misc'
import { useRegistry } from '@/lib/queries'
import { titleCase } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDocuments, usePohFind, type PlannerDoc, type PohMatch } from './api'
import { ChecklistEditor } from './AircraftChecklist'
import { InspectionDates } from './AircraftStep'
import { EmptyWeight, OptNum } from './FlightInputs'
import type { AircraftPlanning } from './model'
import { CERTIFICATES, type Certificate } from './pilot'
import { SECTION_LABEL, profileFor, withSpecs, withTables } from './poh'
import { newId, useAircraftProfiles, useCrew, type Person, type PersonRole } from './profiles'
import { hasSpecs, type PohSpecs } from './specs'
import { unitsForTail } from './units'

// The forms that create profiles at the step that needs them: you (once), an
// instructor or passenger (when seating them), an aircraft (when choosing it).
// The Profiles page edits the same records afterwards.

const Label = ({ children, className }: { children: React.ReactNode; className?: string }) => <span className={cn('mb-1 block text-sm text-fg-2', className)}>{children}</span>
const Hint = ({ children }: { children: React.ReactNode }) => <p className="mt-1 text-[13px] text-fg-3">{children}</p>

/* ── Instructors and passengers ── */
// A pilot, instructor or passenger, created where they're first needed. A
// pilot's medical and endorsements are completed under Pilot, where they're checked.
export function PersonForm({ role, initial, onDone, onCancel }: { role: PersonRole; initial?: Partial<Person>; onDone: (p: Person) => void; onCancel: () => void }) {
  const crew = useCrew()
  const [p, setP] = useState<Person>({ id: initial?.id ?? newId(), name: initial?.name ?? '', role, weightLb: initial?.weightLb ?? null, cfi: initial?.cfi, phone: initial?.phone, certs: initial?.certs ?? (role === 'pilot' ? { certificate: 'student' } : undefined) })
  const ok = p.name.trim() && (p.weightLb == null || (p.weightLb > 20 && p.weightLb < 400))
  return (
    <div className="space-y-3 rounded-lg p-3 ring-1 ring-inset ring-border">
      <div className="text-sm font-medium text-fg">{initial?.id ? 'Edit' : 'New'} {role}</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><Label>Name</Label><Input value={p.name} onChange={e => setP({ ...p, name: e.target.value.slice(0, 60) })} autoFocus placeholder="Full name" /></label>
        <label className="block"><Label>Weight</Label><OptNum value={p.weightLb} placeholder="lb, dressed" unit="lb" onChange={v => setP({ ...p, weightLb: v })} label="Weight" /></label>
        {role === 'pilot' && <label className="block"><Label>Certificate</Label><Select value={p.certs?.certificate ?? 'student'} onChange={e => setP({ ...p, certs: { ...p.certs, certificate: e.target.value as Certificate } })}>{CERTIFICATES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</Select></label>}
        {role === 'instructor' && <label className="block"><Label>CFI certificate number</Label><Input value={p.cfi ?? ''} onChange={e => setP({ ...p, cfi: e.target.value.slice(0, 20) })} placeholder="Optional" className="num" /></label>}
      </div>
      {p.weightLb != null && !(p.weightLb > 20 && p.weightLb < 400) && <p className="text-[13px] text-bad">Enter a weight between 20 and 400 lb.</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={!ok} loading={crew.saving} onClick={async () => { const x = { ...p, name: p.name.trim() }; await crew.save(x); toast.success(`${x.name} saved`); onDone(x) }}>Save {role}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

/* ── What was read from the POH ── */
const SPEC_GROUPS: [keyof PohSpecs, string][] = [['engine', 'engine'], ['propeller', 'propeller'], ['oil', 'oil'], ['fuel', 'fuel system'], ['gear', 'gear and tires'], ['brakes', 'brakes'], ['electrical', 'electrical'], ['arcs', 'airspeed markings'], ['limits', 'speed limits'], ['speeds', 'normal speeds'], ['stall', 'stall speeds'], ['loadFactors', 'load factors']]

export function PohReport({ match, doc, uploaded, loading, model }: { match: PohMatch | null | undefined; doc: PlannerDoc | null | undefined; uploaded?: boolean; loading?: boolean; model: string | null | undefined }) {
  const base = useMemo(() => profileFor(model), [model])
  const read = useMemo(() => withTables(base, doc?.tables, doc?.title).profile.read, [base, doc])
  if (loading) return <p className="flex items-center gap-2 text-sm text-fg-3"><Loader2 className="size-4 animate-spin" />Finding the {model ?? ''} POH…</p>
  if (!doc && !match) return <p className="text-sm text-fg-2">No public POH found for the {model ?? 'airplane'}. Upload this airplane's POH (PDF): its tables and spec sheet are read from it.</p>
  const specs = doc?.specs
  const got = specs && !specs.pending ? SPEC_GROUPS.filter(([k]) => specs[k] != null) : []
  const missing = specs && !specs.pending ? SPEC_GROUPS.filter(([k]) => specs[k] == null) : []
  const units = read?.units ? Object.entries(read.units).map(([k, v]) => `${SECTION_LABEL[k as keyof typeof SECTION_LABEL] ?? k} in ${v === 'mph' ? 'MPH (converted)' : v === 'kt' ? 'knots' : 'unstated units'}`) : []
  return (
    <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      <dt className="text-fg-3">Book</dt>
      <dd className="text-fg">{doc?.title ?? match?.title}<span className="text-fg-3"> · {uploaded ? 'your upload' : match?.exact ? 'public copy for this model' : `closest public POH to the ${model}`}</span></dd>
      <dt className="text-fg-3">Performance tables</dt>
      <dd className="text-fg-2">{read?.sections.length ? <>Read: {read.sections.map(k => SECTION_LABEL[k]).join(', ')}.{read.missing.length ? <span className="text-fg-3"> Not readable, the 172P's used: {read.missing.map(k => SECTION_LABEL[k]).join(', ')}.</span> : ''}</>
        : base.exact && !base.note ? `Hand-checked tables for the ${base.profile.model}.`
        : read?.reason === 'no text layer' ? 'A scan without text: its tables couldn\'t be read, so the 172P\'s are used and named in the workings.'
        : `This book's takeoff, climb, cruise and landing tables couldn't be read, so the ${base.profile.model}'s are used and named in the workings. Upload a clearer copy to replace them.`}</dd>
      {units.length > 0 && <><dt className="text-fg-3">Units</dt><dd className="text-fg-2">{units.join('; ')}</dd></>}
      <dt className="text-fg-3">Spec sheet</dt>
      <dd className="text-fg-2">{specs?.pending ? <span className="inline-flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" />{specs.pending}</span> : hasSpecs(specs) ? <>Read: {got.map(([, l]) => l).join(', ')}.{missing.length ? <span className="text-fg-3"> Not found in the text (left blank, never guessed): {missing.map(([, l]) => l).join(', ')}.</span> : ''}</> : 'Not readable from this copy.'}</dd>
    </dl>
  )
}

/* ── Aircraft ── */
const STEPS = ['Tail number', 'POH', 'Weight and fuel', 'Equipment and inspections', 'Checklist'] as const

// A new aircraft, step by step; nothing is saved until Finish, except an
// uploaded POH (a document, kept either way).
export function AircraftSetup({ initialTail, onDone, onCancel }: { initialTail?: string; onDone: (tail: string) => void; onCancel: () => void }) {
  const [step, setStep] = useState(0)
  const [raw, setRaw] = useState(initialTail ?? '')
  const tail = /^N?[0-9][0-9A-Z]{0,4}$/.test(raw) ? (raw.startsWith('N') ? raw : `N${raw}`) : null
  const [draft, setDraft] = useState<AircraftPlanning>({})
  const reg = useRegistry(tail ?? undefined)
  const ident = { make: draft.profile?.make || reg.data?.make, model: draft.profile?.model || reg.data?.model, year: draft.profile?.year ?? reg.data?.year }
  const poh = usePohFind(tail && ident.model ? { ...ident, tail } : null)
  const docs = useDocuments()
  const fileRef = useRef<HTMLInputElement>(null)
  const ac = useAircraftProfiles()
  const profile = useMemo(() => withSpecs(withTables(profileFor(ident.model), poh.data?.doc?.tables, poh.data?.doc?.title), poh.data?.doc?.specs, poh.data?.doc?.title).profile, [ident.model, poh.data])
  const u = unitsForTail(tail)
  const eq = draft.equipment ?? {}
  const setEq = (p: Partial<NonNullable<AircraftPlanning['equipment']>>) => setDraft(d => ({ ...d, equipment: { ...d.equipment, ...p } }))
  const canNext = step === 0 ? !!tail && !reg.isLoading && !!ident.model : true
  const finish = async () => {
    if (!tail) return
    try { await ac.save.mutateAsync({ tail, data: draft }); toast.success(`${tail} added`); onDone(tail) } catch (e) { toast.error((e as Error).message) }
  }
  const upload = (f: File) => tail && docs.upload.mutate({ file: f, kind: 'poh', tail, model: ident.model ?? undefined, title: `${tail} POH (${f.name.replace(/\.pdf$/i, '')})` }, { onSuccess: () => { toast.success('Uploaded: its tables and spec sheet are being read'); poh.refetch() }, onError: e => toast.error(e.message) })

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={cn('inline-flex items-center gap-1.5', i === step ? 'font-medium text-fg' : i < step ? 'text-fg-2' : 'text-fg-3')}>
            <span className={cn('num grid size-5 place-items-center rounded-full text-[11px]', i < step ? 'bg-accent text-bg' : i === step ? 'ring-1 ring-inset ring-accent text-accent' : 'ring-1 ring-inset ring-border')}>{i < step ? <Check className="size-3" /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          <label className="block max-w-xs"><Label>Tail number</Label>
            <Input value={raw} onChange={e => setRaw(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="N739HE" className="num uppercase placeholder:normal-case" autoFocus /></label>
          {tail && reg.isLoading && <p className="flex items-center gap-2 text-sm text-fg-3"><Loader2 className="size-4 animate-spin" />Looking up {tail} in the FAA registry…</p>}
          {tail && reg.data?.model && (
            <div className="flex items-center gap-3">
              {reg.data.photo_url && <img src={reg.data.photo_url} alt="" className="h-14 w-24 rounded-md object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />}
              <div className="text-sm"><div className="text-fg">{titleCase(reg.data.make ?? '')} {reg.data.model}{reg.data.year ? ` · ${reg.data.year}` : ''}</div><div className="text-[13px] text-fg-3">FAA registry · {reg.data.status ?? 'status unknown'}{reg.data.engine_type ? ` · ${reg.data.engine_type}` : ''}</div></div>
            </div>
          )}
          {tail && !reg.isLoading && !reg.data?.model && (
            <div className="grid max-w-lg grid-cols-3 gap-3">
              <p className="col-span-3 text-[13px] text-fg-3">Not in the FAA registry: enter what it is.</p>
              <label className="block"><Label>Make</Label><Input value={draft.profile?.make ?? ''} onChange={e => setDraft(d => ({ ...d, profile: { ...d.profile, make: e.target.value } }))} placeholder="Cessna" /></label>
              <label className="block"><Label>Model</Label><Input value={draft.profile?.model ?? ''} onChange={e => setDraft(d => ({ ...d, profile: { ...d.profile, model: e.target.value.toUpperCase() } }))} placeholder="172P" className="uppercase" /></label>
              <label className="block"><Label>Year</Label><OptNum value={draft.profile?.year ?? null} placeholder="1982" onChange={v => setDraft(d => ({ ...d, profile: { ...d.profile, year: v ?? undefined } }))} label="Year" /></label>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <PohReport match={poh.data?.match} doc={poh.data?.doc} uploaded={poh.data?.uploaded} loading={poh.isLoading} model={ident.model} />
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
            <Button size="sm" variant="secondary" loading={docs.upload.isPending} onClick={() => fileRef.current?.click()}><Upload />Upload {tail}'s POH</Button>
            <span className="text-[13px] text-fg-3">This airplane's own book (PDF) beats a public copy: its weights, speeds and tables are read from it.</span>
          </div>
        </div>
      )}

      {step === 2 && tail && (
        <div className="space-y-5">
          <EmptyWeight tail={tail} planning={draft} save={setDraft} u={u} />
          <Hint>From the airplane's current weight and balance record (in its documents, often in the POH's Section 6). Without it, the POH's sample airplane is used and the brief asks for it.</Hint>
          {profile.fuel.length > 1 && (
            <label className="block max-w-md"><Label>Fuel tanks</Label>
              <Select value={draft.tanks || profile.fuel[0].key} onChange={e => setDraft(d => ({ ...d, tanks: e.target.value }))}>{profile.fuel.map(f => <option key={f.key} value={f.key}>{f.label} ({f.usable} gal usable)</option>)}</Select></label>
          )}
        </div>
      )}

      {step === 3 && tail && (
        <div className="space-y-6">
          <EquipmentForm eq={eq} setEq={setEq} />
          <InspectionDates tail={tail} planning={draft} save={setDraft} />
        </div>
      )}

      {step === 4 && tail && (
        <div>
          <Hint>Upload a photo or PDF of the checklist you fly {tail} with, or add its lines by hand in order. It's part of every brief for {tail} and prints after the NavLog. You can skip this and add it later.</Hint>
          <div className="mt-3"><ChecklistEditor tail={tail} value={draft.checklist} onSave={c => { setDraft(d => ({ ...d, checklist: c })); toast.success(`${c.reduce((n, s) => n + s.items.length, 0)} steps kept; Finish saves them`) }} /></div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}><ChevronLeft />Back</Button> : <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        {step < STEPS.length - 1 && step > 0 && <Button variant="ghost" onClick={() => setStep(step + 1)}>Skip</Button>}
        {step < STEPS.length - 1
          ? <Button variant="primary" className="ml-auto" disabled={!canNext} onClick={() => setStep(step + 1)}>Next: {STEPS[step + 1].toLowerCase()}<ChevronRight /></Button>
          : <Button variant="primary" className="ml-auto" loading={ac.save.isPending} onClick={finish}>Finish: add {tail}</Button>}
      </div>
    </div>
  )
}

// What's installed: the flight plan's equipment code, the ADS-B rule for Class B/C, pitot heat for the icing brief.
export function EquipmentForm({ eq, setEq, pitot = true }: { eq: NonNullable<AircraftPlanning['equipment']>; setEq: (p: Partial<NonNullable<AircraftPlanning['equipment']>>) => void; pitot?: boolean }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-fg-2">Equipment</h4>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="block"><Label>Transponder</Label><Select value={eq.transponder ?? ''} onChange={e => setEq({ transponder: e.target.value || undefined })}><option value="">Not entered</option><option value="C">Mode C</option><option value="S">Mode S</option><option value="none">None</option></Select></label>
        <label className="block"><Label>GPS</Label><Select value={eq.gps ?? ''} onChange={e => setEq({ gps: e.target.value || undefined })}><option value="">Not entered</option><option value="none">None</option><option value="VFR">VFR (portable or panel)</option><option value="IFR">IFR-approved</option></Select></label>
        <label className="flex items-center justify-between gap-3 self-end rounded-lg px-1 pb-2 text-sm text-fg-2">ADS-B Out<Switch checked={eq.adsbOut === true} onCheckedChange={v => setEq({ adsbOut: v })} /></label>
        {pitot && <label className="flex items-center justify-between gap-3 self-end rounded-lg px-1 pb-2 text-sm text-fg-2">Pitot heat<Switch checked={eq.pitotHeat === true} onCheckedChange={v => setEq({ pitotHeat: v })} /></label>}
        <label className="flex items-center justify-between gap-3 self-end rounded-lg px-1 pb-2 text-sm text-fg-2">Autopilot<Switch checked={eq.autopilot === true} onCheckedChange={v => setEq({ autopilot: v })} /></label>
      </div>
      <Hint>ADS-B Out is required in and above Class B and C (§91.225); the planner flags a route through them without it.</Hint>
    </div>
  )
}

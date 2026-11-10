import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { CERTIFICATES, medicalExpiry, type Certificate, type MedicalKind, type PilotCerts } from './pilot'
import { SubHead, Synced } from './ui'

const MEDICAL: { key: MedicalKind; label: string }[] = [
  { key: 'third', label: 'Third class' }, { key: 'second', label: 'Second class' }, { key: 'first', label: 'First class' },
  { key: 'basicmed', label: 'BasicMed' }, { key: 'license', label: 'Driver\'s license (sport)' }, { key: 'none', label: 'None' },
]
const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// Your certificate, ratings, medical and endorsements, saved once and applied to
// every plan: the Pilot step and Review hold each flight against them.
export function CertificatesEditor({ certs, onSave, saving }: { certs: PilotCerts | null; onSave: (c: PilotCerts) => void; saving: boolean }) {
  const [open, setOpen] = useState(false)
  const [c, setC] = useState<PilotCerts>(certs ?? {})
  useEffect(() => { if (!open) setC(certs ?? {}) }, [certs, open])
  const cert = c.certificate ?? 'student'
  const set = (p: Partial<PilotCerts>) => setC(x => ({ ...x, ...p }))
  const en = c.endorsements ?? {}, rt = c.ratings ?? {}, med = c.medical ?? {}
  const setEn = (p: Partial<NonNullable<PilotCerts['endorsements']>>) => set({ endorsements: { ...en, ...p } })
  const setRt = (p: Partial<NonNullable<PilotCerts['ratings']>>) => set({ ratings: { ...rt, ...p } })
  const setMed = (p: Partial<NonNullable<PilotCerts['medical']>>) => set({ medical: { ...med, ...p } })

  const saved = certs?.certificate
  const exp = medicalExpiry(certs?.medical)
  const summary = saved ? [
    CERTIFICATES.find(k => k.key === saved)!.label,
    Object.entries(certs!.ratings ?? {}).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(', '),
    certs!.medical?.kind ? `${MEDICAL.find(m => m.key === certs!.medical!.kind)?.label}${exp ? ` until ${fmt(exp)}` : ''}` : 'medical not recorded',
    saved === 'student' && certs!.endorsements?.solo ? `solo endorsed ${certs!.endorsements.solo}` : '',
  ].filter(Boolean).join(' · ') : 'Not saved yet. The checks assume a student pilot until you save your certificate.'

  const Check = ({ on, onChange, children }: { on?: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) => (
    <label className="flex items-start gap-2 text-sm text-fg-2"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" checked={!!on} onChange={e => onChange(e.target.checked)} /><span>{children}</span></label>
  )
  const DateF = ({ label, value, onChange, hint }: { label: string; value?: string; onChange: (v: string) => void; hint?: string }) => (
    <label className="block min-w-0"><span className="mb-1 block text-sm text-fg-2">{label}</span><Input type="date" value={value ?? ''} onChange={e => onChange(e.target.value)} className="num" />{hint && <span className="mt-1 block text-xs text-fg-3">{hint}</span>}</label>
  )

  return (
    <div>
      <SubHead right={certs?.updatedAt ? <Synced at={certs.updatedAt} label="Saved" /> : null}>Your certificates</SubHead>
      {!open ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ring-border">
          <span className="min-w-0 flex-1 text-fg-2">{summary}</span>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Pencil />{saved ? 'Update' : 'Add'}</Button>
        </div>
      ) : (
        <div className="space-y-5 rounded-lg px-3 py-3 ring-1 ring-inset ring-border">
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            <label className="block"><span className="mb-1 block text-sm text-fg-2">Certificate</span>
              <Select value={cert} onChange={e => set({ certificate: e.target.value as Certificate })}>{CERTIFICATES.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</Select></label>
            {DateF({ label: cert === 'student' ? 'Last flight review' : 'Last flight review or checkride', value: c.flightReview, onChange: v => set({ flightReview: v }), hint: '§61.56: 24 calendar months. Blank uses your logbook.' })}
            <label className="block"><span className="mb-1 block text-sm text-fg-2">Home airport</span>
              <Input value={c.home ?? ''} onChange={e => set({ home: e.target.value.toUpperCase().trim() })} placeholder="KRHV" className="num uppercase" maxLength={5} />
              <span className="mt-1 block text-xs text-fg-3">Where you train; the student 25 nm radius is measured from here.</span></label>
          </div>

          {cert !== 'student' && (
            <fieldset><legend className="mb-2 text-sm font-medium text-fg">Ratings</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {Check({ on: rt.asel, onChange: v => setRt({ asel: v }), children: <>Airplane single-engine land</> })}
                {Check({ on: rt.ases, onChange: v => setRt({ ases: v }), children: <>Single-engine sea</> })}
                {Check({ on: rt.amel, onChange: v => setRt({ amel: v }), children: <>Multi-engine land</> })}
                {Check({ on: rt.instrument, onChange: v => setRt({ instrument: v }), children: <>Instrument</> })}
                {Check({ on: rt.cfi, onChange: v => setRt({ cfi: v }), children: <>Flight instructor</> })}
              </div></fieldset>
          )}

          <fieldset><legend className="mb-2 text-sm font-medium text-fg">Medical</legend>
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              <label className="block"><span className="mb-1 block text-sm text-fg-2">Kind</span>
                <Select value={med.kind ?? ''} onChange={e => setMed({ kind: (e.target.value || undefined) as MedicalKind | undefined })}><option value="">Not recorded</option>{MEDICAL.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</Select></label>
              {med.kind && med.kind !== 'none' && med.kind !== 'license' && DateF({ label: med.kind === 'basicmed' ? 'BasicMed exam (CMEC)' : 'Exam date', value: med.date, onChange: v => setMed({ date: v }) })}
              {med.kind === 'basicmed' && DateF({ label: 'BasicMed course', value: med.course, onChange: v => setMed({ course: v }) })}
              {(med.kind === 'first' || med.kind === 'second' || med.kind === 'third') && <div className="self-end pb-2">{Check({ on: med.under40, onChange: v => setMed({ under40: v }), children: <>Under 40 at the exam</> })}</div>}
            </div>
            {medicalExpiry(med) && <p className="mt-1 text-xs text-fg-3">Covers student and private privileges until {fmt(medicalExpiry(med)!)} (§61.23(d)).</p>}
          </fieldset>

          {cert === 'student' && (
            <fieldset><legend className="mb-2 text-sm font-medium text-fg">Student endorsements</legend>
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {DateF({ label: 'Solo endorsement', value: en.solo, onChange: v => setEn({ solo: v }), hint: '§61.87(n): good for 90 days.' })}
                <label className="block"><span className="mb-1 block text-sm text-fg-2">Solo endorsed in (model)</span><Input value={en.soloModel ?? ''} onChange={e => setEn({ soloModel: e.target.value.toUpperCase() })} placeholder="172P" className="uppercase" /></label>
                {DateF({ label: 'Class B endorsement', value: en.classB, onChange: v => setEn({ classB: v }), hint: '§61.95: 90 days, for one Class B.' })}
                <label className="block"><span className="mb-1 block text-sm text-fg-2">Class B airspace</span><Input value={en.classBAirport ?? ''} onChange={e => setEn({ classBAirport: e.target.value })} placeholder="San Francisco" /></label>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {Check({ on: en.soloNearby, onChange: v => setEn({ soloNearby: v }), children: <>Solo to another airport within 25 nm (§61.93(b)(1))</> })}
                {Check({ on: en.soloXc, onChange: v => setEn({ soloXc: v }), children: <>Solo cross-country training (§61.93(c)(1))</> })}
                {Check({ on: en.soloNight, onChange: v => setEn({ soloNight: v }), children: <>Night solo (§61.87(o))</> })}
              </div></fieldset>
          )}

          <fieldset><legend className="mb-2 text-sm font-medium text-fg">Airplane endorsements</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {Check({ on: en.highPerformance, onChange: v => setEn({ highPerformance: v }), children: <>High performance, over 200 hp (§61.31(f))</> })}
              {Check({ on: en.complex, onChange: v => setEn({ complex: v }), children: <>Complex (§61.31(e))</> })}
              {Check({ on: en.tailwheel, onChange: v => setEn({ tailwheel: v }), children: <>Tailwheel (§61.31(i))</> })}
              {(cert === 'sport' || cert === 'recreational') && Check({ on: en.towered, onChange: v => setEn({ towered: v }), children: <>Class B, C, D and towered airports ({cert === 'sport' ? '§61.325' : '§61.101(d)'})</> })}
              {cert === 'recreational' && Check({ on: en.recreationalXc, onChange: v => setEn({ recreationalXc: v }), children: <>Beyond 50 nm (§61.101(c))</> })}
            </div></fieldset>

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button variant="primary" loading={saving} onClick={() => { onSave({ ...c, certificate: cert }); setOpen(false) }}>Save certificates</Button>
            <Button variant="ghost" onClick={() => { setC(certs ?? {}); setOpen(false) }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

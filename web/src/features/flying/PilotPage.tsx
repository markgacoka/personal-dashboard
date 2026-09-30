import { useMemo, useState } from 'react'
import { BookOpenText, FileBadge2, HeartPulse, Pencil, ShieldCheck } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { Progress, Skeleton, Switch } from '@/components/ui/misc'
import { PageHeader } from '@/components/data/stat'
import { StatusBadge } from '@/components/data/status'
import { useFlights } from '@/lib/queries'
import { computeCurrency, medicalExpiry, MED_LABEL, readMedical, saveMedical, type MedClass, type Medical } from '@/lib/flying'
import { MEDICAL, REG_NOTES, STUDENT_PILOT } from '@/lib/credentials'
import { cn } from '@/lib/utils'

const DAY = 86_400_000
const longDate = (d: string | Date) => new Date(typeof d === 'string' ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export default function PilotPage() {
  return (
    <div>
      <PageHeader title="Pilot" description="Certificates, medical and FAA currency" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Document
          icon={<FileBadge2 />} tone="accent" title={STUDENT_PILOT.title} number={`No. ${STUDENT_PILOT.number}`} name={STUDENT_PILOT.name}
          issued={STUDENT_PILOT.issued} issuedLabel="Issued" expires={STUDENT_PILOT.expires}
          fields={[['Date of birth', STUDENT_PILOT.dob], ['Nationality', STUDENT_PILOT.nationality], ['Sex', STUDENT_PILOT.sex], ['Height', STUDENT_PILOT.height], ['Weight', STUDENT_PILOT.weight], ['Hair · eyes', `${STUDENT_PILOT.hair} · ${STUDENT_PILOT.eyes}`]]}
          footer={[`Limitation: ${STUDENT_PILOT.limitation}`, `Signed ${STUDENT_PILOT.signedBy}`]}
        />
        <Document
          icon={<HeartPulse />} tone="good" title={`${MEDICAL.title} · ${MEDICAL.cls}`} number={`ID ${MEDICAL.applicantId}`} name={MEDICAL.name}
          issued={MEDICAL.examined} issuedLabel="Examined" expires={MEDICAL.expires}
          fields={[['Date of birth', MEDICAL.dob], ['Sex', MEDICAL.sex], ['Height', MEDICAL.height], ['Weight', MEDICAL.weight], ['Hair · eyes', `${MEDICAL.hair} · ${MEDICAL.eyes}`], ['Examiner', `${MEDICAL.examiner}`]]}
          footer={[`Limitations: ${MEDICAL.limitation}`, `${MEDICAL.form} · designee ${MEDICAL.designee} · control ${MEDICAL.control}`]}
        />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <CurrencyCard className="xl:col-span-8" />
        <MedicalCard className="xl:col-span-4" />
      </div>
      <Card className="mt-5">
        <CardHeader icon={<BookOpenText />} title="Regulatory notes" />
        <CardBody className="grid gap-6 md:grid-cols-2">
          {REG_NOTES.map(n => (
            <div key={n.title}>
              <div className="mb-2 flex items-baseline justify-between"><span className="font-medium">{n.title}</span><span className="num text-xs text-fg-3">{n.cfr}</span></div>
              <ul className="space-y-1.5 text-sm text-fg-2">{n.items.map(i => <li key={i} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-fg-3" />{i}</li>)}</ul>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  )
}

function Document({ icon, tone, title, number, name, issued, issuedLabel, expires, fields, footer }: {
  icon: React.ReactNode; tone: 'accent' | 'good'; title: string; number: string; name: string; issued: string; issuedLabel: string; expires: string; fields: [string, string][]; footer: string[]
}) {
  const start = +new Date(issued + 'T12:00:00'), end = +new Date(expires + 'T12:00:00')
  const left = Math.max(0, Math.floor((end - Date.now()) / DAY))
  const pct = Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100))
  const state = left <= 90 ? 'bad' : left <= 365 ? 'warn' : 'good'
  return (
    <Card className="overflow-hidden">
      <div className={cn('h-1', tone === 'accent' ? 'bg-accent' : 'bg-good')} />
      <div className="flex items-start gap-3 px-5 pt-4">
        <span className={cn('grid size-9 place-items-center rounded-lg [&_svg]:size-5', tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-good-soft text-good')}>{icon}</span>
        <div className="min-w-0 flex-1"><div className="font-semibold">{title}</div><div className="text-sm text-fg-3">U.S. Department of Transportation · FAA</div></div>
        <span className="num text-sm text-fg-3">{number}</span>
      </div>
      <CardBody className="pt-4">
        <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
          <div>
            <div className="num text-lg font-semibold tracking-wide">{name}</div>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5">
              {fields.map(([k, v]) => <div key={k}><dt className="text-xs text-fg-3">{k}</dt><dd className="text-sm">{v}</dd></div>)}
            </dl>
          </div>
          <div className="sm:w-40 sm:text-right">
            <div className={cn('num text-4xl font-semibold tracking-tight', state === 'bad' ? 'text-bad' : state === 'warn' ? 'text-warn' : 'text-fg')}>{left.toLocaleString()}</div>
            <div className="text-sm text-fg-3">days remaining</div>
            <div className="mt-3 space-y-1 text-sm"><div><span className="text-fg-3">Valid through</span><br />{longDate(expires)}</div></div>
          </div>
        </div>
        <div className="mt-5">
          <Progress value={pct} tone={state === 'good' ? 'accent' : state} />
          <div className="mt-1.5 flex justify-between text-xs text-fg-3"><span>{issuedLabel} {longDate(issued)}</span><span>{Math.round(pct)}% elapsed</span></div>
        </div>
      </CardBody>
      <div className="flex flex-wrap justify-between gap-2 border-t border-border bg-sunken px-5 py-2.5 text-xs text-fg-3">{footer.map(f => <span key={f}>{f}</span>)}</div>
    </Card>
  )
}

function CurrencyCard({ className }: { className?: string }) {
  const { data: flights, isLoading } = useFlights()
  const items = useMemo(() => (flights ? computeCurrency(flights) : []), [flights])
  return (
    <Card className={className}>
      <CardHeader icon={<ShieldCheck />} title="Currency" description={flights ? `From ${flights.length} logged flights` : undefined} />
      <CardBody>
        {isLoading ? <Skeleton className="h-64" /> : (
          <ul className="divide-y divide-border">
            {items.map(c => (
              <li key={c.key} className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_220px_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2"><span className="font-medium">{c.name}</span><span className="num text-xs text-fg-3">{c.rule}</span></div>
                  <div className="text-sm text-fg-3">{c.requirement}</div>
                </div>
                <div className="space-y-1.5">
                  {c.progress ? c.progress.map(p => (
                    <div key={p.label} className="flex items-center gap-2 text-xs">
                      <span className="w-16 text-fg-3">{p.label}</span>
                      <Progress value={(p.have / p.need) * 100} tone={p.have >= p.need ? 'good' : 'accent'} className="flex-1" />
                      <span className="num w-9 text-right text-fg-2">{p.have}/{p.need}</span>
                    </div>
                  )) : <div className="text-sm text-fg-2">{c.detail}</div>}
                </div>
                <div className="flex flex-col items-start gap-1 sm:items-end"><StatusBadge state={c.state} />{c.progress && <span className="text-xs text-fg-3">{c.detail}</span>}</div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function MedicalCard({ className }: { className?: string }) {
  const [m, setM] = useState<Medical>(readMedical)
  const [editing, setEditing] = useState(false)
  const exp = medicalExpiry(m)
  const days = exp ? Math.floor((+exp - Date.now()) / DAY) : null
  const update = (patch: Partial<Medical>) => setM(prev => { const next = { ...prev, ...patch }; saveMedical(next); return next })
  const privileges = m.cls === '1' ? (m.under40 ? '12 months first-class privileges' : '6 months first-class privileges') : m.cls === '2' ? '12 months second-class privileges' : m.cls === 'basicmed' ? '48 months' : m.under40 ? '60 months third-class privileges' : '24 months third-class privileges'
  return (
    <Card className={className}>
      <CardHeader icon={<HeartPulse />} title="Medical currency" description="Used by the currency checks on this device" action={<Button variant="ghost" size="sm" onClick={() => setEditing(e => !e)}><Pencil />{editing ? 'Done' : 'Edit'}</Button>} />
      <CardBody className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div><div className="font-medium">{MED_LABEL[m.cls]}</div><div className="text-sm text-fg-3">{privileges}</div></div>
          <StatusBadge state={days == null ? 'na' : days < 0 ? 'lapsed' : days < 60 ? 'expiring' : 'current'} label={days != null && days >= 0 && days < 60 ? `${days} days left` : undefined} />
        </div>
        <div className="text-sm"><span className="text-fg-3">Expires</span> {exp ? exp.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</div>
        {editing && (
          <div className="space-y-3 border-t border-border pt-4">
            <Field label="Class"><Select value={m.cls} onChange={e => update({ cls: e.target.value as MedClass })}>{(Object.keys(MED_LABEL) as MedClass[]).map(k => <option key={k} value={k}>{MED_LABEL[k]}</option>)}</Select></Field>
            <Field label="Exam date"><Input type="date" value={m.date} onChange={e => update({ date: e.target.value })} /></Field>
            <label className="flex items-center justify-between text-sm">Under 40 at the exam<Switch checked={m.under40} onCheckedChange={v => update({ under40: v })} /></label>
          </div>
        )}
        {!editing && <Badge tone="neutral">Stored in this browser</Badge>}
      </CardBody>
    </Card>
  )
}

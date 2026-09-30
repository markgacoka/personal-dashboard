import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, RadioTower as Broadcast, Check, ChevronDown, Loader2, Plane, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { get, post, put } from '@/lib/api'
import { qk, useAircraftList, useInstructors } from '@/lib/queries'
import { APPROACH_TYPES, TRAINING_TYPES, route, trainingLabel } from '@/lib/flying'
import { calDate, hours } from '@/lib/format'
import { num, cn } from '@/lib/utils'
import type { AircraftRef, AircraftRegistry, Airport, Approach, Flight } from '@/lib/types'

interface Detected { departure_icao?: string; arrival_icao?: string; departure_time?: string; arrival_time?: string; duration_min?: number; icao24?: string; first_seen_unix?: number }

type Step = 'lookup' | 'pick' | 'details'
const today = () => new Date().toISOString().slice(0, 10)

export function FlightFormDialog({ open, onOpenChange, flight }: { open: boolean; onOpenChange: (o: boolean) => void; flight?: Flight | null }) {
  const [step, setStep] = useState<Step>('lookup')
  const [seed, setSeed] = useState<{ date: string; tail: string; dep: string; aircraft: AircraftRef | null; detected?: Detected; editing?: Flight | null }>({ date: today(), tail: '', dep: '', aircraft: null })
  const [matches, setMatches] = useState<{ db: Flight[]; detected: Detected[]; needsAuth: boolean } | null>(null)

  useEffect(() => {
    if (!open) return
    if (flight) { setSeed({ date: flight.date.slice(0, 10), tail: flight.aircraft?.tail_number || '', dep: flight.departure?.icao || '', aircraft: flight.aircraft, editing: flight }); setStep('details') }
    else { setSeed({ date: today(), tail: '', dep: '', aircraft: null }); setMatches(null); setStep('lookup') }
  }, [open, flight])

  const editing = seed.editing
  const title = editing ? 'Edit flight' : seed.detected ? 'Log detected flight' : 'Log flight'
  const steps: Step[] = ['lookup', 'pick', 'details']

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide title={title} description={editing ? <span className="num">{route(editing).join(' → ')} · {calDate(editing.date, { month: 'long', day: 'numeric', year: 'numeric' })}</span> : 'Find the flight by aircraft and departure, then fill in the times.'}>
        {!editing && (
          <ol className="mb-6 flex items-center gap-2 text-sm">
            {['Aircraft & route', 'Match', 'Details'].map((l, i) => {
              const idx = steps.indexOf(step)
              return (
                <li key={l} className="flex items-center gap-2">
                  <span className={cn('grid size-6 place-items-center rounded-full text-xs font-semibold ring-1', i < idx ? 'bg-accent text-accent-fg ring-accent' : i === idx ? 'bg-accent-soft text-accent ring-accent' : 'text-fg-3 ring-border')}>{i < idx ? <Check className="size-3.5" /> : i + 1}</span>
                  <span className={i === idx ? 'font-medium text-fg' : 'text-fg-3'}>{l}</span>
                  {i < 2 && <span className="mx-1 h-px w-6 bg-border" />}
                </li>
              )
            })}
          </ol>
        )}
        {step === 'lookup' && <LookupStep seed={seed} onNext={(s, m) => { setSeed(s); setMatches(m); setStep('pick') }} />}
        {step === 'pick' && matches && <PickStep seed={seed} matches={matches} onBack={() => setStep('lookup')}
          onPick={(p) => { setSeed(s => ({ ...s, editing: p.flight ?? null, detected: p.detected })); setStep('details') }} />}
        {step === 'details' && <DetailsStep seed={seed} onBack={editing && !flight ? () => setStep('pick') : undefined} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

// ── Step 1: date, tail number, departure ─────────────────────────────────────
function LookupStep({ seed, onNext }: { seed: { date: string; tail: string; dep: string; aircraft: AircraftRef | null }; onNext: (s: { date: string; tail: string; dep: string; aircraft: AircraftRef | null }, m: { db: Flight[]; detected: Detected[]; needsAuth: boolean }) => void }) {
  const qc = useQueryClient()
  const { data: fleet } = useAircraftList()
  const [date, setDate] = useState(seed.date)
  const [tail, setTail] = useState(seed.tail)
  const [dep, setDep] = useState(seed.dep)
  const [debounced, setDebounced] = useState(seed.tail)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDebounced(tail.trim().toUpperCase()), 400); return () => clearTimeout(t) }, [tail])

  const known = fleet?.find(a => a.tail_number.toUpperCase() === debounced)
  const reg = useQuery({
    queryKey: ['registry', debounced], enabled: debounced.length >= 3, staleTime: Infinity, retry: false,
    queryFn: () => get<AircraftRegistry>(`/api/external/aircraft/${encodeURIComponent(debounced)}`).catch(() => null),
  })
  const aircraft: AircraftRef | null = known ? { ...known, mode_s_hex: known.mode_s_hex || reg.data?.mode_s_hex || null } : null

  const addAircraft = async () => {
    const r = reg.data
    if (!r) return
    setAdding(true)
    try {
      await post('/api/aircraft', {
        tail_number: debounced, make: r.make || 'Unknown', model: r.model || 'Unknown', year: r.year || null,
        engine_type: r.engine_type || null, engine_hp: r.engine_hp || null, seats: r.seats || null, ifr_equipped: false, glass_cockpit: false,
        type_code: null, category: r.category || 'Airplane', aircraft_class: r.aircraft_class || 'ASEL', gear_type: r.gear_type || 'fixed_tricycle',
        is_complex: r.is_complex || false, is_high_performance: false, mode_s_hex: r.mode_s_hex || null, notes: r.owner ? `Owner: ${r.owner}` : null,
      })
      await qc.invalidateQueries({ queryKey: ['aircraft'] })
      toast.success(`${debounced} added to your aircraft`)
    } catch (e) { toast.error((e as Error).message) }
    setAdding(false)
  }

  const next = async () => {
    setBusy(true)
    const d = dep.trim().toUpperCase()
    const [db, osky] = await Promise.all([
      get<Flight[]>(`/api/flights?${new URLSearchParams({ date, departure: d, tail: debounced })}`).catch(() => []),
      aircraft?.mode_s_hex
        ? get<{ flights?: Detected[]; needs_auth?: boolean }>(`/api/external/flights-detected?${new URLSearchParams({ departure: d, date, icao24: aircraft.mode_s_hex })}`).catch(() => ({ flights: [] as Detected[] }))
        : Promise.resolve({ flights: [] as Detected[] }),
    ])
    setBusy(false)
    onNext({ date, tail: debounced, dep: d, aircraft }, { db, detected: osky.flights || [], needsAuth: !!(osky as { needs_auth?: boolean }).needs_auth })
  }

  const ready = !!date && dep.trim().length >= 3 && !!aircraft
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[160px_1fr_140px]">
        <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} max={today()} /></Field>
        <Field label="Tail number" hint={fleet?.length ? `Your aircraft: ${fleet.map(a => a.tail_number).join(', ')}` : undefined}>
          <Input value={tail} onChange={e => setTail(e.target.value.toUpperCase())} placeholder="N5624H" maxLength={8} autoFocus className="num uppercase" list="fleet" />
          <datalist id="fleet">{fleet?.map(a => <option key={a.id} value={a.tail_number}>{a.make} {a.model}</option>)}</datalist>
        </Field>
        <Field label="Departure"><Input value={dep} onChange={e => setDep(e.target.value.toUpperCase())} placeholder="KRHV" maxLength={6} className="num uppercase" /></Field>
      </div>

      {debounced.length >= 3 && (
        <div className="rounded-lg border border-border p-4">
          {known ? (
            <div className="flex items-center gap-3"><Plane className="size-5 text-accent" /><div><div className="font-medium"><span className="num">{known.tail_number}</span> · {known.make} {known.model}{known.year ? ` · ${known.year}` : ''}</div><div className="text-sm text-fg-3">In your aircraft list{aircraft?.mode_s_hex ? ' · ADS-B lookup available' : ''}</div></div><Badge tone="good" className="ml-auto"><Check />Found</Badge></div>
          ) : reg.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-fg-3"><Loader2 className="size-4 animate-spin" />Searching the FAA registry…</div>
          ) : reg.data?.make ? (
            <div className="flex flex-wrap items-center gap-3"><Plane className="size-5 text-fg-3" /><div className="min-w-0 flex-1"><div className="font-medium"><span className="num">{debounced}</span> · {reg.data.make} {reg.data.model}{reg.data.year ? ` · ${reg.data.year}` : ''}</div><div className="text-sm text-fg-3">FAA registry{reg.data.owner ? ` · ${reg.data.owner}` : ''} · not in your aircraft list yet</div></div><Button size="sm" onClick={addAircraft} loading={adding}><Plus />Add aircraft</Button></div>
          ) : (
            <div className="text-sm text-fg-3">No aircraft {debounced} in your list or the FAA registry.</div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="primary" disabled={!ready} loading={busy} onClick={next}>Find flights<ArrowRight /></Button>
      </div>
    </div>
  )
}

// ── Step 2: an existing entry, an ADS-B detection, or a new flight ───────────
function PickStep({ seed, matches, onBack, onPick }: { seed: { date: string; tail: string; dep: string }; matches: { db: Flight[]; detected: Detected[]; needsAuth: boolean }; onBack: () => void; onPick: (p: { flight?: Flight; detected?: Detected }) => void }) {
  const dbArr = new Set<string | undefined>(matches.db.map(f => f.arrival?.icao))
  const fresh = matches.detected.filter(d => !dbArr.has(d.arrival_icao))
  const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '')
  const Row = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-hover">{children}<ArrowRight className="ml-auto size-4 text-fg-3" /></button>
  )
  return (
    <div className="space-y-4">
      <div className="text-sm text-fg-2"><span className="num font-medium text-fg">{seed.tail}</span> from <span className="num font-medium text-fg">{seed.dep}</span> on <span className="font-medium text-fg">{calDate(seed.date, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
      {matches.db.length > 0 && <div className="space-y-2"><div className="text-sm font-medium text-fg-3">Already in the logbook</div>{matches.db.map(f => (
        <Row key={f.id} onClick={() => onPick({ flight: f })}><Search className="size-4 text-fg-3" /><div><div className="num font-medium">{route(f).join(' → ')}</div><div className="text-sm text-fg-3">{trainingLabel(f.training_type)} · {hours(f.total_duration)}h · {f.landings || 0} landings · edit this entry</div></div></Row>
      ))}</div>}
      {fresh.length > 0 && <div className="space-y-2"><div className="flex items-center gap-1.5 text-sm font-medium text-fg-3"><Broadcast className="size-4" />Detected by ADS-B (OpenSky)</div>{fresh.map((d, i) => (
        <Row key={i} onClick={() => onPick({ detected: d })}><Plane className="size-4 text-accent" /><div><div className="num font-medium">{seed.dep} → {d.arrival_icao || 'Unknown'}</div><div className="text-sm text-fg-3">Departed {time(d.departure_time)}{d.duration_min != null ? ` · ${Math.floor(d.duration_min / 60)}h ${d.duration_min % 60}m` : ''} · import</div></div></Row>
      ))}</div>}
      {!matches.db.length && !fresh.length && <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-fg-3">No existing entry or ADS-B detection for this aircraft and date.</p>}
      {matches.needsAuth && <p className="text-xs text-fg-3">ADS-B detection needs OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET on the server.</p>}
      <div className="flex justify-between gap-2 pt-2">
        <Button variant="ghost" onClick={onBack}><ArrowLeft />Back</Button>
        <Button variant="primary" onClick={() => onPick({})}><Plus />New flight</Button>
      </div>
    </div>
  )
}

// ── Step 3: the entry itself ─────────────────────────────────────────────────
const TIME_FIELDS = [['total_duration', 'Total'], ['dual_received', 'Dual received'], ['dual_given', 'Dual given'], ['pic', 'PIC'], ['solo', 'Solo'], ['sic', 'SIC'], ['cross_country', 'Cross-country'], ['night', 'Night'], ['actual_instrument', 'Actual instrument'], ['instrument', 'Simulated instrument']] as const
const OPS_FIELDS = [['takeoffs', 'Take-offs'], ['landings', 'Landings'], ['day_takeoffs', 'Day T/O'], ['day_landings_full_stop', 'Day full-stop'], ['night_takeoffs', 'Night T/O'], ['night_landings', 'Night landings'], ['night_landings_full_stop', 'Night full-stop'], ['holds', 'Holds']] as const
type Vals = Record<string, string>

function DetailsStep({ seed, onBack, onDone }: { seed: { date: string; dep: string; aircraft: AircraftRef | null; detected?: Detected; editing?: Flight | null }; onBack?: () => void; onDone: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: fleet } = useAircraftList()
  const { data: instructors } = useInstructors()
  const f = seed.editing, d = seed.detected
  const s = (v: unknown) => (v == null || v === '' ? '' : String(v))
  const n1 = (v: unknown) => (num(v) > 0 ? num(v).toFixed(1) : '')
  const [v, setV] = useState<Vals>(() => ({
    date: f?.date.slice(0, 10) || seed.date, aircraft_id: s(f?.aircraft?.id ?? seed.aircraft?.id), departure_icao: f?.departure?.icao || d?.departure_icao || seed.dep,
    arrival_icao: f?.arrival?.icao || d?.arrival_icao || '', via: (f?.via || []).join(', '), training_type: f?.training_type || '', instructor_id: s(f?.instructor_id),
    ...Object.fromEntries(TIME_FIELDS.map(([k]) => [k, k === 'instrument' ? n1(f?.simulated_instrument) : k === 'total_duration' && !f && d?.duration_min ? (d.duration_min / 60).toFixed(1) : n1(f?.[k as keyof Flight])])),
    ...Object.fromEntries(OPS_FIELDS.map(([k]) => [k, num(f?.[k as keyof Flight]) > 0 ? String(f?.[k as keyof Flight]) : ''])),
    distance_nm: n1(f?.distance_nm), hobbs_start: s(f?.hobbs_start), hobbs_end: s(f?.hobbs_end), tach_start: s(f?.tach_start), tach_end: s(f?.tach_end),
    remarks: f?.remarks || '',
  }))
  const [apps, setApps] = useState<Approach[]>(f?.approaches || [])
  const [showMeters, setShowMeters] = useState(!!(f?.hobbs_start || f?.tach_start))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV(p => ({ ...p, [k]: e.target.value }))

  const icaos = useMemo(() => [v.departure_icao, ...v.via.split(',').map(x => x.trim()), v.arrival_icao].map(x => x.toUpperCase()).filter(x => x.length >= 3), [v.departure_icao, v.via, v.arrival_icao])
  const apts = useQuery({
    queryKey: ['airports-lookup', icaos.join(',')], enabled: icaos.length > 0, staleTime: 60_000,
    queryFn: async () => Object.fromEntries(await Promise.all([...new Set(icaos)].map(async ic => [ic, await get<Airport>(`/api/airports/${ic}`).catch(() => null)] as const))),
  })

  const hobbs = num(v.hobbs_end) - num(v.hobbs_start)

  const submit = async () => {
    setError('')
    if (!v.date || !v.aircraft_id || !v.departure_icao || !v.arrival_icao || !num(v.total_duration)) { setError('Date, aircraft, departure, arrival and total time are required.'); return }
    const fv = (k: string) => num(v[k])
    const iv = (k: string) => Math.round(num(v[k]))
    const nv = (k: string) => (v[k] === '' ? null : num(v[k]))
    const body = {
      date: v.date, aircraft_id: Number(v.aircraft_id), departure_icao: v.departure_icao.toUpperCase(), arrival_icao: v.arrival_icao.toUpperCase(),
      via: v.via.split(',').map(x => x.trim().toUpperCase()).filter(Boolean), training_type: v.training_type || null,
      ...Object.fromEntries(TIME_FIELDS.map(([k]) => [k, fv(k)])),
      ...Object.fromEntries(OPS_FIELDS.map(([k]) => [k, iv(k)])),
      distance_nm: nv('distance_nm'), hobbs_start: nv('hobbs_start'), hobbs_end: nv('hobbs_end'), tach_start: nv('tach_start'), tach_end: nv('tach_end'),
      // Columns this form doesn't show keep their stored values (a PUT replaces every column).
      time_out: f?.time_out ?? d?.departure_time ?? null, time_in: f?.time_in ?? d?.arrival_time ?? null,
      instructor_id: v.instructor_id ? Number(v.instructor_id) : null, remarks: v.remarks.trim() || null,
      approaches: apps.filter(a => a.approach_type && a.airport_icao).map(a => ({ ...a, airport_icao: a.airport_icao.toUpperCase() })),
    }
    setSaving(true)
    try {
      const res = f ? await put<{ id: number }>(`/api/flights/${f.id}`, body) : await post<{ id: number }>('/api/flights', body)
      await Promise.all([qc.invalidateQueries({ queryKey: qk.flights }), qc.invalidateQueries({ queryKey: qk.logbook })])
      toast.success(f ? 'Flight updated' : 'Flight logged')
      onDone()
      navigate(`/flying/${res?.id ?? f?.id}`)
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  const section = 'text-sm font-semibold text-fg'
  return (
    <div className="space-y-7">
      <section className="space-y-4">
        <h3 className={section}>Route</h3>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Date"><Input type="date" value={v.date} onChange={set('date')} /></Field>
          <Field label="Aircraft" className="sm:col-span-2"><Select value={v.aircraft_id} onChange={set('aircraft_id')}><option value="">Select…</option>{fleet?.map(a => <option key={a.id} value={a.id}>{a.tail_number} — {a.make} {a.model}</option>)}</Select></Field>
          <Field label="Lesson type"><Select value={v.training_type} onChange={set('training_type')}><option value="">—</option>{Object.entries(TRAINING_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Departure"><Input value={v.departure_icao} onChange={set('departure_icao')} className="num uppercase" maxLength={6} /></Field>
          <Field label="Via" hint="Comma-separated" className="sm:col-span-2"><Input value={v.via} onChange={set('via')} className="num uppercase" placeholder="KHAF, KPAO" /></Field>
          <Field label="Arrival"><Input value={v.arrival_icao} onChange={set('arrival_icao')} className="num uppercase" maxLength={6} /></Field>
        </div>
        {icaos.length > 0 && <div className="flex flex-wrap gap-1.5">{[...new Set(icaos)].map(ic => {
          const a = apts.data?.[ic]
          return <Badge key={ic} tone={apts.isLoading ? 'neutral' : a ? 'neutral' : 'warn'} size="md"><span className="num font-semibold">{ic}</span>{apts.isLoading ? '' : a ? ` ${a.name}` : ' not in the airports table — the flight won’t list until it’s added'}</Badge>
        })}</div>}
        {d && <p className="text-sm text-accent">Pre-filled from an ADS-B detection{d.departure_time ? `, departed ${new Date(d.departure_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}. Check every field.</p>}
        <Field label="Instructor"><Select value={v.instructor_id} onChange={set('instructor_id')} className="sm:max-w-xs"><option value="">None / solo</option>{instructors?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></Field>
      </section>

      <section className="space-y-4">
        <h3 className={section}>Time <span className="font-normal text-fg-3">· hours</span></h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {TIME_FIELDS.map(([k, l]) => <Field key={k} label={l}><Input type="number" step="0.1" min="0" inputMode="decimal" value={v[k]} onChange={set(k)} className="num" /></Field>)}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className={section}>Operations</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {OPS_FIELDS.map(([k, l]) => <Field key={k} label={l}><Input type="number" step="1" min="0" inputMode="numeric" value={v[k]} onChange={set(k)} className="num" /></Field>)}
        </div>
        <Field label="Distance (nm)" className="max-w-40"><Input type="number" step="0.1" min="0" value={v.distance_nm} onChange={set('distance_nm')} className="num" /></Field>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h3 className={section}>Approaches</h3><Button size="sm" variant="ghost" onClick={() => setApps(a => [...a, { approach_type: '', airport_icao: v.arrival_icao, runway: '', circle_to_land: false }])}><Plus />Add approach</Button></div>
        {!apps.length && <p className="text-sm text-fg-3">None logged.</p>}
        {apps.map((a, i) => (
          <div key={i} className="grid grid-cols-[1fr_96px_80px_auto_auto] items-center gap-2">
            <Select aria-label="Approach type" value={a.approach_type} onChange={e => setApps(x => x.map((y, j) => j === i ? { ...y, approach_type: e.target.value } : y))}><option value="">Type…</option>{APPROACH_TYPES.map(t => <option key={t}>{t}</option>)}</Select>
            <Input aria-label="Airport" value={a.airport_icao} onChange={e => setApps(x => x.map((y, j) => j === i ? { ...y, airport_icao: e.target.value.toUpperCase() } : y))} className="num uppercase" placeholder="ICAO" />
            <Input aria-label="Runway" value={a.runway || ''} onChange={e => setApps(x => x.map((y, j) => j === i ? { ...y, runway: e.target.value } : y))} placeholder="Rwy" />
            <label className="flex items-center gap-1.5 text-sm text-fg-2"><input type="checkbox" checked={!!a.circle_to_land} onChange={e => setApps(x => x.map((y, j) => j === i ? { ...y, circle_to_land: e.target.checked } : y))} className="accent-[var(--accent)]" />Circle</label>
            <Button variant="ghost" size="icon-sm" aria-label="Remove approach" onClick={() => setApps(x => x.filter((_, j) => j !== i))}><X /></Button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h3 className={section}>Remarks</h3>
        <Textarea value={v.remarks} onChange={set('remarks')} rows={3} placeholder="Route, conditions, what you practised…" />
      </section>

      <section>
        <button onClick={() => setShowMeters(m => !m)} className="flex items-center gap-1.5 text-sm font-semibold"><ChevronDown className={cn('size-4 transition-transform', !showMeters && '-rotate-90')} />Hobbs and tach</button>
        {showMeters && <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['hobbs_start', 'hobbs_end', 'tach_start', 'tach_end'] as const).map(k => <Field key={k} label={k.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}><Input type="number" step="0.1" value={v[k]} onChange={set(k)} className="num" /></Field>)}
          {hobbs > 0 && <p className="col-span-full text-sm text-fg-3">Hobbs difference <span className="num text-fg-2">{hobbs.toFixed(1)}h</span>{Math.abs(hobbs - num(v.total_duration)) > 0.05 && <> · <button className="text-accent hover:underline" onClick={() => setV(p => ({ ...p, total_duration: hobbs.toFixed(1) }))}>use as total time</button></>}</p>}
        </div>}
      </section>

      {error && <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-2 border-t border-border bg-card px-5 py-3">
        {onBack && <Button variant="ghost" onClick={onBack}><ArrowLeft />Back</Button>}
        <span className="ml-auto" />
        <Button variant="primary" onClick={submit} loading={saving}>{f ? 'Save changes' : 'Log flight'}</Button>
      </div>
    </div>
  )
}

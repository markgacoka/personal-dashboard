import { useMemo } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, CloudSun, Crown, HeartPulse, Inbox, Landmark, Paperclip, ShieldCheck, TrendingDown, TrendingUp, Activity as ActivityIcon } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton, Progress } from '@/components/ui/misc'
import { Stat } from '@/components/data/stat'
import { Sparkline, Ring } from '@/components/data/spark'
import { StatusBadge, stateTone } from '@/components/data/status'
import { useActivities, useAthlete, useChess, useDaily, useFlights, useLogbookStats, useNetWorth } from '@/lib/queries'
import { calDate, dollars, greeting, hm, mailDate, signed, titleCase } from '@/lib/format'
import { computeCurrency, medicalExpiry, MED_LABEL, pplProgress, readMedical, route, trainingLabel } from '@/lib/flying'
import { homeAirport, windText } from '@/lib/weather'
import { actDuration, sportOf, SPORTS } from '@/lib/sports'
import { num, cn } from '@/lib/utils'
import { readiness, type Tone } from '@/features/training/readiness'
import { useVolume, VolumeChart } from '@/features/training/charts'
import { useAirportBrief, CategoryBadge, VerdictBadge } from '@/features/flying/brief'
import { WindCompass } from '@/features/flying/WindCompass'
import { mail, useMailBoot, unreadCount, type ThreadRow } from '@/features/mail/api'

const toneText = (t: Tone) => (t === 'good' ? 'text-good' : t === 'warn' ? 'text-warn' : t === 'bad' ? 'text-bad' : 'text-fg-3')

export default function TodayPage() {
  const { data: athlete } = useAthlete()
  const first = (athlete?.fullName || 'Gacoka').split(' ')[0]
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-fg-3">{today}</div>
          <h1 className="mt-0.5 text-3xl font-semibold tracking-tight">{greeting()}, {first}</h1>
        </div>
        <AttentionStrip />
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <ReadinessCard className="xl:col-span-5" />
        <ConditionsCard className="xl:col-span-4" />
        <PilotCard className="xl:col-span-3" />
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <TrainingCard className="xl:col-span-8" />
        <NetWorthCard className="xl:col-span-4" />
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <LogbookCard />
        <ChessCard />
        <MailCard className="md:col-span-2 xl:col-span-1" />
      </div>
    </div>
  )
}

function More({ to, children = 'Open' }: { to: string; children?: React.ReactNode }) {
  return <Button asChild variant="ghost" size="sm" className="-mr-2 text-fg-3"><Link to={to}>{children}<ArrowRight /></Link></Button>
}

// Items that need a decision, pulled from currency and the medical certificate.
function AttentionStrip() {
  const { data: flights } = useFlights()
  const items = useMemo(() => {
    if (!flights?.length) return []
    const out = computeCurrency(flights).filter(c => c.state === 'expiring' || c.state === 'lapsed' || c.state === 'grace').map(c => ({ label: `${c.name} ${c.state === 'lapsed' ? 'lapsed' : c.state === 'grace' ? 'in grace period' : `lapses in ${c.daysLeft}d`}`, tone: stateTone(c.state) }))
    const exp = medicalExpiry(readMedical())
    if (exp) { const d = Math.floor((+exp - Date.now()) / 86_400_000); if (d < 60) out.push({ label: d < 0 ? 'Medical expired' : `Medical expires in ${d}d`, tone: d < 0 ? 'bad' : 'warn' }) }
    return out
  }, [flights])
  if (!items.length) return null
  return (
    <Link to="/flying/pilot" className="flex flex-wrap items-center gap-1.5">
      {items.slice(0, 3).map(i => <Badge key={i.label} tone={i.tone === 'neutral' ? 'neutral' : i.tone} size="md">{i.label}</Badge>)}
    </Link>
  )
}

// ── Readiness ────────────────────────────────────────────────────────────────
function ReadinessCard({ className }: { className?: string }) {
  const acts = useActivities()
  const daily = useDaily()
  const r = useMemo(() => readiness(acts.data || [], daily.data), [acts.data, daily.data])
  const loading = daily.isLoading
  const asOf = r.date && r.date !== new Date().toISOString().slice(0, 10) ? `as of ${calDate(r.date)}` : 'today'
  const ringColor = r.sleep.score == null ? 'var(--fg-3)' : r.sleep.score >= 80 ? 'var(--good)' : r.sleep.score >= 60 ? 'var(--warn)' : 'var(--bad)'
  return (
    <Card className={className}>
      <CardHeader icon={<HeartPulse />} title="Readiness" description={`Garmin · ${asOf}`} action={<More to="/sleep">Sleep</More>} />
      <CardBody>
        {loading ? <Skeleton className="h-40" /> : daily.isError ? <p className="py-8 text-center text-sm text-fg-3">Garmin data is unavailable right now.</p> : (
          <>
            <div className="flex items-center gap-4 rounded-lg bg-sunken p-3.5 ring-1 ring-inset ring-border">
              <Ring value={r.sleep.score} size={60} color={ringColor}>
                <span className="num text-base font-semibold">{r.sleep.score ?? '—'}</span>
              </Ring>
              <div className="min-w-0">
                <div className={cn('text-base font-semibold', toneText(r.tone))}>{r.headline}</div>
                <div className="mt-0.5 text-sm text-fg-2">
                  Slept <b className="num font-medium text-fg">{hm(r.sleep.seconds) ?? '—'}</b>
                  {r.sleep.qualifier && <> · {titleCase(r.sleep.qualifier)} sleep</>}
                  {r.sleep.deep != null && <span className="text-fg-3"> · deep {r.sleep.deep}% · REM {r.sleep.rem}%</span>}
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
              <Stat size="sm" label="HRV status" value={r.hrv.label ?? '—'} tone={r.hrv.tone === 'neutral' ? undefined : r.hrv.tone} sub={r.hrv.lastNight ? `${r.hrv.lastNight} ms last night` : undefined} />
              <Stat size="sm" label="Body Battery" value={r.bodyBattery.value} sub={r.bodyBattery.label} tone={r.bodyBattery.tone === 'good' ? undefined : r.bodyBattery.tone === 'neutral' ? undefined : r.bodyBattery.tone} />
              <Stat size="sm" label="Resting HR" value={r.rhr.value} unit="bpm" tone={r.rhr.tone === 'bad' || r.rhr.tone === 'warn' ? r.rhr.tone : undefined}
                sub={r.rhr.delta != null ? `${signed(r.rhr.delta)} vs 7-day · ${r.rhr.label?.toLowerCase()}` : undefined} />
              <Stat size="sm" label="VO₂ max" value={r.vo2max.value} sub={r.vo2max.label} />
              <Stat size="sm" label="SpO₂" value={r.spo2.value != null ? `${r.spo2.value}%` : null} sub={r.spo2.label} tone={r.spo2.tone === 'bad' ? 'bad' : undefined} />
              <Stat size="sm" label="7-day load" value={r.load7 || null} sub="Sum of activity load" />
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

// ── Flying conditions at the home airport ────────────────────────────────────
function ConditionsCard({ className }: { className?: string }) {
  const icao = homeAirport()
  const { brief: b, info, detail, isLoading } = useAirportBrief(icao)
  return (
    <Card className={className}>
      <CardHeader icon={<CloudSun />} title={<span>Conditions at <span className="num">{icao}</span></span>} description={info?.name || 'Home airport'} action={<More to="/flying/weather">Brief</More>} />
      <CardBody>
        {isLoading ? <Skeleton className="h-44" /> : !b ? <p className="py-10 text-center text-sm text-fg-3">No current METAR for {icao}.</p> : (
          <div className="flex items-center gap-5">
            <WindCompass wdir={b.wdir} wspd={b.wspd} wgst={b.wgst} runways={detail?.runways || []} best={b.best?.ident} size={150} />
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-1.5"><VerdictBadge verdict={b.verdict} large /><CategoryBadge cat={b.cat} /></div>
              {b.reasons.length > 0 && <div className="text-sm text-fg-2">{b.reasons.join(' · ')}</div>}
              <div className="space-y-1 text-sm">
                <div className="text-fg">{windText(b)}</div>
                {b.best && <div className="text-fg-3">Runway <span className="num text-fg-2">{b.best.ident}</span> · {b.best.crosswind} kt cross · {Math.abs(b.best.headwind)} kt {b.best.headwind >= 0 ? 'head' : 'tail'}</div>}
                {b.densityAltitude != null && <div className="text-fg-3">Density altitude <span className="num text-fg-2">{b.densityAltitude.toLocaleString()} ft</span></div>}
                {b.observed && <div className="text-xs text-fg-3">Observed {b.observed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>}
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ── Pilot currency ───────────────────────────────────────────────────────────
function PilotCard({ className }: { className?: string }) {
  const { data: flights, isLoading } = useFlights()
  const items = useMemo(() => (flights ? computeCurrency(flights) : []), [flights])
  const med = readMedical()
  const exp = medicalExpiry(med)
  const days = exp ? Math.floor((+exp - Date.now()) / 86_400_000) : null
  return (
    <Card className={className}>
      <CardHeader icon={<ShieldCheck />} title="Currency" description="FAA §61.56 · §61.57" action={<More to="/flying/pilot">Pilot</More>} />
      <CardBody className="space-y-0">
        {isLoading ? <Skeleton className="h-44" /> : (
          <ul className="divide-y divide-border">
            <li className="flex items-center justify-between gap-2 py-2.5 first:pt-0">
              <div className="min-w-0"><div className="text-sm font-medium">{MED_LABEL[med.cls]} medical</div><div className="text-xs text-fg-3">{exp ? `Valid through ${exp.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : 'No exam date'}</div></div>
              <StatusBadge state={days == null ? 'na' : days < 0 ? 'lapsed' : days < 60 ? 'expiring' : 'current'} />
            </li>
            {items.map(c => (
              <li key={c.key} className="flex items-center justify-between gap-2 py-2.5 last:pb-0">
                <div className="min-w-0"><div className="text-sm font-medium">{c.name}</div><div className="truncate text-xs text-fg-3">{c.detail}</div></div>
                <StatusBadge state={c.state} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

// ── Training ─────────────────────────────────────────────────────────────────
function TrainingCard({ className }: { className?: string }) {
  const { data: acts, isLoading, isError } = useActivities()
  const vol = useVolume(acts || [], 30)
  const recent = (acts || []).slice(0, 5)
  return (
    <Card className={className}>
      <CardHeader icon={<ActivityIcon />} title="Training" description="Last 30 days" action={<More to="/training">All activities</More>} />
      <CardBody>
        {isLoading ? <Skeleton className="h-60" /> : isError ? <p className="py-10 text-center text-sm text-fg-3">Activities are unavailable right now.</p> : (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <div className="min-w-0">
              <div className="mb-4 flex gap-8">
                <Stat size="sm" label="Time" value={vol.hours.toFixed(1)} unit="h" />
                <Stat size="sm" label="Sessions" value={vol.sessions} />
                <Stat size="sm" label="Load" value={Math.round((acts || []).filter(a => Date.now() - +new Date(a.startTimeLocal) < 30 * 864e5).reduce((s, a) => s + (a.activityTrainingLoad || 0), 0)) || null} />
              </div>
              <VolumeChart activities={acts || []} height={190} />
            </div>
            <div className="min-w-0 lg:border-l lg:border-border lg:pl-6">
              <div className="mb-2 text-sm font-medium text-fg-2">Recent</div>
              <ul className="space-y-1">
                {recent.map(a => {
                  const s = SPORTS[sportOf(a)]
                  return (
                    <li key={a.activityId}>
                      <Link to={`/training/${a.activityId}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in oklch, ${s.color} 14%, transparent)`, color: s.color }}><s.icon className="size-4" /></span>
                        <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{a.activityName || s.label}</div><div className="text-xs text-fg-3">{new Date(a.startTimeLocal).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div></div>
                        <span className="num text-sm text-fg-2">{hm(actDuration(a))}</span>
                      </Link>
                    </li>
                  )
                })}
                {!recent.length && <li className="text-sm text-fg-3">No activities yet</li>}
              </ul>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ── Money ────────────────────────────────────────────────────────────────────
function NetWorthCard({ className }: { className?: string }) {
  const { data: nw, isLoading } = useNetWorth(30)
  if (!isLoading && !nw) return (
    <Card className={className}>
      <CardHeader icon={<Landmark />} title="Net worth" />
      <CardBody><p className="text-sm text-fg-3">No financial data yet. <Link className="text-accent hover:underline" to="/money/connections">Connect an account</Link>.</p></CardBody>
    </Card>
  )
  const parts = nw ? [
    { label: 'Cash', v: nw.byType.liquid, color: 'var(--c1)' },
    { label: 'Investing', v: nw.byType.invested, color: 'var(--c3)' },
    { label: 'Retirement', v: nw.byType.retirement, color: 'var(--c7)' },
  ] : []
  const total = parts.reduce((s, p) => s + Math.max(0, p.v), 0) || 1
  const up = (nw?.delta || 0) >= 0
  return (
    <Card className={className}>
      <CardHeader icon={<Landmark />} title="Net worth" description="Linked accounts" action={<More to="/money">Money</More>} />
      <CardBody>
        {isLoading || !nw ? <Skeleton className="h-52" /> : (
          <>
            <div className="text-3xl font-semibold tracking-tight"><span className="num money">{dollars(nw.total)}</span></div>
            <div className={cn('mt-1 flex items-center gap-1 text-sm', up ? 'text-good' : 'text-bad')}>
              {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
              <span className="num money">{signed(nw.delta, v => dollars(v, { compact: true }))}</span><span className="text-fg-3">over 30 days</span>
            </div>
            <Sparkline values={nw.history.map(h => num(h.total))} width={320} height={64} color={up ? 'var(--good)' : 'var(--bad)'} className="mt-3 w-full money" />
            <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full">
              {parts.map(p => <div key={p.label} style={{ width: `${(Math.max(0, p.v) / total) * 100}%`, background: p.color }} />)}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {parts.map(p => (
                <div key={p.label} className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-fg-3"><span className="size-2 rounded-[2px]" style={{ background: p.color }} />{p.label}</div>
                  <div className="num money mt-0.5 truncate text-sm font-medium">{dollars(p.v, { compact: true })}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

// ── Logbook ──────────────────────────────────────────────────────────────────
function LogbookCard() {
  const { data: stats } = useLogbookStats()
  const { data: flights, isLoading } = useFlights()
  const last = flights?.[0]
  const ppl = useMemo(() => (flights ? pplProgress(flights) : []), [flights])
  const met = ppl.filter(r => r.have >= r.need).length
  return (
    <Card>
      <CardHeader icon={<BookOpen />} title="Logbook" description={stats ? `${stats.total_flights} flights · ${stats.airports_visited} airports` : undefined} action={<More to="/flying">Logbook</More>} />
      <CardBody>
        {isLoading ? <Skeleton className="h-40" /> : (
          <>
            <div className="flex items-end gap-8">
              <Stat label="Total time" value={num(stats?.total_hours).toFixed(1)} unit="h" size="lg" />
              <Stat label="Solo" value={num(stats?.solo).toFixed(1)} unit="h" size="sm" />
              <Stat label="Night" value={num(stats?.night).toFixed(1)} unit="h" size="sm" />
            </div>
            {ppl.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-sm"><span className="text-fg-2">Private pilot minimums</span><span className="num text-fg-3">{met}/{ppl.length} met</span></div>
                <Progress value={(met / ppl.length) * 100} />
              </div>
            )}
            {last && (
              <Link to={`/flying/${last.id}`} className="-mx-2 mt-4 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-fg-3">Last flight · {calDate(last.date, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                  <div className="num truncate text-sm font-medium">{route(last).join(' → ')}</div>
                </div>
                <Badge>{trainingLabel(last.training_type)}</Badge>
                <span className="num text-sm text-fg-2">{num(last.total_duration).toFixed(1)}h</span>
              </Link>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}

// ── Chess ────────────────────────────────────────────────────────────────────
function ChessCard() {
  const { data: c, isLoading, isError } = useChess()
  const tm = c?.rapid.thisMonth
  const delta = tm?.ratingEnd != null && tm.ratingStart != null ? tm.ratingEnd - tm.ratingStart : null
  return (
    <Card>
      <CardHeader icon={<Crown />} title="Chess" description={c ? `chess.com · ${c.username}` : 'chess.com'} action={<More to="/chess">Chess</More>} />
      <CardBody>
        {isLoading ? <Skeleton className="h-40" /> : isError || !c ? <p className="py-8 text-center text-sm text-fg-3">chess.com is unavailable right now.</p> : (
          <>
            <div className="flex items-end justify-between gap-4">
              <Stat label="Rapid" value={c.rapid.current} size="lg" sub={delta != null ? <span className={delta >= 0 ? 'text-good' : 'text-bad'}>{signed(delta)} this month</span> : 'No rated games this month'} />
              <Sparkline values={c.rapid.recent.map(g => g.rating)} width={140} height={48} color="var(--accent)" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-sm">
              <Stat size="sm" label="Blitz" value={c.blitz.current} />
              <Stat size="sm" label="Puzzles best" value={c.tactics.highest} />
              <Stat size="sm" label="Month" value={tm ? `${tm.win}–${tm.loss}–${tm.draw}` : null} sub="W–L–D" />
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

// ── Mail ─────────────────────────────────────────────────────────────────────
function MailCard({ className }: { className?: string }) {
  const { data: boot, isLoading: bootLoading } = useMailBoot()
  const split = !!(boot?.configured && boot.settings?.splitInbox)
  const threads = useQuery({
    queryKey: ['mail', 'threads', 'today-preview', split],
    enabled: !!boot?.configured,
    queryFn: () => mail<{ threads: ThreadRow[]; total: number }>(`/threads?folder=inbox&position=0&limit=5${split ? '&tab=important' : ''}`),
    staleTime: 60_000,
  })
  const n = unreadCount(boot)
  return (
    <Card className={className}>
      <CardHeader icon={<Inbox />} title="Inbox" description={boot?.configured ? `${n ? `${n} unread · ` : ''}${boot.address}` : undefined} action={<More to="/mail">Mail</More>} />
      <CardBody className="px-3">
        {bootLoading || threads.isLoading ? <div className="px-2"><Skeleton className="h-40" /></div> : !boot?.configured ? <p className="px-2 text-sm text-fg-3">Mail isn’t set up on this server.</p> : !threads.data?.threads.length ? (
          <p className="px-2 py-6 text-center text-sm text-fg-3">Inbox zero.</p>
        ) : (
          <ul>
            {threads.data.threads.map(t => (
              <li key={t.threadId}>
                <Link to={`/mail/inbox/${encodeURIComponent(t.threadId)}`} className="flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-hover">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', t.unread ? 'bg-accent' : 'bg-transparent')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={cn('truncate text-sm', t.unread ? 'font-semibold' : 'text-fg-2')}>{t.participants.join(', ') || '(unknown)'}</span>
                      {t.hasAttachment && <Paperclip className="size-3 shrink-0 text-fg-3" />}
                      <span className="ml-auto shrink-0 text-xs text-fg-3">{mailDate(t.date)}</span>
                    </div>
                    <div className={cn('truncate text-sm', t.unread ? 'text-fg' : 'text-fg-3')}>{t.subject}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}


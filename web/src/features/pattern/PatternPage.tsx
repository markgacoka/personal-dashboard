import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, ChevronRight, CircleCheck, CircleX, FileText, ListChecks, Map as MapIcon, PlaneLanding, RotateCcw, Shuffle, Trophy } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress, Segmented, Switch } from '@/components/ui/misc'
import { PageHeader } from '@/components/data/stat'
import { cn } from '@/lib/utils'
import { AIRPORTS, type Airport } from './airports'
import { bearing, compass8, dist, findEnd, legAt, rankEnds, sampleAt, type Pt, type Sample } from './geo'
import { atHeading, atPoint, flyTrack, grade, type Scenario, type Step } from './model'
import { SCENARIOS } from './scenarios'
import { makeDrill } from './drill'
import { Scene, type CandState, type Candidate } from './Scene'
import { FieldView } from './Field'
import { SideView } from './Profile'
import { WindowView } from './Window'
import type { RunwayPick } from './art'
import { Instruments } from './Instruments'
import { InfoCard, RadioPanel } from './Info'
import { LETTERS, Quiz } from './Quiz'
import { AnyAirportCard, markVisited, randomAirport, UsLoading, useUsScenario, type Filters } from './UsAirports'

interface Prefs { autoplay: boolean; hideText: boolean }
type Scores = Record<string, { best: number; total: number; at: string }>

function useStored<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); return s ? { ...init, ...JSON.parse(s) } : init } catch { return init } })
  const set = (next: T) => { setV(next); try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* per-browser only */ } }
  return [v, set] as const
}

export default function PatternPage() {
  const { scenario, id } = useParams()
  const [prefs, setPrefs] = useStored<Prefs>('pattern-prefs', { autoplay: true, hideText: false })
  if (id) return <UsArrival key={id} id={id.toUpperCase()} prefs={prefs} setPrefs={setPrefs} />
  return <Curated scenario={scenario} prefs={prefs} setPrefs={setPrefs} />
}

function UsArrival({ id, prefs, setPrefs }: { id: string; prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  const { rec, cond, sc, mode, again } = useUsScenario(id)
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  if (!sc) return <UsLoading id={id} rec={rec.data} mode={mode} error={(rec.error as Error | null)?.message} />
  const next = async () => {
    setBusy(true)
    try {
      let f: Filters = { scope: 'public', tower: 'any', near: '0', state: '', wx: 'live' }
      try { f = { ...f, ...JSON.parse(localStorage.getItem('pattern-filters') || '{}') } } catch { /* defaults */ }
      navigate(`/flying/pattern/us/${(await randomAirport(f)).id}?wx=${mode}`)
    } finally { setBusy(false) }
  }
  return (
    <Runner key={String(cond.dataUpdatedAt)} sc={sc} prefs={prefs} setPrefs={setPrefs}
      onFinish={score => markVisited(rec.data!.id, score, sc.steps.length)} onAgain={again}
      actions={<><Button variant="primary" onClick={next} loading={busy}><Shuffle />Next airport</Button><Button onClick={again}><RotateCcw />Same airport, new conditions</Button></>} />
  )
}

function Curated({ scenario, prefs, setPrefs }: { scenario?: string; prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  const [scores, setScores] = useStored<Scores>('pattern-scores', {})
  const [drillSeed, setDrillSeed] = useState(0)
  const sc = useMemo(() => scenario === 'drill' ? makeDrill() : SCENARIOS.find(s => s.id === scenario), [scenario, drillSeed])
  if (!scenario || !sc) return <Library scores={scores} prefs={prefs} setPrefs={setPrefs} />
  return (
    <Runner key={`${sc.id}-${drillSeed}`} sc={sc} prefs={prefs} setPrefs={setPrefs}
      onFinish={score => { if (sc.id !== 'drill') setScores({ ...scores, [sc.id]: { best: Math.max(score, scores[sc.id]?.best ?? 0), total: sc.steps.length, at: new Date().toISOString() } }) }}
      onAgain={() => setDrillSeed(s => s + 1)} />
  )
}

function Library({ scores, prefs, setPrefs }: { scores: Scores; prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  return (
    <div>
      <PageHeader title="Pattern trainer" description="Fly an arrival one decision at a time, from preflight to rollout, at any airport in the United States or in hand-built Bay Area scenarios." />
      <HowItWorks prefs={prefs} setPrefs={setPrefs} />
      <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
        <AnyAirportCard />
        {SCENARIOS.map(sc => <ScenarioCard key={sc.id} sc={sc} score={scores[sc.id]} />)}
        <DrillCard />
      </div>
      <p className="mt-6 max-w-4xl text-sm text-fg-3">“Any US airport” uses the FAA NASR subscription (refreshed every 28-day cycle) with live METARs and NOTAMs or generated weather; generated traffic and windsock shifts are for practice. The hand-built scenarios use AirNav data checked Oct 16, 2026, with invented NOTAMs, TFRs, weather and traffic. Training aid only: verify against the current Chart Supplement and your POH.</p>
    </div>
  )
}

const HOW: { icon: typeof MapIcon; title: string; body: string }[] = [
  { icon: FileText, title: '1 · Read the situation', body: 'Where you are, what you hear on the radio and the documents you would have: Chart Supplement, NOTAMs, ForeFlight.' },
  { icon: MapIcon, title: '2 · Look at the three views', body: 'The map shows you, traffic and hazards. The field view shows runways, closures, the pattern and the windsock. The side view shows your altitude against pattern altitude.' },
  { icon: ListChecks, title: '3 · Make the call', body: 'Answer in the panel, or tap a lettered path or a runway end on the drawing.' },
  { icon: PlaneLanding, title: '4 · Watch it flown', body: 'The airplane flies the correct action while the map names each leg and the side view traces the altitude. Replay it as often as you like.' },
]

function HowItWorks({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  return (
    <Card className="mb-5">
      <CardBody className="grid gap-6 pt-5 sm:grid-cols-2 xl:grid-cols-4 sm:pt-6">
        {HOW.map(h => (
          <div key={h.title} className="flex gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-pill text-fg-2"><h.icon className="size-4" /></div>
            <div><div className="text-sm font-medium text-fg">{h.title}</div><p className="mt-1 text-sm leading-relaxed text-fg-3">{h.body}</p></div>
          </div>
        ))}
      </CardBody>
      <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-white/[0.06] px-5 py-4 text-sm text-fg-2 sm:px-6">
        <label className="flex items-center gap-3"><Switch checked={prefs.autoplay} onCheckedChange={v => setPrefs({ ...prefs, autoplay: v })} />Play radio automatically</label>
        <label className="flex items-center gap-3"><Switch checked={prefs.hideText} onCheckedChange={v => setPrefs({ ...prefs, hideText: v })} />Listen only: hide transcripts until played</label>
      </div>
    </Card>
  )
}

function ScenarioCard({ sc, score }: { sc: Scenario; score?: Scores[string] }) {
  const ap = AIRPORTS[sc.airport]
  const best = sc.wind.spd ? rankEnds(ap.runways, sc.wind)[0].e.ident : undefined
  return (
    <Link to={`/flying/pattern/${sc.id}`} title={sc.blurb} className="press group block overflow-hidden rounded-xl bg-card ring-1 ring-inset ring-white/[0.04] hover:ring-white/[0.12] active:scale-[0.99]">
      <FieldView ap={ap} wind={sc.wind} pattern={best} compact className="h-32" />
      <div className="space-y-2 px-5 py-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-base font-medium leading-snug text-fg">{sc.title}</div>
            <div className="text-sm text-fg-3"><span className="num">{ap.icao}</span> · {sc.steps.length} decisions{score && <> · <span className={cn('num', score.best === score.total ? 'text-good' : 'text-fg-2')}>best {score.best}/{score.total}</span></>}</div>
          </div>
          <ChevronRight className="mt-1 size-4 shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
        </div>
        <div className="flex flex-wrap gap-1.5">{sc.tags.map(t => <Badge key={t}>{t}</Badge>)}</div>
      </div>
    </Link>
  )
}

function DrillCard() {
  return (
    <Link to="/flying/pattern/drill" className="press group flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-inset ring-white/[0.04] hover:ring-white/[0.12] active:scale-[0.99]">
      <div className="grid h-32 place-items-center" style={{ background: 'radial-gradient(100% 100% at 50% 50%, #141a16 0%, #0f1311 80%)' }}><Shuffle className="size-8 text-fg-3" /></div>
      <div className="flex items-start gap-2 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium text-fg">Entry drill</div>
          <div className="text-sm text-fg-3">Endless random arrivals: runway, downwind, position, entry</div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
      </div>
    </Link>
  )
}

function Runner({ sc, prefs, setPrefs, onFinish, onAgain, actions }: { sc: Scenario; prefs: Prefs; setPrefs: (p: Prefs) => void; onFinish: (score: number) => void; onAgain: () => void; actions?: React.ReactNode }) {
  const ap = sc.ap ?? AIRPORTS[sc.airport]
  const [i, setI] = useState(0)
  const [results, setResults] = useState<boolean[]>([])
  const done = i >= sc.steps.length
  useEffect(() => { if (done) onFinish(results.filter(Boolean).length) }, [done])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }, [i])
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start gap-x-4 gap-y-3">
        <Button asChild variant="ghost" size="icon-sm" className="mt-0.5"><Link to="/flying/pattern" aria-label="All scenarios"><ArrowLeft /></Link></Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-medium sm:text-2xl">{sc.title}</h1>
          <p className="mt-0.5 text-sm text-fg-3">
            <span className="num text-fg-2">{ap.icao}</span> · {ap.city ?? ap.name} · {ap.towered ? 'Towered' : 'Non-towered'} · field <span className="num">{ap.elev.toLocaleString()}</span> ft · pattern <span className="num">{ap.tpa.toLocaleString()}</span> ft MSL
            {sc.source && <span className="block">{sc.source}</span>}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-2"><Switch checked={prefs.hideText} onCheckedChange={v => setPrefs({ ...prefs, hideText: v })} />Listen only</label>
      </div>
      <PhaseTrack steps={sc.steps} i={i} results={results} />
      {done ? <Results sc={sc} results={results} actions={actions} onRestart={() => { setResults([]); setI(0); if (sc.id === 'drill') onAgain() }} /> : (
        <StepView key={i} ap={ap} sc={sc} step={sc.steps[i]} index={i} prefs={prefs}
          onAnswer={ok => setResults(r => { const x = r.slice(); x[i] = ok; return x })}
          onNext={() => setI(i + 1)} last={i === sc.steps.length - 1} />
      )}
    </div>
  )
}

// The arrival as a strip of phases; each step is a segment coloured by your answer.
function PhaseTrack({ steps, i, results }: { steps: Step[]; i: number; results: boolean[] }) {
  const groups: { phase: string; idx: number[] }[] = []
  steps.forEach((s, k) => { const g = groups[groups.length - 1]; if (g && g.phase === s.phase) g.idx.push(k); else groups.push({ phase: s.phase, idx: [k] }) })
  return (
    <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      {groups.map((g, gi) => {
        const current = g.idx.includes(i)
        return (
          <div key={gi} className={cn('min-w-0', current ? 'shrink-0' : 'min-w-6')} style={{ flex: `${g.idx.length} 1 0` }}>
            <div className="flex gap-1">
              {g.idx.map(k => <div key={k} title={`${k + 1}. ${steps[k].title}`} className={cn('h-1.5 flex-1 rounded-full transition-colors duration-300', results[k] === true ? 'bg-good' : results[k] === false ? 'bg-bad' : k === i ? 'bg-fg' : 'bg-white/[0.12]')} />)}
            </div>
            <div className={cn('mt-1.5 hidden truncate text-xs sm:block', current ? 'font-medium text-fg' : 'text-fg-3')}>{g.phase}</div>
          </div>
        )
      })}
    </div>
  )
}

function useProgress(track: Sample[] | null, key: number) {
  const [p, setP] = useState(0)
  useEffect(() => {
    if (!track || track.length < 2) return
    setP(0)
    const dur = Math.min(14000, Math.max(4000, track[track.length - 1].s * 1500))
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => { const f = Math.min(1, (now - t0) / dur); setP(f * f * (3 - 2 * f) * 0.15 + f * 0.85); if (f < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [track, key])
  return p
}

function StepView({ ap, sc, step, index, prefs, onAnswer, onNext, last }: { ap: Airport; sc: Scenario; step: Step; index: number; prefs: Prefs; onAnswer: (ok: boolean) => void; onNext: () => void; last: boolean }) {
  const q = step.q
  const [picked, setPicked] = useState<string[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [replay, setReplay] = useState(0)
  const correct = submitted && grade(q, picked)
  const start = useMemo(() => ({ p: atPoint(ap, step.at), alt: step.alt }), [ap, step])
  const hdg0 = atHeading(ap, step)
  const options = q.kind === 'order' ? [] : q.options
  const answerIds = q.kind === 'choice' ? [q.answer] : q.kind === 'multi' ? q.answer : []
  const hidden = !!step.hideOwnship && !submitted

  const candTracks = useMemo(() => options.map((o, k) => o.fly ? { id: o.id, letter: LETTERS[k], track: flyTrack(ap, o.fly, start) } : null).filter(Boolean) as Omit<Candidate, 'state'>[], [ap, options, start])
  const stateOf = (id: string): CandState => submitted ? (answerIds.includes(id) ? 'right' : picked.includes(id) ? 'wrong' : 'dim') : picked.includes(id) ? 'picked' : hover === id ? 'hover' : 'idle'
  const candidates: Candidate[] = submitted && step.after?.fly ? [] : candTracks.map(c => ({ ...c, state: stateOf(c.id) }))
  const rwyOpts = options.filter(o => o.rwy)
  const runwayPick: RunwayPick | undefined = rwyOpts.length ? {
    state: Object.fromEntries(rwyOpts.map(o => [o.rwy!, stateOf(o.id)])),
    onPick: (ident: string) => { const o = rwyOpts.find(o => o.rwy === ident); if (o && !submitted) setPicked([o.id]) },
    onHover: (ident: string | null) => setHover(rwyOpts.find(o => o.rwy === ident)?.id ?? null),
  } : undefined

  const flight = useMemo(() => submitted && step.after?.fly ? flyTrack(ap, step.after.fly, start) : null, [submitted, ap, step, start])
  const progress = useProgress(flight, replay)
  const own: Sample = flight ? sampleAt(flight, progress) : { ...start, hdg: hdg0, s: 0 }
  const trail = flight ? flight.filter(s => s.s <= own.s) : undefined
  const trend = flight ? Math.sign(Math.round((sampleAt(flight, Math.min(1, progress + 0.02)).alt - own.alt) / 5)) as -1 | 0 | 1 : 0
  const flying = flight != null && progress < 1
  const fly = step.after?.fly
  const flightRwy = fly && 'rwy' in fly ? fly.rwy : fly && 'circuit' in fly ? fly.circuit : step.scene?.pattern
  const flightEnd = flightRwy ? findEnd(ap.runways, flightRwy) : null
  const patternRwy = step.scene?.pattern ?? (submitted ? flightRwy : undefined)

  const focus = useMemo<Pt[]>(() => {
    const pts: Pt[] = dist(start.p, [0, 0]) <= 30 && !step.hideOwnship ? [start.p] : []
    for (const c of candTracks) pts.push(...c.track.filter((_, k) => k % 8 === 0).map(s => s.p))
    if (flight) pts.push(...flight.filter((_, k) => k % 8 === 0).map(s => s.p))
    for (const tr of step.scene?.traffic ?? []) if (tr.from) { const p = atPoint(ap, tr.from); if (dist(p, [0, 0]) < 8) pts.push(p) }
    for (const z of step.scene?.zones ?? []) { const p = atPoint(ap, z.at); if (dist(p, [0, 0]) < 30) pts.push([p[0] - z.r, p[1] - z.r], [p[0] + z.r, p[1] + z.r]) }
    return pts
  }, [start, candTracks, flight, step, ap])

  const txs = useMemo(() => [...(step.radio ?? []), ...(submitted ? step.after?.radio ?? [] : [])], [step, submitted])
  const wind = step.wind ?? sc.wind
  const sock = step.sock ?? wind
  const infos = step.info ?? []
  const [tab, setTab] = useState(0)
  const submit = () => { setSubmitted(true); onAnswer(grade(q, picked)) }

  const caption = flight ? (
    <Chip tone={flying ? 'live' : 'done'}>
      {flying ? <><span className="font-medium text-fg">{flightEnd ? legAt(flightEnd, own, ap.elev) : 'Inbound'}</span><span className="num text-fg-2">{(Math.round(own.alt / 10) * 10).toLocaleString()} ft {trend < 0 ? '↓' : trend > 0 ? '↑' : ''}</span></> : <span className="text-fg">The correct action, flown</span>}
    </Chip>
  ) : candTracks.length && !submitted ? <Chip>Each lettered path is an answer. Tap one to choose it.</Chip>
    : runwayPick && !submitted ? <Chip>Choose a runway: tap its end in the field view, or pick below.</Chip>
    : hidden ? null
    : <Chip><span className="num text-fg">{where(ap, own)}</span></Chip>

  return (
    <div className="grid gap-5 xl:grid-cols-12 xl:items-start">
      <div className="contents xl:sticky xl:top-20 xl:col-span-7 xl:flex xl:h-[calc(100dvh-6.5rem)] xl:min-h-[38rem] xl:flex-col xl:gap-4">
        <Card className="order-1 overflow-hidden xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
          <Scene ap={ap} wind={wind} sock={step.sock} pattern={patternRwy} closed={step.scene?.closed} zones={step.scene?.zones} traffic={step.scene?.traffic}
            own={{ s: own, trail, ahead: flying ? flight!.filter(s => s.s > own.s) : undefined, hidden, gs: flight ? 0 : step.gs }}
            candidates={candidates} focus={focus} runwayPick={runwayPick} caption={caption}
            onCandidate={id => !submitted && setPicked([id])} onHoverCandidate={setHover}
            className="h-[21rem] sm:h-[26rem] xl:h-auto xl:min-h-[15rem] xl:flex-1">
            {flight && !flying && <button onClick={() => setReplay(r => r + 1)} className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-fg px-3.5 text-sm font-medium text-bg"><RotateCcw className="size-4" />Replay</button>}
          </Scene>
          <Instruments s={own} gs={step.gs} icao={ap.icao} trend={trend} hidden={hidden} className="border-t border-white/[0.06]" />
        </Card>
        <Card className="order-3 overflow-hidden xl:shrink-0">
          <div className="grid md:grid-cols-2">
            <FieldView ap={ap} pattern={patternRwy} wind={wind} sock={sock} closed={step.scene?.closed} pick={runwayPick} className="h-56 border-b border-white/[0.06] md:border-b-0 md:border-r 2xl:h-64" />
            {step.lights
              ? <WindowView lights={step.lights} rwy={patternRwy ?? ''} className="h-56 2xl:h-64" />
              : <SideView ap={ap} own={own} flight={flight} end={flightEnd} hidden={hidden} className="h-56 2xl:h-64" />}
          </div>
        </Card>
      </div>

      <Card className="order-2 xl:col-span-5">
        <div className="px-5 pt-5 sm:px-6">
          <div className="flex items-center gap-2 text-sm text-fg-3">
            <Badge tone="accent">{step.phase}</Badge>
            <span className="num">Step {index + 1} of {sc.steps.length}</span>
            {step.time && <span className="num">· {step.time} local</span>}
          </div>
          <h2 className="mt-2 text-xl font-medium">{step.title}</h2>
          <p className="mt-2 text-base leading-relaxed text-fg-2">{step.situation}</p>
        </div>
        <CardBody className="mt-5 space-y-6">
          {step.com && (
            <div className="flex flex-wrap gap-2">
              {step.com.filter(Boolean).map((c, k) => <span key={k} className="inline-flex items-center gap-2 rounded-full bg-sunken px-3 py-1.5 text-sm"><span className="text-xs text-fg-3">COM {k + 1}</span><span className="num font-mono text-fg">{c}</span></span>)}
            </div>
          )}
          <RadioPanel txs={txs} autoplay={prefs.autoplay} hideText={prefs.hideText} />
          {infos.length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-2"><FileText className="size-4 text-fg-3" /><span className="text-sm font-medium text-fg">What you have in the cockpit</span></div>
              {infos.length > 1 && <Segmented size="sm" className="mb-3" value={String(Math.min(tab, infos.length - 1))} onChange={v => setTab(Number(v))} options={infos.map((inf, k) => ({ value: String(k), label: inf.title }))} />}
              {infos.length === 1 && <div className="mb-2 text-sm text-fg-3">{infos[0].title}</div>}
              <InfoCard info={infos[Math.min(tab, infos.length - 1)]} ap={ap} reveal={submitted} />
            </div>
          )}
          <div className="border-t border-white/[0.06] pt-6">
            <Quiz q={q} picked={picked} setPicked={setPicked} submitted={submitted} correct={correct} hover={hover} setHover={setHover} />
          </div>
        </CardBody>
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex items-center gap-3 rounded-b-xl border-t border-white/[0.06] bg-card/90 px-5 py-3.5 backdrop-blur-xl sm:px-6 lg:bottom-0">
          {!submitted ? <>
            <span className="mr-auto text-sm text-fg-3">{picked.length ? (q.kind === 'order' ? `${picked.length} of ${q.items.length} in order` : 'Ready when you are') : q.kind === 'order' ? 'Build the sequence' : 'Choose an answer'}</span>
            <Button variant="primary" onClick={submit} disabled={!picked.length}>Check answer</Button>
          </> : <>
            <span className={cn('mr-auto inline-flex items-center gap-1.5 text-sm font-medium', correct ? 'text-good' : 'text-bad')}>{correct ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}{correct ? 'Correct' : 'Not quite'}{flying && <span className="font-normal text-fg-3"> · watch the map</span>}</span>
            <Button variant="primary" onClick={onNext}>{last ? 'See results' : 'Next step'}<ChevronRight /></Button>
          </>}
        </div>
      </Card>
    </div>
  )
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'live' | 'done' }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 text-sm text-fg-2 backdrop-blur">
      {tone === 'live' && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-[#5eb0ff] opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-[#5eb0ff]" /></span>}
      {tone === 'done' && <CircleCheck className="size-4 text-good" />}
      <span className="flex min-w-0 items-center gap-2 truncate">{children}</span>
    </span>
  )
}

// "6.2 nm northeast of KWVI · 3,500 ft" — where you are, in words.
function where(ap: Airport, s: Sample) {
  const d = dist(s.p, [0, 0])
  const alt = `${(Math.round(s.alt / 10) * 10).toLocaleString()} ft`
  if (d < 0.6) return `Over ${ap.icao} · ${alt}`
  return `${d.toFixed(1)} nm ${compass8(bearing([0, 0], s.p))} of ${ap.icao} · ${alt}`
}

function Results({ sc, results, onRestart, actions }: { sc: Scenario; results: boolean[]; onRestart: () => void; actions?: React.ReactNode }) {
  const score = results.filter(Boolean).length
  const phases = [...new Set(sc.steps.map(s => s.phase))].map(p => {
    const idx = sc.steps.map((s, k) => [s, k] as const).filter(([s]) => s.phase === p).map(([, k]) => k)
    return { p, ok: idx.filter(k => results[k]).length, n: idx.length }
  })
  return (
    <div className="grid gap-5 xl:grid-cols-12">
      <Card className="xl:col-span-5">
        <CardHeader icon={<Trophy />} title={`${score} of ${sc.steps.length} correct on the first try`} description={score === sc.steps.length ? 'Clean arrival.' : 'Review the steps you missed, then fly it again.'} />
        <CardBody className="space-y-3">
          {phases.map(ph => (
            <div key={ph.p} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 text-fg-2">{ph.p}</span>
              <Progress value={(ph.ok / ph.n) * 100} tone={ph.ok === ph.n ? 'good' : ph.ok ? 'warn' : 'bad'} />
              <span className="num w-10 shrink-0 text-right text-fg-2">{ph.ok}/{ph.n}</span>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            {actions ?? <Button variant="primary" onClick={onRestart}><RotateCcw />{sc.id === 'drill' ? 'New drill' : 'Fly it again'}</Button>}
            <Button asChild><Link to="/flying/pattern">All scenarios</Link></Button>
          </div>
        </CardBody>
      </Card>
      <Card className="xl:col-span-7">
        <CardHeader title="Your decisions" />
        <CardBody>
          <ol className="divide-y divide-border">
            {sc.steps.map((s, k) => (
              <li key={k} className="flex items-start gap-3 py-2.5">
                <span className={cn('mt-1 size-2.5 shrink-0 rounded-full', results[k] ? 'bg-good' : 'bg-bad')} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-fg">{s.title} <span className="font-normal text-fg-3">· {s.phase}</span></div>
                  {!results[k] && <p className="mt-0.5 text-sm text-fg-3">{s.q.why}</p>}
                </div>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, ChevronRight, ListChecks, PlaneLanding, RotateCcw, Shuffle, Trophy } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress, Switch } from '@/components/ui/misc'
import { PageHeader } from '@/components/data/stat'
import { cn } from '@/lib/utils'
import { WindCompass } from '@/features/flying/WindCompass'
import { AIRPORTS, type Airport } from './airports'
import { components, dist, findEnd, fmtHdg, rankEnds, sampleAt, type Pt, type Sample, type Wind } from './geo'
import { atHeading, atPoint, flyTrack, grade, type Scenario, type Step } from './model'
import { SCENARIOS } from './scenarios'
import { makeDrill } from './drill'
import { AirportDiagram, Scene, Windsock, type CandState, type Candidate } from './Scene'
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
      <PageHeader title="Pattern trainer" description="Any airport in the United States from the FAA’s own data, plus hand-built Bay Area scenarios. Make the call at each point of the arrival, from preflight to rollout." />
      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        <AnyAirportCard />
        {SCENARIOS.map(sc => <ScenarioCard key={sc.id} sc={sc} score={scores[sc.id]} />)}
        <Card className="flex flex-col">
          <CardHeader icon={<Shuffle />} title="Entry drill" description="Endless random arrivals: a random airport, wind and position. Pick the runway, find the downwind, place yourself, choose the entry and the heading." />
          <CardBody className="mt-auto"><Button asChild variant="primary"><Link to="/flying/pattern/drill">Start a drill<ChevronRight /></Link></Button></CardBody>
        </Card>
        <Card>
          <CardHeader icon={<ListChecks />} title="How it works" />
          <CardBody className="space-y-3 text-sm text-fg-2">
            <p>Each step shows the map, your instruments, the radio, and the documents you would actually have (Chart Supplement, NOTAMs, TFRs, ForeFlight). Answer, then watch the airplane fly the correct action.</p>
            <p>On the map, click a lettered path or a runway end to answer. The windsock panel shows the wind at the runway, which isn’t always what the AWOS said.</p>
            <label className="flex items-center justify-between gap-3"><span>Play radio automatically</span><Switch checked={prefs.autoplay} onCheckedChange={v => setPrefs({ ...prefs, autoplay: v })} /></label>
            <label className="flex items-center justify-between gap-3"><span>Listen only (hide transcripts until played)</span><Switch checked={prefs.hideText} onCheckedChange={v => setPrefs({ ...prefs, hideText: v })} /></label>
            <p className="text-fg-3">“Any US airport” uses the FAA NASR subscription (refreshed every 28-day cycle) with live METARs and NOTAMs or generated weather; the generated traffic and windsock shifts are for practice. The hand-built scenarios use AirNav data checked Oct 16, 2026, with invented NOTAMs, TFRs, weather and traffic. Training aid only: verify against the current Chart Supplement and your POH.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function ScenarioCard({ sc, score }: { sc: Scenario; score?: Scores[string] }) {
  const ap = AIRPORTS[sc.airport]
  const best = sc.wind.spd ? rankEnds(ap.runways, sc.wind)[0].e.ident : null
  const runways = ap.runways.map(r => ({ le_ident: r.ends[0], le_hdg: r.hdg, he_ident: r.ends[1], he_hdg: (r.hdg + 180) % 360, length_ft: r.lengthFt }))
  return (
    <Card className="flex flex-col">
      <CardHeader title={sc.title} description={<span><span className="num">{ap.icao}</span> · {ap.name} · {sc.steps.length} decisions</span>} />
      <CardBody className="flex flex-1 flex-col gap-4">
        <div className="flex items-center gap-4">
          <WindCompass wdir={sc.wind.spd ? sc.wind.dir : null} wspd={sc.wind.spd} wgst={sc.wind.gust ?? null} runways={runways} best={best} size={140} />
          <p className="text-sm leading-relaxed text-fg-2">{sc.blurb}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">{sc.tags.map(t => <Badge key={t}>{t}</Badge>)}</div>
        <div className="mt-auto flex items-center gap-3">
          <Button asChild variant="primary"><Link to={`/flying/pattern/${sc.id}`}>{score ? 'Fly again' : 'Start'}<ChevronRight /></Link></Button>
          {score && <div className="flex flex-1 items-center gap-2"><Progress value={(score.best / score.total) * 100} tone={score.best === score.total ? 'good' : 'accent'} /><span className="num shrink-0 text-sm text-fg-2">Best {score.best}/{score.total}</span></div>}
        </div>
      </CardBody>
    </Card>
  )
}

function Runner({ sc, prefs, setPrefs, onFinish, onAgain, actions }: { sc: Scenario; prefs: Prefs; setPrefs: (p: Prefs) => void; onFinish: (score: number) => void; onAgain: () => void; actions?: React.ReactNode }) {
  const ap = sc.ap ?? AIRPORTS[sc.airport]
  const [i, setI] = useState(0)
  const [results, setResults] = useState<boolean[]>([])
  const done = i >= sc.steps.length
  const navigate = useNavigate()
  useEffect(() => { if (done) onFinish(results.filter(Boolean).length) }, [done])
  return (
    <div>
      <PageHeader
        title={sc.title}
        description={<span><span className="num">{ap.icao}</span> · {ap.city ?? ap.name} · {ap.towered ? 'Towered' : 'Non-towered'} · elevation <span className="num">{ap.elev.toLocaleString()}</span> ft · pattern <span className="num">{ap.tpa.toLocaleString()}</span> MSL{sc.source && <span className="block text-sm">{sc.source}</span>}</span>}
        actions={<>
          <label className="hidden items-center gap-2 text-sm text-fg-2 sm:flex"><Switch checked={prefs.hideText} onCheckedChange={v => setPrefs({ ...prefs, hideText: v })} />Listen only</label>
          <Button variant="ghost" size="sm" onClick={() => navigate('/flying/pattern')}><ArrowLeft />All scenarios</Button>
        </>}
      />
      <Stepper steps={sc.steps} i={i} results={results} />
      {done ? <Results sc={sc} results={results} actions={actions} onRestart={() => { setResults([]); setI(0); if (sc.id === 'drill') onAgain() }} /> : (
        <StepView key={i} ap={ap} sc={sc} step={sc.steps[i]} index={i} prefs={prefs}
          onAnswer={ok => setResults(r => { const x = r.slice(); x[i] = ok; return x })}
          onNext={() => setI(i + 1)} last={i === sc.steps.length - 1} />
      )}
    </div>
  )
}

function Stepper({ steps, i, results }: { steps: Step[]; i: number; results: boolean[] }) {
  return (
    <div className="mb-5">
      <div className="flex gap-1">
        {steps.map((s, k) => (
          <div key={k} title={`${k + 1}. ${s.title}`} className={cn('h-1.5 flex-1 rounded-full transition-colors duration-300',
            results[k] === true ? 'bg-good' : results[k] === false ? 'bg-bad' : k === i ? 'bg-accent' : 'bg-border')} />
        ))}
      </div>
      {i < steps.length && <div className="mt-2 flex items-center gap-2 text-sm text-fg-3"><Badge tone="accent">{steps[i].phase}</Badge><span className="num">Step {i + 1} of {steps.length}</span>{steps[i].time && <span className="num">· {steps[i].time} local</span>}</div>}
    </div>
  )
}

function useProgress(track: Sample[] | null, key: number) {
  const [p, setP] = useState(0)
  useEffect(() => {
    if (!track || track.length < 2) return
    setP(0)
    const dur = Math.min(11000, Math.max(3500, track[track.length - 1].s * 1300))
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

  const candTracks = useMemo(() => options.map((o, k) => o.fly ? { id: o.id, letter: LETTERS[k], track: flyTrack(ap, o.fly, start) } : null).filter(Boolean) as Omit<Candidate, 'state'>[], [ap, options, start])
  const stateOf = (id: string): CandState => submitted ? (answerIds.includes(id) ? 'right' : picked.includes(id) ? 'wrong' : 'dim') : picked.includes(id) ? 'picked' : hover === id ? 'hover' : 'idle'
  const candidates: Candidate[] = submitted && step.after?.fly ? [] : candTracks.map(c => ({ ...c, state: stateOf(c.id) }))
  const rwyOpts = options.filter(o => o.rwy)
  const runwayPick = rwyOpts.length ? {
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

  const focus = useMemo<Pt[]>(() => {
    const far = dist(start.p, [0, 0]) > 8 && !candTracks.length && !flight
    const pts: Pt[] = far ? [] : [start.p]
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

  return (
    <div className="grid gap-5 xl:grid-cols-12">
      <Card className="self-start overflow-hidden xl:sticky xl:top-4 xl:col-span-7">
        <Scene ap={ap} sock={sock} pattern={step.scene?.pattern} zones={step.scene?.zones} traffic={step.scene?.traffic}
          own={{ s: own, trail, ahead: flying ? flight!.filter(s => s.s > own.s) : undefined, hidden: step.hideOwnship && !submitted }}
          candidates={candidates} focus={focus} runwayPick={runwayPick}
          onCandidate={id => !submitted && setPicked([id])} onHoverCandidate={setHover}
          className="h-[360px] rounded-none border-0 border-b sm:h-[440px] 2xl:h-[520px]" />
        <Instruments s={own} gs={step.gs} icao={ap.icao} com={step.com} trend={trend} hidden={step.hideOwnship && !submitted} />
        <div className="grid gap-5 border-t border-border px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm"><span className="font-medium text-fg-2">Runways{runwayPick && !submitted ? ': click an end to answer' : ''}</span><WindLine ap={ap} wind={wind} rwy={step.scene?.pattern} /></div>
            <AirportDiagram ap={ap} pattern={step.scene?.pattern} wind={wind} pick={runwayPick} className="mt-2 h-56" />
          </div>
          <Windsock sock={sock} wind={wind} rwyHdg={step.scene?.pattern ? findEnd(ap.runways, step.scene.pattern).hdg : undefined} className="justify-self-center" />
        </div>
        {flight && <div className="flex justify-end border-t border-border px-5 py-2"><Button size="sm" variant="ghost" onClick={() => setReplay(r => r + 1)}><RotateCcw />Replay the flight</Button></div>}
      </Card>

      <Card className="xl:col-span-5">
        <CardHeader title={step.title} icon={<PlaneLanding />} />
        <CardBody className="space-y-5">
          <p className="text-sm leading-relaxed text-fg-2">{step.situation}</p>
          <RadioPanel txs={txs} autoplay={prefs.autoplay} hideText={prefs.hideText} />
          {infos.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap gap-1 border-b border-border">
                {infos.map((inf, k) => (
                  <button key={k} onClick={() => setTab(k)} className={cn('-mb-px border-b-2 px-2.5 py-1.5 text-sm font-medium transition-colors', tab === k ? 'border-fg text-fg' : 'border-transparent text-fg-3 hover:text-fg')}>{inf.title}</button>
                ))}
              </div>
              <InfoCard info={infos[Math.min(tab, infos.length - 1)]} ap={ap} reveal={submitted} />
            </div>
          )}
          <div className="border-t border-border pt-5">
            <Quiz q={q} picked={picked} setPicked={setPicked} submitted={submitted} correct={correct} hover={hover} setHover={setHover} onSubmit={submit} />
          </div>
          {submitted && (
            <div className="flex items-center justify-end gap-2">
              <span className="num mr-auto text-sm text-fg-3">{index + 1} / {sc.steps.length}</span>
              <Button variant="primary" onClick={onNext}>{last ? 'See results' : 'Next step'}<ChevronRight /></Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function WindLine({ ap, wind, rwy }: { ap: Airport; wind: Wind; rwy?: string }) {
  if (!wind.spd) return <span className="text-fg-3">Reported wind calm</span>
  const txt = `${fmtHdg(wind.dir)}° at ${wind.spd}${wind.gust ? `G${wind.gust}` : ''} kt`
  if (!rwy) return <span className="num text-fg-3">Reported wind {txt}</span>
  const c = components(wind, findEnd(ap.runways, rwy).hdg)
  return <span className="num text-fg-3">Wind {txt} · {rwy}: {Math.abs(Math.round(c.head))} {c.head >= 0 ? 'head' : 'tail'}, {Math.abs(Math.round(c.cross))} cross</span>
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

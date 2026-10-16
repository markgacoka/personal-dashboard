import { useEffect, useRef, useState } from 'react'
import { Headphones, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Airport } from './airports'
import { descentPlan, runwayEnds } from './geo'
import type { Info } from './model'
import { speechAvailable, transmit, type Tx } from './radio'

export function RadioPanel({ txs, autoplay, hideText }: { txs: Tx[]; autoplay: boolean; hideText: boolean }) {
  const [line, setLine] = useState<number | null>(null)
  const [heard, setHeard] = useState<Set<number>>(new Set())
  const stop = useRef<() => void>(() => {})
  const played = useRef(0)
  const play = (from: number, to = txs.length) => {
    stop.current()
    stop.current = transmit(txs.slice(from, to), i => {
      setLine(i == null ? null : from + i)
      if (i != null) setHeard(h => new Set(h).add(from + i))
    })
  }
  // Auto-play anything new (e.g. replies that arrive after you answer).
  useEffect(() => {
    if (autoplay && txs.length > played.current && speechAvailable()) play(played.current)
    played.current = txs.length
  }, [txs.length, autoplay])
  useEffect(() => () => stop.current(), [])

  if (!txs.length) return null
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Headphones className="size-4 text-fg-3" />
        <span className="text-sm font-medium text-fg-2">Radio</span>
        <div className="ml-auto flex gap-1.5">
          {speechAvailable() ? (
            line != null
              ? <Button size="sm" onClick={() => stop.current()}><Pause />Stop</Button>
              : <Button size="sm" onClick={() => play(0)}><Play />Play all</Button>
          ) : <span className="text-sm text-fg-3">Audio isn’t available in this browser</span>}
        </div>
      </div>
      <ul className="space-y-2">
        {txs.map((t, i) => {
          const masked = hideText && !heard.has(i) && !t.you
          return (
            <li key={i} className={cn('flex items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors', line === i && 'bg-accent-soft')}>
              <button onClick={() => play(i, i + 1)} className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border text-fg-2 hover:bg-hover hover:text-fg" aria-label={`Play ${t.from}`}>
                {line === i ? <span className="flex h-3 items-end gap-[2px]">{[0, 1, 2].map(k => <span key={k} className="w-[3px] animate-pulse rounded-sm bg-accent" style={{ height: `${6 + k * 3}px`, animationDelay: `${k * 120}ms` }} />)}</span> : <Play className="size-3.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5"><span className={cn('text-sm font-medium', t.you ? 'text-accent' : 'text-fg')}>{t.from}</span>{t.you && <Badge tone="accent">Your call</Badge>}</div>
                <p className={cn('text-sm leading-relaxed text-fg-2', masked && 'select-none blur-[5px]')}>{t.text}</p>
                {masked && <p className="text-xs text-fg-3">Transcript hidden. Press play and listen.</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function InfoCard({ info, ap, reveal }: { info: Info; ap: Airport; reveal: boolean }) {
  if (info.kind === 'supplement') return <Supplement ap={ap} />
  if (info.kind === 'profile' && info.profile) return <Profile {...info.profile} reveal={reveal} />
  if (info.kind === 'foreflight' || info.kind === 'note') return (
    <dl className="divide-y divide-border">
      {(info.lines || []).map(l => { const [k, v] = l.includes('|') ? l.split('|') : [l, '']; return <div key={l} className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-fg-2">{k}</dt><dd className="num text-right font-medium">{v}</dd></div> })}
    </dl>
  )
  return (
    <div className="space-y-2">
      {(info.lines || []).map(l => <code key={l} className="block break-words rounded-md bg-sunken px-3 py-2 font-mono text-sm leading-relaxed text-fg-2 ring-1 ring-inset ring-border">{l}</code>)}
    </div>
  )
}

function Supplement({ ap }: { ap: Airport }) {
  const ends = ap.runways.flatMap(runwayEnds)
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-fg-3">Elevation</span><span className="num">{ap.elev.toLocaleString()} ft</span>
        <span className="text-fg-3">Pattern altitude</span><span className="num">{ap.tpa.toLocaleString()} MSL <span className="text-fg-3">({ap.tpaNote})</span></span>
        <span className="text-fg-3">Tower</span><span>{ap.towered ? 'Yes (see remarks for hours)' : 'No, non-towered'}</span>
      </div>
      <table className="w-full">
        <thead><tr className="text-left text-xs text-fg-3"><th className="pb-1 font-medium">Runway</th><th className="pb-1 font-medium">Heading</th><th className="pb-1 font-medium">Size</th><th className="pb-1 font-medium">Traffic</th></tr></thead>
        <tbody>{ends.map(e => (
          <tr key={e.ident} className="border-t border-border">
            <td className="num py-1.5 font-semibold">{e.ident}</td>
            <td className="num">{String(e.hdg).padStart(3, '0')}°</td>
            <td className="num text-fg-2">{e.lengthFt.toLocaleString()} ft{e.displacedNm > 0 && <span className="text-fg-3"> · thld dsplcd {Math.round(e.displacedNm * 6076)} ft</span>}</td>
            <td><Badge tone={e.side === 'R' ? 'warn' : 'neutral'}>{e.side === 'R' ? 'Right' : 'Left'}</Badge></td>
          </tr>
        ))}</tbody>
      </table>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {ap.freqs.map(f => <div key={f.label} className="contents"><span className="text-fg-3">{f.label}</span><span className="num">{f.mhz}{f.note && <span className="text-fg-3"> · {f.note}</span>}</span></div>)}
      </div>
      <ul className="space-y-1 font-mono text-[13px] leading-relaxed text-fg-2">{ap.remarks.map(r => <li key={r}>{r}</li>)}</ul>
    </div>
  )
}

function Profile({ alt, tpa, gs, fpm, nowNm, atTpaNm, reveal }: { alt: number; tpa: number; gs: number; fpm: number; nowNm: number; atTpaNm: number; reveal: boolean }) {
  const { nm } = descentPlan(alt, tpa, gs, fpm)
  const tod = atTpaNm + nm
  const W = 400, H = 150, padL = 44, padB = 22
  const maxX = Math.max(nowNm, tod) + 1
  const x = (d: number) => padL + ((maxX - d) / maxX) * (W - padL - 10)
  const y = (a: number) => 8 + (1 - a / (alt * 1.12)) * (H - padB - 8)
  const path = `M${x(maxX)},${y(alt)} L${x(tod)},${y(alt)} L${x(atTpaNm)},${y(tpa)} L${x(0)},${y(tpa)}`
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Descent profile">
        {[tpa, alt].map(a => <g key={a}><line x1={padL} x2={W - 10} y1={y(a)} y2={y(a)} stroke="var(--grid)" /><text x={padL - 6} y={y(a) + 4} textAnchor="end" fontSize={10} fill="var(--axis)" className="num">{a.toLocaleString()}</text></g>)}
        {[0, 5, 10, 15, 20].filter(d => d <= maxX).map(d => <text key={d} x={x(d)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--axis)" className="num">{d} nm</text>)}
        <line x1={x(atTpaNm)} x2={x(atTpaNm)} y1={y(tpa) - 14} y2={H - padB} stroke="var(--good)" strokeDasharray="3 3" />
        <text x={x(atTpaNm)} y={y(tpa) - 18} textAnchor="middle" fontSize={10} fill="var(--good)">level at TPA</text>
        {reveal && <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} pathLength={1} strokeDasharray={1} className="profile-draw" />}
        {reveal && <><circle cx={x(tod)} cy={y(alt)} r={4} fill="var(--accent)" /><text x={x(tod)} y={y(alt) - 9} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--accent)" className="num">TOD {tod.toFixed(1)} nm</text></>}
        <circle cx={x(nowNm)} cy={y(alt)} r={5} fill="var(--c2)" stroke="var(--card)" strokeWidth={2} />
        <text x={x(nowNm)} y={y(alt) + 18} textAnchor="middle" fontSize={10} fill="var(--c2)">you</text>
      </svg>
      <p className="mt-1 text-sm text-fg-3 num">{(alt - tpa).toLocaleString()} ft to lose at {fpm} fpm{reveal ? ` = ${((alt - tpa) / fpm).toFixed(1)} min ≈ ${nm.toFixed(1)} nm at ${gs} kt` : ''}</p>
    </div>
  )
}

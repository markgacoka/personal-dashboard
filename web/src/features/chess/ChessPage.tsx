import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Crown, ExternalLink, Swords } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/misc'
import { Stat } from '@/components/data/stat'
import { axisProps, cursorLine, gridProps, makeTip } from '@/components/data/chart'
import { useChess } from '@/lib/queries'
import { signed } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ChessGame, ChessMonth, ChessTimeClass } from '@/lib/types'

type TC = 'rapid' | 'blitz'
const RESULT = { W: { label: 'Win', color: 'var(--good)', tone: 'good' as const }, L: { label: 'Loss', color: 'var(--bad)', tone: 'bad' as const }, D: { label: 'Draw', color: 'var(--fg-3)', tone: 'neutral' as const } }
// Month labels come from the API (Pacific calendar) so they always match the counts.
const monthName = (m: ChessMonth, offset: number) => { if (m.month) { const [y, mo] = m.month.split('-').map(Number); return new Date(y, mo - 1, 15).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) } const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - offset); return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }

export default function ChessPage() {
  const { data: c, isLoading, isError, refetch } = useChess()
  const [tc, setTc] = useState<TC>('rapid')
  if (isLoading) return <div className="space-y-5"><Skeleton className="h-20" /><Skeleton className="h-96" /></div>
  if (isError || !c) return <EmptyState icon={Crown} title="chess.com is unavailable" className="py-24" action={<Button onClick={() => refetch()}>Try again</Button>}>Stats are cached for an hour once they load.</EmptyState>
  const d = c[tc]
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <ChessAvatar src={c.avatar} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{c.username}</h1>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-fg-3">
            {c.league && <span>{c.league} league</span>}
            {c.joined && <><span>·</span><span>Member since {new Date(c.joined * 1000).getFullYear()}</span></>}
            {c.lastOnline && <><span>·</span><span>Last online {new Date(c.lastOnline * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></>}
          </div>
        </div>
        <Segmented value={tc} onChange={setTc} options={[{ value: 'rapid', label: 'Rapid' }, { value: 'blitz', label: 'Blitz' }]} />
        <Button asChild variant="ghost" size="sm"><a href={`https://www.chess.com/member/${c.username}`} target="_blank" rel="noopener noreferrer">chess.com<ExternalLink /></a></Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-8"><RatingCard d={d} label={tc === 'rapid' ? 'Rapid' : 'Blitz'} /></Card>
        <div className="space-y-5 xl:col-span-4">
          <RecordCard d={d} />
          <Card>
            <CardBody className="grid grid-cols-2 gap-5 pt-5">
              <Stat label={`${tc === 'rapid' ? 'Rapid' : 'Blitz'} best`} value={d.best} />
              <Stat label={tc === 'rapid' ? 'Blitz' : 'Rapid'} value={c[tc === 'rapid' ? 'blitz' : 'rapid'].current} />
              <Stat label="Puzzles best" value={c.tactics.highest} />
              <Stat label="Puzzle Rush" value={c.puzzleRush.best} />
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <CardHeader title="Month by month" />
          <CardBody className="space-y-4">{[[0, d.thisMonth], [1, d.lastMonth]].map(([o, m]) => <MonthRow key={o as number} name={monthName(m as ChessMonth, o as number)} m={m as ChessMonth} />)}</CardBody>
        </Card>
        <Card className="xl:col-span-7">
          <CardHeader icon={<Swords />} title="Recent games" description={`Last ${d.recent.length} ${tc} games`} />
          <CardBody className="px-3">
            {!d.recent.length ? <p className="px-2 text-sm text-fg-3">No {tc} games in the last two months.</p> : (
              <ul>
                {[...d.recent].reverse().map(g => <GameRow key={g.url + g.ts} g={g} />)}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function RatingCard({ d, label }: { d: ChessTimeClass; label: string }) {
  const tm = d.thisMonth
  const delta = tm.ratingEnd != null && tm.ratingStart != null ? tm.ratingEnd - tm.ratingStart : null
  const data = useMemo(() => d.recent.filter(g => g.rating).map((g, i) => ({ ...g, i })), [d.recent])
  const Tip = useMemo(() => makeTip<ChessGame>({
    title: g => new Date(g.ts * 1000).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    rows: g => [{ color: RESULT[g.result].color, label: `${RESULT[g.result].label} vs ${g.opponent}`, value: g.oppRating }, { label: 'Your rating', value: g.rating }],
  }), [])
  const min = Math.min(...data.map(g => g.rating)), max = Math.max(...data.map(g => g.rating))
  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Stat label={`${label} rating`} value={d.current} size="xl" />
        <div className="pb-1.5">
          <div className={cn('num text-lg font-semibold', delta == null ? 'text-fg-3' : delta >= 0 ? 'text-good' : 'text-bad')}>{delta == null ? '—' : signed(delta)}</div>
          <div className="text-sm text-fg-3">this month</div>
        </div>
        <div className="ml-auto flex gap-3 pb-1.5 text-xs text-fg-3">{Object.entries(RESULT).map(([k, r]) => <span key={k} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: r.color }} />{r.label}</span>)}</div>
      </div>
      <div className="mt-5 h-64">
        {data.length < 2 ? <div className="grid h-full place-items-center text-sm text-fg-3">Not enough recent games to plot a trend</div> : (
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="i" {...axisProps} tickFormatter={i => new Date((data[i]?.ts || 0) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} minTickGap={32} />
              <YAxis {...axisProps} width={48} domain={[Math.floor((min - 15) / 10) * 10, Math.ceil((max + 15) / 10) * 10]} allowDecimals={false} />
              <Tooltip content={Tip} cursor={cursorLine} />
              <Line dataKey="rating" stroke="var(--accent)" strokeWidth={2} isAnimationActive={false}
                dot={(p: { cx?: number; cy?: number; payload?: ChessGame; index?: number }) => <circle key={p.index} cx={p.cx} cy={p.cy} r={4.5} fill={RESULT[p.payload!.result].color} stroke="var(--card)" strokeWidth={2} />}
                activeDot={{ r: 6, stroke: 'var(--card)', strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function RecordCard({ d }: { d: ChessTimeClass }) {
  const r = d.record
  const total = r.win + r.loss + r.draw
  const seg = [['W', r.win], ['D', r.draw], ['L', r.loss]] as const
  return (
    <Card>
      <CardHeader title="All-time record" description={`${total.toLocaleString()} rated games`} />
      <CardBody>
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">{seg.map(([k, v]) => v > 0 && <div key={k} style={{ width: `${(v / (total || 1)) * 100}%`, background: RESULT[k].color }} />)}</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {seg.map(([k, v]) => <div key={k}><div className="flex items-center gap-1.5 text-xs text-fg-3"><span className="size-2 rounded-full" style={{ background: RESULT[k].color }} />{{ W: 'Wins', D: 'Draws', L: 'Losses' }[k]}</div><div className="num text-lg font-semibold">{v.toLocaleString()}</div><div className="num text-xs text-fg-3">{total ? Math.round((v / total) * 100) : 0}%</div></div>)}
        </div>
      </CardBody>
    </Card>
  )
}

function MonthRow({ name, m }: { name: string; m: ChessMonth }) {
  const delta = m.ratingEnd != null && m.ratingStart != null ? m.ratingEnd - m.ratingStart : null
  const wr = m.count ? Math.round((m.win / m.count) * 100) : null
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between"><span className="font-medium">{name}</span><span className="text-sm text-fg-3">{m.count} games</span></div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div><div className="text-xs text-fg-3">Rating</div><div className="num text-sm">{m.ratingStart ?? '—'} → {m.ratingEnd ?? '—'}</div>{delta != null && <div className={cn('num text-xs', delta >= 0 ? 'text-good' : 'text-bad')}>{signed(delta)}</div>}</div>
        <div><div className="text-xs text-fg-3">Record</div><div className="num text-sm">{m.win}–{m.loss}–{m.draw}</div><div className="text-xs text-fg-3">W–L–D</div></div>
        <div><div className="text-xs text-fg-3">Win rate</div><div className="num text-sm">{wr != null ? `${wr}%` : '—'}</div></div>
      </div>
    </div>
  )
}

function GameRow({ g }: { g: ChessGame }) {
  const r = RESULT[g.result]
  return (
    <li>
      <a href={g.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover">
        <Badge tone={r.tone} className="w-11 justify-center">{r.label}</Badge>
        <span className={cn('size-3 shrink-0 rounded-full ring-1 ring-border-strong', g.color === 'w' ? 'bg-white' : 'bg-neutral-900')} title={g.color === 'w' ? 'Played white' : 'Played black'} />
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{g.opponent} <span className="num font-normal text-fg-3">({g.oppRating})</span></div></div>
        <span className="num text-sm text-fg-2">{g.rating}</span>
        <span className="w-16 text-right text-xs text-fg-3">{new Date(g.ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <ExternalLink className="size-3.5 text-fg-3" />
      </a>
    </li>
  )
}

// chess.com serves avatars with a same-origin resource policy, so they can fail to load here.
function ChessAvatar({ src }: { src?: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <span className="grid size-14 place-items-center rounded-xl bg-accent-soft text-accent"><Crown className="size-6" /></span>
  return <img src={src} alt="" className="size-14 rounded-xl object-cover ring-1 ring-border" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
}

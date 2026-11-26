import { Fragment, useDeferredValue, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Languages, MessageSquareText, Mic, Search, Watch, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/misc'
import { get } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { AssistantExchange, AssistantLog, AssistantMode } from '@/lib/types'

// The watch's request log as a table: search across requests and responses,
// filter by type, outcome, model and time, page through it, and open a row
// for the full text. Filters live in the address, so a filtered view can be
// bookmarked; the server does the filtering and says how many match.

export const MODE: Record<AssistantMode, { label: string; icon: typeof Mic }> = {
  ask: { label: 'Ask', icon: MessageSquareText },
  translate: { label: 'Translate', icon: Languages },
  transcribe: { label: 'Captions', icon: Mic },
}
// How each request was handled, in words, and how loud to show it.
export const ROUTE: Record<string, { label: string; tone: 'neutral' | 'accent' | 'warn' | 'bad' | 'good' }> = {
  direct: { label: 'Answered', tone: 'neutral' },
  search: { label: 'Searched the web', tone: 'accent' },
  watch: { label: 'Watch action', tone: 'good' },
  fallback: { label: 'Backup model', tone: 'warn' },
  'search-only': { label: 'Search result only', tone: 'warn' },
  error: { label: 'Failed', tone: 'bad' },
  translate: { label: 'Translated', tone: 'neutral' },
  transcribe: { label: 'Transcribed', tone: 'neutral' },
}
const RANGES = { all: { label: 'Any time', s: null }, '24h': { label: 'Last 24 hours', s: 86400 }, '7d': { label: 'Last 7 days', s: 7 * 86400 }, '30d': { label: 'Last 30 days', s: 30 * 86400 } } as const
type Range = keyof typeof RANGES
const SIZES = [25, 50, 100]

export const shortModel = (m: string) => m.replace(/^[a-z]+\//, '')
const seconds = (ms: number | null | undefined) => (ms == null ? '—' : (ms / 1000).toFixed(1))
const when = (at: number) => {
  const d = new Date(at * 1000)
  const today = new Date().toDateString() === d.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return today ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}
const full = (at: number) => new Date(at * 1000).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })

// The search term, marked wherever it appears.
function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-fg">{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>
}

export function LogTable() {
  const [params, setParams] = useSearchParams()
  const f = {
    q: params.get('q') ?? '', mode: (params.get('mode') ?? 'all') as 'all' | AssistantMode,
    route: params.get('route') ?? '', model: params.get('model') ?? '',
    range: (RANGES[params.get('range') as Range] ? params.get('range') : 'all') as Range,
    size: SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : 25,
  }
  const setF = (p: Partial<Record<'q' | 'mode' | 'route' | 'model' | 'range' | 'size', string | number>>) => setParams(prev => {
    const n = new URLSearchParams(prev)
    for (const [k, v] of Object.entries(p)) { if (v === '' || v === 'all' || v == null || (k === 'size' && v === 25)) n.delete(k); else n.set(k, String(v)) }
    return n
  }, { replace: true })
  const [text, setText] = useState(f.q)
  const q = useDeferredValue(text.trim())
  useEffect(() => { const t = setTimeout(() => { if (q !== f.q) setF({ q }) }, 300); return () => clearTimeout(t) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const [page, setPage] = useState(0)
  const top = useRef<HTMLDivElement>(null)
  const turned = useRef(false)
  // A new page starts at its first row, wherever the buttons were.
  useEffect(() => { if (turned.current && top.current && top.current.getBoundingClientRect().top < 0) top.current.scrollIntoView({ block: 'start' }); turned.current = true }, [page])
  const [open, setOpen] = useState<string | null>(null)
  const key = [f.q, f.mode, f.route, f.model, f.range, f.size].join('|')
  useEffect(() => { setPage(0); setOpen(null) }, [key])

  const since = RANGES[f.range].s
  const log = useInfiniteQuery({
    queryKey: ['assistant', 'log', f.q, f.mode, f.route, f.model, f.range, f.size],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: String(f.size) })
      if (pageParam) qs.set('before', String(pageParam))
      if (f.mode !== 'all') qs.set('mode', f.mode)
      for (const k of ['q', 'route', 'model'] as const) if (f[k]) qs.set(k, f[k])
      if (since) qs.set('since', String(Math.floor(Date.now() / 1000 - since)))
      return get<AssistantLog>(`/api/assistant/log?${qs}`)
    },
    getNextPageParam: last => (last.exchanges.length === f.size ? last.exchanges[last.exchanges.length - 1].at : undefined),
    refetchInterval: page === 0 ? 60_000 : false,
    retry: 1,
  })
  const pages = log.data?.pages ?? []
  const first = pages[0]
  const rows = pages[page]?.exchanges ?? []
  const total = first?.matches
  const facets = first?.facets
  const lastPage = total != null ? Math.max(0, Math.ceil(total / f.size) - 1) : null
  const canNext = lastPage != null ? page < lastPage : page < pages.length - 1 || !!log.hasNextPage
  const next = async () => { if (page + 1 >= pages.length) await log.fetchNextPage(); setPage(p => p + 1); setOpen(null) }
  const active = !!(f.q || f.mode !== 'all' || f.route || f.model || f.range !== 'all')
  const clear = () => { setText(''); setParams(prev => { const n = new URLSearchParams(); if (prev.get('size')) n.set('size', prev.get('size')!); return n }, { replace: true }) }
  const from = page * f.size + 1, to = page * f.size + rows.length
  // Type counts are for the whole log, so they're shown only while nothing else narrows it.
  const modeCount = (m: string) => (f.q || f.route || f.model || f.range !== 'all' ? undefined : facets?.modes.find(x => x.value === m)?.count)

  return (
    <div ref={top} className="scroll-mt-20">
    <Card className="@container overflow-hidden">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="relative min-w-[min(100%,16rem)] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
          <Input value={text} onChange={e => setText(e.target.value)} placeholder="Search requests and responses" className="pr-9 pl-9" aria-label="Search requests and responses" />
          {text && <button onClick={() => setText('')} aria-label="Clear search" className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-fg-3 hover:bg-hover hover:text-fg"><X className="size-3.5" /></button>}
        </div>
        <Segmented size="sm" value={f.mode} onChange={v => setF({ mode: v })} options={[
          { value: 'all', label: 'All' },
          ...(['ask', 'translate', 'transcribe'] as const).map(m => ({ value: m, label: MODE[m].label, count: modeCount(m) })),
        ]} />
        {/* Outcome, model and time need a server that reports its filter options (facets); an older one would ignore them. */}
        {(facets || f.route || f.model || f.range !== 'all') && <div className="flex min-w-0 flex-[1_1_100%] flex-wrap gap-2 @4xl:flex-[0_1_auto]">
        <Select value={f.route} onChange={e => setF({ route: e.target.value })} aria-label="Outcome" className="h-9 w-auto min-w-0 flex-1 basis-[9rem] @4xl:flex-none @4xl:basis-auto @4xl:min-w-36">
          <option value="">Any outcome</option>
          {(facets?.routes ?? []).map(r => <option key={r.value} value={r.value}>{ROUTE[r.value]?.label ?? r.value} ({r.count})</option>)}
          {f.route && !facets?.routes.some(r => r.value === f.route) && <option value={f.route}>{ROUTE[f.route]?.label ?? f.route}</option>}
        </Select>
        <Select value={f.model} onChange={e => setF({ model: e.target.value })} aria-label="Model or language" className="h-9 w-auto min-w-0 flex-1 basis-[9rem] @4xl:max-w-56 @4xl:flex-none @4xl:basis-auto @4xl:min-w-36">
          <option value="">Any model or language</option>
          {(facets?.models ?? []).map(m => <option key={m.value} value={m.value}>{shortModel(m.value)} ({m.count})</option>)}
          {f.model && !facets?.models.some(m => m.value === f.model) && <option value={f.model}>{shortModel(f.model)}</option>}
        </Select>
        <Select value={f.range} onChange={e => setF({ range: e.target.value })} aria-label="Time" className="h-9 w-auto min-w-0 flex-1 basis-[9rem] @4xl:flex-none @4xl:basis-auto">
          {(Object.keys(RANGES) as Range[]).map(r => <option key={r} value={r}>{RANGES[r].label}</option>)}
        </Select>
        {active && <Button variant="ghost" size="sm" className="h-9" onClick={clear}><X />Clear</Button>}
        </div>}
        {!facets && !(f.route || f.model || f.range !== 'all') && active && <Button variant="ghost" size="sm" className="h-9" onClick={clear}><X />Clear</Button>}
      </div>

      {/* Table */}
      {log.isError && !first ? (
        <EmptyState icon={Watch} title="The watch assistant isn't reachable" className="py-16" action={<Button onClick={() => log.refetch()}>Try again</Button>}>{(log.error as Error)?.message}</EmptyState>
      ) : log.isLoading ? (
        <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={Watch} title={active ? 'No matching requests' : 'No requests yet'} className="py-16" action={active ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : undefined}>
          {active ? 'Nothing matches these filters.' : 'Ask your watch something and it shows up here.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="bg-sunken/60 text-left text-[13px] text-fg-3">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="hidden w-[9rem] pl-4 sm:pl-5 @xl:table-cell">Time</th>
                <th className="hidden w-[7rem] @2xl:table-cell">Type</th>
                <th>Request</th>
                <th className="hidden @3xl:table-cell">Response</th>
                <th className="hidden w-[10rem] @5xl:table-cell">Outcome</th>
                <th className="hidden w-[10rem] @6xl:table-cell">Model</th>
                <th className="hidden w-[4.5rem] text-right @2xl:table-cell">Took</th>
                <th className="w-9" aria-label="Details" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const id = `${r.at}`
                const isOpen = open === id
                return <Row key={id} r={r} q={f.q} open={isOpen} onToggle={() => setOpen(isOpen ? null : id)}
                  onFilter={p => setF(p)} />
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paging */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 text-[13px] text-fg-3 sm:px-5">
          <span className="num">{from.toLocaleString()}–{to.toLocaleString()}{total != null ? ` of ${total.toLocaleString()}` : ''}</span>
          <label className="ml-auto flex items-center gap-2">Rows
            <Select value={f.size} onChange={e => setF({ size: Number(e.target.value) })} className="h-8 w-auto" aria-label="Rows per page">{SIZES.map(s => <option key={s} value={s}>{s}</option>)}</Select>
          </label>
          <span className="num">{lastPage != null ? `Page ${page + 1} of ${lastPage + 1}` : `Page ${page + 1}`}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Newer" disabled={page === 0} onClick={() => { setPage(p => p - 1); setOpen(null) }}><ChevronLeft /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Older" disabled={!canNext || log.isFetchingNextPage} loading={log.isFetchingNextPage} onClick={next}><ChevronRight /></Button>
          </div>
        </div>
      )}
    </Card>
    </div>
  )
}

function Row({ r, q, open, onToggle, onFilter }: { r: AssistantExchange; q: string; open: boolean; onToggle: () => void; onFilter: (p: { route?: string; model?: string; mode?: string }) => void }) {
  const m = MODE[r.mode] ?? MODE.ask
  const route = ROUTE[r.route] ?? { label: r.route, tone: 'neutral' as const }
  const failed = r.route === 'error'
  const model = r.model && r.model !== 'none' ? (r.mode === 'translate' ? `to ${r.model}` : shortModel(r.model)) : '—'
  return (
    <>
      <tr onClick={onToggle} aria-expanded={open}
        className={cn('cursor-pointer border-t border-border align-top transition-colors [&>td]:px-3 [&>td]:py-2.5', open ? 'bg-hover' : 'hover:bg-hover/60')}>
        <td className="num hidden pl-4 text-[13px] whitespace-nowrap text-fg-3 sm:pl-5 @xl:table-cell" title={full(r.at)}>{when(r.at)}</td>
        <td className="hidden @2xl:table-cell"><span className="inline-flex items-center gap-1.5 text-fg-2"><m.icon className="size-3.5 text-fg-3" />{m.label}</span></td>
        <td className="min-w-0 max-@xl:pl-4!">
          <div className="num mb-0.5 text-[12px] text-fg-3 @xl:hidden">{when(r.at)} · {m.label}</div>
          <div className="line-clamp-2 font-medium text-fg"><Hl text={r.question || '(no speech)'} q={q} /></div>
          <div className={cn('mt-0.5 line-clamp-2 @3xl:hidden', failed ? 'text-bad' : 'text-fg-3')}><Hl text={r.answer} q={q} /></div>
        </td>
        <td className={cn('hidden @3xl:table-cell', failed ? 'text-bad' : 'text-fg-2')}><div className="line-clamp-2"><Hl text={r.answer} q={q} /></div></td>
        <td className="hidden @5xl:table-cell"><Badge tone={route.tone}>{route.label}</Badge></td>
        <td className="hidden truncate text-[13px] text-fg-3 @6xl:table-cell" title={r.model}>{model}</td>
        <td className="num hidden text-right text-[13px] text-fg-3 @2xl:table-cell">{r.ms != null ? `${seconds(r.ms)}s` : '—'}</td>
        <td className="pr-3 text-fg-3"><ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} /></td>
      </tr>
      {open && (
        <tr className="bg-hover/40">
          <td colSpan={8} className="px-4 pb-4 pt-1 sm:px-5">
            <div className="grid gap-4 @3xl:grid-cols-2">
              <Text title={r.mode === 'translate' ? 'You said' : 'Request'} text={r.question || '(no speech)'} q={q} />
              <Text title={r.mode === 'translate' ? 'Translation' : r.mode === 'transcribe' ? 'Captions' : 'Response'} text={r.answer} q={q} bad={failed} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-fg-3">
              <span className="num">{full(r.at)}</span>
              <button className="inline-flex items-center gap-1.5 hover:text-fg" onClick={() => onFilter({ mode: r.mode })}><m.icon className="size-3.5" />{m.label}</button>
              <button className="hover:text-fg" onClick={() => onFilter({ route: r.route })} title="Show only this outcome"><Badge tone={route.tone}>{route.label}</Badge></button>
              {model !== '—' && <button className="hover:text-fg hover:underline" onClick={() => onFilter({ model: r.model })} title="Show only this model">{r.model}</button>}
              {!!r.tools.length && <span>Tools: {[...new Set(r.tools)].join(', ').replaceAll('_', ' ')}</span>}
              {r.ms != null && <span className="num">{seconds(r.ms)} s on the server</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Text({ title, text, q, bad }: { title: string; text: string; q: string; bad?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="min-w-0 rounded-lg bg-card p-3 ring-1 ring-inset ring-border">
      <div className="mb-1 flex items-center justify-between gap-2 text-[13px] text-fg-3">
        {title}
        <button onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg" aria-label={`Copy ${title.toLowerCase()}`}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className={cn('whitespace-pre-wrap text-sm leading-relaxed', bad ? 'text-bad' : 'text-fg')}><Hl text={text} q={q} /></p>
    </div>
  )
}

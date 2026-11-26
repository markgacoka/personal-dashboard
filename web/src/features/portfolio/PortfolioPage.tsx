import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader, Stat } from '@/components/data/stat'
import { Sparkline } from '@/components/data/spark'
import { int, calDate, usd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PRODUCTS, STATUS, type MetricFormat, type Product, type ProductMetric } from './products'

// Portfolio: everything I've built, side by side in a carousel that holds as
// many as there are, then the selected one in full with its metrics.

const fmt = (v: number | null, f: MetricFormat = 'int') =>
  v == null ? null : f === 'usd' ? usd(v) : f === 'rating' ? v.toFixed(1) : f === 'percent' ? `${v.toFixed(1)}%` : int(v)
const SUMMABLE: MetricFormat[] = ['int', 'usd']

export default function PortfolioPage() {
  const [params, setParams] = useSearchParams()
  const sel = PRODUCTS.find(p => p.id === params.get('p')) ?? PRODUCTS[0]
  const pick = (p: Product) => setParams({ p: p.id }, { replace: true })
  return (
    <div>
      <PageHeader title="Portfolio" />
      {PRODUCTS.length > 1 && <Totals />}
      <Carousel selected={sel?.id} onPick={pick} />
      {sel && <Detail key={sel.id} p={sel} />}
    </div>
  )
}

// Across every product (shown once there are two or more): how many, how many
// are live, and each summable metric added up.
function Totals() {
  const keys = new Map<string, ProductMetric>()
  for (const p of PRODUCTS) for (const m of p.metrics) if (SUMMABLE.includes(m.format ?? 'int') && !keys.has(m.key)) keys.set(m.key, m)
  const sum = (k: string) => { const vs = PRODUCTS.flatMap(p => p.metrics.filter(m => m.key === k && m.value != null).map(m => m.value!)); return vs.length ? vs.reduce((a, b) => a + b, 0) : null }
  const live = PRODUCTS.filter(p => p.status === 'live').length
  return (
    <Card className="mb-6">
      <CardBody className="grid grid-cols-2 gap-x-6 gap-y-5 pt-5 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] sm:pt-6">
        <Stat label="Products" value={PRODUCTS.length} />
        <Stat label="Live" value={live} sub={PRODUCTS.length - live ? `${PRODUCTS.length - live} not yet` : undefined} />
        {[...keys.values()].map(m => <Stat key={m.key} label={m.label} value={fmt(sum(m.key), m.format) ?? '—'} tone={sum(m.key) == null ? 'muted' : undefined} sub={sum(m.key) == null ? 'Not tracked yet' : 'All products'} />)}
      </CardBody>
    </Card>
  )
}

// Product cards in one row that scrolls sideways; arrows page through it when it overflows.
function Carousel({ selected, onPick }: { selected?: string; onPick: (p: Product) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ start: true, end: true })
  const measure = () => { const t = track.current; if (t) setEdge({ start: t.scrollLeft < 4, end: t.scrollLeft + t.clientWidth >= t.scrollWidth - 4 }) }
  useEffect(() => { measure(); const t = track.current; if (!t) return; const ro = new ResizeObserver(measure); ro.observe(t); return () => ro.disconnect() }, [])
  const page = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.9, behavior: 'smooth' })
  const key = (e: React.KeyboardEvent, i: number) => {
    const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1
    if (j < 0 || j >= PRODUCTS.length) return
    e.preventDefault(); onPick(PRODUCTS[j])
    track.current?.querySelectorAll<HTMLElement>('[data-card]')[j]?.focus()
  }
  return (
    <section aria-label="Products" className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium tracking-[-0.011em] text-fg">Products <span className="num font-normal text-fg-3">{PRODUCTS.length} · {PRODUCTS.filter(p => p.status === 'live').length} live</span></h2>
        {!(edge.start && edge.end) && (
          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Previous products" disabled={edge.start} onClick={() => page(-1)}><ChevronLeft /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next products" disabled={edge.end} onClick={() => page(1)}><ChevronRight /></Button>
          </div>
        )}
      </div>
      <div ref={track} onScroll={measure} role="listbox" aria-label="Products" aria-orientation="horizontal"
        className="scrollbar-none -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1">
        {PRODUCTS.map((p, i) => <ProductCard key={p.id} p={p} on={p.id === selected} onPick={() => onPick(p)} onKey={e => key(e, i)} />)}
      </div>
    </section>
  )
}

// One product in the strip: its screen, name, kind, status and headline number.
function ProductCard({ p, on, onPick, onKey }: { p: Product; on: boolean; onPick: () => void; onKey: (e: React.KeyboardEvent) => void }) {
  const st = STATUS[p.status]
  const head = p.metrics.find(m => m.value != null)
  const shot = p.gallery[0]?.src ?? p.icon
  return (
    <button type="button" data-card role="option" aria-selected={on} onClick={onPick} onKeyDown={onKey} tabIndex={on ? 0 : -1}
      className={cn('flex w-[min(19rem,85vw)] shrink-0 snap-start items-center gap-3 rounded-xl bg-card p-3 text-left ring-1 ring-inset transition-colors',
        on ? 'ring-accent/60' : 'ring-white/[0.04] hover:bg-hover')}>
      <img src={shot} alt="" className={cn('size-16 shrink-0 object-cover ring-1 ring-border', p.shape === 'round' ? 'rounded-full' : 'rounded-lg')} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2"><span className="truncate text-sm font-medium text-fg">{p.name}</span>{head && <span className="num ml-auto shrink-0 text-[13px] text-fg-2" title={head.label}>{fmt(head.value, head.format)} <span className="text-fg-3">{head.label.toLowerCase()}</span></span>}</span>
        <span className="block truncate text-[13px] text-fg-3">{p.kind}</span>
        <Badge tone={st.tone} className="mt-1.5">{st.label}</Badge>
      </span>
    </button>
  )
}

function Detail({ p }: { p: Product }) {
  const st = STATUS[p.status]
  return (
    <div className="grid gap-6">
      <Card className="@container">
        <CardBody className="grid gap-8 pt-5 sm:pt-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @6xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-4">
              <img src={p.icon} alt="" className="size-14 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-fg-3">{p.kind}</div>
                <h2 className="text-2xl font-medium tracking-[-0.02em] text-fg">{p.name}</h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-base text-fg-2">{p.summary}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {p.links.map(l => <Button key={l.href} asChild variant="primary"><a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}<ArrowUpRight /></a></Button>)}
              <Badge tone={st.tone} size="md">{st.label}</Badge>
            </div>
            <ul className="mt-6 grid gap-x-6 gap-y-4 @2xl:grid-cols-2">
              {p.features.map(f => (
                <li key={f.title} className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-pill text-fg-2"><f.icon className="size-4" /></span>
                  <span className="min-w-0"><span className="block text-sm font-medium text-fg">{f.title}</span><span className="block text-sm text-fg-3">{f.text}</span></span>
                </li>
              ))}
            </ul>
            <dl className="mt-6 grid gap-px overflow-hidden rounded-lg bg-border ring-1 ring-inset ring-border [grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr))]">
              {[...p.facts, ...(p.released ? [['Released', calDate(p.released, { month: 'short', day: 'numeric', year: 'numeric' })] as [string, string]] : [])].map(([k, v]) => (
                <div key={k} className="bg-card px-3 py-2.5"><dt className="text-[13px] text-fg-3">{k}</dt><dd className="mt-0.5 text-sm font-medium text-fg">{v}</dd></div>
              ))}
            </dl>
          </div>
          <Gallery p={p} />
        </CardBody>
      </Card>
      <Metrics p={p} />
    </div>
  )
}

// The product's screens: one large, the rest as thumbnails to switch to.
function Gallery({ p }: { p: Product }) {
  const [i, setI] = useState(0)
  if (!p.gallery.length) return null
  const g = p.gallery[i], round = p.shape === 'round'
  return (
    <div className="flex flex-col items-center gap-4">
      <div className={cn('w-full max-w-[22rem] bg-sunken p-3 ring-1 ring-inset ring-border', round ? 'aspect-square rounded-full' : 'rounded-xl')}>
        <img src={g.src} alt={`${p.name} on ${g.label}`} className={cn('size-full object-cover', round ? 'rounded-full' : 'rounded-lg')} />
      </div>
      <div className="text-[13px] text-fg-3" aria-live="polite">{g.label}</div>
      {p.gallery.length > 1 && (
        <div className="flex flex-wrap justify-center gap-2" role="group" aria-label={`${p.name} screens`}>
          {p.gallery.map((x, k) => (
            <button key={x.src} type="button" onClick={() => setI(k)} aria-pressed={k === i} aria-label={x.label}
              className={cn('size-12 p-0.5 ring-1 ring-inset transition-shadow', round ? 'rounded-full' : 'rounded-md', k === i ? 'ring-2 ring-accent' : 'ring-border hover:ring-border-strong')}>
              <img src={x.src} alt="" className={cn('size-full object-cover', round ? 'rounded-full' : 'rounded')} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Whatever the product tracks; an untracked metric says so instead of showing zero.
function Metrics({ p }: { p: Product }) {
  if (!p.metrics.length) return null
  return (
    <Card>
      <CardHeader title="Metrics" />
      <CardBody className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        {p.metrics.map(m => (
          <div key={m.key} className="min-w-0">
            <Stat label={m.label} value={fmt(m.value, m.format) ?? '—'} tone={m.value == null ? 'muted' : undefined}
              sub={m.value == null ? 'Not tracked yet' : [m.source, m.asOf && `as of ${calDate(m.asOf, { month: 'short', day: 'numeric' })}`].filter(Boolean).join(' · ') || undefined} />
            {m.series && m.series.length > 1 && <Sparkline values={m.series} width={200} height={34} className="mt-2 h-auto max-w-full" />}
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

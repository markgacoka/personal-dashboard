import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Copy, FilePlus2, Loader2, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/data/stat'
import { relTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SavedPlan } from './api'
import { parseRouteItem, type Plan } from './model'
import { clearLegacyDraft, legacyDraft, useFlightActions } from './useFlight'

const routeOf = (p: Plan) => p.route.map(r => { const id = parseRouteItem(r).id; return p.labels?.[id]?.name ?? id }).join(' → ') || 'No route yet'
const whenOf = (p: Plan) => { const d = new Date(p.departLocal); return Number.isNaN(+d) ? '' : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' }) }
const crewOf = (p: Plan) => (p.crew?.role === 'dual' ? `dual${p.crew.instructor ? ` with ${p.crew.instructor}` : ''}` : p.crew?.role === 'pic' ? 'solo / PIC' : '')

// Every flight you're planning or have planned: create one, open any (each has
// its own address, so several can be open in tabs), copy one as the start of
// another, or delete it. Flights save themselves as you edit.
export default function FlightsPage() {
  const a = useFlightActions()
  const nav = useNavigate()
  const [legacy, setLegacy] = useState(() => legacyDraft())
  const plans = a.plans.data ?? []
  const now = Date.now()
  const at = (p: SavedPlan) => +new Date(p.data.departLocal) || 0
  const upcoming = plans.filter(p => at(p) >= now - 3 * 3600_000).sort((x, y) => at(x) - at(y))
  const past = plans.filter(p => at(p) < now - 3 * 3600_000).sort((x, y) => at(y) - at(x))
  return (
    <div className="planner">
      <PageHeader title="Flights" description="Each flight is its own plan with its own NavLog, weight and balance and weather briefing. Changes save as you make them."
        actions={<div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost"><Link to="/flying/plan/profiles"><Users />Profiles</Link></Button>
          <Button variant="primary" onClick={a.newFlight} loading={a.creating}><FilePlus2 />New flight</Button>
        </div>} />

      {legacy && (
        <section className="mb-6 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-inset ring-accent/40 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-fg">A flight from before wasn't saved: <span className="num">{routeOf(legacy)}</span></div>
            <div className="text-[13px] text-fg-3">{whenOf(legacy)}{legacy.tail ? ` · ${legacy.tail}` : ''}. It's only in this browser.</div>
          </div>
          <Button size="sm" variant="primary" onClick={() => { clearLegacyDraft(); a.restore(legacy) }}>Keep it as a flight</Button>
          <Button size="sm" variant="ghost" onClick={() => { clearLegacyDraft(); setLegacy(null) }}>Discard</Button>
        </section>
      )}

      {a.plans.isLoading && <p className="flex items-center gap-2 text-sm text-fg-3"><Loader2 className="size-4 animate-spin" />Loading flights…</p>}
      {!a.plans.isLoading && !plans.length && (
        <div className="rounded-xl bg-card px-6 py-10 text-center ring-1 ring-inset ring-white/[0.04]">
          <p className="text-[15px] font-medium text-fg">No flights yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-3">A new flight asks where and when, which aircraft and who's flying, then builds the NavLog, the weight and balance and the weather briefing.</p>
          <Button className="mt-4" variant="primary" onClick={a.newFlight} loading={a.creating}><FilePlus2 />New flight</Button>
        </div>
      )}
      <Group title="Upcoming" list={upcoming} onOpen={id => nav(`/flying/plan/${id}`)} a={a} />
      <Group title="Past" list={past} onOpen={id => nav(`/flying/plan/${id}`)} a={a} />
    </div>
  )
}

function Group({ title, list, onOpen, a }: { title: string; list: SavedPlan[]; onOpen: (id: number) => void; a: ReturnType<typeof useFlightActions> }) {
  if (!list.length) return null
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-medium text-fg-2">{title} <span className="num font-normal text-fg-3">{list.length}</span></h2>
      <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-inset ring-white/[0.04]">
        {list.map(p => <Row key={p.id} p={p} onOpen={() => onOpen(p.id)} a={a} />)}
      </ul>
    </section>
  )
}

function Row({ p, onOpen, a }: { p: SavedPlan; onOpen: () => void; a: ReturnType<typeof useFlightActions> }) {
  const [sure, setSure] = useState(false)
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-hover sm:px-5">
      <button onClick={onOpen} className="grid min-w-0 flex-1 basis-72 gap-x-6 gap-y-0.5 text-left md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
        <span className="min-w-0"><span className="block truncate text-sm font-medium text-fg">{p.name}</span><span className="num block truncate text-[13px] text-fg-3">{routeOf(p.data)}</span></span>
        <span className="text-[13px] text-fg-2">{whenOf(p.data)}<span className="block text-fg-3">{[p.data.tail, crewOf(p.data)].filter(Boolean).join(' · ') || '—'}</span></span>
        <span className={cn('text-[13px]', p.data.setup ? 'text-fg-2' : 'text-fg-3')}>{p.data.setup ? 'Not set up yet' : `Edited ${relTime(p.updated_at)}`}</span>
      </button>
      <span className="flex items-center gap-1">
        {sure ? (
          <>
            <span className="text-[13px] text-fg-2">Delete "{p.name}"?</span>
            <Button size="sm" variant="danger" onClick={() => a.remove(p.id)}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSure(false)}>Keep</Button>
          </>
        ) : (
          <>
            <Button size="icon-sm" variant="ghost" aria-label={`Copy ${p.name}`} title="Copy as a new flight" onClick={() => a.duplicate(p.data)}><Copy /></Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => setSure(true)}><Trash2 /></Button>
          </>
        )}
      </span>
    </li>
  )
}

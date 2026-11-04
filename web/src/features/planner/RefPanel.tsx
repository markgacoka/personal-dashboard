import { createContext, useContext, useMemo, useRef, useState } from 'react'
import { BookOpen, CloudSun, ExternalLink, Mail, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useDocuments, type PlannerDoc } from './api'
import { POH_PAGES_172P } from './poh'
import { Synced } from './ui'

type Tab = 'poh' | 'briefing'
interface RefState { open: boolean; tab: Tab; page: number | null; docId: Record<Tab, number | null> }
interface RefApi { state: RefState; show: (tab: Tab, page?: string | number | null) => void; close: () => void; set: (s: Partial<RefState>) => void }
const Ctx = createContext<RefApi | null>(null)
export const useRefs = () => useContext(Ctx)

export function RefProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RefState>({ open: false, tab: 'poh', page: null, docId: { poh: null, briefing: null } })
  const api = useMemo<RefApi>(() => ({
    state,
    show: (tab, page) => setState(s => ({ ...s, open: true, tab, page: typeof page === 'number' ? page : page ? POH_PAGES_172P[page] ?? null : null })),
    close: () => setState(s => ({ ...s, open: false })),
    set: p => setState(s => ({ ...s, ...p })),
  }), [state])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

// "POH Fig. 5-5" link that opens the reference panel at that figure.
export function PohLink({ fig, children }: { fig: keyof typeof POH_PAGES_172P | string; children: React.ReactNode }) {
  const r = useRefs()
  return <button type="button" onClick={() => r?.show('poh', fig)} className="inline-flex items-center gap-1 text-accent hover:underline"><BookOpen className="size-3.5" />{children}</button>
}

export function RefPanel({ model, route, date, className }: { model: string | null; route: string[]; date: string; className?: string }) {
  const r = useRefs()!
  const docs = useDocuments()
  const fileRef = useRef<HTMLInputElement>(null)
  const { tab, page, docId } = r.state
  const list = (docs.data || []).filter(d => d.kind === tab)
  // POH: same model first; briefing: same route and newest first.
  const ranked = useMemo(() => [...list].sort((a, b) => score(b, tab, model, route, date) - score(a, tab, model, route, date)), [list, tab, model, route, date])
  const doc = ranked.find(d => d.id === docId[tab]) ?? ranked[0] ?? null
  const pageNo = tab === 'poh' ? page : null
  const src = doc ? `/api/planner/documents/${doc.id}/file#${pageNo ? `page=${pageNo}&` : ''}view=FitH` : null
  const upload = (f: File) => docs.upload.mutate({ file: f, kind: tab, model: tab === 'poh' ? model ?? undefined : undefined, route: tab === 'briefing' ? route.join(' ') : undefined }, { onSuccess: () => toast.success('Uploaded'), onError: e => toast.error(e.message) })

  return (
    <div className={cn('flex h-full min-h-0 flex-col rounded-xl bg-card ring-1 ring-inset ring-white/[0.04]', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {(['poh', 'briefing'] as Tab[]).map(t => (
          <button key={t} onClick={() => r.set({ tab: t, page: null })} className={cn('press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm', tab === t ? 'bg-pill text-fg' : 'text-fg-3 hover:text-fg')}>
            {t === 'poh' ? <BookOpen className="size-4" /> : <CloudSun className="size-4" />}{t === 'poh' ? 'POH' : 'Weather briefing'}
          </button>
        ))}
        <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={r.close} aria-label="Close references"><X /></Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Select value={doc?.id ?? ''} onChange={e => r.set({ docId: { ...docId, [tab]: Number(e.target.value) || null } })} className="min-w-0 flex-1" aria-label="Document">
          {!ranked.length && <option value="">{tab === 'poh' ? 'No POH uploaded' : 'No briefing yet'}</option>}
          {ranked.map(d => <option key={d.id} value={d.id}>{d.title}{d.route?.length ? ` (${d.route.join('–')})` : ''} · {new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</option>)}
        </Select>
        <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} loading={docs.upload.isPending}><Upload />Upload</Button>
        {tab === 'briefing' && <Button size="sm" variant="ghost" loading={docs.importBriefings.isPending} onClick={() => docs.importBriefings.mutate(undefined, { onSuccess: d => toast.success(d.added ? `${d.added} briefing${d.added > 1 ? 's' : ''} imported` : 'No new briefings in email'), onError: e => toast.error(e.message) })}><Mail />From email</Button>}
        {src && <Button asChild size="sm" variant="ghost"><a href={src} target="_blank" rel="noopener noreferrer"><ExternalLink />Open</a></Button>}
      </div>
      {tab === 'poh' && doc && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {[['Limits', 'limits'], ['Speeds', 'speeds'], ['Checklists', 'checklist'], ['Emergency', 'emergency'], ['Takeoff 5-5', 'takeoff'], ['Climb 5-7', 'climb'], ['Cruise 5-8', 'cruise'], ['Landing 5-11', 'landing'], ['W&B 6-5', 'wb']].map(([l, k]) => (
            <button key={k} onClick={() => r.show('poh', (doc.page_map ?? POH_PAGES_172P)[k])} className={cn('h-7 rounded-full px-2.5 text-xs ring-1 ring-inset ring-border', page === (doc.page_map ?? POH_PAGES_172P)[k] ? 'bg-pill text-fg' : 'text-fg-3 hover:text-fg')}>{l}</button>
          ))}
        </div>
      )}
      {tab === 'briefing' && doc && <Synced className="px-3 pb-2" at={doc.created_at} label={doc.source === 'gmail' ? 'Received' : 'Uploaded'} source={doc.source === 'gmail' ? 'Leidos Flight Service (email)' : doc.filename ?? ''} />}
      <div className="min-h-0 flex-1 px-1 pb-1">
        {src ? <iframe key={src} title={doc!.title} src={src} className="h-full w-full rounded-lg bg-white" />
          : <div className="grid h-full place-items-center p-6 text-center text-sm text-fg-3">{tab === 'poh' ? 'Upload this aircraft\'s POH (PDF) to keep it open while you plan.' : 'Get a standard briefing at 1800wxbrief.com with "email the briefing" on, then press From email — or upload the PDF.'}</div>}
      </div>
    </div>
  )
}

function score(d: PlannerDoc, tab: Tab, model: string | null, route: string[], date: string) {
  const age = -Date.parse(d.created_at) / 1e12
  if (tab === 'poh') return (model && d.model && model.toUpperCase().includes(d.model) ? 10 : 0) + age
  const r = d.route || []
  const same = route.length >= 2 && r[0] === route[0] && r.includes(route[route.length - 1] === route[0] ? route[1] : route[route.length - 1]) ? 5 : 0
  const sameDay = d.created_at.slice(0, 10) === date ? 3 : 0
  return same + sameDay + Date.parse(d.created_at) / 1e13
}

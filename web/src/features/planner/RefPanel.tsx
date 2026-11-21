import { createContext, useContext, useMemo, useRef, useState } from 'react'
import { BookOpen, Download, ExternalLink, Mail, PanelRightClose, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useDocuments, type PlannerDoc } from './api'
import { POH_PAGES_172P } from './poh'
import { Synced } from './ui'
import { ChecklistSteps } from './ChecklistSteps'
import { Segmented } from '@/components/ui/misc'

type DocTab = 'poh' | 'checklist' | 'briefing'
export type Tab = 'fixes' | 'workings' | DocTab
const TABS: { key: Tab; label: string }[] = [{ key: 'fixes', label: 'Fixes' }, { key: 'workings', label: 'Workings' }, { key: 'poh', label: 'POH' }, { key: 'checklist', label: 'Checklist' }, { key: 'briefing', label: 'Briefing' }]
export const isDocTab = (t: Tab): t is DocTab => t === 'poh' || t === 'checklist' || t === 'briefing'
// page: a page number, or a figure key ("takeoff") looked up in the open POH's page map.
// docTail: the tail the POH/checklist were picked for; a different tail goes back to its own documents.
interface RefState { open: boolean; tab: Tab; page: number | string | null; docId: Record<DocTab, number | null>; docTail: string | null }
interface RefApi { state: RefState; show: (tab: Tab, page?: string | number | null) => void; close: () => void; set: (s: Partial<RefState>) => void }
const Ctx = createContext<RefApi | null>(null)
export const useRefs = () => useContext(Ctx)

export function RefProvider({ children }: { children: React.ReactNode }) {
  // Open beside the plan on wide screens; a full-screen sheet on demand elsewhere.
  const wide = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 80rem)').matches
  const [state, setState] = useState<RefState>({ open: !!wide, tab: 'fixes', page: null, docId: { poh: null, checklist: null, briefing: null }, docTail: null })
  const api = useMemo<RefApi>(() => ({
    state,
    show: (tab, page) => setState(s => ({ ...s, open: true, tab, page: page ?? null })),
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

// The plan's sidebar: what to fix, the workings (assumptions, calculations,
// sources), and the documents (POH, checklist, weather briefing).
// Opens the sidebar's workings (the arithmetic behind the numbers).
export function WorkingsLink({ children }: { children: React.ReactNode }) {
  const r = useRefs()
  return <button type="button" onClick={() => r?.show('workings')} className="text-accent hover:underline">{children}</button>
}

export function RefPanel({ tail, model, route, date, className, pohDoc, pohLoading, pohStatus, panes, fixCount, fixTone = 'neutral' }: { tail: string | null; model: string | null; route: string[]; date: string; className?: string; pohDoc?: PlannerDoc | null; pohLoading?: boolean; pohStatus?: string | null; panes: { fixes: React.ReactNode; workings: React.ReactNode }; fixCount: number; fixTone?: 'bad' | 'warn' | 'neutral' }) {
  const r = useRefs()!
  return (
    <div className={cn('flex h-full min-h-0 flex-col rounded-xl bg-card ring-1 ring-inset ring-white/[0.04]', className)}>
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        <div role="tablist" aria-label="Sidebar" className="scrollbar-none flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
        {TABS.map(t => (
          <span key={t.key} className="contents">
          {t.key === 'poh' && <span aria-hidden className="mx-1 my-2 w-px shrink-0 bg-border" />}
          <button role="tab" aria-selected={r.state.tab === t.key} onClick={() => r.set({ tab: t.key, page: null })}
            className={cn('press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm', r.state.tab === t.key ? 'bg-pill font-medium text-fg' : 'text-fg-3 hover:text-fg')}>
            {t.label}{t.key === 'fixes' && fixCount > 0 && <span className={cn('num rounded-full px-1.5 text-xs font-medium', { bad: 'bg-bad-soft text-bad', warn: 'bg-warn-soft text-warn', neutral: 'bg-hover text-fg-2' }[fixTone])}>{fixCount}</span>}
          </button>
          </span>
        ))}
        </div>
        <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={r.close} aria-label="Close the sidebar"><X className="xl:hidden" /><PanelRightClose className="max-xl:hidden" /></Button>
      </div>
      {isDocTab(r.state.tab) ? <DocPane tail={tail} model={model} route={route} date={date} pohDoc={pohDoc} pohLoading={pohLoading} pohStatus={pohStatus} />
        : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{panes[r.state.tab]}</div>}
    </div>
  )
}

function DocPane({ tail, model, route, date, pohDoc, pohLoading, pohStatus }: { tail: string | null; model: string | null; route: string[]; date: string; pohDoc?: PlannerDoc | null; pohLoading?: boolean; pohStatus?: string | null }) {
  const r = useRefs()!
  const docs = useDocuments()
  const fileRef = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<'steps' | 'original'>('steps')
  const { page, docId } = r.state
  const tab = r.state.tab as DocTab
  const pohDocId = pohDoc?.id ?? null
  const ranked = useMemo(() => {
    let list = (docs.data || []).filter(d => d.kind === tab)
    // The POH the server found for this tail may be newer than the documents list.
    if (tab === 'poh' && pohDoc && !list.some(d => d.id === pohDoc.id)) list = [pohDoc, ...list]
    // POH and checklist: only this tail's or this model's; another airplane's is never shown by default.
    const mine = tab !== 'briefing' && (tail || model) ? list.filter(d => d.id === pohDocId || (tail && d.tail_number === tail) || modelMatch(d, model)) : list
    // POH: the one found for this tail first; then same tail, same model; briefing: same route, newest.
    return [...mine].sort((a, b) => (tab === 'poh' && pohDocId ? Number(b.id === pohDocId) - Number(a.id === pohDocId) : 0) || score(b, tab, model, route, date, tail) - score(a, tab, model, route, date, tail))
  }, [docs.data, tab, pohDoc, pohDocId, model, route, date, tail])
  const others = (docs.data || []).filter(d => d.kind === tab && !ranked.includes(d))
  // A document you picked sticks only for the tail you picked it for.
  const picked = tab === 'briefing' || r.state.docTail === tail ? docId[tab] : null
  const doc = ranked.find(d => d.id === picked) ?? others.find(d => d.id === picked) ?? (tab === 'poh' && pohLoading ? null : ranked[0] ?? null)
  // Figure → page from this document's own map (an upload has none; the 172P copies do).
  const pages = doc?.page_map ?? (doc && doc.source !== 'upload' && doc.model === '172P' ? POH_PAGES_172P : null)
  const pageNo = tab !== 'poh' ? null : typeof page === 'number' ? page : page && pages ? pages[page] ?? null : null
  const src = doc ? `/api/planner/documents/${doc.id}/file#${pageNo ? `page=${pageNo}&` : ''}view=FitH` : null
  const upload = (f: File) => docs.upload.mutate({ file: f, kind: tab, tail: tab !== 'briefing' ? tail ?? undefined : undefined, model: tab !== 'briefing' ? model ?? undefined : undefined, route: tab === 'briefing' ? route.join(' ') : undefined, title: tab !== 'briefing' && tail ? `${tail} ${tab === 'poh' ? 'POH' : 'checklist'} (${f.name.replace(/\.(pdf|png|jpe?g)$/i, '')})` : undefined },
    { onSuccess: d => { if (tab === 'checklist') { r.set({ docId: { ...docId, checklist: d.id }, docTail: tail }); setView('steps'); docs.extract.mutate(d.id) } toast.success(tab === 'briefing' ? 'Uploaded' : `Uploaded; it's now the ${tab === 'poh' ? 'POH' : 'checklist'} used for ${tail ?? 'this aircraft'}`) }, onError: e => toast.error(e.message) })

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Select value={doc?.id ?? ''} onChange={e => r.set({ docId: { ...docId, [tab]: Number(e.target.value) || null }, docTail: tab === 'briefing' ? r.state.docTail : tail })} className="min-w-0 flex-1" aria-label="Document">
          {!doc && <option value="">{tab === 'poh' && pohLoading ? `Finding the POH for ${tail ?? 'this aircraft'}…` : tab === 'poh' ? `No POH for ${tail ?? 'this aircraft'}` : tab === 'checklist' ? `No checklist for ${tail ?? 'this aircraft'}` : 'No briefing yet'}</option>}
          {ranked.map(d => <option key={d.id} value={d.id}>{label(d)}</option>)}
          {others.length > 0 && <optgroup label={tab === 'briefing' ? 'Other' : 'Other aircraft'}>{others.map(d => <option key={d.id} value={d.id}>{label(d)}</option>)}</optgroup>}
        </Select>
        <input ref={fileRef} type="file" accept={tab === 'checklist' ? 'application/pdf,image/png,image/jpeg' : 'application/pdf'} hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} loading={docs.upload.isPending}><Upload />Upload</Button>
        {tab === 'briefing' && <Button size="sm" variant="ghost" loading={docs.importBriefings.isPending} onClick={() => docs.importBriefings.mutate(undefined, { onSuccess: d => toast.success(d.added ? `${d.added} briefing${d.added > 1 ? 's' : ''} imported` : 'No new briefings in email'), onError: e => toast.error(e.message) })}><Mail />From email</Button>}
        {src && <Button asChild size="sm" variant="ghost"><a href={src} target="_blank" rel="noopener noreferrer"><ExternalLink />Open</a></Button>}
        {doc && <Button asChild size="sm" variant="ghost"><a href={`/api/planner/documents/${doc.id}/file?download=1`} download={doc.filename ?? `${doc.title}.pdf`}><Download />Download</a></Button>}
      </div>
      {tab === 'poh' && doc && pages && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {[['Limits', 'limits'], ['Speeds', 'speeds'], ['Checklists', 'checklist'], ['Emergency', 'emergency'], ['Takeoff 5-5', 'takeoff'], ['Climb 5-7', 'climb'], ['Cruise 5-8', 'cruise'], ['Landing 5-11', 'landing'], ['W&B 6-5', 'wb']].map(([l, k]) => (
            <button key={k} onClick={() => r.show('poh', k)} className={cn('h-7 rounded-full px-2.5 text-xs ring-1 ring-inset ring-border', pageNo === pages[k] ? 'bg-pill text-fg' : 'text-fg-3 hover:text-fg')}>{l}</button>
          ))}
        </div>
      )}
      {tab === 'poh' && pohStatus && <p className="px-3 pb-2 text-xs text-fg-3">{pohStatus}</p>}
      {tab === 'briefing' && doc && <Synced className="px-3 pb-2" at={doc.created_at} label={doc.source === 'gmail' ? 'Received' : 'Uploaded'} source={doc.source === 'gmail' ? 'Leidos Flight Service (email)' : doc.filename ?? ''} />}
      {tab === 'checklist' && doc && <div className="px-3 pb-2"><Segmented size="sm" value={view} onChange={setView} options={[{ value: 'steps', label: 'Steps' }, { value: 'original', label: doc.content_type?.startsWith('image/') ? 'Photo' : 'PDF' }]} /></div>}
      <div className="min-h-0 flex-1 px-1 pb-1">
        {tab === 'checklist' && doc && view === 'steps' ? (docs.extract.isPending && docs.extract.variables === doc.id ? <div className="grid h-full place-items-center text-sm text-fg-3">Reading the checklist…</div> : <ChecklistSteps doc={doc} />) : src ? <iframe key={src} title={doc!.title} src={src} className="h-full w-full rounded-lg bg-white" />
          : <div className="grid h-full place-items-center p-6 text-center text-sm text-fg-3">{tab === 'poh' ? (pohLoading ? `Finding the POH for ${tail ?? 'this aircraft'}…` : `No POH found for ${tail ?? 'this aircraft'}${model ? ` (${model})` : ''}. Upload one (PDF) to keep it open while you plan.`) : tab === 'checklist' ? 'Upload the checklist you fly with (PDF or a photo); the newest one for this tail is used, and its steps are read out so you can tick through them.' : 'Get a standard briefing at 1800wxbrief.com with "email the briefing" on, then press From email — or upload the PDF.'}</div>}
      </div>
    </>
  )
}

const label = (d: PlannerDoc) => `${d.title}${d.route?.length ? ` (${d.route.join('–')})` : ''} · ${new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
const modelMatch = (d: PlannerDoc, model: string | null) => !!(model && d.model && model.toUpperCase().includes(d.model.toUpperCase()))

// POH and checklist: this tail's newest upload, then this model's; briefing: same route, same day, newest.
function score(d: PlannerDoc, tab: DocTab, model: string | null, route: string[], date: string, tail: string | null) {
  const newer = Date.parse(d.created_at) / 1e13
  if (tab !== 'briefing') return (tail && d.tail_number === tail ? 20 : 0) + (model && d.model && model.toUpperCase().includes(d.model) ? 10 : 0) + newer
  const r = d.route || []
  const same = route.length >= 2 && r[0] === route[0] && r.includes(route[route.length - 1] === route[0] ? route[1] : route[route.length - 1]) ? 5 : 0
  const sameDay = d.created_at.slice(0, 10) === date ? 3 : 0
  return same + sameDay + Date.parse(d.created_at) / 1e13
}

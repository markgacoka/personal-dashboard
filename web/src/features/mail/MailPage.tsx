import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Drawer } from 'vaul'
import { Archive, Bell, CheckCircle2, Clock, FileText, Folder, FolderPlus, Inbox, Mail, MailOpen, Menu as MenuIcon, Newspaper, Paperclip, PenSquare, Plus, RefreshCw, Search, Send, Settings, ShieldAlert, Star, Tag, Trash2, X, ShieldCheck, Plug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { EmptyState, Kbd, Segmented, Skeleton, Tooltip } from '@/components/ui/misc'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm } from '@/components/ui/overlay'
import { mailDate, mailDateLong } from '@/lib/format'
import { cn } from '@/lib/utils'
import { labelColor, mail, mailPost, ROLE_NAMES, unreadCount, useMailBoot, type Followup, type MailBoot, type Scheduled, type ThreadRow } from './api'
import { removesFromView, useMailAction, type MailAction } from './actions'
import { ComposerProvider, useComposer } from './Composer'
import { Reader, ReaderEmpty } from './Reader'

const readTab = () => { try { return (localStorage.getItem('mail-tab') as 'important' | 'other') || 'important' } catch { return 'important' as const } }

export default function MailPage() {
  return <ComposerProvider><MailClient /></ComposerProvider>
}

function MailClient() {
  const { folder: rawFolder = 'inbox', threadId } = useParams()
  const folder = decodeURIComponent(rawFolder)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const compose = useComposer()
  const { data: boot, isLoading, isError, error, refetch } = useMailBoot()
  const [q, setQ] = useState('')
  const [draftQ, setDraftQ] = useState('')
  const [tab, setTab] = useState(readTab)
  const [railOpen, setRailOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { const t = setTimeout(() => setQ(draftQ.trim()), 350); return () => clearTimeout(t) }, [draftQ])
  useEffect(() => { if (params.get('compose') === '1' && boot?.configured) { compose({ mode: 'new' }); setParams(p => { p.delete('compose'); return p }, { replace: true }) } }, [params, boot, compose, setParams])
  useEffect(() => setRailOpen(false), [folder])

  const go = (f: string, t?: string) => navigate(`/mail/${encodeURIComponent(f)}${t ? `/${encodeURIComponent(t)}` : ''}`)

  if (isLoading) return <div className="flex-1 p-6"><Skeleton className="h-full min-h-96" /></div>
  if (isError) return <EmptyState icon={Plug} title="Mail is unreachable" className="flex-1" action={<Button onClick={() => refetch()}>Try again</Button>}>{(error as Error).message}</EmptyState>
  if (!boot?.configured) return <EmptyState icon={Mail} title="Mail isn’t set up on this server yet" className="flex-1">Configure MAIL_JMAP_URL, MAIL_USER and MAIL_PASSWORD — see docs/mail.md.</EmptyState>

  const rail = <Rail boot={boot} folder={folder} onPick={f => go(f)} onCompose={() => compose({ mode: 'new' })} />
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-1 pb-16 lg:pb-0">
      <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-border bg-sunken/50 p-3 lg:block">{rail}</aside>
      <Drawer.Root open={railOpen} onOpenChange={setRailOpen} direction="left">
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r border-border bg-card p-3 outline-none"><Drawer.Title className="sr-only">Mail folders</Drawer.Title>{rail}</Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <section className={cn('flex min-w-0 flex-col border-r border-border xl:w-[420px] xl:shrink-0 2xl:w-[480px]', threadId ? 'hidden xl:flex' : 'flex flex-1 xl:flex-none')}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setRailOpen(true)} aria-label="Folders"><MenuIcon /></Button>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <Input ref={searchRef} value={draftQ} onChange={e => setDraftQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setQ(draftQ.trim()); if (e.key === 'Escape') { setDraftQ(''); setQ(''); searchRef.current?.blur() } }}
              placeholder="Search mail" aria-label="Search mail" title="Words, or from: to: subject: has:attachment is:unread is:starred label: in: before: after:" className="h-8 pl-8 pr-8" />
            {draftQ && <button onClick={() => { setDraftQ(''); setQ('') }} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg" aria-label="Clear search"><X className="size-4" /></button>}
          </div>
          <Button variant="primary" size="icon-sm" className="lg:hidden" onClick={() => compose({ mode: 'new' })} aria-label="Compose"><PenSquare /></Button>
        </div>
        <ThreadList boot={boot} folder={folder} q={q} tab={tab} setTab={t => { setTab(t); try { localStorage.setItem('mail-tab', t) } catch { /* */ } }} openId={threadId} onOpen={id => go(folder, id)} searchRef={searchRef} />
      </section>

      <section className={cn('min-w-0 flex-1', threadId ? 'block' : 'hidden xl:block')}>
        {threadId ? <Reader key={threadId} threadId={decodeURIComponent(threadId)} folder={folder} boot={boot} onClose={() => go(folder)} /> : <ReaderEmpty />}
      </section>
    </div>
  )
}

// ── Folder rail ──────────────────────────────────────────────────────────────
function Rail({ boot, folder, onPick, onCompose }: { boot: MailBoot; folder: string; onPick: (f: string) => void; onCompose: () => void }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState<'folder' | 'label' | null>(null)
  const [name, setName] = useState('')
  const role = (r: string) => boot.folders.find(f => f.role === r)
  const custom = boot.folders.filter(f => !f.role).sort((a, b) => a.name.localeCompare(b.name))
  const count = (n?: number) => (n ? <span className="num ml-auto text-xs text-fg-3">{n > 999 ? '999+' : n}</span> : null)
  const Item = ({ k, icon: I, label, n, strong, dot }: { k: string; icon?: typeof Inbox; label: string; n?: number; strong?: boolean; dot?: string }) => (
    <button onClick={() => onPick(k)} aria-current={folder === k ? 'page' : undefined}
      className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-fg-2 hover:bg-hover hover:text-fg', folder === k && 'bg-card font-medium text-fg shadow-card ring-1 ring-border')}>
      {dot ? <span className="size-2.5 shrink-0 rounded-full" style={{ background: dot }} /> : I && <I className="size-4 shrink-0" strokeWidth={1.9} />}
      <span className="truncate">{label}</span>
      {strong && n ? <span className="num ml-auto rounded-full bg-accent px-1.5 text-[11px] font-medium leading-[18px] text-accent-fg">{n}</span> : count(n)}
    </button>
  )
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) { setAdding(null); return }
    try {
      if (adding === 'folder') { const { id } = await mailPost<{ id: string }>('/folders', { name: n }); await qc.invalidateQueries({ queryKey: ['mail', 'boot'] }); onPick(id) }
      else { await mailPost('/labels', { name: n }); await qc.invalidateQueries({ queryKey: ['mail', 'boot'] }) }
      setAdding(null); setName('')
    } catch (err) { toast.error((err as Error).message) }
  }
  const Section = ({ label, kind, children }: { label: string; kind: 'folder' | 'label'; children: React.ReactNode }) => (
    <div className="mt-5">
      <div className="flex items-center justify-between px-2.5 pb-1"><span className="text-xs font-medium text-fg-3">{label}</span><button onClick={() => { setAdding(kind); setName('') }} className="text-fg-3 hover:text-fg" aria-label={`New ${kind}`}><Plus className="size-4" /></button></div>
      {adding === kind && <form onSubmit={create} className="mb-1 flex gap-1 px-1"><Input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Escape' && setAdding(null)} placeholder={`${kind === 'folder' ? 'Folder' : 'Label'} name`} maxLength={60} className="h-8" /><Button size="sm" type="submit">Add</Button></form>}
      <div className="space-y-0.5">{children}</div>
    </div>
  )
  return (
    <div>
      <Button variant="primary" className="mb-4 w-full" onClick={onCompose}><PenSquare />Compose<Kbd className="ml-auto border-accent-fg/30 bg-transparent text-accent-fg/80">C</Kbd></Button>
      <div className="space-y-0.5">
        <Item k="inbox" icon={Inbox} label="Inbox" n={unreadCount(boot)} strong />
        <Item k="starred" icon={Star} label="Starred" />
        <Item k="followups" icon={Bell} label="Follow-ups" n={boot.counts.followupsDue} strong />
        <Item k="scheduled" icon={Clock} label="Scheduled" n={boot.counts.scheduled} />
        <Item k="drafts" icon={FileText} label="Drafts" n={role('drafts')?.total} />
        <Item k="sent" icon={Send} label="Sent" />
        <Item k="archive" icon={Archive} label="Archive" />
        <Item k="junk" icon={ShieldAlert} label="Spam" n={role('junk')?.unread} />
        <Item k="trash" icon={Trash2} label="Trash" />
        <Item k="all" icon={Mail} label="All mail" />
      </div>
      <Section label="Folders" kind="folder">
        {custom.map(f => <Item key={f.id} k={f.id} icon={Folder} label={f.name} n={f.unread} />)}
        {!custom.length && adding !== 'folder' && <p className="px-2.5 text-xs text-fg-3">Folders hold mail moved out of the inbox.</p>}
      </Section>
      <Section label="Labels" kind="label">
        {boot.labels.map(l => <Item key={l.id} k={`label:${l.id}`} label={l.name} dot={labelColor(l.color)} />)}
        {!boot.labels.length && adding !== 'label' && <p className="px-2.5 text-xs text-fg-3">Labels tag conversations across folders.</p>}
      </Section>
      <Link to="/mail/settings" className="mt-5 flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-fg-3 hover:bg-hover hover:text-fg"><Settings className="size-4" />Mail settings</Link>
      <div className="mt-2 px-2.5 text-xs text-fg-3">{boot.address}</div>
    </div>
  )
}

// ── Thread list ──────────────────────────────────────────────────────────────
function folderTitle(boot: MailBoot, folder: string) {
  if (folder.startsWith('label:')) return boot.labels.find(l => String(l.id) === folder.slice(6))?.name || 'Label'
  const virtual: Record<string, string> = { starred: 'Starred', all: 'All mail', scheduled: 'Scheduled', followups: 'Follow-ups' }
  if (virtual[folder]) return virtual[folder]
  const f = boot.folders.find(x => x.role === folder || x.id === folder)
  return f ? (f.role ? ROLE_NAMES[f.role] || f.name : f.name) : 'Mail'
}

function ThreadList({ boot, folder, q, tab, setTab, openId, onOpen, searchRef }: { boot: MailBoot; folder: string; q: string; tab: 'important' | 'other'; setTab: (t: 'important' | 'other') => void; openId?: string; onOpen: (id: string) => void; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const qc = useQueryClient()
  const act = useMailAction(folder)
  const compose = useComposer()
  const confirm = useConfirm()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState(0)
  useEffect(() => { setSelected(new Set()); setCursor(0) }, [folder, q, tab])
  const split = folder === 'inbox' && boot.settings.splitInbox && !q

  const list = useInfiniteQuery({
    queryKey: ['mail', 'threads', folder, split ? tab : '', q],
    enabled: folder !== 'scheduled' && folder !== 'followups',
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ position: String(pageParam), limit: '50' })
      if (folder.startsWith('label:')) { p.set('folder', 'all'); p.set('label', folder.slice(6)) } else p.set('folder', folder)
      if (split) p.set('tab', tab)
      if (q) { p.set('q', q); if (folder === 'inbox') p.set('folder', 'all') }
      return mail<{ threads: ThreadRow[]; total: number }>(`/threads?${p}`)
    },
    getNextPageParam: (last, all) => { const n = all.reduce((s, x) => s + x.threads.length, 0); return n < last.total ? n : undefined },
    staleTime: 30_000,
  })
  const threads = useMemo(() => list.data?.pages.flatMap(p => p.threads) || [], [list.data])
  const total = list.data?.pages[0]?.total ?? 0

  const doAct = async (ids: string[], a: MailAction, extra?: Record<string, unknown>) => {
    if (removesFromView(a, folder)) qc.setQueryData(['mail', 'threads', folder, split ? tab : '', q], (d: typeof list.data) => d && { ...d, pages: d.pages.map(p => ({ ...p, threads: p.threads.filter(t => !ids.includes(t.threadId)) })) })
    setSelected(s => { const x = new Set(s); ids.forEach(i => x.delete(i)); return x })
    await act(ids, a, extra)
  }

  // Keyboard: j/k move, Enter/o open, e archive, # trash, s star, x select, c compose, / search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input,textarea,select,[contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
      const t = threads[cursor]
      if (e.key === 'j') setCursor(c => Math.min(threads.length - 1, c + 1))
      else if (e.key === 'k') setCursor(c => Math.max(0, c - 1))
      else if ((e.key === 'Enter' || e.key === 'o') && t) onOpen(t.threadId)
      else if (e.key === 'c') { e.preventDefault(); compose({ mode: 'new' }) }
      else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
      else if (e.key === 'e' && (t || openId) && folder === 'inbox') doAct([openId || t.threadId], 'archive')
      else if (e.key === '#' && (t || openId)) doAct([openId || t.threadId], 'trash')
      else if (e.key === 's' && t) doAct([t.threadId], t.starred ? 'unstar' : 'star')
      else if (e.key === 'x' && t) setSelected(s => { const x = new Set(s); if (x.has(t.threadId)) x.delete(t.threadId); else x.add(t.threadId); return x })
      else return
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => { document.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' }) }, [cursor])

  const title = q ? 'Search results' : folderTitle(boot, folder)
  const n = selected.size
  const inTrashOrJunk = folder === 'trash' || folder === 'junk'
  const custom = boot.folders.filter(f => !f.role).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        {n > 0 ? <>
          <input type="checkbox" aria-label="Select all" checked={n === threads.length} onChange={e => setSelected(e.target.checked ? new Set(threads.map(t => t.threadId)) : new Set())} className="size-4 accent-[var(--accent)]" />
          <span className="text-sm font-medium">{n} selected</span>
          <div className="ml-auto flex items-center">
            {inTrashOrJunk ? <Tooltip content="Move to Inbox"><Button variant="ghost" size="icon-sm" onClick={() => doAct([...selected], 'inbox')}><Inbox /></Button></Tooltip> : <Tooltip content="Archive"><Button variant="ghost" size="icon-sm" onClick={() => doAct([...selected], 'archive')}><Archive /></Button></Tooltip>}
            {inTrashOrJunk ? <Tooltip content="Delete forever"><Button variant="ghost" size="icon-sm" onClick={async () => { if (await confirm({ title: `Delete ${n} permanently?`, confirm: 'Delete forever', danger: true })) doAct([...selected], 'delete') }}><Trash2 /></Button></Tooltip> : <Tooltip content="Trash"><Button variant="ghost" size="icon-sm" onClick={() => doAct([...selected], 'trash')}><Trash2 /></Button></Tooltip>}
            <Tooltip content="Mark read"><Button variant="ghost" size="icon-sm" onClick={() => doAct([...selected], 'read')}><MailOpen /></Button></Tooltip>
            <Tooltip content="Mark unread"><Button variant="ghost" size="icon-sm" onClick={() => doAct([...selected], 'unread')}><Mail /></Button></Tooltip>
            <Menu>
              <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Label"><Tag /></Button></MenuTrigger>
              <MenuContent>{boot.labels.length ? boot.labels.map(l => <MenuItem key={l.id} onSelect={() => doAct([...selected], 'label', { labelId: l.id })}><span className="size-2.5 rounded-full" style={{ background: labelColor(l.color) }} />{l.name}</MenuItem>) : <div className="px-2 py-1.5 text-sm text-fg-3">No labels yet</div>}</MenuContent>
            </Menu>
            <Menu>
              <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Move"><FolderPlus /></Button></MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => doAct([...selected], 'inbox')}><Inbox />Inbox</MenuItem>
                <MenuItem onSelect={() => doAct([...selected], 'archive')}><Archive />Archive</MenuItem>
                {custom.map(f => <MenuItem key={f.id} onSelect={() => doAct([...selected], 'move', { folderId: f.id })}><Folder />{f.name}</MenuItem>)}
                <MenuSeparator />
                <MenuItem onSelect={() => doAct([...selected], 'spam')}><ShieldAlert />Spam</MenuItem>
              </MenuContent>
            </Menu>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </> : <>
          <h2 className="text-sm font-semibold">{title}</h2>
          {!q && total > 0 && <span className="num text-xs text-fg-3">{total}</span>}
          {split && <Segmented size="sm" className="ml-auto" value={tab} onChange={setTab} options={[{ value: 'important', label: 'Important', count: boot.counts.inboxImportant || undefined }, { value: 'other', label: 'Other', count: boot.counts.inboxOther || undefined }]} />}
          {inTrashOrJunk && threads.length > 0 && !q && <Button variant="ghost" size="sm" className="ml-auto text-bad" onClick={async () => {
            if (!await confirm({ title: `Empty ${folder === 'trash' ? 'Trash' : 'Spam'}?`, body: 'Everything in it is deleted permanently.', confirm: 'Empty now', danger: true })) return
            try { const { deleted } = await mailPost<{ deleted: number }>(`/empty/${folder}`); toast(`${deleted} message${deleted === 1 ? '' : 's'} deleted`); qc.invalidateQueries({ queryKey: ['mail'] }) } catch (e) { toast.error((e as Error).message) }
          }}>Empty {folder === 'trash' ? 'Trash' : 'Spam'}</Button>}
          <Tooltip content="Check for new mail"><Button variant="ghost" size="icon-sm" className={cn(!split && !inTrashOrJunk && 'ml-auto')} onClick={() => qc.invalidateQueries({ queryKey: ['mail'] })} aria-label="Refresh"><RefreshCw className={cn((list.isFetching) && 'animate-spin')} /></Button></Tooltip>
        </>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {folder === 'scheduled' ? <ScheduledList /> : folder === 'followups' ? <FollowupList onOpen={onOpen} /> : list.isLoading ? (
          <div className="space-y-px">{Array.from({ length: 8 }, (_, i) => <div key={i} className="space-y-2 px-4 py-3"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-3 w-4/5" /></div>)}</div>
        ) : list.isError ? <EmptyState icon={Plug} title="Couldn’t load mail" action={<Button onClick={() => list.refetch()}>Try again</Button>}>{(list.error as Error).message}</EmptyState>
          : !threads.length ? <ListEmpty boot={boot} folder={folder} q={q} tab={tab} /> : (
          <>
            <ul>
              {threads.map((t, i) => {
                const who = ['sent', 'drafts', 'scheduled'].includes(folder) ? `To: ${t.to.join(', ') || '(no recipients)'}` : t.participants.join(', ') || '(unknown sender)'
                const labels = t.labels.map(k => boot.labels.find(l => l.keyword === k)).filter(Boolean) as MailBoot['labels']
                const sel = selected.has(t.threadId)
                return (
                  <li key={t.threadId} data-row={i} className={cn('group relative flex gap-2 border-b border-border px-3 py-2.5 hover:bg-hover', openId === t.threadId && 'bg-accent-soft hover:bg-accent-soft', sel && 'bg-accent-soft', cursor === i && 'shadow-[inset_2px_0_0_var(--accent)]')}>
                    <div className="flex flex-col items-center gap-1.5 pt-0.5">
                      <input type="checkbox" aria-label="Select conversation" checked={sel} onChange={e => setSelected(s => { const x = new Set(s); if (e.target.checked) x.add(t.threadId); else x.delete(t.threadId); return x })} className="size-4 accent-[var(--accent)] opacity-40 group-hover:opacity-100 checked:opacity-100" />
                      <button aria-label={t.starred ? 'Unstar' : 'Star'} aria-pressed={t.starred} onClick={() => doAct([t.threadId], t.starred ? 'unstar' : 'star')}><Star className={cn('size-4', t.starred ? 'fill-warn text-warn' : 'text-fg-3 opacity-40 group-hover:opacity-100')} /></button>
                    </div>
                    <button className="min-w-0 flex-1 text-left" onClick={() => { setCursor(i); if (t.draft && t.count === 1 && folder === 'drafts') compose({ mode: 'draft', emailId: t.emailId }); else onOpen(t.threadId) }}>
                      <div className="flex items-baseline gap-2">
                        {t.unread && <span className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-accent" />}
                        <span className={cn('truncate text-sm', t.unread ? 'font-semibold text-fg' : 'text-fg-2')}>{who}</span>
                        {t.count > 1 && <span className="num text-xs text-fg-3">{t.count}</span>}
                        {t.hasAttachment && <Paperclip className="size-3.5 shrink-0 text-fg-3" />}
                        <time className="ml-auto shrink-0 text-xs text-fg-3 group-hover:invisible" dateTime={t.date}>{mailDate(t.date)}</time>
                      </div>
                      <div className={cn('truncate text-sm', t.unread ? 'font-medium text-fg' : 'text-fg-2')}>{t.subject || '(no subject)'}</div>
                      <div className="truncate text-sm text-fg-3">{t.preview}</div>
                      {(labels.length > 0 || t.draft || t.scheduledAt) && <div className="mt-1 flex flex-wrap gap-1">
                        {t.draft && <Badge tone="bad">Draft</Badge>}
                        {t.scheduledAt && <Badge tone="warn"><Clock />{mailDateLong(t.scheduledAt)}</Badge>}
                        {labels.map(l => <span key={l.id} className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium ring-1 ring-inset ring-border"><span className="size-1.5 rounded-full" style={{ background: labelColor(l.color) }} />{l.name}</span>)}
                      </div>}
                    </button>
                    <div className="absolute right-2 top-2 hidden items-center rounded-md border border-border bg-card shadow-card group-hover:flex">
                      {folder === 'inbox' && <Tooltip content="Archive (e)"><Button variant="ghost" size="icon-sm" onClick={() => doAct([t.threadId], 'archive')}><Archive /></Button></Tooltip>}
                      {folder !== 'trash' && <Tooltip content="Trash (#)"><Button variant="ghost" size="icon-sm" onClick={() => doAct([t.threadId], 'trash')}><Trash2 /></Button></Tooltip>}
                      <Tooltip content={t.unread ? 'Mark read' : 'Mark unread'}><Button variant="ghost" size="icon-sm" onClick={() => doAct([t.threadId], t.unread ? 'read' : 'unread')}>{t.unread ? <MailOpen /> : <Mail />}</Button></Tooltip>
                    </div>
                  </li>
                )
              })}
            </ul>
            {list.hasNextPage && <div className="p-3 text-center"><Button size="sm" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Show {total - threads.length} older</Button></div>}
          </>
        )}
      </div>
      <div className="hidden shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 text-xs text-fg-3 xl:flex"><span><Kbd>j</Kbd> <Kbd>k</Kbd> move</span><span><Kbd>e</Kbd> archive</span><span><Kbd>#</Kbd> trash</span><span><Kbd>c</Kbd> compose</span><span><Kbd>/</Kbd> search</span></div>
    </div>
  )
}

function ListEmpty({ boot, folder, q, tab }: { boot: MailBoot; folder: string; q: string; tab: string }) {
  if (q) return <EmptyState icon={Search} title="No conversations match">Try fewer words, or operators like from:, subject:, has:attachment, is:unread, before:2026-01-31.</EmptyState>
  if (folder.startsWith('label:')) return <EmptyState icon={Tag} title="No conversations with this label">Add labels from a conversation or with a filter in Mail settings.</EmptyState>
  const map: Record<string, [typeof Inbox, string, string]> = {
    inbox: tab === 'other' && boot.settings.splitInbox ? [Newspaper, 'Nothing in Other', 'Newsletters and notifications land here, away from people who write to you.'] : [CheckCircle2, 'Inbox zero', `New mail to ${boot.address} shows up here.`],
    starred: [Star, 'No starred conversations', 'Star a conversation to keep it one click away.'],
    drafts: [FileText, 'No drafts', 'Unsent messages are saved here automatically while you write.'],
    sent: [Send, 'Nothing sent yet', 'Mail you send from any of your addresses appears here.'],
    archive: [Archive, 'Archive is empty', 'Archiving takes a conversation out of the inbox without deleting it.'],
    junk: [ShieldCheck, 'No spam', 'Mail the spam filter catches waits here for 30 days.'],
    trash: [Trash2, 'Trash is empty', 'Deleted conversations stay here until you empty the trash.'],
  }
  const [I, t, d] = map[folder] || [Folder, 'This folder is empty', 'Move conversations here from the inbox, or with a filter.']
  return <EmptyState icon={I} title={t}>{d}</EmptyState>
}

function ScheduledList() {
  const qc = useQueryClient()
  const compose = useComposer()
  const { data, isLoading } = useQuery({ queryKey: ['mail', 'scheduled'], queryFn: () => mail<Scheduled[]>('/scheduled') })
  if (isLoading) return <div className="p-4"><Skeleton className="h-24" /></div>
  if (!data?.length) return <EmptyState icon={Clock} title="Nothing scheduled">Use the arrow next to Send to pick a later time. Scheduled mail waits on the server, so it goes out even when this page is closed.</EmptyState>
  return (
    <ul>{data.map(s => (
      <li key={s.id} className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">To: {s.to.join(', ')}</span><Badge tone="warn" className="ml-auto shrink-0"><Clock />{mailDateLong(s.sendAt)}</Badge></div>
          <div className="truncate text-sm">{s.subject}</div><div className="truncate text-sm text-fg-3">{s.preview}</div>
        </div>
        <Button size="sm" onClick={async () => {
          try { const { draftId } = await mailPost<{ draftId: string }>(`/submissions/${encodeURIComponent(s.id)}/cancel`); toast('Unscheduled — moved to Drafts', { action: { label: 'Edit', onClick: () => compose({ mode: 'draft', emailId: draftId }) } }); qc.invalidateQueries({ queryKey: ['mail'] }) } catch (e) { toast.error((e as Error).message) }
        }}>Cancel send</Button>
      </li>
    ))}</ul>
  )
}

function FollowupList({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['mail', 'followups'], queryFn: () => mail<{ due: Followup[]; upcoming: Followup[] }>('/followups') })
  if (isLoading) return <div className="p-4"><Skeleton className="h-24" /></div>
  if (!data?.due.length && !data?.upcoming.length) return <EmptyState icon={Bell} title="No follow-ups">When you send a message, choose a reminder and it comes back here if nobody replies in time.</EmptyState>
  const row = (f: Followup, due: boolean) => (
    <li key={f.id} className="flex items-start gap-3 border-b border-border px-4 py-3">
      <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(f.threadId)}>
        <div className="flex items-center gap-2"><span className={cn('truncate text-sm', due && 'font-semibold')}>To: {f.recipients || '(no recipients)'}</span><Badge tone={due ? 'warn' : 'neutral'} className="ml-auto shrink-0">{due ? 'No reply yet' : `Remind ${mailDate(f.dueAt)}`}</Badge></div>
        <div className="truncate text-sm">{f.subject}</div><div className="text-sm text-fg-3">Sent {mailDateLong(f.sentAt)}</div>
      </button>
      <Button size="sm" variant="ghost" onClick={async () => { try { await mailPost(`/followups/${f.id}/dismiss`); qc.invalidateQueries({ queryKey: ['mail'] }) } catch (e) { toast.error((e as Error).message) } }}>{due ? 'Done' : 'Cancel'}</Button>
    </li>
  )
  return <div>
    {!!data?.due.length && <><div className="px-4 pb-1 pt-3 text-xs font-medium text-fg-3">Due now</div><ul>{data.due.map(f => row(f, true))}</ul></>}
    {!!data?.upcoming.length && <><div className="px-4 pb-1 pt-3 text-xs font-medium text-fg-3">Waiting for a reply</div><ul>{data.upcoming.map(f => row(f, false))}</ul></>}
  </div>
}


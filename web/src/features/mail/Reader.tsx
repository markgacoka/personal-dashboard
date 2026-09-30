import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowLeft, ChevronDown, Clock, CornerUpLeft, CornerUpRight, FileText, Folder, ImageOff, Inbox, Mail, MailOpen, MoreHorizontal, Reply, ReplyAll, ShieldAlert, ShieldCheck, Star, Tag, Trash2, X, ArrowUpCircle, ArrowDownCircle, File as FileIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState, Skeleton, Tooltip } from '@/components/ui/misc'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm } from '@/components/ui/overlay'
import { bytes, mailDate, mailDateLong } from '@/lib/format'
import { cn } from '@/lib/utils'
import { mail, mailPost, labelColor, type MailBoot, type Message, type Thread, type Addr } from './api'
import { useMailAction, type MailAction } from './actions'
import { useComposer } from './Composer'

const addrText = (a?: Addr | null) => (a ? (a.name && a.name !== a.email ? a.name : a.email) : '')
export const initials = (a?: Addr | null) => {
  const parts = (a?.name || a?.email || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function Reader({ threadId, folder, boot, onClose }: { threadId: string; folder: string; boot: MailBoot; onClose: () => void }) {
  const qc = useQueryClient()
  const act = useMailAction(folder)
  const compose = useComposer()
  const confirm = useConfirm()
  const { data: t, isLoading, isError, error } = useQuery({
    queryKey: ['mail', 'thread', threadId],
    queryFn: async () => { const r = await mail<Thread>(`/threads/${encodeURIComponent(threadId)}`); qc.invalidateQueries({ queryKey: ['mail', 'boot'] }); return r },
    staleTime: 30_000,
  })

  const ctx = useMemo(() => {
    if (!t) return null
    const r = t.roles
    const visible = t.messages.filter(m => !m.mailboxIds.includes(r.trash) || t.trashedCount === 0)
    const boxes = new Set(visible.flatMap(m => m.mailboxIds))
    const kws = new Set(visible.flatMap(m => m.keywords))
    return { visible, inInbox: boxes.has(r.inbox), inTrash: t.trashedCount === 0 && boxes.has(r.trash) && !boxes.has(r.inbox), inJunk: boxes.has(r.junk), onlyDrafts: visible.every(m => m.draft), kws, starred: kws.has('$flagged'), other: kws.has('$other') }
  }, [t])

  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { scroller.current?.scrollTo(0, 0) }, [threadId])

  if (isLoading) return <div className="space-y-4 p-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-10" /><Skeleton className="h-64" /></div>
  if (isError || !t || !ctx) return <EmptyState icon={Mail} title="Couldn’t open this conversation" action={<Button onClick={onClose}>Back</Button>}>{(error as Error)?.message}</EmptyState>

  const labels = [...ctx.kws].map(k => boot.labels.find(l => l.keyword === k)).filter(Boolean) as MailBoot['labels']
  const run = async (a: MailAction, extra?: Record<string, unknown>) => {
    const ok = await act([t.threadId], a, extra)
    if (ok && ['archive', 'trash', 'spam', 'unread', 'delete', 'notspam', 'inbox', 'move'].includes(a) && !(a === 'inbox' && ctx.inInbox)) onClose()
    else if (ok) qc.invalidateQueries({ queryKey: ['mail', 'thread', threadId] })
  }
  const last = [...ctx.visible].reverse().find(m => !m.draft) || ctx.visible[ctx.visible.length - 1]
  const custom = boot.folders.filter(f => !f.role).sort((a, b) => a.name.localeCompare(b.name))
  const tb = 'hidden sm:inline'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Back to list" className="xl:hidden"><ArrowLeft /></Button>
        {ctx.inTrash || ctx.inJunk ? <Button variant="ghost" size="sm" onClick={() => run('inbox')}><Inbox /><span className={tb}>Move to Inbox</span></Button>
          : ctx.inInbox ? <Button variant="ghost" size="sm" onClick={() => run('archive')}><Archive /><span className={tb}>Archive</span></Button>
          : <Button variant="ghost" size="sm" onClick={() => run('inbox')}><Inbox /><span className={tb}>Move to Inbox</span></Button>}
        {ctx.inTrash
          ? <Button variant="danger-ghost" size="sm" onClick={async () => { if (await confirm({ title: 'Delete forever?', body: 'This conversation is permanently deleted.', confirm: 'Delete forever', danger: true })) run('delete') }}><Trash2 /><span className={tb}>Delete forever</span></Button>
          : <Button variant="ghost" size="sm" onClick={() => run('trash')}><Trash2 /><span className={tb}>Trash</span></Button>}
        <Button variant="ghost" size="sm" onClick={() => run(ctx.inJunk ? 'notspam' : 'spam')}>{ctx.inJunk ? <ShieldCheck /> : <ShieldAlert />}<span className={tb}>{ctx.inJunk ? 'Not spam' : 'Spam'}</span></Button>
        <Button variant="ghost" size="sm" onClick={() => run('unread')}><Mail /><span className={tb}>Unread</span></Button>
        <Tooltip content={ctx.starred ? 'Unstar' : 'Star'}><Button variant="ghost" size="icon-sm" aria-pressed={ctx.starred} onClick={() => run(ctx.starred ? 'unstar' : 'star')}><Star className={cn(ctx.starred && 'fill-warn text-warn')} /></Button></Tooltip>
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Label"><Tag /></Button></MenuTrigger>
          <MenuContent align="start">
            {boot.labels.map(l => { const has = ctx.kws.has(l.keyword); return <MenuItem key={l.id} onSelect={() => run(has ? 'unlabel' : 'label', { labelId: l.id })}><span className="size-2.5 rounded-full" style={{ background: labelColor(l.color) }} />{l.name}{has && <span className="ml-auto text-xs text-fg-3">Remove</span>}</MenuItem> })}
            {!boot.labels.length && <div className="px-2 py-1.5 text-sm text-fg-3">No labels yet</div>}
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Move to"><Folder /></Button></MenuTrigger>
          <MenuContent align="start">
            <MenuItem onSelect={() => run('inbox')}><Inbox />Inbox</MenuItem>
            <MenuItem onSelect={() => run('archive')}><Archive />Archive</MenuItem>
            {custom.map(f => <MenuItem key={f.id} onSelect={() => run('move', { folderId: f.id })}><Folder />{f.name}</MenuItem>)}
            <MenuSeparator />
            <MenuItem onSelect={() => run('spam')}><ShieldAlert />Spam</MenuItem>
            <MenuItem onSelect={() => run('trash')}><Trash2 />Trash</MenuItem>
          </MenuContent>
        </Menu>
        {ctx.inInbox && boot.settings.splitInbox && <Button variant="ghost" size="sm" onClick={() => run(ctx.other ? 'important' : 'other')}>{ctx.other ? <ArrowUpCircle /> : <ArrowDownCircle />}<span className={tb}>{ctx.other ? 'Move to Important' : 'Move to Other'}</span></Button>}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
          <h1 className="text-xl font-semibold tracking-tight">{t.subject || '(no subject)'}</h1>
          {labels.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{labels.map(l => (
            <span key={l.id} className="inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium ring-1 ring-inset ring-border"><span className="size-2 rounded-full" style={{ background: labelColor(l.color) }} />{l.name}<button aria-label={`Remove label ${l.name}`} onClick={() => act([t.threadId], 'unlabel', { labelId: l.id }, true).then(() => qc.invalidateQueries({ queryKey: ['mail', 'thread', threadId] }))}><X className="size-3" /></button></span>
          ))}</div>}
          {t.trashedCount > 0 && <p className="mt-3 flex items-center gap-1.5 text-sm text-fg-3"><Trash2 className="size-4" />{t.trashedCount} message{t.trashedCount === 1 ? '' : 's'} in this conversation {t.trashedCount === 1 ? 'is' : 'are'} in Trash and hidden.</p>}
          <div className="mt-5 space-y-3">
            {ctx.visible.map((m, i) => <MessageCard key={m.id} m={m} threadId={t.threadId} initiallyOpen={i === ctx.visible.length - 1 || m.unread || m.draft} />)}
          </div>
          {!ctx.onlyDrafts && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => compose({ mode: 'reply', emailId: last.id, threadId: t.threadId })}><Reply />Reply</Button>
              <Button onClick={() => compose({ mode: 'replyAll', emailId: last.id, threadId: t.threadId })}><ReplyAll />Reply all</Button>
              <Button onClick={() => compose({ mode: 'forward', emailId: last.id, threadId: t.threadId })}><CornerUpRight />Forward</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageCard({ m, threadId, initiallyOpen }: { m: Message; threadId: string; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const [html, setHtml] = useState(m.viewerHtml || null)
  const [remote, setRemote] = useState(!m.hasRemoteContent || !!m.remoteAllowed)
  const qc = useQueryClient()
  const compose = useComposer()
  const toLine = [...m.to, ...m.cc].map(addrText).join(', ')
  const loadImages = async () => {
    try { const r = await mail<{ viewerHtml: string }>(`/emails/${encodeURIComponent(m.id)}/view`); setHtml(r.viewerHtml); setRemote(true) } catch (e) { toast.error((e as Error).message) }
  }
  return (
    <article className={cn('rounded-lg border border-border bg-card', m.draft && 'border-dashed')}>
      <header className="flex cursor-pointer items-start gap-3 px-4 py-3" onClick={e => { if (!(e.target as Element).closest('button,a')) setOpen(o => !o) }} aria-expanded={open}>
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold', m.mine ? 'bg-accent text-accent-fg' : 'bg-sunken text-fg-2 ring-1 ring-border')}>{initials(m.from)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{m.mine ? 'Me' : addrText(m.from) || 'Unknown sender'}</span>
            {m.from && !m.mine && <span className="truncate text-sm text-fg-3">{m.from.email}</span>}
            {m.draft && <Badge tone="bad">Draft</Badge>}
          </div>
          <div className="truncate text-sm text-fg-3">{open ? `to ${toLine || '(no recipients)'}${m.bcc.length ? ` · bcc ${m.bcc.map(addrText).join(', ')}` : ''}` : m.preview}</div>
        </div>
        <Tooltip content={mailDateLong(m.date)}><time className="shrink-0 pt-0.5 text-xs text-fg-3" dateTime={m.date}>{mailDate(m.date)}</time></Tooltip>
        {!m.draft && (
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Message actions" className="-my-1"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => compose({ mode: 'reply', emailId: m.id, threadId })}><CornerUpLeft />Reply</MenuItem>
              <MenuItem onSelect={() => compose({ mode: 'replyAll', emailId: m.id, threadId })}><ReplyAll />Reply all</MenuItem>
              <MenuItem onSelect={() => compose({ mode: 'forward', emailId: m.id })}><CornerUpRight />Forward</MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={async () => { await mailPost('/actions', { emailIds: [m.id], action: 'unread' }).catch(e => toast.error(e.message)); qc.invalidateQueries({ queryKey: ['mail'] }) }}><MailOpen />Mark unread from here</MenuItem>
              <MenuItem danger onSelect={async () => { await mailPost('/actions', { emailIds: [m.id], action: 'trash' }).catch(e => toast.error(e.message)); toast('Message moved to Trash'); qc.invalidateQueries({ queryKey: ['mail'] }) }}><Trash2 />Move this message to Trash</MenuItem>
            </MenuContent>
          </Menu>
        )}
        <ChevronDown className={cn('mt-1.5 size-4 shrink-0 text-fg-3 transition-transform', open && 'rotate-180')} />
      </header>
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {m.scheduledAt && <Note icon={Clock} tone="warn">Scheduled to send {mailDateLong(m.scheduledAt)}<Button variant="link" size="sm" onClick={async () => {
            try { const { draftId } = await mailPost<{ draftId: string }>(`/submissions/${encodeURIComponent(m.submissionId!)}/cancel`); toast('Unscheduled — moved to Drafts'); compose({ mode: 'draft', emailId: draftId, threadId }); qc.invalidateQueries({ queryKey: ['mail'] }) } catch (e) { toast.error((e as Error).message) }
          }}>Cancel and edit</Button></Note>}
          {m.draft && <Note icon={FileText}>Unsent draft<Button variant="link" size="sm" onClick={() => compose({ mode: 'draft', emailId: m.id, threadId })}>Continue editing</Button></Note>}
          {!remote && <Note icon={ImageOff}>Remote images are blocked so the sender can’t see when you read this.
            <Button variant="link" size="sm" onClick={loadImages}>Load images</Button>
            {m.from && <Button variant="link" size="sm" onClick={async () => { try { await mail(`/senders/${encodeURIComponent(m.from!.email)}`, { method: 'PUT', json: { loadImages: true } }); await loadImages(); toast(`Images from ${m.from!.email} will load automatically`) } catch (e) { toast.error((e as Error).message) } }}>Always for {m.from.email}</Button>}
          </Note>}
          {html ? <MailFrame html={html} /> : <div className="whitespace-pre-wrap break-words text-base leading-relaxed [&_a]:text-accent [&_a]:underline"><Linkified text={m.text || ''} /></div>}
          {m.attachments.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {m.attachments.map(a => {
                const q = `name=${encodeURIComponent(a.name)}&type=${encodeURIComponent(a.type)}`
                const img = /^image\/(png|jpe?g|gif|webp|avif)$/.test(a.type)
                return (
                  <a key={a.blobId} href={`/api/mail/blobs/${encodeURIComponent(a.blobId)}?${q}`} download={a.name} className="flex w-56 items-center gap-2.5 rounded-lg border border-border p-2 hover:border-border-strong hover:bg-hover">
                    {img ? <img src={`/api/mail/blobs/${encodeURIComponent(a.blobId)}?${q}&inline=1`} alt="" loading="lazy" className="size-10 rounded object-cover" /> : <span className="grid size-10 place-items-center rounded bg-sunken">{a.type === 'application/pdf' ? <FileText className="size-5 text-bad" /> : <FileIcon className="size-5 text-fg-3" />}</span>}
                    <span className="min-w-0"><span className="block truncate text-sm">{a.name}</span><span className="text-xs text-fg-3">{bytes(a.size)}</span></span>
                  </a>
                )
              })}
            </div>
          )}
          {m.listUnsubscribe && !m.mine && <a href={m.listUnsubscribe} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-sm text-fg-3 underline underline-offset-2 hover:text-fg">Unsubscribe from this sender</a>}
        </div>
      )}
    </article>
  )
}

function Note({ icon: Icon, tone, children }: { icon: typeof Clock; tone?: 'warn'; children: React.ReactNode }) {
  return <div className={cn('mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-3 py-2 text-sm', tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-sunken text-fg-2 ring-1 ring-inset ring-border')}><Icon className="size-4 shrink-0" />{children}</div>
}

// HTML mail in a sandboxed, script-less iframe sized to its content.
function MailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(200)
  useEffect(() => {
    const f = ref.current
    if (!f) return
    let ro: ResizeObserver | null = null
    const fit = () => { try { const d = f.contentDocument; if (d?.documentElement) setH(Math.min(20000, d.documentElement.scrollHeight + 2)) } catch { /* cross-origin */ } }
    const onLoad = () => { fit(); try { ro = new ResizeObserver(fit); ro.observe(f.contentDocument!.body) } catch { /* */ } }
    f.addEventListener('load', onLoad)
    return () => { f.removeEventListener('load', onLoad); ro?.disconnect() }
  }, [html])
  // allow-same-origin (without allow-scripts) only lets the page measure the content height.
  return <iframe ref={ref} title="Message" srcDoc={html} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="w-full rounded-md bg-white" style={{ height: h }} />
}

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g)
  return <>{parts.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : p))}</>
}

export function ReaderEmpty() {
  return <div className="grid h-full place-items-center"><EmptyState icon={MailOpen} title="No conversation selected">Pick one from the list, or press <span className="font-mono">c</span> to write a new message.</EmptyState></div>
}


import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowUp, Bold, Check, CheckCircle2, Copy, FileText, Filter, Italic, Link2, Mail, Minus, MoreHorizontal, Play, Plus, RefreshCw, RemoveFormatting, ShieldCheck, Tag, Trash2, UserRound, X, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { EmptyState, Progress, Skeleton, Switch, Tabs, TabsList, TabsTrigger } from '@/components/ui/misc'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm } from '@/components/ui/overlay'
import { PageHeader, DL } from '@/components/data/stat'
import { cn } from '@/lib/utils'
import { labelColor, mail, mailPost, useMailBoot, type FilterCond, type Health, type MailBoot, type MailFilter, type MailLabel, type Template } from './api'
import { cleanHtml } from './Composer'
import { initials } from './Reader'

const TABS = [
  { id: 'general', label: 'General', icon: UserRound },
  { id: 'filters', label: 'Filters', icon: Filter },
  { id: 'labels', label: 'Labels', icon: Tag },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'setup', label: 'Setup & delivery', icon: ShieldCheck },
] as const
const FIELDS: [FilterCond['field'], string][] = [['from', 'From'], ['to', 'To or Cc'], ['subject', 'Subject'], ['words', 'Has the words']]

export default function MailSettingsPage() {
  const { tab = 'general' } = useParams()
  const navigate = useNavigate()
  const { data: boot, isLoading } = useMailBoot()
  const filters = useQuery({ queryKey: ['mail', 'filters'], queryFn: () => mail<MailFilter[]>('/filters'), enabled: !!boot?.configured })
  const templates = useQuery({ queryKey: ['mail', 'templates'], queryFn: () => mail<Template[]>('/templates'), enabled: !!boot?.configured })
  const health = useQuery({ queryKey: ['mail', 'health'], queryFn: () => mail<Health>('/health').catch(e => ({ error: (e as Error).message, checks: [], dailyLimit: 0, monthlyLimit: 0 }) as Health), enabled: !!boot?.configured, staleTime: 5 * 60_000 })
  const active = TABS.some(t => t.id === tab) ? tab : 'general'
  const failing = health.data ? health.data.checks.filter(c => !c.ok && c.id !== 'ptr').length : 0
  const counts: Record<string, number | undefined> = { filters: filters.data?.length, labels: boot?.labels.length, templates: templates.data?.length }

  return (
    <div>
      <Link to="/mail" className="mb-3 inline-flex items-center gap-1 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="size-4" />Mail</Link>
      <PageHeader title="Mail settings" description={boot?.address} />
      {isLoading ? <Skeleton className="h-96" /> : !boot?.configured ? <Card><EmptyState icon={Mail} title="Mail isn’t set up on this server yet">See docs/mail.md in the repository.</EmptyState></Card> : (
        <Tabs value={active} onValueChange={v => navigate(`/mail/settings/${v}`, { replace: true })}>
          <TabsList className="mb-5 flex w-full overflow-x-auto scrollbar-none">
            {TABS.map(t => (
              <TabsTrigger key={t.id} value={t.id} className="shrink-0">
                <t.icon />{t.label}
                {counts[t.id] ? <span className="num text-xs text-fg-3">{counts[t.id]}</span> : null}
                {t.id === 'setup' && health.data && (failing ? <Badge tone="warn">{failing}</Badge> : <CheckCircle2 className="!size-3.5 text-good" />)}
              </TabsTrigger>
            ))}
          </TabsList>
          {active === 'general' && <General boot={boot} />}
          {active === 'filters' && <Filters boot={boot} list={filters.data} loading={filters.isLoading} />}
          {active === 'labels' && <Labels boot={boot} filters={filters.data || []} />}
          {active === 'templates' && <Templates list={templates.data} loading={templates.isLoading} />}
          {active === 'setup' && <Setup h={health.data} loading={health.isFetching} recheck={() => health.refetch()} />}
        </Tabs>
      )}
    </div>
  )
}

function useReloadBoot() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['mail'] })
}

// ── Small rich-text box for signatures and templates ─────────────────────────
function RichBox({ initial, onReady, label }: { initial?: string; onReady: (get: () => string) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) ref.current.innerHTML = initial || ''; onReady(() => ref.current?.innerHTML || '') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const exec = (c: string) => { ref.current?.focus(); document.execCommand(c, false) }
  const [url, setUrl] = useState('')
  const tool = 'grid size-8 place-items-center rounded-md text-fg-3 hover:bg-hover hover:text-fg [&_svg]:size-4'
  return (
    <div className="overflow-hidden rounded-md border border-border focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
        <button type="button" className={tool} aria-label="Bold" onMouseDown={e => e.preventDefault()} onClick={() => exec('bold')}><Bold /></button>
        <button type="button" className={tool} aria-label="Italic" onMouseDown={e => e.preventDefault()} onClick={() => exec('italic')}><Italic /></button>
        <button type="button" className={tool} aria-label="Clear formatting" onMouseDown={e => e.preventDefault()} onClick={() => exec('removeFormat')}><RemoveFormatting /></button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Link2 className="size-4 text-fg-3" />
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Select text, paste a link, press Enter" aria-label="Link address" className="h-7 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-fg-3"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); let u = url.trim(); if (!u) return; if (!/^(https?:|mailto:)/i.test(u)) u = 'https://' + u; ref.current?.focus(); document.execCommand('createLink', false, u); setUrl('') } }} />
      </div>
      <div ref={ref} contentEditable role="textbox" aria-multiline aria-label={label} suppressContentEditableWarning
        onPaste={e => { e.preventDefault(); const h = e.clipboardData.getData('text/html'); if (h) document.execCommand('insertHTML', false, cleanHtml(h)); else document.execCommand('insertText', false, e.clipboardData.getData('text/plain')) }}
        className="min-h-24 px-3 py-2 text-sm leading-relaxed outline-none [&_a]:text-accent [&_a]:underline" />
    </div>
  )
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-0', className)}>{children}</div>
}

// ── General ──────────────────────────────────────────────────────────────────
function General({ boot }: { boot: MailBoot }) {
  const reload = useReloadBoot()
  const confirm = useConfirm()
  const a = boot.addresses
  const s = boot.settings
  const [editing, setEditing] = useState<string | null>(null)
  const [alias, setAlias] = useState('')
  const host = 'mail.' + (a?.domain || 'gacoka.com')
  const toggle = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); reload(); toast(msg) } catch (e) { toast.error((e as Error).message) } }
  return (
    <div className="grid gap-5 xl:grid-cols-12">
      <Card className="xl:col-span-7">
        <CardHeader title="Addresses and signatures" description="Where you receive mail and how you sign it. Replies go out from the address a message was sent to." />
        <CardBody>
          {!a ? <p className="text-sm text-fg-3">Address details are unavailable right now.</p> : <>
            {a.addresses.map(x => {
              const named = x.identity?.name && x.identity.name !== x.email
              return (
                <div key={x.email}>
                  <Row>
                    <span className={cn('grid size-9 place-items-center rounded-full text-xs font-semibold', x.primary ? 'bg-accent text-accent-fg' : 'bg-sunken text-fg-2 ring-1 ring-border')}>{initials({ name: named ? x.identity!.name : null, email: x.email })}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-medium">{named ? x.identity!.name : x.email}{x.primary && <Badge tone="good">Primary</Badge>}</div>
                      <div className="text-sm text-fg-3">{x.email} · {x.identity?.htmlSignature ? 'signature set' : 'no signature'}</div>
                    </div>
                    <Button size="sm" onClick={() => setEditing(editing === x.email ? null : x.email)}>{editing === x.email ? 'Close' : 'Edit'}</Button>
                    {!x.primary && a.manageable && (
                      <Menu><MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
                        <MenuContent><MenuItem danger onSelect={async () => { if (await confirm({ title: `Stop receiving mail at ${x.email}?`, confirm: 'Remove address', danger: true })) toggle(() => mail(`/addresses/${encodeURIComponent(x.email)}`, { method: 'DELETE' }), `${x.email} removed`) }}><Trash2 />Remove address</MenuItem></MenuContent>
                      </Menu>
                    )}
                  </Row>
                  {editing === x.email && <IdentityEditor boot={boot} email={x.email} onDone={() => setEditing(null)} />}
                </div>
              )
            })}
            {a.manageable && (
              <form className="mt-4 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (!alias.trim()) return; toggle(() => mailPost('/addresses', { name: alias.trim() }), 'Address added').then(() => setAlias('')) }}>
                <div className="flex min-w-0 flex-1 items-center rounded-md border border-border focus-within:border-accent">
                  <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="New address, e.g. travel" maxLength={64} aria-label="New address" className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" />
                  <span className="pr-3 text-sm text-fg-3">@{a.domain}</span>
                </div>
                <Button type="submit"><Plus />Add address</Button>
              </form>
            )}
          </>}
        </CardBody>
      </Card>
      <div className="space-y-5 xl:col-span-5">
        <Card>
          <CardHeader title="Sending and inbox" />
          <CardBody>
            <Row>
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">Undo send</div><div className="text-sm text-fg-3">How long a sent message waits, so you can take it back</div></div>
              <Select value={s.undoSeconds} onChange={e => toggle(() => mail('/settings', { method: 'PUT', json: { undoSeconds: Number(e.target.value) } }), 'Undo window saved')} className="w-36" aria-label="Undo send window">
                {boot.undoChoices.map(n => <option key={n} value={n}>{n ? `${n} seconds` : 'Off'}</option>)}
              </Select>
            </Row>
            <Row>
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">Split inbox</div><div className="text-sm text-fg-3">Newsletters and notifications go under Other; people you’ve written to stay in Important</div></div>
              <Switch checked={s.splitInbox} onCheckedChange={v => toggle(() => mail('/settings', { method: 'PUT', json: { splitInbox: v } }), v ? 'Split inbox is on' : 'Split inbox is off')} aria-label="Split inbox" />
            </Row>
            {a?.manageable && <Row>
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">Catch-all</div><div className="text-sm text-fg-3">Receive mail for any address at {a.domain}, like shop-name@{a.domain}</div></div>
              <Switch checked={a.catchAll} onCheckedChange={v => toggle(() => mail('/catch-all', { method: 'PUT', json: { enabled: v } }), v ? 'Catch-all is on' : 'Catch-all is off')} aria-label="Catch-all" />
            </Row>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Mail apps" description="Use this mailbox in iPhone Mail, Outlook or Thunderbird." />
          <CardBody><DL items={[['Incoming (IMAP)', <span className="num">{host} · 993 · SSL/TLS</span>], ['Outgoing (SMTP)', <span className="num">{host} · 465 · SSL/TLS</span>], ['Username', boot.address], ['Password', 'The mailbox password on the server (MAIL_PASSWORD), not your dashboard password']]} /></CardBody>
        </Card>
      </div>
    </div>
  )
}

function IdentityEditor({ boot, email, onDone }: { boot: MailBoot; email: string; onDone: () => void }) {
  const reload = useReloadBoot()
  const ident = boot.identities.find(i => i.email === email)
  const [name, setName] = useState(ident?.name && ident.name !== email ? ident.name : '')
  const getSig = useRef<() => string>(() => '')
  const [saving, setSaving] = useState(false)
  return (
    <form className="mb-3 space-y-3 rounded-lg bg-sunken p-4 ring-1 ring-inset ring-border" onSubmit={async e => {
      e.preventDefault()
      if (!ident) return toast.error('This address has no sending identity yet. Send one message from it first.')
      setSaving(true)
      try { await mail(`/identities/${encodeURIComponent(ident.id)}`, { method: 'PATCH', json: { name, htmlSignature: getSig.current() } }); reload(); toast('Saved'); onDone() } catch (err) { toast.error((err as Error).message) }
      setSaving(false)
    }}>
      <Field label="Display name" hint={`Shown as the sender, e.g. “${name || 'Mark Gacoka'} <${email}>”`}><Input value={name} onChange={e => setName(e.target.value)} maxLength={100} className="bg-card" /></Field>
      <Field label="Signature"><div className="bg-card"><RichBox initial={ident?.htmlSignature} onReady={g => { getSig.current = g }} label={`Signature for ${email}`} /></div></Field>
      <div className="flex gap-2"><Button variant="primary" size="sm" type="submit" loading={saving}>Save</Button><Button size="sm" variant="ghost" type="button" onClick={onDone}>Cancel</Button></div>
    </form>
  )
}

// ── Filters ──────────────────────────────────────────────────────────────────
function filterBody(f: MailFilter, over: Partial<MailFilter> = {}) {
  return { name: f.name, match: f.match, enabled: f.enabled, conditions: f.conditions, actions: { labelId: f.actions.labelId ?? null, archive: !!f.actions.archive, folderId: f.actions.folderId || null, importance: f.actions.importance || null, markRead: !!f.actions.markRead, star: !!f.actions.star }, ...over }
}

function Filters({ boot, list, loading }: { boot: MailBoot; list?: MailFilter[]; loading: boolean }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<MailFilter | 'new' | null>(null)
  const reload = () => qc.invalidateQueries({ queryKey: ['mail', 'filters'] })
  const filters = list || []
  const chip = 'inline-flex items-center gap-1 rounded-md bg-sunken px-2 py-0.5 text-xs ring-1 ring-inset ring-border'
  const field = Object.fromEntries(FIELDS)
  return (
    <Card>
      <CardHeader title="Filters" description="Sort mail as it arrives, top to bottom. They run on the mail server, so they also apply to mail read on your phone." action={<Button variant="primary" size="sm" onClick={() => setEditing('new')}><Plus />New filter</Button>} />
      <CardBody>
        {editing === 'new' && <FilterEditor boot={boot} onDone={() => { setEditing(null); reload() }} />}
        {loading ? <Skeleton className="h-40" /> : !filters.length && editing !== 'new' ? <EmptyState icon={Filter} title="No filters yet">Filters label, move, star or mark mail as read the moment it arrives. For example: receipts skip the inbox and get a Receipts label.</EmptyState> : filters.map((f, i) => {
          const label = boot.labels.find(l => String(l.id) === String(f.actions.labelId))
          const acts = [
            label && <span key="l" className={chip}><span className="size-2 rounded-full" style={{ background: labelColor(label.color) }} />Label <b>{label.name}</b></span>,
            f.actions.archive && <span key="a" className={chip}>Skip the inbox</span>,
            f.actions.folderId && <span key="f" className={chip}>Move to <b>{boot.folders.find(x => x.id === f.actions.folderId)?.name || 'folder'}</b></span>,
            f.actions.markRead && <span key="r" className={chip}>Mark read</span>,
            f.actions.star && <span key="s" className={chip}>Star</span>,
            f.actions.importance && <span key="i" className={chip}>{f.actions.importance === 'important' ? 'Important' : 'Other'}</span>,
          ].filter(Boolean)
          return (
            <div key={f.id}>
              <Row className={cn(!f.enabled && 'opacity-60')}>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 font-medium">{f.name}{!f.enabled && <Badge>Paused</Badge>}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-sm"><span className="text-xs font-semibold uppercase text-fg-3">If</span>{f.conditions.map((c, j) => <span key={j} className="contents">{j > 0 && <span className="text-xs text-fg-3">{f.match === 'any' ? 'or' : 'and'}</span>}<span className={chip}>{field[c.field]} {c.op === 'is' ? 'is' : 'contains'} <b>{c.value}</b></span></span>)}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-sm"><span className="text-xs font-semibold uppercase text-fg-3">Then</span>{acts.length ? acts : <span className="text-xs text-fg-3">no action</span>}</div>
                </div>
                <Switch checked={f.enabled} aria-label="Filter on" onCheckedChange={async v => { try { await mail(`/filters/${f.id}`, { method: 'PUT', json: filterBody(f, { enabled: v }) }); reload() } catch (e) { toast.error((e as Error).message) } }} />
                <Button size="sm" onClick={() => setEditing(editing === f ? null : f)}>Edit</Button>
                <Menu><MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={async () => { try { const { matched } = await mailPost<{ matched: number }>(`/filters/${f.id}/run`); toast(matched ? `Applied to ${matched} message${matched === 1 ? '' : 's'}` : 'No existing mail matches this filter'); qc.invalidateQueries({ queryKey: ['mail'] }) } catch (e) { toast.error((e as Error).message) } }}><Play />Apply to existing mail</MenuItem>
                    <MenuItem disabled={i === 0} onSelect={async () => { await mailPost(`/filters/${f.id}/move`, { direction: 'up' }).catch(e => toast.error(e.message)); reload() }}><ArrowUp />Move up</MenuItem>
                    <MenuItem disabled={i === filters.length - 1} onSelect={async () => { await mailPost(`/filters/${f.id}/move`, { direction: 'down' }).catch(e => toast.error(e.message)); reload() }}><ArrowDown />Move down</MenuItem>
                    <MenuSeparator />
                    <MenuItem danger onSelect={async () => { if (await confirm({ title: 'Delete this filter?', confirm: 'Delete', danger: true })) { await mail(`/filters/${f.id}`, { method: 'DELETE' }).catch(e => toast.error(e.message)); reload() } }}><Trash2 />Delete filter</MenuItem>
                  </MenuContent>
                </Menu>
              </Row>
              {editing === f && <FilterEditor boot={boot} f={f} onDone={() => { setEditing(null); reload() }} />}
            </div>
          )
        })}
      </CardBody>
    </Card>
  )
}

function FilterEditor({ boot, f, onDone }: { boot: MailBoot; f?: MailFilter; onDone: () => void }) {
  const a = f?.actions || {}
  const [name, setName] = useState(f?.name || '')
  const [match, setMatch] = useState<'all' | 'any'>(f?.match || 'all')
  const [conds, setConds] = useState<FilterCond[]>(f?.conditions?.length ? f.conditions : [{ field: 'from', op: 'contains', value: '' }])
  const [labelId, setLabelId] = useState(a.labelId != null ? String(a.labelId) : '')
  const [dest, setDest] = useState(a.archive ? 'archive' : a.folderId || '')
  const [importance, setImportance] = useState(a.importance || '')
  const [markRead, setMarkRead] = useState(!!a.markRead)
  const [star, setStar] = useState(!!a.star)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const setCond = (i: number, p: Partial<FilterCond>) => setConds(c => c.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <form className="my-3 space-y-4 rounded-lg bg-sunken p-4 ring-1 ring-inset ring-border" onSubmit={async e => {
      e.preventDefault(); setErr(''); setSaving(true)
      const body = { name, match, enabled: f ? f.enabled : true, conditions: conds, actions: { labelId: labelId || null, archive: dest === 'archive', folderId: dest && dest !== 'archive' ? dest : null, importance: importance || null, markRead, star } }
      try { await mail(f ? `/filters/${f.id}` : '/filters', { method: f ? 'PUT' : 'POST', json: body }); toast(f ? 'Filter saved' : 'Filter created. It applies to new mail; use “Apply to existing mail” for the rest.'); onDone() } catch (ex) { setErr((ex as Error).message); setSaving(false) }
    }}>
      <Field label="Name"><Input value={name} onChange={e => setName(e.target.value)} placeholder="Airline mail" maxLength={80} className="bg-card sm:max-w-sm" autoFocus /></Field>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-fg-2">If a message matches <Select value={match} onChange={e => setMatch(e.target.value as 'all' | 'any')} className="h-8 w-20 bg-card" aria-label="Match all or any"><option value="all">all</option><option value="any">any</option></Select> of these</div>
          {conds.map((c, i) => (
            <div key={i} className="grid grid-cols-[120px_110px_1fr_auto] gap-2">
              <Select value={c.field} onChange={e => setCond(i, { field: e.target.value as FilterCond['field'] })} className="bg-card" aria-label="Field">{FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
              <Select value={c.op} onChange={e => setCond(i, { op: e.target.value as FilterCond['op'] })} className="bg-card" aria-label="Match">{[['contains', 'contains'], ['is', 'is exactly']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
              <Input value={c.value} onChange={e => setCond(i, { value: e.target.value })} placeholder="airline.com" className="bg-card" aria-label="Value" />
              <Button variant="ghost" size="icon" type="button" aria-label="Remove condition" disabled={conds.length === 1} onClick={() => setConds(x => x.filter((_, j) => j !== i))}><X /></Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" type="button" onClick={() => setConds(c => [...c, { field: 'subject', op: 'contains', value: '' }])}><Plus />Add condition</Button>
        </div>
        <div className="space-y-3">
          <div className="text-sm font-medium text-fg-2">Then</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Label"><Select value={labelId} onChange={e => setLabelId(e.target.value)} className="bg-card"><option value="">None</option>{boot.labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="Move to"><Select value={dest} onChange={e => setDest(e.target.value)} className="bg-card"><option value="">Leave in Inbox</option><option value="archive">Archive (skip inbox)</option>{boot.folders.filter(x => !x.role).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
            <Field label="Inbox section"><Select value={importance} onChange={e => setImportance(e.target.value as '' | 'important' | 'other')} className="bg-card"><option value="">Automatic</option><option value="important">Important</option><option value="other">Other</option></Select></Field>
          </div>
          <div className="flex gap-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={markRead} onChange={e => setMarkRead(e.target.checked)} className="size-4 accent-[var(--accent)]" />Mark as read</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={star} onChange={e => setStar(e.target.checked)} className="size-4 accent-[var(--accent)]" />Star it</label>
          </div>
        </div>
      </div>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <div className="flex gap-2"><Button variant="primary" size="sm" type="submit" loading={saving}>{f ? 'Save filter' : 'Create filter'}</Button><Button size="sm" variant="ghost" type="button" onClick={onDone}>Cancel</Button></div>
    </form>
  )
}

// ── Labels ───────────────────────────────────────────────────────────────────
function Labels({ boot, filters }: { boot: MailBoot; filters: MailFilter[] }) {
  const reload = useReloadBoot()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<MailLabel | 'new' | null>(null)
  const usedBy = (id: MailLabel['id']) => filters.filter(f => String(f.actions.labelId) === String(id)).length
  const Editor = ({ l }: { l?: MailLabel }) => {
    const [name, setName] = useState(l?.name || '')
    const [color, setColor] = useState(l?.color || boot.labelColors[0] || 'patina')
    return (
      <form className="my-2 flex flex-wrap items-center gap-2 rounded-lg bg-sunken p-3 ring-1 ring-inset ring-border" onSubmit={async e => {
        e.preventDefault(); if (!name.trim()) return
        try { await mail(l ? `/labels/${l.id}` : '/labels', { method: l ? 'PATCH' : 'POST', json: { name: name.trim(), color } }); reload(); setEditing(null) } catch (err) { toast.error((err as Error).message) }
      }}>
        <span className="size-3 rounded-full" style={{ background: labelColor(color) }} />
        <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Label name" maxLength={40} className="w-56 bg-card" aria-label="Label name" />
        <div className="flex gap-1" role="radiogroup" aria-label="Colour">{boot.labelColors.map(c => <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} onClick={() => setColor(c)} className={cn('size-6 rounded-full ring-2 ring-offset-2 ring-offset-sunken', c === color ? 'ring-fg' : 'ring-transparent')} style={{ background: labelColor(c) }} />)}</div>
        <Button variant="primary" size="sm" type="submit">{l ? 'Save' : 'Add label'}</Button><Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
      </form>
    )
  }
  return (
    <Card>
      <CardHeader title="Labels" description="Tag conversations without moving them. A conversation can have several labels; filters can add them automatically." action={<Button variant="primary" size="sm" onClick={() => setEditing('new')}><Plus />New label</Button>} />
      <CardBody>
        {editing === 'new' && <Editor />}
        {!boot.labels.length && editing !== 'new' ? <EmptyState icon={Tag} title="No labels yet">Create labels like Travel or Receipts, then add them from a conversation or with a filter.</EmptyState> : boot.labels.map(l => (
          <div key={l.id}>
            <Row>
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium ring-1 ring-inset ring-border"><span className="size-2.5 rounded-full" style={{ background: labelColor(l.color) }} />{l.name}</span>
              <span className="flex-1 text-sm text-fg-3">{usedBy(l.id) ? `Added by ${usedBy(l.id)} filter${usedBy(l.id) === 1 ? '' : 's'}` : 'Added by hand'}</span>
              <Button size="sm" variant="ghost" onClick={() => navigate(`/mail/${encodeURIComponent('label:' + l.id)}`)}>View mail</Button>
              <Button size="sm" onClick={() => setEditing(l)}>Edit</Button>
              <Menu><MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
                <MenuContent><MenuItem danger onSelect={async () => { if (await confirm({ title: `Delete “${l.name}”?`, body: 'Conversations keep their folders.', confirm: 'Delete label', danger: true })) { await mail(`/labels/${l.id}`, { method: 'DELETE' }).catch(e => toast.error(e.message)); reload() } }}><Trash2 />Delete label</MenuItem></MenuContent>
              </Menu>
            </Row>
            {editing === l && <Editor l={l} />}
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

// ── Templates ────────────────────────────────────────────────────────────────
function Templates({ list, loading }: { list?: Template[]; loading: boolean }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const reload = () => qc.invalidateQueries({ queryKey: ['mail', 'templates'] })
  const preview = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) }
  const Editor = ({ t }: { t?: Template }) => {
    const [name, setName] = useState(t?.name || '')
    const [subject, setSubject] = useState(t?.subject || '')
    const get = useRef<() => string>(() => '')
    const [err, setErr] = useState('')
    return (
      <form className="my-3 space-y-3 rounded-lg bg-sunken p-4 ring-1 ring-inset ring-border" onSubmit={async e => {
        e.preventDefault(); setErr('')
        try { await mail(t ? `/templates/${t.id}` : '/templates', { method: t ? 'PUT' : 'POST', json: { name, subject, html: get.current() } }); reload(); setEditing(null); toast('Template saved') } catch (ex) { setErr((ex as Error).message) }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Thanks, will follow up" className="bg-card" /></Field>
          <Field label="Subject" hint="Used when the message has none"><Input value={subject} onChange={e => setSubject(e.target.value)} maxLength={500} className="bg-card" /></Field>
        </div>
        <Field label="Body"><div className="bg-card"><RichBox initial={t?.html} onReady={g => { get.current = g }} label="Template body" /></div></Field>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <div className="flex gap-2"><Button variant="primary" size="sm" type="submit">Save template</Button><Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button></div>
      </form>
    )
  }
  return (
    <Card>
      <CardHeader title="Templates" description="Replies you send often. Insert one from the template button in the composer toolbar." action={<Button variant="primary" size="sm" onClick={() => setEditing('new')}><Plus />New template</Button>} />
      <CardBody>
        {editing === 'new' && <Editor />}
        {loading ? <Skeleton className="h-32" /> : !list?.length && editing !== 'new' ? <EmptyState icon={FileText} title="No templates yet">Save answers you write again and again, like directions or a scheduling reply.</EmptyState> : list?.map(t => (
          <div key={t.id}>
            <Row>
              <div className="min-w-0 flex-1"><div className="font-medium">{t.name}{t.subject && <span className="font-normal text-fg-3"> · {t.subject}</span>}</div><div className="truncate text-sm text-fg-3">{preview(t.html) || 'Empty'}</div></div>
              <Button size="sm" onClick={() => setEditing(editing === t ? null : t)}>Edit</Button>
              <Menu><MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
                <MenuContent><MenuItem danger onSelect={async () => { if (await confirm({ title: 'Delete this template?', confirm: 'Delete', danger: true })) { await mail(`/templates/${t.id}`, { method: 'DELETE' }).catch(e => toast.error(e.message)); reload() } }}><Trash2 />Delete template</MenuItem></MenuContent>
              </Menu>
            </Row>
            {editing === t && <Editor t={t} />}
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

// ── Setup and delivery ───────────────────────────────────────────────────────
function Setup({ h, loading, recheck }: { h?: Health; loading: boolean; recheck: () => void }) {
  if (!h) return <Skeleton className="h-96" />
  const required = h.checks.filter(c => c.id !== 'ptr')
  const passing = required.filter(c => c.ok).length
  const meter = (n: number | undefined, of: number, label: string) => (
    <Card><CardBody className="pt-5">
      <div className="text-sm text-fg-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold"><span className="num">{n ?? '—'}</span><span className="text-base font-normal text-fg-3"> / {of}</span></div>
      <Progress value={of ? ((n || 0) / of) * 100 : 0} className="mt-3" tone={of && (n || 0) / of > 0.9 ? 'warn' : 'accent'} />
    </CardBody></Card>
  )
  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-3">
        {meter(h.sentToday, h.dailyLimit, 'Sent today')}
        {meter(h.sentThisMonth, h.monthlyLimit, 'Sent this month')}
        <Card><CardBody className="pt-5">
          <div className="text-sm text-fg-3">Checks passing</div>
          <div className="mt-1 text-2xl font-semibold"><span className="num">{passing}</span><span className="text-base font-normal text-fg-3"> / {required.length}</span></div>
          <div className={cn('mt-2 text-sm', passing === required.length ? 'text-good' : 'text-warn')}>{passing === required.length ? 'Mail is set up correctly' : `${required.length - passing} record${required.length - passing === 1 ? '' : 's'} to fix`}</div>
        </CardBody></Card>
      </div>
      <Card>
        <CardHeader title="DNS and server checks" description="What the domain publishes, compared with what the mail server expects. Edit DNS in Hostinger → Domains → gacoka.com → DNS; changes can take an hour to show here." action={<Button size="sm" onClick={recheck} loading={loading}><RefreshCw />Check again</Button>} />
        <CardBody>
          {h.error ? <p className="text-sm text-fg-3">{h.error}</p> : h.checks.map((c, i) => (
            <Row key={i} className="items-start">
              <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full', c.ok ? 'bg-good-soft text-good' : c.id === 'ptr' ? 'bg-sunken text-fg-3' : 'bg-warn-soft text-warn')}>{c.ok ? <Check className="size-3.5" /> : c.id === 'ptr' ? <Minus className="size-3.5" /> : <AlertTriangle className="size-3.5" />}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">{c.label}{c.id === 'ptr' && <Badge>Optional</Badge>}</div>
                <div className="text-sm text-fg-3">{c.detail}</div>
                {c.fix && <div className="mt-2 flex items-start gap-2"><code className="flex-1 break-all rounded-md bg-sunken px-2.5 py-1.5 font-mono text-xs ring-1 ring-inset ring-border">{c.fix}</code><Button variant="ghost" size="icon-sm" aria-label="Copy" onClick={() => navigator.clipboard.writeText(c.fix!).then(() => toast('Copied'), () => toast.error('Copy failed — select the text instead'))}><Copy /></Button></div>}
              </div>
            </Row>
          ))}
        </CardBody>
      </Card>
    </div>
  )
}

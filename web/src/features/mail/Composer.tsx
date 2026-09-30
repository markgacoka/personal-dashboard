import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Bold, CalendarClock, ChevronDown, Clock, FileText, Italic, Link2, List, ListOrdered, Loader2, Maximize2, Minus, Paperclip, Quote, RemoveFormatting, Send, Trash2, Underline, X, AlertTriangle, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { bytes, mailDateLong } from '@/lib/format'
import { cn } from '@/lib/utils'
import { mail, mailPost, useMailBoot, type Addr, type Attachment, type ComposeCtx, type MailBoot, type Template } from './api'

export interface OpenOpts { mode?: 'new' | 'reply' | 'replyAll' | 'forward' | 'draft'; emailId?: string; threadId?: string; to?: Addr[] }
const Ctx = createContext<(o?: OpenOpts) => void>(() => {})
export const useComposer = () => useContext(Ctx)

const SIG = 'mail-sig'
const FOLLOWUPS: [number, string][] = [[0, 'No reminder'], [1, 'Remind in 1 day if no reply'], [3, 'Remind in 3 days if no reply'], [7, 'Remind in 1 week if no reply']]
const PASTE_TAGS = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'PRE', 'CODE', 'SPAN', 'TABLE', 'TBODY', 'TR', 'TD', 'TH'])

// Allowlist sanitizer for pasted HTML; the server sanitizes again on save.
export function cleanHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) { child.remove(); continue }
      if (!(child instanceof Element)) continue
      if (!PASTE_TAGS.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'IFRAME', 'OBJECT'].includes(child.tagName)) { child.remove(); continue }
        walk(child); child.replaceWith(...child.childNodes); continue
      }
      const href = child.tagName === 'A' ? child.getAttribute('href') : null
      for (const a of [...child.attributes]) child.removeAttribute(a.name)
      if (href && /^(https?:|mailto:)/i.test(href)) child.setAttribute('href', href)
      walk(child)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}

const parseToken = (text: string): Addr | null => {
  const t = text.trim().replace(/[,;]+$/, '')
  const m = t.match(/^(.*?)<([^>]+)>$/)
  const email = (m ? m[2] : t).trim()
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(email)) return null
  const name = m ? m[1].trim().replace(/^"(.*)"$/, '$1').trim() : ''
  return { name: name || null, email }
}

function schedulePresets(now = new Date()) {
  const at = (days: number, hour: number) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d }
  const out: { label: string; at: Date }[] = []
  if (now.getHours() < 17) out.push({ label: 'This evening', at: at(0, 18) })
  out.push({ label: 'Tomorrow morning', at: at(1, 8) }, { label: 'Tomorrow afternoon', at: at(1, 13) }, { label: 'Monday morning', at: at(((8 - now.getDay()) % 7) || 7, 8) })
  return out
}

interface State { ctx: ComposeCtx; mode: NonNullable<OpenOpts['mode']>; threadId: string | null; body: string; key: number }

export function ComposerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State | null>(null)
  const { data: boot } = useMailBoot()
  const closeRef = useRef<(() => Promise<void>) | null>(null)
  const open = useCallback(async (o: OpenOpts = {}) => {
    if (closeRef.current) await closeRef.current()
    const mode = o.mode || 'new'
    try {
      const ctx = await mail<ComposeCtx>(`/compose?mode=${encodeURIComponent(mode)}${o.emailId ? '&emailId=' + encodeURIComponent(o.emailId) : ''}`)
      if (o.to) ctx.to = [...ctx.to, ...o.to]
      const sig = mode === 'draft' ? '' : boot?.identities.find(i => i.email === ctx.from)?.htmlSignature || ''
      const body = mode === 'draft' ? ctx.html : `<p><br></p>${sig ? `<div class="${SIG}">${sig}</div>` : ''}${ctx.html || ''}`
      setState({ ctx, mode, threadId: o.threadId || ctx.threadId || null, body, key: Date.now() })
    } catch (e) { toast.error((e as Error).message) }
  }, [boot])
  return (
    <Ctx.Provider value={open}>
      {children}
      {state && boot && <ComposerWindow key={state.key} s={state} boot={boot} register={fn => { closeRef.current = fn }} onClosed={() => { closeRef.current = null; setState(null) }} reopen={open} />}
    </Ctx.Provider>
  )
}

function ComposerWindow({ s, boot, register, onClosed, reopen }: { s: State; boot: MailBoot; register: (fn: () => Promise<void>) => void; onClosed: () => void; reopen: (o: OpenOpts) => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const editor = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [from, setFrom] = useState(s.ctx.from)
  const [to, setTo] = useState<Addr[]>(s.ctx.to || [])
  const [cc, setCc] = useState<Addr[]>(s.ctx.cc || [])
  const [bcc, setBcc] = useState<Addr[]>(s.ctx.bcc || [])
  const [showCc, setShowCc] = useState(!!s.ctx.cc?.length)
  const [showBcc, setShowBcc] = useState(!!s.ctx.bcc?.length)
  const [subject, setSubject] = useState(s.ctx.subject || '')
  const [atts, setAtts] = useState<(Partial<Attachment> & { name: string; size: number; type: string; pending?: boolean; error?: string })[]>(s.ctx.attachments || [])
  const [followUp, setFollowUp] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [min, setMin] = useState(false)
  const [sending, setSending] = useState(false)
  const [noSubjectOk, setNoSubjectOk] = useState(false)
  const draftId = useRef<string | null>(s.ctx.draftId || null)
  const dirty = useRef(false)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef({ from, to, cc, bcc, subject, atts })
  latest.current = { from, to, cc, bcc, subject, atts }
  const title = { new: 'New message', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward', draft: 'Draft' }[s.mode]
  const addresses = boot.addresses?.addresses?.map(a => a.email) || [boot.address]

  useEffect(() => { if (editor.current) editor.current.innerHTML = s.body }, [s.body])

  const payload = () => {
    const l = latest.current
    return {
      draftId: draftId.current, from: l.from, to: l.to, cc: l.cc, bcc: l.bcc, subject: l.subject, html: editor.current?.innerHTML || '',
      attachments: l.atts.filter(a => a.blobId && !a.error).map(({ blobId, name, type, size }) => ({ blobId, name, type, size })),
      inReplyTo: s.ctx.inReplyTo, references: s.ctx.references,
    }
  }
  const hasContent = () => {
    const c = editor.current?.cloneNode(true) as HTMLElement | undefined
    c?.querySelector('.' + SIG)?.remove(); c?.querySelectorAll('blockquote').forEach(q => q.remove())
    const l = latest.current
    return !!(c?.textContent?.trim() || l.subject.trim() || l.to.length || l.atts.length)
  }
  const save = () => {
    if (!dirty.current || sending || !hasContent()) return saving.current
    clearTimeout(timer.current)
    dirty.current = false
    const body = payload()
    setStatus('Saving…')
    saving.current = saving.current.then(async () => {
      try {
        const r = await mailPost<{ draftId: string }>('/drafts', body)
        draftId.current = r.draftId
        setStatus(`Saved ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`)
      } catch (e) { dirty.current = true; setStatus('Not saved'); setError(`Draft not saved: ${(e as Error).message}`) }
    })
    return saving.current
  }
  const touch = () => { dirty.current = true; setError(''); clearTimeout(timer.current); timer.current = setTimeout(save, 2500) }

  const close = async (quiet = false) => {
    if (dirty.current && hasContent()) {
      await save()
      if (!quiet) toast('Draft saved', { action: { label: 'Open', onClick: () => draftId.current && reopen({ mode: 'draft', emailId: draftId.current, threadId: s.threadId || undefined }) } })
    } else await saving.current
    qc.invalidateQueries({ queryKey: ['mail'] })
    onClosed()
  }
  useEffect(() => { register(() => close(true)) })
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current && hasContent()) { save(); e.preventDefault() } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  })

  const discard = async () => {
    clearTimeout(timer.current); dirty.current = false
    await saving.current
    if (draftId.current) await mail(`/drafts/${encodeURIComponent(draftId.current)}`, { method: 'DELETE' }).catch(() => {})
    qc.invalidateQueries({ queryKey: ['mail'] })
    onClosed()
    toast('Draft discarded')
  }

  const upload = async (files: File[]) => {
    const limit = boot.limits.attachmentsBytes
    for (const file of files) {
      const used = latest.current.atts.filter(a => !a.error).reduce((n, a) => n + (a.size || 0), 0)
      if (used + file.size > limit) { setError(`${file.name} would take attachments over the ${bytes(limit)} limit.`); continue }
      const entry = { name: file.name, size: file.size, type: file.type || 'application/octet-stream', pending: true }
      setAtts(a => [...a, entry])
      try {
        const r = await fetch('/api/mail/upload', { method: 'POST', credentials: 'same-origin', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-File-Type': entry.type } })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `Upload failed (${r.status})`)
        setAtts(a => a.map(x => x === entry ? { ...x, blobId: d.blobId, size: d.size, pending: false } : x))
      } catch (e) { setAtts(a => a.map(x => x === entry ? { ...x, pending: false, error: (e as Error).message } : x)) }
      touch()
    }
  }

  const swapSignature = (email: string) => {
    const ed = editor.current
    if (!ed) return
    const sig = boot.identities.find(i => i.email === email)?.htmlSignature || ''
    const cur = ed.querySelector('.' + SIG)
    if (cur && sig) cur.innerHTML = sig
    else if (cur) cur.remove()
    else if (sig) { const div = document.createElement('div'); div.className = SIG; div.innerHTML = sig; const q = ed.querySelector(':scope > blockquote'); ed.insertBefore(div, q) }
  }

  const exec = (cmd: string) => {
    editor.current?.focus()
    if (cmd === 'quote') document.execCommand('formatBlock', false, 'blockquote')
    else document.execCommand(cmd, false)
    touch()
  }

  const send = async (sendAt?: Date) => {
    const all = [...to, ...cc, ...bcc]
    const bad = all.filter(a => !parseToken(a.email))
    if (bad.length) return setError(`Fix or remove ${bad.map(a => a.email).join(', ')} before sending.`)
    if (!all.length) return setError('Add at least one recipient.')
    if (atts.some(a => a.pending)) return setError('Wait for attachments to finish uploading.')
    if (atts.some(a => a.error)) return setError('Remove the attachments that failed to upload.')
    if (!subject.trim() && !noSubjectOk) { setNoSubjectOk(true); return setError('This message has no subject. Send again to send it anyway.') }
    if (sendAt && !(sendAt > new Date())) return setError('Pick a time in the future.')
    setSending(true)
    clearTimeout(timer.current)
    await saving.current
    try {
      const res = await mailPost<{ submissionId: string; undoSeconds?: number }>('/send', { ...payload(), sendAt: sendAt?.toISOString(), followUpDays: followUp || undefined })
      onClosed()
      qc.invalidateQueries({ queryKey: ['mail'] })
      const undo = async () => {
        try {
          const { draftId: id } = await mailPost<{ draftId: string }>(`/submissions/${encodeURIComponent(res.submissionId)}/cancel`)
          reopen({ mode: 'draft', emailId: id, threadId: s.threadId || undefined })
          toast(sendAt ? 'Unscheduled — back in the composer' : 'Sending undone')
        } catch (e) { toast.error((e as Error).message) }
        qc.invalidateQueries({ queryKey: ['mail'] })
      }
      if (sendAt) toast(`Scheduled for ${mailDateLong(sendAt.toISOString())}`, { action: { label: 'Undo', onClick: undo }, duration: 8000 })
      else if (res.undoSeconds) {
        const id = toast(`Sending in ${res.undoSeconds}s`, { action: { label: 'Undo', onClick: () => { clearInterval(iv); undo() } }, duration: res.undoSeconds * 1000 + 400 })
        let left = res.undoSeconds
        const iv = setInterval(() => { left--; if (left <= 0) { clearInterval(iv); toast.success('Message sent', { id }) } else toast(`Sending in ${left}s`, { id, action: { label: 'Undo', onClick: () => { clearInterval(iv); undo() } } }) }, 1000)
      } else toast.success('Message sent')
    } catch (e) { setSending(false); setError((e as Error).message) }
  }

  const tool = 'grid size-8 place-items-center rounded-md text-fg-3 hover:bg-hover hover:text-fg [&_svg]:size-4'
  return (
    <section aria-label={title} className={cn('fixed z-40 flex flex-col border border-border bg-card shadow-pop',
      min ? 'bottom-0 right-4 h-12 w-80 rounded-t-lg lg:right-8' : 'inset-0 sm:inset-auto sm:bottom-0 sm:right-4 sm:h-[min(640px,calc(100dvh-5rem))] sm:w-[600px] sm:rounded-t-xl lg:right-8')}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); upload([...e.dataTransfer.files]) } }}>
      <header className={cn('flex h-12 shrink-0 items-center gap-2 border-b border-border px-4', min && 'cursor-pointer border-0')} onClick={() => min && setMin(false)}>
        <span className="font-medium">{title}</span>
        <span className="text-xs text-fg-3" aria-live="polite">{status}</span>
        <span className="ml-auto" />
        <button className={tool} aria-label={min ? 'Expand' : 'Minimize'} onClick={e => { e.stopPropagation(); setMin(m => !m) }}>{min ? <Maximize2 /> : <Minus />}</button>
        <button className={tool} aria-label="Save draft and close" onClick={e => { e.stopPropagation(); close() }}><X /></button>
      </header>
      {!min && <>
        <div className="shrink-0 divide-y divide-border border-b border-border text-sm">
          <Row label="From"><select value={from} onChange={e => { setFrom(e.target.value); swapSignature(e.target.value); touch() }} className="w-full bg-transparent py-2 outline-none">{[...new Set([...addresses, from])].map(a => <option key={a} value={a}>{a}{addresses.includes(a) ? '' : ' (becomes an alias)'}</option>)}</select></Row>
          <Row label="To"><Recipients value={to} onChange={v => { setTo(v); touch() }} autoFocus={s.mode === 'new' || s.mode === 'forward'} />
            <span className="flex shrink-0 gap-2 pl-2 text-fg-3">{!showCc && <button className="hover:text-fg" onClick={() => setShowCc(true)}>Cc</button>}{!showBcc && <button className="hover:text-fg" onClick={() => setShowBcc(true)}>Bcc</button>}</span></Row>
          {showCc && <Row label="Cc"><Recipients value={cc} onChange={v => { setCc(v); touch() }} /></Row>}
          {showBcc && <Row label="Bcc"><Recipients value={bcc} onChange={v => { setBcc(v); touch() }} /></Row>}
          <input value={subject} onChange={e => { setSubject(e.target.value); setNoSubjectOk(false); touch() }} placeholder="Subject" aria-label="Subject" maxLength={500} className="w-full bg-transparent px-4 py-2.5 font-medium outline-none placeholder:text-fg-3" />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border px-2 py-1" role="toolbar" aria-label="Formatting">
          {([['bold', Bold, 'Bold'], ['italic', Italic, 'Italic'], ['underline', Underline, 'Underline']] as const).map(([c, I, l]) => <button key={c} className={tool} aria-label={l} onMouseDown={e => e.preventDefault()} onClick={() => exec(c)}><I /></button>)}
          <LinkButton className={tool} editor={editor} onDone={touch} />
          <span className="mx-1 h-5 w-px bg-border" />
          {([['insertUnorderedList', List, 'Bulleted list'], ['insertOrderedList', ListOrdered, 'Numbered list'], ['quote', Quote, 'Quote'], ['removeFormat', RemoveFormatting, 'Clear formatting']] as const).map(([c, I, l]) => <button key={c} className={tool} aria-label={l} onMouseDown={e => e.preventDefault()} onClick={() => exec(c)}><I /></button>)}
          <span className="mx-1 h-5 w-px bg-border" />
          <TemplatesButton className={tool} onPick={t => { editor.current?.focus(); document.execCommand('insertHTML', false, t.html); if (!latest.current.subject && t.subject) setSubject(t.subject); touch() }} onManage={() => navigate('/mail/settings/templates')} />
          <button className={tool} aria-label="Attach files" onClick={() => fileRef.current?.click()}><Paperclip /></button>
          <input ref={fileRef} type="file" multiple hidden onChange={e => { upload([...(e.target.files || [])]); e.target.value = '' }} />
        </div>
        <div ref={editor} contentEditable role="textbox" aria-multiline aria-label="Message" suppressContentEditableWarning onInput={touch}
          onPaste={e => { e.preventDefault(); const h = e.clipboardData.getData('text/html'); if (h) document.execCommand('insertHTML', false, cleanHtml(h)); else document.execCommand('insertText', false, e.clipboardData.getData('text/plain')) }}
          className="mail-editor min-h-0 flex-1 overflow-y-auto px-4 py-3 text-base leading-relaxed outline-none [&_.mail-sig]:mt-4 [&_.mail-sig]:text-fg-2 [&_a]:text-accent [&_a]:underline [&_blockquote]:ml-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6" />
        {atts.length > 0 && <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-4 py-2">{atts.map((a, i) => (
          <span key={i} title={a.error || a.name} className={cn('inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs', a.error ? 'border-bad text-bad' : 'border-border')}>
            {a.pending ? <Loader2 className="size-3.5 animate-spin" /> : a.error ? <AlertTriangle className="size-3.5" /> : <Paperclip className="size-3.5 text-fg-3" />}
            <span className="max-w-40 truncate">{a.name}</span><span className="text-fg-3">{a.error ? 'Failed' : bytes(a.size)}</span>
            <button aria-label={`Remove ${a.name}`} onClick={() => { setAtts(x => x.filter((_, j) => j !== i)); touch() }}><X className="size-3.5" /></button>
          </span>
        ))}</div>}
        {error && <div role="alert" className="shrink-0 bg-bad-soft px-4 py-2 text-sm text-bad">{error}</div>}
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2.5 pb-safe">
          <div className="flex">
            <Button variant="primary" className="rounded-r-none" onClick={() => send()} loading={sending}><Send />Send</Button>
            <SendLater disabled={sending} maxDays={boot.limits.scheduleDays} onPick={send} />
          </div>
          <select value={followUp} onChange={e => setFollowUp(Number(e.target.value))} aria-label="Follow-up reminder" className="h-9 rounded-md border border-border bg-card px-2 text-sm text-fg-2">
            {FOLLOWUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="ml-auto" />
          <Button variant="ghost" size="icon-sm" aria-label="Discard draft" onClick={discard}><Trash2 /></Button>
        </footer>
      </>}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex min-h-10 items-center gap-2 px-4"><span className="w-10 shrink-0 text-fg-3">{label}</span><div className="flex min-w-0 flex-1 items-center">{children}</div></div>
}

function Recipients({ value, onChange, autoFocus }: { value: Addr[]; onChange: (v: Addr[]) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [sugs, setSugs] = useState<Addr[]>([])
  const [active, setActive] = useState(0)
  const seq = useRef(0)
  useEffect(() => {
    const q = text.trim()
    if (!q) { setSugs([]); return }
    const my = ++seq.current
    const t = setTimeout(async () => {
      const r = await mail<Addr[]>(`/contacts?q=${encodeURIComponent(q)}`).catch(() => [])
      if (my === seq.current) { setSugs(r); setActive(0) }
    }, 150)
    return () => clearTimeout(t)
  }, [text])
  const commit = (raw = text) => {
    const parts = raw.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean)
    if (!parts.length) return false
    onChange([...value, ...parts.map(p => parseToken(p) || { email: p })])
    setText(''); setSugs([])
    return true
  }
  const pick = (a: Addr) => { onChange([...value, a]); setText(''); setSugs([]) }
  return (
    <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1.5">
      {value.map((a, i) => {
        const ok = !!parseToken(a.email)
        return <span key={i} title={ok ? a.email : 'Not a valid address'} className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2 text-sm', ok ? 'bg-sunken ring-1 ring-inset ring-border' : 'bg-bad-soft text-bad')}>
          {a.name || a.email}<button aria-label={`Remove ${a.email}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="size-3" /></button>
        </span>
      })}
      <input value={text} autoFocus={autoFocus} onChange={e => { setText(e.target.value); if (/[,;\n]/.test(e.target.value)) commit(e.target.value) }} aria-label="Recipients" autoComplete="off"
        onKeyDown={e => {
          if (sugs.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setActive(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + sugs.length) % sugs.length); return }
          if (e.key === 'Enter' && sugs[active]) { e.preventDefault(); pick(sugs[active]); return }
          if (e.key === 'Escape') { setSugs([]); return }
          if ((e.key === 'Enter' || e.key === 'Tab') && text.trim() && commit()) e.preventDefault()
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={() => setTimeout(() => commit(), 150)} className="min-w-24 flex-1 bg-transparent outline-none" />
      {sugs.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-card p-1 shadow-pop" onMouseDown={e => e.preventDefault()}>
          {sugs.map((r, i) => <button key={r.email} onClick={() => pick(r)} className={cn('flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm', i === active && 'bg-hover')}><span>{r.name || r.email}</span>{r.name && <span className="text-xs text-fg-3">{r.email}</span>}</button>)}
        </div>
      )}
    </div>
  )
}

function LinkButton({ className, editor, onDone }: { className: string; editor: React.RefObject<HTMLDivElement | null>; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const range = useRef<Range | null>(null)
  return (
    <Popover open={open} onOpenChange={o => { if (o) { const s = getSelection(); range.current = s?.rangeCount ? s.getRangeAt(0).cloneRange() : null; setUrl('') } setOpen(o) }}>
      <PopoverTrigger asChild><button className={className} aria-label="Insert link" onMouseDown={e => e.preventDefault()}><Link2 /></button></PopoverTrigger>
      <PopoverContent className="w-72">
        <form className="flex gap-2" onSubmit={e => {
          e.preventDefault()
          let u = url.trim(); if (!u) return
          if (!/^(https?:|mailto:)/i.test(u)) u = 'https://' + u
          setOpen(false)
          editor.current?.focus()
          const s = getSelection()
          if (range.current) { s?.removeAllRanges(); s?.addRange(range.current) }
          if (range.current && !range.current.collapsed) document.execCommand('createLink', false, u)
          else document.execCommand('insertHTML', false, `<a href="${u.replace(/"/g, '&quot;')}">${u.replace(/</g, '&lt;')}</a>`)
          onDone()
        }}><Input autoFocus value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" className="h-8" /><Button size="sm" type="submit">Add</Button></form>
      </PopoverContent>
    </Popover>
  )
}

function TemplatesButton({ className, onPick, onManage }: { className: string; onPick: (t: Template) => void; onManage: () => void }) {
  const [list, setList] = useState<Template[] | null>(null)
  return (
    <Menu onOpenChange={o => { if (o) mail<Template[]>('/templates').then(setList).catch(e => toast.error(e.message)) }}>
      <MenuTrigger asChild><button className={className} aria-label="Insert template" onMouseDown={e => e.preventDefault()}><FileText /></button></MenuTrigger>
      <MenuContent align="start">
        {list === null ? <div className="px-2 py-1.5 text-sm text-fg-3">Loading…</div> : list.length ? list.map(t => <MenuItem key={t.id} onSelect={() => onPick(t)}><FileText />{t.name}</MenuItem>) : <div className="px-2 py-1.5 text-sm text-fg-3">No templates yet</div>}
        <MenuSeparator />
        <MenuItem onSelect={onManage}><Settings2 />Manage templates…</MenuItem>
      </MenuContent>
    </Menu>
  )
}

function SendLater({ disabled, maxDays, onPick }: { disabled: boolean; maxDays: number; onPick: (d: Date) => void }) {
  const [custom, setCustom] = useState(false)
  const pad = (n: number) => String(n).padStart(2, '0')
  const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  const def = new Date(Date.now() + 864e5); def.setHours(8, 0, 0, 0)
  const [value, setValue] = useState(local(def))
  if (custom) return (
    <Popover open onOpenChange={o => !o && setCustom(false)}>
      <PopoverTrigger asChild><Button variant="primary" className="rounded-l-none border-l border-accent-fg/20 px-2" aria-label="Send later"><ChevronDown /></Button></PopoverTrigger>
      <PopoverContent side="top" className="w-72">
        <form onSubmit={e => { e.preventDefault(); setCustom(false); onPick(new Date(value)) }} className="space-y-2">
          <div className="text-sm font-medium">Send at</div>
          <Input type="datetime-local" value={value} min={local(new Date(Date.now() + 5 * 60000))} max={local(new Date(Date.now() + maxDays * 864e5 - 60000))} onChange={e => setValue(e.target.value)} required />
          <Button type="submit" variant="primary" size="sm" className="w-full"><CalendarClock />Schedule</Button>
        </form>
      </PopoverContent>
    </Popover>
  )
  return (
    <Menu>
      <MenuTrigger asChild><Button variant="primary" disabled={disabled} className="rounded-l-none border-l border-accent-fg/20 px-2" aria-label="Send later"><ChevronDown /></Button></MenuTrigger>
      <MenuContent align="start" side="top">
        {schedulePresets().map(p => <MenuItem key={p.label} onSelect={() => onPick(p.at)}><Clock />{p.label}<span className="ml-auto pl-4 text-xs text-fg-3">{p.at.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span></MenuItem>)}
        <MenuSeparator />
        <MenuItem onSelect={() => setTimeout(() => setCustom(true), 0)}><CalendarClock />Pick date and time…</MenuItem>
      </MenuContent>
    </Menu>
  )
}

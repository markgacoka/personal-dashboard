import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Check, Loader2, Plus, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useDocuments } from './api'
import { stepCount, type ChecklistItem, type ChecklistSection } from './checklistParse'
import { useRefs } from './RefPanel'

// The airplane's own checklist, kept in its profile. Two ways in: upload a
// photo or PDF of the checklist (its text is read, by OCR for a photo, into
// lines you check before saving), or add each line by hand in the order you
// fly it: a section title ("Before landing"), then each item with its value
// ("Mixture" / "RICH"). It's in every brief for the airplane and prints after
// the NavLog.
export function ChecklistEditor({ tail, value, onSave, saving, onCancel }: { tail: string; value: ChecklistSection[] | undefined; onSave: (s: ChecklistSection[]) => void; saving?: boolean; onCancel?: () => void }) {
  const [secs, setSecs] = useState<ChecklistSection[]>(value ?? [])
  const [read, setRead] = useState<{ title: string; method: 'text' | 'ocr'; n: number } | null>(null)
  useEffect(() => setSecs(value ?? []), [value])
  const docs = useDocuments()
  const fileRef = useRef<HTMLInputElement>(null)
  const refs = useRefs()
  const dirty = JSON.stringify(secs) !== JSON.stringify(value ?? [])
  const upd = (i: number, f: (s: ChecklistSection) => ChecklistSection) => setSecs(xs => xs.map((s, k) => (k === i ? f(s) : s)))
  const move = <T,>(xs: T[], i: number, by: number) => { const j = i + by; if (j < 0 || j >= xs.length) return xs; const c = [...xs]; [c[i], c[j]] = [c[j], c[i]]; return c }
  const clean = (xs: ChecklistSection[]) => xs.map(s => ({ title: s.title.trim() || 'Untitled', items: s.items.filter(i => i.item.trim()).map(i => ({ ...i, item: i.item.trim(), action: i.action?.trim() ? i.action.trim().toUpperCase() : undefined })) })).filter(s => s.items.length)
  const busy = docs.upload.isPending || docs.extract.isPending
  const upload = (f: File) => docs.upload.mutate({ file: f, kind: 'checklist', tail, title: `${tail} checklist (${f.name.replace(/\.(pdf|png|jpe?g)$/i, '')})` }, {
    onSuccess: d => docs.extract.mutate(d.id, {
      onSuccess: r => {
        const steps = r.doc.steps ?? []
        if (!steps.length) { toast.error('No checklist lines could be read from that file. Try a sharper photo, or add the lines by hand.'); return }
        setSecs(steps); setRead({ title: d.title, method: r.method, n: stepCount(steps) })
      },
      onError: e => toast.error(e.message),
    }),
    onError: e => toast.error(e.message),
  })
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        <Button size="sm" variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}><Upload />Upload a photo or PDF</Button>
        <span className="text-[13px] text-fg-3">or add each line below, in the order you fly it.</span>
        <span className="num ml-auto text-[13px] text-fg-3">{stepCount(secs)} lines in {secs.length} sections</span>
      </div>
      {busy && <p className="flex items-center gap-2 text-[13px] text-fg-3"><Loader2 className="size-3.5 animate-spin" />{docs.upload.isPending ? 'Uploading…' : 'Reading the checklist…'}</p>}
      {read && (
        <p className="rounded-lg px-3 py-2 text-[13px] text-fg-2 ring-1 ring-inset ring-border">
          Read {read.n} lines from "{read.title}"{read.method === 'ocr' ? ' by text recognition' : ''}. Check each against the original, correct anything misread, then save.{' '}
          <button className="text-accent hover:underline" onClick={() => refs?.show('checklist')}>Open the original</button>
        </p>
      )}

      <div className="space-y-5">
        {secs.map((s, i) => (
          <section key={i} className="rounded-lg ring-1 ring-inset ring-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <span className="num w-6 shrink-0 text-right text-[13px] text-fg-3">{i + 1}</span>
              <Input value={s.title} onChange={e => upd(i, x => ({ ...x, title: e.target.value }))} placeholder="Section title, e.g. Before landing" aria-label="Section title" className="h-8 min-w-0 flex-1 font-medium" />
              <Button size="icon-sm" variant="ghost" aria-label="Move section up" disabled={!i} onClick={() => setSecs(xs => move(xs, i, -1))}><ArrowUp /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Move section down" disabled={i === secs.length - 1} onClick={() => setSecs(xs => move(xs, i, 1))}><ArrowDown /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Remove section" onClick={() => setSecs(xs => xs.filter((_, k) => k !== i))}><X /></Button>
            </div>
            <ol className="space-y-1.5 px-3 py-2.5">
              {s.items.map((it, j) => (
                <li key={j} className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,0.7fr)_auto] items-center gap-2">
                  <span className="num text-right text-[13px] text-fg-3">{j + 1}</span>
                  <Input value={it.item} onChange={e => upd(i, x => ({ ...x, items: x.items.map((y, k) => (k === j ? { ...y, item: e.target.value } : y)) }))} placeholder="Item, e.g. Mixture" aria-label={`Line ${j + 1} item`} className="h-8" />
                  <Input value={it.action ?? ''} onChange={e => upd(i, x => ({ ...x, items: x.items.map((y, k) => (k === j ? { ...y, action: e.target.value } : y)) }))} placeholder="Value, e.g. RICH" aria-label={`Line ${j + 1} value`} className="h-8 uppercase placeholder:normal-case" />
                  <span className="flex">
                    <Button size="icon-sm" variant="ghost" aria-label="Move line up" disabled={!j} onClick={() => upd(i, x => ({ ...x, items: move(x.items, j, -1) }))}><ArrowUp /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Move line down" disabled={j === s.items.length - 1} onClick={() => upd(i, x => ({ ...x, items: move(x.items, j, 1) }))}><ArrowDown /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Remove line" onClick={() => upd(i, x => ({ ...x, items: x.items.filter((_, k) => k !== j) }))}><X /></Button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="px-3 pb-2.5"><Button size="sm" variant="ghost" onClick={() => upd(i, x => ({ ...x, items: [...x.items, { item: '' } as ChecklistItem] }))}><Plus />Add a line</Button></div>
          </section>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setSecs(xs => [...xs, { title: '', items: [{ item: '' }] }])}><Plus />Add a section</Button>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" variant="primary" disabled={!dirty} loading={saving} onClick={() => { onSave(clean(secs)); setRead(null) }}>Save checklist</Button>
        {(dirty || onCancel) && <Button size="sm" variant="ghost" onClick={() => { setSecs(value ?? []); setRead(null); onCancel?.() }}>{dirty ? 'Discard' : 'Cancel'}</Button>}
      </div>
    </div>
  )
}

// Reading and ticking through it (ticks last for this visit only).
export function ChecklistRun({ secs, compact }: { secs: ChecklistSection[]; compact?: boolean }) {
  const [done, setDone] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setDone(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  return (
    <div className={cn('grid gap-x-8 gap-y-5', !compact && '@3xl:grid-cols-2 @7xl:grid-cols-3')}>
      {secs.map((s, i) => (
        <section key={i} className="break-inside-avoid">
          <h4 className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-fg">{s.title}<span className="num text-[13px] font-normal text-fg-3">{s.items.filter((_, j) => done.has(`${i}.${j}`)).length}/{s.items.length}</span></h4>
          <ol className="divide-y divide-border/60">
            {s.items.map((it, j) => {
              const k = `${i}.${j}`, on = done.has(k)
              return (
                <li key={j}>
                  <button onClick={() => toggle(k)} aria-pressed={on} className={cn('flex w-full items-baseline gap-2 py-1.5 text-left text-[13px] hover:bg-hover', it.sub && 'pl-5')}>
                    <span className={cn('grid size-4 shrink-0 translate-y-0.5 place-items-center rounded ring-1 ring-inset', on ? 'bg-accent text-bg ring-accent' : 'ring-border-strong')}>{on && <Check className="size-3" />}</span>
                    <span className={cn('min-w-0 flex-1', on ? 'text-fg-3 line-through' : 'text-fg-2')}>{it.item}</span>
                    {it.action && <span className={cn('num shrink-0 text-right font-medium', on ? 'text-fg-3' : 'text-fg')}>{it.action}</span>}
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}

// The printed copy after the NavLog: two columns of "item ...... ACTION".
export function ChecklistPrint({ tail, secs }: { tail: string; secs: ChecklistSection[] }) {
  return (
    <section className="hidden break-before-page print:block">
      <h2 className="mb-2 text-base font-semibold">{tail} checklist</h2>
      <div className="columns-2 gap-8 text-[11px] leading-snug">
        {secs.map((s, i) => (
          <div key={i} className="mb-3 break-inside-avoid">
            <div className="mb-0.5 border-b border-black font-semibold uppercase">{s.title}</div>
            {s.items.map((it, j) => (
              <div key={j} className={cn('flex gap-1', it.sub && 'pl-3')}>
                <span>{it.item}</span><span className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-black/50" /><span className="font-semibold">{it.action ?? ''}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

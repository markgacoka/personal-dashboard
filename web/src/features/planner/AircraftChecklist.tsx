import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, FileText, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import { useDocuments } from './api'
import { formatChecklist, parseChecklist, stepCount, type ChecklistItem, type ChecklistSection } from './checklistParse'

// The airplane's own checklist, written out once as part of its profile: by
// section and step (item, then action), or as plain text in the POH's
// "Item -- ACTION" form, or imported from a checklist you uploaded. It is
// shown in every brief for this tail and prints after the NavLog.

// Phase headings only (no steps): every airplane's steps come from its own book.
const PHASES = ['Preflight inspection', 'Before starting engine', 'Starting engine', 'Before takeoff', 'Takeoff', 'Enroute climb', 'Cruise', 'Descent', 'Before landing', 'Landing', 'After landing', 'Securing airplane']

export function ChecklistEditor({ tail, value, onSave, saving, onCancel }: { tail: string; value: ChecklistSection[] | undefined; onSave: (s: ChecklistSection[]) => void; saving?: boolean; onCancel?: () => void }) {
  const [secs, setSecs] = useState<ChecklistSection[]>(value ?? [])
  const [mode, setMode] = useState<'form' | 'text'>('form')
  const [text, setText] = useState('')
  useEffect(() => setSecs(value ?? []), [value])
  const docs = useDocuments()
  const uploads = (docs.data ?? []).filter(d => d.kind === 'checklist' && d.tail_number === tail && d.steps?.length)
  const dirty = JSON.stringify(secs) !== JSON.stringify(value ?? [])
  const toText = () => { setText(formatChecklist(secs)); setMode('text') }
  const fromText = () => { setSecs(parseChecklist(text)); setMode('form') }
  const parsed = useMemo(() => (mode === 'text' ? parseChecklist(text) : null), [mode, text])

  const upd = (i: number, f: (s: ChecklistSection) => ChecklistSection) => setSecs(xs => xs.map((s, k) => (k === i ? f(s) : s)))
  const move = <T,>(xs: T[], i: number, by: number) => { const j = i + by; if (j < 0 || j >= xs.length) return xs; const c = [...xs]; [c[i], c[j]] = [c[j], c[i]]; return c }
  const clean = (xs: ChecklistSection[]) => xs.map(s => ({ title: s.title.trim() || 'Untitled', items: s.items.filter(i => i.item.trim()).map(i => ({ ...i, item: i.item.trim(), ...(i.action?.trim() ? { action: i.action.trim().toUpperCase() } : { action: undefined }) })) }))
  const save = () => onSave(clean(mode === 'text' ? parseChecklist(text) : secs).filter(s => s.items.length || s.title !== 'Untitled'))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented size="sm" value={mode} onChange={m => (m === 'text' ? toText() : fromText())} options={[{ value: 'form', label: 'Steps' }, { value: 'text', label: 'Plain text' }]} />
        <span className="text-[13px] text-fg-3">{stepCount(mode === 'text' ? parsed : secs)} steps in {(mode === 'text' ? parsed! : secs).length} sections</span>
        <span className="ml-auto flex flex-wrap gap-2">
          {uploads.map(u => <Button key={u.id} size="sm" variant="ghost" onClick={() => { setSecs(u.steps!); setMode('form') }}><FileText />Import "{u.title}"</Button>)}
          {!secs.length && mode === 'form' && <Button size="sm" variant="ghost" onClick={() => setSecs(PHASES.map(title => ({ title, items: [] })))}>Start with phase headings</Button>}
        </span>
      </div>

      {mode === 'text' ? (
        <div>
          <Textarea value={text} onChange={e => setText(e.target.value)} rows={18} className="num text-[13px]" spellCheck={false}
            placeholder={'# Before takeoff\nParking brake -- SET\nPassenger seat backs -- UPRIGHT\nFlight controls -- FREE AND CORRECT\n\n# Takeoff\nWing flaps -- 0°-10°\nCarburetor heat -- COLD'} />
          <p className="mt-1.5 text-[13px] text-fg-3">One step per line as "Item -- ACTION"; "# Heading" starts a section; indented "a." lines are sub-steps. Pasting the checklist pages from a POH works too.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {secs.map((s, i) => (
            <section key={i} className="rounded-lg ring-1 ring-inset ring-border">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Input value={s.title} onChange={e => upd(i, x => ({ ...x, title: e.target.value }))} placeholder="Section, e.g. Before takeoff" aria-label="Section title" className="h-8 min-w-0 flex-1 font-medium" />
                <Button size="icon-sm" variant="ghost" aria-label="Move section up" disabled={!i} onClick={() => setSecs(xs => move(xs, i, -1))}><ArrowUp /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Move section down" disabled={i === secs.length - 1} onClick={() => setSecs(xs => move(xs, i, 1))}><ArrowDown /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Remove section" onClick={() => setSecs(xs => xs.filter((_, k) => k !== i))}><X /></Button>
              </div>
              <ol className="space-y-1.5 px-3 py-2.5">
                {s.items.map((it, j) => (
                  <li key={j} className={cn('grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,0.7fr)_auto] items-center gap-2', it.sub && 'pl-6')}>
                    <span className="num text-right text-[13px] text-fg-3">{it.sub ? '·' : s.items.slice(0, j + 1).filter(x => !x.sub).length}</span>
                    <Input value={it.item} onChange={e => upd(i, x => ({ ...x, items: x.items.map((y, k) => (k === j ? { ...y, item: e.target.value } : y)) }))} placeholder="Item, e.g. Mixture" aria-label="Item" className="h-8" />
                    <Input value={it.action ?? ''} onChange={e => upd(i, x => ({ ...x, items: x.items.map((y, k) => (k === j ? { ...y, action: e.target.value } : y)) }))} placeholder="Action, e.g. RICH" aria-label="Action" className="h-8 uppercase placeholder:normal-case" />
                    <span className="flex">
                      <Button size="icon-sm" variant="ghost" aria-label="Move step up" disabled={!j} onClick={() => upd(i, x => ({ ...x, items: move(x.items, j, -1) }))}><ArrowUp /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Remove step" onClick={() => upd(i, x => ({ ...x, items: x.items.filter((_, k) => k !== j) }))}><X /></Button>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="px-3 pb-2.5">
                <Button size="sm" variant="ghost" onClick={() => upd(i, x => ({ ...x, items: [...x.items, { item: '' } as ChecklistItem] }))}><Plus />Add a step</Button>
              </div>
            </section>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setSecs(xs => [...xs, { title: '', items: [{ item: '' }] }])}><Plus />Add a section</Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" variant="primary" disabled={!dirty && mode === 'form'} loading={saving} onClick={save}>Save checklist</Button>
        {(dirty || onCancel) && <Button size="sm" variant="ghost" onClick={() => { setSecs(value ?? []); setMode('form'); onCancel?.() }}>{dirty ? 'Discard' : 'Cancel'}</Button>}
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

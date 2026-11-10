import { useEffect, useState } from 'react'
import { Check, Pencil, RotateCcw, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useDocuments, type PlannerDoc } from './api'
import { formatChecklist, parseChecklist, stepCount } from './checklistParse'

// A checklist's steps, extracted from its PDF or photo: tick through them, or
// fix what the extraction got wrong in the text form and save.
export function ChecklistSteps({ doc }: { doc: PlannerDoc }) {
  const docs = useDocuments()
  const steps = doc.steps ?? null
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [done, setDone] = useState<Set<string>>(new Set())
  const [sec, setSec] = useState(0)
  useEffect(() => { setDone(new Set()); setSec(0); setEditing(false) }, [doc.id])

  const extract = () => docs.extract.mutate(doc.id, {
    onSuccess: r => toast.success(`${stepCount(r.doc.steps)} steps in ${r.doc.steps?.length ?? 0} sections${r.method === 'ocr' ? ' (read by OCR: check them)' : ''}`),
    onError: e => toast.error(e.message),
  })
  if (!steps?.length && !editing) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-sm text-fg-3">{steps ? 'No steps were found in this document. Type them in, or try another scan.' : 'Turn this checklist into steps you can tick through.'}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" size="sm" loading={docs.extract.isPending} onClick={extract}><Wand2 />Extract steps</Button>
            <Button variant="ghost" size="sm" onClick={() => { setText(''); setEditing(true) }}><Pencil />Type them</Button>
          </div>
        </div>
      </div>
    )
  }
  if (editing) {
    const parsed = parseChecklist(text)
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 p-2">
        <p className="text-xs text-fg-3">One step per line as <span className="font-mono">Item -- ACTION</span>; <span className="font-mono"># Section</span> starts a section; indent <span className="font-mono">a.</span> for sub-steps.</p>
        <Textarea value={text} onChange={e => setText(e.target.value)} className="min-h-0 flex-1 font-mono text-[13px]" spellCheck={false} aria-label="Checklist steps" />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" loading={docs.saveSteps.isPending} onClick={() => docs.saveSteps.mutate({ id: doc.id, steps: parsed }, { onSuccess: () => { setEditing(false); toast.success('Checklist saved') }, onError: e => toast.error(e.message) })}>Save {stepCount(parsed)} steps</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" variant="ghost" className="ml-auto" loading={docs.extract.isPending} onClick={() => { setEditing(false); extract() }}><Wand2 />Extract again</Button>
        </div>
      </div>
    )
  }
  const s = steps![Math.min(sec, steps!.length - 1)]
  const key = (si: number, i: number) => `${si}.${i}`
  const si = Math.min(sec, steps!.length - 1)
  const left = s.items.filter((it, i) => !done.has(key(si, i)) && !/^(NOTE|CAUTION|WARNING):/.test(it.item)).length
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-none flex gap-1 overflow-x-auto px-2 pb-2">
        {steps!.map((x, i) => {
          const all = x.items.every((it, k) => done.has(key(i, k)) || /^(NOTE|CAUTION|WARNING):/.test(it.item))
          return <button key={i} onClick={() => setSec(i)} className={cn('h-7 shrink-0 rounded-full px-2.5 text-xs ring-1 ring-inset', i === si ? 'bg-pill text-fg ring-border' : 'text-fg-3 ring-transparent hover:text-fg', all && 'text-good')}>{all && <Check className="mr-1 inline size-3" />}{x.title}</button>
        })}
      </div>
      <ol className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-2">
        {s.items.map((it, i) => {
          const note = /^(NOTE|CAUTION|WARNING):/.exec(it.item)
          if (note) return <li key={i} className={cn('my-1 rounded-md px-3 py-2 text-sm', note[1] === 'NOTE' ? 'text-fg-3' : 'bg-warn-soft text-warn')}>{it.item}</li>
          const on = done.has(key(si, i))
          return (
            <li key={i}>
              <label className={cn('flex cursor-pointer items-baseline gap-3 py-2 text-sm', it.sub && 'pl-6')}>
                <input type="checkbox" className="size-4 shrink-0 translate-y-0.5 accent-[var(--accent)]" checked={on} onChange={() => setDone(d => { const n = new Set(d); if (on) n.delete(key(si, i)); else n.add(key(si, i)); return n })} />
                <span className={cn('min-w-0 flex-1', on ? 'text-fg-3 line-through' : 'text-fg')}>{it.item}</span>
                {it.action && <span className={cn('num max-w-[45%] text-right font-medium', on ? 'text-fg-3' : 'text-fg')}>{it.action}</span>}
              </label>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 pt-2">
        <span className="text-xs text-fg-3">{left ? `${left} left in ${s.title}` : `${s.title} complete`}</span>
        {si < steps!.length - 1 && !left && <Button size="sm" variant="secondary" onClick={() => setSec(si + 1)}>Next: {steps![si + 1].title}</Button>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDone(new Set())}><RotateCcw />Clear ticks</Button>
        <Button size="sm" variant="ghost" onClick={() => { setText(formatChecklist(steps!)); setEditing(true) }}><Pencil />Edit steps</Button>
      </div>
    </div>
  )
}

import { Check, CircleCheck, CircleX, RotateCcw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Question } from './model'

export const LETTERS = 'ABCDEFGH'

export function Quiz({ q, picked, setPicked, submitted, correct, hover, setHover }: {
  q: Question
  picked: string[]
  setPicked: (p: string[]) => void
  submitted: boolean
  correct: boolean
  hover: string | null
  setHover: (id: string | null) => void
}) {
  const toggle = (id: string) => {
    if (submitted) return
    if (q.kind === 'choice') setPicked([id])
    else if (q.kind === 'multi') setPicked(picked.includes(id) ? picked.filter(p => p !== id) : [...picked, id])
    else setPicked(picked.includes(id) ? picked.filter(p => p !== id) : [...picked, id])
  }

  return (
    <div>
      <p className="text-lg font-medium leading-snug text-fg">{q.prompt}</p>
      {q.kind === 'order' ? <OrderQ q={q} picked={picked} toggle={toggle} reset={() => setPicked([])} submitted={submitted} /> : (
        <ul className="mt-3 space-y-2">
          {q.options.map((o, i) => {
            const on = picked.includes(o.id)
            const isAns = q.kind === 'choice' ? q.answer === o.id : q.answer.includes(o.id)
            const state = !submitted ? (on ? 'on' : 'off') : isAns ? 'right' : on ? 'wrong' : 'off'
            return (
              <li key={o.id}>
                <button
                  onClick={() => toggle(o.id)} onPointerEnter={() => setHover(o.id)} onPointerLeave={() => setHover(null)} disabled={submitted}
                  className={cn('press flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-[background,border-color] duration-150 active:scale-[0.99]',
                    state === 'on' && 'border-accent bg-accent-soft',
                    state === 'off' && 'border-transparent bg-sunken hover:bg-hover',
                    state === 'right' && 'border-good bg-good-soft',
                    state === 'wrong' && 'border-bad bg-bad-soft',
                    hover === o.id && !submitted && state === 'off' && 'border-border-strong bg-hover')}>
                  <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center text-xs font-semibold',
                    q.kind === 'multi' ? 'rounded' : 'rounded-full',
                    state === 'on' ? 'bg-accent text-accent-fg' : state === 'right' ? 'bg-good text-black' : state === 'wrong' ? 'bg-bad text-black' : 'bg-pill text-fg-2')}>
                    {state === 'right' ? <Check className="size-3.5" /> : state === 'wrong' ? <X className="size-3.5" /> : q.kind === 'multi' ? (on ? <Check className="size-3.5" /> : '') : LETTERS[i]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-relaxed text-fg">{o.label}</span>
                    {submitted && <span className={cn('mt-1 block text-sm leading-relaxed', state === 'right' ? 'text-good' : state === 'wrong' ? 'text-bad' : 'text-fg-3')}>{o.why}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {!submitted ? (
        q.kind === 'multi' && <p className="mt-3 text-sm text-fg-3">Select all that apply.</p>
      ) : (
        <div className={cn('mt-4 rounded-xl px-4 py-3.5 animate-in', correct ? 'bg-good-soft' : 'bg-bad-soft')}>
          <div className={cn('mb-1 flex items-center gap-2 text-sm font-semibold', correct ? 'text-good' : 'text-bad')}>
            {correct ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}{correct ? 'Correct' : 'Not quite'}
          </div>
          <p className="text-sm leading-relaxed text-fg">{q.why}</p>
          {q.refs && <div className="mt-2 flex flex-wrap gap-1.5">{q.refs.map(r => <Badge key={r} tone="outline">{r}</Badge>)}</div>}
        </div>
      )}
    </div>
  )
}

function OrderQ({ q, picked, toggle, reset, submitted }: { q: Extract<Question, { kind: 'order' }>; picked: string[]; toggle: (id: string) => void; reset: () => void; submitted: boolean }) {
  const all = [...q.items, ...(q.distractors || [])]
  const pool = all.slice().sort((a, b) => a.label.localeCompare(b.label)).filter(it => !picked.includes(it.id))
  const label = (id: string) => all.find(a => a.id === id)?.label ?? id
  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-md border border-dashed border-border-strong p-2">
        {!picked.length ? <p className="px-1 py-1.5 text-sm text-fg-3">Tap phrases below to build the sequence.</p> : (
          <ol className="space-y-1.5">
            {picked.map((id, i) => {
              const right = submitted && q.items[i]?.id === id
              return (
                <li key={id}>
                  <button onClick={() => toggle(id)} disabled={submitted} className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm animate-in', submitted ? (right ? 'bg-good-soft text-fg' : 'bg-bad-soft text-fg') : 'bg-accent-soft text-fg hover:bg-hover')}>
                    <span className={cn('num grid size-5 shrink-0 place-items-center rounded-full text-2xs font-semibold', submitted ? (right ? 'bg-good text-black' : 'bg-bad text-black') : 'bg-accent text-accent-fg')}>{i + 1}</span>
                    {label(id)}
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
      {!submitted && (
        <div className="flex flex-wrap gap-2">
          {pool.map(it => <button key={it.id} onClick={() => toggle(it.id)} className="press rounded-full bg-pill px-3.5 py-2 text-sm text-fg hover:bg-pill-hover">{it.label}</button>)}
          {picked.length > 0 && <Button size="sm" variant="ghost" onClick={reset}><RotateCcw />Reset</Button>}
        </div>
      )}
      {submitted && (
        <div>
          <div className="mb-1 text-sm font-medium text-fg-2">Correct sequence</div>
          <ol className="list-decimal space-y-0.5 pl-6 text-sm text-fg">{q.items.map(it => <li key={it.id}>{it.label}</li>)}</ol>
          {q.distractors?.map(d => <p key={d.id} className="mt-2 text-sm text-fg-3"><span className="font-medium text-fg-2">Not “{d.label}”</span>: {d.why}</p>)}
        </div>
      )}
    </div>
  )
}

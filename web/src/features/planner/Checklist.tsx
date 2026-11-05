import { cn } from '@/lib/utils'
import type { CheckItem } from './checklists'
import type { Plan } from './model'
import { StatusIcon, SubHead } from './ui'

// A yes/no checklist whose answers live in the plan (plan.checklist[prefix.key]).
// Unanswered rows count as "to do" on the review step; a "no" is a no-go.
export function Checklist({ title, right, items, prefix, plan, set, yes, no }: {
  title: React.ReactNode; right?: React.ReactNode; items: CheckItem[]; prefix: string; plan: Plan; set: (p: Partial<Plan>) => void; yes: string; no: string
}) {
  const ck = plan.checklist || {}
  const put = (k: string, v: boolean | undefined) => { const next = { ...ck }; if (v == null) delete next[k]; else next[k] = v; set({ checklist: next }) }
  const all = items.every(i => ck[`${prefix}.${i.key}`] === true)
  const markAll = () => { const next = { ...ck }; for (const i of items) { if (all) delete next[`${prefix}.${i.key}`]; else next[`${prefix}.${i.key}`] = true }; set({ checklist: next }) }
  return (
    <div>
      <SubHead right={<span className="flex items-center gap-3">{right}<button className="text-sm text-accent hover:underline" onClick={markAll}>{all ? 'Clear' : `All ${yes.toLowerCase()}`}</button></span>}>{title}</SubHead>
      <ul className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
        {items.map(i => {
          const k = `${prefix}.${i.key}`, v = ck[k]
          return (
            <li key={i.key} className="flex items-center gap-3 px-3 py-2">
              <StatusIcon status={v === true ? 'ok' : v === false ? 'nogo' : 'todo'} />
              <div className="min-w-0 flex-1"><div className="text-sm text-fg">{i.label}</div>{i.detail && <div className="text-sm text-fg-3">{i.detail}</div>}</div>
              <div className="flex shrink-0 gap-1">
                <Choice on={v === true} tone="good" onClick={() => put(k, v === true ? undefined : true)}>{yes}</Choice>
                <Choice on={v === false} tone="bad" onClick={() => put(k, v === false ? undefined : false)}>{no}</Choice>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Choice({ on, tone, onClick, children }: { on: boolean; tone: 'good' | 'bad'; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} aria-pressed={on} className={cn('press h-7 rounded-full px-3 text-sm font-medium ring-1 ring-inset', on ? (tone === 'good' ? 'bg-good-soft text-good ring-good/40' : 'bg-bad-soft text-bad ring-bad/40') : 'text-fg-3 ring-border hover:text-fg')}>{children}</button>
}

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/misc'
import { Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CurrencyItem } from '@/lib/flying'
import { IMSAFE, PAVE } from './checklists'
import { DEFAULT_MINIMUMS, type Minimums, type Plan } from './model'
import { NumField, StatusIcon, SubHead, Synced } from './ui'

export function PilotSection({ plan, set, currency, minimums, savedAt, saveMinimums, saving }: {
  plan: Plan; set: (p: Partial<Plan>) => void; currency: CurrencyItem[]; minimums: Minimums; savedAt?: string; saveMinimums: (m: Minimums) => void; saving: boolean
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <div>
          <SubHead right={<span className="text-xs text-fg-3">AIM 8-1-1 · answer honestly, before the drive to the airport</span>}>IMSAFE</SubHead>
          <ul className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
            {IMSAFE.map(i => {
              const v = plan.imsafe[i.key]
              return (
                <li key={i.key} className="flex items-center gap-3 px-3 py-2.5">
                  <StatusIcon status={v === true ? 'ok' : v === false ? 'nogo' : 'todo'} />
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium text-fg">{i.label}</div><div className="text-sm text-fg-3">{i.detail}</div></div>
                  <div className="flex shrink-0 gap-1">
                    <Choice on={v === true} tone="good" onClick={() => set({ imsafe: { ...plan.imsafe, [i.key]: true } })}>Fit</Choice>
                    <Choice on={v === false} tone="bad" onClick={() => set({ imsafe: { ...plan.imsafe, [i.key]: false } })}>Not fit</Choice>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
        <div>
          <SubHead right={<span className="text-xs text-fg-3">FAA-H-8083-2 Risk Management Handbook</span>}>PAVE</SubHead>
          <div className="space-y-3">
            {PAVE.map(p => (
              <label key={p.key} className="block">
                <span className="mb-1 flex items-baseline gap-2"><span className="text-sm font-medium text-fg">{p.label}</span><span className="text-sm text-fg-3">{p.detail}</span></span>
                <Textarea rows={2} value={plan.pave[p.key] || ''} placeholder={p.prompt} onChange={e => set({ pave: { ...plan.pave, [p.key]: e.target.value } })} />
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-6">
        <div>
          <SubHead right={<span className="text-xs text-fg-3">From your logbook</span>}>Currency and recency</SubHead>
          <ul className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
            {currency.filter(c => c.key !== 'ifr').map(c => (
              <li key={c.key} className="flex gap-3 px-3 py-2.5">
                <StatusIcon status={c.state === 'current' ? 'ok' : c.state === 'lapsed' ? 'caution' : c.state === 'na' ? 'todo' : 'caution'} className="mt-0.5" />
                <div className="min-w-0"><div className="text-sm text-fg">{c.name} <span className="text-fg-3">· {c.rule}</span></div><div className="text-sm text-fg-3">{c.requirement} — {c.detail}</div></div>
              </li>
            ))}
            <li className="px-3 py-2.5 text-sm text-fg-3">Solo as a student pilot also needs your CFI's 90-day solo endorsement (§61.87(n)) and, for a cross-country, the §61.93 endorsements for this route.</li>
          </ul>
        </div>
        <MinimumsEditor minimums={minimums} savedAt={savedAt} onSave={saveMinimums} saving={saving} />
      </div>
    </div>
  )
}

function Choice({ on, tone, onClick, children }: { on: boolean; tone: 'good' | 'bad'; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} aria-pressed={on} className={cn('press h-7 rounded-full px-3 text-sm font-medium ring-1 ring-inset', on ? (tone === 'good' ? 'bg-good-soft text-good ring-good/40' : 'bg-bad-soft text-bad ring-bad/40') : 'text-fg-3 ring-border hover:text-fg')}>{children}</button>
}

function MinimumsEditor({ minimums, savedAt, onSave, saving }: { minimums: Minimums; savedAt?: string; onSave: (m: Minimums) => void; saving: boolean }) {
  const [m, setM] = useState(minimums)
  useEffect(() => setM(minimums), [minimums])
  const dirty = JSON.stringify(m) !== JSON.stringify(minimums)
  const f = (k: keyof Minimums) => (v: number) => setM(x => ({ ...x, [k]: v }))
  return (
    <div>
      <SubHead right={<Synced at={savedAt} label="Saved" source="AOPA Air Safety Institute VFR contract" />}>Personal minimums</SubHead>
      <div className="grid grid-cols-2 gap-3 rounded-lg p-3 ring-1 ring-inset ring-border sm:grid-cols-3">
        <NumField label="Max wind" value={m.maxWind} onChange={f('maxWind')} unit="kt" />
        <NumField label="Max gust" value={m.maxGust} onChange={f('maxGust')} unit="kt" />
        <NumField label="Max crosswind" value={m.maxCrosswind} onChange={f('maxCrosswind')} unit="kt" />
        <NumField label="Ceiling, day" value={m.ceilingDay} onChange={f('ceilingDay')} unit="ft" step={500} />
        <NumField label="Ceiling, night" value={m.ceilingNight} onChange={f('ceilingNight')} unit="ft" step={500} />
        <NumField label="Visibility, day" value={m.visDay} onChange={f('visDay')} unit="SM" />
        <NumField label="Visibility, night" value={m.visNight} onChange={f('visNight')} unit="SM" />
        <NumField label="Runway length" value={m.runwayLength} onChange={f('runwayLength')} unit="ft" step={100} />
        <NumField label="Runway width" value={m.runwayWidth} onChange={f('runwayWidth')} unit="ft" step={5} />
        <NumField label="Fuel reserve, day" value={m.reserveDay} onChange={f('reserveDay')} unit="min" step={15} hint="ASI: land with 1 hour" />
        <NumField label="Fuel reserve, night" value={m.reserveNight} onChange={f('reserveNight')} unit="min" step={15} />
        <label className="flex items-center justify-between gap-3 self-end rounded-lg px-1 pb-2 text-sm text-fg-2">Night flight<Switch checked={m.nightAllowed} onCheckedChange={v => setM(x => ({ ...x, nightAllowed: v }))} /></label>
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="primary" disabled={!dirty} loading={saving} onClick={() => onSave(m)}>Save minimums</Button>
        {dirty && <Button size="sm" variant="ghost" onClick={() => setM(minimums)}>Discard</Button>}
        <Button size="sm" variant="ghost" onClick={() => setM(DEFAULT_MINIMUMS)}>Reset to defaults</Button>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/misc'
import { DEFAULT_MINIMUMS, type Minimums } from './model'
import { NumField, SubHead, Synced } from './ui'

// The personal minimums every go/no-go check is measured against.
export function MinimumsEditor({ minimums, savedAt, onSave, saving }: { minimums: Minimums; savedAt?: string; onSave: (m: Minimums) => void; saving: boolean }) {
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

import type { CurrencyItem } from '@/lib/flying'
import { IMSAFE } from './checklists'
import { Checklist } from './Checklist'
import { MinimumsEditor } from './Minimums'
import type { Derived, Minimums, Plan, Status } from './model'
import { StatusIcon, SubHead } from './ui'

interface MinRow { label: string; limit: string; actual: string; status: Status; where?: string }

// Your personal minimums held against this flight: the worst ceiling,
// visibility, wind, gust and crosswind at any ETA, the shortest and narrowest
// runway you'll use, the fuel you'll land with, and night.
export function minimumsRows(d: Derived, m: Minimums): MinRow[] {
  const rows: MinRow[] = []
  const wx = d.wx
  const night = wx.some(w => w.night)
  const id = (a: { icao: string | null; id: string }) => a.icao || a.id
  const worst = <T,>(xs: T[], key: (x: T) => number | null, dir: 1 | -1) => xs.filter(x => key(x) != null).sort((a, b) => (key(a)! - key(b)!) * dir)[0]
  const ceil = worst(wx, w => w.ceiling ?? (w.category ? 99999 : null), 1)
  const ceilMin = night ? m.ceilingNight : m.ceilingDay
  rows.push({ label: `Ceiling (${night ? 'night' : 'day'})`, limit: `≥ ${ceilMin.toLocaleString()} ft`, actual: ceil ? (ceil.ceiling == null ? 'No ceiling' : `${ceil.ceiling.toLocaleString()} ft`) : '—', where: ceil && id(ceil.airport), status: !ceil ? 'todo' : ceil.ceiling == null || ceil.ceiling >= ceilMin ? 'ok' : 'nogo' })
  const vis = worst(wx, w => w.visib, 1)
  const visMin = night ? m.visNight : m.visDay
  rows.push({ label: `Visibility (${night ? 'night' : 'day'})`, limit: `≥ ${visMin} SM`, actual: vis ? `${vis.visib} SM` : '—', where: vis && id(vis.airport), status: !vis ? 'todo' : vis.visib! >= visMin ? 'ok' : 'nogo' })
  const wind = worst(wx.filter(w => w.wind.from), w => w.wind.spd, -1)
  rows.push({ label: 'Surface wind', limit: `≤ ${m.maxWind} kt`, actual: wind ? `${wind.wind.spd} kt` : '—', where: wind && id(wind.airport), status: !wind ? 'todo' : wind.wind.spd <= m.maxWind ? 'ok' : 'nogo' })
  const gust = worst(wx.filter(w => w.wind.from), w => w.wind.gust ?? 0, -1)
  rows.push({ label: 'Gusts', limit: `≤ ${m.maxGust} kt`, actual: gust ? (gust.wind.gust ? `${gust.wind.gust} kt` : 'None') : '—', where: gust?.wind.gust ? id(gust.airport) : undefined, status: !gust ? 'todo' : (gust.wind.gust ?? 0) <= m.maxGust ? 'ok' : 'nogo' })
  const xw = worst(d.perf.filter(p => p.runway), p => Math.abs(p.runway!.cross), -1)
  rows.push({ label: 'Crosswind', limit: `≤ ${m.maxCrosswind} kt`, actual: xw ? `${Math.abs(xw.runway!.cross)} kt RWY ${xw.runway!.end.id}` : '—', where: xw && id(xw.airport), status: !xw ? 'todo' : Math.abs(xw.runway!.cross) <= m.maxCrosswind ? 'ok' : 'nogo' })
  const len = worst(d.perf.filter(p => p.runway), p => (p.kind === 'takeoff' ? p.runway!.toraFt : p.runway!.ldaFt), 1)
  const lenFt = len ? (len.kind === 'takeoff' ? len.runway!.toraFt : len.runway!.ldaFt) : null
  rows.push({ label: 'Runway length', limit: `≥ ${m.runwayLength.toLocaleString()} ft`, actual: lenFt ? `${lenFt.toLocaleString()} ft RWY ${len!.runway!.end.id}` : '—', where: len && id(len.airport), status: lenFt == null ? 'todo' : lenFt >= m.runwayLength ? 'ok' : 'caution' })
  const wid = worst(d.perf.filter(p => p.runway?.runway.wid), p => p.runway!.runway.wid, 1)
  rows.push({ label: 'Runway width', limit: `≥ ${m.runwayWidth} ft`, actual: wid ? `${wid.runway!.runway.wid} ft RWY ${wid.runway!.end.id}` : '—', where: wid && id(wid.airport), status: !wid ? 'todo' : wid.runway!.runway.wid! >= m.runwayWidth ? 'ok' : 'caution' })
  const t = d.totals
  const gph = d.flights[0]?.cruise?.gph ?? 0
  const left = t.usableFuel - t.tripFuel - t.taxiFuel
  const leftMin = gph ? (left / gph) * 60 : null
  const resMin = night ? m.reserveNight : m.reserveDay
  rows.push({ label: 'Fuel at landing', limit: `≥ ${resMin} min`, actual: leftMin != null ? `${Math.round(leftMin)} min (${left.toFixed(1)} gal)` : '—', status: leftMin == null || !d.legs.length ? 'todo' : leftMin >= resMin ? 'ok' : 'nogo' })
  rows.push({ label: 'Night', limit: m.nightAllowed ? 'Allowed' : 'Day only', actual: wx.length ? (night ? 'Part of the flight after civil twilight' : 'All in daylight') : '—', status: !wx.length ? 'todo' : night && !m.nightAllowed ? 'nogo' : 'ok' })
  return rows
}

// Step 7: you — IMSAFE, your minimums against this flight, and recency from the logbook.
export function PilotStep({ plan, set, d, currency, minimums, savedAt, saveMinimums, saving }: {
  plan: Plan; set: (p: Partial<Plan>) => void; d: Derived; currency: CurrencyItem[]; minimums: Minimums; savedAt?: string; saveMinimums: (m: Minimums) => void; saving: boolean
}) {
  const rows = minimumsRows(d, minimums)
  return (
    <div className="grid gap-8 xl:grid-cols-2">
      <div className="space-y-8">
        <Checklist title="Pilot condition · IMSAFE" right={<span className="text-xs text-fg-3">AIM 8-1-1</span>} items={IMSAFE} prefix="imsafe" plan={plan} set={set} yes="Fit" no="Not fit" />
        <div>
          <SubHead right={<span className="text-xs text-fg-3">From your logbook</span>}>Currency and recency</SubHead>
          <ul className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
            {currency.filter(c => c.key !== 'ifr').map(c => (
              <li key={c.key} className="flex gap-3 px-3 py-2.5">
                <StatusIcon status={c.state === 'current' ? 'ok' : c.state === 'na' ? 'todo' : 'caution'} className="mt-0.5" />
                <div className="min-w-0"><div className="text-sm text-fg">{c.name} <span className="text-fg-3">· {c.rule}</span></div><div className="text-sm text-fg-3">{c.requirement} — {c.detail}</div></div>
              </li>
            ))}
            <li className="px-3 py-2.5 text-sm text-fg-3">Solo as a student pilot also needs your CFI's 90-day solo endorsement (§61.87(n)) and, for a cross-country, the §61.93 endorsements for this route.</li>
          </ul>
        </div>
      </div>
      <div className="space-y-8">
        <div>
          <SubHead right={<span className="text-xs text-fg-3">Worst value at any ETA</span>}>Personal minimums for this flight</SubHead>
          <ul className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
            {rows.map(r => (
              <li key={r.label} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm">
                <StatusIcon status={r.status} />
                <div className="min-w-0"><span className="text-fg">{r.label}</span> <span className="text-fg-3">{r.limit}</span></div>
                <div className="num text-right text-fg">{r.actual}{r.where && <span className="text-fg-3"> · {r.where}</span>}</div>
              </li>
            ))}
          </ul>
        </div>
        <details className="group">
          <summary className="cursor-pointer text-sm text-accent">Edit your minimums</summary>
          <div className="mt-3"><MinimumsEditor minimums={minimums} savedAt={savedAt} onSave={saveMinimums} saving={saving} /></div>
        </details>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { ExternalLink, Pencil } from 'lucide-react'
import { Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { titleCase } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDatis, useNearby } from './api'
import { notamHighlights, type NotamSet } from './brief'
import { toMagnetic, windComponents } from './calc'
import { OptNum } from './FlightInputs'
import { bestRunway, isWaypoint, type Airport, type AirportProfile, type Derived, type Minimums, type WxAt } from './model'
import { Cat, KV, SubHead, Synced, deg3, fmtTime } from './ui'

const FREQ_LABEL: Record<string, string> = {
  'LCL/P': 'Tower', 'LCL/S': 'Tower (sec.)', 'GND/P': 'Ground', 'GND/S': 'Ground (sec.)', 'CD/P': 'Clearance', ATIS: 'ATIS', 'D-ATIS': 'D-ATIS', CTAF: 'CTAF', UNICOM: 'UNICOM',
  'APCH/P': 'Approach', 'APCH/S': 'Approach', 'DEP/P': 'Departure', 'DEP/S': 'Departure', 'APCH/P DEP/P': 'Approach/Departure', 'APCH/P DEP/P IC': 'Approach/Departure', 'DEP/P IC': 'Departure', 'APCH/S IC': 'Approach', 'APCH/P IC': 'Approach', 'CLASS C': 'Class C', 'CLASS B': 'Class B',
}
const ORDER = ['ATIS', 'D-ATIS', 'CD/P', 'GND/P', 'GND/S', 'LCL/P', 'LCL/S', 'CTAF', 'UNICOM', 'DEP/P', 'DEP/P IC', 'DEP/S', 'APCH/P', 'APCH/S', 'APCH/S IC', 'APCH/P IC', 'APCH/P DEP/P', 'APCH/P DEP/P IC', 'CLASS C', 'CLASS B']

// Step 4: every airport on the trip as AirNav and the Chart Supplement show it —
// elevation, pattern altitude, runways with length, width, surface and pattern
// side, frequencies — plus the runway the wind favours at your ETA (or the one
// D-ATIS says is in use), NOTAMs that matter, and the alternate.
export function AirportsStep({ d, routePts, alternate, autoAlternate, setAlternate, minimums, notams, cycle, nasr, profiles, saveProfile, savingProfile }: {
  d: Derived; routePts: Airport[]; alternate: Airport | null; autoAlternate: string | null; setAlternate: (v: string | null) => void
  minimums: Minimums; notams: NotamSet[]; cycle: string | null
  nasr: Airport[]; profiles: Record<string, AirportProfile>; saveProfile: (id: string, p: AirportProfile | null) => void; savingProfile: boolean
}) {
  // Departure and arrival only: airports between them are route points you fly over.
  const ends = routePts.length >= 2 ? [routePts[0], routePts[routePts.length - 1]] : routePts.slice(0, 1)
  const apts = ends.filter(a => !isWaypoint(a)).filter((a, i, arr) => arr.findIndex(b => b.id === a.id) === i)
  const dest = routePts.length >= 2 && !isWaypoint(routePts[routePts.length - 1]) ? routePts[routePts.length - 1] : null
  const all = [...apts, ...(alternate && !apts.some(a => a.id === alternate.id) ? [alternate] : [])]
  const roleOf = (a: Airport) => (a.id === alternate?.id && !apts.some(x => x.id === a.id) ? 'Alternate' : a.id === routePts[0]?.id ? (a.id === dest?.id ? 'Departure and destination' : 'Departure') : 'Destination')
  if (!all.length) return <p className="text-sm text-fg-3">Add the airports in step 1.</p>
  return (
    <div className="@container space-y-6">
      <Synced at={cycle ?? undefined} label="FAA NASR cycle" source="Chart Supplement data · wind from METAR/TAF at your ETA · NOTAMs from the FAA" />
      <div className="grid gap-5 @5xl:grid-cols-2">
        {all.map(a => <AirportCard key={a.id} a={a} role={roleOf(a)} wx={d.wx.find(w => w.airport.id === a.id) ?? null} minimums={minimums} notams={notams.find(n => n.icao === (a.icao || a.id)) ?? null}
          nasr={nasr.find(x => x.id === a.id) ?? a} profile={profiles[a.icao || a.id] ?? null} save={p => saveProfile(a.icao || a.id, p)} saving={savingProfile} />)}
      </div>
      {dest && <Alternate dest={dest} value={alternate ? (alternate.icao || alternate.id) : null} auto={autoAlternate} onChange={setAlternate} exclude={apts.map(a => a.id)} wx={d.wx} />}
    </div>
  )
}

function Alternate({ dest, value, auto, onChange, exclude, wx }: { dest: Airport; value: string | null; auto: string | null; onChange: (v: string | null) => void; exclude: string[]; wx: WxAt[] }) {
  const { data = [] } = useNearby({ lat: dest.lat, lon: dest.lon })
  const list = data.filter(a => !exclude.includes(a.id)).slice(0, 8)
  const w = wx.find(x => x.role === 'alternate')
  return (
    <div>
      <SubHead right={<span className="text-xs text-fg-3">Public, runway long enough for a 172, within 40 nm of {dest.icao || dest.id}</span>}>Alternate</SubHead>
      <p className="mb-2 text-sm text-fg-3">{value ? <>{value === auto ? 'Chosen automatically: the nearest suitable airport not forecast IFR.' : 'Chosen by you.'}{w && <> At ETA <span className="num">{fmtTime(w.at)}</span>: <Cat cat={w.category} /></>}</> : 'No alternate.'}</p>
      <div className="flex flex-wrap gap-1.5">
        {list.map(a => {
          const id = a.icao || a.id, sel = value === id
          return (
            <button key={a.id} onClick={() => onChange(id)} aria-pressed={sel}
              className={cn('press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm ring-1 ring-inset', sel ? 'bg-accent-soft text-accent ring-accent/40' : 'text-fg-2 ring-border hover:bg-hover')}>
              <span className="num font-medium">{id}</span><span className="text-fg-3">{a.distNm} nm</span>{a.towered && <span className="text-xs text-fg-3">TWR</span>}
            </button>
          )
        })}
        {value !== auto && auto && <button className="h-8 px-2 text-sm text-accent hover:underline" onClick={() => onChange(null)}>Automatic</button>}
        {!list.length && <span className="text-sm text-fg-3">Looking for nearby airports…</span>}
      </div>
    </div>
  )
}

// Your airport profile: what NASR doesn't say or says wrong. Kept for every
// plan; pattern altitude and sides feed the navlog (TPA, descent) and the
// favored runway; notes go on the NavLog sheet.
function AirportProfileForm({ a, profile, saving, onSave, onCancel }: { a: Airport; profile: AirportProfile | null; saving: boolean; onSave: (p: AirportProfile | null) => void; onCancel: () => void }) {
  const id = a.icao || a.id
  const [tpa, setTpa] = useState<number | null>(profile?.tpaMsl ?? null)
  const [pattern, setPattern] = useState<Record<string, 'L' | 'R'>>(profile?.pattern ?? {})
  const [notes, setNotes] = useState(profile?.notes ?? '')
  const nasrTpa = Math.round((a.elev + (a.tpaAgl || 1000)) / 10) * 10
  const ends = a.runways.flatMap(r => r.ends)
  const side = (e: (typeof ends)[number]) => pattern[e.id] ?? (e.right ? 'R' : 'L')
  const flip = (e: (typeof ends)[number], v: 'L' | 'R') => setPattern(p => { const n = { ...p }; if (v === (e.right ? 'R' : 'L')) delete n[e.id]; else n[e.id] = v; return n })
  return (
    <div className="mt-3 space-y-3 rounded-lg px-3 py-3 ring-1 ring-inset ring-border">
      <div className="text-sm font-medium text-fg">Your <span className="num">{id}</span> profile</div>
      <label className="block max-w-xs"><span className="mb-1 block text-sm text-fg-2">Pattern altitude (MSL)</span>
        <OptNum value={tpa} placeholder={nasrTpa} unit="ft" step={10} onChange={setTpa} label={`${id} pattern altitude`} />
        <span className="mt-0.5 block text-xs text-fg-3">Blank: {nasrTpa.toLocaleString()} ft {a.tpaAgl ? '(Chart Supplement)' : '(1,000 AGL; none published)'}</span>
      </label>
      {ends.length > 0 && (
        <div>
          <span className="mb-1 block text-sm text-fg-2">Traffic pattern</span>
          <div className="flex flex-wrap gap-2">
            {ends.map(e => (
              <div key={e.id} className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-0.5 text-sm ring-1 ring-inset ring-border">
                <span className="num mr-1 font-medium">{e.id}</span>
                {(['L', 'R'] as const).map(v => (
                  <button key={v} onClick={() => flip(e, v)} aria-pressed={side(e) === v} className={cn('h-6 rounded-full px-2 text-xs font-medium', side(e) === v ? 'bg-accent text-bg' : 'text-fg-3 hover:text-fg')}>{v === 'L' ? 'Left' : 'Right'}</button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <label className="block"><span className="mb-1 block text-sm text-fg-2">Notes (shown on the NavLog)</span>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={2000} placeholder="e.g. Call tower over Lexington Reservoir; fuel at the self-serve island; noise abatement on 31R" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={saving} onClick={() => onSave({ tpaMsl: tpa, pattern, notes: notes.trim() })}>Save {id} profile</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        {profile && <Button variant="danger-ghost" className="ml-auto" onClick={() => onSave(null)}>Delete profile</Button>}
      </div>
    </div>
  )
}

// "LANDING AND DEPARTING RWY 31R" → ['31R']; the runways ATIS says are in use.
export function atisRunways(text: string) {
  const out = new Set<string>()
  for (const m of text.toUpperCase().matchAll(/\b(?:LANDING|LDG|ARRIVING|ARR|DEPARTING|DEPG|DEPTG|DEP|APCH|APPROACH)[A-Z ,/]*?\bRWYS?\s+((?:\d{1,2}[LRC]?)(?:\s*(?:,|AND|&|\/)\s*\d{1,2}[LRC]?)*)/g))
    for (const r of m[1].split(/\s*(?:,|AND|&|\/)\s*/)) if (r) out.add(r.replace(/^0(?=\d[LRC]?$)/, ''))
  return [...out]
}

function AirportCard({ a, role, wx, minimums, notams, nasr, profile, save, saving }: { a: Airport; role: string; wx: WxAt | null; minimums: Minimums; notams: NotamSet | null; nasr: Airport; profile: AirportProfile | null; save: (p: AirportProfile | null) => void; saving: boolean }) {
  const [more, setMore] = useState(false)
  const [editing, setEditing] = useState(false)
  const id = a.icao || a.id
  const datis = useDatis(a.icao, a.towered)
  const atis = datis.data?.data?.[0]
  const inUse = atis ? atisRunways(atis.text) : []
  const tpa = Math.round((a.elev + (a.tpaAgl || 1000)) / 10) * 10
  const freqs = [...a.frequencies, ...(a.approach?.frequencies.map(f => ({ ...f, sector: [f.sector, `via ${a.approach!.via}`].filter(Boolean).join(' · ') })) ?? [])]
  const sorted = [...freqs].sort((x, y) => (ORDER.indexOf(x.use) + 1 || 99) - (ORDER.indexOf(y.use) + 1 || 99))
  const best = wx ? bestRunway(a, wx, minimums.runwayWidth)[0] ?? null : null
  const ends = a.runways.flatMap(r => r.ends.filter(e => e.trueHdg != null).map(e => {
    const c = wx ? windComponents(wx.wind.dir, wx.wind.gust ?? wx.wind.spd, e.trueHdg!) : null
    return { r, e, c, mag: toMagnetic(e.trueHdg!, a.magVar) }
  }))
  const nh = notams && !notams.unavailable ? notamHighlights(notams.items, 8) : null
  return (
    <div className="@container rounded-lg p-3 ring-1 ring-inset ring-border sm:p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[14rem] flex-1">
          <div className="flex items-baseline gap-2"><span className="num text-lg font-medium text-fg">{id}</span><span className="text-sm text-fg-3">{role}</span></div>
          <div className="text-sm text-fg-2">{titleCase(a.name)} · {titleCase(a.city)}, {a.state}</div>
        </div>
        <div className="flex gap-1">
          {[['AirNav', `https://www.airnav.com/airport/${id}`], ['SkyVector', `https://skyvector.com/airport/${a.id}`]].map(([l, h]) => (
            <Button key={l} asChild size="sm" variant="ghost"><a href={h} target="_blank" rel="noopener noreferrer">{l}<ExternalLink /></a></Button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone={a.towered ? 'accent' : 'neutral'}>{a.towered ? `Towered${a.towerHrs ? ` ${a.towerHrs}` : ''}` : 'Non-towered'}</Badge>
        {a.airspace?.B && <Badge tone="accent">Class B</Badge>}{a.airspace?.C && <Badge tone="accent">Class C</Badge>}{a.airspace?.D && <Badge>Class D</Badge>}{a.airspace?.E && <Badge>Class E surface</Badge>}
        {a.use !== 'PU' && <Badge tone="warn">Private use</Badge>}
        {wx && <Badge tone="outline">ETA {fmtTime(wx.at)}</Badge>}
        {wx?.category && <Cat cat={wx.category} />}
      </div>

      <div className="mt-3 rounded-lg bg-accent-soft/40 px-3 py-2.5 text-sm ring-1 ring-inset ring-accent/20">
        {inUse.length > 0 ? (
          <span><span className="font-medium text-fg">In use: RWY {inUse.join(', ')}</span> <span className="text-fg-3">· D-ATIS {atis!.code} {atis!.time ? `${atis!.time}Z` : ''}</span></span>
        ) : best ? (
          <span><span className="font-medium text-fg">Favored: RWY {best.end.id}</span> <span className="text-fg-3">· {best.end.right ? 'right' : 'left'} traffic · wind {wx!.wind.dir == null ? (wx!.wind.spd ? 'variable' : 'calm') : `${deg3(wx!.wind.dir)}°`}{wx!.wind.spd ? ` ${wx!.wind.spd}${wx!.wind.gust ? `G${wx!.wind.gust}` : ''} kt` : ''} ({wx!.wind.from === 'taf' ? `TAF ${wx!.tafStation}` : wx!.metarStation ? `METAR ${wx!.metarStation}` : 'no report'}) · {best.head >= 0 ? `${best.head} kt head` : `${-best.head} kt tail`}, {Math.abs(best.cross)} kt cross</span></span>
        ) : <span className="text-fg-3">No wind report near {id}; listen to the ATIS/AWOS.</span>}
        {atis && <details className="mt-1"><summary className="cursor-pointer text-xs text-accent">D-ATIS text</summary><p className="num mt-1 text-xs text-fg-2">{atis.text}</p></details>}
      </div>

      <div className="mt-3 overflow-x-auto"><table className="num w-full text-sm sm:min-w-[30rem] [&_td+td]:whitespace-nowrap [&_td+td]:pl-2 [&_th+th]:pl-2">
        <thead><tr className="text-left text-xs text-fg-3"><th className="pb-1 font-medium">Runway</th><th className="pb-1 font-medium">Size (ft)</th><th className="pb-1 font-medium">Pattern</th><th className="pb-1 text-right font-medium">Head / cross</th><th className="pb-1 pl-3 font-medium max-sm:hidden">Notes</th></tr></thead>
        <tbody>{ends.map(({ r, e, c, mag }) => {
          const fav = inUse.length ? inUse.includes(e.id) : best?.end.id === e.id
          const notes = [r.surface, e.displaced ? `thr displaced ${e.displaced}` : null, e.vgsi, r.lights ? `${r.lights} lights` : null].filter(Boolean).join(' · ')
          return (
            <tr key={`${r.id}-${e.id}`} className={cn('border-t border-border align-top', fav && 'font-semibold text-fg')}>
              <td className="py-1.5">{e.id} <span className="font-normal text-fg-3">{deg3(mag)}°</span>{notes && <div className="font-sans text-xs font-normal text-fg-3 sm:hidden">{notes}</div>}</td>
              <td className="py-1.5">{r.len.toLocaleString()} × {r.wid ?? '—'}</td>
              <td className="py-1.5">{e.right ? 'Right' : 'Left'}</td>
              <td className="py-1.5 text-right">{c ? `${c.head >= 0 ? c.head : `−${-c.head}`} / ${Math.abs(c.cross)}` : '—'}</td>
              <td className="py-1.5 pl-3 font-sans text-xs font-normal text-fg-3 whitespace-normal! max-sm:hidden">{notes}</td>
            </tr>
          )
        })}</tbody>
      </table></div>

      <KV className="mt-3" items={[
        ['Elevation', <span className="num">{Math.round(a.elev).toLocaleString()} ft</span>],
        ['Pattern altitude', <span className="num">{tpa.toLocaleString()} ft MSL{profile?.tpaMsl ? <span className="font-sans text-fg-3"> (your profile)</span> : a.tpaAgl ? '' : ' (1,000 AGL, not published)'}</span>],
        ['Weather', a.wx ? <span>{a.wx.type} {a.wx.id !== a.id ? `at ${a.wx.id} (${a.wx.distNm} nm)` : ''} {a.wx.freq && <span className="num">{a.wx.freq}</span>} {a.wx.phone && <a className="num whitespace-nowrap text-accent hover:underline" href={`tel:${a.wx.phone}`}>{a.wx.phone}</a>}</span> : 'No AWOS/ASOS within 30 nm'],
        ['Flight service', <span>{a.fss?.id ? `${a.fss.name ? titleCase(a.fss.name) : a.fss.id} FSS · ` : ''}<span className="num">122.2</span> · <a className="num whitespace-nowrap text-accent hover:underline" href="tel:18009927433">1-800-WX-BRIEF</a></span>],
        ['Sun', a.sun ? <span className="num">Rise {fmtTime(new Date(a.sun.rise))} · set {fmtTime(new Date(a.sun.set))} · civil dusk {fmtTime(new Date(a.sun.civilDusk))}</span> : null],
        ['Density altitude', wx?.da != null ? <span className="num">{wx.da.toLocaleString()} ft ({wx.tempC} °C, {wx.altimInHg?.toFixed(2)} inHg)</span> : null],
      ]} />

      <div className="mt-3 grid gap-x-6 text-sm @lg:grid-cols-2">
        {sorted.map((f, i) => (
          <div key={i} className="flex min-w-0 items-baseline gap-2 border-b border-border py-1"><span className="shrink-0 text-fg-3">{FREQ_LABEL[f.use] || f.use}</span><span className="num ml-auto text-fg">{f.freq}</span>{f.sector && <span className="w-28 shrink-0 truncate text-right text-xs text-fg-3" title={f.sector}>{f.sector}</span>}</div>
        ))}
      </div>

      <div className="mt-3 text-sm">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-3">NOTAMs that affect a VFR flight</div>
        {!notams ? <span className="text-fg-3">Loading…</span> : notams.unavailable ? <span className="text-warn">Unavailable — check notams.aim.faa.gov or 1800wxbrief.com.</span>
          : nh!.shown.length ? <ul className="list-disc space-y-0.5 pl-5 text-fg-2">{nh!.shown.map((n, i) => <li key={i}>{n}</li>)}{nh!.more > 0 && <li className="text-fg-3">+{nh!.more} more in the weather step</li>}</ul>
            : <span className="text-fg-3">None ({notams.items.length} total, all IFR procedures, obstacles or charts).</span>}
      </div>

      {a.notes && !editing && <div className="mt-3 rounded-lg bg-accent-soft/40 px-3 py-2 text-sm ring-1 ring-inset ring-accent/20"><span className="font-medium text-fg">Your notes</span><p className="whitespace-pre-wrap text-fg-2">{a.notes}</p></div>}
      {editing ? <AirportProfileForm a={nasr} profile={profile} saving={saving} onCancel={() => setEditing(false)} onSave={p => { save(p); setEditing(false) }} />
        : <button className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent hover:underline" onClick={() => setEditing(true)}><Pencil className="size-3.5" />{profile ? `Edit your ${id} profile` : `Save a ${id} profile (pattern altitude, pattern sides, notes)`}</button>}

      {a.remarks.length > 0 && (
        <div className="mt-3">
          <button className="text-sm text-accent hover:underline" onClick={() => setMore(m => !m)}>{more ? 'Hide' : 'Show'} Chart Supplement remarks ({a.remarks.length})</button>
          {more && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-2">{a.remarks.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </div>
      )}
    </div>
  )
}

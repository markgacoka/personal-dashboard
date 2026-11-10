import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/misc'
import { useNotams } from '@/lib/queries'
import { NOTAM_KIND, notamBody, notamDate, notamExpand } from '@/lib/weather'
import { cn } from '@/lib/utils'
import { WindCompass } from '@/features/flying/WindCompass'
import { distanceNm, windComponents } from './calc'
import { useDatis } from './api'
import type { Derived, WeatherBundle, WxAt } from './model'
import { Cat, StatusIcon, SubHead, Synced, deg3, fmtTime, fmtZ } from './ui'

export function WeatherSection({ d, weather, loading, refetch, fetching }: { d: Derived; weather: WeatherBundle | null; loading: boolean; refetch: () => void; fetching: boolean }) {
  if (loading && !weather) return <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map(i => <Skeleton key={i} className="h-64" />)}</div>
  if (!d.wx.length) return <p className="text-sm text-fg-3">Add a route and departure time to brief the weather at each ETA.</p>
  return (
    <>
      <Synced at={weather?.metars.fetchedAt} source="aviationweather.gov (NOAA AWC) · nasstatus.faa.gov · tfr.faa.gov · refreshes every 5 min" onRefresh={refetch} refreshing={fetching} />
      <div className="grid gap-4 lg:grid-cols-2 3xl:grid-cols-3">
        {byAirport(d.wx).map(ws => <AirportWx key={ws[0].airport.id + ws[0].role} ws={ws} nas={weather?.nas.data?.items.filter(x => x.airport === ws[0].airport.id) ?? []} />)}
      </div>
      <Hazards d={d} weather={weather} />
      <WindsTable d={d} weather={weather} />
      <NotamsBlock ids={[...new Set(d.wx.map(w => w.airport.icao || w.airport.id))]} />
    </>
  )
}

// One card per airport: a round trip's departure and destination share it, with
// the later ETA shown only where its forecast differs.
export function byAirport(wx: WxAt[]) {
  const out: WxAt[][] = []
  for (const w of wx) { const g = out.find(x => x[0].airport.id === w.airport.id && w.role !== 'alternate' && x[0].role !== 'alternate'); if (g) g.push(w); else out.push([w]) }
  return out
}
const ROLE = { departure: 'Departure', stop: 'Stop', destination: 'Destination', alternate: 'Alternate' }
const windText = (w: WxAt) => (w.wind.from ? `${w.wind.dir == null ? 'VRB' : deg3(w.wind.dir)}° ${w.wind.spd}${w.wind.gust ? `G${w.wind.gust}` : ''} kt` : '—')
// The facts that can change between two ETAs at the same airport.
export function wxFacts(w: WxAt): [string, string][] {
  return [
    ['Category', w.category ?? '—'], ['Wind', windText(w)], ['Ceiling', w.ceiling ? `${w.ceiling.toLocaleString()} ft` : 'None'],
    ['Visibility', w.visib != null ? `${w.visib} SM` : '—'], ['Altimeter', w.altimInHg ? w.altimInHg.toFixed(2) : '—'],
    ['Temp', w.tempC != null ? `${Math.round(w.tempC)} °C` : '—'], ['Density alt', w.da != null ? `${w.da.toLocaleString()} ft` : '—'],
    ['Daylight', w.night ? 'Night' : w.night === false ? 'Day' : '—'],
  ]
}
export function wxDiff(a: WxAt, b: WxAt) {
  const fa = wxFacts(a), fb = wxFacts(b)
  return fb.map(([k, v], i) => ({ k, from: fa[i][1], to: v })).filter(x => x.from !== x.to)
}
const srcText = (w: WxAt) => (w.wind.from === 'taf' ? `the ${w.tafStation} TAF${w.tafMoment?.prevailing?.fcstChange ? ` (${w.tafMoment.prevailing.fcstChange} group)` : ''}` : w.wind.from === 'metar' ? `the latest ${w.metarStation} METAR` : 'no report')

function AirportWx({ ws, nas }: { ws: WxAt[]; nas: { kind: string; reason: string; detail: string }[] }) {
  const w = ws[0]
  const id = w.airport.icao || w.airport.id
  const datis = useDatis(id, w.airport.towered && w.at.getTime() - Date.now() < 3 * 3_600_000)
  const t = w.tafMoment
  return (
    <div className="rounded-lg p-4 ring-1 ring-inset ring-border">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="num text-lg font-medium">{id}</span><span className="text-sm text-fg-3">{ws.map(x => `${ROLE[x.role]} ${fmtTime(x.at)} (${fmtZ(x.at)})`).join(' · ')}</span>
        <span className="ml-auto flex items-center gap-1.5">{ws.some(x => x.night) && <Badge tone="warn">Night</Badge>}{[...new Set(ws.map(x => x.category))].map(c => <Cat key={c ?? 'none'} cat={c} />)}</span>
      </div>
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center">
      <WindCompass size={150} wdir={w.wind.dir ?? (w.wind.spd ? 'VRB' : null)} wspd={w.wind.spd} wgst={w.wind.gust}
        best={bestEnd(w)}
        runways={w.airport.runways.filter(r => r.ends.length === 2 && r.ends.every(e => e.trueHdg != null)).map(r => ({ le_ident: r.ends[0].id, le_hdg: r.ends[0].trueHdg!, he_ident: r.ends[1].id, he_hdg: r.ends[1].trueHdg!, length_ft: r.len, surface: r.surface ?? undefined }))} />
      <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Fact k="Wind" v={windText(w)} />
        <Fact k="Ceiling" v={w.ceiling ? `${w.ceiling.toLocaleString()} ft` : 'None'} />
        <Fact k="Visibility" v={w.visib != null ? `${w.visib} SM` : '—'} />
        <Fact k="Altimeter" v={w.altimInHg ? w.altimInHg.toFixed(2) : '—'} />
        <Fact k="Temp / dew" v={w.metar ? `${w.metar.temp != null ? Math.round(w.metar.temp) : '—'} / ${w.metar.dewp != null ? Math.round(w.metar.dewp) : '—'} °C` : '—'} />
        <Fact k="Spread" v={w.metar?.temp != null && w.metar.dewp != null ? `${(w.metar.temp - w.metar.dewp).toFixed(0)} °C` : '—'} warn={w.metar?.temp != null && w.metar.dewp != null && w.metar.temp - w.metar.dewp <= 3} />
        <Fact k="Pressure alt" v={`${w.pa.toLocaleString()} ft`} />
        <Fact k="Density alt" v={w.da != null ? `${w.da.toLocaleString()} ft` : '—'} />
      </div>
      </div>
      <div className="mt-1 text-xs text-fg-3">{ws.length > 1 ? `At the ${ROLE[w.role].toLowerCase()} ETA, ${fmtTime(w.at)}, from ${srcText(w)}` : w.wind.from === 'taf' ? `Conditions at the ETA from the ${w.tafStation} TAF` : w.wind.from === 'metar' ? `Latest observation (${w.metarStation}${w.metarStation !== id ? ', nearest station' : ''}) — ETA is within the hour or no TAF covers it` : 'No report'}</div>
      {ws.slice(1).map(x => {
        const diff = wxDiff(w, x)
        return (
          <div key={x.role} className="mt-3 rounded-md px-3 py-2 text-sm ring-1 ring-inset ring-border">
            <div className="text-fg">{ROLE[x.role]} ETA {fmtTime(x.at)} ({fmtZ(x.at)})</div>
            {diff.length ? (
              <ul className="mt-1 space-y-0.5">{diff.map(f => <li key={f.k} className="flex flex-wrap gap-x-2"><span className="w-24 text-fg-3">{f.k}</span><span className="num text-fg-3 line-through">{f.from}</span><span className="num text-fg">{f.to}</span></li>)}</ul>
            ) : <p className="mt-0.5 text-fg-3">Same as at {ROLE[w.role].toLowerCase()}: {srcText(x)} covers both times.</p>}
            {diff.length > 0 && <p className="mt-1 text-xs text-fg-3">From {srcText(x)}; everything else as above.</p>}
          </div>
        )
      })}
      {w.metar && (
        <div className="mt-3"><div className="mb-0.5 flex justify-between text-xs text-fg-3"><span>METAR {w.metar.icaoId}</span><span>{w.metarAgeMin} min ago</span></div>
          <code className="block break-words rounded-md bg-sunken px-3 py-2 font-mono text-[13px] text-fg-2">{w.metar.rawOb}</code></div>
      )}
      {w.taf && (
        <div className="mt-3"><div className="mb-0.5 flex justify-between text-xs text-fg-3"><span>TAF {w.taf.icaoId}{w.taf.icaoId !== id ? ` (${Math.round(distanceNm(w.airport, w.taf))} nm)` : ''}</span><span>Issued {fmtZ(new Date(w.taf.issueTime))}</span></div>
          <code className="block whitespace-pre-wrap break-words rounded-md bg-sunken px-3 py-2 font-mono text-[13px] text-fg-2">{w.taf.rawTAF.replace(/ (FM|BECMG|TEMPO|PROB)/g, '\n  $1')}</code>
          {t && (t.prevailing || t.temporary.length > 0) && <div className="mt-1 text-xs text-fg-3">In force at ETA: {[t.prevailing && `${t.prevailing.fcstChange ?? 'base'} group`, ...t.temporary.map(g => `${g.fcstChange}${g.probability ? ` ${g.probability}%` : ''}`)].filter(Boolean).join(' + ')}</div>}
        </div>
      )}
      {w.airport.towered && (
        <div className="mt-3">
          <div className="mb-0.5 flex justify-between text-xs text-fg-3"><span>D-ATIS</span>{datis.data?.data?.[0] && <span>{datis.data.data[0].time}Z</span>}</div>
          {datis.data?.data?.length ? datis.data.data.map((a, i) => <p key={i} className="rounded-md bg-sunken px-3 py-2 font-mono text-[13px] text-fg-2">{a.text}</p>)
            : <p className="text-sm text-fg-3">{datis.isLoading ? 'Loading…' : `No D-ATIS — listen on ${w.airport.frequencies.find(f => f.use === 'ATIS')?.freq ?? w.airport.wx?.freq ?? 'the ATIS/AWOS frequency'}${w.airport.wx?.phone ? ` or call ${w.airport.wx.phone}` : ''}.`}</p>}
        </div>
      )}
      {nas.map((n, i) => <div key={i} className="mt-3 flex gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn"><StatusIcon status="caution" className="mt-0.5" /><span><b>{n.kind}</b> — {n.reason} {n.detail}</span></div>)}
    </div>
  )
}
const bestEnd = (w: WxAt) => {
  const ends = w.airport.runways.flatMap(r => r.ends).filter(e => e.trueHdg != null)
  return ends.map(e => ({ id: e.id, h: windComponents(w.wind.dir, w.wind.spd, e.trueHdg!).head })).sort((a, b) => b.h - a.h)[0]?.id ?? null
}
const Fact = ({ k, v, warn }: { k: string; v: string; warn?: boolean }) => <div><div className="text-xs text-fg-3">{k}</div><div className={cn('num', warn && 'text-warn')}>{v}</div></div>

function Hazards({ d, weather }: { d: Derived; weather: WeatherBundle | null }) {
  const h = d.hazards
  const rows: { kind: string; tone: 'bad' | 'warn' | 'neutral'; title: string; body: string; when?: string }[] = [
    ...h.tfrs!.map(f => ({ kind: 'TFR', tone: 'bad' as const, title: `${f.properties.id} · ${f.properties.kind}`, body: f.properties.title })),
    ...h.sigmets.map(s => ({ kind: s.hazard === 'CONVECTIVE' ? 'Convective SIGMET' : `${s.airSigmetType} ${s.hazard}`, tone: (s.hazard === 'CONVECTIVE' ? 'bad' : 'warn') as 'bad' | 'warn', title: s.rawAirSigmet?.split('\n')[2] ?? s.hazard, body: s.rawAirSigmet?.split('\n').slice(3).join(' ') ?? '', when: s.validTimeTo ? `until ${fmtZ(new Date(s.validTimeTo * 1000))}` : undefined })),
    ...h.gairmets.filter(g => !/FZLVL/.test(g.hazard)).map(g => ({ kind: `G-AIRMET ${g.product}`, tone: 'warn' as const, title: g.hazard.replace('_', ' '), body: [g.due_to, g.base || g.top ? `${g.base ?? 'SFC'} to ${g.top ?? '—'}` : ''].filter(Boolean).join(' · '), when: g.validTime ? `valid ${fmtZ(new Date(g.validTime))}` : undefined })),
    ...h.cwas.map(c => ({ kind: 'CWA', tone: 'warn' as const, title: c.cwsu ?? 'Center Weather Advisory', body: c.cwaText ?? c.text ?? '' })),
  ]
  const dedup = rows.filter((r, i) => rows.findIndex(x => x.kind === r.kind && x.title === r.title) === i)
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div>
        <SubHead right={<Synced at={weather?.sigmets.fetchedAt} source="10 nm corridor" />}>Advisories and restrictions on the route</SubHead>
        {dedup.length ? (
          <ul className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
            {dedup.map((r, i) => <li key={i} className="px-3 py-2.5"><div className="flex flex-wrap items-baseline gap-2"><Badge tone={r.tone}>{r.kind}</Badge><span className="text-sm text-fg">{r.title}</span>{r.when && <span className="ml-auto text-xs text-fg-3">{r.when}</span>}</div>{r.body && <p className="mt-1 text-sm text-fg-3">{r.body}</p>}</li>)}
          </ul>
        ) : <p className="text-sm text-fg-3">No SIGMETs, G-AIRMETs, CWAs or TFRs touch the route for these times.</p>}
        <p className="mt-2 text-sm text-fg-3">{weather?.nas.data ? (weather.nas.data.items.length ? `ATC: ${weather.nas.data.items.length} program(s) at route airports — see the airport cards.` : `ATC: no delays, ground stops or closures at route airports (FAA NAS status, ${weather.nas.data.total} nationwide, updated ${weather.nas.data.updated}).`) : 'ATC delay status unavailable.'}</p>
      </div>
      <div>
        <SubHead right={<Synced at={weather?.pireps.fetchedAt} source="last 3 h, 30 nm of the route" />}>Pilot reports</SubHead>
        {h.pireps.length ? (
          <ul className="max-h-80 divide-y divide-border overflow-auto rounded-lg ring-1 ring-inset ring-border">
            {h.pireps.map((p, i) => <li key={i} className="px-3 py-2"><div className="flex items-baseline gap-2 text-xs text-fg-3"><Badge tone={p.pirepType === 'Urgent PIREP' ? 'bad' : 'neutral'}>{p.pirepType}</Badge>{p.acType}<span className="ml-auto">{fmtZ(new Date(p.obsTime * 1000))}</span></div><code className="mt-1 block break-words font-mono text-[13px] text-fg-2">{p.rawOb}</code></li>)}
          </ul>
        ) : <p className="text-sm text-fg-3">No PIREPs near the route in the last 3 hours.</p>}
      </div>
    </div>
  )
}

function WindsTable({ d, weather }: { d: Derived; weather: WeatherBundle | null }) {
  const prod = d.fb?.product
  const stations = useMemo(() => {
    if (!prod || !d.samples.length) return []
    return Object.entries(prod.stations).map(([id, s]) => ({ id, ...s, dist: Math.min(...d.samples.map(p => distanceNm(p, s))) })).sort((a, b) => a.dist - b.dist).slice(0, 4)
  }, [prod, d.samples])
  if (!prod) return null
  const levels = prod.levels.filter(l => l <= 18000)
  return (
    <div>
      <SubHead right={<Synced at={weather?.winds.find(w => w.fcst === d.fb?.fcst)?.fetchedAt} source={prod.source ? `${prod.source} · for use ${prod.forUse.join('–')}Z` : `FB ${d.fb!.fcst}-hr · based ${prod.basedOn}Z · for use ${prod.forUse.join('–')}Z`} />}>Winds and temperatures aloft</SubHead>
      <div className="overflow-x-auto">
        <table className="w-full text-sm sm:min-w-[36rem]">
          <thead><tr className="text-left text-xs text-fg-3"><th className="pb-1.5 font-medium">Station</th>{levels.map(l => <th key={l} className="pb-1.5 text-right font-medium">{l.toLocaleString()}</th>)}</tr></thead>
          <tbody className="num">{stations.map(s => (
            <tr key={s.id} className="border-t border-border"><td className="py-1.5 font-sans"><span className="num font-medium">{/^M\d+$/.test(s.id) ? `${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}` : s.id}</span> <span className="block text-xs text-fg-3 sm:inline">{Math.round(s.dist)} nm off route</span></td>
              {levels.map(l => { const w = s.winds[l]; return <td key={l} className="pl-2 text-right">{w ? `${w.dir == null ? 'L&V' : deg3(w.dir)}/${w.spd}` : '—'}{w?.temp != null && <span className="block text-fg-3 sm:inline"> {w.temp > 0 ? '+' : ''}{w.temp}</span>}</td> })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {d.freezing && <p className="mt-1 text-sm text-fg-3">Freezing level near {d.legs[0]?.from.icao ?? 'departure'}: about <span className="num text-fg">{d.freezing.altFt.toLocaleString()} ft MSL</span>{d.freezing.approx ? ' (extrapolated below the lowest level)' : ''}.</p>}
    </div>
  )
}

function NotamsBlock({ ids }: { ids: string[] }) {
  const [tab, setTab] = useState(ids[0])
  const active = ids.includes(tab) ? tab : ids[0]
  return (
    <div>
      <SubHead right={<div className="flex flex-wrap gap-1">{ids.map(i => <button key={i} onClick={() => setTab(i)} className={cn('num h-7 rounded-full px-2.5 text-xs', i === active ? 'bg-pill text-fg' : 'text-fg-3 hover:text-fg')}>{i}</button>)}</div>}>NOTAMs</SubHead>
      {active && <NotamList icao={active} />}
    </div>
  )
}

function NotamList({ icao }: { icao: string }) {
  const { data, isLoading, dataUpdatedAt } = useNotams(icao)
  const list = data?.notams || []
  const important = (t: string) => /CLSD|CLOSED|U\/S|UNSERVICEABLE|OTS|TFR|RWY|AD AP/.test(t.toUpperCase())
  if (isLoading) return <div className="space-y-2">{[0, 1].map(i => <Skeleton key={i} className="h-12" />)}</div>
  if (data?.unavailable) return <p className="text-sm text-fg-3">FAA NOTAM search didn't respond. <a className="text-accent hover:underline" href="https://notams.aim.faa.gov/notamSearch/nsapp.html" target="_blank" rel="noopener noreferrer">Search {icao} on the FAA site</a>.</p>
  return (
    <>
      <Synced at={dataUpdatedAt || undefined} source={`FAA NOTAM Search · ${data?.count ?? 0} active`} className="mb-2" />
      {!list.length ? <p className="text-sm text-fg-3">No active NOTAMs.</p> : (
        <ul className="max-h-[28rem] divide-y divide-border overflow-auto rounded-lg ring-1 ring-inset ring-border">
          {[...list].sort((a, b) => Number(important(b.text || '')) - Number(important(a.text || ''))).map((n, i) => {
            const body = notamExpand(notamBody(n.text)), kind = NOTAM_KIND[(n.type || '').toUpperCase()]
            return (
              <li key={i} className="px-3 py-2.5">
                <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-3">{important(n.text || '') && <StatusIcon status="caution" className="size-3.5" />}<Badge>{kind?.label || n.type || 'NOTAM'}</Badge>{n.id && <span className="num">{n.id}</span>}{n.endDate && <span className="ml-auto">until {notamDate(n.endDate)}</span>}</div>
                <p className="text-sm text-fg-2">{body}</p>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

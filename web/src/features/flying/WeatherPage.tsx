import { useMemo, useState } from 'react'
import { AlertTriangle, CloudSun, ExternalLink, Radio, Search, Wind } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/misc'
import { PageHeader, DL } from '@/components/data/stat'
import { useNotams, useTaf } from '@/lib/queries'
import { FREQ_ORDER, homeAirport, NOTAM_KIND, notamBody, notamDate, notamExpand, setHomeAirport, windText } from '@/lib/weather'
import { cn } from '@/lib/utils'
import type { Runway } from '@/lib/types'
import { CategoryBadge, useAirportBrief, VerdictBadge } from './brief'
import { WindCompass } from './WindCompass'

export default function WeatherPage() {
  const [icao, setIcao] = useState(homeAirport)
  const [draft, setDraft] = useState(icao)
  const { brief: b, metar, info, detail, isLoading } = useAirportBrief(icao)
  const change = (e: React.FormEvent) => {
    e.preventDefault()
    const v = draft.trim().toUpperCase()
    if (/^[A-Z0-9]{3,4}$/.test(v)) { setHomeAirport(v); setIcao(v) }
  }
  const meta = [info?.city && [info.city, info.state].filter(Boolean).join(', '), info?.elev != null && `${info.elev.toLocaleString()} ft MSL`].filter(Boolean).join(' · ')

  return (
    <div>
      <PageHeader
        title={<span><span className="num">{icao}</span>{info?.name && <span className="font-normal text-fg-3"> · {info.name}</span>}</span>}
        description={meta || 'Airport brief'}
        actions={<>
          <form onSubmit={change} className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <Input value={draft} onChange={e => setDraft(e.target.value.toUpperCase())} maxLength={4} className="num w-40 pl-8 uppercase" aria-label="Airport ICAO" placeholder="ICAO" />
          </form>
          {[['AirNav', `https://www.airnav.com/airport/${icao}`], ['SkyVector', `https://skyvector.com/airport/${icao}`], ['TFRs', 'https://tfr.faa.gov/tfr2/list.jsp']].map(([l, h]) => (
            <Button key={l} asChild variant="ghost" size="sm"><a href={h} target="_blank" rel="noopener noreferrer">{l}<ExternalLink /></a></Button>
          ))}
        </>}
      />

      {isLoading ? <div className="grid gap-5 xl:grid-cols-12"><Skeleton className="h-80 xl:col-span-5" /><Skeleton className="h-80 xl:col-span-7" /></div> : !b || !metar ? (
        <Card><EmptyState icon={CloudSun} title={`No current METAR for ${icao}`}>The station may not report weather, or aviationweather.gov didn’t respond.</EmptyState></Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-12">
          <Card className="xl:col-span-5">
            <CardHeader icon={<Wind />} title="Wind and runways" action={<div className="flex gap-1.5"><VerdictBadge verdict={b.verdict} /><CategoryBadge cat={b.cat} /></div>} />
            <CardBody className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
              <WindCompass wdir={b.wdir} wspd={b.wspd} wgst={b.wgst} runways={detail?.runways || []} best={b.best?.ident} size={210} />
              <div className="w-full space-y-3">
                <div><div className="text-sm text-fg-3">Wind</div><div className="text-lg font-semibold">{windText(b)}</div></div>
                {b.best && <div><div className="text-sm text-fg-3">Favoured runway</div><div className="text-lg font-semibold"><span className="num">{b.best.ident}</span></div><div className="text-sm text-fg-2">{b.best.crosswind} kt crosswind · {Math.abs(b.best.headwind)} kt {b.best.headwind >= 0 ? 'headwind' : 'tailwind'}</div></div>}
                {b.reasons.length > 0 && <div className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{b.reasons.join(' · ')}</div>}
              </div>
            </CardBody>
          </Card>

          <Card className="xl:col-span-7">
            <CardHeader icon={<CloudSun />} title="Current conditions" description={b.observed ? `Observed ${b.observed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${Math.max(0, Math.round((Date.now() - +b.observed) / 60000))} min ago` : undefined} />
            <CardBody>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
                <Cond label="Ceiling" value={metar.ceil ? `${metar.ceil.toLocaleString()} ft` : b.cat === 'VFR' ? 'Unlimited' : '—'} sub={metar.ceil ? 'AGL' : 'Clear or scattered'} />
                <Cond label="Visibility" value={metar.visib != null ? `${String(metar.visib) === '10+' ? '10+' : metar.visib} SM` : '—'} />
                <Cond label="Temperature" value={metar.temp != null ? `${metar.temp}°C` : '—'} sub={metar.dewp != null ? `Dew point ${metar.dewp}°C` : undefined} />
                <Cond label="Spread" value={b.spread != null ? `${b.spread}°C` : '—'} sub={b.spread != null && b.spread <= 3 ? 'Fog or low cloud risk' : undefined} warn={b.spread != null && b.spread <= 3} />
                <Cond label="Altimeter" value={b.altimInHg ? `${b.altimInHg.toFixed(2)} inHg` : '—'} sub={metar.altim ? `${Math.round(metar.altim)} hPa` : undefined} />
                <Cond label="Density altitude" value={b.densityAltitude != null ? `${b.densityAltitude.toLocaleString()} ft` : '—'} sub={b.densityAltitude != null && info?.elev != null ? `${b.densityAltitude - info.elev >= 0 ? '+' : ''}${(b.densityAltitude - info.elev).toLocaleString()} ft vs field` : undefined} />
              </div>
              {(metar.rawOb || metar.raw) && <code className="mt-5 block break-words rounded-md bg-sunken px-3 py-2.5 font-mono text-sm text-fg-2 ring-1 ring-inset ring-border">{metar.rawOb || metar.raw}</code>}
            </CardBody>
          </Card>

          <RunwaysCard runways={detail?.runways || []} wdir={b.wdir} wspd={b.wspd} best={b.best?.ident} freqs={detail?.frequencies || []} className="xl:col-span-5" />
          <TafCard icao={icao} className="xl:col-span-7" />
          <NotamCard icao={icao} className="xl:col-span-12" />
        </div>
      )}
    </div>
  )
}

function Cond({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return <div><div className="text-sm text-fg-3">{label}</div><div className={cn('num mt-0.5 text-xl font-semibold', warn && 'text-warn')}>{value}</div>{sub && <div className={cn('text-sm', warn ? 'text-warn' : 'text-fg-3')}>{sub}</div>}</div>
}

function RunwaysCard({ runways, wdir, wspd, best, freqs, className }: { runways: Runway[]; wdir: number | 'VRB' | null; wspd: number; best?: string | null; freqs: { type: string; freq_mhz: string }[]; className?: string }) {
  const ends = runways.flatMap(r => [[r.le_ident, r.le_hdg, r], [r.he_ident, r.he_hdg, r]] as const).map(([ident, hdg, r]) => {
    let hw: number | null = null, xw: number | null = null
    if (typeof wdir === 'number' && wspd && hdg) { const rad = ((((wdir - hdg) % 360) + 360) % 360) * Math.PI / 180; hw = Math.round(wspd * Math.cos(rad)); xw = Math.round(wspd * Math.sin(rad)) }
    return { ident, hdg, r, hw, xw }
  })
  const shown = FREQ_ORDER.flatMap(t => freqs.filter(f => f.type === t)).slice(0, 8)
  return (
    <Card className={className}>
      <CardHeader title="Runways" description={typeof wdir === 'number' && wspd ? 'Wind components for each runway end' : undefined} />
      <CardBody>
        {!ends.length ? <p className="text-sm text-fg-3">No runway data.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-fg-3"><th className="pb-2 font-medium">Runway</th><th className="pb-2 font-medium">Length</th><th className="pb-2 text-right font-medium">Head / tail</th><th className="pb-2 text-right font-medium">Cross</th></tr></thead>
            <tbody>{ends.map(e => (
              <tr key={e.ident} className={cn('border-t border-border', e.ident === best && 'bg-accent-soft')}>
                <td className="py-2 pl-1"><span className="num font-semibold">{e.ident}</span>{e.ident === best && <Badge tone="accent" className="ml-2">Favoured</Badge>}</td>
                <td className="num text-fg-2">{e.r.length_ft ? `${e.r.length_ft.toLocaleString()} ft` : '—'}<span className="text-fg-3"> {e.r.surface?.split('-')[0]}</span></td>
                <td className={cn('num text-right', e.hw != null && e.hw < 0 ? 'text-bad' : 'text-fg-2')}>{e.hw == null ? '—' : e.hw >= 0 ? `${e.hw} head` : `${-e.hw} tail`}</td>
                <td className={cn('num pr-1 text-right', e.xw != null && Math.abs(e.xw) > 10 ? 'text-warn' : 'text-fg-2')}>{e.xw == null ? '—' : `${Math.abs(e.xw)} ${e.xw > 0 ? 'R' : e.xw < 0 ? 'L' : ''}`}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {shown.length > 0 && <>
          <div className="mb-1 mt-5 flex items-center gap-1.5 text-sm font-medium text-fg-2"><Radio className="size-4 text-fg-3" />Frequencies</div>
          <DL cols={2} items={shown.map(f => [f.type, <span className="num">{f.freq_mhz}</span>])} />
        </>}
      </CardBody>
    </Card>
  )
}

function TafCard({ icao, className }: { icao: string; className?: string }) {
  const { data: taf, isLoading } = useTaf(icao)
  const t = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '')
  return (
    <Card className={className}>
      <CardHeader title="Forecast" description="Terminal aerodrome forecast (TAF)" />
      <CardBody>
        {isLoading ? <Skeleton className="h-40" /> : !taf ? <p className="text-sm text-fg-3">No TAF issued for {icao}. Check a nearby airport.</p> : taf.fcsts?.length ? (
          <ol className="relative space-y-3 border-l border-border pl-5">
            {taf.fcsts.map((f, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-card bg-border-strong" />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="num font-medium">{t(f.from)}{f.to ? ` – ${t(f.to)}` : ''}</span>
                  <Badge>{f.type || 'FM'}</Badge>
                  {f.fltcat && <CategoryBadge cat={f.fltcat} />}
                </div>
                <div className="mt-0.5 text-sm text-fg-2">
                  {[f.wdir != null && f.wspd != null ? `Wind ${typeof f.wdir === 'number' ? String(f.wdir).padStart(3, '0') + '°' : f.wdir} ${f.wspd} kt${f.wgst ? ` gusting ${f.wgst}` : ''}` : null, f.visib ? `Visibility ${f.visib} SM` : null, f.clouds, f.wx].filter(Boolean).join(' · ') || '—'}
                </div>
              </li>
            ))}
          </ol>
        ) : <code className="block break-words font-mono text-sm text-fg-2">{taf.raw}</code>}
      </CardBody>
    </Card>
  )
}

function NotamCard({ icao, className }: { icao: string; className?: string }) {
  const { data, isLoading } = useNotams(icao)
  const [kind, setKind] = useState('all')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const notams = useMemo(() => data?.notams || [], [data])
  const kinds = useMemo(() => [...new Set(notams.map(n => (n.type || '').toUpperCase()))].filter(Boolean), [notams])
  const list = notams.filter(n => kind === 'all' || (n.type || '').toUpperCase() === kind)
  const tone = (t?: string) => { const k = NOTAM_KIND[(t || '').toUpperCase()]?.tone || 'neutral'; return k === 'info' ? 'accent' : k }
  return (
    <Card className={className}>
      <CardHeader icon={<AlertTriangle />} title="NOTAMs" description={isLoading ? 'Fetching from the FAA — the first load can take up to a minute' : data?.unavailable ? 'Unavailable right now' : `${data?.count ?? 0} active${(data?.count || 0) > notams.length ? `, showing ${notams.length}` : ''}`}
        action={kinds.length > 1 && <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, ...kinds.map(k => ({ value: k, label: NOTAM_KIND[k]?.label || k }))]} />} />
      <CardBody>
        {isLoading ? <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16" />)}</div> : data?.unavailable ? (
          <p className="text-sm text-fg-3">The FAA NOTAM search didn’t respond. <a className="text-accent hover:underline" href="https://notams.aim.faa.gov/notamSearch/nsapp.html" target="_blank" rel="noopener noreferrer">Search {icao} on the FAA site</a>.</p>
        ) : !list.length ? <p className="text-sm text-fg-3">No active NOTAMs.</p> : (
          <ul className="divide-y divide-border">
            {list.map((n, i) => {
              const body = notamExpand(notamBody(n.text))
              const exp = notamDate(n.endDate)
              const isOpen = open.has(i)
              return (
                <li key={i} className="py-3 first:pt-0 last:pb-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={tone(n.type) as 'accent' | 'bad' | 'warn' | 'neutral'}>{NOTAM_KIND[(n.type || '').toUpperCase()]?.label || n.type || 'NOTAM'}</Badge>
                    {n.id && <span className="num text-xs text-fg-3">{n.id}</span>}
                    {exp && <span className="ml-auto text-xs text-fg-3">Expires {exp}</span>}
                  </div>
                  <p className={cn('text-sm leading-relaxed text-fg-2', !isOpen && 'line-clamp-2')}>{body}</p>
                  {body.length > 180 && <button onClick={() => setOpen(s => { const x = new Set(s); if (x.has(i)) x.delete(i); else x.add(i); return x })} className="mt-1 text-sm text-accent hover:underline">{isOpen ? 'Show less' : 'Show more'}</button>}
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

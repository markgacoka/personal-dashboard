import { cn } from '@/lib/utils'
import type { Derived } from './model'
import type { AircraftProfile } from './poh'
import { SubHead, fmtTime } from './ui'

export function PerformanceSection({ d, profile }: { d: Derived; profile: AircraftProfile | null }) {
  if (!profile) return <p className="text-sm text-fg-3">Choose the aircraft first.</p>
  if (!d.perf.length) return <p className="text-sm text-fg-3">Add a route and departure time to compute takeoff and landing distances.</p>
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-fg-3">
              <th className="pb-2 font-medium">Airport</th><th className="pb-2 font-medium">Runway</th><th className="pb-2 font-medium">Wind (head / cross)</th>
              <th className="pb-2 pr-4 text-right font-medium">PA / temp / DA</th><th className="pb-2 text-right font-medium">Weight</th>
              <th className="pb-2 text-right font-medium">Ground roll</th><th className="pb-2 text-right font-medium">Over 50 ft</th><th className="pb-2 text-right font-medium">+50 % (ASI)</th>
              <th className="pb-2 text-right font-medium">Available</th><th className="w-40 pb-2 font-medium" />
            </tr>
          </thead>
          <tbody className="num">
            {d.perf.map((p, i) => {
              const r = p.runway, avail = r ? (p.kind === 'takeoff' ? r.toraFt : r.ldaFt) : null
              const over = p.dist && avail != null ? p.dist.total / avail : null
              const tone = !p.dist || (avail != null && p.dist.ground > avail) ? 'bad' : over! > 1 || (p.asi && avail != null && p.asi > avail) ? 'warn' : 'good'
              return (
                <tr key={i} className="border-t border-border align-top">
                  <td className="py-2.5 font-sans"><span className="num font-medium text-fg">{p.airport.icao || p.airport.id}</span> <span className="text-fg-3">{p.kind} · {fmtTime(p.wx.at)}</span></td>
                  <td className="py-2.5">{r ? <>{r.end.id} <span className="text-fg-3">{Math.round(r.magHdg)}°M</span></> : '—'}</td>
                  <td className="py-2.5">{r ? <><span className={r.head < 0 ? 'text-bad' : ''}>{r.head >= 0 ? r.head : `${-r.head} tail`}</span> / {Math.abs(r.cross)}{r.cross ? (r.cross > 0 ? 'R' : 'L') : ''} kt</> : '—'}<div className="font-sans text-xs text-fg-3">{p.wx.wind.from ? `${p.wx.wind.from.toUpperCase()} ${p.wx.wind.dir ?? 'VRB'}°/${p.wx.wind.spd}${p.wx.wind.gust ? `G${p.wx.wind.gust}` : ''}` : 'no wind data'}</div></td>
                  <td className="py-2.5 pr-4 text-right">{p.wx.pa.toLocaleString()} / {p.wx.tempC != null ? Math.round(p.wx.tempC) : '—'}° / {p.wx.da?.toLocaleString() ?? '—'}</td>
                  <td className="py-2.5 text-right">{Math.round(p.weight)}</td>
                  <td className="py-2.5 text-right">{p.dist?.ground ?? '—'}</td>
                  <td className="py-2.5 text-right">{p.dist?.total ?? 'off chart'}</td>
                  <td className="py-2.5 text-right text-fg-3">{p.asi ?? '—'}</td>
                  <td className="py-2.5 text-right">{avail ?? '—'}</td>
                  <td className="py-2.5 pl-3">{avail && p.dist ? <Bar parts={[p.dist.ground, p.dist.total, p.asi!]} max={Math.max(avail, p.asi!)} avail={avail} tone={tone} /> : null}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 text-sm text-fg-3 lg:grid-cols-2">
        <div>
          <SubHead>How these are computed</SubHead>
          <p>{profile.figures.takeoff} and {profile.figures.landing}, interpolated for pressure altitude (field elevation corrected by the altimeter setting) and temperature from the latest METAR, and for weight across the 2,400/2,200/2,000 lb takeoff sheets. Weight at each stop subtracts the navlog's fuel burn. POH corrections: −10 % per 9 kt headwind, +10 % per 2 kt tailwind, and for grass +15 % (takeoff) / +45 % (landing) of the ground roll. Runways use the gust value. Landing uses the distance past any displaced threshold.</p>
        </div>
        <div>
          <SubHead>Speeds at these weights</SubHead>
          <p>Short-field takeoff: lift off {profile.takeoff.map(t => `${t.speeds.liftoff} KIAS at ${t.weight} lb`).join(', ')}; at 50 ft {profile.takeoff.map(t => `${t.speeds.at50}`).join(' / ')} KIAS. Short-field approach {profile.vspeeds.shortApproach} KIAS (flaps 30°). Normal approach {profile.vspeeds.approach} KIAS. Above 3,000 ft density altitude, lean for maximum RPM before takeoff.</p>
        </div>
      </div>
    </>
  )
}

function Bar({ parts, max, avail, tone }: { parts: [number, number, number]; max: number; avail: number; tone: 'good' | 'warn' | 'bad' }) {
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : 'var(--bad)'
  return (
    <div className="relative mt-1.5 h-3 w-full rounded-full bg-sunken" aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full opacity-30" style={{ width: pct(parts[2]), background: color }} />
      <div className="absolute inset-y-0 left-0 rounded-full opacity-60" style={{ width: pct(parts[1]), background: color }} />
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(parts[0]), background: color }} />
      <div className={cn('absolute -inset-y-1 w-0.5 bg-fg')} style={{ left: pct(avail) }} />
    </div>
  )
}

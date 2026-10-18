import { cn } from '@/lib/utils'
import type { Airport } from './airports'
import { findEnd, fmtHdg, legPoint, runwayEnds, type Pt, type Wind } from './geo'
import { fitBox, useSize } from './Scene'
import { MAP, PatternOverlay, RunwayPickLayer, Runways, SockGlyph, type RunwayPick } from './art'

// Close-up of the airport: real runway layout and markings, the pattern for the
// runway in use, the segmented circle with its windsock, and the reported wind.
export function FieldView({ ap, pattern, wind, sock, closed = [], pick, compact, className }: {
  ap: Airport; pattern?: string; wind: Wind; sock?: Wind; closed?: string[]; pick?: RunwayPick; compact?: boolean; className?: string
}) {
  const [ref, size] = useSize<HTMLDivElement>()
  const ends = ap.runways.flatMap(runwayEnds)
  const pts: Pt[] = ends.flatMap(e => [e.threshold, e.departureEnd])
  const end = pattern ? findEnd(ap.runways, pattern) : null
  if (end) pts.push(...(['mid', 'base', 'baseMid', 'final', 'downwindStart', 'upwind', 'crosswind'] as const).map(l => legPoint(end, l)))
  const box = fitBox(pts, size.w / size.h, 0.14, compact ? 0.25 : 0.35)
  const px = box.w / size.w
  // The sock stands at the segmented circle, or beside the longest runway when there isn't one.
  const longest = ap.runways.slice().sort((a, b) => b.lengthFt - a.lengthFt)[0]
  const sockAt: Pt = ap.circle ?? (longest ? [longest.center[0] + Math.cos((longest.hdg * Math.PI) / 180) * 0.3, longest.center[1] - Math.sin((longest.hdg * Math.PI) / 180) * 0.3] : [0.2, 0.2])
  const s = sock ?? wind
  const R = Math.min(box.w, box.h) * 0.5 - 16 * px
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  return (
    <div ref={ref} className={cn('relative overflow-hidden', className)} style={{ background: `radial-gradient(100% 100% at 50% 50%, ${MAP.land2} 0%, ${MAP.land} 80%)` }}>
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="absolute inset-0 size-full select-none" role="img" aria-label={`${ap.icao} runway diagram`}>
        {end && <PatternOverlay ap={ap} e={end} px={px} labels={!compact} tpa={compact ? undefined : ap.tpa} />}
        <Runways ap={ap} px={px} active={pattern} closed={closed} minWidth={compact ? 6 : 9} labels={pick ? 'none' : compact ? 'outside' : 'painted'} />
        {!compact && (
          <g transform={`translate(${sockAt[0]} ${-sockAt[1]}) scale(${px})`}>
            {ap.circle && <circle r={13} fill="none" stroke="#e6e6e6" strokeOpacity={0.55} strokeWidth={1.6} />}
            <SockGlyph sock={s} size={0.75} />
          </g>
        )}
        {wind.spd > 0 && (
          <g transform={`translate(${cx} ${cy}) rotate(${wind.dir})`}>
            <line x1={0} y1={-R} x2={0} y2={-R + 26 * px} stroke="#fff" strokeWidth={2.4 * px} strokeLinecap="round" />
            <path d={`M0,${-R + 34 * px} L${-6 * px},${-R + 22 * px} L${6 * px},${-R + 22 * px} Z`} fill="#fff" />
          </g>
        )}
        {pick && <RunwayPickLayer ap={ap} px={px} pick={pick} />}
      </svg>
      {compact && <div className="num pointer-events-none absolute bottom-2.5 left-2.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-fg-2 backdrop-blur">{wind.spd ? `Wind ${fmtHdg(wind.dir)}° ${wind.spd}${wind.gust ? `G${wind.gust}` : ''} kt` : 'Wind calm'}{pattern ? ` · ${pattern} favoured` : ''}</div>}
      {!compact && <div className="pointer-events-none absolute inset-x-3 top-2 flex justify-between gap-2 text-xs font-medium text-fg-3"><span>Field view</span><span className="num">Windsock {s.spd < 3 ? 'limp' : `~${fmtHdg(Math.round(s.dir / 10) * 10)}° · ${s.spd >= 15 ? 'full' : `${Math.round(Math.min(1, s.spd / 15) * 100)}%`}`}</span></div>}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
// maplibre-gl looks for its worker next to its own module, which bundling moves; hand it the bundled worker.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { usePrefs } from '@/lib/prefs'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/misc'

maplibregl.setWorkerUrl(workerUrl)

export const BASEMAP = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
}

// A MapLibre map that follows the theme: the base style is chosen at creation,
// so a theme change rebuilds the map and `onLoad` re-adds the overlays.
export function MapView({ className, onLoad, center, zoom = 9, controls = true, fullscreen = false }: {
  className?: string
  onLoad: (map: maplibregl.Map) => void | (() => void)
  center?: [number, number]
  zoom?: number
  controls?: boolean
  fullscreen?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { resolved } = usePrefs()
  const [ready, setReady] = useState(false)
  const loadRef = useRef(onLoad)
  loadRef.current = onLoad

  useEffect(() => {
    if (!ref.current) return
    setReady(false)
    const map = new maplibregl.Map({
      container: ref.current, style: BASEMAP[resolved], center: center || [-121.8, 37.3], zoom,
      attributionControl: false, cooperativeGestures: false, fadeDuration: 0,
    })
    if (controls) map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right')
    if (fullscreen) map.addControl(new maplibregl.FullscreenControl(), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    let cleanup: void | (() => void)
    map.on('load', () => { setReady(true); cleanup = loadRef.current(map) })
    return () => { try { cleanup?.() } catch { /* */ } map.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved])

  return (
    <div className={cn('relative overflow-hidden', className)}>
      <div ref={ref} className="absolute inset-0" />
      {!ready && <Skeleton className="absolute inset-0 rounded-none" />}
    </div>
  )
}

// MapLibre only understands sRGB colour syntax; theme tokens are OKLCH (served as lab()).
// Paint one pixel with the token and read it back as rgb().
let ctx2d: CanvasRenderingContext2D | null = null
export function mapColor(token: string) {
  const value = token.startsWith('--') ? getComputedStyle(document.documentElement).getPropertyValue(token).trim() : token
  ctx2d ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
  if (!ctx2d) return '#3366cc'
  ctx2d.clearRect(0, 0, 1, 1)
  ctx2d.fillStyle = '#000'
  ctx2d.fillStyle = value
  ctx2d.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx2d.getImageData(0, 0, 1, 1).data
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
}

export function fitTo(map: maplibregl.Map, coords: [number, number][], padding = 56, maxZoom = 14) {
  if (!coords.length) return
  const b = coords.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
  map.fitBounds(b, { padding, maxZoom, duration: 0 })
}

export { maplibregl }

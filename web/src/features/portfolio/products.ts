import { Battery, Clock, Cloud, HeartPulse, Sunrise, Target, type LucideIcon } from 'lucide-react'
import meridianIcon from './assets/meridian-icon.png'
import meridianFr970 from './assets/meridian-fr970.png'
import meridianFenix7 from './assets/meridian-fenix7.png'
import meridianVenu3 from './assets/meridian-venu3.png'
import meridianFr265s from './assets/meridian-fr265s.png'
import meridianEpix from './assets/meridian-epix2pro51mm.png'

// Products I've built. One entry per product; the page lays out however many
// there are. Metrics are a list, so a product shows whichever ones it has:
// a value of null reads "Not tracked yet", and a series draws a sparkline.
// When a metric comes from a live source later (store stats, an API), put the
// source in `source` and merge the fetched value in by `key` (usePortfolio).

export type ProductStatus = 'building' | 'in-review' | 'live' | 'retired'
export type MetricFormat = 'int' | 'usd' | 'rating' | 'percent'

export interface ProductMetric {
  key: string // stable id, e.g. 'downloads', 'users', 'revenue'
  label: string
  value: number | null
  format?: MetricFormat
  series?: number[] // oldest first, for the trend line
  source?: string // where the number comes from
  asOf?: string // ISO date the value was read
}

export interface Product {
  id: string // the ?p= value
  name: string
  kind: string // e.g. 'Garmin Watch Face'
  status: ProductStatus
  summary: string
  icon: string
  // Round device screenshots (watch faces) or flat screens (apps).
  gallery: { src: string; label: string }[]
  shape?: 'round' | 'rect'
  links: { label: string; href: string }[]
  features: { icon: LucideIcon; title: string; text: string }[]
  facts: [string, string][]
  metrics: ProductMetric[]
  released?: string // ISO date
}

export const STATUS: Record<ProductStatus, { label: string; tone: 'good' | 'warn' | 'neutral' | 'accent' }> = {
  building: { label: 'Building', tone: 'accent' },
  'in-review': { label: 'In review at Garmin', tone: 'warn' },
  live: { label: 'Live', tone: 'good' },
  retired: { label: 'Retired', tone: 'neutral' },
}

export const PRODUCTS: Product[] = [
  {
    id: 'meridian',
    name: 'Meridian',
    kind: 'Garmin Watch Face',
    status: 'in-review',
    summary: 'A black watch face with the time in large digits, plus the weather, wind, heart rate, steps and Body Battery.',
    icon: meridianIcon,
    shape: 'round',
    gallery: [
      { src: meridianFr970, label: 'Forerunner 970' },
      { src: meridianFenix7, label: 'fēnix 7' },
      { src: meridianVenu3, label: 'Venu 3' },
      { src: meridianFr265s, label: 'Forerunner 265S' },
      { src: meridianEpix, label: 'epix Pro 51 mm' },
    ],
    links: [{ label: 'Connect IQ Store', href: 'https://apps.garmin.com/apps/a7caecac-a61d-4d86-92e1-f256d694beaa' }],
    features: [
      { icon: Clock, title: 'Time and date', text: 'Large digits in your 12- or 24-hour setting; day and date along the bezel.' },
      { icon: Cloud, title: 'Weather and wind', text: 'Conditions, temperature, wind direction and speed in knots, mph or km/h.' },
      { icon: HeartPulse, title: 'Heart rate and steps', text: 'A dot that moves from red to green as your heart rate settles and your steps near your goal.' },
      { icon: Target, title: 'Two rings', text: 'Body Battery on the left, progress toward your step goal on the right.' },
      { icon: Sunrise, title: 'Sun and recovery', text: 'Next sunrise or sunset, and recovery time after a workout.' },
      { icon: Battery, title: 'Always-on', text: 'On AMOLED watches the face dims and shifts each minute to protect the screen.' },
    ],
    facts: [['Price', 'Free'], ['Watches', '69 models'], ['Version', '1.0.0'], ['Size', '28 KB'], ['Wind units', 'kt, mph or km/h']],
    metrics: [
      { key: 'downloads', label: 'Downloads', value: 0, format: 'int', source: 'Connect IQ Store', asOf: '2026-11-25' },
      { key: 'users', label: 'Active users', value: null, format: 'int' },
      { key: 'rating', label: 'Rating', value: null, format: 'rating', source: 'Connect IQ Store' },
      { key: 'revenue', label: 'Revenue', value: 0, format: 'usd', source: 'Free' },
    ],
    released: '2026-11-25',
  },
]

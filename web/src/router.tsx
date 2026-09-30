import { createBrowserRouter, Navigate } from 'react-router'
import { lazy, Suspense } from 'react'
import { Shell } from '@/components/shell/Shell'
import { RouteError, PageFallback } from '@/components/shell/RouteError'

// After a deploy, an open tab may ask for a chunk that no longer exists: reload once to pick up the new build.
const reloadOnce = (err: unknown): never => {
  if (!sessionStorage.getItem('gk-chunk-reload')) { sessionStorage.setItem('gk-chunk-reload', '1'); location.reload() }
  throw err
}
const page = (load: () => Promise<{ default: React.ComponentType }>) => {
  const C = lazy(() => load().then(m => { sessionStorage.removeItem('gk-chunk-reload'); return m }, reloadOnce))
  return <Suspense fallback={<PageFallback />}><C /></Suspense>
}

export const router = createBrowserRouter([
  {
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: page(() => import('@/features/today/TodayPage')) },
      { path: 'training', element: page(() => import('@/features/training/TrainingPage')) },
      { path: 'training/:id', element: page(() => import('@/features/training/ActivityPage')) },
      { path: 'sleep', element: page(() => import('@/features/sleep/SleepPage')) },
      { path: 'flying', element: page(() => import('@/features/flying/LogbookPage')) },
      { path: 'flying/weather', element: page(() => import('@/features/flying/WeatherPage')) },
      { path: 'flying/pilot', element: page(() => import('@/features/flying/PilotPage')) },
      { path: 'flying/:id', element: page(() => import('@/features/flying/FlightPage')) },
      { path: 'money', element: page(() => import('@/features/money/MoneyPage')) },
      { path: 'money/connections', element: page(() => import('@/features/money/ConnectionsPage')) },
      { path: 'chess', element: page(() => import('@/features/chess/ChessPage')) },
      { path: 'mail/settings/:tab?', element: page(() => import('@/features/mail/MailSettingsPage')) },
      { path: 'mail/:folder?/:threadId?', element: page(() => import('@/features/mail/MailPage')) },
      { path: 'account', element: page(() => import('@/features/account/AccountPage')) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

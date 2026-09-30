import { useRouteError, Link } from 'react-router'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/misc'

export function RouteError() {
  const err = useRouteError() as Error | undefined
  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-6">
      <EmptyState icon={AlertTriangle} title="Something broke on this page" action={<Button asChild><Link to="/">Back to Today</Link></Button>}>
        {err?.message || 'An unexpected error occurred.'}
      </EmptyState>
    </div>
  )
}

export function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      <Skeleton className="h-72" />
    </div>
  )
}

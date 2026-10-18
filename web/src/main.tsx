import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { Toaster } from 'sonner'
import { PrefsProvider } from '@/lib/prefs'
import { TooltipProvider } from '@/components/ui/misc'
import { ConfirmProvider } from '@/components/ui/overlay'
import { router } from './router'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

function ThemedToaster() {
  return <Toaster theme="dark" position="bottom-center" toastOptions={{ className: '!rounded-full !border-0 !bg-[#1f1f1f] !text-fg !shadow-pop !font-sans !text-sm' }} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
        <TooltipProvider delayDuration={300}>
          <ConfirmProvider>
            <RouterProvider router={router} />
            <ThemedToaster />
          </ConfirmProvider>
        </TooltipProvider>
      </PrefsProvider>
    </QueryClientProvider>
  </StrictMode>,
)

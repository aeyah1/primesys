import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { ConfirmProvider } from '@/components/shared/ConfirmDialog'
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react'
import { AuthProvider } from '@/context/AuthContext'
import GlobalLoadingBar from '@/components/shared/GlobalLoadingBar'
import App from './App'
import './index.css'

// Apply saved theme before React mounts so dark-mode users don't see a
// flash of the light theme. AppearanceTab updates this same key.
if (localStorage.getItem('primesys_theme') === 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark')
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = error?.response?.status
        if (status === 401 || status === 403) return false
        return failureCount < 1
      },
      staleTime: 30_000,
    }
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <GlobalLoadingBar />
          <ConfirmProvider><App /></ConfirmProvider>
          {/* Pop-ups in the top-right corner, in the app's card look; errors stay until closed (lib/toast.js). */}
          <Toaster
            position="top-right" visibleToasts={3} gap={10} duration={4000} closeButton
            icons={{
              success: <CheckCircle2 className="size-4 text-emerald-600" />,
              error:   <XCircle className="size-4 text-red-600" />,
              warning: <AlertTriangle className="size-4 text-amber-600" />,
              info:    <Info className="size-4 text-[--color-brand]" />,
            }}
            toastOptions={{
              classNames: {
                toast:        '!rounded-xl !border !border-[--color-border-strong] !bg-[--color-surface] !shadow-lg !font-sans !gap-3 !px-4 !py-3 !border-l-4',
                title:        '!text-sm !font-semibold !text-[--color-text-primary]',
                description:  '!text-xs !text-[--color-text-secondary]',
                actionButton: '!rounded-lg !bg-[--color-brand] !text-white !text-xs !font-semibold !px-3 !h-7',
                closeButton:  '!bg-[--color-surface] !border-[--color-border-strong] !text-[--color-text-muted] hover:!text-[--color-text-primary]',
                success:      '!border-l-emerald-500',
                error:        '!border-l-red-500',
                warning:      '!border-l-amber-500',
                info:         '!border-l-[--color-brand]',
              },
            }}
          />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
)

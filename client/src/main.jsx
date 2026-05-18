import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/context/AuthContext'
import GlobalLoadingBar from '@/components/shared/GlobalLoadingBar'
import App from './App'
import './index.css'

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
          <App />
          <Toaster position="top-right" richColors closeButton />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
)

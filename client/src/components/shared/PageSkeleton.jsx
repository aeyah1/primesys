import { useLocation } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { Leaf } from 'lucide-react'

// Suspense fallback shown while a lazy route chunk loads.
// Mimics the structure of the real page so the transition feels like content
// materializing rather than a spinner-then-page jump. Picks an auth-style
// layout for the unauthenticated routes and an app-shell layout otherwise.
const AUTH_PREFIXES = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email']

export default function PageSkeleton() {
  const { pathname } = useLocation()
  const isAuth = pathname === '/' || AUTH_PREFIXES.some(p => pathname.startsWith(p))
  return isAuth ? <AuthSkeleton /> : <AppSkeleton />
}

function AppSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden bg-[--color-canvas]">
      {/* Sidebar placeholder — solid brand gradient so it feels like the
          real sidebar is already there, just hasn't populated its links yet. */}
      <aside
        className="hidden lg:flex flex-col w-[280px] shrink-0"
        style={{ background: 'linear-gradient(180deg, hsl(145,70%,11%) 0%, hsl(145,60%,19%) 100%)' }}
      >
        <div className="flex items-center gap-3 border-b border-white/10 h-[70px] px-5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-white/15">
            <Leaf className="size-5 text-emerald-300 animate-float" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-24 bg-white/15" />
            <Skeleton className="h-2 w-32 bg-white/10" />
          </div>
        </div>
        <div className="flex-1 px-3 py-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full bg-white/10" />
          ))}
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header bar */}
        <header className="h-[70px] shrink-0 border-b border-[--color-border] bg-[--color-surface] px-4 sm:px-6 lg:px-10 flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="size-9 rounded-full" />
          </div>
        </header>

        {/* Content area */}
        <main className="flex-1 overflow-hidden px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
          <div className="max-w-6xl mx-auto space-y-5">
            {/* Page title block */}
            <div className="space-y-2">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-3.5 w-72" />
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-16" />
                </div>
              ))}
            </div>

            {/* Content card */}
            <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 space-y-3">
              <Skeleton className="h-4 w-32" />
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function AuthSkeleton() {
  return (
    <div className="h-screen flex bg-[--color-canvas]">
      {/* Brand panel — mirrors Login/Register left side */}
      <div
        className="hidden lg:flex flex-col justify-between w-[44%] p-10 relative overflow-hidden lg:rounded-r-[2.5rem]"
        style={{ background: 'linear-gradient(160deg, hsl(145,70%,11%) 0%, hsl(145,60%,19%) 100%)' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-white/15">
            <Leaf className="size-5 text-emerald-300 animate-float" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-24 bg-white/15" />
            <Skeleton className="h-2 w-32 bg-white/10" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-8 w-3/4 bg-white/15" />
          <Skeleton className="h-8 w-2/3 bg-white/15" />
          <Skeleton className="h-3 w-1/2 bg-white/10 mt-4" />
        </div>
        <Skeleton className="h-2 w-32 bg-white/10" />
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-8">
        <div className="w-full max-w-sm space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-3.5 w-56" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ))}
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}

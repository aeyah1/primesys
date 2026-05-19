import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { useLiveUpdates } from '@/hooks/useLiveUpdates'
import { AnimatedPage } from '@/animations'

const TITLES = {
  '/dashboard':       'Dashboard',
  '/pr/create':       'New Purchase Request',
  '/pr':              'Purchase Requests',
  '/bidding':         'Lots & Awards',
  '/po':              'Purchase Orders',
  '/delivery':        'Deliveries',
  '/history':         'History',
  '/notifications':   'Notifications',
  '/reports':         'Reports & Analytics',
  '/users':           'User Management',
  '/quarters':        'Quarters',
  '/settings':        'Settings',
}

// Shared key with AppearanceTab — keep in sync if renaming.
const SIDEBAR_DEFAULT_KEY = 'primesys_sidebar_collapsed_default'

export default function AppLayout() {
  // Read the user's saved preference once on mount; falls back to false (expanded).
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_DEFAULT_KEY) === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()
  useLiveUpdates()

  // Close the mobile drawer whenever the user navigates to a new route
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Lock body scroll while the mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const title = Object.entries(TITLES)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([path]) => pathname.startsWith(path))?.[1] ?? 'PRimeSys'

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-canvas)' }}>
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(p => !p)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Header title={title} onMobileMenu={() => setMobileOpen(true)} />
        <main className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
          <AnimatedPage key={pathname}>
            <Outlet />
          </AnimatedPage>
        </main>
      </div>
    </div>
  )
}

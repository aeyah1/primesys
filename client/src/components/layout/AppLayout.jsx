import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { useLiveUpdates } from '@/hooks/useLiveUpdates'
import { AnimatedPage } from '@/animations'
import OnboardingModal from '@/components/shared/OnboardingModal'
import IdleSignOut from '@/components/shared/IdleSignOut'
import ErrorBoundary from '@/components/shared/ErrorBoundary'
import ConnectionBanner from '@/components/shared/ConnectionBanner'
import { MaintenanceBanner } from '@/components/shared/Maintenance'
import FaceCheckDialog from '@/components/face/FaceCheckDialog'
import FaceSetupGate from '@/components/face/FaceSetupGate'
import { useMyFace } from '@/hooks/useMyFace'

// Each page's name, the same as in the menu and on the page itself.
const TITLES = {
  '/dashboard':     'My tasks',
  '/my-requests':   'My Requests',
  '/pr/create':     'New Request',
  '/pr':            'Requests',
  '/po':            'Purchase Orders',
  '/delivery':      'Deliveries',
  '/awards':        'Awards',
  '/rfqs':          'RFQ History',
  '/certificates':  'Certificates',
  '/suppliers':     'Suppliers',
  '/ppmp':          'PPMP',
  '/reports':       'Reports',
  '/archive':       'Archive',
  '/notifications': 'Notifications',
  '/reminders':     'Reminders',
  '/guide':         'User Guide',
  '/users':         'User Management',
  '/audit':         'Audit Log',
  '/organization':  'Organization',
  '/maintenance':   'Maintenance',
  '/settings':      'Settings',
  '/activity':      'My activity',
}

// Shared key with AppearanceTab — keep in sync if renaming.
const SIDEBAR_DEFAULT_KEY = 'primesys_sidebar_collapsed_default'

export default function AppLayout() {
  // Read the user's saved preference once on mount; falls back to false (expanded).
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_DEFAULT_KEY) === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()
  useLiveUpdates()
  // While face checks are required, a staff member without one sets it up before anything else.
  const { data: face } = useMyFace()
  const setUpFace = face?.in_force && !face.enrolled_at
  const title = Object.entries(TITLES)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([path]) => pathname.startsWith(path))?.[1] ?? 'PRimeSys'

  // The browser tab names the page too.
  useEffect(() => { document.title = title === 'PRimeSys' ? 'PRimeSys' : `${title} · PRimeSys` }, [title])

  // Close the mobile drawer whenever the user navigates to a new route
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Lock body scroll while the mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])


  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-canvas)' }}>
      <OnboardingModal />
      <IdleSignOut />
      <FaceCheckDialog />
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(p => !p)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Header title={title} onMobileMenu={() => setMobileOpen(true)} />
        <ConnectionBanner />
        <MaintenanceBanner />
        <main className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
          {/* A page that crashes shows a way back here, with the menu still usable. */}
          {setUpFace ? <FaceSetupGate /> : (
            <ErrorBoundary resetKey={pathname}>
              <AnimatedPage key={pathname}>
                <Outlet />
              </AnimatedPage>
            </ErrorBoundary>
          )}
        </main>
      </div>
    </div>
  )
}

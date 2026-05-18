import { useState } from 'react'
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
  '/profile':         'My Profile',
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()
  useLiveUpdates()

  const title = Object.entries(TITLES)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([path]) => pathname.startsWith(path))?.[1] ?? 'PRimeSys'

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-canvas)' }}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(p => !p)} />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Header title={title} />
        <main className="flex-1 min-h-0 overflow-y-auto px-10 py-8">
          <AnimatedPage key={pathname}>
            <Outlet />
          </AnimatedPage>
        </main>
      </div>
    </div>
  )
}

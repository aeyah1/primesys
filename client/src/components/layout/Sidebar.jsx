import { NavLink, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FileText, ShoppingCart, Truck,
  Users, Calendar, ChevronRight, Bell, Archive,
  LogOut, Settings as SettingsIcon, Gavel, AlarmClock, BookOpen,
  ClipboardCheck, BarChart3, Scale, FilePlus, PackageCheck, Building2, Store, ListChecks,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'

// One menu per role, holding only that role's own work. The home page (/dashboard)
// is each role's to-do list, so its label names that list.
const HOME_LABELS = {
  requestor: 'My Requests', twg: 'Home', procurement: 'Work Queue', bac: 'For Evaluation', supply: 'To Receive', admin: 'Overview',
}
const HOME_ICONS = { requestor: FileText, twg: LayoutDashboard, procurement: Gavel, bac: Scale, supply: Truck, admin: LayoutDashboard }

const NOTIFICATIONS = { to: '/notifications', label: 'Notifications',   icon: Bell }
const REMINDERS     = { to: '/reminders',     label: 'Reminders',       icon: AlarmClock }
const GUIDE         = { to: '/guide',         label: 'User Guide',      icon: BookOpen }
const ALL_REQUESTS  = { to: '/pr',            label: 'All Requests',    icon: FileText }
const SUPPLIERS     = { to: '/suppliers',     label: 'Suppliers',       icon: Store }
const PPMP          = { to: '/ppmp',          label: 'PPMP',            icon: ListChecks }
const ACCOUNT       = { label: 'Account', items: [{ to: '/settings', label: 'Settings', icon: SettingsIcon }] }
const RECORDS       = { label: 'Records', items: [
  PPMP,
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/archive', label: 'Archive', icon: Archive },
] }

function menuFor(role) {
  const home = { to: '/dashboard', label: HOME_LABELS[role] || 'Home', icon: HOME_ICONS[role] || LayoutDashboard, end: true }
  switch (role) {
    case 'requestor':
      return [{ label: 'My Work', items: [home, { to: '/pr/create', label: 'New Request', icon: FilePlus }, PPMP] },
              { label: 'Help', items: [NOTIFICATIONS, GUIDE] }, ACCOUNT]
    case 'twg':
      return [{ label: 'My Work', items: [home, { to: '/twg/reviews', label: 'To Review', icon: ClipboardCheck }] },
              { label: 'Help', items: [NOTIFICATIONS, GUIDE] }, ACCOUNT]
    case 'procurement':
      return [{ label: 'My Work', items: [home, ALL_REQUESTS, { to: '/po', label: 'Purchase Orders', icon: ShoppingCart }, SUPPLIERS] },
              RECORDS, { label: 'Help', items: [NOTIFICATIONS, REMINDERS, GUIDE] }, ACCOUNT]
    case 'bac':
      return [{ label: 'My Work', items: [home, PPMP] }, { label: 'Help', items: [NOTIFICATIONS, GUIDE] }, ACCOUNT]
    case 'supply':
      return [{ label: 'My Work', items: [home, { to: '/po', label: 'Purchase Orders', icon: ShoppingCart }, { to: '/delivery', label: 'Received', icon: PackageCheck }] },
              { label: 'Help', items: [NOTIFICATIONS, GUIDE] }, ACCOUNT]
    case 'admin':
      return [{ label: 'Overview', items: [home, ALL_REQUESTS] }, RECORDS,
              { label: 'Administration', items: [
                { to: '/users', label: 'User Management', icon: Users },
                SUPPLIERS,
                { to: '/settings?tab=organization', label: 'Organization', icon: Building2 },
                { to: '/quarters', label: 'Quarters', icon: Calendar },
              ] },
              { label: 'Help', items: [NOTIFICATIONS, REMINDERS, GUIDE] }, ACCOUNT]
    default:
      return [{ label: 'Help', items: [home, NOTIFICATIONS, GUIDE] }, ACCOUNT]
  }
}

export { HOME_LABELS }

// Whether a menu link is the current page. A link with a query (the admin's
// Organization, /settings?tab=organization) needs its query to match too, and
// a plain link to the same page gives way to it.
function isCurrent(item, items, { pathname, search }) {
  const [path, query] = item.to.split('?')
  const onPath = item.end ? pathname === path : pathname === path || pathname.startsWith(path + '/')
  if (!onPath) return false
  const here = new URLSearchParams(search)
  const matches = (q) => [...new URLSearchParams(q)].every(([k, v]) => here.get(k) === v)
  if (query) return matches(query)
  return !items.some(o => o !== item && o.to.startsWith(path + '?') && matches(o.to.split('?')[1]))
}

const ROLE_LABELS = { admin: 'Administrator', procurement: 'Procurement', requestor: 'Fund Administrator', supply: 'Supply Officer', twg: 'Technical Working Group', bac: 'Bids and Awards Committee' }

export default function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const groups = menuFor(user?.role)
  const location = useLocation()
  const allItems = groups.flatMap(g => g.items)
  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U'

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'flex flex-col h-full shrink-0 transition-all duration-300 ease-in-out',
          // Mobile: fixed drawer that slides in from the left
          'fixed inset-y-0 left-0 z-50',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: normal in-flow sidebar (always visible)
          'lg:relative lg:translate-x-0',
          // Width — collapsed only applies on desktop; mobile always uses full width
          collapsed ? 'lg:w-[72px] w-[280px]' : 'w-[280px]'
        )}
        style={{ background: 'linear-gradient(180deg, hsl(225,75%,10%) 0%, hsl(222,65%,22%) 100%)' }}
      >
      {/* Logo */}
      <div className={cn(
        'flex items-center gap-3 border-b border-white/10 shrink-0 h-[70px]',
        collapsed ? 'px-0 justify-center' : 'px-5'
      )}>
        <div className="flex size-10 shrink-0 items-center justify-center">
          <img src="/nemsu-logo.png" alt="NEMSU seal" className="size-8 object-contain" />
        </div>
        {!collapsed && (
          <div>
            <p className="text-white font-bold text-base leading-tight tracking-tight">PRimeSys</p>
            <p className="text-[#ECB22E] text-xs mt-0.5 font-medium">Procurement System</p>
          </div>
        )}
      </div>

      {/* Nav: scrolls when the menu is long, with the scrollbar hidden */}
      <nav className="flex-1 min-h-0 overflow-y-auto py-4 px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((group, i) => (
          <div key={group.label} role="group" aria-label={group.label}>
            {collapsed
              ? i > 0 && <div className="my-3 mx-1 h-px bg-white/10" />
              : (
                <p className={cn('px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider leading-none text-blue-100/50', i > 0 && 'pt-4')}>
                  {group.label}
                </p>
              )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={!!item.end}
                  className={() => cn(
                    'flex items-center gap-3 rounded-xl px-3 py-3 text-[14.5px] font-medium',
                    'transition-all duration-200 ease-out',
                    isCurrent(item, allItems, location)
                      ? 'bg-white text-[--color-brand-dark] shadow-sm scale-[1.01]'
                      : 'text-blue-100/80 hover:bg-white/10 hover:text-white hover:translate-x-0.5',
                    collapsed && 'justify-center px-0 py-3.5'
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  {() => (
                    <>
                      <item.icon className={cn(
                        'size-[18px] shrink-0 transition-transform duration-200',
                        isCurrent(item, allItems, location) ? 'text-[--color-brand] scale-110' : 'text-[#ECB22E]'
                      )} />
                      {!collapsed && (
                        <span className="truncate transition-all duration-200">{item.label}</span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* User + Collapse */}
      <div className="shrink-0 border-t border-white/10 p-3 space-y-1.5">
        {!collapsed ? (
          <div className="flex items-center gap-2">
            <Link
              to="/settings"
              className="flex items-center gap-3 flex-1 min-w-0 px-2 py-2.5 rounded-xl hover:bg-white/10 transition-colors"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/20 text-white text-xs font-bold">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold truncate leading-tight">{user?.name}</p>
                <p className="text-[#ECB22E] text-xs truncate mt-0.5">{ROLE_LABELS[user?.role] || user?.role}</p>
              </div>
            </Link>
            <button
              onClick={() => { logout(); navigate('/login') }}
              className="text-[#ECB22E] hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <Link
            to="/settings"
            className="flex items-center justify-center py-2.5 text-[#ECB22E] hover:text-white hover:bg-white/10 rounded-xl transition-colors"
            title="Settings"
          >
            <SettingsIcon className="size-5" />
          </Link>
        )}

        <button
          onClick={onToggle}
          className="hidden lg:flex items-center justify-center gap-2 w-full rounded-xl py-2 text-xs text-[#ECB22E] hover:bg-white/10 hover:text-white transition-colors"
        >
          <ChevronRight className={cn('size-3.5 transition-transform duration-300', !collapsed && 'rotate-180')} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
    </>
  )
}

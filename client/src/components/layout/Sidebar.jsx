import { NavLink, Link } from 'react-router-dom'
import {
  LayoutDashboard, FileText, ShoppingCart, Truck,
  Users, Calendar, ChevronRight, Bell, History,
  LogOut, Leaf, Settings as SettingsIcon, Gavel, AlarmClock, BookOpen,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'

const ALL_NAV = [
  { to: '/dashboard',       label: 'Dashboard',           icon: LayoutDashboard, roles: ['admin','procurement','extension','supply'], end: true },
  { to: '/pr',              label: 'Purchase Requests',   icon: FileText,        roles: ['admin','procurement','extension'] },
  { to: '/bidding',         label: 'Lots & Awards',       icon: Gavel,           roles: ['admin','procurement','extension','supply'] },
  { to: '/po',              label: 'Purchase Orders',     icon: ShoppingCart,    roles: ['admin','procurement','supply','extension'] },
  { to: '/delivery',        label: 'Deliveries',          icon: Truck,           roles: ['admin','procurement','supply','extension'] },
  { to: '/history',         label: 'History',             icon: History,         roles: ['admin','procurement','extension','supply'], divider: true },
  { to: '/reminders',       label: 'Reminders',           icon: AlarmClock,      roles: ['admin','procurement','extension','supply'] },
  { to: '/notifications',   label: 'Notifications',       icon: Bell,            roles: ['admin','procurement','extension','supply'] },
  { to: '/users',           label: 'User Management',     icon: Users,           roles: ['admin'],                              divider: true },
  { to: '/quarters',        label: 'Quarters',            icon: Calendar,        roles: ['admin'] },
  { to: '/guide',           label: 'User Guide',          icon: BookOpen,        roles: ['admin','procurement','extension','supply'], divider: true },
]

const ROLE_LABELS = { admin: 'Administrator', procurement: 'Procurement', extension: 'Extension Officer', supply: 'Supply Officer' }

export default function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const nav = ALL_NAV.filter(n => n.roles.includes(user?.role))
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
        style={{ background: 'linear-gradient(180deg, hsl(145,70%,11%) 0%, hsl(145,60%,19%) 100%)' }}
      >
      {/* Logo */}
      <div className={cn(
        'flex items-center gap-3 border-b border-white/10 shrink-0 h-[70px]',
        collapsed ? 'px-0 justify-center' : 'px-5'
      )}>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <Leaf className="size-5 text-emerald-300 animate-float" />
        </div>
        {!collapsed && (
          <div>
            <p className="text-white font-bold text-base leading-tight tracking-tight">PRimeSys</p>
            <p className="text-emerald-300 text-xs mt-0.5 font-medium">Procurement System</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto py-4 px-3 space-y-0.5">
        {nav.map((item) => (
          <div key={item.to}>
            {item.divider && (
              <div className="my-3 mx-1 h-px bg-white/10" />
            )}
            <NavLink
              to={item.to}
              end={!!item.end}
              className={({ isActive }) => cn(
                'flex items-center gap-3 rounded-xl px-3 py-3 text-[14.5px] font-medium',
                'transition-all duration-200 ease-out',
                isActive
                  ? 'bg-white text-emerald-900 shadow-sm scale-[1.01]'
                  : 'text-emerald-100/80 hover:bg-white/10 hover:text-white hover:translate-x-0.5',
                collapsed && 'justify-center px-0 py-3.5'
              )}
              title={collapsed ? item.label : undefined}
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn(
                    'size-[18px] shrink-0 transition-transform duration-200',
                    isActive ? 'text-emerald-700 scale-110' : 'text-emerald-300'
                  )} />
                  {!collapsed && (
                    <span className="truncate transition-all duration-200">{item.label}</span>
                  )}
                </>
              )}
            </NavLink>
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
                <p className="text-emerald-300 text-xs truncate mt-0.5">{ROLE_LABELS[user?.role] || user?.role}</p>
              </div>
            </Link>
            <button
              onClick={() => { logout(); navigate('/login') }}
              className="text-emerald-300 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <Link
            to="/settings"
            className="flex items-center justify-center py-2.5 text-emerald-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
            title="Settings"
          >
            <SettingsIcon className="size-5" />
          </Link>
        )}

        <button
          onClick={onToggle}
          className="hidden lg:flex items-center justify-center gap-2 w-full rounded-xl py-2 text-xs text-emerald-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <ChevronRight className={cn('size-3.5 transition-transform duration-300', !collapsed && 'rotate-180')} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
    </>
  )
}

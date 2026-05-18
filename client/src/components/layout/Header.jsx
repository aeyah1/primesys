import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { NotificationBell } from '@/components/shared/NotificationBell'
import { LogOut, UserCircle, Bell, Menu } from 'lucide-react'

const ROLE_LABELS = { admin: 'Administrator', procurement: 'Procurement', extension: 'Extension Officer', supply: 'Supply Officer' }
const ROLE_COLORS = {
  admin:       'bg-purple-100 text-purple-800',
  procurement: 'bg-blue-100 text-blue-800',
  extension:   'bg-teal-100 text-teal-800',
  supply:      'bg-orange-100 text-orange-800',
}

export default function Header({ title, onMobileMenu }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U'

  return (
    <header
      className="h-[70px] flex items-center justify-between px-4 sm:px-6 lg:px-8 border-b border-[--color-border] bg-white shrink-0"
      style={{ boxShadow: '0 1px 0 0 var(--color-border), 0 2px 8px 0 rgba(15,74,34,0.04)' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden -ml-1 p-2 rounded-lg text-[--color-text-muted] hover:text-[--color-text-primary] hover:bg-[--color-overlay] transition-colors"
        >
          <Menu className="size-5" />
        </button>
        <h1 className="text-ui-lg font-bold text-[--color-text-primary] truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-1.5">
        <NotificationBell />

        <button
          onClick={() => navigate('/notifications')}
          className="hidden sm:flex items-center gap-1.5 text-xs text-[--color-text-muted] hover:text-[--color-text-primary] px-2.5 py-2 rounded-lg hover:bg-[--color-overlay] transition-colors"
        >
          <Bell className="size-3.5" />
          View all
        </button>

        <div className="w-px h-6 bg-[--color-border] mx-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-[--color-overlay] transition-colors duration-150">
              <Avatar className="size-9">
                <AvatarFallback className="text-xs font-bold bg-[--color-brand-light] text-[--color-brand]">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start">
                <span className="text-sm font-semibold text-[--color-text-primary] leading-tight">{user?.name}</span>
                <span className={`text-[11px] font-medium px-1.5 py-0 rounded-full mt-0.5 ${ROLE_COLORS[user?.role] || 'bg-slate-100 text-slate-700'}`}>
                  {ROLE_LABELS[user?.role] || user?.role}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="px-3 py-3 border-b border-[--color-border]">
              <p className="text-sm font-semibold text-[--color-text-primary]">{user?.name}</p>
              <p className="text-xs text-[--color-text-muted] mt-0.5">{user?.email}</p>
            </div>
            <div className="py-1">
              <DropdownMenuItem onClick={() => navigate('/profile')} className="gap-2">
                <UserCircle className="size-4 text-[--color-text-muted]" />
                My Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => { logout(); navigate('/login') }}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 gap-2"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

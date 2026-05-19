import { useState } from 'react'
import { User, Lock, Palette, Building2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'
import ProfileTab from './ProfileTab'
import SecurityTab from './SecurityTab'
import AppearanceTab from './AppearanceTab'
import OrganizationTab from './OrganizationTab'

const TABS = [
  { key: 'profile',      label: 'Profile',      icon: User,      Comp: ProfileTab },
  { key: 'security',     label: 'Security',     icon: Lock,      Comp: SecurityTab },
  { key: 'appearance',   label: 'Appearance',   icon: Palette,   Comp: AppearanceTab },
  { key: 'organization', label: 'Organization', icon: Building2, Comp: OrganizationTab, adminOnly: true },
]

export default function Settings() {
  const { user } = useAuth()
  const [active, setActive] = useState('profile')

  const tabs       = TABS.filter(t => !t.adminOnly || user?.role === 'admin')
  const ActiveComp = tabs.find(t => t.key === active)?.Comp ?? ProfileTab

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-ui-xl font-bold text-[--color-text-primary]">Settings</h2>
        <p className="text-ui-xs text-[--color-text-secondary] mt-0.5">
          Manage your account, preferences, and {user?.role === 'admin' ? 'organization defaults' : 'security'}
        </p>
      </div>

      <div className="border-b border-[--color-border]">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActive(key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-ui-sm font-medium whitespace-nowrap',
                'border-b-2 -mb-px transition-colors',
                active === key
                  ? 'border-[--color-brand] text-[--color-brand]'
                  : 'border-transparent text-[--color-text-secondary] hover:text-[--color-text-primary]'
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="animate-fade-in-up">
        <ActiveComp />
      </div>
    </div>
  )
}

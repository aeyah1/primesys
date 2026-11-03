import { useSearchParams, Navigate } from 'react-router-dom'
import { User, Lock, Bell, Palette } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { cn } from '@/lib/utils'
import ProfileTab from './ProfileTab'
import SecurityTab from './SecurityTab'
import NotificationsTab from './NotificationsTab'
import AppearanceTab from './AppearanceTab'

const TABS = [
  { key: 'profile',       label: 'Profile',       icon: User,    sub: 'Your name, designation and signature',   Comp: ProfileTab },
  { key: 'security',      label: 'Security',      icon: Lock,    sub: 'Your password and signed-in devices',    Comp: SecurityTab },
  { key: 'notifications', label: 'Notifications', icon: Bell,    sub: 'Sounds and desktop popups',              Comp: NotificationsTab },
  { key: 'appearance',    label: 'Appearance',    icon: Palette, sub: 'Theme and menu layout on this device',   Comp: AppearanceTab },
]
// The admin's campus-wide settings have pages of their own now; their old tabs land there.
const MOVED = { organization: '/organization', maintenance: '/maintenance' }

// Your own account: a section list on the left, the chosen section across the rest of the page (?tab=).
export default function Settings() {
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab')
  if (MOVED[asked]) return <Navigate to={MOVED[asked]} replace />
  const active = TABS.find(t => t.key === asked) || TABS[0]
  const Section = active.Comp

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" sub="Your own account: how you appear, how you sign in, and how PRimeSys looks and alerts you." />

      <div className="grid items-start gap-5 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto rounded-xl border border-[--color-border] bg-[--color-surface] p-1.5 shadow-sm lg:sticky lg:top-0 lg:flex-col">
          {TABS.map(({ key, label, sub, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setParams(key === 'profile' ? {} : { tab: key }, { replace: true })}
              aria-current={active.key === key ? 'page' : undefined}
              className={cn('flex shrink-0 items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                active.key === key ? 'bg-[--color-brand-light] text-[--color-brand]' : 'text-[--color-text-secondary] hover:bg-[--color-overlay] hover:text-[--color-text-primary]')}>
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="block text-ui-sm font-semibold">{label}</span>
                <span className="hidden text-[11px] leading-snug text-[--color-text-muted] lg:block">{sub}</span>
              </span>
            </button>
          ))}
        </nav>

        <div key={active.key} className="min-w-0 animate-fade-in-up"><Section /></div>
      </div>
    </div>
  )
}

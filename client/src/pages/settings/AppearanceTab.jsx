import { useState, useEffect } from 'react'
import { Moon, PanelLeftClose } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

// Shared keys with main.jsx (theme) and AppLayout (sidebar default).
const THEME_KEY            = 'primesys_theme'
const SIDEBAR_DEFAULT_KEY  = 'primesys_sidebar_collapsed_default'

export default function AppearanceTab() {
  const [dark,      setDark]      = useState(() => localStorage.getItem(THEME_KEY) === 'dark')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_DEFAULT_KEY) === 'true')

  // Live-apply theme changes to <html> and persist.
  useEffect(() => {
    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark')
      localStorage.setItem(THEME_KEY, 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
      localStorage.setItem(THEME_KEY, 'light')
    }
  }, [dark])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_DEFAULT_KEY, String(collapsed))
  }, [collapsed])

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>Switch between light and dark. Applies immediately.</CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleRow
            icon={Moon}
            label="Dark mode"
            description="Easier on the eyes in low light. The sidebar keeps its green for brand consistency."
            checked={dark}
            onChange={(next) => {
              setDark(next)
              toast.success(next ? 'Dark mode on' : 'Light mode on')
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Layout</CardTitle>
          <CardDescription>Saved on this device only — doesn't sync across browsers</CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleRow
            icon={PanelLeftClose}
            label="Keep sidebar collapsed by default"
            description="Useful on smaller screens. You can still expand it any time with the chevron at the bottom of the sidebar."
            checked={collapsed}
            onChange={(next) => {
              setCollapsed(next)
              toast.success(next ? 'Sidebar will start collapsed next time' : 'Sidebar will start expanded next time')
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function ToggleRow({ icon: Icon, label, description, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[--color-overlay] text-[--color-brand]">
          <Icon className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-ui-sm font-semibold text-[--color-text-primary]">{label}</p>
          <p className="text-ui-xs text-[--color-text-secondary] mt-0.5 leading-relaxed">{description}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 mt-1 ${
          checked ? 'bg-[--color-brand]' : 'bg-[--color-border-strong]'
        }`}
      >
        <span
          className={`inline-block size-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          } mt-0.5`}
        />
      </button>
    </div>
  )
}

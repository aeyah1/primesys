import { useState, useEffect } from 'react'
import { Volume2, BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// Shared with useLiveUpdates so the realtime hook respects the same toggle.
const SOUND_KEY   = 'primesys_notif_sound'
const DESKTOP_KEY = 'primesys_notif_desktop'

export default function NotificationsTab() {
  const [sound,   setSound]   = useState(() => localStorage.getItem(SOUND_KEY) !== 'false')   // default ON
  const [desktop, setDesktop] = useState(() => localStorage.getItem(DESKTOP_KEY) === 'true')   // default OFF
  const [permission, setPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )

  useEffect(() => { localStorage.setItem(SOUND_KEY, String(sound))   }, [sound])
  useEffect(() => { localStorage.setItem(DESKTOP_KEY, String(desktop)) }, [desktop])

  async function requestDesktopPermission() {
    if (typeof Notification === 'undefined') {
      toast.error('Your browser does not support desktop notifications')
      return
    }
    const result = await Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') {
      setDesktop(true)
      // Quick confirmation popup so the user sees what notifications will look like.
      new Notification('PRimeSys notifications enabled', {
        body: "You'll see a popup when something happens that needs your attention.",
        silent: !sound,
      })
    } else if (result === 'denied') {
      toast.error('Notifications blocked. Enable them in your browser settings to re-enable.')
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>In-app sound</CardTitle>
          <CardDescription>Plays a short tone when a new notification arrives while the app is open</CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleRow
            icon={Volume2}
            label="Play sound on new notifications"
            description="Audible cue when a new PR update, PO, delivery, or reminder lands."
            checked={sound}
            onChange={(next) => {
              setSound(next)
              if (next) playChime()
              toast.success(next ? 'Sound enabled' : 'Sound disabled')
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Desktop notifications</CardTitle>
          <CardDescription>Show a system popup even when this tab isn't focused</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {permission === 'unsupported' && (
            <p className="text-ui-sm text-[--color-text-secondary]">
              This browser doesn't support desktop notifications. Try Chrome, Edge, or Firefox.
            </p>
          )}

          {permission === 'default' && (
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-ui-sm font-semibold text-[--color-text-primary]">Permission required</p>
                <p className="text-ui-xs text-[--color-text-secondary] mt-0.5 leading-relaxed">
                  Your browser needs to ask for permission first. Click the button to grant it.
                </p>
              </div>
              <Button onClick={requestDesktopPermission} size="sm" className="gap-1.5 shrink-0">
                <BellRing className="size-3.5" />
                Enable
              </Button>
            </div>
          )}

          {permission === 'granted' && (
            <ToggleRow
              icon={BellRing}
              label="Show desktop popups"
              description="Permission is granted. Toggle off to silence popups without revoking browser permission."
              checked={desktop}
              onChange={(next) => {
                setDesktop(next)
                toast.success(next ? 'Desktop notifications on' : 'Desktop notifications off')
              }}
            />
          )}

          {permission === 'denied' && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-ui-sm font-semibold text-red-900">Notifications blocked</p>
              <p className="text-ui-xs text-red-700 mt-1 leading-relaxed">
                You previously denied permission. To re-enable, click the lock icon in your browser's address bar,
                find "Notifications," and switch it back to Allow.
              </p>
            </div>
          )}
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

// Short pleasant tone for the test/preview when the user toggles sound on.
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
  } catch {
    // AudioContext unavailable — silent failure is fine here.
  }
}

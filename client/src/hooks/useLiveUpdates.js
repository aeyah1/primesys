import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'

// The notification types the server actually sends (utils/notify.js callers).
const TYPE_MESSAGES = {
  info:        { label: 'Update' },
  success:     { label: 'Approved' },
  warning:     { label: 'Needs attention' },
  error:       { label: 'Not approved' },
  delivered:   { label: 'Delivery' },
  lot_updated: { label: 'Award' },
  reminder:    { label: 'Reminder' },
}

export function useLiveUpdates() {
  const { socket } = useAuth()
  const qc         = useQueryClient()

  useEffect(() => {
    if (!socket) return

    const handler = (notification) => {
      const meta = TYPE_MESSAGES[notification.type]

      toast(notification.message, {
        description: meta?.label,
        duration: 6000,
      })

      // Respect user preferences from Settings → Notifications.
      if (localStorage.getItem('primesys_notif_sound') !== 'false') playChime()
      if (
        localStorage.getItem('primesys_notif_desktop') === 'true' &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        document.visibilityState !== 'visible'    // don't double up when tab is already focused
      ) {
        new Notification(meta?.label || 'PRimeSys', {
          body: notification.message,
          silent: localStorage.getItem('primesys_notif_sound') === 'false',
        })
      }

      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notifications-unread'] })

      // What to refresh is decided by what the notice POINTS AT, not by its
      // type. The type is a severity the server picks freely ('info',
      // 'warning', ...), so switching on it silently stopped matching when
      // those were consolidated, and the lists went stale until refetched.
      // reference_type is only ever 'pr', 'lot' or 'delivery'.
      const id = notification.reference_id ? String(notification.reference_id) : null
      const refresh = (...keys) => keys.forEach(k => qc.invalidateQueries({ queryKey: k }))

      switch (notification.reference_type) {
        case 'pr':
          refresh(['pr-list'], ['pr-stats'], ['po-list'], ['lot-queue'], ['archive'], ['twg-pending'])
          if (id) refresh(['pr', id], ['pr-items', id], ['pr-logs', id], ['canvass', id])
          break

        case 'lot':
          refresh(['pr-list'], ['pr-stats'], ['lots'], ['lot-queue'])
          break

        case 'delivery':
          refresh(['pr-list'], ['pr-stats'], ['po-list'], ['delivery-list'], ['archive'])
          break
      }
    }

    socket.on('notification', handler)
    return () => socket.off('notification', handler)
  }, [socket, qc])
}

// Short 880Hz tone; mirrors the preview chime in NotificationsTab so the
// audible cue is identical whether the user is testing or receiving.
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
    // AudioContext blocked (no user gesture yet, etc.) — silent failure is fine.
  }
}

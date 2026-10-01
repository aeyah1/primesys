import { useEffect, createElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'
import { iconFor, linkFor, TYPE_LABEL } from '@/lib/notices'

// How a live notice pops up: its color follows its severity (lib/notices.js has the icon).
const TOAST_KIND = { success: 'success', delivered: 'success', warning: 'warning', error: 'error', reminder: 'warning' }
const ICON_COLOR = { success: 'text-emerald-600', warning: 'text-amber-600', error: 'text-red-600', info: 'text-[--color-brand]' }

export function useLiveUpdates() {
  const { socket } = useAuth()
  const qc         = useQueryClient()
  const navigate   = useNavigate()

  useEffect(() => {
    if (!socket) return

    const handler = (notification) => {
      const label = TYPE_LABEL[notification.type]
      const kind  = TOAST_KIND[notification.type] || 'info'
      const link  = linkFor(notification)
      // A live notice fades like the others, even a "not approved" one; the bell keeps it.
      toast[kind](notification.message, {
        description: label,
        duration: 8000,
        icon: createElement(iconFor(notification.type), { className: `size-4 ${ICON_COLOR[kind]}` }),
        ...(link ? {
          action: {
            label: link.label,
            onClick: () => {
              api.patch(`/notifications/${notification.id}/read`)
                .then(() => qc.invalidateQueries({ queryKey: ['notifications-unread'] }))
                .catch(() => {})
              navigate(link.to)
            },
          },
        } : {}),
      })

      // Respect user preferences from Settings → Notifications.
      if (localStorage.getItem('primesys_notif_sound') !== 'false') playChime()
      if (
        localStorage.getItem('primesys_notif_desktop') === 'true' &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        document.visibilityState !== 'visible'    // don't double up when tab is already focused
      ) {
        new Notification(label || 'PRimeSys', {
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
      // reference_type is 'pr', 'lot', 'delivery' or 'ppmp'.
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

        case 'ppmp':
          refresh(['ppmp-list'])
          if (id) refresh(['ppmp', id])
          break
      }
    }

    socket.on('notification', handler)
    return () => socket.off('notification', handler)
  }, [socket, qc, navigate])
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

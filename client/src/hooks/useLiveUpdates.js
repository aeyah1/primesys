import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'

const TYPE_MESSAGES = {
  po_issued:   { label: 'Purchase Order Issued' },
  po_pending:  { label: 'PO Awaiting Approval' },
  po_approved: { label: 'PO Approved' },
  delivered:   { label: 'Delivery Confirmed' },
  lot_updated: { label: 'Lot Updated' },
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

      switch (notification.type) {
        case 'lot_created':
        case 'lot_updated':
        case 'lot_all_awarded':
          qc.invalidateQueries({ queryKey: ['pr-list'] })
          qc.invalidateQueries({ queryKey: ['pr-stats'] })
          qc.invalidateQueries({ queryKey: ['lots'] })
          break

        case 'po_issued':
        case 'po_pending':
        case 'po_approved':
          qc.invalidateQueries({ queryKey: ['pr-list'] })
          qc.invalidateQueries({ queryKey: ['pr-stats'] })
          qc.invalidateQueries({ queryKey: ['po-list'] })
          if (notification.reference_id) {
            qc.invalidateQueries({ queryKey: ['pr', String(notification.reference_id)] })
          }
          break

        case 'delivered':
          qc.invalidateQueries({ queryKey: ['pr-list'] })
          qc.invalidateQueries({ queryKey: ['pr-stats'] })
          qc.invalidateQueries({ queryKey: ['history-pr'] })
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

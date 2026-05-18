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

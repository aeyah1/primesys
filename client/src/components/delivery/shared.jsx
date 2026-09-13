import { useQueryClient } from '@tanstack/react-query'

// Quantities and money in hundredths, so sums and comparisons are exact (as on the server).
export const hundredths = (n) => Math.round(Number(n || 0) * 100)
export const qty = (n) => String(Number(n || 0))   // "2.00" → "2"

export const TEXTAREA = 'w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y'

// Everything that shows POs and deliveries, refreshed after any change to them
// (a cancelled PO's items also go back to canvass).
export function useRefreshDeliveries() {
  const qc = useQueryClient()
  return () => {
    for (const key of [['po-list'], ['po-detail'], ['deliveries'], ['pr'], ['pr-list'], ['pr-stats'], ['pr-logs'], ['lots'], ['lot-queue'], ['lot-suppliers'], ['canvass']]) {
      qc.invalidateQueries({ queryKey: key })
    }
  }
}

// "3 of 6 received" for a PO with lines (qty_ordered / qty_received), else null.
export function receivedText(po) {
  if (!(Number(po.qty_ordered) > 0)) return null
  return `${qty(po.qty_received)} of ${qty(po.qty_ordered)} received`
}

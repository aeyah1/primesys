import { useQueryClient } from '@tanstack/react-query'

// Shared bits of the canvass and award screens. A winner's supplier is typed
// as on the canvasser's abstract (the canvass is done outside the system).

// Names that differ only in upper/lower case or spacing are the same
// (server: awardWorkflow.supplierKey).
export const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()

// Money in whole centavos, so sums and comparisons are exact (as on the server).
export const cents     = (v) => Math.round(Number(v || 0) * 100)
export const lineCents = (quantity, price) => Math.round(Number(quantity || 0) * Number(price || 0) * 100)

export const Optional = () => <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>

export function SectionTitle({ children, action }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[--color-border] pb-1.5">
      <p className="text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider">{children}</p>
      {action}
    </div>
  )
}

// Everything that shows awards, refreshed after any award, review, or PO change.
export function useRefreshAwards(prId) {
  const qc = useQueryClient()
  return () => {
    for (const key of [['canvass', prId], ['lots'], ['lot-queue'], ['pr', prId], ['pr-list'], ['pr-stats'], ['pr-logs', prId], ['po-list'], ['bac'], ['twg']]) {
      qc.invalidateQueries({ queryKey: key })
    }
  }
}

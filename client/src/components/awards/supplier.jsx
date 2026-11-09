import { useQueryClient } from '@tanstack/react-query'

// Shared bits of the canvass and award screens. A winner's supplier is typed
// as the BAC chose it (the canvass is done outside the system).

// Names that differ only in upper/lower case or spacing are the same
// (server: awardWorkflow.supplierKey).
export const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()

// Money in whole centavos, so sums and comparisons are exact (as on the server).
export const cents     = (v) => Math.round(Number(v || 0) * 100)
export const lineCents = (quantity, price) => Math.round(Number(quantity || 0) * Number(price || 0) * 100)

// The DQ mark on a supplier the TWG found non-compliant on every item it offered (older quotations).
export const DQBadge = () => (
  <span className="ml-1.5 inline-flex items-center rounded-full border border-red-300 bg-red-50 px-1.5 py-px text-[10px] font-bold text-red-700" title="Disqualified: non-compliant on every item it offered">DQ</span>
)

// The canvass's lots, each with its items (GET /canvass/:prId); a lot goes to one supplier.
export const lotsWithItems = ({ lots, items }) => lots.map(l => ({ ...l, items: l.item_ids.map(id => items.find(i => i.id === id)) }))

// What an award is recorded on: a numbered BAC Resolution, or below the resolution threshold the Abstract alone.
export const awardRecordName = (r) => (r.kind === 'abstract' ? 'Abstract of sealed Quotations' : `BAC Resolution No. ${r.resolution_number}`)

export const Optional = () => <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>

// Everything that shows awards, refreshed after any award, review, or PO change.
export function useRefreshAwards(prId) {
  const qc = useQueryClient()
  return () => {
    for (const key of [['canvass', prId], ['lots'], ['lot-queue'], ['pr', prId], ['pr-list'], ['pr-stats'], ['pr-logs', prId], ['po-list'], ['bac'], ['twg'], ['pr-tasks']]) {
      qc.invalidateQueries({ queryKey: key })
    }
  }
}

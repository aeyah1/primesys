import { useQueryClient } from '@tanstack/react-query'

// Shared bits of the canvass and award screens. A winner's supplier is typed
// as on the canvasser's abstract (the canvass is done outside the system).

// Names that differ only in upper/lower case or spacing are the same
// (server: awardWorkflow.supplierKey).
export const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()

// A supplier profile the RFQ's supplier matches: the same name (ignoring case, spacing,
// punctuation and "&" for "and"), else the same email, else the same phone number.
const looseKey = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^63/, '0')
export const findProfile = (profiles, { name, email, phone } = {}) => (name && profiles.find(p => looseKey(p.name) === looseKey(name)))
  || (email && profiles.find(p => p.email?.toLowerCase() === email.toLowerCase()))
  || (phone && profiles.find(p => p.phone && digits(p.phone) === digits(phone)))
  || null

// Money in whole centavos, so sums and comparisons are exact (as on the server).
export const cents     = (v) => Math.round(Number(v || 0) * 100)
export const lineCents = (quantity, price) => Math.round(Number(quantity || 0) * Number(price || 0) * 100)

// A bidder's total for the given items in centavos, or null unless it bid on every one (server: canvassBids.totalOf).
export const totalOf = (bidder, items) => (items.every(i => bidder.prices[i.id] != null)
  ? items.reduce((sum, i) => sum + lineCents(i.quantity, bidder.prices[i.id]), 0) : null)

// DQ (disqualified): the TWG found the bidder non-compliant on every item it offered (server: canvassBids.certifyBids).
export const isDQ = (bidder, items) => {
  const offered = items.filter(i => i.state !== 'dropped' && bidder.prices[i.id] != null)
  return offered.length > 0 && offered.every(i => bidder.evaluation?.[i.id]?.compliant === false)
}

// The DQ mark on a bidder's name.
export const DQBadge = () => (
  <span className="ml-1.5 inline-flex items-center rounded-full border border-red-300 bg-red-50 px-1.5 py-px text-[10px] font-bold text-red-700" title="Disqualified: non-compliant on every item it offered">DQ</span>
)

// The canvass's lots, each with its items (GET /canvass/:prId); a lot goes to one supplier.
export const lotsWithItems = ({ lots, items }) => lots.map(l => ({ ...l, items: l.item_ids.map(id => items.find(i => i.id === id)) }))

export const Optional = () => <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>

// Everything that shows awards, refreshed after any award, review, or PO change.
export function useRefreshAwards(prId) {
  const qc = useQueryClient()
  return () => {
    for (const key of [['canvass', prId], ['lots'], ['lot-queue'], ['pr', prId], ['pr-list'], ['pr-stats'], ['pr-logs', prId], ['po-list'], ['bac'], ['twg']]) {
      qc.invalidateQueries({ queryKey: key })
    }
  }
}

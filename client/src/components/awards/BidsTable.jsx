import { Check } from 'lucide-react'
import { fmtCurrency } from '@/lib/utils'
import { nameKey, cents } from './supplier'

// Every bid the BAC entered, read only: items down, bidders across, each
// item's winner marked (its award, or the BAC's pick before the award) and its
// lowest bid noted. items / bidders: GET /canvass/:prId.
export default function BidsTable({ items, bidders }) {
  if (!bidders.length) return null
  const winnerOf = (i) => (i.state === 'awarded'
    ? bidders.find(b => nameKey(b.name) === nameKey(i.awarded_to))?.id
    : i.winner_bidder_id)
  return (
    <div className="rounded-xl border border-[--color-border] overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
            <th className="px-3 py-2.5">Item</th>
            <th className="px-3 py-2.5 text-right whitespace-nowrap">Budget each</th>
            {bidders.map(b => <th key={b.id} className="px-3 py-2.5 text-right normal-case tracking-normal">{b.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map(i => {
            const prices = bidders.map(b => b.prices[i.id]).filter(p => p != null).map(cents)
            const low = prices.length ? Math.min(...prices) : null
            const won = winnerOf(i)
            return (
              <tr key={i.id} className="border-t border-[--color-border] align-top">
                <td className="px-3 py-2.5 min-w-40">
                  <span className={i.state === 'dropped' ? 'line-through text-[--color-text-muted]' : 'text-[--color-text-primary]'}>{i.item_name}</span>
                  <span className="block text-[11px] text-[--color-text-muted]">{Number(i.quantity)} {i.unit || ''}{i.state === 'dropped' ? ', dropped' : ''}</span>
                  {i.state !== 'awarded' && i.winner_reason && <span className="block text-[11px] text-amber-700">Not the lowest: {i.winner_reason}</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-[--color-text-secondary]">{Number(i.estimated_cost) > 0 ? fmtCurrency(i.estimated_cost) : 'None'}</td>
                {bidders.map(b => {
                  const p = b.prices[i.id]
                  const isWinner = won === b.id && p != null
                  return (
                    <td key={b.id} className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${isWinner ? 'bg-emerald-50 font-semibold text-emerald-800' : ''}`}>
                      {p != null ? (
                        <>
                          <span className="inline-flex items-center gap-1">{isWinner && <Check className="size-3.5" />}{fmtCurrency(p)}</span>
                          {cents(p) === low && <span className="block text-[10px] font-normal text-[--color-text-muted]">lowest</span>}
                        </>
                      ) : <span className="text-[--color-text-muted]">-</span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

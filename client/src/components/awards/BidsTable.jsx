import { Check, Star } from 'lucide-react'
import { fmtCurrency } from '@/lib/utils'
import { nameKey, cents, lineCents, totalOf, lotsWithItems, isDQ, DQBadge } from './supplier'

// The TWG's verdict on one bid, with the offered specification or the reason on hover.
function Verdict({ ev }) {
  if (ev?.compliant === true) return <span className="block text-[10px] font-normal text-emerald-700" title={ev.offered_spec || ''}>Compliant</span>
  if (ev?.compliant === false) return <span className="block text-[10px] font-normal text-red-700" title={ev.remarks || ''}>Non-compliant</span>
  return null
}

// A bidder's remarks: each lot it was awarded with the BAC's remark, or DQ with the TWG's.
function remarksOf(b, lots, headed, wonBy, items) {
  const won = lots.map(lot => ({ lot, items: lot.items.filter(i => wonBy(i, b)) })).filter(x => x.items.length)
  const list = won.map(({ lot, items: own }) => ({
    tone: 'text-emerald-700', label: headed ? `Awarded ${lot.name}` : 'Awarded', text: own.find(i => i.winner_reason)?.winner_reason,
  }))
  if (isDQ(b, items)) list.push({ tone: 'text-red-700', label: 'DQ', text: b.dq_remarks })
  return list
}

/* Every bid the BAC entered, compared lot by lot: items down, the bidders
   across (with their RFQ No.), each bid with the TWG's verdict, and each
   bidder's total for the lot (only a bidder that bid on all of it can win it).
   The lot's recommended bidder (the lowest compliant total) is starred while
   it waits for the award, and its winner checked once awarded. Under them,
   each bidder's remarks (Awarded, DQ) and the TWG's Re-PR reason when every bidder was DQ.
   canvass: GET /canvass/:prId. Optional: pick ({ [lot label]: bidder id }) with
   onPick(lot, bidderId) to choose each lot's winner; lotNote(lot) for a line
   under a lot; action(item) for a last cell on each item. */
export default function BidsTable({ canvass, pick, onPick, lotNote, action }) {
  const { bidders } = canvass
  if (!bidders.length) return null
  const lots = lotsWithItems(canvass)
  const headed = lots.length > 1 || lots.some(l => l.label)
  const cols = 2 + bidders.length + (action ? 1 : 0)
  const wonBy = (i, b) => i.state === 'awarded' && nameKey(b.name) === nameKey(i.awarded_to)
  const remarks = bidders.map(b => remarksOf(b, lots, headed, wonBy, canvass.items))
  const rePr = canvass.re_pr && bidders.every(b => isDQ(b, canvass.items)) ? canvass.re_pr : null
  return (
    <div className="rounded-xl border border-[--color-border] overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
            <th className="px-3 py-2.5 min-w-40">Item</th>
            <th className="px-3 py-2.5 text-right whitespace-nowrap">Budget each</th>
            {bidders.map(b => (
              <th key={b.id} className="px-3 py-2.5 min-w-32 text-right normal-case tracking-normal">
                <span className="text-[--color-text-primary]">{b.name}</span>
                {isDQ(b, canvass.items) && <DQBadge />}
                {b.rfq_no && <span className="block text-[10px] font-normal text-[--color-text-muted]">RFQ No. {b.rfq_no}</span>}
              </th>
            ))}
            {action && <th className="w-10" />}
          </tr>
        </thead>
        {lots.map(lot => {
          // The total covers the items still to award, or, once all are awarded, the awarded ones.
          const pending = lot.items.filter(i => i.state === 'pending')
          const counted = pending.length ? pending : lot.items.filter(i => i.state === 'awarded')
          const budget = counted.reduce((s, i) => s + lineCents(i.quantity, i.estimated_cost), 0)
          const totals = bidders.map(b => (counted.length ? totalOf(b, counted) : null))
          const complete = totals.filter(t => t != null)
          const low = complete.length ? Math.min(...complete) : null
          const choosing = pick && pending.length > 0
          return (
            <tbody key={lot.label || '-'} className="border-t-2 border-[--color-border]">
              {headed && (
                <tr className="bg-[--color-canvas]">
                  <td colSpan={cols} className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[--color-text-primary]">{lot.name}</td>
                </tr>
              )}
              {lot.items.map(i => {
                const prices = bidders.map(b => b.prices[i.id]).filter(p => p != null).map(cents)
                const lowest = prices.length > 1 ? Math.min(...prices) : null
                return (
                  <tr key={i.id} className="border-t border-[--color-border] align-top">
                    <td className="px-3 py-2.5">
                      <span className={i.state === 'dropped' ? 'line-through text-[--color-text-muted]' : 'text-[--color-text-primary]'}>{i.item_name}</span>
                      <span className="block text-[11px] text-[--color-text-muted]">
                        {Number(i.quantity)} {i.unit || ''}
                        {i.state === 'dropped' ? `, dropped${i.drop_reason ? `: ${i.drop_reason}` : ''}` : ''}
                        {i.state === 'awarded' ? `, awarded to ${i.awarded_to || 'the whole PR\'s supplier'}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-[--color-text-secondary]">{Number(i.estimated_cost) > 0 ? fmtCurrency(i.estimated_cost) : 'None'}</td>
                    {bidders.map(b => {
                      const p = b.prices[i.id]
                      if (p == null) return <td key={b.id} className="px-3 py-2.5 text-right text-xs text-[--color-text-muted]">No bid</td>
                      const above = Number(i.estimated_cost) > 0 && cents(p) > cents(i.estimated_cost)
                      return (
                        <td key={b.id} className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${wonBy(i, b) ? 'bg-emerald-50 font-semibold text-emerald-800' : ''}`}>
                          <span className={above ? 'text-amber-800' : ''}>{fmtCurrency(p)}</span>
                          {cents(p) === lowest && <span className="block text-[10px] font-normal text-[--color-text-muted]">lowest</span>}
                          <Verdict ev={b.evaluation?.[i.id]} />
                        </td>
                      )
                    })}
                    {action && <td className="px-2 py-2 text-right">{action(i)}</td>}
                  </tr>
                )
              })}
              {counted.length > 0 && (
                <tr className="border-t border-[--color-border] bg-[--color-canvas] align-top">
                  <td className="px-3 py-2.5 text-xs font-semibold text-[--color-text-primary]">{headed ? `${lot.name} total` : 'Total'}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums whitespace-nowrap text-[--color-text-secondary]">{budget > 0 ? fmtCurrency(budget / 100) : ''}</td>
                  {bidders.map((b, n) => {
                    const total = totals[n]
                    if (total == null) return <td key={b.id} className="px-3 py-2.5 text-right text-[11px] text-[--color-text-muted]">Not all items</td>
                    const recommended = pending.length > 0 && lot.recommended_bidder_id === b.id
                    const won = !pending.length && counted.every(i => wonBy(i, b))
                    const chosen = choosing && pick[lot.label] === b.id
                    const over = budget > 0 && total > budget
                    const amount = (
                      <span className={`inline-flex items-center gap-1 tabular-nums font-semibold ${over ? 'text-red-700' : chosen || won ? 'text-emerald-800' : 'text-[--color-text-primary]'}`}>
                        {recommended && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Recommended" />}
                        {won && <Check className="size-3.5 shrink-0" aria-label="Winner" />}
                        {fmtCurrency(total / 100)}
                      </span>
                    )
                    return (
                      <td key={b.id} className={`px-3 py-2 text-right whitespace-nowrap ${chosen || won ? 'bg-emerald-50' : ''}`}>
                        {choosing ? (
                          <label className="inline-flex cursor-pointer items-center gap-1.5">
                            <input type="radio" name={`winner-${lot.label || '-'}`} checked={chosen} onChange={() => onPick(lot, b.id)}
                              aria-label={`${b.name} wins ${lot.name}`} className="size-4 accent-emerald-600 shrink-0" />
                            {amount}
                          </label>
                        ) : amount}
                        {total === low && complete.length > 1 && <span className="block text-[10px] font-normal text-[--color-text-muted]">lowest total</span>}
                        {over && <span className="block text-[10px] font-normal text-red-700">above the budget</span>}
                      </td>
                    )
                  })}
                  {action && <td />}
                </tr>
              )}
              {lotNote && pending.length > 0 && (() => {
                const note = lotNote(lot)
                return note ? <tr><td colSpan={cols} className="px-3 pb-3 pt-1">{note}</td></tr> : null
              })()}
            </tbody>
          )
        })}
        {(remarks.some(r => r.length) || rePr) && (
          <tbody className="border-t-2 border-[--color-border]">
            {remarks.some(r => r.length) && (
              <tr className="align-top">
                <td colSpan={2} className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">Remarks</td>
                {bidders.map((b, n) => (
                  <td key={b.id} className="px-3 py-2.5 text-right text-[11px] leading-snug">
                    {remarks[n].map(r => (
                      <span key={r.label} className="block">
                        <span className={`font-semibold ${r.tone}`}>{r.label}</span>
                        {r.text && <span className="block text-[--color-text-secondary]">{r.text}</span>}
                      </span>
                    ))}
                  </td>
                ))}
                {action && <td />}
              </tr>
            )}
            {rePr && (
              <tr className="border-t border-[--color-border] bg-amber-50">
                <td colSpan={cols} className="px-3 py-2.5 text-xs text-amber-900">
                  <span className="font-semibold">Re-PR:</span> {rePr.type ? `${rePr.type}. ` : ''}{rePr.reason}
                  {rePr.note && <span className="block">The BAC adds: {rePr.note}</span>}
                </td>
              </tr>
            )}
          </tbody>
        )}
      </table>
    </div>
  )
}

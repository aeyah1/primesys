import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Trophy, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency, fmtDate } from '@/lib/utils'
import api from '@/lib/axios'
import { cents, lineCents, useRefreshAwards } from './supplier'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/* Awards the items still needing an award from the quotations: each item to
   one supplier (the lowest price is chosen at first; picking another needs a
   reason), or left for later. Each supplier gets one award, which can't
   exceed the approved budget of its items. pr: { id, pr_number };
   items / quotations: from the canvass. */
export default function AwardFromQuotesDialog({ pr, items, quotations, open, onClose }) {
  const prId = String(pr.id)
  const refresh = useRefreshAwards(prId)
  const pending = items.filter(i => i.state === 'pending')
  // Only quotations that price something still to award.
  const quotes = quotations.filter(q => pending.some(i => q.prices[i.id] != null))
  const priceOf = (q, i) => (q.prices[i.id] != null ? cents(q.prices[i.id]) : null)
  const lowestOf = Object.fromEntries(pending.map(i => {
    const offered = quotes.map(q => priceOf(q, i)).filter(p => p != null)
    return [i.id, offered.length ? Math.min(...offered) : null]
  }))

  const [choice, setChoice] = useState({})   // item id → quotation id, or '' (not now)
  const [reason, setReason] = useState('')
  // Each opening starts with the lowest quotation for each item (the first on a tie).
  useEffect(() => {
    if (!open) return
    setChoice(Object.fromEntries(pending.map(i => [i.id, quotes.find(q => priceOf(q, i) != null && priceOf(q, i) === lowestOf[i.id])?.id ?? ''])))
    setReason('')
  }, [open])

  const chosen = pending.filter(i => choice[i.id])
  const notLowest = chosen.filter(i => priceOf(quotes.find(q => q.id === choice[i.id]), i) > lowestOf[i.id])
  // Each supplier's award: amount at the quoted prices vs the items' approved budget.
  const awards = quotes.map(q => {
    const mine = chosen.filter(i => choice[i.id] === q.id)
    const amount = mine.reduce((s, i) => s + lineCents(i.quantity, q.prices[i.id]), 0)
    const budget = mine.reduce((s, i) => s + lineCents(i.quantity, i.estimated_cost), 0)
    return { q, items: mine.length, amount, budget, over: budget > 0 && amount > budget }
  })
  const overBudget = awards.filter(a => a.items && a.over)

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post(`/canvass/${prId}/award`, body),
    onSuccess: ({ data }) => {
      toast.success(`${plural(data.lots.length, 'award')} recorded: ${data.lots.map(l => l.awarded_to).join(', ')}`)
      refresh()
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to record the awards'),
  })
  const canSave = chosen.length > 0 && !overBudget.length && (!notLowest.length || !!reason.trim()) && !isPending
  const submit = () => {
    if (!canSave) return
    mutate({ picks: chosen.map(i => ({ item: i.id, quotation: choice[i.id] })), reason: reason.trim() || undefined })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Award from Quotations" description={`${pr.pr_number}: choose the supplier for each item`} className="max-w-5xl">
        <div className="space-y-5">
          <p className="text-xs text-[--color-text-muted]">
            The lowest price is chosen for each item. Each supplier chosen gets one award and later its own purchase order.
            Choose "Not now" to leave an item for a later award.
          </p>

          <div className="rounded-lg border border-[--color-border] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[--color-canvas] text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                  <th className="px-3 py-2.5 text-left">Item</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Budget / unit</th>
                  {quotes.map(q => (
                    <th key={q.id} className="px-3 py-2.5 text-right min-w-32">
                      <span className="block normal-case tracking-normal text-[--color-text-primary]">{q.supplier_name}</span>
                      {q.quoted_at && <span className="block text-[10px] font-medium normal-case tracking-normal text-[--color-text-muted]">{fmtDate(q.quoted_at)}</span>}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-center whitespace-nowrap">Not now</th>
                </tr>
              </thead>
              <tbody>
                {pending.map(i => (
                  <tr key={i.id} className="border-t border-[--color-border]">
                    <td className="px-3 py-2.5 min-w-48">
                      <p className="text-[--color-text-primary]">{i.item_name}</p>
                      <p className="text-xs text-[--color-text-muted]">{Number(i.quantity)} {i.unit || ''}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[--color-text-secondary] whitespace-nowrap">
                      {Number(i.estimated_cost) > 0 ? fmtCurrency(i.estimated_cost) : 'None'}
                    </td>
                    {quotes.map(q => {
                      const p = priceOf(q, i)
                      if (p == null) return <td key={q.id} className="px-3 py-2.5 text-right text-xs text-[--color-text-muted]">Not quoted</td>
                      const selected = choice[i.id] === q.id
                      return (
                        <td key={q.id} className="px-2 py-1.5 text-right">
                          <label className={`inline-flex items-center justify-end gap-2 rounded-md border px-2 py-1.5 cursor-pointer transition-colors ${
                            selected ? 'border-[--color-brand] bg-[--color-brand-light]' : 'border-transparent hover:border-[--color-border-strong]'
                          }`}>
                            <input type="radio" name={`item-${i.id}`} checked={selected} onChange={() => setChoice(c => ({ ...c, [i.id]: q.id }))}
                              className="size-3.5 accent-[--color-brand]" />
                            <span className="text-right">
                              <span className={`block tabular-nums ${selected ? 'font-semibold text-[--color-text-primary]' : 'text-[--color-text-secondary]'}`}>{fmtCurrency(p / 100)}</span>
                              {p === lowestOf[i.id] && <span className="block text-[10px] font-semibold text-emerald-700">Lowest</span>}
                              {Number(i.estimated_cost) > 0 && p > cents(i.estimated_cost) && <span className="block text-[10px] font-medium text-amber-700">Above budget</span>}
                            </span>
                          </label>
                        </td>
                      )
                    })}
                    <td className="px-3 py-2.5 text-center">
                      <input type="radio" name={`item-${i.id}`} checked={!choice[i.id]} onChange={() => setChoice(c => ({ ...c, [i.id]: '' }))}
                        className="size-3.5 accent-[--color-brand]" aria-label={`Leave ${i.item_name} for later`} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[--color-border] bg-[--color-canvas] align-top">
                  <td colSpan={2} className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">Each supplier's award</td>
                  {awards.map(a => (
                    <td key={a.q.id} className="px-3 py-2.5 text-right">
                      {a.items ? (
                        <>
                          <p className={`font-bold tabular-nums ${a.over ? 'text-red-700' : 'text-[--color-text-primary]'}`}>{fmtCurrency(a.amount / 100)}</p>
                          <p className="text-[10px] text-[--color-text-muted]">{plural(a.items, 'item')}{a.budget > 0 && `, budget ${fmtCurrency(a.budget / 100)}`}</p>
                        </>
                      ) : <p className="text-xs text-[--color-text-muted]">None</p>}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {overBudget.map(a => (
            <p key={a.q.id} className="flex items-start gap-1.5 text-xs font-medium text-red-700">
              <AlertTriangle className="size-3.5 shrink-0 mt-px" />
              The award to {a.q.supplier_name} ({fmtCurrency(a.amount / 100)}) is above the approved budget for its items ({fmtCurrency(a.budget / 100)}). Choose another supplier for some items.
            </p>
          ))}

          {notLowest.length > 0 && (
            <div className="space-y-1.5">
              <Label>Why not the lowest price? <span className="text-red-600 text-xs">*</span></Label>
              <p className="text-xs text-[--color-text-muted]">
                {notLowest.map(i => i.item_name).join(', ')} {notLowest.length === 1 ? 'goes' : 'go'} to a supplier who isn't the lowest. The reason is kept with the award.
              </p>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500}
                placeholder="e.g. The lowest offer did not meet the specifications"
                className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y" />
            </div>
          )}
        </div>

        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!canSave} onClick={submit} className="gap-2">
            <Trophy className="size-3.5" />
            {isPending ? 'Saving…' : `Award ${plural(chosen.length, 'item')}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

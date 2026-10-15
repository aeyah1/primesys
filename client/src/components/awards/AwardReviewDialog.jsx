import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ShieldCheck, ShieldOff, Star, AlertTriangle, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'
import { lineCents } from './supplier'

/* The BAC's last look before it awards: each lot's winner with its items, prices and total against the
   lot's budget, whether that is the recommended bid (with the BAC's remark), whether the TWG certified the
   bids or was skipped, what the award is recorded on, and the grand total. Nothing is awarded until
   Confirm award. chosen: BacAwardSheet's picks ({ lot, bidder, total, budget }); reasons: remark by lot label. */
export default function AwardReviewDialog({ prId, chosen, reasons, notes, doc, skipped, pending, onConfirm, onClose }) {
  const { data: bac } = useQuery({
    queryKey: ['bac', 'pr', prId],
    queryFn: () => api.get(`/bac/${prId}`).then(r => r.data),
    enabled: !skipped,
  })
  const cert = bac?.certificates?.filter(c => c.kind === 'bids').at(-1)
  const awarded = chosen.reduce((s, c) => s + c.total, 0)
  const budget = chosen.reduce((s, c) => s + c.budget, 0)
  const CELL = 'px-3 py-2 text-right tabular-nums whitespace-nowrap'

  return (
    <Dialog open onOpenChange={v => { if (!v && !pending) onClose() }}>
      <DialogContent className="max-w-3xl" title="Review the Award"
        description="Check every lot before you confirm. The winners are then recorded and Procurement issues the purchase orders.">
        <div className="space-y-4">
          <p className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${skipped ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-teal-300 bg-teal-50 text-teal-900'}`}>
            {skipped ? <ShieldOff className="size-3.5 shrink-0 mt-px" /> : <ShieldCheck className="size-3.5 shrink-0 mt-px" />}
            {skipped
              ? 'Not evaluated by the TWG: the canvass went straight to the award, so no TWG certificate is issued.'
              : `Certified by the TWG${cert ? `, Cert. No. ${cert.cert_no}` : ''}.`}
          </p>

          <div className="rounded-xl border border-[--color-border] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5 text-right">Qty</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Unit price</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              {chosen.map(c => {
                const recommended = c.bidder.id === c.lot.recommended_bidder_id
                const remark = reasons[c.lot.label]?.trim()
                return (
                  <tbody key={c.lot.label} className="border-t border-[--color-border-strong]">
                    <tr className="bg-[--color-canvas]">
                      <td colSpan={4} className="px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-[--color-text-primary]">{c.lot.name}: {c.bidder.name}</span>
                          {recommended
                            ? <span className="flex items-center gap-1 text-[11px] font-medium text-[--color-text-secondary]"><Star className="size-3 fill-amber-400 text-amber-500" /> Recommended</span>
                            : <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700"><AlertTriangle className="size-3" /> Not the recommended bid</span>}
                        </div>
                        {remark && <p className="mt-0.5 text-xs text-[--color-text-secondary]">Remarks: {remark}</p>}
                      </td>
                    </tr>
                    {c.lot.pending.map(i => (
                      <tr key={i.id} className="border-t border-[--color-border]">
                        <td className="px-3 py-2 text-[--color-text-primary]">{i.item_name}</td>
                        <td className={`${CELL} text-[--color-text-secondary]`}>{Number(i.quantity)} {i.unit}</td>
                        <td className={`${CELL} text-[--color-text-secondary]`}>{fmtCurrency(c.bidder.prices[i.id])}</td>
                        <td className={`${CELL} text-[--color-text-primary]`}>{fmtCurrency(lineCents(i.quantity, c.bidder.prices[i.id]) / 100)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[--color-border]">
                      <td colSpan={3} className="px-3 py-2 text-right text-xs text-[--color-text-secondary]">
                        {c.lot.name} total, of a {fmtCurrency(c.budget / 100)} budget
                      </td>
                      <td className={`${CELL} font-semibold text-[--color-text-primary]`}>{fmtCurrency(c.total / 100)}</td>
                    </tr>
                  </tbody>
                )
              })}
            </table>
          </div>

          <p className="text-right text-sm text-[--color-text-secondary]">
            To award <span className="font-semibold tabular-nums text-[--color-text-primary]">{fmtCurrency(awarded / 100)}</span>
            {' '}of a {fmtCurrency(budget / 100)} budget
            {budget > awarded && <span className="text-emerald-700">, {fmtCurrency((budget - awarded) / 100)} under</span>}
          </p>
          {doc && (
            <p className="flex items-start gap-2 text-xs text-[--color-text-secondary]">
              <FileText className="size-3.5 shrink-0 mt-0.5 text-[--color-text-muted]" />
              {doc.kind === 'abstract'
                ? 'Recorded on the Abstract of sealed Quotations, with no BAC Resolution (approved budget below the resolution threshold).'
                : 'Adopted in a numbered BAC Resolution.'}
            </p>
          )}
          {notes.trim() && <p className="text-xs text-[--color-text-secondary]"><span className="font-semibold text-[--color-text-primary]">Notes:</span> {notes.trim()}</p>}
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={pending}>Go back</Button>
          <Button className="gap-1.5" onClick={onConfirm} disabled={pending}>
            <CheckCircle2 className="size-3.5" /> {pending ? 'Awarding…' : 'Confirm award'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

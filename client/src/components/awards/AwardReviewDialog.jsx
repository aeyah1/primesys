import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ShieldCheck, ShieldOff, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'
import { lineCents } from './supplier'

/* Procurement's last look before it records the BAC's award: each lot's winner with its items, prices and total
   against the lot's budget, the criteria the BAC applied (with its remark), whether the TWG certified the
   bids or was skipped, what the award is recorded on, and the grand total. Nothing is recorded until
   Confirm award. chosen: BacAwardSheet's picks ({ lot, bidder, total, budget, criteria }); reasons: remark by lot label. */
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
      <DialogContent className="max-w-3xl" title="Review the award"
        description="Check every lot against the BAC's decision before you confirm. The winners are then recorded and the purchase orders can be issued.">
        <div className="space-y-4">
          <p className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${skipped ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-blue-300 bg-blue-50 text-blue-900'}`}>
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
                const remark = reasons[c.lot.label]?.trim()
                return (
                  <tbody key={c.lot.label} className="border-t border-[--color-border-strong]">
                    <tr className="bg-[--color-canvas]">
                      <td colSpan={4} className="px-3 py-2">
                        <span className="font-semibold text-[--color-text-primary]">{c.lot.name}: {c.bidder.name}</span>
                        <p className="mt-0.5 text-xs text-[--color-text-secondary]">Basis: {c.criteria.join('; ')}</p>
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
            <CheckCircle2 className="size-3.5" /> {pending ? 'Recording…' : 'Confirm award'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

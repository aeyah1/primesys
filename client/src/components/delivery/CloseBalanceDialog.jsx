import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'
import { TEXTAREA, hundredths, qty, useRefreshDeliveries } from './shared'

/* The supplier can't deliver the rest of a partly delivered PO: what arrived
   is kept and paid for, the rest is not paid, and the undelivered items go
   back to canvass (server/utils/shortDelivery.js). */
export default function CloseBalanceDialog({ poId, onClose }) {
  const refresh = useRefreshDeliveries()
  const [reason, setReason] = useState('')
  const [value, setValue]   = useState('')
  const { data: po } = useQuery({
    queryKey: ['po-detail', String(poId)],
    queryFn:  () => api.get(`/po/${poId}`).then(r => r.data),
  })
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.patch(`/po/${poId}/close`, {
      reason: reason.trim(), ...(priced ? {} : { short_amount: value }),
    }),
    onSuccess: ({ data }) => {
      toast.success(`${data.message}. ${data.balances.length ? 'The undelivered items are back under canvass.' : ''}`)
      refresh(); onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to close the purchase order'),
  })

  const owed   = (po?.items || []).filter(l => l.remaining > 0)
  const priced = owed.every(l => l.unit_price != null)
  const cents  = priced ? owed.reduce((s, l) => s + Math.round(hundredths(l.remaining) * Number(l.unit_price)), 0) : null
  const ready  = reason.trim() && (priced || Number(value) > 0)

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Close the Undelivered Balance" description={po ? `${po.po_number} · ${po.supplier_name}` : 'Loading…'} className="max-w-2xl">
        {!po ? (
          <div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[--color-text-secondary]">
              Use this when the supplier can't deliver the rest. What arrived is kept and paid for; the items below are not paid,
              and they go back to canvass, then to the BAC and the TWG, for a new award. This can't be undone.
            </p>

            <div className="rounded-lg border border-[--color-border] overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[--color-canvas] text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                    <th className="px-3 py-2 text-left">Not delivered</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">Ordered</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">Received</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {owed.map(l => (
                    <tr key={l.id} className="border-t border-[--color-border]">
                      <td className="px-3 py-2 text-[--color-text-primary]">{l.item_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty(l.ordered)} {l.unit || ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[--color-text-secondary]">{qty(l.received)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{qty(l.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {priced ? (
              <p className="text-sm text-[--color-text-primary]">Value not delivered (not paid): <strong>{fmtCurrency(cents / 100)}</strong></p>
            ) : (
              <div className="space-y-1.5">
                <Label>Value not delivered (not paid) <span className="text-red-600 text-xs">*</span></Label>
                <Input type="number" min="0.01" step="0.01" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} className="w-48"
                  placeholder="e.g. 900.00" />
                <p className="text-[11px] text-[--color-text-muted]">This award has no unit prices, so enter the value of what wasn't delivered.</p>
              </div>
            )}

            {po.late && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                <span>
                  {po.late.days_late} days late. The penalty (1/10 of 1% of the undelivered value per day) is worked out and recorded when
                  you close{po.late.amount != null ? `: ${fmtCurrency(po.late.amount)} as of today` : ''}. The Accounting office deducts it from the payment.
                </span>
              </p>
            )}

            <p className="text-xs text-[--color-text-muted]">{po.supplier_name} can't be awarded these items again.</p>

            <div className="space-y-1.5">
              <Label>Reason <span className="text-red-600 text-xs">*</span></Label>
              <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000}
                placeholder="e.g. Supplier has only 40 in stock and can't get the rest" className={TEXTAREA} />
            </div>
          </div>
        )}
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Keep waiting</Button>
          <Button variant="danger" onClick={() => mutate()} disabled={isPending || !po || !ready}>
            {isPending ? 'Closing…' : 'Close the balance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency, fmtDate, plural } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'
import { lineCents, useRefreshAwards } from './supplier'
import BidsTable from './BidsTable'
import AwardList from './AwardList'

/* ── Drop an item that can't be procured, with the reason (the BAC's) ──── */
export function DropItemDialog({ prId, item, onClose }) {
  const refresh = useRefreshAwards(prId)
  const [reason, setReason] = useState('')
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/canvass/${prId}/items/${item.id}/drop`, { reason: reason.trim() }),
    onSuccess: () => { toast.success(`${item.item_name} dropped`); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to drop the item'),
  })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Drop an Item">
        <div className="space-y-3">
          <p className="text-sm text-[--color-text-secondary]">
            <span className="font-semibold text-[--color-text-primary]">{item.item_name}</span> leaves this procurement, so the PR can go on
            without it. It can be brought back until the PR is completed.
          </p>
          <div className="space-y-1.5">
            <Label>Reason <span className="text-red-600 text-xs">*</span></Label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500} autoFocus
              placeholder="e.g. No supplier could offer it within the budget"
              className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y" />
          </div>
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Keep it</Button>
          <Button variant="danger" disabled={isPending || !reason.trim()} onClick={() => mutate()}>
            {isPending ? 'Dropping…' : 'Drop Item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ItemStatus({ item }) {
  if (item.state === 'awarded') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
        {item.awarded_to ? `${item.awarded_to}${item.lot_number ? `, ${item.lot_number}` : ''}` : 'Awarded (whole PR)'}
        {item.awarded_price != null && <span className="font-normal">at {fmtCurrency(item.awarded_price)}</span>}
      </span>
    )
  }
  if (item.state === 'dropped') {
    return (
      <span className="inline-block rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
        <span className="font-semibold">Dropped</span>{item.drop_reason ? `: ${item.drop_reason}` : ''}
        {item.dropped_by_name && <span className="block text-[10px] text-slate-500">by {item.dropped_by_name}, {fmtDate(item.dropped_at)}</span>}
      </span>
    )
  }
  return <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Needs a winner</span>
}

/* A PR's canvass, read only (pages/pr/CanvassPage.jsx; the BAC enters the
   bids on BacBidSheet): each item and its winner, every bid the BAC entered,
   then the awards by supplier. pr: { id, pr_number, title, status }. */
export default function CanvassPanel({ pr }) {
  const prId = String(pr.id)
  const { user } = useAuth()
  const canManage = ['admin', 'procurement'].includes(user?.role)
  const refresh = useRefreshAwards(prId)

  const { data: canvass, isLoading } = useQuery({
    queryKey: ['canvass', prId],
    queryFn:  () => api.get(`/canvass/${prId}`).then(r => r.data),
  })
  const { data: lots = [] } = useQuery({
    queryKey: ['lots', prId],
    queryFn:  () => api.get(`/lots/pr/${prId}`).then(r => r.data),
  })
  const { mutate: restore } = useMutation({
    mutationFn: (item) => api.post(`/canvass/${prId}/items/${item.id}/restore`),
    onSuccess: () => { toast.success('Item brought back to canvass'); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to bring the item back'),
  })

  if (isLoading || !canvass) return <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>

  const { items, permissions: can } = canvass
  const awarded  = items.filter(i => i.state === 'awarded').length
  const dropped  = items.filter(i => i.state === 'dropped').length
  const suppliers = new Set(lots.filter(l => l.status === 'awarded').map(l => l.awarded_to.trim().toLowerCase())).size

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[--color-text-secondary]">
          <span className="font-semibold text-[--color-text-primary]">{awarded} of {items.length - dropped}</span> items have their winner
          {dropped > 0 && `, ${dropped} dropped`}
          {suppliers > 0 && `, from ${plural(suppliers, 'supplier')}`}
        </p>
      </div>

      {items.length > 0 && (
        <div className="rounded-xl border border-[--color-border] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                <th className="px-3 py-2.5">Item</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Qty</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Budget</th>
                <th className="px-3 py-2.5">Winner</th>
                {can.restore && <th className="px-3 py-2.5 w-10" />}
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className="border-t border-[--color-border] align-top">
                  <td className="px-3 py-2.5 min-w-40 text-[--color-text-primary]">
                    {i.group_label && <span className="text-[--color-text-muted]">{i.group_label}: </span>}
                    <span className={i.state === 'dropped' ? 'line-through text-[--color-text-muted]' : ''}>{i.item_name}</span>
                    {i.balance_of && (
                      <span className="ml-1.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                        title="The undelivered quantity of an earlier award, back for a new canvass">Balance</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{Number(i.quantity)} {i.unit || ''}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[--color-text-secondary] whitespace-nowrap">
                    {Number(i.estimated_cost) > 0 ? fmtCurrency(lineCents(i.quantity, i.estimated_cost) / 100) : 'None'}
                  </td>
                  <td className="px-3 py-2.5"><ItemStatus item={i} /></td>
                  {can.restore && (
                    <td className="px-2 py-1.5 text-right">
                      {i.state === 'dropped' && can.restore && (
                        <button onClick={() => restore(i)} title="Bring it back to canvass"
                          className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors">
                          <Undo2 className="size-3.5" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canvass.bidders.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">Every bid</p>
          <BidsTable canvass={canvass} />
        </div>
      )}

      <AwardList lots={lots} canManage={canManage} prStatus={pr.status} />

    </div>
  )
}

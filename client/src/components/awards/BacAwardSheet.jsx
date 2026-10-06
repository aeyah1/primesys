import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Ban, CheckCircle2, Undo2, AlertTriangle, Star } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency } from '@/lib/utils'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import api from '@/lib/axios'
import { lineCents, totalOf, lotsWithItems, useRefreshAwards } from './supplier'
import BidsTable from './BidsTable'
import CanvassFiles from './CanvassFiles'
import { DropItemDialog } from './CanvassPanel'

const TEXTAREA = 'w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y'

// The BAC takes a certified canvass back to correct its bids, with the reason.
function ReopenDialog({ prId, onClose }) {
  const refresh = useRefreshAwards(prId)
  const [reason, setReason] = useState('')
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/canvass/${prId}/reopen`, { reason: reason.trim() }),
    onSuccess: ({ data }) => { toast.success(data.message); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to take the canvass back'),
  })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Take the Canvass Back"
        description="The bids can be corrected, or new suppliers' quotations added, then the canvass goes back to the TWG. Bids left unchanged keep the TWG's marks.">
        <div className="space-y-1.5">
          <Label>Reason <span className="text-red-600 text-xs">*</span></Label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500} autoFocus className={TEXTAREA}
            placeholder="e.g. A price was entered wrong from the RFQ" />
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="danger" disabled={isPending || !reason.trim()} onClick={() => mutate()}>{isPending ? 'Saving…' : 'Take it back'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* The BAC's award once the TWG has certified the bids, a lot at a time: each
   lot goes to one supplier that bid on all of it. The system recommends the
   lowest total of the bidders the TWG found compliant on the whole lot and
   picks it to start with; the BAC may pick another compliant one (a reason is optional,
   and is noted on the award), never one the TWG found non-compliant on an item of the lot.
   A lot's award can't exceed its approved budget.
   Award adopts a BAC Resolution; the request is then Ready for PO.
   pr: { id }; canvass: GET /canvass/:prId. */
export default function BacAwardSheet({ pr, canvass }) {
  const prId = String(pr.id)
  const confirm = useConfirm()
  const refresh = useRefreshAwards(prId)
  const { bidders } = canvass
  const lots = lotsWithItems(canvass).map(l => ({ ...l, pending: l.items.filter(i => i.state === 'pending') })).filter(l => l.pending.length)
  const [picks, setPicks] = useState(() => Object.fromEntries(lots.map(l => [l.label, l.recommended_bidder_id])))
  const [reasons, setReasons] = useState({})
  const [notes, setNotes] = useState('')
  const [dropping, setDropping] = useState(null)
  const [reopening, setReopening] = useState(false)

  // Each lot's pick, its total, its budget (as the server checks them), the item the TWG found the pick
  // non-compliant on, and the bids that could be awarded it: those on the whole lot, compliant, within its
  // budget, the recommended one first, then the cheapest.
  const failedOn = (b, l) => l.pending.find(i => b.evaluation?.[i.id]?.compliant === false)
  const chosen = lots.map(l => {
    const budget = l.pending.reduce((s, i) => s + lineCents(i.quantity, i.estimated_cost), 0)
    const bidder = bidders.find(b => b.id === picks[l.label])
    const total = bidder ? totalOf(bidder, l.pending) : null
    const within = bidders.filter(b => !failedOn(b, l)).map(b => ({ b, total: totalOf(b, l.pending) }))
      .filter(x => x.total != null && !(budget > 0 && x.total > budget))
      .sort((a, b) => (b.b.id === l.recommended_bidder_id) - (a.b.id === l.recommended_bidder_id) || a.total - b.total)
    return { lot: l, bidder: total != null ? bidder : null, total, budget, within, over: total != null && budget > 0 && total > budget,
      failed: total != null ? failedOn(bidder, l) : null }
  })
  const unpicked = chosen.find(c => !c.bidder)
  const failing = chosen.find(c => c.failed)
  const over = chosen.find(c => c.bidder && c.over)
  const block = (unpicked && (unpicked.lot.recommended_bidder_id
      ? `Pick the supplier of ${unpicked.lot.name}, or drop its items if no bid can be awarded.`
      : `No supplier is compliant on all of ${unpicked.lot.name}. Drop a non-compliant item, or take it back to the canvass for new quotations.`))
    || (failing && `The TWG found ${failing.bidder.name}'s offer for "${failing.failed.item_name}" non-compliant, so it can't be awarded ${failing.lot.name}. Pick a compliant supplier, drop the item, or take it back to the canvass.`)
    || (over && (over.within.length
      ? `${over.bidder.name}'s total for ${over.lot.name} is above its approved budget. Pick a bid within it, such as ${over.within[0].b.name} (${fmtCurrency(over.within[0].total / 100)}).`
      : `Every bid for ${over.lot.name} is above its approved budget (${fmtCurrency(over.budget / 100)}). Drop an item, or take it back to the canvass.`))
  const awarded = chosen.reduce((s, c) => s + (c.total || 0), 0)
  const budget = chosen.reduce((s, c) => s + c.budget, 0)

  // Under a lot: a pick the TWG found non-compliant, or above its budget, can't be awarded, so it says so
  // instead of asking for a reason; a pick other than the recommended one says why it stands out, with the BAC's reason.
  const lotNote = (lot) => {
    const c = chosen.find(x => x.lot.label === lot.label)
    if (c?.failed) {
      return (
        <p className="flex items-center gap-1 text-[11px] font-medium text-red-700">
          <AlertTriangle className="size-3 shrink-0" />
          The TWG found {c.bidder.name}'s offer for "{c.failed.item_name}" non-compliant
          {c.bidder.evaluation[c.failed.id].remarks ? ` (${c.bidder.evaluation[c.failed.id].remarks})` : ''}, so it can't be awarded.
        </p>
      )
    }
    if (c?.bidder && c.over) {
      return (
        <p className="flex items-center gap-1 text-[11px] font-medium text-red-700">
          <AlertTriangle className="size-3 shrink-0" />
          {fmtCurrency((c.total - c.budget) / 100)} over this lot's approved budget ({fmtCurrency(c.budget / 100)}), so it can't be awarded.
        </p>
      )
    }
    if (!c?.bidder || c.bidder.id === lot.recommended_bidder_id) return null
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1 text-[11px] text-amber-700">
          <AlertTriangle className="size-3 shrink-0" />
          Not the recommended bid.
        </p>
        <Input value={reasons[lot.label] || ''} maxLength={500} placeholder="Reason (optional)" aria-label={`Why ${lot.name} goes to ${c.bidder.name}`}
          onChange={e => setReasons(r => ({ ...r, [lot.label]: e.target.value }))} className="h-8 max-w-md flex-1 text-xs" />
      </div>
    )
  }

  const { mutate: award, isPending } = useMutation({
    mutationFn: () => api.post(`/canvass/${prId}/award`, {
      winners: chosen.map(c => ({ lot: c.lot.label, bidder_id: c.bidder.id, reason: reasons[c.lot.label]?.trim() || undefined })),
      notes: notes.trim() || undefined,
    }),
    onSuccess: ({ data }) => { toast.success(data.message); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'The award could not be made'),
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-5">
        <section className="space-y-3 2xl:col-span-3">
          <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">Pick each lot's winner</h3>
          <p className="text-xs text-[--color-text-secondary]">
            Each lot goes to one supplier that bid on all of it. <Star className="inline size-3 -mt-0.5 fill-amber-400 text-amber-500" /> marks
            the system's recommendation, the lowest total of the bidders compliant on the whole lot. You may pick any of them, but not a supplier the TWG found non-compliant on an item of the lot.
          </p>
          <BidsTable canvass={canvass} pick={picks} onPick={(lot, id) => setPicks(x => ({ ...x, [lot.label]: id }))} lotNote={lotNote}
            action={(i) => i.state === 'pending' && (
              <button type="button" onClick={() => setDropping(i)} title="Drop this item (no bid can be awarded)"
                className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors">
                <Ban className="size-3.5" />
              </button>
            )} />
          {lots.length > 0 && (
            <p className="text-right text-sm text-[--color-text-secondary]">
              To award <span className="font-semibold tabular-nums text-[--color-text-primary]">{fmtCurrency(awarded / 100)}</span>
              {' '}of a {fmtCurrency(budget / 100)} budget
              {awarded > 0 && budget > 0 && <span className={awarded > budget ? 'text-red-700' : 'text-emerald-700'}>, {fmtCurrency(Math.abs(budget - awarded) / 100)} {awarded > budget ? 'over' : 'under'}</span>}
            </p>
          )}
        </section>

        <div className="2xl:col-span-2"><CanvassFiles prId={prId} /></div>
      </div>

      <section className="space-y-3 rounded-xl border border-[--color-border] bg-[--color-surface] px-4 py-4 shadow-sm">
        <div className="space-y-1.5">
          <Label htmlFor="award-notes">Notes on the resolution <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span></Label>
          <textarea id="award-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={2000} className={TEXTAREA}
            placeholder="e.g. Lowest calculated and responsive offers" />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {block && <p className="mr-auto flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="size-3.5 shrink-0" /> {block}</p>}
          <Button variant="secondary" className="gap-1.5" disabled={isPending} onClick={() => setReopening(true)}>
            <Undo2 className="size-3.5" /> Take back to the canvass
          </Button>
          <Button className="gap-1.5" disabled={isPending || !!block}
            onClick={async () => {
              if (await confirm({ title: 'Award the canvass?', message: 'The winners are adopted in a BAC Resolution and Procurement issues the purchase orders.', confirmLabel: 'Award' })) award()
            }}>
            <CheckCircle2 className="size-3.5" /> {isPending ? 'Awarding…' : 'Award'}
          </Button>
        </div>
      </section>

      {dropping && <DropItemDialog prId={prId} item={dropping} onClose={() => setDropping(null)} />}
      {reopening && <ReopenDialog prId={prId} onClose={() => setReopening(false)} />}
    </div>
  )
}

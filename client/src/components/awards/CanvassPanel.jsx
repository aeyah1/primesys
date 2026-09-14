import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Trophy, FilePlus, Pencil, Trash2, Lock, Ban, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency, fmtDate } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'
import { SectionTitle, lineCents, useRefreshAwards } from './supplier'
import QuotationDialog from './QuotationDialog'
import AwardFromQuotesDialog from './AwardFromQuotesDialog'
import RecordAwardDialog from './RecordAwardDialog'
import AwardList from './AwardList'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/* ── Drop an item that can't be procured, with the reason ─────────────── */
function DropItemDialog({ prId, item, onClose }) {
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
  return <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Needs award</span>
}

/* The canvass of one PR: its items and where each stands, the suppliers'
   quotations, the award actions, and the awards by supplier. Used on the PR
   page and in Lots & Awards. pr: { id, pr_number, title, status }. */
export default function CanvassPanel({ pr }) {
  const prId = String(pr.id)
  const { user } = useAuth()
  const canManage = ['admin', 'procurement'].includes(user?.role)
  const refresh = useRefreshAwards(prId)
  const [quote, setQuote]         = useState(null)    // { quotation } while the quotation dialog is open
  const [fromQuotes, setFromQuotes] = useState(false)
  const [manual, setManual]       = useState(false)
  const [dropping, setDropping]   = useState(null)    // the item being dropped

  const { data: canvass, isLoading } = useQuery({
    queryKey: ['canvass', prId],
    queryFn:  () => api.get(`/canvass/${prId}`).then(r => r.data),
  })
  const { data: lots = [] } = useQuery({
    queryKey: ['lots', prId],
    queryFn:  () => api.get(`/lots/pr/${prId}`).then(r => r.data),
  })

  const { mutate: removeQuote } = useMutation({
    mutationFn: (q) => api.delete(`/canvass/${prId}/quotations/${q.id}`),
    onSuccess: () => { toast.success('Quotation removed'); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove the quotation'),
  })
  const { mutate: restore } = useMutation({
    mutationFn: (item) => api.post(`/canvass/${prId}/items/${item.id}/restore`),
    onSuccess: () => { toast.success('Item brought back to canvass'); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to bring the item back'),
  })

  if (isLoading || !canvass) return <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>

  const { items, quotations, permissions: can } = canvass
  const pending  = items.filter(i => i.state === 'pending')
  const awarded  = items.filter(i => i.state === 'awarded').length
  const dropped  = items.filter(i => i.state === 'dropped').length
  const suppliers = new Set(lots.filter(l => l.status === 'awarded').map(l => l.awarded_to.trim().toLowerCase())).size
  const quotesForPending = quotations.filter(q => pending.some(i => q.prices[i.id] != null))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[--color-text-secondary]">
          <span className="font-semibold text-[--color-text-primary]">{awarded} of {items.length - dropped}</span> items awarded
          {dropped > 0 && `, ${dropped} dropped`}
          {suppliers > 0 && `, from ${plural(suppliers, 'supplier')}`}
        </p>
        {can.canvass && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setQuote({ quotation: null })}>
              <FilePlus className="size-3.5" /> Add Quotation
            </Button>
            {pending.length > 0 && quotesForPending.length > 0 && (
              <Button size="sm" className="gap-1.5" onClick={() => setFromQuotes(true)}>
                <Trophy className="size-3.5" /> Award from Quotations
              </Button>
            )}
            {pending.length > 0 && (
              <Button size="sm" variant={quotesForPending.length ? 'secondary' : 'primary'} className="gap-1.5" onClick={() => setManual(true)}>
                {!quotesForPending.length && <Trophy className="size-3.5" />} Record Award{quotesForPending.length ? ' by Hand' : ''}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* The items and where each stands */}
      {items.length > 0 && (
        <div className="rounded-xl border border-[--color-border] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                <th className="px-3 py-2.5">Item</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Qty</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Budget</th>
                <th className="px-3 py-2.5">Status</th>
                {(can.canvass || can.restore) && <th className="px-3 py-2.5 w-10" />}
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className="border-t border-[--color-border] align-top">
                  <td className="px-3 py-2.5 min-w-40 text-[--color-text-primary]">
                    {i.group_label && <span className="text-[--color-text-muted]">{i.group_label}: </span>}
                    <span className={i.state === 'dropped' ? 'line-through text-[--color-text-muted]' : ''}>{i.item_name}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{Number(i.quantity)} {i.unit || ''}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[--color-text-secondary] whitespace-nowrap">
                    {Number(i.estimated_cost) > 0 ? fmtCurrency(lineCents(i.quantity, i.estimated_cost) / 100) : 'None'}
                  </td>
                  <td className="px-3 py-2.5"><ItemStatus item={i} /></td>
                  {(can.canvass || can.restore) && (
                    <td className="px-2 py-1.5 text-right">
                      {i.state === 'pending' && can.canvass && (
                        <button onClick={() => setDropping(i)} title="Drop this item (it can't be procured)"
                          className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors">
                          <Ban className="size-3.5" />
                        </button>
                      )}
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

      {/* The suppliers' quotations */}
      {quotations.length > 0 ? (
        <div className="space-y-2">
          <SectionTitle>Quotations ({quotations.length})</SectionTitle>
          <div className="rounded-xl border border-[--color-border] divide-y divide-[--color-border]">
            {quotations.map(q => {
              const priced = items.filter(i => q.prices[i.id] != null)
              const total  = priced.reduce((s, i) => s + lineCents(i.quantity, q.prices[i.id]), 0)
              return (
                <div key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[--color-text-primary]">{q.supplier_name}</p>
                    <p className="text-xs text-[--color-text-muted]">
                      {q.quoted_at ? `Quoted ${fmtDate(q.quoted_at)}, ` : ''}{plural(priced.length, 'item')} for {fmtCurrency(total / 100)}
                      {q.notes ? `. ${q.notes}` : ''}
                    </p>
                  </div>
                  {q.locked ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[--color-border-strong] px-2 py-0.5 text-[11px] font-medium text-[--color-text-secondary]"
                      title="An item it prices is awarded, so it is kept as it is for the Abstract of Quotations">
                      <Lock className="size-3" /> Kept on record
                    </span>
                  ) : can.canvass && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => setQuote({ quotation: q })} title="Edit this quotation"
                        className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors">
                        <Pencil className="size-3.5" />
                      </button>
                      <button onClick={() => { if (window.confirm(`Remove ${q.supplier_name}'s quotation?`)) removeQuote(q) }} title="Remove this quotation"
                        className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : can.canvass && pending.length > 0 && (
        <p className="rounded-lg border border-[--color-border] bg-[--color-canvas] px-4 py-3 text-xs text-[--color-text-secondary]">
          Record each supplier's quotation to compare their prices item by item (they appear in the Abstract of Quotations),
          then award each item to the lowest. Different items can go to different suppliers, each with its own purchase order.
        </p>
      )}

      {/* The awards, by supplier */}
      <AwardList lots={lots} canManage={canManage} prStatus={pr.status} />

      {quote && <QuotationDialog pr={pr} items={items} quotation={quote.quotation} open onClose={() => setQuote(null)} />}
      {fromQuotes && <AwardFromQuotesDialog pr={pr} items={items} quotations={quotations} open onClose={() => setFromQuotes(false)} />}
      <RecordAwardDialog pr={pr} open={manual} onClose={() => setManual(false)} />
      {dropping && <DropItemDialog prId={prId} item={dropping} onClose={() => setDropping(null)} />}
    </div>
  )
}

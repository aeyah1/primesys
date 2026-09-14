import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Truck, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDate, localToday } from '@/lib/utils'
import api from '@/lib/axios'
import { hundredths, qty, TEXTAREA, useRefreshDeliveries } from './shared'

/* Records goods that arrived on a purchase order: for a PO with lines, how
   many of each arrived (what is still to come is filled in); for an older PO
   without lines, whether it was all or part. Without `poId`, the PO is chosen
   first from the open ones. */
export default function ReceiveDialog({ poId: givenId, open, onClose }) {
  const refresh = useRefreshDeliveries()
  const today = localToday()
  const [poId, setPoId]     = useState(givenId ? String(givenId) : '')
  const [date, setDate]     = useState(today)
  const [amounts, setAmounts] = useState({})     // line id → quantity arriving now
  const [filledFor, setFilledFor] = useState(null)
  const [status, setStatus] = useState('complete')   // older POs without lines
  const [notes, setNotes]   = useState('')

  // Each opening starts fresh.
  useEffect(() => {
    if (!open) return
    setPoId(givenId ? String(givenId) : ''); setDate(today); setAmounts({}); setFilledFor(null); setStatus('complete'); setNotes('')
  }, [open])

  const { data: openPOs = [] } = useQuery({
    queryKey: ['po-list', 'to-receive'],
    queryFn:  () => api.get('/po?view=open&limit=200').then(r => r.data.data),
    enabled:  open && !givenId,
  })
  const { data: po } = useQuery({
    queryKey: ['po-detail', poId],
    queryFn:  () => api.get(`/po/${poId}`).then(r => r.data),
    enabled:  open && !!poId,
  })
  // Once the PO loads, everything still to come is filled in.
  useEffect(() => {
    if (open && po && filledFor !== po.id) {
      setAmounts(Object.fromEntries((po.items || []).filter(l => l.remaining > 0).map(l => [l.id, qty(l.remaining)])))
      setFilledFor(po.id)
    }
  }, [open, po, filledFor])

  const lines   = po?.has_lines ? po.items : []
  const entered = lines.filter(l => hundredths(amounts[l.id]) > 0)
  const over    = lines.filter(l => hundredths(amounts[l.id]) > hundredths(l.remaining))
  const completes = lines.length > 0 && lines.every(l => hundredths(l.received) + hundredths(amounts[l.id]) >= hundredths(l.ordered))
  const legacy  = !!po && !po.has_lines

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post('/delivery', body),
    onSuccess: ({ data }) => {
      toast.success(data.status === 'complete' ? `Delivery recorded: ${po.po_number} is now fully delivered` : `Delivery recorded for ${po.po_number}`)
      refresh()
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to record the delivery'),
  })
  const canSave = !!po && !!date && !isPending && po.permissions?.receive && (legacy
    ? status === 'complete' || !!notes.trim()
    : entered.length > 0 && !over.length)
  const submit = () => {
    if (!canSave) return
    mutate({
      po_id: po.id,
      delivered_date: date,
      notes: notes.trim() || undefined,
      ...(legacy ? { status } : { items: entered.map(l => ({ line: l.id, quantity: String(amounts[l.id]).trim() })) }),
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Record Delivery" description={po ? `${po.po_number} · ${po.supplier_name} · PR ${po.pr_number}` : 'Record the goods that arrived on a purchase order.'} className="max-w-2xl">
        <div className="space-y-5">
          {!givenId && (
            <div className="space-y-1.5">
              <Label>Purchase Order <span className="text-red-500">*</span></Label>
              <Select value={poId} onValueChange={v => { setPoId(v); setFilledFor(null) }}>
                <SelectTrigger><SelectValue placeholder={openPOs.length ? 'Choose a PO still to be delivered' : 'No PO is waiting for a delivery'} /></SelectTrigger>
                <SelectContent>
                  {openPOs.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.po_number}: {p.supplier_name} (PR {p.pr_number}){p.is_overdue ? `, ${p.days_late} days late` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {poId && !po && <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>}

          {po && !po.permissions?.receive && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {po.delivery_status === 'delivered' ? 'This purchase order is already fully delivered.' : 'This purchase order can\'t receive deliveries.'}
            </p>
          )}

          {po?.permissions?.receive && (
            <>
              {po.expected_delivery_date && (
                <p className={`text-xs ${po.is_overdue ? 'font-medium text-red-700' : 'text-[--color-text-muted]'}`}>
                  Expected {fmtDate(po.expected_delivery_date)}{po.is_overdue ? `: ${po.days_late} days late` : ''}
                </p>
              )}

              {lines.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label>What arrived</Label>
                    <div className="flex gap-3 text-ui-xs font-medium">
                      <button type="button" className="text-[--color-brand] hover:underline"
                        onClick={() => setAmounts(Object.fromEntries(lines.filter(l => l.remaining > 0).map(l => [l.id, qty(l.remaining)])))}>
                        Everything still to come
                      </button>
                      <button type="button" className="text-[--color-text-secondary] hover:underline" onClick={() => setAmounts({})}>Clear</button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[--color-border] overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[--color-canvas] text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                          <th className="px-3 py-2.5 text-left">Item</th>
                          <th className="px-3 py-2.5 text-right whitespace-nowrap">Ordered</th>
                          <th className="px-3 py-2.5 text-right whitespace-nowrap">Received</th>
                          <th className="px-3 py-2.5 text-right whitespace-nowrap">Still to come</th>
                          <th className="px-3 py-2.5 text-right whitespace-nowrap w-32">Arrived now</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map(l => {
                          const done = l.remaining <= 0
                          const tooMany = hundredths(amounts[l.id]) > hundredths(l.remaining)
                          return (
                            <tr key={l.id} className="border-t border-[--color-border] align-top">
                              <td className="px-3 py-2.5 text-[--color-text-primary] min-w-40">{l.item_name}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{qty(l.ordered)} {l.unit || ''}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-[--color-text-secondary]">{qty(l.received)}</td>
                              <td className={`px-3 py-2.5 text-right tabular-nums ${done ? 'text-[--color-text-muted]' : 'font-semibold text-[--color-text-primary]'}`}>{done ? 'None' : qty(l.remaining)}</td>
                              <td className="px-3 py-2">
                                {done ? <p className="text-right text-xs text-[--color-text-muted]">All in</p> : (
                                  <>
                                    <Input type="number" min="0" step="any" max={l.remaining} value={amounts[l.id] ?? ''} placeholder="0"
                                      onChange={e => setAmounts(a => ({ ...a, [l.id]: e.target.value }))} className="h-8 text-right" />
                                    {tooMany && <p className="mt-1 text-right text-[10px] font-medium text-red-700">Only {qty(l.remaining)} to come</p>}
                                  </>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {entered.length > 0 && !over.length && (
                    <p className={`text-xs ${completes ? 'font-medium text-blue-800' : 'text-[--color-text-muted]'}`}>
                      {completes ? 'This completes the purchase order.' : 'The rest stays on the purchase order until it arrives.'}
                    </p>
                  )}
                </div>
              )}

              {legacy && (
                <div className="space-y-1.5">
                  <Label>Items received</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="complete">Everything on the PO</SelectItem>
                      <SelectItem value="partial">Some items (more to come)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-[--color-text-muted]">This PO was issued before deliveries were counted by item.</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Delivered Date <span className="text-red-500">*</span></Label>
                  <Input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>
                  Notes {legacy && status === 'partial'
                    ? <span className="text-red-600 text-xs">* what is still to come</span>
                    : <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>}
                </Label>
                <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000}
                  placeholder="e.g. Boxes in good condition, received at the Supply Office" className={TEXTAREA} />
              </div>
              {over.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs font-medium text-red-700">
                  <AlertTriangle className="size-3.5 shrink-0 mt-px" /> More than is still to come for {over.map(l => l.item_name).join(', ')}.
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!canSave} onClick={submit} className="gap-2">
            <Truck className="size-4" /> {isPending ? 'Recording…' : 'Record Delivery'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

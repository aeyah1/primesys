import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ShoppingCart, Truck, Clock, FileDown, XCircle, CalendarDays, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import { nameKey, cents, useRefreshAwards } from '@/components/awards/supplier'
import ReceiveDialog from '@/components/delivery/ReceiveDialog'
import RescheduleDialog from '@/components/delivery/RescheduleDialog'
import CancelPODialog from '@/components/delivery/CancelPODialog'
import { receivedText } from '@/components/delivery/shared'
import { fmtDate, fmtCurrency, localToday } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Issues one supplier's PO: it covers their awards with no PO yet. The
// supplier's details and the total come from those awards on the server.
function IssuePOForm({ prId, group }) {
  const refresh = useRefreshAwards(prId)
  const [form, setForm] = useState({ issued_date: localToday(), expected_delivery_date: '', notes: '' })
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const missing = group.lots.find(l => !(Number(l.awarded_amount) > 0))
  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post('/po', body),
    onSuccess: ({ data }) => { toast.success(`${data.po_number} issued to ${data.supplier_name}`); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to issue the PO'),
  })
  const submit = (e) => {
    e.preventDefault()
    mutate({
      purchase_request_id:    Number(prId),
      supplier:               group.name,
      issued_date:            form.issued_date,
      expected_delivery_date: form.expected_delivery_date || undefined,
      notes:                  form.notes || undefined,
    })
  }
  return (
    <form onSubmit={submit} className="rounded-xl border border-[--color-border] bg-[--color-canvas] p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[--color-text-primary]">{group.name}</p>
          <p className="text-xs text-[--color-text-muted]">
            {group.lots.map(l => l.lot_number).join(', ')}, {plural(group.items, 'item')}
            {group.lead.supplier_contact ? `. Contact: ${group.lead.supplier_contact}` : ''}
          </p>
        </div>
        <p className="text-sm font-bold tabular-nums text-blue-800">{fmtCurrency(group.total / 100)}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Issued Date *</Label>
          <Input type="date" value={form.issued_date} onChange={e => setF('issued_date', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Expected Delivery</Label>
          <Input type="date" value={form.expected_delivery_date} min={form.issued_date} onChange={e => setF('expected_delivery_date', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Input placeholder="Optional" value={form.notes} onChange={e => setF('notes', e.target.value)} />
        </div>
      </div>
      {missing && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {missing.lot_number} has no contract amount. Edit the award in the canvass above to add it.
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending || !!missing || !form.issued_date} className="gap-2">
          <ShoppingCart className="size-4" /> {isPending ? 'Issuing…' : `Issue PO to ${group.name}`}
        </Button>
      </div>
    </form>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">{label}</p>
      <div className="text-ui-sm font-medium text-[--color-text-primary] mt-0.5">{children}</div>
    </div>
  )
}

/* The PR's purchase orders: one per supplier's awards. Staff issue them;
   supply records deliveries; the requestor sees them. */
export default function PurchaseOrders({ pr, canManage }) {
  const prId  = String(pr.id)
  const today = localToday()
  const [action, setAction] = useState(null)   // { kind: 'receive' | 'reschedule' | 'cancel', po }
  const { data: lots = [] } = useQuery({
    queryKey: ['lots', prId],
    queryFn:  () => api.get(`/lots/pr/${prId}`).then(r => r.data),
    enabled:  canManage,
  })

  // Awards with no PO yet, one group per supplier.
  const waiting = []
  for (const lot of lots.filter(l => l.status === 'awarded' && !l.po_id)) {
    let g = waiting.find(x => x.key === nameKey(lot.awarded_to))
    if (!g) waiting.push(g = { key: nameKey(lot.awarded_to), name: lot.awarded_to, lots: [], total: 0, items: 0, lead: lot })
    g.lots.push(lot)
    g.total += cents(lot.awarded_amount)
    g.items += (lot.items || []).length
    if (!g.lead.supplier_contact && lot.supplier_contact) g.lead = lot
  }
  const pos = pr.pos || []
  const pdf = (po) => openPdf(`/po/${po.id}/pdf`).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the PO')))
  const overdue = (po) => po.delivery_status !== 'delivered' && !!po.expected_delivery_date && String(po.expected_delivery_date).slice(0, 10) < today

  return (
    <Card id="purchase-order" className="scroll-mt-4">
      <CardHeader className="flex flex-row items-center gap-2">
        <ShoppingCart className="size-4 text-[--color-text-muted]" />
        <CardTitle>Purchase Orders</CardTitle>
        {pos.length > 1 && <span className="text-xs text-[--color-text-muted]">({pos.length}, one per supplier)</span>}
      </CardHeader>
      <CardContent className="space-y-5">
        {pos.map(po => (
          <div key={po.id} className="rounded-xl border border-[--color-border] bg-[--color-surface] p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link to={`/po?po=${po.id}`} className="inline-flex items-center gap-1 font-mono text-ui-sm font-bold text-[--color-brand] hover:underline">
                  {po.po_number} <ExternalLink className="size-3" />
                </Link>
                <p className="text-sm font-semibold text-[--color-text-primary]">{po.supplier_name}</p>
                {po.lot_numbers && <p className="text-xs text-[--color-text-muted]">Covers {po.lot_numbers}</p>}
              </div>
              <div className="flex items-center gap-2">
                <DeliveryStatusBadge status={po.delivery_status} />
                <Button variant="ghost" size="icon" title="Purchase order (PDF)" onClick={() => pdf(po)}>
                  <FileDown className="size-4 text-[--color-text-muted]" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Total Amount"><span className="font-bold text-blue-700">{fmtCurrency(po.total_amount)}</span></Field>
              <Field label="Issued">{fmtDate(po.issued_date)}</Field>
              {po.expected_delivery_date && (
                <Field label="Expected Delivery">
                  <span className={overdue(po) ? 'text-red-700' : ''}>{fmtDate(po.expected_delivery_date)}</span>
                  {overdue(po) && <span className="block text-xs font-semibold text-red-600">Overdue</span>}
                </Field>
              )}
              {receivedText(po) && po.delivery_status !== 'delivered' && <Field label="Received">{receivedText(po)}</Field>}
              {po.delivery_date && <Field label="Delivered">{fmtDate(po.delivery_date)}</Field>}
              {po.supplier_contact && <Field label="Supplier Contact">{po.supplier_contact}</Field>}
            </div>
            {po.rescheduled_at && (
              <p className="text-ui-xs text-[--color-text-secondary]">
                <span className="font-semibold">Expected date moved {fmtDate(po.rescheduled_at)}:</span> {po.reschedule_reason}
              </p>
            )}
            {po.delivery_notes && <p className="text-ui-xs text-[--color-text-secondary] leading-relaxed">{po.delivery_notes}</p>}

            {(po.can_record_delivery || po.can_reschedule || po.can_cancel) && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[--color-border] pt-4">
                {po.can_cancel && (
                  <p className="mr-auto text-ui-xs text-[--color-text-secondary]">Supplier backed out? Cancel this PO before any delivery to award its items again.</p>
                )}
                {po.can_cancel && (
                  <Button variant="outline" size="sm" className="gap-1.5 border-red-300 text-red-600 hover:bg-red-50" onClick={() => setAction({ kind: 'cancel', po })}>
                    <XCircle className="size-3.5" /> Cancel PO
                  </Button>
                )}
                {po.can_reschedule && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAction({ kind: 'reschedule', po })}>
                    <CalendarDays className="size-3.5" /> Change Expected Date
                  </Button>
                )}
                {po.can_record_delivery && (
                  <Button size="sm" className="gap-1.5" onClick={() => setAction({ kind: 'receive', po })}>
                    <Truck className="size-3.5" /> Record Delivery
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}

        {canManage && waiting.length > 0 && (
          <div className="space-y-3">
            <p className="text-ui-sm font-semibold text-[--color-text-primary]">
              Ready for a purchase order{waiting.length > 1 ? `: ${waiting.length} suppliers, one PO each` : ''}
            </p>
            {waiting.map(g => <IssuePOForm key={g.key} prId={prId} group={g} />)}
          </div>
        )}

        {!pos.length && !(canManage && waiting.length) && (
          <div className="flex items-center gap-3 rounded-lg border border-[--color-border] bg-[--color-canvas] px-4 py-4">
            <Clock className="size-4 text-[--color-text-muted] shrink-0" />
            <p className="text-ui-sm text-[--color-text-secondary]">
              {canManage
                ? 'No purchase order yet. Once a supplier is awarded in the canvass above, their PO can be issued here.'
                : 'No purchase order has been issued for this PR yet. Procurement issues one to each supplier awarded.'}
            </p>
          </div>
        )}

        {pr.cancelled_pos?.length > 0 && (
          <div className="border-t border-[--color-border] pt-4 space-y-2">
            <p className="text-ui-xs font-semibold text-[--color-text-muted] uppercase tracking-wide">Cancelled purchase orders</p>
            {pr.cancelled_pos.map(c => (
              <div key={c.id} className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-ui-xs text-red-800">
                <span className="font-mono font-semibold">{c.po_number}</span> · {c.supplier_name} · cancelled {fmtDate(c.cancelled_at)}
                {c.cancelled_by_name ? ` by ${c.cancelled_by_name}` : ''}
                {c.cancel_reason && <p className="mt-0.5 text-red-700">{c.cancel_reason}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {action?.kind === 'receive' && <ReceiveDialog poId={action.po.id} open onClose={() => setAction(null)} />}
      {action?.kind === 'reschedule' && <RescheduleDialog po={action.po} onClose={() => setAction(null)} />}
      {action?.kind === 'cancel' && <CancelPODialog po={action.po} onClose={() => setAction(null)} />}
    </Card>
  )
}

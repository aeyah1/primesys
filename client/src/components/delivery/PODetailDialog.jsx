import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileDown, Truck, CalendarDays, XCircle, Paperclip, ChevronDown, ChevronRight, ExternalLink, Lock, AlertTriangle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { DeliveryStatusBadge, POStatusBadge } from '@/components/shared/StatusBadge'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'
import { hundredths, qty } from './shared'
import ReceiveDialog from './ReceiveDialog'
import RescheduleDialog from './RescheduleDialog'
import CancelPODialog from './CancelPODialog'
import CloseBalanceDialog from './CloseBalanceDialog'

const pdf = (endpoint, what) => openPdf(endpoint).catch(async (err) => toast.error(await blobErrorMessage(err, `Could not open the ${what}`)))

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide">{label}</p>
      <div className="text-sm font-medium text-[--color-text-primary] mt-0.5">{children}</div>
    </div>
  )
}

/* One delivery of the PO: what it brought, its inspection report, its files. */
function DeliveryRow({ d, canUpload, canDelete }) {
  const [files, setFiles] = useState(false)
  return (
    <div className="border-t border-[--color-border] first:border-t-0 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[--color-text-primary]">
            {fmtDate(d.delivered_date)} <span className="font-normal text-[--color-text-muted]">· received by {d.received_by_name || 'someone'}</span>
          </p>
          <p className="text-xs text-[--color-text-secondary] mt-0.5">
            {d.items.length ? d.items.map(i => `${i.item_name} × ${qty(i.quantity)}`).join(', ') : d.status === 'complete' ? 'Everything on the PO' : 'Part of the PO'}
          </p>
          {d.notes && <p className="text-xs text-[--color-text-muted] mt-1 whitespace-pre-line">{d.notes}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <DeliveryStatusBadge status={d.status === 'complete' ? 'delivered' : 'partial'} />
          <Button variant="ghost" size="icon" title="Inspection and Acceptance Report (PDF)" onClick={() => pdf(`/delivery/${d.id}/pdf`, 'inspection report')}>
            <FileDown className="size-4 text-[--color-text-muted]" />
          </Button>
          <button onClick={() => setFiles(p => !p)} title="Invoices and proof of delivery"
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors">
            <Paperclip className="size-3.5" /> {d.attachments > 0 ? d.attachments : ''}
            {files ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        </div>
      </div>
      {files && (
        <div className="mt-3">
          <AttachmentsPanel endpoint={`/delivery/${d.id}`} queryKey={`delivery-attachments-${d.id}`} canUpload={canUpload} canDelete={canDelete} />
        </div>
      )}
    </div>
  )
}

/* A purchase order: its supplier, dates and amount, its lines (what arrived
   and what is still to come), its deliveries, and the actions this user may take. */
export default function PODetailDialog({ poId, onClose }) {
  const { user } = useAuth()
  const [action, setAction] = useState(null)   // 'receive' | 'reschedule' | 'cancel' | 'close'
  const { data: po, isLoading } = useQuery({
    queryKey: ['po-detail', String(poId)],
    queryFn:  () => api.get(`/po/${poId}`).then(r => r.data),
    enabled:  !!poId,
  })
  const staff    = ['admin', 'procurement'].includes(user?.role)
  const canFiles = staff || user?.role === 'supply'
  const lineCost = (l) => l.unit_price ?? l.estimated_cost

  return (
    <Dialog open={!!poId} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Purchase Order" description={po ? `${po.po_number} · ${po.supplier_name}` : 'Loading…'} className="max-w-3xl">
        {isLoading || !po ? (
          <div className="space-y-3">{Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="space-y-6">
            {po.po_status === 'cancelled' && (
              <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                <XCircle className="size-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Cancelled {fmtDate(po.cancelled_at)}{po.cancelled_by_name ? ` by ${po.cancelled_by_name}` : ''}</p>
                  {po.cancel_reason && <p className="mt-0.5">{po.cancel_reason}</p>}
                </div>
              </div>
            )}

            {po.closed_at && (
              <div className="flex items-start gap-3 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                <Lock className="size-4 text-slate-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Balance closed {fmtDate(po.closed_at)}{po.closed_by_name ? ` by ${po.closed_by_name}` : ''}</p>
                  {po.close_reason && <p className="mt-0.5">{po.close_reason}</p>}
                  <p className="mt-1 text-xs text-slate-600">
                    Not delivered, not paid: <strong>{fmtCurrency(po.short_amount)}</strong>
                    {Number(po.penalty_amount) > 0 && <> · Late-delivery penalty recorded: <strong>{fmtCurrency(po.penalty_amount)}</strong></>}
                    . The undelivered items went back to canvass.
                  </p>
                </div>
              </div>
            )}

            {po.late && (
              <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${po.late.may_terminate ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    {po.late.days_late} days late
                    {po.late.amount != null ? ` · penalty so far ${fmtCurrency(po.late.amount)}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs">
                    1/10 of 1% of the value not yet delivered{po.late.undelivered != null ? ` (${fmtCurrency(po.late.undelivered)})` : ''} per day, per the PO's penalty clause
                    {po.late.amount == null ? "; it can't be worked out here because this award has no unit prices" : ''}.
                    {po.late.may_terminate && ' It has reached 10% of the contract: the office may terminate the PO for default.'}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <POStatusBadge status={po.po_status} />
              {po.po_status === 'active' && <DeliveryStatusBadge status={po.delivery_status} />}
              {po.is_overdue && (
                <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{po.days_late} days late</span>
              )}
              <Link to={`/pr/${po.purchase_request_id}`} onClick={onClose}
                className="ml-auto flex items-center gap-1 text-xs font-medium text-[--color-brand] hover:underline">
                PR {po.pr_number} <ExternalLink className="size-3" />
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Total">
                <span className="font-bold text-blue-800">{fmtCurrency(po.total_amount)}</span>
                {po.closed_at && <span className="block text-xs font-normal text-[--color-text-muted]">Payable {fmtCurrency(Number(po.total_amount) - Number(po.short_amount || 0))}</span>}
              </Field>
              <Field label="Issued">{fmtDate(po.issued_date)}{po.issued_by_name ? <span className="block text-xs font-normal text-[--color-text-muted]">by {po.issued_by_name}</span> : null}</Field>
              <Field label="Expected">
                <span className={po.is_overdue ? 'text-red-700' : ''}>{po.expected_delivery_date ? fmtDate(po.expected_delivery_date) : 'Not set'}</span>
                {po.rescheduled_at && <span className="block text-xs font-normal text-[--color-text-muted]">Moved {fmtDate(po.rescheduled_at)}: {po.reschedule_reason}</span>}
              </Field>
              {po.delivery_date && <Field label="Delivered">{fmtDate(po.delivery_date)}</Field>}
              {po.supplier_contact && <Field label="Supplier Contact">{po.supplier_contact}</Field>}
              {po.supplier_address && <div className="col-span-2"><Field label="Supplier Address">{po.supplier_address}</Field></div>}
            </div>
            {po.notes && <p className="rounded-lg border border-[--color-border] bg-[--color-canvas] px-4 py-3 text-sm text-[--color-text-secondary]">{po.notes}</p>}

            <div className="space-y-2">
              <p className="text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider">Items on this PO</p>
              <div className="rounded-lg border border-[--color-border] overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[--color-canvas] text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                      <th className="px-3 py-2.5 text-left">Item</th>
                      <th className="px-3 py-2.5 text-right whitespace-nowrap">Ordered</th>
                      {po.has_lines && <th className="px-3 py-2.5 text-right whitespace-nowrap">Received</th>}
                      {po.has_lines && <th className="px-3 py-2.5 text-right whitespace-nowrap">Still to come</th>}
                      <th className="px-3 py-2.5 text-right whitespace-nowrap">{po.items.every(l => l.unit_price != null) ? 'Unit price' : 'Est. unit cost'}</th>
                      <th className="px-3 py-2.5 text-right whitespace-nowrap">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.items.map((l, k) => (
                      <tr key={l.id ?? k} className="border-t border-[--color-border]">
                        <td className="px-3 py-2.5 text-[--color-text-primary]">{l.item_name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{qty(l.ordered)} {l.unit || ''}</td>
                        {po.has_lines && <td className="px-3 py-2.5 text-right tabular-nums text-[--color-text-secondary]">{qty(l.received)}</td>}
                        {po.has_lines && (
                          <td className={`px-3 py-2.5 text-right tabular-nums ${l.remaining > 0 ? 'font-semibold text-[--color-text-primary]' : 'text-[--color-text-muted]'}`}>
                            {l.remaining > 0 ? qty(l.remaining) : Number(l.short) > 0 ? <span className="text-red-700">{qty(l.short)} not delivered</span> : 'None'}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-right tabular-nums text-[--color-text-secondary] whitespace-nowrap">{lineCost(l) != null ? fmtCurrency(lineCost(l)) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
                          {lineCost(l) != null ? fmtCurrency(Math.round(hundredths(l.ordered) * Number(lineCost(l))) / 100) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!po.has_lines && <p className="text-xs text-[--color-text-muted]">This PO was issued before deliveries were counted by item, so it lists its PR's items.</p>}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider">Deliveries ({po.deliveries.length})</p>
              {po.deliveries.length ? (
                <div className="rounded-lg border border-[--color-border]">
                  {po.deliveries.map(d => <DeliveryRow key={d.id} d={d} canUpload={canFiles && po.po_status === 'active'} canDelete={staff && po.delivery_status !== 'delivered'} />)}
                </div>
              ) : <p className="text-sm text-[--color-text-muted]">Nothing has been delivered yet.</p>}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-[--color-border] pt-4">
              <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => pdf(`/po/${po.id}/pdf`, 'purchase order')}>
                <FileDown className="size-3.5" /> PO PDF
              </Button>
              {po.permissions?.reschedule && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAction('reschedule')}>
                  <CalendarDays className="size-3.5" /> Change Expected Date
                </Button>
              )}
              {po.permissions?.cancel && (
                <Button variant="outline" size="sm" className="gap-1.5 border-red-300 text-red-600 hover:bg-red-50" onClick={() => setAction('cancel')}>
                  <XCircle className="size-3.5" /> Cancel PO
                </Button>
              )}
              {po.permissions?.close && (
                <Button variant="outline" size="sm" className="gap-1.5 border-red-300 text-red-600 hover:bg-red-50" onClick={() => setAction('close')}>
                  <Lock className="size-3.5" /> Close Balance
                </Button>
              )}
              {po.permissions?.receive && (
                <Button size="sm" className="gap-1.5" onClick={() => setAction('receive')}>
                  <Truck className="size-3.5" /> Record Delivery
                </Button>
              )}
            </div>
          </div>
        )}

        {po && <ReceiveDialog poId={po.id} open={action === 'receive'} onClose={() => setAction(null)} />}
        {po && action === 'reschedule' && <RescheduleDialog po={po} onClose={() => setAction(null)} />}
        {po && action === 'cancel' && <CancelPODialog po={po} onClose={() => setAction(null)} />}
        {po && action === 'close' && <CloseBalanceDialog poId={po.id} onClose={() => setAction(null)} />}
      </DialogContent>
    </Dialog>
  )
}

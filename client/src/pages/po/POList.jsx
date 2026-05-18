import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, ShoppingCart, FileDown, CheckCircle2, Clock,
  Building2, Phone, MapPin, User, CalendarDays, Truck,
  FileText, BadgeCheck, PackageCheck, Hash, Package,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { DeliveryStatusBadge, POStatusBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const TABS = [
  { key: 'all',              label: 'All' },
  { key: 'pending_approval', label: 'Pending Approval' },
  { key: 'pending',          label: 'Pending Delivery' },
  { key: 'partial',          label: 'Partial' },
  { key: 'delivered',        label: 'Delivered' },
]

/* ── Detail row helper ─────────────────────────────────────────────── */
function DetailRow({ icon: Icon, label, value, mono, accent }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[--color-overlay]">
        <Icon className="size-3.5 text-[--color-text-muted]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide leading-none mb-0.5">
          {label}
        </p>
        <p className={`text-sm font-medium break-words leading-snug ${
          accent === 'brand'   ? 'text-[--color-brand] font-bold font-mono' :
          accent === 'emerald' ? 'text-emerald-700 font-bold' :
          mono                 ? 'font-mono text-[--color-text-primary]' :
                                 'text-[--color-text-primary]'
        }`}>
          {value}
        </p>
      </div>
    </div>
  )
}

/* ── PO Detail Modal ───────────────────────────────────────────────── */
function PODetailModal({ poId, onClose, canManage, onApprove, approving, onDownload }) {
  const { data: po, isLoading } = useQuery({
    queryKey: ['po-detail', poId],
    queryFn:  () => api.get(`/po/${poId}`).then(r => r.data),
    enabled:  !!poId,
  })

  const { data: prItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['pr-items-po', po?.purchase_request_id],
    queryFn:  () => api.get(`/pr/${po.purchase_request_id}/items`).then(r => r.data),
    enabled:  !!po?.purchase_request_id,
  })

  return (
    <Dialog open={!!poId} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent
        title="Purchase Order"
        description={po ? `${po.po_number} · ${po.pr_number}` : 'Loading…'}
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        {isLoading || !po ? (
          <div className="space-y-3 pt-2">
            {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <div className="space-y-5 pt-1">

            {/* Approval banner */}
            {po.po_status === 'pending_approval' && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <Clock className="size-4 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-800 flex-1">
                  This PO is <strong>pending procurement approval</strong>.
                </p>
                {canManage && (
                  <Button
                    size="sm"
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 shrink-0"
                    disabled={approving}
                    onClick={onApprove}
                  >
                    <CheckCircle2 className="size-3.5" />
                    {approving ? 'Approving…' : 'Approve PO'}
                  </Button>
                )}
              </div>
            )}

            {po.po_status === 'approved' && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
                <BadgeCheck className="size-4 text-emerald-600 shrink-0" />
                <p className="text-sm text-emerald-800 font-medium">Purchase Order Approved</p>
              </div>
            )}

            {/* ── Identification ── */}
            <div>
              <p className="text-[11px] font-bold text-[--color-text-secondary] uppercase tracking-widest mb-3 pb-1.5 border-b border-[--color-border]">
                Identification
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DetailRow icon={Hash}      label="PO Number"    value={po.po_number}    accent="brand" />
                <DetailRow icon={FileText}  label="PR Number"    value={po.pr_number}    mono />
                {po.pr_title && (
                  <div className="sm:col-span-2">
                    <DetailRow icon={FileText} label="Purchase Request Title" value={po.pr_title} />
                  </div>
                )}
                <DetailRow icon={User}         label="Issued By"     value={po.issued_by_name} />
                <DetailRow icon={CalendarDays} label="Issued Date"   value={fmtDate(po.issued_date)} />
              </div>
            </div>

            {/* ── Supplier ── */}
            <div>
              <p className="text-[11px] font-bold text-[--color-text-secondary] uppercase tracking-widest mb-3 pb-1.5 border-b border-[--color-border]">
                Supplier / Contractor
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <DetailRow icon={Building2} label="Supplier Name" value={po.supplier_name} />
                </div>
                {po.supplier_contact && <DetailRow icon={Phone}  label="Contact Person / Number" value={po.supplier_contact} />}
                {po.supplier_address && (
                  <div className="sm:col-span-2">
                    <DetailRow icon={MapPin} label="Address" value={po.supplier_address} />
                  </div>
                )}
              </div>
            </div>

            {/* ── Amount & Delivery ── */}
            <div>
              <p className="text-[11px] font-bold text-[--color-text-secondary] uppercase tracking-widest mb-3 pb-1.5 border-b border-[--color-border]">
                Amount & Delivery
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
                  <PackageCheck className="size-5 text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">Total Amount</p>
                    <p className="text-xl font-bold text-emerald-800 tabular-nums mt-0.5">{fmtCurrency(po.total_amount)}</p>
                  </div>
                </div>

                {po.expected_delivery_date && (
                  <DetailRow icon={CalendarDays} label="Expected Delivery Date" value={fmtDate(po.expected_delivery_date)} />
                )}
                {po.delivery_date && (
                  <DetailRow icon={Truck} label="Actual Delivery Date" value={fmtDate(po.delivery_date)} />
                )}

                <div>
                  <p className="text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide mb-1.5">PO Status</p>
                  <POStatusBadge status={po.po_status} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide mb-1.5">Delivery Status</p>
                  <DeliveryStatusBadge status={po.delivery_status} />
                </div>

                {po.delivery_notes && (
                  <div className="sm:col-span-2 rounded-lg bg-[--color-canvas] border border-[--color-border] px-4 py-3">
                    <p className="text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide mb-1">Delivery Notes</p>
                    <p className="text-sm text-[--color-text-secondary] leading-relaxed">{po.delivery_notes}</p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Notes ── */}
            {po.notes && (
              <div>
                <p className="text-[11px] font-bold text-[--color-text-secondary] uppercase tracking-widest mb-3 pb-1.5 border-b border-[--color-border]">
                  Notes
                </p>
                <div className="rounded-lg bg-[--color-canvas] border border-[--color-border] px-4 py-3">
                  <p className="text-sm text-[--color-text-secondary] leading-relaxed">{po.notes}</p>
                </div>
              </div>
            )}

            {/* ── Items Requested ── */}
            <div>
              <p className="text-[11px] font-bold text-[--color-text-secondary] uppercase tracking-widest mb-3 pb-1.5 border-b border-[--color-border] flex items-center gap-2">
                <Package className="size-3.5" /> Items Requested
              </p>
              {itemsLoading ? (
                <div className="space-y-2">
                  {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : prItems.length === 0 ? (
                <p className="text-sm text-[--color-text-muted] italic">No items recorded for this purchase request.</p>
              ) : (() => {
                const groups = prItems.reduce((acc, item) => {
                  const key = item.group_label || ''
                  if (!acc[key]) acc[key] = []
                  acc[key].push(item)
                  return acc
                }, {})
                const grandTotal = prItems.reduce((sum, item) => sum + (item.quantity * item.estimated_cost), 0)

                return (
                  <div className="rounded-lg border border-[--color-border] overflow-hidden text-sm">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-[--color-canvas] border-b border-[--color-border]">
                          <th className="px-3 py-2 text-left text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide w-8">#</th>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide">Item Description</th>
                          <th className="px-3 py-2 text-center text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide w-16">Unit</th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide w-16">Qty</th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide w-28">Unit Cost</th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide w-28">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(groups).map(([groupLabel, items]) => {
                          const groupTotal = items.reduce((sum, item) => sum + (item.quantity * item.estimated_cost), 0)
                          return (
                            <React.Fragment key={groupLabel || '__ungrouped__'}>
                              {groupLabel && (
                                <tr className="bg-[--color-overlay]">
                                  <td colSpan={6} className="px-3 py-1.5 text-[11px] font-bold text-[--color-text-secondary] uppercase tracking-wide">
                                    {groupLabel}
                                  </td>
                                </tr>
                              )}
                              {items.map((item, idx) => (
                                <tr key={item.id} className="border-t border-[--color-border]/50">
                                  <td className="px-3 py-2 text-[--color-text-muted] tabular-nums">{idx + 1}</td>
                                  <td className="px-3 py-2 text-[--color-text-primary]">{item.item_name}</td>
                                  <td className="px-3 py-2 text-center text-[--color-text-muted]">{item.unit || '—'}</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-[--color-text-secondary]">{item.quantity}</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-[--color-text-secondary]">{fmtCurrency(item.estimated_cost)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums font-medium text-[--color-text-primary]">{fmtCurrency(item.quantity * item.estimated_cost)}</td>
                                </tr>
                              ))}
                              {groupLabel && (
                                <tr className="border-t border-[--color-border] bg-[--color-overlay]">
                                  <td colSpan={5} className="px-3 py-1.5 text-right text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide">
                                    {groupLabel} Subtotal
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-[--color-text-primary]">{fmtCurrency(groupTotal)}</td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        })}
                        <tr className="border-t-2 border-[--color-border] bg-emerald-50">
                          <td colSpan={5} className="px-3 py-2.5 text-right text-xs font-bold text-emerald-700 uppercase tracking-wide">
                            Grand Total
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-bold text-emerald-800 text-base">{fmtCurrency(grandTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )
              })()}
            </div>

            {/* ── Actions ── */}
            <div className="flex justify-end gap-2 pt-1 border-t border-[--color-border]">
              <Button variant="secondary" size="sm" onClick={() => onDownload(po)} className="gap-1.5">
                <FileDown className="size-3.5" /> Download PDF
              </Button>
            </div>

          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── Main Page ─────────────────────────────────────────────────────── */
export default function POList() {
  const { user }    = useAuth()
  const qc          = useQueryClient()
  const [search, setSearch]     = useState('')
  const [tab, setTab]           = useState('all')
  const [page, setPage]         = useState(1)
  const [selectedPOId, setSelectedPOId] = useState(null)
  const canManage = ['admin', 'procurement'].includes(user?.role)

  const downloadPDF = async (po) => {
    try {
      const res = await api.get(`/po/${po.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch { toast.error('Failed to open PDF') }
  }

  const { mutate: approvePO, isPending: approving } = useMutation({
    mutationFn: (id) => api.patch(`/po/${id}/approve`),
    onSuccess: () => {
      toast.success('PO approved')
      qc.invalidateQueries({ queryKey: ['po-list'] })
      qc.invalidateQueries({ queryKey: ['po-detail', selectedPOId] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to approve'),
  })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['po-list', { search, tab, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page, limit: 10 })
      if (search) params.set('search', search)
      if (tab === 'pending_approval') {
        params.set('po_status', 'pending_approval')
      } else if (tab !== 'all') {
        params.set('delivery_status', tab)
      }
      return api.get(`/po?${params}`).then(r => r.data)
    },
    keepPreviousData: true,
  })

  const colCount = canManage ? 9 : 8

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input
            placeholder="Search by PO number, PR, or supplier…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-[--color-border] overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setPage(1) }}
              className={`flex items-center px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                tab === t.key
                  ? 'border-[--color-brand] text-[--color-brand]'
                  : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO Number</TableHead>
                <TableHead>PR Number</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Exp. Delivery</TableHead>
                <TableHead>PO Status</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      {Array(9).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                    </TableRow>
                  ))
                : isError
                  ? (
                    <TableEmpty colSpan={9}>
                      <p className="text-red-500">Failed to load purchase orders.</p>
                    </TableEmpty>
                  )
                : data?.data?.length === 0
                  ? (
                    <TableEmpty colSpan={9}>
                      <ShoppingCart className="size-8 text-[--color-text-muted] mx-auto mb-2" />
                      <p>No purchase orders found.</p>
                    </TableEmpty>
                  )
                  : data?.data?.map(po => (
                      <TableRow
                        key={po.id}
                        className={`cursor-pointer ${po.po_status === 'pending_approval' ? 'bg-amber-50/60' : ''}`}
                        onClick={() => setSelectedPOId(po.id)}
                      >
                        <TableCell className="font-mono font-semibold text-[--color-brand]">{po.po_number}</TableCell>
                        <TableCell className="font-mono text-sm text-[--color-text-secondary]">{po.pr_number}</TableCell>
                        <TableCell className="text-sm text-[--color-text-primary]">{po.supplier_name}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{fmtCurrency(po.total_amount)}</TableCell>
                        <TableCell className="text-sm text-[--color-text-muted]">{fmtDate(po.issued_date)}</TableCell>
                        <TableCell className="text-sm text-[--color-text-muted]">
                          {po.expected_delivery_date ? fmtDate(po.expected_delivery_date) : '—'}
                        </TableCell>
                        <TableCell><POStatusBadge status={po.po_status} /></TableCell>
                        <TableCell><DeliveryStatusBadge status={po.delivery_status} /></TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            {canManage && po.po_status === 'pending_approval' && (
                              <button
                                onClick={() => approvePO(po.id)}
                                title="Approve PO"
                                className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                              >
                                <CheckCircle2 className="size-4" />
                              </button>
                            )}
                            <button
                              onClick={async (e) => { e.stopPropagation(); await downloadPDF(po) }}
                              title="Download PO as PDF"
                              className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors"
                            >
                              <FileDown className="size-4" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
              }
            </TableBody>
          </Table>

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[--color-border]">
              <span className="text-xs text-[--color-text-muted]">
                Page {data.page} of {data.totalPages} · {data.total} total
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setPage(p => p - 1)} disabled={page <= 1}>Previous</Button>
                <Button variant="secondary" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= data.totalPages}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PODetailModal
        poId={selectedPOId}
        onClose={() => setSelectedPOId(null)}
        canManage={canManage}
        onApprove={() => approvePO(selectedPOId)}
        approving={approving}
        onDownload={downloadPDF}
      />
    </div>
  )
}

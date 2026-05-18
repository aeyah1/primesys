import { useState, useEffect, useRef, Fragment } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, FileText, Truck, ShoppingCart, Clock, Gavel,
  Trophy, Paperclip, History, BellRing, CheckCircle2,
  Package, Plus, Trash2, ClipboardList, RotateCcw, Eye, Info,
  Building2, Phone, MapPin, ChevronRight, FileDown,
} from 'lucide-react'

import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PRStatusBadge, DeliveryStatusBadge, LotStatusBadge, POStatusBadge } from '@/components/shared/StatusBadge'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import { fmtDate, fmtCurrency, PR_STATUS_LABELS } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const PR_STATUSES = ['draft', 'submitted', 'bidding', 'for_po', 'completed', 'cancelled']
const UNITS = ['pax', 'pc', 'set', 'lot', 'pair', 'ream', 'box', 'unit', 'kg', 'L', 'roll', 'pack', 'bottle', 'can', 'sheet', 'bag', 'bundle']

function groupBySection(items) {
  const groups = []
  for (const item of items) {
    const label = item.group_label || ''
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

const ITH = ({ children, className = '' }) => (
  <th className={`px-4 py-3 text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider bg-[--color-canvas] border-b border-[--color-border] ${className}`}>
    {children}
  </th>
)
const ITD = ({ children, className = '' }) => (
  <td className={`px-4 py-3.5 text-sm ${className}`}>
    {children}
  </td>
)

function LotsSection({ prId, canManage }) {
  const { data: lots = [], isLoading } = useQuery({
    queryKey: ['lots', prId],
    queryFn: () => api.get(`/lots/pr/${prId}`).then(r => r.data),
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <Gavel className="size-4 text-[--color-text-muted]" />
          <CardTitle>Lots & Awards</CardTitle>
          {lots.length > 0 && (
            <span className="text-xs text-[--color-text-muted] font-normal">
              ({lots.filter(l => l.status === 'awarded').length}/{lots.length} awarded)
            </span>
          )}
        </div>
        {canManage && (
          <Link
            to="/bidding"
            className="flex items-center gap-1.5 text-xs font-medium text-[--color-brand] hover:underline"
          >
            <Gavel className="size-3.5" /> Manage in Lots & Awards →
          </Link>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {isLoading
          ? <div className="p-6 space-y-2">{Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : !lots.length
            ? (
              <div className="px-6 py-10 text-center">
                <Gavel className="size-8 text-[--color-text-muted] mx-auto mb-2" />
                <p className="text-ui-xs text-[--color-text-muted]">
                  {canManage ? 'No lots yet. Create lots from the Lots & Awards page.' : 'No lots have been created yet.'}
                </p>
                {canManage && (
                  <Link to="/bidding" className="mt-2 inline-block text-xs font-medium text-[--color-brand] hover:underline">
                    Go to Lots & Awards →
                  </Link>
                )}
              </div>
            )
            : lots.map(lot => (
              <div key={lot.id} className="px-6 py-3.5 border-b border-[--color-border] last:border-0">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-[--color-brand]">{lot.lot_number}</span>
                      {lot.title && <span className="text-ui-sm font-semibold text-[--color-text-primary]">{lot.title}</span>}
                      <LotStatusBadge status={lot.status} />
                    </div>
                    {lot.awarded_to && (
                      <div className="flex items-center gap-1 mt-0.5 text-ui-xs text-emerald-700 font-medium">
                        <Trophy className="size-3" /> {lot.awarded_to}
                        {lot.awarded_amount ? ` — ${fmtCurrency(lot.awarded_amount)}` : ''}
                      </div>
                    )}
                    {lot.items?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {lot.items.map(item => (
                          <div key={item.id} className="flex items-center gap-2 text-[10px] text-[--color-text-muted] pl-2 border-l-2 border-[--color-border]">
                            <span className="flex-1 truncate">{item.item_name}</span>
                            <span className="shrink-0">{item.quantity} {item.unit}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
        }
      </CardContent>
    </Card>
  )
}

const EMPTY_ITEM = { group_label: '', item_name: '', quantity: '1', unit: 'pax', estimated_cost: '' }

function PRItemsSection({ prId, canEdit }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState(EMPTY_ITEM)
  const setD = (k, v) => setDraft(p => ({ ...p, [k]: v }))

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['pr-items', prId],
    queryFn: () => api.get(`/pr/${prId}/items`).then(r => r.data),
  })

  const { mutate: addItem, isPending: adding } = useMutation({
    mutationFn: (body) => api.post(`/pr/${prId}/items`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pr-items', prId] })
      setDraft(p => ({ ...p, item_name: '', quantity: '1', estimated_cost: '' }))
      toast.success('Item added')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add item'),
  })

  const { mutate: deleteItem } = useMutation({
    mutationFn: (itemId) => api.delete(`/pr/${prId}/items/${itemId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pr-items', prId] })
      toast.success('Item removed')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove item'),
  })

  const handleAdd = () => {
    if (!draft.item_name.trim()) return toast.error('Item description is required')
    addItem({
      group_label:    draft.group_label    || undefined,
      item_name:      draft.item_name.trim(),
      quantity:       parseFloat(draft.quantity)       || 1,
      unit:           draft.unit           || undefined,
      estimated_cost: draft.estimated_cost ? parseFloat(draft.estimated_cost) : undefined,
    })
  }

  const processed = items.map((item, i) => ({
    ...item,
    rowNum:    i + 1,
    totalCost: (parseFloat(item.estimated_cost) || 0) * (parseFloat(item.quantity) || 1),
  }))
  const grouped    = groupBySection(processed)
  const grandTotal = processed.reduce((s, it) => s + it.totalCost, 0)
  const draftTotal = draft.estimated_cost && draft.quantity
    ? parseFloat(draft.estimated_cost) * (parseFloat(draft.quantity) || 1)
    : 0
  const cols = canEdit ? 7 : 6

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-[--color-text-muted]" />
          <CardTitle>Items Requested</CardTitle>
          {items.length > 0 && (
            <span className="text-xs text-[--color-text-muted] font-normal">({items.length})</span>
          )}
        </div>
        {grandTotal > 0 && (
          <span className="text-sm font-bold text-emerald-700">Grand Total: {fmtCurrency(grandTotal)}</span>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : (
          <>
            <div className="border-b border-[--color-border]">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <ITH className="text-center w-14">Stock / Property No.</ITH>
                    <ITH className="text-center w-20">Unit</ITH>
                    <ITH className="text-left">Item Description</ITH>
                    <ITH className="text-center w-16">Qty</ITH>
                    <ITH className="text-right w-32">Unit Cost</ITH>
                    <ITH className="text-right w-32">Total Cost</ITH>
                    {canEdit && <th className="w-10 bg-[--color-canvas] border-b border-[--color-border]" />}
                  </tr>
                </thead>
                <tbody>
                  {processed.length === 0 ? (
                    <tr>
                      <td colSpan={cols} className="px-6 py-12 text-center text-sm text-[--color-text-muted]">
                        {canEdit ? 'No items yet — add the first item below.' : 'No items listed.'}
                      </td>
                    </tr>
                  ) : (
                    grouped.map((group, gi) => {
                      const groupTotal = group.items.reduce((s, it) => s + it.totalCost, 0)
                      return (
                        <Fragment key={gi}>
                          {group.label && (
                            <tr className="bg-emerald-50 border-y border-emerald-200">
                              <td colSpan={cols} className="px-6 py-3 text-center text-sm font-bold text-emerald-800 tracking-wide uppercase">
                                {group.label}
                              </td>
                            </tr>
                          )}
                          {group.items.map((item) => (
                            <tr key={item.id} className="border-b border-[--color-border] hover:bg-[--color-canvas]">
                              <ITD className="text-center text-[--color-text-muted] font-medium">{item.rowNum}</ITD>
                              <ITD className="text-center font-semibold text-[--color-text-primary]">{item.unit || '—'}</ITD>
                              <ITD className="text-left font-medium text-[--color-text-primary] leading-relaxed">{item.item_name}</ITD>
                              <ITD className="text-center tabular-nums font-medium">{item.quantity}</ITD>
                              <ITD className="text-right tabular-nums text-[--color-text-secondary]">
                                {item.estimated_cost ? fmtCurrency(parseFloat(item.estimated_cost)) : '—'}
                              </ITD>
                              <td className="px-4 py-3.5 text-sm text-right tabular-nums font-bold text-[--color-text-primary]">
                                {item.totalCost > 0 ? fmtCurrency(item.totalCost) : '—'}
                              </td>
                              {canEdit && (
                                <td className="px-3 text-center">
                                  <button
                                    onClick={() => {
                                      if (window.confirm(`Remove "${item.item_name}" from this PR?`)) deleteItem(item.id)
                                    }}
                                    className="p-1.5 rounded text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                          {group.label && groupTotal > 0 && (
                            <tr className="bg-[--color-canvas] border-b border-[--color-border]">
                              <td colSpan={5} className="px-6 py-3 text-right text-sm font-semibold text-[--color-text-secondary]">
                                Subtotal
                              </td>
                              <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-[--color-text-primary]">
                                {fmtCurrency(groupTotal)}
                              </td>
                              {canEdit && <td />}
                            </tr>
                          )}
                        </Fragment>
                      )
                    })
                  )}
                  {grandTotal > 0 && (
                    <tr className="bg-emerald-50">
                      <td colSpan={5} className="px-6 py-3.5 text-right text-sm font-bold text-emerald-800">
                        Grand Total
                      </td>
                      <td className="px-4 py-3.5 text-right text-base font-bold tabular-nums text-emerald-700">
                        {fmtCurrency(grandTotal)}
                      </td>
                      {canEdit && <td />}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {canEdit && (
              <div className="bg-[--color-canvas] px-4 py-4 space-y-3">
                <p className="text-xs font-semibold text-[--color-text-muted] uppercase tracking-wide">Add Item</p>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    Section / Project Name
                    <span className="ml-1 font-normal text-[--color-text-muted]">(optional)</span>
                  </Label>
                  <Input
                    placeholder="e.g. PROJECT 1: COMMUNITY-BASED TOURISM"
                    value={draft.group_label}
                    onChange={e => setD('group_label', e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5 space-y-1">
                    <Label className="text-xs">Item Description <span className="text-[--color-brand]">*</span></Label>
                    <Input
                      placeholder="e.g. Snacks Day 1 - AM: (Ham and cheese & softdrinks)"
                      value={draft.item_name}
                      onChange={e => setD('item_name', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Unit</Label>
                    <Select value={draft.unit} onValueChange={v => setD('unit', v)}>
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1 space-y-1">
                    <Label className="text-xs">Qty</Label>
                    <Input
                      type="number" min="0.01" step="any" placeholder="1"
                      value={draft.quantity}
                      onChange={e => setD('quantity', e.target.value)}
                      className="text-center"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Unit Cost (₱)</Label>
                    <Input
                      type="number" min="0" step="any" placeholder="0.00"
                      value={draft.estimated_cost}
                      onChange={e => setD('estimated_cost', e.target.value)}
                    />
                  </div>
                  <div className="col-span-1 text-right text-sm font-bold tabular-nums text-emerald-700 self-end pb-2">
                    {draftTotal > 0 ? fmtCurrency(draftTotal) : ''}
                  </div>
                  <div className="col-span-1 self-end">
                    <Button
                      className="w-full px-0"
                      disabled={adding || !draft.item_name.trim()}
                      onClick={handleAdd}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function IssuePOForm({ prId, onSuccess }) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    issued_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: '',
    notes: '',
  })
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const { data: lots = [], isLoading: lotsLoading } = useQuery({
    queryKey: ['lots', prId],
    queryFn: () => api.get(`/lots/pr/${prId}`).then(r => r.data),
  })

  const awarded = lots.filter(l => l.status === 'awarded')
  const totalAmount = awarded.reduce((sum, l) => sum + parseFloat(l.awarded_amount || 0), 0)
  const supplierNames = [...new Set(awarded.map(l => l.awarded_to).filter(Boolean))]
  const primarySupplier = supplierNames.length === 1
    ? awarded.find(l => l.awarded_to === supplierNames[0])
    : null

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post('/po', body),
    onSuccess: ({ data }) => {
      toast.success(`PO ${data.po_number} issued successfully`)
      qc.invalidateQueries({ queryKey: ['pr', prId] })
      qc.invalidateQueries({ queryKey: ['pr-list'] })
      qc.invalidateQueries({ queryKey: ['pr-stats'] })
      onSuccess?.()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to issue PO'),
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!primarySupplier && !supplierNames.length) return
    mutate({
      purchase_request_id:  prId,
      supplier_name:        primarySupplier?.awarded_to    || supplierNames[0],
      supplier_contact:     primarySupplier?.supplier_contact || undefined,
      supplier_address:     primarySupplier?.supplier_address || undefined,
      total_amount:         totalAmount,
      issued_date:          form.issued_date,
      expected_delivery_date: form.expected_delivery_date || undefined,
      notes:                form.notes || undefined,
    })
  }

  if (lotsLoading) return null

  // No awarded lots yet — direct procurement to the Lots tab
  if (!awarded.length) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-5 space-y-3">
        <div className="flex items-start gap-3">
          <Gavel className="size-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">No supplier awarded yet</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Go to Lots &amp; Awards and award a supplier to this PR first.
              Once a lot is awarded, the PO details will be filled in automatically.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/bidding')}
          className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 hover:text-amber-900 transition-colors"
        >
          Go to Lots &amp; Awards <ChevronRight className="size-4" />
        </button>
      </div>
    )
  }

  // Awarded — show read-only supplier card + minimal date inputs
  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* Read-only supplier info pulled from the awarded lot */}
      <div className="rounded-xl border border-[--color-border] bg-[--color-canvas] divide-y divide-[--color-border]">
        <div className="px-4 py-3 flex items-center gap-2">
          <Trophy className="size-4 text-emerald-600 shrink-0" />
          <p className="text-xs font-bold text-[--color-text-secondary] uppercase tracking-wide">
            Awarded Supplier — auto-filled from lot
          </p>
        </div>
        <div className="px-4 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 flex items-start gap-3">
            <Building2 className="size-4 text-[--color-text-muted] shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide">Supplier Name</p>
              <p className="text-sm font-bold text-[--color-text-primary] mt-0.5">
                {primarySupplier?.awarded_to || supplierNames.join(', ')}
              </p>
            </div>
          </div>
          {primarySupplier?.supplier_contact && (
            <div className="flex items-start gap-3">
              <Phone className="size-4 text-[--color-text-muted] shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide">Contact</p>
                <p className="text-sm text-[--color-text-primary] mt-0.5">{primarySupplier.supplier_contact}</p>
              </div>
            </div>
          )}
          {primarySupplier?.supplier_address && (
            <div className="flex items-start gap-3">
              <MapPin className="size-4 text-[--color-text-muted] shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide">Address</p>
                <p className="text-sm text-[--color-text-primary] mt-0.5">{primarySupplier.supplier_address}</p>
              </div>
            </div>
          )}
          <div className="sm:col-span-2 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Total Amount:</p>
            <p className="text-sm font-bold text-emerald-800 tabular-nums">{fmtCurrency(totalAmount)}</p>
          </div>
        </div>
      </div>

      {/* Only ask for what lots don't provide */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Issued Date *</Label>
          <Input type="date" value={form.issued_date} onChange={e => setF('issued_date', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Expected Delivery Date</Label>
          <Input type="date" value={form.expected_delivery_date} onChange={e => setF('expected_delivery_date', e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Notes <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span></Label>
          <Input placeholder="Any additional notes for this PO" value={form.notes} onChange={e => setF('notes', e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} className="gap-2">
          <ShoppingCart className="size-4" />
          {isPending ? 'Issuing…' : 'Issue Purchase Order'}
        </Button>
      </div>
    </form>
  )
}

function UpdateDeliveryForm({ po, onSuccess }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    delivery_status: po.delivery_status,
    delivery_date:   po.delivery_date || '',
    delivery_notes:  po.delivery_notes || '',
  })
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.patch(`/po/${po.id}/delivery`, body),
    onSuccess: () => {
      toast.success('Delivery status updated')
      qc.invalidateQueries({ queryKey: ['pr', po.purchase_request_id] })
      qc.invalidateQueries({ queryKey: ['pr-list'] })
      qc.invalidateQueries({ queryKey: ['pr-stats'] })
      onSuccess?.()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update delivery'),
  })

  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label>Delivery Status *</Label>
          <Select value={form.delivery_status} onValueChange={v => setF('delivery_status', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending Delivery</SelectItem>
              <SelectItem value="partial">Partial Delivery</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Delivery Date</Label>
          <Input type="date" value={form.delivery_date} onChange={e => setF('delivery_date', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Delivery Notes</Label>
          <Input placeholder="Optional notes" value={form.delivery_notes} onChange={e => setF('delivery_notes', e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => mutate(form)} disabled={isPending} className="gap-2">
          <Truck className="size-4" />
          {isPending ? 'Saving…' : 'Update Delivery'}
        </Button>
      </div>
    </div>
  )
}

export default function PRDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc       = useQueryClient()

  const { data: pr, isLoading, isError } = useQuery({
    queryKey: ['pr', id],
    queryFn: () => api.get(`/pr/${id}`).then(r => r.data),
    retry: 1,
  })

  const { mutate: updateStatus, isPending } = useMutation({
    mutationFn: ({ status, notes }) => api.patch(`/pr/${id}/status`, { status, notes }),
    onSuccess: () => {
      toast.success('Status updated')
      qc.invalidateQueries({ queryKey: ['pr', id] })
      qc.invalidateQueries({ queryKey: ['pr-list'] })
      qc.invalidateQueries({ queryKey: ['pr-stats'] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update status'),
  })

  const canManage   = ['admin', 'procurement'].includes(user?.role)
  const isExtension = user?.role === 'extension'

  const openPDF = async (endpoint, label) => {
    try {
      const res = await api.get(endpoint, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch { toast.error(`Failed to open ${label}`) }
  }

  const downloadPRForm   = () => openPDF(`/pr/${id}/pdf`,       'PR Form')
  const downloadAbstract = () => openPDF(`/lots/pr/${id}/pdf`,  'Abstract of Quotations')

  // Server-backed read set. Fetched only for procurement/admin (the role that
  // sees the "new submission" banner).
  const { data: readSet } = useQuery({
    queryKey: ['pr-reads', user?.id],
    queryFn: () => api.get('/pr/reads').then(r => new Set(r.data.map(String))),
    enabled: !!canManage && !!user,
    staleTime: 60_000,
  })

  // Snapshot whether this PR was unread when we first arrived — drives the
  // banner so it doesn't disappear the moment markRead resolves.
  const [isNewForProcurement, setIsNewForProcurement] = useState(false)
  const newSnapshotTaken = useRef(false)
  useEffect(() => {
    if (newSnapshotTaken.current || !canManage || !readSet || !id) return
    setIsNewForProcurement(!readSet.has(String(id)))
    newSnapshotTaken.current = true
  }, [readSet, canManage, id])

  const { mutate: markReadOnServer } = useMutation({
    mutationFn: () => api.post(`/pr/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pr-reads', user?.id] }),
  })

  useEffect(() => {
    if (canManage && user && pr?.id) markReadOnServer()
  }, [pr?.id])

  const { mutate: approvePO, isPending: approving } = useMutation({
    mutationFn: () => api.patch(`/po/${pr?.po?.id}/approve`),
    onSuccess: () => {
      toast.success('PO approved')
      qc.invalidateQueries({ queryKey: ['pr', id] })
      qc.invalidateQueries({ queryKey: ['po-list'] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to approve PO'),
  })

  const [reminded, setReminded] = useState(false)
  const { mutate: sendReminder, isPending: reminding } = useMutation({
    mutationFn: () => api.post(`/pr/${id}/remind`),
    onSuccess: () => {
      toast.success('Reminder sent to procurement team')
      setReminded(true)
      setTimeout(() => setReminded(false), 60_000)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to send reminder'),
  })

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-60 rounded-xl" />
    </div>
  )

  if (isError || !pr) return (
    <div className="text-center py-20">
      <FileText className="size-10 text-[--color-text-muted] mx-auto mb-3" />
      <p className="text-ui-md font-semibold text-[--color-text-primary]">Purchase request not found</p>
      <Button variant="outline" size="sm" className="mt-5" onClick={() => navigate('/pr')}>Back to list</Button>
    </div>
  )

  return (
    <div className="space-y-5">

      {/* New submission banner — only shown if procurement had not yet viewed this PR */}
      {isNewForProcurement && pr.status === 'submitted' && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="size-2.5 rounded-full bg-amber-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">New submission — not yet reviewed</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Submitted by <strong>{pr.created_by_name}</strong> on {fmtDate(pr.created_at)}
            </p>
          </div>
          <Eye className="size-4 text-amber-500 shrink-0" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-ui-xl font-bold text-[--color-text-primary] font-mono">{pr.pr_number}</h2>
            <PRStatusBadge status={pr.status} />
            {pr.po && <DeliveryStatusBadge status={pr.po.delivery_status} />}
          </div>
          {pr.title && <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">{pr.title}</p>}
          <p className="text-ui-xs text-[--color-text-muted] mt-0.5">
            {pr.quarter_label && <span className="font-medium text-[--color-text-secondary]">{pr.quarter_label} {pr.quarter_year} · </span>}
            Created by {pr.created_by_name} · {fmtDate(pr.created_at)}
          </p>
        </div>
        {isExtension && (
          <Button
            variant="outline" size="sm"
            className="gap-2 shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => sendReminder()}
            disabled={reminding || reminded}
          >
            <BellRing className="size-4" />
            {reminded ? 'Reminder Sent' : reminding ? 'Sending…' : 'Remind Procurement'}
          </Button>
        )}
        {canManage && pr.status === 'submitted' && (
          <Button
            size="sm"
            className="gap-2 shrink-0 bg-blue-600 hover:bg-blue-700"
            onClick={() => updateStatus({ status: 'bidding' })}
            disabled={isPending}
          >
            <ClipboardList className="size-4" />
            {isPending ? 'Processing…' : 'Canvass PR'}
          </Button>
        )}
        {canManage && pr.status === 'for_po' && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => updateStatus({ status: 'bidding', notes: 'Recanvass initiated by procurement' })}
            disabled={isPending}
            title="Return to canvassing — awarded lots will be cleared manually in Lots & Awards"
          >
            <RotateCcw className="size-4" />
            {isPending ? 'Processing…' : 'Recanvass'}
          </Button>
        )}
        {/* Download buttons */}
        <button
          onClick={downloadPRForm}
          title="Download PR Form"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[--color-border] text-xs font-medium text-[--color-text-secondary] hover:text-[--color-brand] hover:border-[--color-brand] transition-colors shrink-0"
        >
          <FileDown className="size-3.5" /> PR Form
        </button>
        {pr.status !== 'draft' && pr.status !== 'submitted' && (
          <button
            onClick={downloadAbstract}
            title="Download Abstract of Quotations"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[--color-border] text-xs font-medium text-[--color-text-secondary] hover:text-[--color-brand] hover:border-[--color-brand] transition-colors shrink-0"
          >
            <FileDown className="size-3.5" /> Abstract
          </button>
        )}

        {canManage && (
          <div className="shrink-0 w-44">
            <Select value={pr.status} onValueChange={(status) => updateStatus({ status })} disabled={isPending}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PR_STATUSES.map(s => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* PR Details */}
      {(pr.fund_cluster || pr.responsibility_center_code || pr.notes) && (
        <Card>
          <CardHeader><CardTitle>PR Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pr.fund_cluster && (
              <div>
                <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Fund Cluster</p>
                <p className="text-ui-sm text-[--color-text-primary] font-medium mt-0.5">{pr.fund_cluster}</p>
              </div>
            )}
            {pr.responsibility_center_code && (
              <div>
                <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Responsibility Center Code</p>
                <p className="text-ui-sm text-[--color-text-primary] font-medium mt-0.5">{pr.responsibility_center_code}</p>
              </div>
            )}
            {pr.notes && (
              <div className="sm:col-span-2">
                <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Notes</p>
                <p className="text-ui-sm text-[--color-text-secondary] mt-0.5 leading-relaxed">{pr.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Items Requested */}
      <PRItemsSection prId={id} canEdit={['admin', 'procurement', 'extension'].includes(user?.role)} />

      {/* Lots & Bidding */}
      <LotsSection prId={id} canManage={canManage} />

      {/* PO Section */}
      {(canManage || isExtension) && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <ShoppingCart className="size-4 text-[--color-text-muted]" />
            <CardTitle>Purchase Order</CardTitle>
            {pr.po?.po_status && <POStatusBadge status={pr.po.po_status} />}
          </CardHeader>
          <CardContent>
            {pr.po ? (
              <div className="space-y-5">

                {/* Pending banner — extension view */}
                {pr.po.po_status === 'pending_approval' && isExtension && (
                  <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <Clock className="size-4 text-amber-600 shrink-0" />
                    <p className="text-sm text-amber-800">
                      The PO has been submitted and is <strong>awaiting procurement approval</strong>.
                    </p>
                  </div>
                )}

                {/* Approve action — procurement view */}
                {pr.po.po_status === 'pending_approval' && canManage && (
                  <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 text-amber-600 shrink-0" />
                      <p className="text-sm text-amber-800">
                        This PO is <strong>pending your approval</strong>.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 shrink-0"
                      disabled={approving}
                      onClick={() => approvePO()}
                    >
                      <CheckCircle2 className="size-3.5" />
                      {approving ? 'Approving…' : 'Approve PO'}
                    </Button>
                  </div>
                )}

                {/* PO Info grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-xl border border-[--color-border] bg-[--color-surface] p-4">
                  <div>
                    <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">PO Number</p>
                    <p className="text-ui-sm font-bold text-[--color-brand] font-mono mt-0.5">{pr.po.po_number}</p>
                  </div>
                  <div>
                    <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Supplier</p>
                    <p className="text-ui-sm font-semibold text-[--color-text-primary] mt-0.5">{pr.po.supplier_name}</p>
                  </div>
                  <div>
                    <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Total Amount</p>
                    <p className="text-ui-sm font-bold text-emerald-700 mt-0.5">{fmtCurrency(pr.po.total_amount)}</p>
                  </div>
                  <div>
                    <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Issued Date</p>
                    <p className="text-ui-sm font-medium text-[--color-text-primary] mt-0.5">{fmtDate(pr.po.issued_date)}</p>
                  </div>
                  {pr.po.expected_delivery_date && (
                    <div>
                      <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Expected Delivery</p>
                      <p className="text-ui-sm font-medium text-[--color-text-primary] mt-0.5">{fmtDate(pr.po.expected_delivery_date)}</p>
                    </div>
                  )}
                  {pr.po.supplier_contact && (
                    <div>
                      <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Supplier Contact</p>
                      <p className="text-ui-sm font-medium text-[--color-text-primary] mt-0.5">{pr.po.supplier_contact}</p>
                    </div>
                  )}
                  {pr.po.delivery_date && (
                    <div>
                      <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Delivery Date</p>
                      <p className="text-ui-sm font-medium text-[--color-text-primary] mt-0.5">{fmtDate(pr.po.delivery_date)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Delivery Status</p>
                    <div className="mt-1"><DeliveryStatusBadge status={pr.po.delivery_status} /></div>
                  </div>
                </div>
                {pr.po.delivery_notes && (
                  <p className="text-ui-xs text-[--color-text-secondary] leading-relaxed">{pr.po.delivery_notes}</p>
                )}

                {/* Delivery update — procurement only, after approval */}
                {canManage && pr.po.po_status === 'approved' && (
                  <div className="border-t border-[--color-border] pt-4">
                    <p className="text-ui-sm font-semibold text-[--color-text-primary] mb-3 flex items-center gap-2">
                      <Truck className="size-4 text-[--color-text-muted]" /> Update Delivery
                    </p>
                    <UpdateDeliveryForm po={pr.po} />
                  </div>
                )}
              </div>
            ) : canManage ? (
              <div>
                <IssuePOForm prId={parseInt(id)} />
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-[--color-border] bg-[--color-canvas] px-4 py-4">
                <Clock className="size-4 text-[--color-text-muted] shrink-0" />
                <p className="text-ui-sm text-[--color-text-secondary]">
                  No purchase order has been issued for this PR yet. Procurement will issue the PO after all lots are awarded.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Delivery info for supply officers */}
      {user?.role === 'supply' && pr.po && pr.po.po_status === 'approved' && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Truck className="size-4 text-[--color-text-muted]" />
            <CardTitle>Delivery Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 flex-wrap">
              <DeliveryStatusBadge status={pr.po.delivery_status} />
              {pr.po.delivery_date && (
                <span className="text-ui-sm text-[--color-text-secondary]">
                  Delivered on {fmtDate(pr.po.delivery_date)}
                </span>
              )}
              {pr.po.expected_delivery_date && pr.po.delivery_status !== 'delivered' && (
                <span className="flex items-center gap-1 text-ui-xs text-[--color-text-muted]">
                  <Clock className="size-3" /> Expected {fmtDate(pr.po.expected_delivery_date)}
                </span>
              )}
            </div>
            {pr.po.delivery_notes && (
              <p className="text-ui-sm text-[--color-text-secondary] mt-2 leading-relaxed">{pr.po.delivery_notes}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Attachments */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Paperclip className="size-4 text-[--color-text-muted]" />
          <CardTitle>Attachments</CardTitle>
        </CardHeader>
        <CardContent>
          <AttachmentsPanel
            endpoint={`/pr/${id}`}
            queryKey={`pr-attachments-${id}`}
            canUpload={true}
            canDelete={canManage}
          />
        </CardContent>
      </Card>

      {/* Activity Log */}
      <ActivityLog prId={id} />
    </div>
  )
}

function ActivityLog({ prId }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['pr-logs', prId],
    queryFn: () => api.get(`/pr/${prId}/logs`).then(r => r.data),
  })

  if (!isLoading && logs.length === 0) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <History className="size-4 text-[--color-text-muted]" />
        <CardTitle>Activity Log</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : (
          <div className="relative pl-5">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[--color-border]" />
            {logs.map((log, i) => (
              <div key={log.id} className="relative mb-4 last:mb-0">
                <div className="absolute -left-5 top-1 size-3.5 rounded-full border-2 border-[--color-brand] bg-white" />
                <div className="rounded-lg border border-[--color-border] bg-[--color-surface] px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {log.from_status && (
                      <>
                        <span className="text-xs font-medium text-[--color-text-muted]">
                          {PR_STATUS_LABELS[log.from_status] || log.from_status}
                        </span>
                        <span className="text-[--color-text-muted]">→</span>
                      </>
                    )}
                    <span className="text-xs font-semibold text-[--color-brand]">
                      {PR_STATUS_LABELS[log.to_status] || log.to_status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[10px] text-[--color-text-muted]">by {log.changed_by_name}</span>
                    <span className="text-[10px] text-[--color-text-muted]">·</span>
                    <span className="text-[10px] text-[--color-text-muted]">{fmtDate(log.created_at)}</span>
                  </div>
                  {log.note && (
                    <p className="text-[10px] text-[--color-text-secondary] mt-1 italic">{log.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

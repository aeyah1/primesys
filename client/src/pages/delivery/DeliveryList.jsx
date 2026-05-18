import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router-dom'
import {
  Plus, Pencil, Search, AlertTriangle, Trash2,
  Package, CheckCircle, Clock, TruckIcon, Paperclip, Send, FileDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import { fmtDate } from '@/lib/utils'
import api from '@/lib/axios'

const EMPTY_FORM = { po_id: '', delivered_date: '', expected_date: '', status: 'complete', notes: '' }

const TABS = [
  { key: 'all',      label: 'All' },
  { key: 'complete', label: 'Complete' },
  { key: 'partial',  label: 'Partial' },
  { key: 'overdue',  label: 'Overdue' },
]

export default function DeliveryList() {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const qc        = useQueryClient()

  const [search, setSearch]         = useState('')
  const [tab, setTab]               = useState('all')
  const [open, setOpen]             = useState(false)
  const [editing, setEditing]       = useState(null)
  const [deleting, setDeleting]     = useState(null)
  const [attachDelivery, setAttachDelivery] = useState(null)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [supplyUpdate, setSupplyUpdate] = useState(null)
  const [supplyForm, setSupplyForm] = useState({ status: 'complete', notes: '' })

  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ['deliveries', search],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      params.set('limit', '200')
      return api.get(`/delivery?${params}`).then(r => r.data?.data ?? [])
    },
  })

  const { data: pos = [] } = useQuery({
    queryKey: ['po-list'],
    queryFn: () => api.get('/po').then(r => r.data?.data ?? []),
  })

  const canRecord = ['procurement', 'admin'].includes(user?.role)
  const isSupply  = user?.role === 'supply'

  const downloadIAR = async (d) => {
    try {
      const res = await api.get(`/delivery/${d.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch { toast.error('Failed to open IAR') }
  }
  const today     = new Date().toISOString().slice(0, 10)

  const isOverdue = (d) =>
    d.expected_delivery_date &&
    d.status !== 'complete' &&
    d.expected_delivery_date < today

  // Stats (from full search result, before tab filter)
  const stats = useMemo(() => ({
    total:    deliveries.length,
    complete: deliveries.filter(d => d.status === 'complete').length,
    partial:  deliveries.filter(d => d.status === 'partial').length,
    overdue:  deliveries.filter(d => isOverdue(d)).length,
  }), [deliveries, today])

  // Tab filter
  const filtered = useMemo(() => deliveries.filter(d => {
    if (tab === 'complete') return d.status === 'complete'
    if (tab === 'partial')  return d.status === 'partial'
    if (tab === 'overdue')  return isOverdue(d)
    return true
  }), [deliveries, tab, today])

  const selectedPO = pos.find(p => String(p.id) === form.po_id)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['deliveries'] })
    qc.invalidateQueries({ queryKey: ['pr-stats'] })
    qc.invalidateQueries({ queryKey: ['po-list'] })
  }

  const { mutate: record, isPending: isRecording } = useMutation({
    mutationFn: (body) => api.post('/delivery', body),
    onSuccess: () => { toast.success('Delivery recorded'); invalidate(); closeDialog() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to record delivery'),
  })

  const { mutate: update, isPending: isUpdating } = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/delivery/${id}`, body),
    onSuccess: () => { toast.success('Delivery updated'); invalidate(); closeDialog() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update delivery'),
  })

  const { mutate: remove, isPending: isRemoving } = useMutation({
    mutationFn: (id) => api.delete(`/delivery/${id}`),
    onSuccess: () => { toast.success('Delivery record removed'); invalidate(); setDeleting(null) },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove delivery'),
  })

  const { mutate: supplyUpdateMutate, isPending: isSendingUpdate } = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/delivery/${id}/supply-update`, body),
    onSuccess: () => {
      toast.success('Update sent to procurement and extension')
      invalidate()
      setSupplyUpdate(null)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to send update'),
  })

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setOpen(true) }
  const openEdit   = (d) => {
    setEditing(d)
    setForm({
      po_id: String(d.po_id),
      delivered_date: d.delivered_date?.slice(0, 10) ?? '',
      expected_date:  d.expected_delivery_date?.slice(0, 10) ?? '',
      status: d.status,
      notes: d.notes ?? '',
    })
    setOpen(true)
  }
  const closeDialog = () => { setOpen(false); setEditing(null); setForm(EMPTY_FORM) }

  const handleSubmit = () => {
    if (editing) update({ id: editing.id, body: { delivered_date: form.delivered_date, status: form.status, notes: form.notes } })
    else record(form)
  }

  const isSaving  = isRecording || isUpdating
  const canSubmit = editing ? !!form.delivered_date : !!form.po_id && !!form.delivered_date

  const STAT_CARDS = [
    { label: 'Total Deliveries', value: stats.total,    icon: TruckIcon,     bg: 'bg-blue-50',    color: 'text-blue-600' },
    { label: 'Complete',         value: stats.complete, icon: CheckCircle,   bg: 'bg-emerald-50', color: 'text-emerald-600' },
    { label: 'Partial',          value: stats.partial,  icon: Package,       bg: 'bg-amber-50',   color: 'text-amber-600' },
    { label: 'Overdue',          value: stats.overdue,  icon: AlertTriangle, bg: 'bg-red-50',     color: 'text-red-600' },
  ]

  return (
    <div className="space-y-4">

      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 card-grid">
        {STAT_CARDS.map(({ label, value, icon: Icon, bg, color }) => (
          <Card key={label} className="cursor-pointer hover:shadow-sm transition-shadow"
            onClick={() => setTab(label === 'Total Deliveries' ? 'all' : label.toLowerCase())}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${bg}`}>
                <Icon className={`size-5 ${color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-[--color-text-primary] leading-none">{value}</p>
                <p className="text-xs text-[--color-text-muted] mt-1">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input
            placeholder="Search PO, PR, project or supplier…"
            value={search}
            onChange={e => { setSearch(e.target.value); setTab('all') }}
            className="pl-9"
          />
        </div>
        {canRecord && (
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Record Delivery
          </Button>
        )}
      </div>

      {/* Status tabs + table */}
      <Card>
        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-[--color-border]">
          {TABS.map(t => {
            const count = t.key === 'all' ? stats.total
              : t.key === 'complete' ? stats.complete
              : t.key === 'partial'  ? stats.partial
              : stats.overdue
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors mb-[-1px] ${
                  tab === t.key
                    ? 'border-[--color-brand] text-[--color-brand]'
                    : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
                }`}
              >
                {t.label}
                {count > 0 && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${
                    tab === t.key
                      ? 'bg-[--color-brand-light] text-[--color-brand]'
                      : 'bg-[--color-surface-raised] text-[--color-text-muted]'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO / Supplier</TableHead>
                <TableHead>PR / Project</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Received By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      {Array(8).fill(0).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : filtered.length === 0
                  ? <TableEmpty
                      colSpan={8}
                      message={tab === 'all' ? 'No deliveries recorded yet.' : `No ${tab} deliveries.`}
                    />
                  : filtered.map(d => {
                      const overdue = isOverdue(d)
                      return (
                        <TableRow
                          key={d.id}
                          className={
                            overdue
                              ? 'bg-red-50/60 hover:bg-red-50 border-l-2 border-l-red-400'
                              : d.status === 'partial'
                                ? 'bg-amber-50/50 hover:bg-amber-50'
                                : undefined
                          }
                        >
                          {/* PO / Supplier */}
                          <TableCell>
                            <button
                              onClick={() => navigate(`/po?search=${encodeURIComponent(d.po_number)}`)}
                              className="font-semibold text-[--color-brand] hover:underline text-left leading-tight block"
                            >
                              {d.po_number}
                            </button>
                            <span className="text-xs text-[--color-text-muted] mt-0.5 block">{d.supplier_name}</span>
                          </TableCell>

                          {/* PR / Project */}
                          <TableCell>
                            <Link
                              to={`/pr/${d.pr_id || '#'}`}
                              className="text-sm font-medium text-[--color-text-primary] hover:text-[--color-brand] hover:underline leading-tight block"
                            >
                              {d.pr_number}
                            </Link>
                            <span className="text-xs text-[--color-text-muted] mt-0.5 block truncate max-w-44" title={d.project_name}>
                              {d.project_name}
                            </span>
                          </TableCell>

                          {/* Expected */}
                          <TableCell>
                            {d.expected_delivery_date ? (
                              <span className={`text-sm font-medium flex items-center gap-1 ${overdue ? 'text-red-600' : 'text-[--color-text-secondary]'}`}>
                                {overdue && <AlertTriangle className="size-3.5 shrink-0" />}
                                {fmtDate(d.expected_delivery_date)}
                              </span>
                            ) : (
                              <span className="text-[--color-text-muted] text-xs">—</span>
                            )}
                            {overdue && (
                              <span className="text-xs text-red-500 block mt-0.5">
                                {Math.floor((new Date(today) - new Date(d.expected_delivery_date)) / 86400000)}d overdue
                              </span>
                            )}
                          </TableCell>

                          {/* Delivered Date */}
                          <TableCell className="text-[--color-text-secondary] text-sm">
                            {d.delivered_date ? fmtDate(d.delivered_date) : <span className="text-[--color-text-muted]">—</span>}
                          </TableCell>

                          {/* Received By */}
                          <TableCell className="text-[--color-text-secondary] text-sm">
                            {d.received_by_name}
                          </TableCell>

                          {/* Status */}
                          <TableCell>
                            <DeliveryStatusBadge status={d.status} />
                          </TableCell>

                          {/* Notes */}
                          <TableCell className="max-w-44">
                            {d.notes
                              ? <span className="truncate block text-xs text-[--color-text-muted]" title={d.notes}>{d.notes}</span>
                              : <span className="text-[--color-text-muted] text-xs">—</span>
                            }
                          </TableCell>

                          {/* Actions */}
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {isSupply ? (
                                <>
                                  <button
                                    onClick={() => downloadIAR(d)}
                                    className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors"
                                    title="Download IAR"
                                  >
                                    <FileDown className="size-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setSupplyUpdate(d)
                                      setSupplyForm({ status: d.status, notes: d.notes ?? '' })
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-[--color-brand] hover:bg-[--color-brand-light] transition-colors"
                                    title="Send delivery update"
                                  >
                                    <Send className="size-3.5" /> Update
                                  </button>
                                </>
                              ) : canRecord ? (
                                <>
                                  <button
                                    onClick={() => downloadIAR(d)}
                                    className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors"
                                    title="Download IAR"
                                  >
                                    <FileDown className="size-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setAttachDelivery(d)}
                                    className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors"
                                    title="Attachments / Invoice"
                                  >
                                    <Paperclip className="size-3.5" />
                                  </button>
                                  <button
                                    onClick={() => openEdit(d)}
                                    className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-text-primary] hover:bg-[--color-overlay] transition-colors"
                                    title="Edit"
                                  >
                                    <Pencil className="size-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setDeleting(d)}
                                    className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors"
                                    title="Remove"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
              }
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Record / Edit Dialog */}
      <Dialog open={open} onOpenChange={closeDialog}>
        <DialogContent
          title={editing ? 'Edit Delivery' : 'Record Delivery'}
          description={editing
            ? `Updating delivery for ${editing.po_number}`
            : 'Confirm receipt of goods for a purchase order.'
          }
        >
          <div className="space-y-4">
            {/* PO selector (create only) */}
            {!editing && (
              <div className="space-y-1.5">
                <Label>Purchase Order <span className="text-red-500">*</span></Label>
                <Select value={form.po_id} onValueChange={v => {
                  const po = pos.find(p => String(p.id) === v)
                  setForm(p => ({
                    ...p,
                    po_id: v,
                    expected_date: p.expected_date || po?.expected_delivery_date?.slice(0, 10) || '',
                  }))
                }}>
                  <SelectTrigger><SelectValue placeholder="Select a PO" /></SelectTrigger>
                  <SelectContent>
                    {pos
                      .filter(p => ['pending', 'partial'].includes(p.delivery_status) || !p.delivery_status)
                      .map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.po_number} — {p.supplier_name}
                        </SelectItem>
                      ))
                    }
                  </SelectContent>
                </Select>
                {/* Selected PO preview */}
                {selectedPO && (
                  <div className="rounded-lg border border-[--color-border] bg-[--color-surface] p-3 text-xs space-y-1 mt-1">
                    <div className="flex justify-between">
                      <span className="text-[--color-text-muted]">Supplier</span>
                      <span className="font-medium text-[--color-text-primary]">{selectedPO.supplier_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[--color-text-muted]">PR Number</span>
                      <span className="font-medium text-[--color-text-primary]">{selectedPO.pr_number}</span>
                    </div>
                    {selectedPO.expected_delivery_date && (
                      <div className="flex justify-between">
                        <span className="text-[--color-text-muted]">Expected by</span>
                        <span className={`font-medium ${selectedPO.expected_delivery_date < today ? 'text-red-600' : 'text-[--color-text-primary]'}`}>
                          {fmtDate(selectedPO.expected_delivery_date)}
                          {selectedPO.expected_delivery_date < today && ' (overdue)'}
                        </span>
                      </div>
                    )}
                    {selectedPO.delivery_status === 'partial' && (
                      <div className="flex items-center gap-1.5 pt-1 text-amber-700 font-medium">
                        <Package className="size-3" />
                        Partial delivery already recorded
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Dates row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>
                  Delivered Date <span className="text-red-500">*</span>
                  <span className="ml-1 text-[--color-text-muted] font-normal text-xs">(today: {fmtDate(today)})</span>
                </Label>
                <Input
                  type="date"
                  value={form.delivered_date}
                  max={today}
                  onChange={e => setForm(p => ({ ...p, delivered_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Expected Date
                  <span className="ml-1 text-[--color-text-muted] font-normal text-xs">(optional)</span>
                </Label>
                <Input
                  type="date"
                  value={form.expected_date}
                  onChange={e => setForm(p => ({ ...p, expected_date: e.target.value }))}
                />
              </div>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label>Delivery Status</Label>
              <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="complete">
                    <span className="flex items-center gap-2">
                      <CheckCircle className="size-3.5 text-emerald-600" /> Complete — all items received
                    </span>
                  </SelectItem>
                  <SelectItem value="partial">
                    <span className="flex items-center gap-2">
                      <Package className="size-3.5 text-amber-600" /> Partial — some items still pending
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>
                Notes
                {form.status === 'partial' && (
                  <span className="ml-1 text-amber-600 font-normal text-xs">— required for partial deliveries</span>
                )}
              </Label>
              <textarea
                className="w-full min-h-[80px] rounded-md border border-[--color-border] bg-[--color-canvas] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand]/30 focus:border-[--color-brand] resize-none transition"
                placeholder={form.status === 'partial'
                  ? 'e.g. 3 of 5 units received, remaining expected next week…'
                  : 'Any remarks about the delivery, condition of goods, etc…'}
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={closeDialog}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSaving || !canSubmit}>
              {isSaving
                ? (editing ? 'Saving…' : 'Recording…')
                : (editing ? 'Save Changes' : 'Confirm Delivery')
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attachments dialog */}
      <Dialog open={!!attachDelivery} onOpenChange={(o) => { if (!o) setAttachDelivery(null) }}>
        <DialogContent title={`Attachments — ${attachDelivery?.po_number}`} description="Upload invoices or proof of delivery documents.">
          <div className="pt-1">
            {attachDelivery && (
              <AttachmentsPanel
                endpoint={`/delivery/${attachDelivery.id}`}
                queryKey={`delivery-attachments-${attachDelivery.id}`}
                canUpload={true}
                canDelete={['admin', 'procurement'].includes(user?.role)}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAttachDelivery(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supply Officer Update Dialog */}
      <Dialog open={!!supplyUpdate} onOpenChange={(o) => { if (!o) setSupplyUpdate(null) }}>
        <DialogContent
          title="Send Delivery Update"
          description={supplyUpdate ? `${supplyUpdate.po_number} · ${supplyUpdate.supplier_name}` : ''}
        >
          <div className="space-y-4 pt-1">
            <div className="rounded-lg border border-[--color-border] bg-[--color-canvas] p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-[--color-text-muted]">PR</span>
                <span className="font-medium">{supplyUpdate?.pr_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[--color-text-muted]">Supplier</span>
                <span className="font-medium">{supplyUpdate?.supplier_name}</span>
              </div>
              {supplyUpdate?.expected_delivery_date && (
                <div className="flex justify-between">
                  <span className="text-[--color-text-muted]">Expected</span>
                  <span className="font-medium">{fmtDate(supplyUpdate.expected_delivery_date)}</span>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Delivery Status</Label>
              <Select value={supplyForm.status} onValueChange={v => setSupplyForm(p => ({ ...p, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="complete">
                    <span className="flex items-center gap-2">
                      <CheckCircle className="size-3.5 text-emerald-600" /> Complete — all items received
                    </span>
                  </SelectItem>
                  <SelectItem value="partial">
                    <span className="flex items-center gap-2">
                      <Package className="size-3.5 text-amber-600" /> Partial — some items still pending
                    </span>
                  </SelectItem>
                  <SelectItem value="pending">
                    <span className="flex items-center gap-2">
                      <Clock className="size-3.5 text-[--color-text-muted]" /> Pending — not yet received
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Notes / Remarks</Label>
              <textarea
                className="w-full min-h-[90px] rounded-md border border-[--color-border] bg-[--color-canvas] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand]/30 focus:border-[--color-brand] resize-none transition"
                placeholder="e.g. 4 of 5 boxes received, 1 item missing, delivery condition good, etc."
                value={supplyForm.notes}
                onChange={e => setSupplyForm(p => ({ ...p, notes: e.target.value }))}
                rows={3}
              />
            </div>

            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-800">
              This will notify <strong>Procurement</strong> and the <strong>Extension Officer</strong> of the current delivery status.
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setSupplyUpdate(null)}>Cancel</Button>
            <Button
              className="gap-2"
              disabled={isSendingUpdate || !supplyForm.notes.trim()}
              onClick={() => supplyUpdateMutate({ id: supplyUpdate.id, body: supplyForm })}
            >
              <Send className="size-3.5" />
              {isSendingUpdate ? 'Sending…' : 'Send Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null) }}>
        <DialogContent title="Remove Delivery Record">
          <div className="pt-2 space-y-3">
            <p className="text-sm text-[--color-text-secondary]">
              Remove the delivery record for{' '}
              <span className="font-semibold text-[--color-text-primary]">{deleting?.po_number}</span>?
            </p>
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
              This will revert the PR status back to <strong>Waiting for Delivery</strong>. This action cannot be undone.
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={isRemoving}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white border-0"
              onClick={() => remove(deleting.id)}
              disabled={isRemoving}
            >
              {isRemoving ? 'Removing…' : 'Remove Record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Gavel, Trophy, ChevronDown, ChevronRight, FileText,
  ShoppingCart, Plus, Trash2, Package, Pencil,
  Phone, Mail, MapPin, CreditCard, User,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { LotStatusBadge } from '@/components/shared/StatusBadge'
import { fmtCurrency } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const UNITS = ['pax', 'pc', 'set', 'lot', 'pair', 'ream', 'box', 'unit', 'kg', 'L', 'roll', 'pack', 'bottle', 'can', 'sheet', 'bag', 'sack', 'bundle']
const EMPTY_ITEM = { item_name: '', quantity: '1', unit: 'pax', estimated_cost: '' }

const EMPTY_SUPPLIER = {
  awarded_to:       '',
  awarded_amount:   '',
  supplier_contact: '',
  supplier_phone:   '',
  supplier_email:   '',
  supplier_address: '',
  supplier_tin:     '',
}

const STATUS_TABS = [
  { key: 'all',       label: 'All' },
  { key: 'awarded',   label: 'Awarded' },
  { key: 'cancelled', label: 'Cancelled' },
]

const ITH = ({ children, className = '' }) => (
  <th className={`px-4 py-3 text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider bg-[--color-canvas] ${className}`}>
    {children}
  </th>
)
const ITD = ({ children, className = '' }) => (
  <td className={`px-4 py-3.5 text-sm ${className}`}>{children}</td>
)

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[11px] text-emerald-700 font-medium">{label}</p>
        <p className="text-sm text-emerald-900 font-semibold break-words">{value}</p>
      </div>
    </div>
  )
}

/* ── Supplier Form Fields (shared between create & edit) ─────────── */
function SupplierFields({ form, setF }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Supplier / Contractor Name <span className="text-[--color-brand] text-xs">*</span></Label>
        <Input
          placeholder="e.g. ABC Trading & Supply Co."
          value={form.awarded_to}
          onChange={e => setF('awarded_to', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>
            Contract Amount (₱){' '}
            <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>
          </Label>
          <Input
            type="number" min="0" step="any" placeholder="0.00"
            value={form.awarded_amount}
            onChange={e => setF('awarded_amount', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            TIN{' '}
            <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>
          </Label>
          <Input
            placeholder="e.g. 123-456-789-000"
            value={form.supplier_tin}
            onChange={e => setF('supplier_tin', e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>
            Contact Person{' '}
            <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>
          </Label>
          <Input
            placeholder="Name of contact person"
            value={form.supplier_contact}
            onChange={e => setF('supplier_contact', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            Phone Number{' '}
            <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>
          </Label>
          <Input
            placeholder="e.g. 09xx-xxx-xxxx"
            value={form.supplier_phone}
            onChange={e => setF('supplier_phone', e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>
          Email Address{' '}
          <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>
        </Label>
        <Input
          type="email"
          placeholder="supplier@email.com"
          value={form.supplier_email}
          onChange={e => setF('supplier_email', e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          Business Address{' '}
          <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>
        </Label>
        <Input
          placeholder="Street, Barangay, City, Province"
          value={form.supplier_address}
          onChange={e => setF('supplier_address', e.target.value)}
        />
      </div>
    </div>
  )
}

/* ── Edit Supplier Dialog ─────────────────────────────────────────── */
function EditSupplierDialog({ lot, open, onClose }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    awarded_to:       lot.awarded_to       || '',
    awarded_amount:   lot.awarded_amount   || '',
    supplier_contact: lot.supplier_contact || '',
    supplier_phone:   lot.supplier_phone   || '',
    supplier_email:   lot.supplier_email   || '',
    supplier_address: lot.supplier_address || '',
    supplier_tin:     lot.supplier_tin     || '',
  })
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.patch(`/lots/${lot.id}`, body),
    onSuccess: () => {
      toast.success('Supplier details updated')
      qc.invalidateQueries({ queryKey: ['lots'] })
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update'),
  })

  const handleSave = () => {
    if (!form.awarded_to.trim()) return toast.error('Supplier name is required')
    mutate({
      status:           'awarded',
      awarded_to:       form.awarded_to.trim(),
      awarded_amount:   form.awarded_amount   ? parseFloat(form.awarded_amount) : null,
      supplier_contact: form.supplier_contact || null,
      supplier_phone:   form.supplier_phone   || null,
      supplier_email:   form.supplier_email   || null,
      supplier_address: form.supplier_address || null,
      supplier_tin:     form.supplier_tin     || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Edit Supplier Details">
        <div className="py-1">
          <SupplierFields form={form} setF={setF} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={isPending || !form.awarded_to.trim()} onClick={handleSave} className="gap-2">
            <Trophy className="size-3.5" />
            {isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Supplier Detail Card ─────────────────────────────────────────── */
function SupplierCard({ lot, canEdit, onEdit }) {
  if (!lot.awarded_to) return null
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-emerald-600">
        <p className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
          <Trophy className="size-3.5" /> Supplier / Contractor Details
        </p>
        {canEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1 text-xs text-emerald-100 hover:text-white transition-colors"
          >
            <Pencil className="size-3" /> Edit
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
        {/* Supplier name — always shown, full width */}
        <div className="sm:col-span-2 lg:col-span-3 pb-3 border-b border-emerald-200">
          <p className="text-[11px] text-emerald-700 font-medium mb-0.5">Supplier / Contractor</p>
          <p className="text-lg font-bold text-emerald-900">{lot.awarded_to}</p>
        </div>

        {lot.awarded_amount && (
          <div>
            <p className="text-[11px] text-emerald-700 font-medium mb-0.5">Contract Amount</p>
            <p className="text-base font-bold text-emerald-800 tabular-nums">{fmtCurrency(lot.awarded_amount)}</p>
          </div>
        )}

        {lot.supplier_tin && (
          <InfoRow icon={CreditCard} label="TIN" value={lot.supplier_tin} />
        )}

        {lot.supplier_contact && (
          <InfoRow icon={User} label="Contact Person" value={lot.supplier_contact} />
        )}

        {lot.supplier_phone && (
          <InfoRow icon={Phone} label="Phone Number" value={lot.supplier_phone} />
        )}

        {lot.supplier_email && (
          <div className="flex items-start gap-2.5">
            <Mail className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[11px] text-emerald-700 font-medium">Email Address</p>
              <a
                href={`mailto:${lot.supplier_email}`}
                className="text-sm text-emerald-800 font-semibold hover:underline break-all"
              >
                {lot.supplier_email}
              </a>
            </div>
          </div>
        )}

        {lot.supplier_address && (
          <div className="sm:col-span-2 lg:col-span-3 flex items-start gap-2.5 pt-3 border-t border-emerald-200">
            <MapPin className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] text-emerald-700 font-medium">Business Address</p>
              <p className="text-sm text-emerald-900 font-semibold">{lot.supplier_address}</p>
            </div>
          </div>
        )}

        {/* PR reference */}
        <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-2 pt-3 border-t border-emerald-200">
          <FileText className="size-3.5 text-emerald-600 shrink-0" />
          <p className="text-[11px] text-emerald-700 font-medium">Purchase Request</p>
          <Link
            to={`/pr/${lot.purchase_request_id}`}
            className="text-sm font-bold text-emerald-800 hover:underline ml-1"
          >
            {lot.pr_number}{lot.pr_title ? ` — ${lot.pr_title}` : ''}
          </Link>
        </div>
      </div>
    </div>
  )
}

/* ── Lot Row ──────────────────────────────────────────────────────── */
function LotRow({ lot, canManage }) {
  const qc = useQueryClient()
  const [open, setOpen]         = useState(false)
  const [editSupplier, setEdit] = useState(false)
  const [itemForm, setItemForm] = useState(EMPTY_ITEM)
  const setIF = (k, v) => setItemForm(p => ({ ...p, [k]: v }))

  const { data: lotItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['lot-items', lot.id],
    queryFn:  () => api.get(`/lots/${lot.id}/items`).then(r => r.data),
    enabled:  open,
  })

  const { mutate: addItem, isPending: addingItem } = useMutation({
    mutationFn: (body) => api.post(`/lots/${lot.id}/items`, body),
    onSuccess: () => {
      toast.success('Item added')
      qc.invalidateQueries({ queryKey: ['lot-items', lot.id] })
      setItemForm(EMPTY_ITEM)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add item'),
  })

  const { mutate: deleteItem } = useMutation({
    mutationFn: (itemId) => api.delete(`/lots/${lot.id}/items/${itemId}`),
    onSuccess: () => {
      toast.success('Item removed')
      qc.invalidateQueries({ queryKey: ['lot-items', lot.id] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove item'),
  })

  const { mutate: cancelLot, isPending: cancelling } = useMutation({
    mutationFn: () => api.patch(`/lots/${lot.id}`, { status: 'cancelled' }),
    onSuccess: () => {
      toast.success('Lot cancelled')
      qc.invalidateQueries({ queryKey: ['lots'] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to cancel lot'),
  })

  const handleAddItem = () => {
    if (!itemForm.item_name.trim()) return toast.error('Item description is required')
    addItem({
      item_name:      itemForm.item_name.trim(),
      quantity:       parseFloat(itemForm.quantity) || 1,
      unit:           itemForm.unit || undefined,
      estimated_cost: itemForm.estimated_cost ? parseFloat(itemForm.estimated_cost) : undefined,
    })
  }

  const totalCost = lotItems.reduce((s, it) =>
    s + (parseFloat(it.estimated_cost) || 0) * (parseFloat(it.quantity) || 1), 0)

  const editable = canManage && lot.status !== 'cancelled'

  return (
    <>
      {editSupplier && (
        <EditSupplierDialog lot={lot} open={editSupplier} onClose={() => setEdit(false)} />
      )}

      <div className="border-b border-[--color-border] last:border-0">
        {/* Main row */}
        <div
          className="flex items-center gap-4 px-5 py-4 hover:bg-[--color-canvas] transition-colors cursor-pointer"
          onClick={() => setOpen(p => !p)}
        >
          {/* Lot # + PR ref */}
          <div className="flex flex-col items-start w-[110px] shrink-0">
            <span className="font-mono text-sm font-bold text-[--color-brand]">{lot.lot_number}</span>
            <Link
              to={`/pr/${lot.purchase_request_id}`}
              className="flex items-center gap-1 text-[11px] text-[--color-text-muted] hover:text-[--color-brand] mt-0.5 transition-colors"
              onClick={e => e.stopPropagation()}
            >
              <FileText className="size-2.5 shrink-0" /> {lot.pr_number}
            </Link>
          </div>

          {/* Title */}
          <div className="flex-1 min-w-0">
            {lot.title
              ? <p className="text-sm font-semibold text-[--color-text-primary] truncate">{lot.title}</p>
              : <p className="text-sm text-[--color-text-muted] italic">No title</p>
            }
            {lot.pr_title && (
              <p className="text-xs text-[--color-text-muted] mt-0.5 truncate">{lot.pr_title}</p>
            )}
          </div>

          {/* Supplier summary */}
          <div className="w-[240px] shrink-0">
            {lot.awarded_to ? (
              <div className="flex items-center gap-2">
                <Trophy className="size-3.5 text-emerald-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[--color-text-primary] truncate">{lot.awarded_to}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {lot.awarded_amount && (
                      <p className="text-xs text-emerald-700 font-medium tabular-nums">{fmtCurrency(lot.awarded_amount)}</p>
                    )}
                    {lot.supplier_phone && (
                      <p className="text-xs text-[--color-text-muted] flex items-center gap-0.5">
                        <Phone className="size-2.5" />{lot.supplier_phone}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <span className="text-sm text-[--color-text-muted] italic">No supplier</span>
            )}
          </div>

          {/* Status */}
          <div className="w-[110px] shrink-0">
            <LotStatusBadge status={lot.status} />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0 w-[90px] justify-end" onClick={e => e.stopPropagation()}>
            {canManage && lot.status === 'awarded' && (
              <button
                onClick={() => setEdit(true)}
                className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors"
                title="Edit supplier"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
            {canManage && lot.status === 'awarded' && (
              <Link
                to={`/pr/${lot.purchase_request_id}`}
                className="flex items-center gap-1 h-7 px-2 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                onClick={e => e.stopPropagation()}
                title="Go to PR to issue PO"
              >
                <ShoppingCart className="size-3" /> PO
              </Link>
            )}
            <button
              onClick={() => setOpen(p => !p)}
              className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-text-primary] hover:bg-[--color-overlay] transition-colors"
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          </div>
        </div>

        {/* Expanded panel */}
        {open && (
          <div className="mx-5 mb-5 space-y-3">

            {/* Full supplier detail card — visible to ALL roles */}
            <SupplierCard
              lot={lot}
              canEdit={canManage && lot.status === 'awarded'}
              onEdit={() => setEdit(true)}
            />

            {/* Items table */}
            <div className="rounded-xl border border-[--color-border] overflow-hidden">
              <div className="px-4 py-2.5 bg-[--color-surface] border-b border-[--color-border] flex items-center gap-2">
                <Package className="size-3.5 text-[--color-text-muted]" />
                <p className="text-xs font-semibold text-[--color-text-primary]">
                  Items in this Lot
                  {lotItems.length > 0 && (
                    <span className="text-[--color-text-muted] font-normal ml-1">({lotItems.length})</span>
                  )}
                </p>
              </div>

              {itemsLoading ? (
                <div className="p-4 space-y-2">
                  {Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-9" />)}
                </div>
              ) : (
                <table className="w-full border-separate border-spacing-0">
                  <thead>
                    <tr className="border-b border-[--color-border]">
                      <ITH className="text-center w-14">#</ITH>
                      <ITH className="text-center w-20">Unit</ITH>
                      <ITH className="text-left">Item Description</ITH>
                      <ITH className="text-center w-16">Qty</ITH>
                      <ITH className="text-right w-32">Unit Cost</ITH>
                      <ITH className="text-right w-32">Total Cost</ITH>
                      {editable && <th className="w-10 bg-[--color-canvas]" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lotItems.length === 0 ? (
                      <tr>
                        <td colSpan={editable ? 7 : 6} className="px-6 py-10 text-center text-sm text-[--color-text-muted]">
                          No items recorded yet.{editable && ' Use the form below to add items.'}
                        </td>
                      </tr>
                    ) : (
                      lotItems.map((item, i) => {
                        const rowTotal = (parseFloat(item.estimated_cost) || 0) * (parseFloat(item.quantity) || 1)
                        return (
                          <tr key={item.id} className="border-b border-[--color-border] hover:bg-[--color-canvas]">
                            <ITD className="text-center text-[--color-text-muted] font-medium">{i + 1}</ITD>
                            <ITD className="text-center font-semibold text-[--color-text-primary]">{item.unit || '—'}</ITD>
                            <ITD className="text-left font-medium text-[--color-text-primary] leading-relaxed">{item.item_name}</ITD>
                            <ITD className="text-center tabular-nums font-medium">{item.quantity}</ITD>
                            <ITD className="text-right tabular-nums text-[--color-text-secondary]">
                              {item.estimated_cost ? fmtCurrency(parseFloat(item.estimated_cost)) : '—'}
                            </ITD>
                            <ITD className="text-right tabular-nums font-bold text-[--color-text-primary]">
                              {rowTotal > 0 ? fmtCurrency(rowTotal) : '—'}
                            </ITD>
                            {editable && (
                              <td className="px-3 text-center">
                                <button
                                  onClick={() => {
                                    if (window.confirm(`Remove "${item.item_name}" from this lot?`)) deleteItem(item.id)
                                  }}
                                  className="p-1.5 rounded text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        )
                      })
                    )}
                    {totalCost > 0 && (
                      <tr className="bg-emerald-50 border-b border-emerald-200">
                        <td colSpan={5} className="px-6 py-3 text-right text-sm font-bold text-emerald-800">Total</td>
                        <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-emerald-700">
                          {fmtCurrency(totalCost)}
                        </td>
                        {editable && <td />}
                      </tr>
                    )}
                  </tbody>
                </table>
              )}

              {/* Add item form — procurement/admin only */}
              {editable && (
                <div className="border-t border-[--color-border] bg-[--color-canvas] px-4 py-4 space-y-3">
                  <p className="text-xs font-semibold text-[--color-text-muted] uppercase tracking-wide">Add Item</p>
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5 space-y-1">
                      <Label className="text-xs">Item Description <span className="text-[--color-brand]">*</span></Label>
                      <Input
                        placeholder="e.g. Snacks, Office supplies"
                        value={itemForm.item_name}
                        onChange={e => setIF('item_name', e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddItem())}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Unit</Label>
                      <Select value={itemForm.unit} onValueChange={v => setIF('unit', v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {UNITS.map(u => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        type="number" min="0.01" step="any" placeholder="1"
                        value={itemForm.quantity}
                        onChange={e => setIF('quantity', e.target.value)}
                        className="h-8 text-xs text-center"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Unit Cost (₱)</Label>
                      <Input
                        type="number" min="0" step="any" placeholder="0.00"
                        value={itemForm.estimated_cost}
                        onChange={e => setIF('estimated_cost', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="col-span-1 self-end">
                      <Button
                        type="button" size="sm" className="h-8 w-full px-0"
                        disabled={addingItem || !itemForm.item_name.trim()}
                        onClick={handleAddItem}
                      >
                        <Plus className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Cancel lot */}
            {canManage && lot.status === 'awarded' && (
              <div className="flex justify-end">
                <Button
                  variant="outline" size="sm"
                  className="text-red-600 hover:text-red-700 hover:border-red-300 text-xs"
                  disabled={cancelling}
                  onClick={cancelLot}
                >
                  Cancel Lot
                </Button>
              </div>
            )}

          </div>
        )}
      </div>
    </>
  )
}

/* ── New Lot Award Dialog ─────────────────────────────────────────── */
const EMPTY_LOT_FORM = { purchase_request_id: '', title: '', ...EMPTY_SUPPLIER }

function NewLotDialog({ open, onClose, prs }) {
  const qc = useQueryClient()
  const [form, setForm] = useState(EMPTY_LOT_FORM)
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const { mutate: createLot, isPending } = useMutation({
    mutationFn: (body) => api.post('/lots', body),
    onSuccess: (res) => {
      toast.success(`${res.data.lot_number} recorded successfully`)
      qc.invalidateQueries({ queryKey: ['lots'] })
      qc.invalidateQueries({ queryKey: ['pr-list'] })
      onClose()
      setForm(EMPTY_LOT_FORM)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create lot'),
  })

  const handleSubmit = () => {
    if (!form.purchase_request_id) return toast.error('Please select a Purchase Request')
    if (!form.awarded_to.trim())   return toast.error('Supplier / contractor name is required')
    createLot({
      purchase_request_id: parseInt(form.purchase_request_id),
      title:            form.title            || undefined,
      awarded_to:       form.awarded_to.trim(),
      awarded_amount:   form.awarded_amount   ? parseFloat(form.awarded_amount) : undefined,
      supplier_contact: form.supplier_contact || undefined,
      supplier_phone:   form.supplier_phone   || undefined,
      supplier_email:   form.supplier_email   || undefined,
      supplier_address: form.supplier_address || undefined,
      supplier_tin:     form.supplier_tin     || undefined,
    })
  }

  const handleClose = () => { onClose(); setForm(EMPTY_LOT_FORM) }
  const selectedPR  = prs.find(p => String(p.id) === form.purchase_request_id)

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent title="Record Lot Award">
        <div className="space-y-5 py-1 max-h-[60vh] overflow-y-auto pr-1">

          {/* Purchase Request section */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider border-b border-[--color-border] pb-1.5">
              Purchase Request
            </p>
            <div className="space-y-1.5">
              <Label>Select Purchase Request <span className="text-[--color-brand] text-xs">*</span></Label>
              <Select value={form.purchase_request_id} onValueChange={v => setF('purchase_request_id', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a PR…" />
                </SelectTrigger>
                <SelectContent>
                  {prs.length === 0
                    ? <SelectItem value="__none" disabled>No active PRs</SelectItem>
                    : prs.map(pr => (
                      <SelectItem key={pr.id} value={String(pr.id)}>
                        {pr.pr_number}{pr.title ? ` — ${pr.title}` : ''}
                      </SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
              {selectedPR?.title && (
                <p className="text-xs text-[--color-text-muted] pl-0.5">{selectedPR.title}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>
                Lot Title / Category{' '}
                <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>
              </Label>
              <Input
                placeholder="e.g. Meals & Snacks, Office Supplies"
                value={form.title}
                onChange={e => setF('title', e.target.value)}
              />
            </div>
          </div>

          {/* Supplier / Contractor section */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider border-b border-[--color-border] pb-1.5">
              Supplier / Contractor Details
            </p>
            <SupplierFields form={form} setF={setF} />
          </div>

          {/* Live summary */}
          {form.purchase_request_id && form.awarded_to.trim() && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-xs font-semibold text-emerald-800 mb-1 flex items-center gap-1.5">
                <Trophy className="size-3.5" /> Summary
              </p>
              <p className="text-xs text-emerald-700 leading-relaxed">
                <span className="font-bold">{selectedPR?.pr_number}</span>
                {form.title && ` · ${form.title}`}
                {' '}will be awarded to{' '}
                <span className="font-bold">{form.awarded_to.trim()}</span>
                {form.awarded_amount && (
                  <> for <span className="font-bold">{fmtCurrency(parseFloat(form.awarded_amount))}</span></>
                )}
                .
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            disabled={isPending || !form.purchase_request_id || !form.awarded_to.trim()}
            onClick={handleSubmit}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
          >
            <Trophy className="size-3.5" />
            {isPending ? 'Saving…' : 'Record Award'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Main Page ────────────────────────────────────────────────────── */
export default function Bidding() {
  const { user }  = useAuth()
  const [activeTab, setActiveTab] = useState('all')
  const [lotDialog, setLotDialog] = useState(false)
  const canManage = ['admin', 'procurement'].includes(user?.role)

  const { data: lots = [], isLoading } = useQuery({
    queryKey: ['lots', activeTab],
    queryFn:  () => api.get(`/lots${activeTab !== 'all' ? `?status=${activeTab}` : ''}`).then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: allLots = [] } = useQuery({
    queryKey: ['lots', 'all'],
    queryFn:  () => api.get('/lots').then(r => r.data),
    refetchInterval: 30000,
  })
  const counts = allLots.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1
    return acc
  }, {})
  counts.all = allLots.length

  const { data: prs = [] } = useQuery({
    queryKey: ['pr-list-for-lots'],
    queryFn:  () => api.get('/pr?limit=200').then(r => r.data.data ?? r.data),
    enabled:  canManage,
  })
  const activePRs = prs.filter(p => !['cancelled', 'completed'].includes(p.status))

  return (
    <div className="space-y-5">

      {/* Page header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">Lots & Awards</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            {canManage
              ? 'Record lot awards — select the PR, enter full supplier details, and save.'
              : 'View awarded lots and complete supplier details for all purchase requests.'}
          </p>
        </div>
        {canManage && (
          <Button
            size="sm"
            className="gap-2 shrink-0 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => setLotDialog(true)}
          >
            <Plus className="size-4" /> New Lot Award
          </Button>
        )}
      </div>

      {canManage && (
        <NewLotDialog open={lotDialog} onClose={() => setLotDialog(false)} prs={activePRs} />
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { key: 'awarded',   label: 'Awarded',    color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
          { key: 'cancelled', label: 'Cancelled',   color: 'text-red-500',     bg: 'bg-red-50 border-red-200' },
          { key: 'all',       label: 'Total Lots',  color: 'text-[--color-brand]', bg: 'bg-[--color-brand-light] border-[--color-border]' },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => setActiveTab(s.key)}
            className={`rounded-xl border p-3 text-left transition-all hover:shadow-sm ${s.bg} ${
              activeTab === s.key ? 'ring-2 ring-offset-1 ring-[--color-brand]' : ''
            }`}
          >
            <p className={`text-xl font-bold ${s.color}`}>{counts[s.key] || 0}</p>
            <p className="text-xs text-[--color-text-muted] mt-0.5">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-[--color-border] overflow-x-auto">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-ui-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-[--color-brand] text-[--color-brand]'
                : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
            }`}
          >
            {t.label}
            {counts[t.key] ? (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                activeTab === t.key ? 'bg-[--color-brand] text-white' : 'bg-[--color-border] text-[--color-text-muted]'
              }`}>{counts[t.key]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Lot list */}
      <div className="rounded-xl border border-[--color-border] bg-white overflow-hidden">

        {/* Column header */}
        {!isLoading && lots.length > 0 && (
          <div className="flex items-center gap-4 px-5 py-2.5 border-b border-[--color-border] bg-[--color-canvas]">
            <div className="w-[110px] shrink-0 text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider">Lot #</div>
            <div className="flex-1 text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider">Title / Category</div>
            <div className="w-[240px] shrink-0 text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider">Supplier / Contractor</div>
            <div className="w-[110px] shrink-0 text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider">Status</div>
            <div className="w-[90px] shrink-0" />
          </div>
        )}

        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : !lots.length ? (
          <div className="py-20 text-center">
            <Trophy className="size-10 text-[--color-text-muted] mx-auto mb-3" />
            <p className="text-ui-sm font-semibold text-[--color-text-primary]">
              No {activeTab !== 'all' ? activeTab : ''} lots found
            </p>
            <p className="text-ui-xs text-[--color-text-muted] mt-1">
              {canManage
                ? 'Click "New Lot Award" to record a supplier award for a purchase request.'
                : 'No lot awards have been recorded yet.'}
            </p>
          </div>
        ) : (
          lots.map(lot => <LotRow key={lot.id} lot={lot} canManage={canManage} />)
        )}
      </div>

    </div>
  )
}

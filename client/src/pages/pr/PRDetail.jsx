import { useState, useEffect, useRef, Fragment } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, FileText, Gavel, Paperclip, History, BellRing, CheckCircle2,
  Package, Plus, Trash2, ClipboardList, RotateCcw, Eye,
  FileDown, XCircle, Pencil, Send, Undo2, Archive,
} from 'lucide-react'

import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { PRStatusBadge, DeliveryStatusBadge, CategoryBadge } from '@/components/shared/StatusBadge'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import { fmtDate, fmtCurrency, PR_STATUS_LABELS, CATEGORY_FORM, buildItemNotes, groupItemsBySection } from '@/lib/utils'
import { SectionNameInput, SectionHeaderRow } from '@/components/shared/ItemSections'
import RequestProgress from '@/components/shared/RequestProgress'
import CategorySpecFields from '@/components/shared/CategorySpecFields'
import UnitInput from '@/components/shared/UnitInput'
import RequestContextDisplay from '@/components/shared/RequestContextDisplay'
import CanvassPanel from '@/components/awards/CanvassPanel'
import PurchaseOrders from './PurchaseOrders'
import { useAuth } from '@/context/AuthContext'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

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

const EMPTY_ITEM = { group_label: '', item_name: '', quantity: '1', unit: 'pax', estimated_cost: '', specs: {} }

function PRItemsSection({ prId, canEdit, category, plain = false }) {
  const [itemToDelete, setItemToDelete] = useState(null)
  const [editingItem, setEditingItem]   = useState(null)
  const [editDraft, setEditDraft]       = useState(null)
  const qc = useQueryClient()
  const categoryForm = CATEGORY_FORM[category] || CATEGORY_FORM.office_supplies
  const [draft, setDraft] = useState({ ...EMPTY_ITEM, unit: categoryForm.defaultUnit })
  const itemRef = useRef(null)
  const setD  = (k, v) => setDraft(p => ({ ...p, [k]: v }))
  const setED = (k, v) => setEditDraft(p => ({ ...p, [k]: v }))

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['pr-items', prId],
    queryFn: () => api.get(`/pr/${prId}/items`).then(r => r.data),
  })

  const { mutate: addItem, isPending: adding } = useMutation({
    mutationFn: (body) => api.post(`/pr/${prId}/items`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pr-items', prId] })
      setDraft(p => ({ ...EMPTY_ITEM, unit: p.unit, group_label: p.group_label }))   // the section stays for the next item
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

  const { mutate: updateItemReq, isPending: savingEdit } = useMutation({
    mutationFn: ({ itemId, body }) => api.patch(`/pr/${prId}/items/${itemId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pr-items', prId] })
      setEditingItem(null)
      setEditDraft(null)
      toast.success('Item updated')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update item'),
  })

  const openEdit = (item) => {
    setEditingItem(item)
    setEditDraft({
      group_label:    item.group_label    || '',
      item_name:      item.item_name      || '',
      quantity:       String(item.quantity ?? '1'),
      unit:           item.unit           || categoryForm.defaultUnit,
      estimated_cost: item.estimated_cost != null ? String(item.estimated_cost) : '',
      notes:          item.notes          || '',
    })
  }

  const handleSaveEdit = () => {
    if (!editDraft.item_name.trim()) return toast.error('Item description is required')
    updateItemReq({
      itemId: editingItem.id,
      body: {
        group_label:    editDraft.group_label?.trim() || null,
        item_name:      editDraft.item_name.trim(),
        quantity:       editDraft.quantity,
        unit:           editDraft.unit?.trim() || null,
        estimated_cost: editDraft.estimated_cost,
        notes:          editDraft.notes?.trim() || null,
      },
    })
  }

  const handleAdd = () => {
    if (!draft.item_name.trim()) return toast.error('Item description is required')
    const notes = buildItemNotes(category, draft.specs)
    addItem({
      group_label:    draft.group_label    || undefined,
      item_name:      draft.item_name.trim(),
      quantity:       parseFloat(draft.quantity)       || 1,
      unit:           draft.unit           || undefined,
      estimated_cost: draft.estimated_cost ? parseFloat(draft.estimated_cost) : undefined,
      notes:          notes || undefined,
    })
  }

  // "Add item" on a section heading: point the add form at that section.
  const addToSection = (label) => {
    setD('group_label', label)
    itemRef.current?.focus()
  }

  const processed = items.map((item) => ({
    ...item,
    totalCost: (parseFloat(item.estimated_cost) || 0) * (parseFloat(item.quantity) || 1),
  }))
  const grouped    = groupItemsBySection(processed)
  const sectionNames = grouped.map(g => g.label).filter(Boolean)
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
          <span className="text-sm font-bold text-blue-700">Grand Total: {fmtCurrency(grandTotal)}</span>
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
                    <ITH className="text-center w-14">{plain ? 'No.' : 'Stock / Property No.'}</ITH>
                    <ITH className="text-center w-20">Unit</ITH>
                    <ITH className="text-left">{categoryForm.itemLabel}</ITH>
                    <ITH className="text-center w-16">Qty</ITH>
                    <ITH className="text-right w-32">Estimated Cost</ITH>
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
                            <SectionHeaderRow label={group.label} colSpan={cols} onAddItem={canEdit ? () => addToSection(group.label) : undefined} />
                          )}
                          {group.items.map((item) => (
                            <tr key={item.id} className="border-b border-[--color-border] hover:bg-[--color-canvas]">
                              <ITD className="text-center text-[--color-text-muted] font-medium">{item.rowNum}</ITD>
                              <ITD className="text-center font-semibold text-[--color-text-primary]">{item.unit || '—'}</ITD>
                              <ITD className="text-left font-medium text-[--color-text-primary] leading-relaxed">
                                {item.item_name}
                                {item.notes && (
                                  <div className="mt-2 text-sm text-[--color-text-secondary] whitespace-pre-wrap leading-relaxed">
                                    {item.notes}
                                  </div>
                                )}
                              </ITD>
                              <ITD className="text-center tabular-nums font-medium">{item.quantity}</ITD>
                              <ITD className="text-right tabular-nums text-[--color-text-secondary]">
                                {item.estimated_cost ? fmtCurrency(parseFloat(item.estimated_cost)) : '—'}
                              </ITD>
                              <td className="px-4 py-3.5 text-sm text-right tabular-nums font-bold text-[--color-text-primary]">
                                {item.totalCost > 0 ? fmtCurrency(item.totalCost) : '—'}
                              </td>
                              {canEdit && (
                                <td className="px-3 text-center whitespace-nowrap">
                                  <button
                                    onClick={() => openEdit(item)}
                                    title="Edit item"
                                    className="p-1.5 rounded text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors"
                                  >
                                    <Pencil className="size-4" />
                                  </button>
                                  <button
                                    onClick={() => setItemToDelete(item)}
                                    title="Remove item"
                                    className="p-1.5 ml-1 rounded text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors"
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
                    <tr className="bg-blue-50">
                      <td colSpan={5} className="px-6 py-3.5 text-right text-sm font-bold text-blue-800">
                        Grand Total
                      </td>
                      <td className="px-4 py-3.5 text-right text-base font-bold tabular-nums text-blue-700">
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
                    {categoryForm.sectionLabel}
                    <span className="ml-1 font-normal text-[--color-text-muted]">(optional)</span>
                  </Label>
                  <SectionNameInput
                    id="pr-detail-section"
                    placeholder={categoryForm.sectionPlaceholder}
                    value={draft.group_label}
                    onChange={v => setD('group_label', v)}
                    sections={sectionNames}
                  />
                </div>
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5 space-y-1">
                    <Label className="text-xs">{categoryForm.itemLabel} <span className="text-[--color-brand]">*</span></Label>
                    <Input
                      ref={itemRef}
                      placeholder={categoryForm.itemPlaceholder}
                      value={draft.item_name}
                      onChange={e => setD('item_name', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Unit</Label>
                    <UnitInput
                      value={draft.unit}
                      onChange={v => setD('unit', v)}
                      options={categoryForm.units}
                      placeholder={categoryForm.defaultUnit}
                      className="text-sm"
                    />
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
                    <Label className="text-xs">Price each (₱, estimate)</Label>
                    <Input
                      type="number" min="0" step="any" placeholder="0.00"
                      value={draft.estimated_cost}
                      onChange={e => setD('estimated_cost', e.target.value)}
                    />
                  </div>
                  <div className="col-span-1 text-right text-sm font-bold tabular-nums text-blue-700 self-end pb-2">
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

                {/* Per-category structured spec fields */}
                <CategorySpecFields
                  category={category}
                  specs={draft.specs}
                  onChange={(next) => setD('specs', next)}
                />
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={!!itemToDelete} onOpenChange={o => { if (!o) setItemToDelete(null) }}>
        <DialogContent title="Remove Item">
          <p className="text-sm text-[--color-text-secondary] pt-1">
            Remove <strong>"{itemToDelete?.item_name}"</strong> from this PR? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setItemToDelete(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white border-0"
              onClick={() => { deleteItem(itemToDelete.id); setItemToDelete(null) }}
            >
              Remove Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Item dialog — pre-populated with the current row's values.
          Specifications field is a single textarea here (the saved `notes`
          string is opaque text), letting the requester surgically edit it
          during revision without losing the existing structure. */}
      <Dialog open={!!editingItem} onOpenChange={o => { if (!o) { setEditingItem(null); setEditDraft(null) } }}>
        <DialogContent title="Edit Item" className="max-w-xl">
          {editDraft && (
            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <Label className="text-xs">
                  {categoryForm.sectionLabel}
                  <span className="ml-1 font-normal text-[--color-text-muted]">(optional)</span>
                </Label>
                <Input
                  list="pr-detail-section-options"
                  autoComplete="off"
                  placeholder={categoryForm.sectionPlaceholder}
                  value={editDraft.group_label}
                  onChange={e => setED('group_label', e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">{categoryForm.itemLabel} <span className="text-[--color-brand]">*</span></Label>
                <Input
                  placeholder={categoryForm.itemPlaceholder}
                  value={editDraft.item_name}
                  onChange={e => setED('item_name', e.target.value)}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Unit</Label>
                  <UnitInput
                    value={editDraft.unit}
                    onChange={v => setED('unit', v)}
                    options={categoryForm.units}
                    placeholder={categoryForm.defaultUnit}
                    className="text-sm"
                  />
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Qty</Label>
                  <Input
                    type="number" min="0.01" step="any" placeholder="1"
                    value={editDraft.quantity}
                    onChange={e => setED('quantity', e.target.value)}
                    className="text-center"
                  />
                </div>
                <div className="col-span-6 space-y-1">
                  <Label className="text-xs">Price each (₱, estimate)</Label>
                  <Input
                    type="number" min="0" step="any" placeholder="0.00"
                    value={editDraft.estimated_cost}
                    onChange={e => setED('estimated_cost', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">
                  Specifications
                  <span className="ml-1 font-normal text-[--color-text-muted]">(brand, model, technical specs, etc.)</span>
                </Label>
                <textarea
                  rows={5}
                  value={editDraft.notes}
                  onChange={e => setED('notes', e.target.value)}
                  className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y min-h-[100px]"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingItem(null); setEditDraft(null) }} disabled={savingEdit}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
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
  const isRequestor = user?.role === 'requestor'
  const isSupply    = user?.role === 'supply'
  // The canvass and awards: from canvass on (supply sees them once awarded).
  const showCanvass = (canManage || isSupply) && !!pr && ['bidding', 'for_po', 'completed', 'cancelled'].includes(pr.status)
  // One delivery status over every PO: delivered once all are, partial once any delivery is in.
  const pos = pr?.pos || []
  const deliveryStatus = !pos.length ? null
    : pos.every(p => p.delivery_status === 'delivered') ? 'delivered'
    : pos.some(p => p.delivery_status !== 'pending') ? 'partial' : 'pending'

  // "Issue PO" links elsewhere open this page at the purchase orders.
  const location = useLocation()
  useEffect(() => {
    if (pr && location.hash === '#purchase-order') {
      document.getElementById('purchase-order')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [pr?.id, location.hash])

  const [showDeletePR, setShowDeletePR] = useState(false)
  const { mutate: deletePR, isPending: deletingPR } = useMutation({
    mutationFn: () => api.delete(`/pr/${id}`),
    onSuccess: () => { toast.success('Purchase request deleted'); navigate('/pr') },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete PR'),
  })

  const openPDF = async (endpoint, label) => {
    try { await openPdf(endpoint) }
    catch (err) { toast.error(await blobErrorMessage(err, `Failed to open ${label}`)) }
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

  // Return for revision (Procurement): a reason is required and shown to the requestor.
  const [returnOpen, setReturnOpen]     = useState(false)
  const [returnReason, setReturnReason] = useState('')

  // Cooldown matches the server-side limiter (1 reminder per PR per hour) and
  // persists in localStorage so refreshing the page doesn't reset the button.
  // Stored as the unix-ms timestamp when the cooldown EXPIRES.
  const REMIND_COOLDOWN_MS = 60 * 60 * 1000
  const remindKey = `pr-reminded:${id}`
  const [remindUntil, setRemindUntil] = useState(() => {
    const stored = parseInt(localStorage.getItem(remindKey) || '0', 10)
    return Number.isFinite(stored) ? stored : 0
  })
  const reminded = remindUntil > Date.now()

  // Auto-flip the button back on when the cooldown expires (without a refresh).
  useEffect(() => {
    if (!reminded) return
    const t = setTimeout(() => setRemindUntil(0), remindUntil - Date.now())
    return () => clearTimeout(t)
  }, [reminded, remindUntil])

  const { mutate: sendReminder, isPending: reminding } = useMutation({
    mutationFn: () => api.post(`/pr/${id}/remind`),
    onSuccess: () => {
      toast.success('Reminder sent to procurement team')
      const expires = Date.now() + REMIND_COOLDOWN_MS
      localStorage.setItem(remindKey, String(expires))
      setRemindUntil(expires)
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

      {/* Archived: a deleted PR stays viewable, read-only */}
      {pr.deleted_at && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3">
          <Archive className="size-4 text-slate-600 shrink-0" />
          <p className="text-sm text-slate-700">
            Deleted {fmtDate(pr.deleted_at)}{pr.deleted_by_name ? ` by ${pr.deleted_by_name}` : ''}. It is kept in the Archive and can no longer be changed.
          </p>
        </div>
      )}

      {/* New TWG approval: Procurement's new work, shown until they first open it */}
      {isNewForProcurement && pr.status === 'twg_review' && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <span className="size-2.5 rounded-full bg-amber-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">New TWG approval: ready to canvass</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Approved{pr.twg_reviewer_name ? <> by <strong>{pr.twg_reviewer_name}</strong></> : ''} on {fmtDate(pr.twg_reviewed_at)}
            </p>
          </div>
          <Eye className="size-4 text-amber-500 shrink-0" />
        </div>
      )}

      {/* Revision-requested notice: who sent it back (the TWG, or Procurement
          returning an approved PR) and why. Owner (or admin) also gets a
          Resubmit button so they can send it back once they're done editing. */}
      {pr.status === 'revision_requested' && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <RotateCcw className="size-4 text-amber-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                {pr.revision && pr.revision.from_status !== 'submitted'
                  ? `Returned for revision by ${pr.revision.by_name} (Procurement)`
                  : 'TWG requested revisions'}
              </p>
              {(pr.revision?.note || pr.twg_comment) ? (
                <p className="text-ui-sm text-amber-900/90 mt-1.5 whitespace-pre-wrap">{pr.revision?.note || pr.twg_comment}</p>
              ) : (
                <p className="text-ui-xs text-amber-800/80 mt-1">No comment was provided.</p>
              )}
              <p className="text-[10px] text-amber-700/80 mt-2">
                Edit the items or specifications above, then re-submit to send it back to TWG.
              </p>
              {pr.permissions?.next_statuses?.includes('submitted') && (
                <Button
                  size="sm"
                  className="mt-3 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white border-0"
                  onClick={() => updateStatus({ status: 'submitted' })}
                  disabled={isPending}
                >
                  <Send className="size-4" />
                  {isPending ? 'Resubmitting…' : 'Resubmit to TWG'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TWG rejection notice — terminal state, shows TWG's reason */}
      {pr.status === 'rejected' && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <XCircle className="size-4 text-red-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-900">Rejected by TWG</p>
              {pr.twg_comment ? (
                <p className="text-ui-sm text-red-900/90 mt-1.5 whitespace-pre-wrap">{pr.twg_comment}</p>
              ) : (
                <p className="text-ui-xs text-red-800/80 mt-1">No reason was provided.</p>
              )}
              <p className="text-[10px] text-red-700/80 mt-2">
                This PR will not move forward to Procurement. Create a new PR if you want to try again.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TWG approval breadcrumb — visible to all once approved, so procurement sees TWG's note */}
      {pr.status === 'twg_review' && pr.twg_comment && (
        <div className="rounded-xl border border-cyan-300 bg-cyan-50 px-5 py-3.5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="size-4 text-cyan-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-cyan-900">Approved by TWG</p>
              <p className="text-ui-sm text-cyan-900/90 mt-1 whitespace-pre-wrap">{pr.twg_comment}</p>
            </div>
          </div>
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
            <CategoryBadge category={pr.category} />
            {deliveryStatus && <DeliveryStatusBadge status={deliveryStatus} />}
          </div>
          {pr.title && <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">{pr.title}</p>}
          <p className="text-ui-xs text-[--color-text-muted] mt-0.5">
            {pr.quarter_label && <span className="font-medium text-[--color-text-secondary]">{pr.quarter_label} {pr.quarter_year} · </span>}
            Created by {pr.created_by_name} · {fmtDate(pr.created_at)}
          </p>
        </div>
        {/* Only while Procurement has the PR (the reminder goes to them) */}
        {isRequestor && !pr.deleted_at && ['twg_review', 'bidding', 'for_po'].includes(pr.status) && (
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
        {/* Edit / Submit / Withdraw: shown to whoever the server allows (permissions) */}
        {pr.permissions?.edit && (
          <Button asChild variant="outline" size="sm" className="gap-2 shrink-0">
            <Link to={`/pr/${pr.id}/edit`}><Pencil className="size-4" /> Edit PR</Link>
          </Button>
        )}
        {pr.status === 'draft' && pr.permissions?.next_statuses?.includes('submitted') && (
          <Button size="sm" className="gap-2 shrink-0" onClick={() => updateStatus({ status: 'submitted' })} disabled={isPending}>
            <Send className="size-4" />
            {isPending ? 'Submitting…' : 'Submit to TWG'}
          </Button>
        )}
        {pr.status === 'submitted' && pr.permissions?.next_statuses?.includes('draft') && (
          <Button
            variant="outline" size="sm" className="gap-2 shrink-0"
            onClick={() => updateStatus({ status: 'draft' })}
            disabled={isPending}
            title="Pull this PR back from TWG review to edit it, then submit it again"
          >
            <Undo2 className="size-4" />
            {isPending ? 'Withdrawing…' : 'Withdraw to edit'}
          </Button>
        )}
        {pr.permissions?.delete && (
          <Button
            variant="outline" size="sm"
            className="gap-2 shrink-0 border-red-300 text-red-600 hover:bg-red-50"
            onClick={() => setShowDeletePR(true)}
          >
            <Trash2 className="size-4" /> Delete PR
          </Button>
        )}
        {pr.status === 'twg_review' && pr.permissions?.next_statuses?.includes('bidding') && (
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
        {pr.status === 'for_po' && pr.permissions?.next_statuses?.includes('bidding') && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => {
              if (window.confirm('Return this PR to canvassing? Its awards are cancelled, and every item must be awarded again before a PO can be issued.')) {
                updateStatus({ status: 'bidding', notes: 'Recanvass initiated by procurement' })
              }
            }}
            disabled={isPending}
            title="Return to canvassing: its awards are cancelled"
          >
            <RotateCcw className="size-4" />
            {isPending ? 'Processing…' : 'Recanvass'}
          </Button>
        )}
        {/* Items are locked once submitted; Procurement sends an approved PR
            back to the requestor instead, and it returns through the TWG. */}
        {canManage && pr.permissions?.next_statuses?.includes('revision_requested') && (
          <Button
            variant="outline" size="sm"
            className="gap-2 shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => setReturnOpen(true)}
            disabled={isPending}
            title="Send it back to the requestor to change; it goes through the TWG again"
          >
            <Undo2 className="size-4" /> Return for revision
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
        {!isRequestor && pr.status !== 'draft' && pr.status !== 'submitted' && (
          <button
            onClick={downloadAbstract}
            title="Download Abstract of Quotations"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[--color-border] text-xs font-medium text-[--color-text-secondary] hover:text-[--color-brand] hover:border-[--color-brand] transition-colors shrink-0"
          >
            <FileDown className="size-3.5" /> Abstract
          </button>
        )}

        {canManage && pr.permissions?.next_statuses?.length > 0 && (
          <div className="shrink-0 w-44">
            <Select value={pr.status} onValueChange={(status) => updateStatus({ status })} disabled={isPending}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* Current status + the moves the server allows this user (prWorkflow).
                    Return for revision (needs a reason) and Recanvass (cancels the
                    award, asks first) have their own buttons. */}
                {[pr.status, ...pr.permissions.next_statuses.filter(s =>
                  s !== 'revision_requested' && !(pr.status === 'for_po' && s === 'bidding'))].map(s => (
                  <SelectItem key={s} value={s}>
                    {PR_STATUS_LABELS[s] || s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Plain-language "where is my request" for the person who filed it */}
      {isRequestor && !pr.deleted_at && <RequestProgress pr={pr} />}

      {/* PR Details (fund codes are procurement's business, not shown to requestors) */}
      {((!isRequestor && (pr.fund_cluster || pr.responsibility_center_code)) || pr.notes) && (
        <Card>
          <CardHeader><CardTitle>PR Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!isRequestor && pr.fund_cluster && (
              <div>
                <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Fund Cluster</p>
                <p className="text-ui-sm text-[--color-text-primary] font-medium mt-0.5">{pr.fund_cluster}</p>
              </div>
            )}
            {!isRequestor && pr.responsibility_center_code && (
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

      {/* Request Context — only renders if the PR has any context fields filled */}
      <RequestContextDisplay pr={pr} />

      {/* Items Requested */}
      <PRItemsSection prId={id} canEdit={!!pr.permissions?.edit} category={pr.category} plain={isRequestor} />

      {/* Canvass & awards: quotations, awards by supplier (procurement, admin; supply once awarded) */}
      {showCanvass && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Gavel className="size-4 text-[--color-text-muted]" />
            <CardTitle>Canvass & Awards</CardTitle>
          </CardHeader>
          <CardContent><CanvassPanel pr={pr} /></CardContent>
        </Card>
      )}

      {/* Purchase orders: one per supplier awarded */}
      {(canManage || isRequestor || isSupply) && <PurchaseOrders pr={pr} canManage={canManage} />}

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
            canUpload={!pr.deleted_at}
            canDelete={canManage && !pr.deleted_at && !['completed', 'rejected', 'cancelled'].includes(pr.status)}
          />
        </CardContent>
      </Card>

      {/* Activity Log */}
      <ActivityLog prId={id} />

      {/* Delete PR confirmation */}
      <Dialog open={showDeletePR} onOpenChange={o => { if (!o) setShowDeletePR(false) }}>
        <DialogContent title="Delete Purchase Request">
          <div className="pt-1 space-y-3">
            <p className="text-sm text-[--color-text-secondary]">
              Delete <strong>{pr?.pr_number}</strong>? It will be removed from active lists and kept, with its items, attachments, and history, in the Archive under Deleted.
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowDeletePR(false)} disabled={deletingPR}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white border-0"
              onClick={() => deletePR()}
              disabled={deletingPR}
            >
              {deletingPR ? 'Deleting…' : 'Delete PR'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return for revision: a reason is required; the requestor edits and resubmits to the TWG */}
      <Dialog open={returnOpen} onOpenChange={o => { if (!o) setReturnOpen(false) }}>
        <DialogContent title="Return for Revision">
          <div className="pt-1 space-y-3">
            <p className="text-sm text-[--color-text-secondary]">
              Send <strong>{pr.pr_number}</strong> back to {pr.created_by_name} to change. Its items stay locked for
              everyone else; once it is fixed and submitted again, the TWG reviews it again.
            </p>
            <div className="space-y-1.5">
              <Label>What needs to change</Label>
              <textarea
                rows={3}
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                placeholder="e.g. Please add the laptop model and warranty period"
                className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReturnOpen(false)} disabled={isPending}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white border-0"
              disabled={isPending || !returnReason.trim()}
              onClick={() => updateStatus(
                { status: 'revision_requested', notes: returnReason.trim() },
                { onSuccess: () => { setReturnOpen(false); setReturnReason('') } },
              )}
            >
              {isPending ? 'Returning…' : 'Return for revision'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

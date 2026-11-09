import { useState, useEffect, Fragment } from 'react'
import { useParams, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, FileText, History, Package, Plus, Trash2, RotateCcw, ClipboardList, Ban,
  FileDown, XCircle, Pencil, Undo2, MoreHorizontal, ListChecks,
} from 'lucide-react'

import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { PRStatusBadge, CategoryBadge, MarkerBadges } from '@/components/shared/StatusBadge'
import { fmtDatetime, fmtCurrency, PR_STATUS_LABELS, CATEGORY_FORM, buildItemNotes, groupItemsBySection, PROCUREMENT_MODES, isTemporaryPrNumber } from '@/lib/utils'
import { nextStepOf, ACTION_TAB } from '@/lib/nextStep'
import { LotSelect, SectionHeaderRow } from '@/components/shared/ItemSections'
import CategorySpecFields from '@/components/shared/CategorySpecFields'
import SpecCheck from '@/components/shared/SpecCheck'
import { RequestContextFields, PurposeTypeBadge, hasRequestContext } from '@/components/shared/RequestContextDisplay'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import RequestSteps from '@/components/request/RequestSteps'
import NextStepPanel from '@/components/request/NextStepPanel'
import CanvassTab from '@/components/request/CanvassTab'
import DocumentsTab from '@/components/request/DocumentsTab'
import StartCanvassDialog from '@/components/awards/StartCanvassDialog'
import TwgReviewDialog from '@/components/twg/TwgReviewDialog'
import PpmpComparison, { usePrPpmp, ViewPpmpButton } from '@/components/ppmp/PpmpComparison'
import PurchaseOrders from './PurchaseOrders'
import { useAuth } from '@/context/AuthContext'
import { openPdf, downloadFile, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'
import ReviewSubmitDialog from '@/components/shared/ReviewSubmitDialog'
import QuotedSuppliers from '@/components/suppliers/QuotedSuppliers'
import DeletePRDialog from '@/components/shared/DeletePRDialog'
import { usePpmpPlans, takenByKey, lineChecks, PpmpLineNote, PpmpItemField, NoPpmpNotice, quarterOf } from '@/components/ppmp/PpmpLinePicker'

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

// off_plan: an item not in the PPMP, typed with its own name and unit (only on a Re-PR'd request).
const EMPTY_ITEM = { group_label: '', stock_property_no: '', category: '', ppmp_item_id: null, line: null, quantity: '1', estimated_cost: '', specs: {}, off_plan: false, item_name: '', unit: '' }
// Who may open the office's PPMP from a request (the PPMP pages' own roles).
const PPMP_VIEWERS = ['requestor', 'admin', 'procurement', 'twg']

function PRItemsSection({ prId, pr, canEdit, category }) {
  const { user } = useAuth()
  const [itemToDelete, setItemToDelete] = useState(null)
  const [editingItem, setEditingItem]   = useState(null)
  const [editDraft, setEditDraft]       = useState(null)
  const qc = useQueryClient()
  const categoryForm = CATEGORY_FORM[category] || CATEGORY_FORM.office_supplies
  const [draft, setDraft] = useState(EMPTY_ITEM)
  const setD  = (k, v) => setDraft(p => ({ ...p, [k]: v }))
  const setED = (k, v) => setEditDraft(p => ({ ...p, [k]: v }))

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['pr-items', prId],
    queryFn: () => api.get(`/pr/${prId}/items`).then(r => r.data),
  })
  // Each item against the office's PPMP, as the server checks it on submission.
  const { data: review } = useQuery({
    queryKey: ['pr-ppmp', prId],
    queryFn: () => api.get(`/pr/${prId}/ppmp`).then(r => r.data),
  })
  const reviewOf = new Map((review?.items || []).map(r => [r.id, r]))
  // A Re-PR'd request may go past the PPMP (items not in it, prices above it); the extra comes out of the office's budget.
  const rePr = pr.re_pr_count > 0
  // While it can be edited: the lines it may draw on, leaving out its own holds.
  const { plans, isLoading: plansLoading, lineById } = usePpmpPlans({ departmentId: canEdit && user?.role !== 'requestor' ? pr.department_id : null, prId: canEdit ? prId : null, enabled: user?.role !== 'supply' })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['pr-items', prId] })
    qc.invalidateQueries({ queryKey: ['pr-ppmp', prId] })
    qc.invalidateQueries({ queryKey: ['ppmp-lines'] })
  }

  const { mutate: addItem, isPending: adding } = useMutation({
    mutationFn: (body) => api.post(`/pr/${prId}/items`, body),
    onSuccess: () => {
      refresh()
      setDraft(p => ({ ...EMPTY_ITEM, group_label: p.group_label, off_plan: p.off_plan }))   // the section stays for the next item
      toast.success('Item added')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add item'),
  })

  const { mutate: deleteItem } = useMutation({
    mutationFn: (itemId) => api.delete(`/pr/${prId}/items/${itemId}`),
    onSuccess: () => {
      refresh()
      toast.success('Item removed')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove item'),
  })

  const { mutate: updateItemReq, isPending: savingEdit } = useMutation({
    mutationFn: ({ itemId, body }) => api.patch(`/pr/${prId}/items/${itemId}`, body),
    onSuccess: () => {
      refresh()
      setEditingItem(null)
      setEditDraft(null)
      toast.success('Item updated')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update item'),
  })

  const openEdit = (item) => {
    setEditingItem(item)
    setEditDraft({
      group_label:       item.group_label       || '',
      stock_property_no: item.stock_property_no || '',
      category:          item.category          || '',
      ppmp_item_id:   item.ppmp_item_id,
      line:           lineById.get(Number(item.ppmp_item_id)) || null,
      off_plan:       rePr && !item.ppmp_item_id,
      item_name:      item.item_name      || '',
      quantity:       String(item.quantity ?? '1'),
      unit:           item.unit           || '',
      estimated_cost: item.estimated_cost != null ? String(item.estimated_cost) : '',
      notes:          item.notes          || '',
    })
  }

  const handleSaveEdit = () => {
    if (editDraft.off_plan) {
      if (!editDraft.item_name.trim() || !editDraft.unit.trim()) return toast.error('Give the item\'s name and unit')
    } else {
      if (!editDraft.ppmp_item_id) return toast.error(rePr ? 'Pick the item from the PPMP, or tick Not in the PPMP' : 'Pick the item from the PPMP')
      if (editCheck?.block) return toast.error(editCheck.block)
    }
    updateItemReq({
      itemId: editingItem.id,
      body: {
        group_label:       editDraft.group_label?.trim() || null,
        stock_property_no: editDraft.stock_property_no?.trim() || null,
        category:          editDraft.category || undefined,
        // An item not in the PPMP (Re-PR) is named and measured as typed, and loses any PPMP line it had.
        ...(editDraft.off_plan
          ? { ...(editingItem.ppmp_item_id ? { ppmp_item_id: null } : {}), item_name: editDraft.item_name.trim(), unit: editDraft.unit.trim() }
          : editDraft.ppmp_item_id !== editingItem.ppmp_item_id ? { ppmp_item_id: editDraft.ppmp_item_id } : {}),
        quantity:       editDraft.quantity,
        estimated_cost: editDraft.estimated_cost,
        notes:          editDraft.notes?.trim() || null,
      },
    })
  }

  // What this request's saved items take of each line, and each new or edited item's check against what is left.
  const taken = takenByKey(items, lineById)
  // The quarter of the PPMP's year the request draws on (1 to 4), or null: the year's total applies.
  const quarter = quarterOf(plans, { label: pr.quarter_label, year: pr.quarter_year })
  const planYear = items.map(i => lineById.get(Number(i.ppmp_item_id))?.fiscal_year).find(Boolean) ?? (quarter ? Number(pr.quarter_year) : undefined)
  const checkAgainst = (line, item, exceptIndex) => line && lineChecks(line, { quantity: item.quantity, price: item.estimated_cost, quarter, taken: takenByKey(items, lineById, exceptIndex).get(line.key) || 0 })
  const draftCheck = draft.line ? { line: draft.line, ...checkAgainst(draft.line, draft, -1) } : null
  const editCheck = editDraft?.line ? { line: editDraft.line, ...checkAgainst(editDraft.line, editDraft, items.findIndex(i => i.id === editingItem?.id)) } : null
  // A picked line brings its price; typing over it clears the pick.
  const pickLine = (line) => setDraft(p => (line ? { ...p, ppmp_item_id: line.id, line, estimated_cost: String(line.unit_cost) } : { ...p, ppmp_item_id: null, line: null }))

  const offPlanReady = draft.item_name.trim() && draft.unit.trim() && parseFloat(draft.estimated_cost) > 0
  const handleAdd = () => {
    if (draft.off_plan ? !offPlanReady : !draft.line) return toast.error(draft.off_plan ? 'Give the item\'s name, unit and price' : 'Pick the item from the PPMP')
    if (!draft.off_plan && draftCheck?.block) return toast.error(draftCheck.block)
    const notes = buildItemNotes(category, draft.specs)
    addItem({
      group_label:       draft.group_label       || undefined,
      stock_property_no: draft.stock_property_no?.trim() || undefined,
      category:          draft.category || category || undefined,
      ...(draft.off_plan ? { item_name: draft.item_name.trim(), unit: draft.unit.trim() } : { ppmp_item_id: draft.line.id }),
      quantity:       parseFloat(draft.quantity)       || 1,
      estimated_cost: draft.estimated_cost ? parseFloat(draft.estimated_cost) : undefined,
      notes:          notes || undefined,
    })
  }

  // "Add item" on a section heading: point the add form at that section.
  const addToSection = (label) => setD('group_label', label)

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
  const cols = canEdit ? 8 : 7

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-[--color-text-muted]" />
          <CardTitle>Items requested</CardTitle>
          {items.length > 0 && (
            <span className="text-xs text-[--color-text-muted] font-normal">({items.length})</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {review?.plan && PPMP_VIEWERS.includes(user?.role) && (
            <Link to={`/ppmp/${review.plan.id}`} className="inline-flex items-center gap-1.5 text-ui-sm font-semibold text-[--color-brand] hover:underline">
              <ClipboardList className="size-4" /> View PPMP ({review.plan.office_code}, FY {review.plan.fiscal_year})
            </Link>
          )}
          {grandTotal > 0 && (
            <span className="text-sm font-bold text-blue-700">Grand Total: {fmtCurrency(grandTotal)}</span>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {canEdit && review?.problems?.length > 0 && (
          <div className="mx-4 mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="flex items-center gap-1.5 text-ui-sm font-semibold text-red-800"><Ban className="size-4" /> Fix these before submitting</p>
            <ul className="mt-1 list-disc pl-6 text-ui-sm text-red-800 leading-relaxed">
              {review.problems.map(m => <li key={m}>{m}</li>)}
            </ul>
          </div>
        )}
        {canEdit && rePr && review?.budget && (
          <div className="mx-4 mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
            <p className="text-ui-sm font-semibold">Re-PR: this request may go past the PPMP</p>
            <p className="text-xs mt-1 tabular-nums">
              An item may cost more than its PPMP line, or not be in the PPMP at all (Not in the PPMP, below); the extra comes out of your office's PPMP budget.
              Left in the {review.plan?.office_code} PPMP budget: <span className="font-bold">{fmtCurrency(review.budget.left)}</span>.
              This request takes <span className="font-bold">{fmtCurrency(review.budget.mine)}</span>
              {review.budget.mine_extra > 0 ? `, ${fmtCurrency(review.budget.mine_extra)} of it past the plan` : ''}.
            </p>
          </div>
        )}
        {isLoading ? (
          <div className="p-4 space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : (
          <>
            <div className="border-b border-[--color-border]">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <ITH className="text-center w-14">No.</ITH>
                    <ITH className="text-center w-24">Stock/Property</ITH>
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
                        {canEdit ? 'No items yet. Add the first item below.' : 'No items listed.'}
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
                              <ITD className="text-center text-[--color-text-secondary] tabular-nums">{item.stock_property_no || '—'}</ITD>
                              <ITD className="text-center font-semibold text-[--color-text-primary]">{item.unit || '—'}</ITD>
                              <ITD className="text-left font-medium text-[--color-text-primary] leading-relaxed">
                                {item.item_name}
                                {item.notes && (
                                  <div className="mt-2 text-sm text-[--color-text-secondary] whitespace-pre-wrap leading-relaxed">
                                    {item.notes}
                                  </div>
                                )}
                                <SpecCheck pr={pr} item={item} />
                                {reviewOf.get(item.id)?.line && (
                                  <PpmpLineNote line={reviewOf.get(item.id).line} planned={reviewOf.get(item.id).line.planned}
                                    warnings={reviewOf.get(item.id).warnings} block={canEdit ? reviewOf.get(item.id).problem : null} className="mt-2 font-normal" />
                                )}
                                {/* An item not in the PPMP: on a Re-PR its cost comes out of the office's budget; otherwise it can't be submitted. */}
                                {!item.ppmp_item_id && reviewOf.get(item.id) && (
                                  <p className={`mt-2 text-[11px] font-semibold ${reviewOf.get(item.id).problem ? 'text-red-700' : 'text-amber-700'}`}>
                                    {(canEdit && reviewOf.get(item.id).problem) || reviewOf.get(item.id).warnings.join(' ') || (rePr ? 'Not in the PPMP (Re-PR).' : '')}
                                  </p>
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
                              <td colSpan={6} className="px-6 py-3 text-right text-sm font-semibold text-[--color-text-secondary]">
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
                      <td colSpan={6} className="px-6 py-3.5 text-right text-sm font-bold text-blue-800">
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

            {canEdit && !plansLoading && !plans.length && (
              <div className="px-4 py-4"><NoPpmpNotice requestor={user?.role === 'requestor'} /></div>
            )}
            {canEdit && (plansLoading || plans.length > 0) && (
              <div className="bg-[--color-canvas] px-4 py-4 space-y-3">
                <p className="text-xs font-semibold text-[--color-text-muted] uppercase tracking-wide">Add item</p>
                {rePr && (
                  <label className="flex items-center gap-2 text-xs font-medium text-[--color-text-secondary]">
                    <input type="checkbox" checked={draft.off_plan} className="accent-amber-600"
                      onChange={e => setDraft(p => ({ ...p, off_plan: e.target.checked, ppmp_item_id: null, line: null }))} />
                    Not in the PPMP: type the item yourself (Re-PR; its cost comes out of the office's PPMP budget)
                  </label>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="pr-detail-section">
                    Lot
                    <span className="ml-1 font-normal text-[--color-text-muted]">(optional)</span>
                  </Label>
                  <LotSelect
                    id="pr-detail-section"
                    value={draft.group_label}
                    onChange={v => setD('group_label', v)}
                    sections={sectionNames}
                  />
                </div>
                <div className="grid grid-cols-12 gap-2 items-end">
                  {/* Stock/Property No. — the Supply Office's number, usually blank here */}
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Stock/Property No.</Label>
                    <Input
                      placeholder="optional"
                      value={draft.stock_property_no}
                      onChange={e => setD('stock_property_no', e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  {/* The item, picked from the PPMP: its description and unit are the line's */}
                  <div className="col-span-4">
                    {draft.off_plan ? (
                      <div className="space-y-1">
                        <Label htmlFor="pr-detail-off-plan-item" className="text-xs">Item (not in the PPMP)</Label>
                        <Input id="pr-detail-off-plan-item" maxLength={500} placeholder="What it is, without a brand" value={draft.item_name} onChange={e => setD('item_name', e.target.value)} />
                      </div>
                    ) : (
                      <PpmpItemField id="pr-detail-ppmp-item" plans={plans} isLoading={plansLoading} value={draft.line} onPick={pickLine} taken={taken} year={planYear} quarter={quarter}
                        kind={draft.category || category} />
                    )}
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Unit</Label>
                    {draft.off_plan ? (
                      <Input maxLength={50} placeholder="pc, set, ream" aria-label="Unit of the item not in the PPMP" value={draft.unit} onChange={e => setD('unit', e.target.value)} />
                    ) : (
                      <div className="flex h-10 items-center rounded-lg border border-[--color-border] bg-[--color-surface] px-3 text-sm text-[--color-text-secondary]">
                        {draft.line?.unit || '—'}
                      </div>
                    )}
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
                  {/* The line total sits outside the flow so the inputs across
                      the row stay bottom-aligned. */}
                  <div className="col-span-2 space-y-1 relative">
                    <Label className="text-xs">Price each (₱, estimate)</Label>
                    <Input
                      type="number" min="0" step="any" placeholder="0.00"
                      value={draft.estimated_cost}
                      onChange={e => setD('estimated_cost', e.target.value)}
                    />
                    {draftTotal > 0 && (
                      <p className="absolute left-0 top-full mt-1 text-[11px] font-bold tabular-nums text-blue-700">
                        {fmtCurrency(draftTotal)}
                      </p>
                    )}
                  </div>
                  <div className="col-span-1 self-end">
                    <Button
                      className="w-full px-0"
                      disabled={adding || (draft.off_plan ? !offPlanReady : !draft.line || !!draftCheck?.block)}
                      onClick={handleAdd}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>

                {!draft.off_plan && draftCheck && <PpmpLineNote {...draftCheck} />}

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
        <DialogContent title="Remove the item">
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
        <DialogContent title="Edit the item" className="max-w-xl">
          {editDraft && (
            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="pr-edit-item-lot">
                  Lot
                  <span className="ml-1 font-normal text-[--color-text-muted]">(optional)</span>
                </Label>
                <LotSelect id="pr-edit-item-lot" value={editDraft.group_label} onChange={v => setED('group_label', v)} sections={sectionNames} hint={false} />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">
                  Stock/Property No.
                  <span className="ml-1 font-normal text-[--color-text-muted]">(optional)</span>
                </Label>
                <Input
                  placeholder="Assigned by the Supply Office"
                  value={editDraft.stock_property_no}
                  onChange={e => setED('stock_property_no', e.target.value)}
                />
              </div>

              {rePr && (
                <label className="flex items-center gap-2 text-xs font-medium text-[--color-text-secondary]">
                  <input type="checkbox" checked={editDraft.off_plan} className="accent-amber-600"
                    onChange={e => setEditDraft(p => ({ ...p, off_plan: e.target.checked, ...(e.target.checked ? { ppmp_item_id: null, line: null } : {}) }))} />
                  Not in the PPMP: type the item yourself (Re-PR; its cost comes out of the office's PPMP budget)
                </label>
              )}
              {editDraft.off_plan ? (
                <div className="space-y-1">
                  <Label htmlFor="pr-edit-off-plan-item" className="text-xs">Item (not in the PPMP)</Label>
                  <Input id="pr-edit-off-plan-item" maxLength={500} placeholder="What it is, without a brand" value={editDraft.item_name} onChange={e => setED('item_name', e.target.value)} />
                </div>
              ) : (
                <PpmpItemField id="pr-edit-ppmp-item" plans={plans} isLoading={plansLoading}
                  value={editDraft.line || (editDraft.ppmp_item_id ? { description: editDraft.item_name } : null)}
                  onPick={line => setEditDraft(p => (line ? { ...p, ppmp_item_id: line.id, line, item_name: line.description, unit: line.unit } : { ...p, ppmp_item_id: null, line: null }))}
                  taken={takenByKey(items, lineById, items.findIndex(i => i.id === editingItem?.id))} year={planYear} quarter={quarter}
                  kind={editDraft.category || category} />
              )}

              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Unit</Label>
                  {editDraft.off_plan ? (
                    <Input maxLength={50} placeholder="pc, set, ream" aria-label="Unit of the item not in the PPMP" value={editDraft.unit} onChange={e => setED('unit', e.target.value)} />
                  ) : (
                    <div className="flex h-10 items-center rounded-lg border border-[--color-border] bg-[--color-canvas] px-3 text-sm text-[--color-text-secondary]">
                      {editDraft.line?.unit || editDraft.unit || '—'}
                    </div>
                  )}
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
              {!editDraft.off_plan && editCheck && <PpmpLineNote {...editCheck} />}

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
              {savingEdit ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// What each move tells the person who made it: what happened, and what comes next.
const MOVED = {
  submitted:          (pr) => [`${pr.pr_number} sent to the TWG`, 'You will be notified when they review it.'],
  draft:              (pr) => [`${pr.pr_number} is back to draft`, 'Edit it, then submit it again.'],
  revision_requested: (pr) => (pr.status === 'rejected'
    ? [`${pr.pr_number} reopened`, 'Change what the TWG pointed out, then resubmit it.']
    : [`Returned to ${pr.created_by_name} for changes`, 'They are told what to change.']),
  bidding:            (pr) => [`${pr.pr_number} is back in canvass`],
  cancelled:          (pr) => [`${pr.pr_number} cancelled`],
}

const TAB_LABELS = { overview: 'Overview', canvass: 'Canvass & award', orders: 'Orders & delivery', documents: 'Documents', history: 'History' }
// The statuses from which the TWG has checked an award's winning offers (or is checking them).
const TWG_CANVASS = ['twg_certification', 'for_po', 'completed']

// The tabs a role has on a request: the overview, the canvass once it started (staff; the TWG once it
// checks the award), the purchase orders once there are any to issue, the documents and the history.
function tabsFor(pr, role) {
  const staff = ['admin', 'procurement'].includes(role)
  const started = Boolean(pr.rfq_at) || Number(pr.quotes) > 0 || ['bidding', ...TWG_CANVASS].includes(pr.status)
  const canvass = started && (staff || (role === 'twg' && TWG_CANVASS.includes(pr.status)))
  const orders = ['admin', 'procurement', 'requestor', 'supply'].includes(role) && ((pr.pos?.length ?? 0) > 0 || ['for_po', 'completed'].includes(pr.status))
  return ['overview', ...(canvass ? ['canvass'] : []), ...(orders ? ['orders'] : []), 'documents', 'history']
}

/* One request, one page, the same for every role: what it is, where it is on its six steps (RequestSteps), what the
   viewer does next with the button for it (NextStepPanel, lib/nextStep.js), then tabs for the work itself: the
   overview, the canvass and award, the orders and deliveries, the documents and the history. Other actions (return
   for changes, return to canvass, cancel, delete) sit under More. ?tab= opens a tab (the old canvass page and the
   TWG's review page lead here). */
export default function PRDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc       = useQueryClient()
  const confirm  = useConfirm()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const role = user?.role

  const { data: pr, isLoading, isError } = useQuery({
    queryKey: ['pr', id],
    queryFn: () => api.get(`/pr/${id}`).then(r => r.data),
    retry: 1,
  })

  const { mutate: updateStatus, isPending } = useMutation({
    mutationFn: ({ status, notes }) => api.patch(`/pr/${id}/status`, { status, notes }),
    onSuccess: (_res, { status }) => {
      const [title, description] = MOVED[status]?.(pr) || ['Status updated']
      toast.success(title, description ? { description } : undefined)
      for (const key of [['pr', id], ['pr-list'], ['pr-stats'], ['pr-logs', id], ['pr-tasks']]) qc.invalidateQueries({ queryKey: key })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update status'),
  })

  const canManage   = ['admin', 'procurement'].includes(role)
  const isRequestor = role === 'requestor'
  const listPath    = isRequestor ? '/my-requests' : '/pr'

  const [showDeletePR, setShowDeletePR] = useState(false)
  const [starting, setStarting]         = useState(false)    // Start canvass (Procurement)
  const [twgAction, setTwgAction]       = useState(null)     // the TWG's decision on the request: approve, revise or reject

  const openPDF = async (endpoint, label) => {
    try { await openPdf(endpoint) }
    catch (err) { toast.error(await blobErrorMessage(err, `Failed to open ${label}`)) }
  }
  const downloadRFQ      = () => openPDF(`/pr/${id}/rfq`, 'Request for Quotation')
  const downloadRFQWord  = () => downloadFile(`/pr/${id}/rfq/docx`, `RFQ ${pr.pr_number}.docx`)
    .catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not download the Request for Quotation')))

  // How this purchase is procured; Procurement sets it once the canvass is set up.
  const { mutate: setMode, isPending: settingMode } = useMutation({
    mutationFn: (body) => api.patch(`/pr/${id}/mode`, body),
    onSuccess: () => { toast.success('Mode of procurement saved'); qc.invalidateQueries({ queryKey: ['pr', id] }) },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save the mode'),
  })

  // Opening a request marks it read for Procurement (the lists' "new" marks).
  const { mutate: markReadOnServer } = useMutation({
    mutationFn: () => api.post(`/pr/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pr-reads', user?.id] }),
  })
  useEffect(() => {
    if (canManage && user && pr?.id) markReadOnServer()
  }, [pr?.id])

  // Return for changes (Procurement): a reason is required and shown to the requestor.
  const [returnOpen, setReturnOpen]     = useState(false)
  const [reviewing, setReviewing]       = useState(false)
  const { data: reviewItems } = useQuery({
    queryKey: ['pr-items', id],
    queryFn: () => api.get(`/pr/${id}/items`).then(r => r.data),
    enabled: reviewing,
  })
  const [returnReason, setReturnReason] = useState('')

  // Cooldown matches the server-side limiter (1 reminder per PR per hour) and
  // persists in localStorage so refreshing the page doesn't reset the button.
  // Stored as the unix-ms timestamp when the cooldown EXPIRES.
  const REMIND_COOLDOWN_MS = 60 * 60 * 1000
  const remindKey = `pr-reminded:${id}`
  const [remindUntil, setRemindUntil] = useState(() => {
    try {
      const stored = parseInt(localStorage.getItem(remindKey) || '0', 10)
      return Number.isFinite(stored) ? stored : 0
    } catch { return 0 }
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
      try { localStorage.setItem(remindKey, String(expires)) } catch { /* the cooldown still holds until a refresh */ }
      setRemindUntil(expires)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to send reminder'),
  })

  // Arriving from My tasks with ?do=: the action is ready (its window open), when it is still the viewer's to take.
  const ready = params.get('do')
  useEffect(() => {
    if (!pr || !ready) return
    const step = nextStepOf(pr, user)
    if (step.mine && step.actions.includes(ready)) {
      if (ready === 'start_canvass') setStarting(true)
      if (ready === 'submit') setReviewing(true)
    }
    setParams(p => { const out = new URLSearchParams(p); out.delete('do'); return out }, { replace: true })
  }, [pr?.id, ready])

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-60 rounded-xl" />
    </div>
  )

  if (isError || !pr) return (
    <div className="text-center py-20">
      <FileText className="size-10 text-[--color-text-muted] mx-auto mb-3" />
      <p className="text-ui-md font-semibold text-[--color-text-primary]">Purchase request not found</p>
      <Button variant="outline" size="sm" className="mt-5" onClick={() => navigate(listPath)}>Back to list</Button>
    </div>
  )

  // The tab: ?tab=, or the purchase orders for the old "#purchase-order" links, else the overview.
  const tabs = tabsFor(pr, role)
  const asked = params.get('tab') || (location.hash === '#purchase-order' ? 'orders' : null)
  const tab = tabs.includes(asked) ? asked : 'overview'
  const goTab = (next) => setParams(p => {
    const out = new URLSearchParams(p)
    if (next === 'overview') out.delete('tab'); else out.set('tab', next)
    return out
  }, { replace: true })

  // What the viewer does next, and the tab its work is in (marked on the tab).
  const step = nextStepOf(pr, user)
  const workTab = step.mine ? ACTION_TAB[step.actions?.[0]] : null
  const runAction = (key) => {
    if (ACTION_TAB[key]) return goTab(ACTION_TAB[key])
    switch (key) {
      case 'submit':        return setReviewing(true)
      case 'edit':          return navigate(`/pr/${pr.id}/edit`)
      case 'withdraw':      return updateStatus({ status: 'draft' })
      case 'reopen':        return updateStatus({ status: 'revision_requested' })
      case 'twg_approve':   return setTwgAction('approve')
      case 'twg_revise':    return setTwgAction('revise')
      case 'twg_reject':    return setTwgAction('reject')
      case 'start_canvass': return setStarting(true)
      case 'print_rfq':     return downloadRFQ()
      case 'word_rfq':      return downloadRFQWord()
      case 'remind':        return sendReminder()
      default:              return undefined
    }
  }

  // The rarer actions, under More in the header on every request.
  const next = pr.permissions?.next_statuses || []
  const cancel = async () => {
    if (await confirm({
      title: 'Cancel this request?', danger: true, confirmLabel: 'Cancel request', cancelLabel: 'Keep it',
      message: 'It is kept in the Archive, and any award without a purchase order is cancelled with it.',
    })) updateStatus({ status: 'cancelled' })
  }
  const recanvass = async () => {
    if (await confirm({
      title: 'Return this request to canvass?', danger: true, confirmLabel: 'Return to canvass',
      message: 'Its awards are cancelled; the new winners go through the BAC (and the TWG when needed) again before a PO can be issued.',
    })) updateStatus({ status: 'bidding', notes: 'Recanvass initiated by procurement' })
  }
  const more = !pr.deleted_at ? [
    canManage && ['twg_review', 'bidding'].includes(pr.status) && next.includes('revision_requested') && { label: 'Return for changes', icon: RotateCcw, run: () => setReturnOpen(true) },
    canManage && pr.status === 'for_po' && next.includes('bidding') && { label: 'Return to canvass', icon: Undo2, run: recanvass },
    next.includes('cancelled') && { label: 'Cancel request', icon: XCircle, run: cancel, danger: true },
    pr.permissions?.delete && { label: 'Delete request', icon: Trash2, run: () => setShowDeletePR(true), danger: true },
  ].filter(Boolean) : []

  const showDetails = (!isRequestor && (pr.fund_cluster || pr.responsibility_center_code)) || pr.notes || canManage || pr.permissions?.set_mode
  // The list this request is found in, in the viewer's own menu.
  const back = isRequestor ? { to: '/my-requests', label: 'My Requests' } : role === 'supply' ? { to: '/po', label: 'Purchase Orders' } : { to: '/pr', label: 'Requests' }
  const facts = [pr.department, pr.items_total > 0 && `Budget ${fmtCurrency(pr.items_total)}`, `Filed ${fmtDatetime(pr.created_at)} by ${pr.created_by_name}`,
    pr.quarter_label && `${pr.quarter_label} ${pr.quarter_year}`, pr.mode_of_procurement].filter(Boolean)

  return (
    <div className="space-y-5">
      {/* What it is */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <Link to={back.to} className="mb-1.5 inline-flex items-center gap-1 text-ui-xs font-medium text-[--color-text-secondary] transition-colors hover:text-[--color-brand]">
            <ArrowLeft className="size-3.5" /> {back.label}
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="whitespace-nowrap font-mono text-ui-2xl font-bold text-[--color-brand]"
              title={isTemporaryPrNumber(pr.pr_number) ? 'A temporary reference: Procurement assigns the PR number when the canvass starts' : undefined}>
              {pr.pr_number}
            </h2>
            <PRStatusBadge pr={pr} />
            <MarkerBadges pr={pr} />
            <CategoryBadge category={pr.category} />
          </div>
          {pr.title && <p className="mt-0.5 text-ui-md font-semibold text-[--color-text-primary]">{pr.title}</p>}
          <p className="mt-1 text-ui-xs text-[--color-text-muted]">{facts.join(' · ')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => goTab('documents')}><FileDown className="size-4" /> Documents</Button>
          {more.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="gap-1.5" disabled={isPending}><MoreHorizontal className="size-4" /> More</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {more.map(m => (
                  <DropdownMenuItem key={m.label} onClick={m.run} className={m.danger ? 'text-red-600 focus:text-red-700' : undefined}>
                    <m.icon className="size-4" /> {m.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Where it is, and what the viewer does next */}
      <RequestSteps pr={pr} />
      <NextStepPanel step={step} onAction={runAction} busy={isPending}
        disabled={reminded || reminding ? ['remind'] : []}
        labels={{ remind: reminded ? 'Reminder sent' : reminding ? 'Sending…' : undefined, submit: pr.status === 'revision_requested' ? 'Submit again' : undefined }} />

      {/* The work, by tab */}
      <div role="tablist" aria-label="Request sections" className="flex gap-1 overflow-x-auto border-b border-[--color-border]">
        {tabs.map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => goTab(t)}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-ui-sm font-semibold transition-colors ${
              tab === t ? 'border-[--color-brand] text-[--color-brand]' : 'border-transparent text-[--color-text-secondary] hover:text-[--color-text-primary]'}`}>
            {TAB_LABELS[t]}
            {t === 'orders' && pr.pos?.length > 0 && <span className="rounded-full border border-[--color-border] bg-[--color-canvas] px-1.5 text-[11px] font-medium text-[--color-text-muted]">{pr.pos.filter(po => po.po_status !== 'cancelled').length}</span>}
            {t === workTab && <span className="size-2 rounded-full bg-amber-500" aria-label="Your next step is here" />}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-5">
          {role === 'twg' && <PpmpCheck pr={pr} />}
          {(showDetails || hasRequestContext(pr)) && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Details</CardTitle>
                {pr.purpose_type && <PurposeTypeBadge type={pr.purpose_type} />}
              </CardHeader>
              <CardContent className="space-y-4">
                {showDetails && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {!isRequestor && pr.fund_cluster && (
                      <div>
                        <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">
                          Fund Cluster{pr.fund_source ? ` · ${pr.fund_source}` : ''}
                        </p>
                        <p className="text-ui-sm text-[--color-text-primary] font-medium mt-0.5">{pr.fund_cluster}</p>
                      </div>
                    )}
                    {/* How this is procured: Procurement's call, fixed once a supplier is awarded. */}
                    {pr.permissions?.set_mode && (
                      <div>
                        <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Mode of Procurement</p>
                        <Select value={pr.mode_of_procurement || ''} onValueChange={(mode_of_procurement) => setMode({ mode_of_procurement })} disabled={settingMode}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Not set" /></SelectTrigger>
                          <SelectContent>
                            {PROCUREMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {!pr.permissions?.set_mode && pr.mode_of_procurement && (
                      <div>
                        <p className="text-ui-xs text-[--color-text-muted] font-medium uppercase tracking-wide">Mode of Procurement</p>
                        <p className="text-ui-sm text-[--color-text-primary] font-medium mt-0.5">{pr.mode_of_procurement}</p>
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
                  </div>
                )}
                {hasRequestContext(pr) && (
                  <RequestContextFields pr={pr} className={showDetails ? 'border-t border-[--color-border] pt-4' : ''} />
                )}
              </CardContent>
            </Card>
          )}
          <PRItemsSection prId={id} pr={pr} canEdit={!!pr.permissions?.edit} category={pr.category} />
          {/* The request's suppliers, with their profiles, once the BAC's award is recorded (everyone on the request) */}
          <QuotedSuppliers pr={pr} />
        </div>
      )}
      {tab === 'canvass' && <CanvassTab pr={pr} role={role} />}
      {tab === 'orders' && <PurchaseOrders pr={pr} canManage={canManage} />}
      {tab === 'documents' && <DocumentsTab pr={pr} role={role} />}
      {tab === 'history' && <ActivityLog prId={id} />}

      {/* The last look before it goes to the TWG */}
      <ReviewSubmitDialog open={reviewing} items={reviewItems || null} pending={isPending}
        request={{ ...pr, fund_source: isRequestor ? null : pr.fund_source, quarter_label: pr.quarter_label ? `${pr.quarter_label} ${pr.quarter_year}` : null }}
        requestedBy={pr.requested_by_name ? `${pr.requested_by_name}${pr.requested_by_designation ? `, ${pr.requested_by_designation}` : ''}` : null}
        confirmLabel={pr.status === 'revision_requested' ? 'Submit again' : 'Submit to TWG'}
        onConfirm={() => updateStatus({ status: 'submitted' }, { onSuccess: () => setReviewing(false) })}
        onClose={() => setReviewing(false)} />

      <DeletePRDialog pr={showDeletePR ? pr : null} onClose={() => setShowDeletePR(false)} onDeleted={() => navigate(listPath)} />
      {starting && <StartCanvassDialog pr={pr} onClose={() => setStarting(false)} />}
      {twgAction && <TwgReviewDialog pr={pr} action={twgAction} onClose={() => setTwgAction(null)} />}

      {/* Return for changes: a reason is required; the requestor edits and resubmits to the TWG */}
      <Dialog open={returnOpen} onOpenChange={o => { if (!o) setReturnOpen(false) }}>
        <DialogContent title="Return for changes">
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
              {isPending ? 'Returning…' : 'Return for changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// For the TWG: each requested item beside the PPMP line it is drawn from, with the whole PPMP a click away.
function PpmpCheck({ pr }) {
  const id = String(pr.id)
  const { data: items = [] } = useQuery({ queryKey: ['pr', id, 'items'], queryFn: () => api.get(`/pr/${id}/items`).then(r => r.data) })
  const { data: review } = usePrPpmp(id)
  const planName = review?.plan ? `${review.plan.office_code} PPMP, FY ${review.plan.fiscal_year}` : null
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ListChecks className="size-4 text-[--color-text-muted]" />
          <CardTitle>Compared with the PPMP</CardTitle>
          {planName && <span className="truncate text-xs font-normal text-[--color-text-muted]">{planName}</span>}
        </div>
        <ViewPpmpButton plan={review?.plan} />
      </CardHeader>
      <CardContent className="p-0"><PpmpComparison prId={id} items={items} /></CardContent>
    </Card>
  )
}

function ActivityLog({ prId }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['pr-logs', prId],
    queryFn: () => api.get(`/pr/${prId}/logs`).then(r => r.data),
  })

  if (!isLoading && logs.length === 0) return <p className="py-6 text-center text-sm text-[--color-text-muted]">Nothing has happened to this request yet.</p>

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <History className="size-4 text-[--color-text-muted]" />
        <CardTitle>Activity log</CardTitle>
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
                      {log.to_status === 'deleted' ? 'Deleted' : PR_STATUS_LABELS[log.to_status] || log.to_status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[10px] text-[--color-text-muted]">by {log.changed_by_name}</span>
                    <span className="text-[10px] text-[--color-text-muted]">·</span>
                    <span className="text-[10px] text-[--color-text-muted]">{fmtDatetime(log.created_at)}</span>
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

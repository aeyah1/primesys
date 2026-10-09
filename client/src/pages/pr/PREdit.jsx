import { useState, useEffect, Fragment } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Package, Plus, Trash2, Send } from 'lucide-react'
import ItemCategorySelector from '@/components/shared/ItemCategorySelector'
import RequestContextForm from '@/components/shared/RequestContextForm'
import { requesterPayload } from '@/components/shared/RequesterFields'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtCurrency, CATEGORY_FORM, buildItemNotes, groupItemsBySection, FUND_SOURCES, CATEGORY_LABELS } from '@/lib/utils'
import { SectionNameInput, SectionHeaderRow } from '@/components/shared/ItemSections'
import CategorySpecFields from '@/components/shared/CategorySpecFields'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'
import ReviewSubmitDialog from '@/components/shared/ReviewSubmitDialog'
import { usePpmpPlans, takenByKey, lineChecks, PpmpLineNote, PpmpItemField, NoPpmpNotice, quarterOf } from '@/components/ppmp/PpmpLinePicker'
import { usePrPpmp } from '@/components/ppmp/PpmpComparison'

// off_plan: an item not in the PPMP, typed with its own name and unit (only on a Re-PR'd request).
const EMPTY_DRAFT = { group_label: '', stock_property_no: '', category: '', ppmp_item_id: null, line: null, quantity: '1', estimated_cost: '', specs: {}, off_plan: false, item_name: '', unit: '' }

const TH = ({ children, className = '' }) => (
  <th className={`px-4 py-3 text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider bg-[--color-canvas] ${className}`}>
    {children}
  </th>
)
const TD = ({ children, className = '' }) => (
  <td className={`px-4 py-3.5 text-sm ${className}`}>{children}</td>
)

export default function PREdit() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const { user }  = useAuth()
  const isRequestor = user?.role === 'requestor'

  const [form, setForm]     = useState({
    title: '', fund_cluster: '', fund_source: 'STF', responsibility_center_code: '', category: 'office_supplies',
    department: '', department_id: '', purpose_type: 'personal', purpose: '', recommended_by: '',
    event_name: '', event_date: '', project_name: '',
    requested_by_name: '', requested_by_designation: '', signature: null, signature_changed: false,
  })
  const [items, setItems]   = useState([])
  const [reviewing, setReviewing] = useState(false)
  const [draft, setDraft]   = useState(EMPTY_DRAFT)
  const [initialized, setInitialized] = useState(false)
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const setD = (k, v) => setDraft(p => ({ ...p, [k]: v }))
  const setContext = (next) => setForm(p => ({ ...p, ...next }))

  const categoryForm = CATEGORY_FORM[form.category] || CATEGORY_FORM.office_supplies

  const setCategory = (next) => {
    setF('category', next)
    setDraft(p => ({ ...p, specs: {} }))
  }

  const { data: pr, isLoading: prLoading } = useQuery({
    queryKey: ['pr', id],
    queryFn: () => api.get(`/pr/${id}`).then(r => r.data),
  })

  const { data: existingItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['pr-items', id],
    queryFn: () => api.get(`/pr/${id}/items`).then(r => r.data),
    enabled: !!pr,
  })

  useEffect(() => {
    if (pr && !initialized) {
      setForm({
        title:                      pr.title                      || '',
        fund_cluster:               pr.fund_cluster               || '',
        fund_source:                pr.fund_source                || 'STF',
        responsibility_center_code: pr.responsibility_center_code || '',
        category:                   pr.category                   || 'office_supplies',
        department:                 pr.department                 || '',
        department_id:              pr.department_id              || '',
        purpose_type:               pr.purpose_type               || 'personal',
        // No longer asked for, only carried, so an edit does not erase the
        // justification a request filed before the field was removed still holds.
        purpose:                    pr.purpose                    || '',
        // MySQL DATE column comes back as 'YYYY-MM-DDTHH:mm:ss.sssZ' through
        // JSON serialization — slice to the date portion for <input type="date">.
        recommended_by:             pr.recommended_by             || '',   // carried, not asked
        event_name:                 pr.event_name                 || '',
        event_date:                 pr.event_date                 ? String(pr.event_date).slice(0, 10)  : '',
        project_name:               pr.project_name               || '',
        // Who requested it as the request names them; their signature loads below.
        requested_by_name:          pr.requested_by_name          || '',
        requested_by_designation:   pr.requested_by_designation   || '',
        requested_by_touched:       !!pr.requested_by_name,
        signature:                  null,
        signature_changed:          false,
      })
      setInitialized(true)
    }
  }, [pr, initialized])

  // The signature already on the request, shown until it is signed again or removed.
  const { data: savedSignature } = useQuery({
    queryKey: ['pr-signature', id],
    queryFn: () => api.get(`/pr/${id}/requester-signature`).then(r => r.data),
    enabled: !!pr?.requested_by_signed,
  })
  useEffect(() => {
    if (initialized && savedSignature?.image) {
      setForm(p => (p.signature || p.signature_changed ? p : { ...p, signature: { image: savedSignature.image, method: savedSignature.method } }))
    }
  }, [initialized, savedSignature])

  useEffect(() => {
    if (existingItems.length > 0 && initialized && items.length === 0) {
      setItems(existingItems.map(i => ({ ...i, _existing: true, _quantity: i.quantity, _cost: i.estimated_cost })))
    }
  }, [existingItems, initialized])

  const { mutateAsync: updatePR } = useMutation({
    mutationFn: (body) => api.patch(`/pr/${id}`, body),
  })
  const [saving, setSaving] = useState(false)

  const { mutate: deleteItemReq } = useMutation({
    mutationFn: (itemId) => api.delete(`/pr/${id}/items/${itemId}`),
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove item'),
  })

  // Items come from the office's Final PPMP in effect; this request's own holds are left out while it is edited.
  const { plans, isLoading: plansLoading, lineById } = usePpmpPlans({ departmentId: isRequestor ? null : form.department_id, prId: id })
  const taken = takenByKey(items, lineById)
  // The quarter of the PPMP's year the request draws on (1 to 4), or null: the year's total applies.
  const quarter = quarterOf(plans, pr && { label: pr.quarter_label, year: pr.quarter_year })
  const planYear = items.map(i => lineById.get(Number(i.ppmp_item_id))?.fiscal_year).find(Boolean) ?? (quarter ? Number(pr.quarter_year) : undefined)
  const checkItem = (item, exceptIndex) => {
    const line = item.line || lineById.get(Number(item.ppmp_item_id))
    return line ? { line, ...lineChecks(line, { quantity: item.quantity, price: item.estimated_cost, quarter, taken: takenByKey(items, lineById, exceptIndex).get(line.key) || 0 }) } : null
  }
  const draftCheck = draft.line ? checkItem(draft, -1) : null
  // A picked line brings its price; typing over it clears the pick.
  const pickLine = (line) => setDraft(p => (line ? { ...p, ppmp_item_id: line.id, line, estimated_cost: String(line.unit_cost) } : { ...p, ppmp_item_id: null, line: null }))

  // A Re-PR'd request may go past the PPMP: prices above a line, items not in it; the extra comes out of the office's budget.
  const rePr = pr?.re_pr_count > 0
  const { data: review } = usePrPpmp(rePr ? id : null)
  const offPlanReady = draft.item_name.trim() && draft.unit.trim() && parseFloat(draft.estimated_cost) > 0

  const handleAddItem = () => {
    if (draft.off_plan ? !offPlanReady : !draft.line) { toast.error(draft.off_plan ? 'Give the item\'s name, unit and price' : 'Pick the item from the PPMP'); return }
    if (!draft.off_plan && draftCheck?.block) { toast.error(draftCheck.block); return }
    const notes = buildItemNotes(form.category, draft.specs)
    const newItem = {
      group_label:       draft.group_label,
      stock_property_no: draft.stock_property_no.trim(),
      category:          draft.category || form.category,
      ppmp_item_id:      draft.off_plan ? null : draft.line.id,
      item_name:         draft.off_plan ? draft.item_name.trim() : draft.line.description,
      quantity:          draft.quantity,
      unit:              draft.off_plan ? draft.unit.trim() : draft.line.unit,
      estimated_cost:    draft.estimated_cost,
      notes,
      _new: true,
    }
    setItems(p => [...p, newItem])
    setDraft(p => ({ ...EMPTY_DRAFT, group_label: p.group_label, off_plan: p.off_plan }))   // the section stays for the next item
  }

  // "Add item" on a section heading: point the add form at that section.
  const addToSection = (label) => setD('group_label', label)

  const handleRemoveItem = (idx) => {
    const item = items[idx]
    if (item._existing && item.id) {
      deleteItemReq(item.id)
    }
    setItems(p => p.filter((_, i) => i !== idx))
  }

  // Saves the changes and any new items, in order; with `submit`, then sends
  // the PR to the TWG (a draft, or a PR the TWG sent back for changes).
  // Submitting shows the review first (ReviewSubmitDialog); its Submit confirms.
  const handleSubmit = async (e, { submit = false, confirmed = false } = {}) => {
    e?.preventDefault()
    if (!form.title.trim()) { toast.error('Give your request a purpose'); return }
    if (submit && items.length === 0) { toast.error('Add at least one item before submitting'); return }
    if (items.some(i => !(parseFloat(i.quantity) > 0))) { toast.error('Give every item a quantity above 0, or remove it'); return }
    if (submit && processed.some(i => (!i.ppmp_item_id && !rePr) || i.check?.block)) { toast.error('Pick every item from the PPMP, and lower the ones marked in red to what is left'); return }
    if (submit && !confirmed) { setReviewing(true); return }
    setSaving(true)
    try {
      const { signature, signature_changed, requested_by_touched, department_touched, ...details } = form
      await updatePR({ ...details, ...requesterPayload(form) })
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update PR')
      setSaving(false)
      return
    }

    let failed = 0
    for (const item of items.filter(i => i._new)) {
      try {
        await api.post(`/pr/${id}/items`, {
          group_label:       item.group_label       || undefined,
          ppmp_item_id:      item.ppmp_item_id      || undefined,
          stock_property_no: item.stock_property_no || undefined,
          category:          item.category          || undefined,
          item_name:      item.item_name,
          quantity:       parseFloat(item.quantity)       || 1,
          unit:           item.unit           || undefined,
          estimated_cost: item.estimated_cost ? parseFloat(item.estimated_cost) : undefined,
          notes:          item.notes?.trim() || undefined,
        })
      } catch { failed++ }
    }
    // Saved items whose quantity (or, on a Re-PR, price) was changed in the list.
    const costChanged = (i) => (parseFloat(i.estimated_cost) || 0) !== (parseFloat(i._cost) || 0)
    for (const item of items.filter(i => i._existing && (parseFloat(i.quantity) !== parseFloat(i._quantity) || costChanged(i)))) {
      try {
        await api.patch(`/pr/${id}/items/${item.id}`, { quantity: parseFloat(item.quantity), ...(costChanged(item) ? { estimated_cost: parseFloat(item.estimated_cost) || null } : {}) })
      } catch { failed++ }
    }
    if (failed) toast.error(`${failed} item${failed === 1 ? '' : 's'} could not be saved, so the PR was not submitted`)

    let sent = false
    if (submit && !failed) {
      try {
        await api.patch(`/pr/${id}/status`, { status: 'submitted' })
        sent = true
      } catch (err) {
        toast.error(err.response?.data?.message || 'Saved, but it could not be submitted')
      }
    }
    if (!failed && (sent || !submit)) toast.success(sent ? 'Saved and sent to the TWG' : 'Changes saved')

    qc.invalidateQueries({ queryKey: ['pr', id] })
    qc.invalidateQueries({ queryKey: ['pr-items', id] })
    qc.invalidateQueries({ queryKey: ['pr-list'] })
    qc.invalidateQueries({ queryKey: ['pr-stats'] })
    navigate(`/pr/${id}`)
  }

  // Offered while the server would let this user send the PR to the TWG.
  const canSubmit = !!pr?.permissions?.next_statuses?.includes('submitted')

  const processed = items.map((item, i) => ({
    ...item,
    globalIdx: i,
    check: checkItem(item, i),
    totalCost: (parseFloat(item.estimated_cost) || 0) * (parseFloat(item.quantity) || 1),
  }))
  const grouped    = groupItemsBySection(processed)
  const grandTotal = processed.reduce((s, it) => s + it.totalCost, 0)
  // On a Re-PR: what this request takes of the office's PPMP budget as edited (in-plan quantities at the line's
  // cost, plus everything past the plan), against what the other requests leave of it (from the server).
  const budget = rePr && review?.budget ? processed.reduce((b, it) => {
    const qty = parseFloat(it.quantity) || 0, cost = parseFloat(it.estimated_cost) || 0
    const line = it.line || lineById.get(Number(it.ppmp_item_id))
    if (it.ppmp_item_id && line) return { ...b, mine: b.mine + qty * Math.max(cost, line.unit_cost), extra: b.extra + Math.max(0, qty * (cost - line.unit_cost)) }
    return it.ppmp_item_id ? b : { ...b, mine: b.mine + qty * cost, extra: b.extra + qty * cost }
  }, { left: review.budget.left, mine: 0, extra: 0 }) : null
  const overBudget = !!budget && budget.extra > 0 && budget.mine > budget.left + 0.005
  const draftTotal = draft.estimated_cost && draft.quantity
    ? parseFloat(draft.estimated_cost) * (parseFloat(draft.quantity) || 1)
    : 0

  if (prLoading || itemsLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )

  if (!pr) return (
    <div className="text-center py-20 text-[--color-text-muted]">PR not found.</div>
  )

  if (!pr.permissions?.edit) return (
    <div className="text-center py-20 text-[--color-text-muted]">This PR can no longer be edited at its current stage.</div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h2 className="text-ui-xl font-bold text-[--color-text-primary]">Edit Purchase Request</h2>
          <p className="text-ui-xs text-[--color-text-muted] mt-0.5 font-mono">{pr.pr_number}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Request Context */}
        <Card>
          <CardHeader>
            <CardTitle>About your request</CardTitle>
            <p className="text-ui-xs text-[--color-text-muted] mt-1">Who is asking, what it is for, and when it is needed.</p>
          </CardHeader>
          <CardContent>
            <RequestContextForm value={form} onChange={setContext} prId={id} />
          </CardContent>
        </Card>

        {/* PR Details */}
        <Card>
          <CardHeader><CardTitle>Purpose and type</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>
                Mostly what kind of items?
                <span className="ml-1.5 text-[10px] text-[--color-text-muted] font-normal">hover the info icon for examples</span>
              </Label>
              <ItemCategorySelector value={form.category} onChange={setCategory} />
              <p className="text-[11px] text-[--color-text-muted]">
                Sets the wording below and the starting kind for each item — change any item that differs.
                Which TWG area reviews this request is worked out from the items themselves.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="title">
                Purpose <span className="text-[--color-brand] text-xs">*</span>
                <span className="ml-1.5 text-[10px] text-[--color-text-muted] font-normal">a short phrase, printed on the request</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g. Office Use of the Department of Computer Studies"
                value={form.title}
                onChange={e => setF('title', e.target.value)}
                required
              />
              <p className="text-[11px] text-[--color-text-muted]">
                Goes in the Purpose line of the printed request, and names it in your list.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Quarter</Label>
              <div className="flex h-10 items-center rounded-lg border border-[--color-border] bg-[--color-canvas] px-3">
                <span className="text-sm text-[--color-text-muted]">
                  {pr.quarter_label ? `${pr.quarter_label} ${pr.quarter_year}` : 'No quarter assigned'}
                </span>
              </div>
            </div>

            {/* Fund codes are the Procurement Office's to set, not the requestor's */}
            {!isRequestor && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Source of Fund</Label>
                <Select value={form.fund_source} onValueChange={v => setF('fund_source', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FUND_SOURCES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-[--color-text-muted]">
                  Changing this replaces the fund cluster below with that source's code.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fc">Fund Cluster <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span></Label>
                <Input id="fc" placeholder="e.g. 05-206441" value={form.fund_cluster} onChange={e => setF('fund_cluster', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rcc">Responsibility Center Code <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span></Label>
                <Input id="rcc" placeholder="e.g. 08-106-000000" value={form.responsibility_center_code} onChange={e => setF('responsibility_center_code', e.target.value)} />
              </div>
            </div>
            )}
          </CardContent>
        </Card>

        {/* Item List */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-[--color-text-muted]" />
              <CardTitle>Item List</CardTitle>
              {items.length > 0 && (
                <span className="text-xs text-[--color-text-muted] font-normal">
                  ({items.length} {items.length === 1 ? 'item' : 'items'})
                </span>
              )}
            </div>
            {grandTotal > 0 && (
              <span className="text-sm font-bold text-blue-700">Grand Total: {fmtCurrency(grandTotal)}</span>
            )}
          </CardHeader>

          <CardContent className="p-0">
            {rePr && (
              <div className={`mx-4 my-3 rounded-lg border px-4 py-3 ${overBudget ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                <p className="text-sm font-semibold">Re-PR: this request may go past the PPMP</p>
                <p className="text-xs mt-1">
                  Raise an item's price above its PPMP line, or add an item that is not in the PPMP (Add Item, Not in the PPMP).
                  What it costs past the plan comes out of your office's PPMP budget.
                </p>
                {budget && (
                  <p className="text-xs mt-1.5 tabular-nums">
                    Left in the {review.plan?.office_code} PPMP budget: <span className="font-bold">{fmtCurrency(budget.left)}</span>.
                    This request takes <span className="font-bold">{fmtCurrency(budget.mine)}</span>{budget.extra > 0 ? `, ${fmtCurrency(budget.extra)} of it past the plan` : ''}.
                    {overBudget && ' That is more than is left: lower the prices or quantities, or remove an item.'}
                  </p>
                )}
              </div>
            )}
            <div className="border-b border-[--color-border]">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr className="border-b border-[--color-border]">
                    <TH className="text-center w-14">No.</TH>
                    <TH className="text-center w-24">Stock/Property</TH>
                    <TH className="text-center w-20">Unit</TH>
                    <TH className="text-left">{categoryForm.itemLabel}</TH>
                    <TH className="text-center w-24">Qty</TH>
                    <TH className="text-right w-32">Estimated Cost</TH>
                    <TH className="text-right w-32">Total Cost</TH>
                    <th className="w-10 bg-[--color-canvas]" />
                  </tr>
                </thead>
                <tbody>
                  {processed.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-sm text-[--color-text-muted]">
                        No items yet — use the form below to add items.
                      </td>
                    </tr>
                  ) : (
                    grouped.map((group, gi) => {
                      const groupTotal = group.items.reduce((s, it) => s + it.totalCost, 0)
                      return (
                        <Fragment key={gi}>
                          {group.label && (
                            <SectionHeaderRow label={group.label} colSpan={8} onAddItem={() => addToSection(group.label)} />
                          )}
                          {group.items.map((item) => (
                            <tr key={item.globalIdx} className="border-b border-[--color-border] hover:bg-[--color-canvas]">
                              <TD className="text-center text-[--color-text-muted] font-medium">{item.rowNum}</TD>
                              <TD className="text-center text-[--color-text-secondary] tabular-nums">{item.stock_property_no || '—'}</TD>
                              <TD className="text-center font-semibold text-[--color-text-primary]">{item.unit || '—'}</TD>
                              <TD className="text-left font-medium text-[--color-text-primary] leading-relaxed">
                                {item.item_name}
                                {item.notes && (
                                  <div className="mt-2 text-sm text-[--color-text-secondary] whitespace-pre-wrap leading-relaxed">
                                    {item.notes}
                                  </div>
                                )}
                                {item.check ? <PpmpLineNote {...item.check} left={null} planned={item.check.line.planned} className="mt-2 font-normal" />
                                  : item.ppmp_item_id ? <p className="mt-2 text-[11px] text-[--color-text-muted]">From an earlier version of the PPMP; checked against the current one when submitted.</p>
                                  : rePr ? <p className="mt-2 text-[11px] font-semibold text-amber-700">Not in the PPMP (Re-PR): its cost comes out of the office's PPMP budget.</p>
                                  : <p className="mt-2 text-[11px] font-semibold text-red-700">Not from the PPMP. Remove it and pick it from the PPMP.</p>}
                              </TD>
                              <TD className="text-center">
                                <Input type="number" min="0.01" step="any" aria-label={`Quantity of ${item.item_name}`} value={item.quantity}
                                  onChange={e => setItems(p => p.map((x, i) => (i === item.globalIdx ? { ...x, quantity: e.target.value } : x)))}
                                  className={`h-9 w-20 px-2 text-center tabular-nums ${item.check?.block ? 'border-red-400 text-red-700' : ''}`} />
                              </TD>
                              <TD className="text-right tabular-nums text-[--color-text-secondary]">
                                {rePr ? (
                                  <Input type="number" min="0" step="any" aria-label={`Price each of ${item.item_name}`} value={item.estimated_cost ?? ''}
                                    onChange={e => setItems(p => p.map((x, i) => (i === item.globalIdx ? { ...x, estimated_cost: e.target.value } : x)))}
                                    className="ml-auto h-9 w-28 px-2 text-right tabular-nums" />
                                ) : item.estimated_cost ? fmtCurrency(parseFloat(item.estimated_cost)) : '—'}
                              </TD>
                              <TD className="text-right tabular-nums font-bold text-[--color-text-primary]">
                                {item.totalCost > 0 ? fmtCurrency(item.totalCost) : '—'}
                              </TD>
                              <td className="px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(item.globalIdx)}
                                  className="p-1.5 rounded text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </td>
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
                              <td />
                            </tr>
                          )}
                        </Fragment>
                      )
                    })
                  )}
                  {grandTotal > 0 && (
                    <tr className="bg-blue-50 border-b border-blue-200">
                      <td colSpan={6} className="px-6 py-3.5 text-right text-sm font-bold text-blue-800">
                        Grand Total
                      </td>
                      <td className="px-4 py-3.5 text-right text-base font-bold tabular-nums text-blue-700">
                        {fmtCurrency(grandTotal)}
                      </td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Add Item Form */}
            {!plansLoading && !plans.length ? (
              <div className="px-4 py-4"><NoPpmpNotice requestor={isRequestor} /></div>
            ) : (
            <div className="bg-[--color-canvas] px-4 py-4 space-y-3">
              <p className="text-xs font-semibold text-[--color-text-muted] uppercase tracking-wide">Add Item</p>
              {rePr && (
                <label className="flex items-center gap-2 text-xs font-medium text-[--color-text-secondary]">
                  <input type="checkbox" checked={draft.off_plan} className="accent-amber-600"
                    onChange={e => setDraft(p => ({ ...p, off_plan: e.target.checked, ppmp_item_id: null, line: null }))} />
                  Not in the PPMP: type the item yourself (Re-PR; its cost comes out of the office's PPMP budget)
                </label>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">
                    {categoryForm.sectionLabel}
                    <span className="ml-1 font-normal text-[--color-text-muted]">(optional) Items with the same name share one section and subtotal.</span>
                  </Label>
                  <SectionNameInput
                    id="pr-section"
                    placeholder={categoryForm.sectionPlaceholder}
                    value={draft.group_label}
                    onChange={v => setD('group_label', v)}
                    sections={grouped.map(g => g.label).filter(Boolean)}
                  />
                </div>
                {/* What kind of thing this item is; follows the choice above
                    unless changed here. Decides which TWG area reviews it. */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Kind of item</Label>
                  <Select value={draft.category || form.category} onValueChange={v => setD('category', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
                      <Label htmlFor="pr-off-plan-item" className="text-xs">Item (not in the PPMP)</Label>
                      <Input id="pr-off-plan-item" maxLength={500} placeholder="What it is, without a brand" value={draft.item_name} onChange={e => setD('item_name', e.target.value)} />
                    </div>
                  ) : (
                    <PpmpItemField id="pr-ppmp-item" plans={plans} isLoading={plansLoading} value={draft.line} onPick={pickLine} taken={taken} year={planYear} quarter={quarter}
                      kind={draft.category || form.category} />
                  )}
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Unit</Label>
                  {draft.off_plan ? (
                    <Input maxLength={50} placeholder="pc, set, ream" aria-label="Unit of the item not in the PPMP" value={draft.unit} onChange={e => setD('unit', e.target.value)} />
                  ) : (
                    <div className="flex h-10 items-center rounded-lg border border-[--color-border] bg-[--color-canvas] px-3 text-sm text-[--color-text-secondary]">
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
                    type="button" className="w-full px-0"
                    disabled={draft.off_plan ? !offPlanReady : !draft.line || !!draftCheck?.block}
                    onClick={handleAddItem}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>

              {!draft.off_plan && draftCheck && <PpmpLineNote {...draftCheck} />}

              {/* Per-category structured spec fields */}
              <CategorySpecFields
                category={form.category}
                specs={draft.specs}
                onChange={(next) => setD('specs', next)}
              />
            </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="lg" onClick={() => navigate(-1)} className="px-8">
            Cancel
          </Button>
          <Button type="submit" size="lg" variant={canSubmit ? 'secondary' : 'default'} disabled={saving} className="px-8">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          {canSubmit && (
            <Button type="button" size="lg" disabled={saving} className="px-8 gap-2" onClick={(e) => handleSubmit(e, { submit: true })}>
              <Send className="size-4" />
              {pr.status === 'revision_requested' ? 'Save and resubmit to TWG' : 'Save and submit to TWG'}
            </Button>
          )}
        </div>
      </form>

      <ReviewSubmitDialog open={reviewing} items={items} pending={saving}
        request={{ ...form, id: pr.id, pr_number: pr.pr_number, fund_source: pr.permissions?.edit && user?.role !== 'requestor' ? form.fund_source : null }}
        requestedBy={pr.requested_by_name ? `${pr.requested_by_name}${pr.requested_by_designation ? `, ${pr.requested_by_designation}` : ''}` : null}
        confirmLabel={pr.status === 'revision_requested' ? 'Save and resubmit' : 'Save and submit'}
        onConfirm={() => handleSubmit(null, { submit: true, confirmed: true })}
        onClose={() => setReviewing(false)} />
    </div>
  )
}

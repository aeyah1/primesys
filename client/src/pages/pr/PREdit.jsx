import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Package, Plus, Trash2, Send } from 'lucide-react'
import ItemCategorySelector from '@/components/shared/ItemCategorySelector'
import UnitInput from '@/components/shared/UnitInput'
import RequestContextForm from '@/components/shared/RequestContextForm'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtCurrency, CATEGORY_FORM, buildItemNotes, groupItemsBySection } from '@/lib/utils'
import { SectionNameInput, SectionHeaderRow } from '@/components/shared/ItemSections'
import CategorySpecFields from '@/components/shared/CategorySpecFields'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const EMPTY_DRAFT = { group_label: '', item_name: '', quantity: '1', unit: 'pc', estimated_cost: '', specs: {} }

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
  const itemRef   = useRef(null)
  const { user }  = useAuth()
  const isRequestor = user?.role === 'requestor'

  const [form, setForm]     = useState({
    title: '', fund_cluster: '', responsibility_center_code: '', category: 'office_supplies',
    department: '', purpose_type: 'personal', purpose: '', date_needed: '', recommended_by: '',
    event_name: '', event_date: '', project_name: '',
  })
  const [items, setItems]   = useState([])
  const [draft, setDraft]   = useState(EMPTY_DRAFT)
  const [initialized, setInitialized] = useState(false)
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const setD = (k, v) => setDraft(p => ({ ...p, [k]: v }))
  const setContext = (next) => setForm(p => ({ ...p, ...next }))

  const categoryForm = CATEGORY_FORM[form.category] || CATEGORY_FORM.office_supplies

  const setCategory = (next) => {
    const nextForm = CATEGORY_FORM[next] || CATEGORY_FORM.office_supplies
    setF('category', next)
    setDraft(p => ({
      ...p,
      unit:  nextForm.units.includes(p.unit) ? p.unit : nextForm.defaultUnit,
      specs: {},
    }))
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
        responsibility_center_code: pr.responsibility_center_code || '',
        category:                   pr.category                   || 'office_supplies',
        department:                 pr.department                 || '',
        purpose_type:               pr.purpose_type               || 'personal',
        purpose:                    pr.purpose                    || '',
        // MySQL DATE column comes back as 'YYYY-MM-DDTHH:mm:ss.sssZ' through
        // JSON serialization — slice to the date portion for <input type="date">.
        date_needed:                pr.date_needed                ? String(pr.date_needed).slice(0, 10) : '',
        recommended_by:             pr.recommended_by             || '',
        event_name:                 pr.event_name                 || '',
        event_date:                 pr.event_date                 ? String(pr.event_date).slice(0, 10)  : '',
        project_name:               pr.project_name               || '',
      })
      setInitialized(true)
    }
  }, [pr, initialized])

  useEffect(() => {
    if (existingItems.length > 0 && initialized && items.length === 0) {
      setItems(existingItems.map(i => ({ ...i, _existing: true })))
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

  const handleAddItem = () => {
    if (!draft.item_name.trim()) { toast.error('Item description is required'); return }
    const notes = buildItemNotes(form.category, draft.specs)
    const newItem = {
      group_label:    draft.group_label,
      item_name:      draft.item_name.trim(),
      quantity:       draft.quantity,
      unit:           draft.unit,
      estimated_cost: draft.estimated_cost,
      notes,
      _new: true,
    }
    setItems(p => [...p, newItem])
    setDraft(p => ({ ...EMPTY_DRAFT, unit: p.unit, group_label: p.group_label }))   // the section stays for the next item
    itemRef.current?.focus()
  }

  // "Add item" on a section heading: point the add form at that section.
  const addToSection = (label) => {
    setD('group_label', label)
    itemRef.current?.focus()
  }

  const handleRemoveItem = (idx) => {
    const item = items[idx]
    if (item._existing && item.id) {
      deleteItemReq(item.id)
    }
    setItems(p => p.filter((_, i) => i !== idx))
  }

  // Saves the changes and any new items, in order; with `submit`, then sends
  // the PR to the TWG (a draft, or a PR the TWG sent back for changes).
  const handleSubmit = async (e, { submit = false } = {}) => {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('Give your request a short title'); return }
    if (submit && items.length === 0) { toast.error('Add at least one item before submitting'); return }
    setSaving(true)
    try {
      await updatePR(form)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update PR')
      setSaving(false)
      return
    }

    let failed = 0
    for (const item of items.filter(i => i._new)) {
      try {
        await api.post(`/pr/${id}/items`, {
          group_label:    item.group_label    || undefined,
          item_name:      item.item_name,
          quantity:       parseFloat(item.quantity)       || 1,
          unit:           item.unit           || undefined,
          estimated_cost: item.estimated_cost ? parseFloat(item.estimated_cost) : undefined,
          notes:          item.notes?.trim() || undefined,
        })
      } catch { failed++ }
    }
    if (failed) toast.error(`${failed} new item${failed === 1 ? '' : 's'} could not be saved, so the PR was not submitted`)

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
    totalCost: (parseFloat(item.estimated_cost) || 0) * (parseFloat(item.quantity) || 1),
  }))
  const grouped    = groupItemsBySection(processed)
  const grandTotal = processed.reduce((s, it) => s + it.totalCost, 0)
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
            <RequestContextForm value={form} onChange={setContext} />
          </CardContent>
        </Card>

        {/* PR Details */}
        <Card>
          <CardHeader><CardTitle>Title and type</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>
                What kind of items? <span className="text-red-500 text-xs">*</span>
                <span className="ml-1.5 text-[10px] text-[--color-text-muted] font-normal">pick the closest match; hover the info icon for examples</span>
              </Label>
              <ItemCategorySelector value={form.category} onChange={setCategory} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="title">
                Short title <span className="text-[--color-brand] text-xs">*</span>
                <span className="ml-1.5 text-[10px] text-[--color-text-muted] font-normal">a few words so you can find it later</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g. Snacks for DCS Days"
                value={form.title}
                onChange={e => setF('title', e.target.value)}
                required
              />
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
            <div className="border-b border-[--color-border]">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr className="border-b border-[--color-border]">
                    <TH className="text-center w-14">No.</TH>
                    <TH className="text-center w-20">Unit</TH>
                    <TH className="text-left">{categoryForm.itemLabel}</TH>
                    <TH className="text-center w-16">Qty</TH>
                    <TH className="text-right w-32">Estimated Cost</TH>
                    <TH className="text-right w-32">Total Cost</TH>
                    <th className="w-10 bg-[--color-canvas]" />
                  </tr>
                </thead>
                <tbody>
                  {processed.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-sm text-[--color-text-muted]">
                        No items yet — use the form below to add items.
                      </td>
                    </tr>
                  ) : (
                    grouped.map((group, gi) => {
                      const groupTotal = group.items.reduce((s, it) => s + it.totalCost, 0)
                      return (
                        <Fragment key={gi}>
                          {group.label && (
                            <SectionHeaderRow label={group.label} colSpan={7} onAddItem={() => addToSection(group.label)} />
                          )}
                          {group.items.map((item) => (
                            <tr key={item.globalIdx} className="border-b border-[--color-border] hover:bg-[--color-canvas]">
                              <TD className="text-center text-[--color-text-muted] font-medium">{item.rowNum}</TD>
                              <TD className="text-center font-semibold text-[--color-text-primary]">{item.unit || '—'}</TD>
                              <TD className="text-left font-medium text-[--color-text-primary] leading-relaxed">
                                {item.item_name}
                                {item.notes && (
                                  <div className="mt-2 text-sm text-[--color-text-secondary] whitespace-pre-wrap leading-relaxed">
                                    {item.notes}
                                  </div>
                                )}
                              </TD>
                              <TD className="text-center tabular-nums font-medium">{item.quantity}</TD>
                              <TD className="text-right tabular-nums text-[--color-text-secondary]">
                                {item.estimated_cost ? fmtCurrency(parseFloat(item.estimated_cost)) : '—'}
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
                              <td colSpan={5} className="px-6 py-3 text-right text-sm font-semibold text-[--color-text-secondary]">
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
                      <td colSpan={5} className="px-6 py-3.5 text-right text-sm font-bold text-blue-800">
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
            <div className="bg-[--color-canvas] px-4 py-4 space-y-3">
              <p className="text-xs font-semibold text-[--color-text-muted] uppercase tracking-wide">Add Item</p>

              <div className="space-y-1.5">
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

              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5 space-y-1">
                  <Label className="text-xs">{categoryForm.itemLabel} <span className="text-[--color-brand]">*</span></Label>
                  <Input
                    ref={itemRef}
                    placeholder={categoryForm.itemPlaceholder}
                    value={draft.item_name}
                    onChange={e => setD('item_name', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddItem())}
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
                    type="button" className="w-full px-0"
                    disabled={!draft.item_name.trim()}
                    onClick={handleAddItem}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>

              {/* Per-category structured spec fields */}
              <CategorySpecFields
                category={form.category}
                specs={draft.specs}
                onChange={(next) => setD('specs', next)}
              />
            </div>
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
    </div>
  )
}

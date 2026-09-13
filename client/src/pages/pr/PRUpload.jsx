import { useState, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Package, Plus, Trash2, Info } from 'lucide-react'
import ItemCategorySelector from '@/components/shared/ItemCategorySelector'
import UnitInput from '@/components/shared/UnitInput'
import RequestContextForm from '@/components/shared/RequestContextForm'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtCurrency, CATEGORY_FORM, buildItemNotes, groupItemsBySection } from '@/lib/utils'
import { SectionNameInput, SectionHeaderRow } from '@/components/shared/ItemSections'
import CategorySpecFields from '@/components/shared/CategorySpecFields'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const EMPTY_DRAFT = { group_label: '', item_name: '', quantity: '1', unit: 'ream', estimated_cost: '', specs: {} }

const TH = ({ children, className = '' }) => (
  <th className={`px-4 py-3 text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider bg-[--color-canvas] ${className}`}>
    {children}
  </th>
)

const TD = ({ children, className = '' }) => (
  <td className={`px-4 py-3.5 text-sm ${className}`}>
    {children}
  </td>
)

function AutoField({ label, value }) {
  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-canvas] px-4 py-3">
      <p className="text-[11px] font-semibold text-[--color-text-muted] uppercase tracking-wide mb-1">{label}</p>
      {value ? (
        <p className="text-sm font-semibold text-[--color-text-primary] font-mono">{value}</p>
      ) : (
        <div className="flex items-center gap-1.5">
          <Info className="size-3 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-600 italic">Not configured — admin must set this in Organization Settings.</p>
        </div>
      )}
    </div>
  )
}

export default function PRCreate() {
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const itemRef   = useRef(null)
  const { user }  = useAuth()

  const isRequestor = user?.role === 'requestor'

  const [form, setForm] = useState({
    quarter_id: '',
    title: '',
    category: 'office_supplies',
    // Request Context (the new end-user-centric fields)
    department: '',
    purpose_type: 'personal',
    purpose: '',
    date_needed: '',
    recommended_by: '',
    event_name: '',
    event_date: '',
    project_name: '',
  })
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Context fields are managed as a sub-object by RequestContextForm. This
  // helper merges its onChange payload back into the flat form state.
  const setContext = (next) => setForm(p => ({ ...p, ...next }))

  const [items, setItems] = useState([])
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const setD = (k, v) => setDraft(p => ({ ...p, [k]: v }))

  const categoryForm = CATEGORY_FORM[form.category] || CATEGORY_FORM.office_supplies

  // Switch category — swap unit to category default if current unit is invalid,
  // AND clear any structured spec values (those are category-scoped).
  const setCategory = (next) => {
    const nextForm = CATEGORY_FORM[next] || CATEGORY_FORM.office_supplies
    setF('category', next)
    setDraft(p => ({
      ...p,
      unit:  nextForm.units.includes(p.unit) ? p.unit : nextForm.defaultUnit,
      specs: {},
    }))
  }

  // Staff pick the quarter and see the fund codes; a requestor's PR goes under
  // the current quarter and gets the fund codes on the server.
  const { data: quarters = [] } = useQuery({
    queryKey: ['quarters'],
    queryFn: () => api.get('/quarters').then(r => r.data),
    enabled: !isRequestor,
  })

  const { data: currentQuarter } = useQuery({
    queryKey: ['quarters', 'current'],
    queryFn: () => api.get('/quarters/current').then(r => r.data),
    enabled: isRequestor,
  })

  const { data: orgSettings = {} } = useQuery({
    queryKey: ['org-settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
    enabled: !isRequestor,
  })

  const { mutate: create, isPending } = useMutation({
    mutationFn: (body) => api.post('/pr', body),
    onSuccess: ({ data }, body) => {
      toast.success(body.status === 'submitted'
        ? `${data.pr_number} sent to the TWG`
        : `${data.pr_number} saved as a draft. Submit it when it's ready.`)
      qc.invalidateQueries({ queryKey: ['pr-list'] })
      qc.invalidateQueries({ queryKey: ['pr-stats'] })
      navigate(`/pr/${data.id}`)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create PR'),
  })

  const handleAddItem = () => {
    if (!draft.item_name.trim()) {
      toast.error('Item description is required')
      return
    }
    if (!draft.quantity || parseFloat(draft.quantity) <= 0) {
      toast.error('Quantity must be greater than 0')
      return
    }
    if (!draft.estimated_cost || parseFloat(draft.estimated_cost) <= 0) {
      toast.error('Enter the price of one item (a rough estimate is fine)')
      return
    }
    // Bake the structured spec values into a single notes string before storing.
    // The local list keeps `notes` as the canonical form; `specs` is UI-only.
    const notes = buildItemNotes(form.category, draft.specs)
    const newItem = {
      group_label:    draft.group_label,
      item_name:      draft.item_name.trim(),
      quantity:       draft.quantity,
      unit:           draft.unit,
      estimated_cost: draft.estimated_cost,
      notes,
    }
    setItems(p => [...p, newItem])
    setDraft(p => ({ ...EMPTY_DRAFT, unit: p.unit, group_label: p.group_label }))   // the section stays for the next item
    itemRef.current?.focus({ preventScroll: true })
  }

  // "Add item" on a section heading: point the add form at that section.
  const addToSection = (label) => {
    setD('group_label', label)
    itemRef.current?.focus()
  }

  const handleRemoveItem = (idx) => setItems(p => p.filter((_, i) => i !== idx))

  const processed = items.map((item, i) => ({
    ...item,
    globalIdx: i,
    totalCost: (parseFloat(item.estimated_cost) || 0) * (parseFloat(item.quantity) || 1),
  }))
  const grouped     = groupItemsBySection(processed)
  const grandTotal  = processed.reduce((s, it) => s + it.totalCost, 0)
  const draftTotal  = draft.estimated_cost && draft.quantity
    ? parseFloat(draft.estimated_cost) * (parseFloat(draft.quantity) || 1)
    : 0

  // The PR is either sent to the TWG or saved as a draft to finish later
  // (drafts may have no items yet). Only the buttons do this, never Enter.
  const handleSubmit = (e, { asDraft = false } = {}) => {
    e.preventDefault()
    if (!form.title.trim()) {
      toast.error('Give your request a short title')
      return
    }
    const submitNow = !asDraft
    if (submitNow && items.length === 0) {
      toast.error('Add at least one item before submitting, or save it as a draft')
      return
    }
    create({
      title:                      form.title.trim(),
      ...(!isRequestor && form.quarter_id ? { quarter_id: parseInt(form.quarter_id) } : {}),
      category:                   form.category,
      // Request Context fields — only sent if the requestor filled them
      department:                 form.department?.trim()     || undefined,
      purpose_type:               form.purpose_type,
      purpose:                    form.purpose?.trim()        || undefined,
      date_needed:                form.date_needed            || undefined,
      recommended_by:             form.recommended_by?.trim() || undefined,
      event_name:                 form.purpose_type === 'event'   ? (form.event_name?.trim() || undefined) : undefined,
      event_date:                 form.purpose_type === 'event'   ? (form.event_date || undefined)        : undefined,
      project_name:               form.purpose_type === 'project' ? (form.project_name?.trim() || undefined) : undefined,
      ...(submitNow ? { status: 'submitted' } : {}),
      // Items go with the PR in the same request, so they're saved together.
      items: items.map(item => ({
        group_label:    item.group_label    || undefined,
        item_name:      item.item_name,
        quantity:       parseFloat(item.quantity)       || 1,
        unit:           item.unit           || undefined,
        estimated_cost: item.estimated_cost ? parseFloat(item.estimated_cost) : undefined,
        notes:          item.notes?.trim() || undefined,
      })),
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h2 className="text-ui-xl font-bold text-[--color-text-primary]">New Purchase Request</h2>
          <p className="text-ui-xs text-[--color-text-muted] mt-0.5">Tell us what you need, why, and by when.</p>
        </div>
      </div>

      <form onSubmit={e => e.preventDefault()} className="space-y-5">

        {isRequestor && (
          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <Info className="size-4 shrink-0 mt-0.5 text-blue-700" />
            <p className="text-ui-sm text-blue-900 leading-relaxed">
              You don't need to know procurement terms. Describe what you need and why. The Technical Working Group
              (TWG) checks your request, and the Procurement Office handles suppliers, orders, and delivery.
              You can save it as a draft and finish later.
            </p>
          </div>
        )}

        {/* ── Request Context ─────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>About your request</CardTitle>
            <p className="text-ui-xs text-[--color-text-muted] mt-1">Who is asking, what it is for, and when it is needed.</p>
          </CardHeader>
          <CardContent>
            <RequestContextForm value={form} onChange={setContext} />
          </CardContent>
        </Card>

        {/* ── PR Details ─────────────────────────────────────── */}
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
                Short title <span className="text-red-500 text-xs">*</span>
                <span className="ml-1.5 text-[10px] text-[--color-text-muted] font-normal">a few words so you can find it later</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g. Snacks for DCS Days"
                value={form.title}
                onChange={e => setF('title', e.target.value)}
              />
            </div>

            {isRequestor ? (
              <p className="text-ui-xs text-[--color-text-muted]">
                {currentQuarter
                  ? <>Your request is filed under the current quarter, <span className="font-semibold text-[--color-text-secondary]">{currentQuarter.label} {currentQuarter.year}</span>.</>
                  : 'Your request is filed under the current year.'}
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>
                    Quarter
                    <span className="text-[--color-text-muted] font-normal text-xs ml-1">(optional; the current quarter if left empty)</span>
                  </Label>
                  <Select value={form.quarter_id} onValueChange={v => setF('quarter_id', v)}>
                    <SelectTrigger><SelectValue placeholder="Select quarter…" /></SelectTrigger>
                    <SelectContent>
                      {quarters.map(q => (
                        <SelectItem key={q.id} value={String(q.id)}>{q.label} {q.year}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Fund Cluster & RCC: filled from Organization settings on the server */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <AutoField label="Fund Cluster" value={orgSettings.fund_cluster} />
                  <AutoField label="Responsibility Center Code" value={orgSettings.responsibility_center_code} />
                </div>
              </>
            )}

          </CardContent>
        </Card>

        {/* ── Item List ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-[--color-text-muted]" />
              <CardTitle>
                {isRequestor ? 'Items you need' : 'Item List'}
                {isRequestor && <span className="text-red-500 text-xs ml-1">*</span>}
              </CardTitle>
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
            {/* Table */}
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
                {/* Item Description */}
                <div className="col-span-5 space-y-1">
                  <Label className="text-xs">{categoryForm.itemLabel}</Label>
                  <Input
                    ref={itemRef}
                    placeholder={categoryForm.itemPlaceholder}
                    value={draft.item_name}
                    onChange={e => setD('item_name', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddItem())}
                  />
                </div>

                {/* Unit — typeable with suggested units in datalist dropdown */}
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

                {/* Quantity */}
                <div className="col-span-1 space-y-1">
                  <Label className="text-xs">Qty</Label>
                  <Input
                    type="number" min="0.01" step="any" placeholder="1"
                    value={draft.quantity}
                    onChange={e => setD('quantity', e.target.value)}
                    className="text-center"
                  />
                </div>

                {/* Estimated Cost */}
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Price each (₱, estimate)</Label>
                  <Input
                    type="number" min="0.01" step="any" placeholder="0.00"
                    value={draft.estimated_cost}
                    onChange={e => setD('estimated_cost', e.target.value)}
                  />
                </div>

                {/* Running total preview */}
                <div className="col-span-1 text-right text-sm font-bold tabular-nums text-blue-700 self-end pb-2">
                  {draftTotal > 0 ? fmtCurrency(draftTotal) : ''}
                </div>

                {/* Add button */}
                <div className="col-span-1 self-end">
                  <Button
                    type="button" className="w-full px-0"
                    disabled={!draft.item_name.trim() || !draft.estimated_cost || parseFloat(draft.estimated_cost) <= 0}
                    onClick={handleAddItem}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>

              {/* Per-category structured spec fields (Brand/Model for Hardware,
                  Material/Dimensions/Color for Furniture, etc.) — replaces the
                  single freeform Specifications textarea. */}
              <CategorySpecFields
                category={form.category}
                specs={draft.specs}
                onChange={(next) => setD('specs', next)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="lg" onClick={() => navigate(-1)} className="px-8">
            Cancel
          </Button>
          <Button type="button" variant="secondary" size="lg" disabled={isPending} className="px-8"
            onClick={(e) => handleSubmit(e, { asDraft: true })}>
            Save as draft
          </Button>
          <Button type="button" size="lg" disabled={isPending} className="px-12"
            onClick={(e) => handleSubmit(e)}>
            {isPending ? 'Saving…' : 'Submit to TWG'}
          </Button>
        </div>
      </form>
    </div>
  )
}

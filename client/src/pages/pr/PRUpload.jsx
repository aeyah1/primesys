import { useState, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Package, Plus, Trash2, Info } from 'lucide-react'
import ItemCategorySelector from '@/components/shared/ItemCategorySelector'
import RequestContextForm from '@/components/shared/RequestContextForm'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtCurrency, CATEGORY_FORM, buildItemNotes, groupItemsBySection, FUND_SOURCES, fundCodeFor, CATEGORY_LABELS } from '@/lib/utils'
import { SectionNameInput, SectionHeaderRow } from '@/components/shared/ItemSections'
import CategorySpecFields from '@/components/shared/CategorySpecFields'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'
import ReviewSubmitDialog from '@/components/shared/ReviewSubmitDialog'
import { usePpmpPlans, takenByKey, lineChecks, PpmpLineNote, PpmpItemField, NoPpmpNotice } from '@/components/ppmp/PpmpLinePicker'

const EMPTY_DRAFT = { group_label: '', stock_property_no: '', category: '', ppmp_item_id: null, line: null, quantity: '1', estimated_cost: '', specs: {} }

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
  const { user }  = useAuth()

  const isRequestor = user?.role === 'requestor'

  const [form, setForm] = useState({
    quarter_id: '',
    title: '',
    category: 'office_supplies',
    fund_source: 'STF',
    // Request Context (the new end-user-centric fields)
    department: '',
    department_id: '',
    purpose_type: 'personal',
    date_needed: '',
    event_name: '',
    event_date: '',
    project_name: '',
  })
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Context fields are managed as a sub-object by RequestContextForm. This
  // helper merges its onChange payload back into the flat form state.
  const setContext = (next) => setForm(p => ({ ...p, ...next }))

  const [items, setItems] = useState([])
  const [reviewing, setReviewing] = useState(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const setD = (k, v) => setDraft(p => ({ ...p, [k]: v }))

  const categoryForm = CATEGORY_FORM[form.category] || CATEGORY_FORM.office_supplies

  // Switch category, and clear any structured spec values (those are category-scoped).
  const setCategory = (next) => {
    setF('category', next)
    setDraft(p => ({ ...p, specs: {} }))
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

  // Items come from the office's verified Final PPMP: a Fund Administrator's own, or the office staff file for.
  const { plans, isLoading: plansLoading, lineById } = usePpmpPlans({ departmentId: isRequestor ? null : form.department_id })
  const taken = takenByKey(items, lineById)
  const planYear = items.map(i => lineById.get(Number(i.ppmp_item_id))?.fiscal_year).find(Boolean)
  const checkItem = (item, exceptIndex) => {
    const line = item.line || lineById.get(Number(item.ppmp_item_id))
    return line ? { line, ...lineChecks(line, { quantity: item.quantity, price: item.estimated_cost, dateNeeded: form.date_needed, taken: takenByKey(items, lineById, exceptIndex).get(line.key) || 0 }) } : null
  }
  const draftCheck = draft.line ? checkItem(draft, -1) : null
  const pickLine = (line) => setDraft(p => ({ ...p, ppmp_item_id: line.id, line, estimated_cost: String(line.unit_cost) }))

  const handleAddItem = () => {
    if (!draft.line) {
      toast.error('Pick the item from the PPMP')
      return
    }
    if (draftCheck?.block) {
      toast.error(draftCheck.block)
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
      group_label:       draft.group_label,
      stock_property_no: draft.stock_property_no.trim(),
      category:          draft.category || form.category,
      ppmp_item_id:      draft.line.id,
      item_name:         draft.line.description,
      quantity:          draft.quantity,
      unit:              draft.line.unit,
      estimated_cost:    draft.estimated_cost,
      notes,
    }
    setItems(p => [...p, newItem])
    setDraft(p => ({ ...EMPTY_DRAFT, group_label: p.group_label }))   // the section stays for the next item
  }

  // "Add item" on a section heading: point the add form at that section.
  const addToSection = (label) => setD('group_label', label)

  const handleRemoveItem = (idx) => setItems(p => p.filter((_, i) => i !== idx))

  const processed = items.map((item, i) => ({
    ...item,
    globalIdx: i,
    check: checkItem(item, i),
    totalCost: (parseFloat(item.estimated_cost) || 0) * (parseFloat(item.quantity) || 1),
  }))
  const grouped     = groupItemsBySection(processed)
  const grandTotal  = processed.reduce((s, it) => s + it.totalCost, 0)
  const draftTotal  = draft.estimated_cost && draft.quantity
    ? parseFloat(draft.estimated_cost) * (parseFloat(draft.quantity) || 1)
    : 0

  // The PR is either sent to the TWG or saved as a draft to finish later
  // (drafts may have no items yet). Only the buttons do this, never Enter.
  // Submitting shows the review first (ReviewSubmitDialog); its Submit confirms.
  const handleSubmit = (e, { asDraft = false, confirmed = false } = {}) => {
    e?.preventDefault()
    if (!form.title.trim()) {
      toast.error('Give your request a purpose')
      return
    }
    const submitNow = !asDraft
    if (submitNow && items.length === 0) {
      toast.error('Add at least one item before submitting, or save it as a draft')
      return
    }
    if (submitNow && processed.some(i => i.check?.block)) {
      toast.error('Lower the items marked in red to what is left in the PPMP')
      return
    }
    if (submitNow && !confirmed) { setReviewing(true); return }
    create({
      title:                      form.title.trim(),
      ...(!isRequestor && form.quarter_id ? { quarter_id: parseInt(form.quarter_id) } : {}),
      category:                   form.category,
      fund_source:                form.fund_source,
      // Request Context fields — only sent if the requestor filled them
      department:                 form.department?.trim()     || undefined,
      department_id:              form.department_id          || undefined,
      purpose_type:               form.purpose_type,
      date_needed:                form.date_needed            || undefined,
      event_name:                 form.purpose_type === 'event'   ? (form.event_name?.trim() || undefined) : undefined,
      event_date:                 form.purpose_type === 'event'   ? (form.event_date || undefined)        : undefined,
      project_name:               form.purpose_type === 'project' ? (form.project_name?.trim() || undefined) : undefined,
      ...(submitNow ? { status: 'submitted' } : {}),
      // Items go with the PR in the same request, so they're saved together.
      items: items.map(item => ({
        group_label:    item.group_label    || undefined,
        ppmp_item_id:   item.ppmp_item_id   || undefined,
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
              You don't need to know procurement terms. Pick each item from your office's verified PPMP and say why
              you need it. The Technical Working Group (TWG) checks your request, and the Procurement Office handles
              suppliers, orders, and delivery. You can save it as a draft and finish later.
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
                Purpose <span className="text-red-500 text-xs">*</span>
                <span className="ml-1.5 text-[10px] text-[--color-text-muted] font-normal">a short phrase, printed on the request</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g. Office Use of the Department of Computer Studies"
                value={form.title}
                onChange={e => setF('title', e.target.value)}
              />
              <p className="text-[11px] text-[--color-text-muted]">
                Goes in the Purpose line of the printed request, and names it in your list.
              </p>
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

                {/* Source of fund decides the code printed on the PR form. */}
                <div className="space-y-1.5">
                  <Label>Source of Fund</Label>
                  <Select value={form.fund_source} onValueChange={v => setF('fund_source', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FUND_SOURCES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <AutoField label="Fund Cluster" value={fundCodeFor(orgSettings, form.fund_source)} />
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
                    <TH className="text-center w-24">Stock/Property</TH>
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
                                {item.check && <PpmpLineNote {...item.check} left={null} planned={item.check.line.planned} className="mt-2 font-normal" />}
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
                {/* What kind of thing this item is. Most requests are all one
                    kind, so it follows the choice above unless changed here. */}
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
                  <p className="text-[11px] text-[--color-text-muted]">Decides which TWG area reviews the request.</p>
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
                  <PpmpItemField id="pr-ppmp-item" plans={plans} isLoading={plansLoading} value={draft.line} onPick={pickLine} taken={taken} year={planYear} />
                </div>

                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Unit</Label>
                  <div className="flex h-10 items-center rounded-lg border border-[--color-border] bg-[--color-canvas] px-3 text-sm text-[--color-text-secondary]">
                    {draft.line?.unit || '—'}
                  </div>
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

                {/* Estimated Cost. The line total sits outside the flow so the
                    inputs across the row stay bottom-aligned. */}
                <div className="col-span-2 space-y-1 relative">
                  <Label className="text-xs">Price each (₱, estimate)</Label>
                  <Input
                    type="number" min="0.01" step="any" placeholder="0.00"
                    value={draft.estimated_cost}
                    onChange={e => setD('estimated_cost', e.target.value)}
                  />
                  {draftTotal > 0 && (
                    <p className="absolute left-0 top-full mt-1 text-[11px] font-bold tabular-nums text-blue-700">
                      {fmtCurrency(draftTotal)}
                    </p>
                  )}
                </div>

                {/* Add button */}
                <div className="col-span-1 self-end">
                  <Button
                    type="button" className="w-full px-0"
                    disabled={!draft.line || !!draftCheck?.block || !draft.estimated_cost || parseFloat(draft.estimated_cost) <= 0}
                    onClick={handleAddItem}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>

              {draftCheck && <PpmpLineNote {...draftCheck} />}

              {/* Per-category structured spec fields (Brand/Model for Hardware,
                  Material/Dimensions/Color for Furniture, etc.) — replaces the
                  single freeform Specifications textarea. */}
              <CategorySpecFields
                category={form.category}
                specs={draft.specs}
                onChange={(next) => setD('specs', next)}
              />
            </div>
            )}
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

      <ReviewSubmitDialog open={reviewing} items={items} pending={isPending}
        request={{
          ...form,
          quarter_label: isRequestor
            ? (currentQuarter ? `${currentQuarter.label} ${currentQuarter.year}` : null)
            : (() => { const q = quarters.find(q => String(q.id) === String(form.quarter_id)); return q ? `${q.label} ${q.year}` : null })(),
          fund_source: isRequestor ? null : form.fund_source,
        }}
        onConfirm={() => handleSubmit(null, { confirmed: true })}
        onClose={() => setReviewing(false)} />
    </div>
  )
}

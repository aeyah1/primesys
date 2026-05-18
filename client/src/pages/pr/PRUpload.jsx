import { useState, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Package, Plus, Trash2, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtCurrency } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const UNITS = ['pax', 'pc', 'set', 'lot', 'pair', 'ream', 'box', 'unit', 'kg', 'L', 'roll', 'pack', 'bottle', 'can', 'sheet', 'bag', 'bundle']
const EMPTY_DRAFT = { group_label: '', item_name: '', quantity: '1', unit: 'pax', estimated_cost: '' }

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

  const isExtension = user?.role === 'extension'

  const [form, setForm] = useState({
    quarter_id: '',
    title: '',
  })
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const [items, setItems] = useState([])
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const setD = (k, v) => setDraft(p => ({ ...p, [k]: v }))

  const { data: quarters = [] } = useQuery({
    queryKey: ['quarters'],
    queryFn: () => api.get('/quarters').then(r => r.data),
  })

  const { data: orgSettings = {} } = useQuery({
    queryKey: ['org-settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
  })

  const { mutate: create, isPending } = useMutation({
    mutationFn: (body) => api.post('/pr', body),
    onSuccess: async ({ data }) => {
      const prId = data.id
      for (const item of items) {
        try {
          await api.post(`/pr/${prId}/items`, {
            group_label:    item.group_label    || undefined,
            item_name:      item.item_name,
            quantity:       parseFloat(item.quantity)       || 1,
            unit:           item.unit           || undefined,
            estimated_cost: item.estimated_cost ? parseFloat(item.estimated_cost) : undefined,
          })
        } catch { /* non-fatal — item can be added on the detail page */ }
      }
      toast.success(`${data.pr_number} created`)
      qc.invalidateQueries({ queryKey: ['pr-list'] })
      qc.invalidateQueries({ queryKey: ['pr-stats'] })
      navigate(`/pr/${prId}`)
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
      toast.error('Unit cost is required')
      return
    }
    setItems(p => [...p, { ...draft, item_name: draft.item_name.trim() }])
    setDraft(EMPTY_DRAFT)
    itemRef.current?.focus({ preventScroll: true })
  }

  const handleRemoveItem = (idx) => setItems(p => p.filter((_, i) => i !== idx))

  const processed = items.map((item, i) => ({
    ...item,
    globalIdx: i,
    rowNum:    i + 1,
    totalCost: (parseFloat(item.estimated_cost) || 0) * (parseFloat(item.quantity) || 1),
  }))
  const grouped     = groupBySection(processed)
  const grandTotal  = processed.reduce((s, it) => s + it.totalCost, 0)
  const draftTotal  = draft.estimated_cost && draft.quantity
    ? parseFloat(draft.estimated_cost) * (parseFloat(draft.quantity) || 1)
    : 0

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.title.trim()) {
      toast.error('Title is required')
      return
    }
    if (isExtension && !form.quarter_id) {
      toast.error('Quarter is required')
      return
    }
    if (isExtension && items.length === 0) {
      toast.error('At least one item is required before submitting')
      return
    }
    create({
      title:                      form.title.trim(),
      quarter_id:                 form.quarter_id ? parseInt(form.quarter_id) : null,
      fund_cluster:               orgSettings.fund_cluster               || undefined,
      responsibility_center_code: orgSettings.responsibility_center_code || undefined,
      ...(isExtension ? { status: 'submitted' } : {}),
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
          <p className="text-ui-xs text-[--color-text-muted] mt-0.5">Fill in the PR details and list all items needed.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── PR Details ─────────────────────────────────────── */}
        <Card>
          <CardHeader><CardTitle>PR Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">

            <div className="space-y-1.5">
              <Label htmlFor="title">
                Title <span className="text-red-500 text-xs">*</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g. Office Supplies Q2 2026"
                value={form.title}
                onChange={e => setF('title', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Quarter
                {isExtension && <span className="text-red-500 text-xs ml-1">*</span>}
                {!isExtension && <span className="text-[--color-text-muted] font-normal text-xs ml-1">(optional)</span>}
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

            {/* Fund Cluster & RCC — auto-populated from org settings, read-only */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AutoField label="Fund Cluster" value={orgSettings.fund_cluster} />
              <AutoField label="Responsibility Center Code" value={orgSettings.responsibility_center_code} />
            </div>

          </CardContent>
        </Card>

        {/* ── Item List ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-[--color-text-muted]" />
              <CardTitle>
                Item List
                {isExtension && <span className="text-red-500 text-xs ml-1">*</span>}
              </CardTitle>
              {items.length > 0 && (
                <span className="text-xs text-[--color-text-muted] font-normal">
                  ({items.length} {items.length === 1 ? 'item' : 'items'})
                </span>
              )}
            </div>
            {grandTotal > 0 && (
              <span className="text-sm font-bold text-emerald-700">Grand Total: {fmtCurrency(grandTotal)}</span>
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
                    <TH className="text-left">Item Description</TH>
                    <TH className="text-center w-16">Qty</TH>
                    <TH className="text-right w-32">Unit Cost</TH>
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
                            <tr className="bg-emerald-50 border-y border-emerald-200">
                              <td colSpan={7} className="px-6 py-3 text-center text-sm font-bold text-emerald-800 tracking-wide uppercase">
                                {group.label}
                              </td>
                            </tr>
                          )}
                          {group.items.map((item) => (
                            <tr key={item.globalIdx} className="border-b border-[--color-border] hover:bg-[--color-canvas]">
                              <TD className="text-center text-[--color-text-muted] font-medium">{item.rowNum}</TD>
                              <TD className="text-center font-semibold text-[--color-text-primary]">{item.unit || '—'}</TD>
                              <TD className="text-left font-medium text-[--color-text-primary] leading-relaxed">{item.item_name}</TD>
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
                    <tr className="bg-emerald-50 border-b border-emerald-200">
                      <td colSpan={5} className="px-6 py-3.5 text-right text-sm font-bold text-emerald-800">
                        Grand Total
                      </td>
                      <td className="px-4 py-3.5 text-right text-base font-bold tabular-nums text-emerald-700">
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
                  Section / Project Name
                  <span className="ml-1 font-normal text-[--color-text-muted]">
                    (optional — items under the same name are grouped with a subtotal)
                  </span>
                </Label>
                <Input
                  placeholder="e.g. PROJECT 1: COMMUNITY-BASED TOURISM — Brgy. Linintian"
                  value={draft.group_label}
                  onChange={e => setD('group_label', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-12 gap-2 items-end">
                {/* Item Description */}
                <div className="col-span-5 space-y-1">
                  <Label className="text-xs">Item Description</Label>
                  <Input
                    ref={itemRef}
                    placeholder="e.g. Snacks Day 1 - AM: (Ham and cheese & softdrinks)"
                    value={draft.item_name}
                    onChange={e => setD('item_name', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddItem())}
                  />
                </div>

                {/* Unit */}
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Unit</Label>
                  <Select value={draft.unit} onValueChange={v => setD('unit', v)}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
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

                {/* Unit Cost */}
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Unit Cost (₱)</Label>
                  <Input
                    type="number" min="0.01" step="any" placeholder="0.00"
                    value={draft.estimated_cost}
                    onChange={e => setD('estimated_cost', e.target.value)}
                  />
                </div>

                {/* Running total preview */}
                <div className="col-span-1 text-right text-sm font-bold tabular-nums text-emerald-700 self-end pb-2">
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
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="lg" onClick={() => navigate(-1)} className="px-8">
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={isPending} className="px-12">
            {isPending
              ? 'Creating…'
              : isExtension
                ? 'Submit Purchase Request'
                : 'Create PR'}
          </Button>
        </div>
      </form>
    </div>
  )
}

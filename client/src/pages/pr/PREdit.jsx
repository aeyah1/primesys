import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Package, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtCurrency } from '@/lib/utils'
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
  <td className={`px-4 py-3.5 text-sm ${className}`}>{children}</td>
)

export default function PREdit() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const itemRef   = useRef(null)

  const [form, setForm]     = useState({ title: '', fund_cluster: '', responsibility_center_code: '' })
  const [items, setItems]   = useState([])
  const [draft, setDraft]   = useState(EMPTY_DRAFT)
  const [initialized, setInitialized] = useState(false)
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const setD = (k, v) => setDraft(p => ({ ...p, [k]: v }))

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
      })
      setInitialized(true)
    }
  }, [pr, initialized])

  useEffect(() => {
    if (existingItems.length > 0 && initialized && items.length === 0) {
      setItems(existingItems.map(i => ({ ...i, _existing: true })))
    }
  }, [existingItems, initialized])

  const { mutate: updatePR, isPending: savingPR } = useMutation({
    mutationFn: (body) => api.patch(`/pr/${id}`, body),
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update PR'),
  })

  const { mutate: addItemReq } = useMutation({
    mutationFn: (body) => api.post(`/pr/${id}/items`, body),
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add item'),
  })

  const { mutate: deleteItemReq } = useMutation({
    mutationFn: (itemId) => api.delete(`/pr/${id}/items/${itemId}`),
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove item'),
  })

  const handleAddItem = () => {
    if (!draft.item_name.trim()) { toast.error('Item description is required'); return }
    setItems(p => [...p, { ...draft, item_name: draft.item_name.trim(), _new: true }])
    setDraft(p => ({ ...p, item_name: '', quantity: '1', estimated_cost: '' }))
    itemRef.current?.focus()
  }

  const handleRemoveItem = (idx) => {
    const item = items[idx]
    if (item._existing && item.id) {
      deleteItemReq(item.id)
    }
    setItems(p => p.filter((_, i) => i !== idx))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('Title is required'); return }

    updatePR(form)

    for (const item of items.filter(i => i._new)) {
      try {
        await api.post(`/pr/${id}/items`, {
          group_label:    item.group_label    || undefined,
          item_name:      item.item_name,
          quantity:       parseFloat(item.quantity)       || 1,
          unit:           item.unit           || undefined,
          estimated_cost: item.estimated_cost ? parseFloat(item.estimated_cost) : undefined,
        })
      } catch { /* individual item errors are non-fatal */ }
    }

    toast.success('PR updated')
    qc.invalidateQueries({ queryKey: ['pr', id] })
    qc.invalidateQueries({ queryKey: ['pr-items', id] })
    qc.invalidateQueries({ queryKey: ['pr-list'] })
    navigate(`/pr/${id}`)
  }

  const processed = items.map((item, i) => ({
    ...item,
    globalIdx: i,
    rowNum:    i + 1,
    totalCost: (parseFloat(item.estimated_cost) || 0) * (parseFloat(item.quantity) || 1),
  }))
  const grouped    = groupBySection(processed)
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

        {/* PR Details */}
        <Card>
          <CardHeader><CardTitle>PR Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">
                Title <span className="text-[--color-brand] text-xs">*</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g. Office Supplies Q2 2026"
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
              <span className="text-sm font-bold text-emerald-700">Grand Total: {fmtCurrency(grandTotal)}</span>
            )}
          </CardHeader>

          <CardContent className="p-0">
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
                <div className="col-span-5 space-y-1">
                  <Label className="text-xs">Item Description <span className="text-[--color-brand]">*</span></Label>
                  <Input
                    ref={itemRef}
                    placeholder="e.g. Snacks Day 1 - AM: (Ham and cheese & softdrinks)"
                    value={draft.item_name}
                    onChange={e => setD('item_name', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddItem())}
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
                    type="button" className="w-full px-0"
                    disabled={!draft.item_name.trim()}
                    onClick={handleAddItem}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="lg" onClick={() => navigate(-1)} className="px-8">
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={savingPR} className="px-12">
            {savingPR ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}

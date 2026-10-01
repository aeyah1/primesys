import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtCurrency, PROCUREMENT_MODES } from '@/lib/utils'

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const PARTS = { ps: 'Part I: Available at PS-DBM', other: 'Part II: Other items' }
const EMPTY = { part: 'other', category: '', code: '', description: '', unit: '', quantity: '', unit_cost: '', mode_of_procurement: 'Small Value Procurement', months: [], remarks: '' }
const TEXTAREA = 'w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y'

// Adds or edits one PPMP item line; `item` is null for a new one, `categories` are the headings already used.
export default function PpmpItemDialog({ open, item, categories = [], saving, onSave, onClose }) {
  const [f, setF] = useState(EMPTY)
  useEffect(() => {
    if (open) setF(item ? { ...EMPTY, ...item, quantity: String(item.quantity), unit_cost: String(item.unit_cost), category: item.category || '', code: item.code || '', remarks: item.remarks || '' } : EMPTY)
  }, [open, item])
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const toggleMonth = (m) => set('months', f.months.includes(m) ? f.months.filter(x => x !== m) : [...f.months, m].sort((a, b) => a - b))
  const budget = (Number(f.quantity) || 0) * (Number(f.unit_cost) || 0)

  const submit = (e) => {
    e.preventDefault()
    onSave({ ...f, description: f.description.trim(), unit: f.unit.trim(), quantity: f.quantity.trim(), unit_cost: f.unit_cost.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent title={item ? 'Edit Item' : 'Add Item'} className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Part</Label>
              <Select value={f.part} onValueChange={v => setF(p => ({ ...p, part: v, mode_of_procurement: v === 'ps' ? 'Agency-to-Agency' : p.mode_of_procurement }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PARTS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ppmp-category">Category</Label>
              <Input id="ppmp-category" list="ppmp-categories" value={f.category} onChange={e => set('category', e.target.value)} maxLength={100} placeholder="e.g. Office Supplies" />
              <datalist id="ppmp-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_3fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ppmp-code">Code</Label>
              <Input id="ppmp-code" value={f.code} onChange={e => set('code', e.target.value)} maxLength={50} placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ppmp-desc">General Description <span className="text-red-500">*</span></Label>
              <textarea id="ppmp-desc" rows={2} className={TEXTAREA} value={f.description} onChange={e => set('description', e.target.value)} maxLength={500} required
                placeholder="e.g. Paper, multicopy, 80gsm, A4 (describe by specifications, no brand names)" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ppmp-unit">Unit <span className="text-red-500">*</span></Label>
              <Input id="ppmp-unit" value={f.unit} onChange={e => set('unit', e.target.value)} maxLength={50} required placeholder="e.g. ream" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ppmp-qty">Quantity <span className="text-red-500">*</span></Label>
              <Input id="ppmp-qty" inputMode="decimal" value={f.quantity} onChange={e => set('quantity', e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ppmp-cost">Unit Cost <span className="text-red-500">*</span></Label>
              <Input id="ppmp-cost" inputMode="decimal" value={f.unit_cost} onChange={e => set('unit_cost', e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Estimated Budget</Label>
              <Input readOnly tabIndex={-1} value={fmtCurrency(budget)} className="font-semibold tabular-nums bg-[--color-overlay]" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Mode of Procurement</Label>
            <Select value={f.mode_of_procurement || 'none'} onValueChange={v => set('mode_of_procurement', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {PROCUREMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Schedule (months it will be bought)</Label>
            <div className="flex flex-wrap gap-1.5">
              {MONTHS.map((m, k) => {
                const on = f.months.includes(k + 1)
                return (
                  <button key={m} type="button" onClick={() => toggleMonth(k + 1)} aria-pressed={on}
                    className={`h-8 w-12 rounded-md border text-ui-xs font-semibold transition-colors ${on
                      ? 'border-[--color-brand] bg-[--color-brand] text-white'
                      : 'border-[--color-border] bg-[--color-surface] text-[--color-text-secondary] hover:border-[--color-brand]'}`}>
                    {m}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ppmp-remarks">Remarks</Label>
            <Input id="ppmp-remarks" value={f.remarks} onChange={e => set('remarks', e.target.value)} maxLength={500} placeholder="Optional" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : item ? 'Save Item' : 'Add Item'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useId } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtDate } from '@/lib/utils'
import api from '@/lib/axios'

// Names that differ only in upper/lower case or spacing are the same
// (server: awardWorkflow.supplierKey).
export const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()

export const DETAIL_FIELDS = ['supplier_tin', 'supplier_contact', 'supplier_phone', 'supplier_email', 'supplier_address']
// Details a quotation must have (server: canvass.routes.js quotationRules); TIN stays optional.
export const QUOTE_REQUIRED = ['supplier_contact', 'supplier_phone', 'supplier_email', 'supplier_address']
export const EMPTY_SUPPLIER = { supplier_name: '', supplier_tin: '', supplier_contact: '', supplier_phone: '', supplier_email: '', supplier_address: '' }

// Money in whole centavos, so sums and comparisons are exact (as on the server).
export const cents     = (v) => Math.round(Number(v || 0) * 100)
export const lineCents = (quantity, price) => Math.round(Number(quantity || 0) * Number(price || 0) * 100)

export const Optional = () => <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>
const Required = () => <span className="text-[--color-brand] text-xs">*</span>

export function SectionTitle({ children, action }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[--color-border] pb-1.5">
      <p className="text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider">{children}</p>
      {action}
    </div>
  )
}

// Suppliers awarded or quoting before, for suggestions.
export function useSupplierSuggestions(enabled = true) {
  const { data = [] } = useQuery({
    queryKey: ['lot-suppliers'],
    queryFn:  () => api.get('/lots/suppliers').then(r => r.data),
    enabled,
    staleTime: 60_000,
  })
  return data
}

// Picking a suggested supplier fills in the details still empty. Returns the
// next form and the supplier it came from (or null).
export function withSuggestion(form, nameField, value, suggestions) {
  const match = suggestions.find(s => nameKey(s.name) === nameKey(value))
  const next = { ...form, [nameField]: value }
  if (match) for (const k of DETAIL_FIELDS) if (!String(form[k] || '').trim() && match[k]) next[k] = match[k]
  return [next, match || null]
}

// Everything that shows awards, refreshed after any award, quotation, or PO change.
export function useRefreshAwards(prId) {
  const qc = useQueryClient()
  return () => {
    for (const key of [['canvass', prId], ['lots'], ['lot-queue'], ['lot-suppliers'], ['pr', prId], ['pr-list'], ['pr-stats'], ['pr-logs', prId], ['po-list']]) {
      qc.invalidateQueries({ queryKey: key })
    }
  }
}

/* Supplier name and details. `nameField` is the form's name key (awarded_to
   on an award, supplier_name on a quotation). With `suggestions`, the name
   offers the suppliers used before; `onName` handles picking one. Detail
   fields listed in `required` are marked required instead of optional. */
export function SupplierFields({ form, setF, nameField = 'awarded_to', suggestions = [], onName, required = [] }) {
  const listId = useId()
  const mark = (field) => (required.includes(field) ? <Required /> : <Optional />)
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Supplier / Contractor Name <Required /></Label>
        <Input
          placeholder={suggestions.length ? 'Type to pick a supplier used before, or enter a new one' : 'e.g. ABC Trading & Supply Co.'}
          value={form[nameField]}
          onChange={e => (onName ? onName(e.target.value) : setF(nameField, e.target.value))}
          list={suggestions.length ? listId : undefined}
          autoComplete="off"
        />
        {suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions.map(s => <option key={s.name} value={s.name}>{`Last used ${fmtDate(s.last_used_at)}`}</option>)}
          </datalist>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>TIN {mark('supplier_tin')}</Label>
          <Input placeholder="e.g. 123-456-789-000" value={form.supplier_tin} onChange={e => setF('supplier_tin', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Contact Person {mark('supplier_contact')}</Label>
          <Input placeholder="Name of contact person" value={form.supplier_contact} onChange={e => setF('supplier_contact', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Phone Number {mark('supplier_phone')}</Label>
          <Input placeholder="e.g. 09xx-xxx-xxxx" value={form.supplier_phone} onChange={e => setF('supplier_phone', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Email Address {mark('supplier_email')}</Label>
          <Input type="email" placeholder="supplier@email.com" value={form.supplier_email} onChange={e => setF('supplier_email', e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Business Address {mark('supplier_address')}</Label>
        <Input placeholder="Street, Barangay, City, Province" value={form.supplier_address} onChange={e => setF('supplier_address', e.target.value)} />
      </div>
    </div>
  )
}

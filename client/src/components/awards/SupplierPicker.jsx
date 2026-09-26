import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, User, Mail, Phone, MapPin, CreditCard } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { SupplierDialog } from '@/pages/suppliers/SupplierList'
import api from '@/lib/axios'

const SELECT = 'w-full h-10 rounded-md border border-[--color-border] bg-[--color-surface] px-3 text-sm text-[--color-text-primary] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent'

/* Picks a supplier from the Suppliers list; their details come from the list
   and are shown, not typed again. "New supplier" adds one to the list and
   picks it. value: a supplier id or ''; onChange(id). */
export default function SupplierPicker({ value, onChange, label = 'Supplier', hint }) {
  const [adding, setAdding] = useState(false)
  const { data } = useQuery({
    queryKey: ['suppliers', 'active-all'],
    queryFn: () => api.get('/suppliers?status=active&limit=200').then(r => r.data.data),
  })
  const suppliers = data ?? []
  const chosen = suppliers.find(s => String(s.id) === String(value))

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-2">
        <Label>{label} <span className="text-red-600 text-xs">*</span></Label>
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-ui-xs font-medium text-[--color-brand] hover:underline">
          <Plus className="size-3" /> New supplier
        </button>
      </div>
      <select className={SELECT} value={value || ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : '')}>
        <option value="">Choose from the Suppliers list…</option>
        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {hint && !chosen && <p className="text-xs text-[--color-text-muted]">{hint}</p>}
      {chosen && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-[--color-border] bg-[--color-canvas] px-3 py-2 text-xs text-[--color-text-secondary]">
          {chosen.contact_person && <span className="flex items-center gap-1"><User className="size-3" /> {chosen.contact_person}</span>}
          {chosen.email && <span className="flex items-center gap-1"><Mail className="size-3" /> {chosen.email}</span>}
          {chosen.phone && <span className="flex items-center gap-1"><Phone className="size-3" /> {chosen.phone}</span>}
          {chosen.tin && <span className="flex items-center gap-1"><CreditCard className="size-3" /> TIN {chosen.tin}</span>}
          {chosen.address && <span className="flex items-center gap-1"><MapPin className="size-3" /> {chosen.address}</span>}
          <span className="basis-full text-[10px] text-[--color-text-muted]">From the Suppliers list; change the details there.</span>
        </div>
      )}
      {adding && <SupplierDialog supplier={null} onClose={() => setAdding(false)} onSaved={(id) => onChange(id)} />}
    </div>
  )
}

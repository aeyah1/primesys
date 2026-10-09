import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, User, Phone, Mail, CreditCard, BadgeCheck } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import api from '@/lib/axios'

// The supplier profile's pieces: the add/edit window, the details, and the blacklisted mark.

const EMPTY = { name: '', address: '', tin: '', philgeps_no: '', contact_person: '', designation: '', phone: '', email: '', status: 'active', status_note: '' }
const FIELDS = [
  { key: 'contact_person', label: 'Contact person', placeholder: 'e.g. Juanito B. Araneta', max: 100 },
  { key: 'designation',    label: 'Designation',    placeholder: 'e.g. Store Manager', max: 150 },
  { key: 'phone',          label: 'Phone number',   placeholder: '0998 123 4567', max: 50 },
  { key: 'email',          label: 'Email address',  placeholder: 'sales@supplier.com', max: 150 },
  { key: 'tin',            label: 'TIN',            placeholder: '123-456-789-000', max: 50 },
  { key: 'philgeps_no',    label: 'PhilGEPS No.',   placeholder: 'e.g. 2026-012345', max: 50 },
]

export const BlacklistedBadge = ({ note }) => (
  <span title={note || 'Blacklisted'} className="ml-1.5 inline-flex items-center rounded-full border border-red-300 bg-red-50 px-1.5 py-px text-[10px] font-bold text-red-700">Blacklisted</span>
)

// Adds a supplier (supplier null) or edits one; onSaved(id) after saving.
export function SupplierDialog({ supplier, onClose, onSaved }) {
  const qc = useQueryClient()
  const [form, setForm] = useState(() => Object.fromEntries(Object.keys(EMPTY).map(k => [k, supplier?.[k] || EMPTY[k]])))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const { mutate, isPending } = useMutation({
    mutationFn: (body) => (supplier ? api.patch(`/suppliers/${supplier.id}`, body) : api.post('/suppliers', body)),
    onSuccess: ({ data }) => {
      toast.success(supplier ? 'Supplier updated' : 'Supplier added')
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      onSaved?.(supplier ? supplier.id : data.id)
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'The supplier could not be saved'),
  })
  const save = () => mutate(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])))

  return (
    <Dialog open onOpenChange={v => { if (!v && !isPending) onClose() }}>
      <DialogContent title={supplier ? `Edit ${supplier.name}` : 'Add supplier'} className="max-w-2xl"
        description="As written on the supplier's RFQ, business permit or letterhead.">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sup-name">Business name <span className="text-xs text-red-600">*</span></Label>
            <Input id="sup-name" value={form.name} maxLength={200} onChange={e => set('name', e.target.value)} placeholder="e.g. Caraga Print & Office Depot" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-address">Business address</Label>
            <Input id="sup-address" value={form.address} maxLength={500} onChange={e => set('address', e.target.value)} placeholder="e.g. Purok 3, Linintian, Cantilan, Surigao del Sur" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map(f => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`sup-${f.key}`}>{f.label}</Label>
                <Input id={`sup-${f.key}`} value={form[f.key]} maxLength={f.max} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} />
              </div>
            ))}
          </div>
          <div className="space-y-2 rounded-lg border border-[--color-border] px-3 py-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-red-600" checked={form.status === 'blacklisted'}
                onChange={e => set('status', e.target.checked ? 'blacklisted' : 'active')} />
              <span className="font-medium text-[--color-text-primary]">Blacklisted</span>
              <span className="text-xs text-[--color-text-muted]">(the BAC is warned when it enters this supplier's quotation)</span>
            </label>
            {form.status === 'blacklisted' && (
              <Input value={form.status_note} maxLength={500} onChange={e => set('status_note', e.target.value)} placeholder="Why, e.g. failed to deliver PO-2026-014" aria-label="Why it is blacklisted" />
            )}
          </div>
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={save} disabled={isPending || !form.name.trim()}>{isPending ? 'Saving…' : supplier ? 'Save changes' : 'Add supplier'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Detail({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-[--color-text-muted]" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted]">{label}</p>
        <p className={`mt-0.5 text-ui-sm ${value ? 'text-[--color-text-primary]' : 'text-[--color-text-muted]'}`}>{value || 'Not given'}</p>
      </div>
    </div>
  )
}

// A supplier's details, as on its profile.
export function SupplierDetails({ supplier: s }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Detail icon={MapPin} label="Business address" value={s.address} />
      <Detail icon={User} label="Contact person" value={s.contact_person ? `${s.contact_person}${s.designation ? `, ${s.designation}` : ''}` : null} />
      <Detail icon={Phone} label="Phone" value={s.phone} />
      <Detail icon={Mail} label="Email" value={s.email} />
      <Detail icon={CreditCard} label="TIN" value={s.tin} />
      <Detail icon={BadgeCheck} label="PhilGEPS No." value={s.philgeps_no} />
    </div>
  )
}

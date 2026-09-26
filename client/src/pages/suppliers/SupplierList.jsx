import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Search, Plus, Pencil, Store, Mail, Phone, MapPin, CreditCard, User, Ban, BadgeCheck, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CategoryBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency, CATEGORY_LABELS } from '@/lib/utils'
import api from '@/lib/axios'

const TABS = [
  { key: '',            label: 'All' },
  { key: 'active',      label: 'Active' },
  { key: 'blacklisted', label: 'Blacklisted' },
]
const SORTS = [
  { key: 'name',   label: 'Name' },
  { key: 'awards', label: 'Most awards' },
  { key: 'value',  label: 'Largest contracts' },
  { key: 'recent', label: 'Recently active' },
]
const EMPTY = { name: '', tin: '', address: '', contact_person: '', email: '', phone: '', status: 'active', status_note: '' }
const FIELDS = [
  { key: 'contact_person', label: 'Contact person',   placeholder: 'e.g. Ana Reyes' },
  { key: 'email',          label: 'Email address',    placeholder: 'sales@supplier.com', hint: 'RFQs and awards are emailed here. Copy it from the business permit or letterhead, not a text message.' },
  { key: 'phone',          label: 'Phone number',     placeholder: '0917 123 4567' },
  { key: 'tin',            label: 'TIN',              placeholder: '123-456-789-000' },
]

// Whether the supplier's email on file is the one it proved by quoting through an emailed RFQ.
export const isConfirmed = (s) => !!s.email && !!s.email_confirmed && s.email.toLowerCase() === s.email_confirmed.toLowerCase()

/* ── Add or edit one supplier. onSaved(id): the saved supplier's id, e.g.
   to pick a supplier just added from the canvass. ──────────────────── */
export function SupplierDialog({ supplier, onClose, onSaved }) {
  const qc = useQueryClient()
  const [form, setForm] = useState(supplier ? Object.fromEntries(Object.keys(EMPTY).map(k => [k, supplier[k] || EMPTY[k]])) : EMPTY)
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const { mutate, isPending } = useMutation({
    mutationFn: (body) => (supplier ? api.patch(`/suppliers/${supplier.id}`, body) : api.post('/suppliers', body)),
    onSuccess: ({ data }) => {
      toast.success(supplier ? 'Supplier updated' : 'Supplier added')
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      onSaved?.(supplier ? supplier.id : data.id)
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save the supplier'),
  })
  const save = () => mutate(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])))
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title={supplier ? `Edit ${supplier.name}` : 'Add Supplier'} className="max-w-2xl">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Business name <span className="text-red-600 text-xs">*</span></Label>
            <Input value={form.name} onChange={e => setF('name', e.target.value)} placeholder="e.g. Alpha Computers" autoFocus />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FIELDS.map(f => (
              <div key={f.key} className="space-y-1.5">
                <Label>{f.label}</Label>
                <Input value={form[f.key]} onChange={e => setF(f.key, e.target.value)} placeholder={f.placeholder} />
                {f.hint && <p className="text-[11px] text-[--color-text-muted]">{f.hint}</p>}
                {f.key === 'email' && supplier && isConfirmed(supplier) && form.email.trim().toLowerCase() !== supplier.email.toLowerCase() && (
                  <p className="text-[11px] text-amber-700">The current address is confirmed. A new one is confirmed only once the supplier quotes through an RFQ sent there.</p>
                )}
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label>Business address</Label>
            <Input value={form.address} onChange={e => setF('address', e.target.value)} placeholder="e.g. Poblacion, Cantilan, Surigao del Sur" />
          </div>
          <div className="rounded-lg border border-[--color-border] px-3 py-3 space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="size-4 accent-red-600" checked={form.status === 'blacklisted'}
                onChange={e => setF('status', e.target.checked ? 'blacklisted' : 'active')} />
              <span className="font-medium text-[--color-text-primary]">Blacklisted</span>
              <span className="text-xs text-[--color-text-muted]">(can't be sent RFQs)</span>
            </label>
            {form.status === 'blacklisted' && (
              <Input value={form.status_note} onChange={e => setF('status_note', e.target.value)} placeholder="Why, e.g. failed to deliver PO-2025-014" />
            )}
          </div>
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={save} disabled={isPending || !form.name.trim()}>{isPending ? 'Saving…' : supplier ? 'Save Changes' : 'Add Supplier'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// The supplier master list Procurement keeps; RFQs are emailed from it.
export default function SupplierList() {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage]     = useState(1)
  const [editing, setEditing] = useState(null)   // { supplier } or { supplier: null } for a new one
  const [issues, setIssues]           = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [category, setCategory]       = useState('all')
  const [sort, setSort]               = useState('name')
  const filters = { status, search, page, limit: 25, stats: 1, sort,
    ...(issues ? { issues: 1 } : {}), ...(unconfirmed ? { email: 'unconfirmed' } : {}), ...(category !== 'all' ? { category } : {}) }
  const filtered = !!(search || status || issues || unconfirmed || category !== 'all')
  const reset = (fn) => (v) => { fn(v); setPage(1) }

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', filters],
    queryFn: () => api.get(`/suppliers?${new URLSearchParams(filters)}`).then(r => r.data),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const chip = (on) => `rounded-full border px-3 py-1 text-ui-xs font-medium transition-colors ${
    on ? 'border-[--color-brand] bg-[--color-brand] text-white'
      : 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'}`

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">Suppliers</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">The suppliers you send RFQs to. Keep each one's email current.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
            <Input placeholder="Search name, email, TIN…" value={search} className="pl-9" onChange={e => { setSearch(e.target.value); setPage(1) }} />
          </div>
          <Button className="gap-1.5" onClick={() => setEditing({ supplier: null })}><Plus className="size-4" /> Add Supplier</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => reset(setStatus)(t.key)} className={chip(status === t.key)}>{t.label}</button>
        ))}
        <span className="mx-1 h-5 w-px bg-[--color-border-strong]" />
        <button onClick={() => reset(setIssues)(!issues)} className={chip(issues)}>Has issues</button>
        <button onClick={() => reset(setUnconfirmed)(!unconfirmed)} className={chip(unconfirmed)}>Email not confirmed</button>
        <div className="ml-auto flex items-center gap-2">
          <Select value={category} onValueChange={reset(setCategory)}>
            <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Supplies anything</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => <SelectItem key={k} value={k}>Supplies {label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={reset(setSort)}>
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{SORTS.map(o => <SelectItem key={o.key} value={o.key}>Sort: {o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading
            ? <div className="p-6 space-y-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            : !rows.length
              ? (
                <div className="px-6 py-16 text-center">
                  <Store className="size-10 text-[--color-text-muted] mx-auto mb-3" />
                  <p className="text-ui-sm font-semibold text-[--color-text-primary]">{filtered ? 'No suppliers match.' : 'No suppliers yet'}</p>
                  {!filtered && <p className="text-ui-xs text-[--color-text-muted] mt-1">Add the suppliers you canvass, with their email, to send them RFQs.</p>}
                </div>
              )
              : rows.map(s => (
                <div key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-6 py-4 border-b border-[--color-border] last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold text-[--color-text-primary]">
                      <Link to={`/suppliers/${s.id}`} className="hover:text-[--color-brand] hover:underline">{s.name}</Link>
                      {s.status === 'blacklisted' && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700"><Ban className="size-3" /> Blacklisted</span>
                      )}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[--color-text-secondary]">
                      {s.contact_person && <span className="flex items-center gap-1"><User className="size-3" /> {s.contact_person}</span>}
                      {s.email ? (
                        <span className="flex items-center gap-1">
                          <Mail className="size-3" /> {s.email}
                          {isConfirmed(s)
                            ? <span className="inline-flex items-center gap-0.5 text-emerald-700" title="The supplier quoted through an RFQ sent to this address"><BadgeCheck className="size-3" /> Confirmed {fmtDate(s.email_confirmed_at)}</span>
                            : <span className="text-[--color-text-muted]" title="Confirmed once the supplier quotes through an RFQ sent to this address">(not confirmed yet)</span>}
                        </span>
                      )
                        : <span className="flex items-center gap-1 text-amber-700"><Mail className="size-3" /> No email: can't be sent RFQs</span>}
                      {s.phone && <span className="flex items-center gap-1"><Phone className="size-3" /> {s.phone}</span>}
                      {s.tin && <span className="flex items-center gap-1"><CreditCard className="size-3" /> TIN {s.tin}</span>}
                      {s.address && <span className="flex items-center gap-1"><MapPin className="size-3" /> {s.address}</span>}
                    </div>
                    {s.status === 'blacklisted' && s.status_note && <p className="mt-1 text-xs text-red-700">{s.status_note}</p>}
                    {s.categories?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{s.categories.map(c => <CategoryBadge key={c} category={c} />)}</div>}
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right text-xs leading-relaxed">
                      <p className="font-semibold text-[--color-text-primary]">
                        {s.awards} award{s.awards === 1 ? '' : 's'}{s.contract_value > 0 ? ` · ${fmtCurrency(s.contract_value)}` : ''}
                      </p>
                      <p className="text-[--color-text-secondary]">
                        {s.invitations ? `Answered ${s.answered} of ${s.invitations} RFQs` : 'No RFQs sent'}
                        {s.delivered ? ` · On time ${s.on_time} of ${s.delivered}` : ''}
                      </p>
                      {(s.closed_short > 0 || s.overdue > 0 || s.delivered > s.on_time) && (
                        <p className="inline-flex items-center gap-1 font-semibold text-red-700">
                          <AlertTriangle className="size-3" />
                          {[s.overdue && `${s.overdue} overdue`, s.closed_short && `${s.closed_short} failed to finish`, s.delivered > s.on_time && `${s.delivered - s.on_time} late`].filter(Boolean).join(', ')}
                        </p>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" className="gap-1" onClick={() => setEditing({ supplier: s })}><Pencil className="size-3.5" /> Edit</Button>
                  </div>
                </div>
              ))}
        </CardContent>
      </Card>

      {data?.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-ui-xs text-[--color-text-muted]">Page {page} of {data.totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {editing && <SupplierDialog supplier={editing.supplier} onClose={() => setEditing(null)} />}
    </div>
  )
}

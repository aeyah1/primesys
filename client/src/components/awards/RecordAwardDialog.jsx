import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Trophy, AlertTriangle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'
import { SectionTitle, Optional, cents, lineCents, useRefreshAwards } from './supplier'

const EMPTY_FORM = {
  awarded_to: '', supplier_contact: '', supplier_phone: '', supplier_email: '', supplier_address: '', supplier_tin: '', title: '', notes: '',
}
const DETAILS = [
  ['supplier_contact', 'Contact person', 100], ['supplier_phone', 'Phone', 50], ['supplier_email', 'Email', 200],
  ['supplier_tin', 'TIN', 50], ['supplier_address', 'Business address', 500],
]
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/* Records a winner of the canvass, done outside the system: the supplier as
   written on the canvasser's abstract, the items it won and each one's winning
   unit price. The award's total can't exceed those items' approved budget.
   pr: { id, pr_number, title }. */
export default function RecordAwardDialog({ pr, open, onClose }) {
  const prId = pr ? String(pr.id) : ''
  const refresh = useRefreshAwards(prId)
  const [form, setForm]     = useState(EMPTY_FORM)
  const [prices, setPrices] = useState({})   // chosen item id -> winning unit price, as typed
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const { data: canvass } = useQuery({
    queryKey: ['canvass', prId],
    queryFn:  () => api.get(`/canvass/${prId}`).then(r => r.data),
    enabled:  open && !!prId,
  })
  const { data: lots = [] } = useQuery({
    queryKey: ['lots', prId],
    queryFn:  () => api.get(`/lots/pr/${prId}`).then(r => r.data),
    enabled:  open && !!prId,
  })
  const pending = (canvass?.items || []).filter(i => i.state === 'pending')
  const winners = [...new Set(lots.filter(l => l.status === 'awarded').map(l => l.awarded_to))]

  // Every opening starts fresh.
  useEffect(() => {
    if (!open) { setForm(EMPTY_FORM); setPrices({}) }
  }, [open])

  const picked = pending.filter(i => i.id in prices)
  const toggle = (id) => setPrices(p => {
    const next = { ...p }
    if (id in next) delete next[id]; else next[id] = ''
    return next
  })
  const allPicked = pending.length > 0 && picked.length === pending.length

  // The total at the winning prices against the approved budget of the chosen items.
  const budget = picked.reduce((s, i) => s + lineCents(i.quantity, i.estimated_cost), 0)
  const total  = picked.reduce((s, i) => s + lineCents(i.quantity, prices[i.id]), 0)
  const priced = picked.length > 0 && picked.every(i => cents(prices[i.id]) > 0)
  const over   = budget > 0 && total > budget

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post('/lots', body),
    onSuccess: ({ data }) => {
      toast.success(`${data.lot_number}: ${data.awarded_to} won ${plural(data.items, 'item')} for ${fmtCurrency(data.awarded_amount)}`)
      refresh()
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to record the winner'),
  })
  const canSave = !!form.awarded_to.trim() && priced && !over && !isPending
  const submit = () => {
    if (!canSave) return
    const trimmed = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || undefined]))
    mutate({
      purchase_request_id: pr.id,
      ...trimmed,
      items: picked.map(i => ({ pr_item_id: i.id, unit_price: String(prices[i.id]).trim() })),
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Record a Winner" description={pr ? `${pr.pr_number}${pr.title ? `: ${pr.title}` : ''}` : undefined} className="max-w-2xl">
        {!canvass ? (
          <div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !pending.length ? (
          <p className="text-sm text-[--color-text-secondary]">Every item on this PR already has its winner or is dropped.</p>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <SectionTitle>Supplier, as on the canvasser's abstract</SectionTitle>
              <div className="space-y-1.5">
                <Label>Supplier name <span className="text-[--color-brand] text-xs">*</span></Label>
                <Input list="canvass-winners" maxLength={200} value={form.awarded_to} onChange={e => setF('awarded_to', e.target.value)}
                  placeholder="e.g. ABC Trading Corporation" autoFocus />
                <datalist id="canvass-winners">{winners.map(w => <option key={w} value={w} />)}</datalist>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {DETAILS.map(([key, label, max]) => (
                  <div key={key} className={`space-y-1.5 ${key === 'supplier_address' ? 'sm:col-span-2' : ''}`}>
                    <Label>{label} <Optional /></Label>
                    <Input maxLength={max} type={key === 'supplier_email' ? 'email' : 'text'} value={form[key]} onChange={e => setF(key, e.target.value)} />
                  </div>
                ))}
              </div>
              <p className="text-xs text-[--color-text-muted]">The details print on its purchase order. A supplier already winning on this PR keeps the details given first.</p>
            </section>

            <section className="space-y-3">
              <SectionTitle action={pending.length > 1 && (
                <button type="button" onClick={() => setPrices(allPicked ? {} : Object.fromEntries(pending.map(i => [i.id, prices[i.id] ?? ''])))}
                  className="text-ui-xs font-medium text-[--color-brand] hover:underline">
                  {allPicked ? 'Clear all' : 'Select all'}
                </button>
              )}>
                Items it won ({picked.length} of {pending.length} still without a winner)
              </SectionTitle>
              <div className="rounded-lg border border-[--color-border] divide-y divide-[--color-border]">
                {pending.map(i => {
                  const chosen = i.id in prices
                  return (
                    <div key={i.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
                      <label className="flex min-w-0 flex-1 basis-60 cursor-pointer items-start gap-3">
                        <input type="checkbox" checked={chosen} onChange={() => toggle(i.id)} className="size-4 mt-0.5 shrink-0 accent-[--color-brand]" />
                        <span className="min-w-0">
                          <span className="block text-sm text-[--color-text-primary] break-words">
                            {i.group_label && <span className="text-[--color-text-muted]">{i.group_label}: </span>}
                            {i.item_name}
                          </span>
                          <span className="block text-xs text-[--color-text-muted] mt-0.5">
                            {Number(i.quantity)} {i.unit || ''}{Number(i.estimated_cost) > 0 && `, budget ${fmtCurrency(i.estimated_cost)} each`}
                          </span>
                        </span>
                      </label>
                      {chosen && (
                        <div className="flex items-center gap-2 shrink-0">
                          <Input type="number" min="0.01" step="0.01" placeholder="Unit price" aria-label={`Winning unit price of ${i.item_name}`}
                            className="w-32" value={prices[i.id]} onChange={e => setPrices(p => ({ ...p, [i.id]: e.target.value }))} />
                          <span className="w-28 text-right text-sm tabular-nums text-[--color-text-secondary]">
                            {cents(prices[i.id]) > 0 ? fmtCurrency(lineCents(i.quantity, prices[i.id]) / 100) : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {picked.length > 0 && (
                <p className={`flex items-start gap-1.5 text-xs ${over ? 'font-medium text-red-700' : 'text-[--color-text-muted]'}`}>
                  {over && <AlertTriangle className="size-3.5 shrink-0 mt-px" />}
                  {!priced ? 'Enter the winning unit price of each chosen item.'
                    : over ? `${fmtCurrency(total / 100)} is above the approved budget of these items (${fmtCurrency(budget / 100)}). An award can't exceed it.`
                    : `Total ${fmtCurrency(total / 100)}${budget > 0 ? `, within the approved budget of ${fmtCurrency(budget / 100)}` : ''}.`}
                </p>
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle>Award</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Lot title <Optional /></Label>
                  <Input maxLength={200} placeholder="e.g. Meals & Snacks" value={form.title} onChange={e => setF('title', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes <Optional /></Label>
                  <Input maxLength={2000} placeholder="e.g. Why it isn't the lowest offer" value={form.notes} onChange={e => setF('notes', e.target.value)} />
                </div>
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!canSave} onClick={submit} className="gap-2">
            <Trophy className="size-3.5" />
            {isPending ? 'Saving…' : 'Record Winner'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

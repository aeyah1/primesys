import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Trophy, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtCurrency, fmtDate } from '@/lib/utils'
import api from '@/lib/axios'
import {
  DETAIL_FIELDS, SupplierFields, SectionTitle, Optional, cents, lineCents,
  useSupplierSuggestions, withSuggestion, useRefreshAwards,
} from './supplier'

const EMPTY_FORM = {
  awarded_to: '', supplier_tin: '', supplier_contact: '', supplier_phone: '', supplier_email: '', supplier_address: '',
  awarded_amount: '', title: '',
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/* Records an award by hand (no quotation): a supplier, which of the items
   still needing an award it covers (all ticked at first), and a lump-sum
   contract amount, which can't exceed those items' approved budget.
   pr: { id, pr_number, title }. */
export default function RecordAwardDialog({ pr, open, onClose }) {
  const prId = pr ? String(pr.id) : ''
  const refresh = useRefreshAwards(prId)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [picked, setPicked]         = useState(null)   // chosen PR item ids; null until the items load
  const [filledFrom, setFilledFrom] = useState(null)
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const { data: canvass } = useQuery({
    queryKey: ['canvass', prId],
    queryFn:  () => api.get(`/canvass/${prId}`).then(r => r.data),
    enabled:  open && !!prId,
  })
  const suppliers = useSupplierSuggestions(open)
  const pending = (canvass?.items || []).filter(i => i.state === 'pending')

  // Every opening starts fresh, with each item still needing an award ticked.
  useEffect(() => {
    if (!open) { setForm(EMPTY_FORM); setPicked(null); setFilledFrom(null) }
  }, [open])
  useEffect(() => {
    if (open && canvass && picked === null) setPicked(new Set(canvass.items.filter(i => i.state === 'pending').map(i => i.id)))
  }, [open, canvass, picked])

  const onName = (value) => {
    const [next, match] = withSuggestion(form, 'awarded_to', value, suppliers)
    setForm(next)
    setFilledFrom(match)
  }
  const toggle = (id) => setPicked(p => {
    const next = new Set(p)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const allPicked = pending.length > 0 && pending.every(i => picked?.has(i.id))

  // The contract amount against the approved budget (estimate) of the chosen items.
  const budget = pending.filter(i => picked?.has(i.id)).reduce((s, i) => s + lineCents(i.quantity, i.estimated_cost), 0)
  const amount = cents(form.awarded_amount)
  const over   = budget > 0 && amount > budget
  const note = !(budget > 0) ? null
    : !(amount > 0)       ? { tone: 'muted', text: `Approved budget for the chosen items: ${fmtCurrency(budget / 100)}.` }
    : over                ? { tone: 'error', text: `${fmtCurrency((amount - budget) / 100)} above the approved budget for the chosen items (${fmtCurrency(budget / 100)}). An award can't exceed it.` }
    : amount < budget / 2 ? { tone: 'warn',  text: `Less than half the approved budget (${fmtCurrency(budget / 100)}). Check for a missing digit.` }
    :                       { tone: 'muted', text: `Within the approved budget for the chosen items (${fmtCurrency(budget / 100)}).` }

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post('/lots', body),
    onSuccess: ({ data }) => {
      toast.success(`${data.lot_number} awarded to ${data.awarded_to}${data.items ? `, for ${plural(data.items, 'item')}` : ''}`)
      refresh()
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to record the award'),
  })
  const canSave = !!canvass && !!picked && picked.size > 0 && !!form.awarded_to.trim() && amount > 0 && !over && !isPending
  const submit = () => {
    if (!canSave) return
    mutate({
      purchase_request_id: pr.id,
      title:          form.title.trim() || undefined,
      awarded_to:     form.awarded_to.trim(),
      awarded_amount: form.awarded_amount.trim(),
      ...Object.fromEntries(DETAIL_FIELDS.map(k => [k, form[k].trim() || undefined])),
      pr_item_ids:    [...picked],
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Record Award" description={pr ? `${pr.pr_number}${pr.title ? `: ${pr.title}` : ''}` : undefined} className="max-w-2xl">
        {!canvass || !picked ? (
          <div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !pending.length ? (
          <p className="text-sm text-[--color-text-secondary]">Every item on this PR is already awarded or dropped.</p>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <SectionTitle>Supplier</SectionTitle>
              <SupplierFields form={form} setF={setF} suggestions={suppliers} onName={onName} />
              {filledFrom && (
                <p className="text-xs text-[--color-text-muted]">
                  Details filled in from {filledFrom.name}'s earlier records (last used {fmtDate(filledFrom.last_used_at)}). Check they are still right.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle action={pending.length > 1 && (
                <button type="button" onClick={() => setPicked(new Set(allPicked ? [] : pending.map(i => i.id)))}
                  className="text-ui-xs font-medium text-[--color-brand] hover:underline">
                  {allPicked ? 'Clear all' : 'Select all'}
                </button>
              )}>
                Items in this award ({picked.size} of {pending.length} still to award)
              </SectionTitle>
              <div className="rounded-lg border border-[--color-border] divide-y divide-[--color-border]">
                {pending.map(i => (
                  <label key={i.id} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-[--color-overlay] transition-colors">
                    <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} className="size-4 mt-0.5 shrink-0 accent-[--color-brand]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-[--color-text-primary] break-words">
                        {i.group_label && <span className="text-[--color-text-muted]">{i.group_label}: </span>}
                        {i.item_name}
                      </span>
                      <span className="block text-xs text-[--color-text-muted] mt-0.5">
                        {Number(i.quantity)} {i.unit || ''}{Number(i.estimated_cost) > 0 && ` at ${fmtCurrency(i.estimated_cost)}`}
                      </span>
                    </span>
                    {lineCents(i.quantity, i.estimated_cost) > 0 && (
                      <span className="text-sm tabular-nums text-[--color-text-secondary] shrink-0">{fmtCurrency(lineCents(i.quantity, i.estimated_cost) / 100)}</span>
                    )}
                  </label>
                ))}
              </div>
              {picked.size === 0 && <p className="text-xs font-medium text-amber-700">Choose at least one item for this award.</p>}
            </section>

            <section className="space-y-3">
              <SectionTitle>Contract</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Contract Amount (₱) <span className="text-[--color-brand] text-xs">*</span></Label>
                  <Input type="number" min="0.01" step="0.01" placeholder="0.00"
                    value={form.awarded_amount} onChange={e => setF('awarded_amount', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Lot Title <Optional /></Label>
                  <Input placeholder="e.g. Meals & Snacks" value={form.title} onChange={e => setF('title', e.target.value)} />
                </div>
              </div>
              {note && (
                <p className={`flex items-start gap-1.5 text-xs ${
                  note.tone === 'error' ? 'font-medium text-red-700' : note.tone === 'warn' ? 'font-medium text-amber-700' : 'text-[--color-text-muted]'
                }`}>
                  {note.tone !== 'muted' && <AlertTriangle className="size-3.5 shrink-0 mt-px" />}
                  {note.text}
                </p>
              )}
              <p className="text-xs text-[--color-text-muted]">
                With quotations from several suppliers, use Award from Quotations instead: it records each supplier's prices.
              </p>
            </section>
          </div>
        )}

        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!canSave} onClick={submit} className="gap-2">
            <Trophy className="size-3.5" />
            {isPending ? 'Saving…' : 'Record Award'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

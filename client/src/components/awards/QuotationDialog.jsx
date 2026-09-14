import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency, fmtDate, localToday } from '@/lib/utils'
import api from '@/lib/axios'
import {
  EMPTY_SUPPLIER, DETAIL_FIELDS, QUOTE_REQUIRED, SupplierFields, SectionTitle, Optional, cents, lineCents,
  useSupplierSuggestions, withSuggestion, useRefreshAwards,
} from './supplier'

/* Records (or corrects) one supplier's quotation: their unit price for each
   item still needing an award that they quoted (leave the rest blank).
   pr: { id, pr_number }; items: the canvass items; quotation: the one being
   edited, or none for a new one. */
export default function QuotationDialog({ pr, items, quotation, open, onClose }) {
  const prId = String(pr.id)
  const refresh = useRefreshAwards(prId)
  const suppliers = useSupplierSuggestions(open)
  const pending = items.filter(i => i.state === 'pending')
  const [form, setForm]     = useState(null)
  const [prices, setPrices] = useState({})
  const [filledFrom, setFilledFrom] = useState(null)
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Every opening starts from the quotation being edited, or blank (only on
  // opening: a background refetch must not wipe what is being typed).
  useEffect(() => {
    if (!open) { setForm(null); setPrices({}); setFilledFrom(null); return }
    setForm({
      ...EMPTY_SUPPLIER,
      ...(quotation ? Object.fromEntries(['supplier_name', ...DETAIL_FIELDS].map(k => [k, quotation[k] || ''])) : {}),
      quoted_at: quotation?.quoted_at ? String(quotation.quoted_at).slice(0, 10) : localToday(),
      notes: quotation?.notes || '',
    })
    setPrices(quotation ? Object.fromEntries(Object.entries(quotation.prices).map(([k, v]) => [k, String(Number(v))])) : {})
  }, [open])

  const onName = (value) => {
    const [next, match] = withSuggestion(form, 'supplier_name', value, suppliers)
    setForm(next)
    setFilledFrom(match)
  }

  const entered = pending.filter(i => cents(prices[i.id]) > 0)
  const total = entered.reduce((s, i) => s + lineCents(i.quantity, prices[i.id]), 0)

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => (quotation
      ? api.patch(`/canvass/${prId}/quotations/${quotation.id}`, body)
      : api.post(`/canvass/${prId}/quotations`, body)),
    onSuccess: () => {
      toast.success(quotation ? 'Quotation updated' : `${form.supplier_name.trim()}'s quotation recorded`)
      refresh()
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save the quotation'),
  })
  const canSave = !!form && !!form.supplier_name.trim() && QUOTE_REQUIRED.every(k => form[k].trim())
    && entered.length > 0 && !isPending
  const submit = () => {
    if (!canSave) return
    mutate({
      supplier_name: form.supplier_name.trim(),
      ...Object.fromEntries(DETAIL_FIELDS.map(k => [k, form[k].trim() || undefined])),
      quoted_at: form.quoted_at || undefined,
      notes:     form.notes.trim() || undefined,
      prices:    entered.map(i => ({ item: i.id, unit_price: String(prices[i.id]).trim() })),
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title={quotation ? 'Edit Quotation' : 'Record a Quotation'} description={`${pr.pr_number}: one supplier's prices`} className="max-w-3xl">
        {form && (
          <div className="space-y-6">
            <section className="space-y-3">
              <SectionTitle>Supplier</SectionTitle>
              <SupplierFields form={form} setF={setF} nameField="supplier_name" suggestions={suppliers} onName={onName} required={QUOTE_REQUIRED} />
              {filledFrom && (
                <p className="text-xs text-[--color-text-muted]">
                  Details filled in from {filledFrom.name}'s earlier records (last used {fmtDate(filledFrom.last_used_at)}). Check they are still right.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Date on the quotation <Optional /></Label>
                  <Input type="date" value={form.quoted_at} max={localToday()} onChange={e => setF('quoted_at', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes <Optional /></Label>
                  <Input placeholder="e.g. Valid for 30 days, delivery in 7 days" value={form.notes} onChange={e => setF('notes', e.target.value)} />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle>Unit prices ({entered.length} of {pending.length} items quoted)</SectionTitle>
              <p className="text-xs text-[--color-text-muted]">Leave an item blank if this supplier didn't quote it.</p>
              <div className="rounded-lg border border-[--color-border] overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                      <th className="px-3 py-2.5">Item</th>
                      <th className="px-3 py-2.5 text-right whitespace-nowrap">Qty</th>
                      <th className="px-3 py-2.5 text-right whitespace-nowrap">Budget / unit</th>
                      <th className="px-3 py-2.5 text-right whitespace-nowrap w-40">Unit price (₱)</th>
                      <th className="px-3 py-2.5 text-right whitespace-nowrap">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(i => {
                      const price = prices[i.id] ?? ''
                      const above = cents(price) > 0 && Number(i.estimated_cost) > 0 && cents(price) > cents(i.estimated_cost)
                      return (
                        <tr key={i.id} className="border-t border-[--color-border] align-top">
                          <td className="px-3 py-2.5 text-[--color-text-primary] min-w-48">{i.item_name}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{Number(i.quantity)} {i.unit || ''}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[--color-text-secondary] whitespace-nowrap">
                            {Number(i.estimated_cost) > 0 ? fmtCurrency(i.estimated_cost) : 'None'}
                          </td>
                          <td className="px-3 py-2">
                            <Input type="number" min="0.01" step="0.01" placeholder="Not quoted" value={price}
                              onChange={e => setPrices(p => ({ ...p, [i.id]: e.target.value }))} className="h-8 text-right" />
                            {above && <p className="mt-1 text-[10px] font-medium text-amber-700 text-right">Above the budget per unit</p>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[--color-text-secondary] whitespace-nowrap">
                            {cents(price) > 0 ? fmtCurrency(lineCents(i.quantity, price) / 100) : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {entered.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-[--color-border] bg-[--color-canvas]">
                        <td colSpan={4} className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">Total of quoted items</td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums text-[--color-text-primary] whitespace-nowrap">{fmtCurrency(total / 100)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!canSave} onClick={submit} className="gap-2">
            <FileText className="size-3.5" />
            {isPending ? 'Saving…' : quotation ? 'Save Changes' : 'Record Quotation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

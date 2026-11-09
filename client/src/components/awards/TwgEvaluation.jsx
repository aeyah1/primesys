import { useEffect, useState, Fragment } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Check, X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'
import { cents } from './supplier'
import CanvassFiles from './CanvassFiles'

// The TWG's marks as the server keeps them, one per item of the award under its check (GET /canvass/:prId under_check).
const fromServer = (lots = []) => Object.fromEntries(lots.flatMap(l => l.items.map(i => [i.pr_item_id, {
  pr_item_id: i.pr_item_id, compliant: i.compliant, offered_spec: i.offered_spec ?? 'As specified', remarks: i.remarks ?? '',
}])))
// What the server takes: each item's mark, what was offered, and the reason only for a non-compliant one.
export const evaluationPayload = (marks) => ({
  bids: Object.values(marks).map(m => ({
    pr_item_id: m.pr_item_id, compliant: m.compliant, offered_spec: m.offered_spec.trim() || null,
    remarks: m.compliant === false ? m.remarks.trim() || undefined : undefined,
  })),
})
// Why the award can't be certified yet (null when it can): every item marked, and every offer compliant.
export function evaluationBlock(marks) {
  const list = Object.values(marks)
  if (!list.length) return 'No award waits for the check.'
  const unmarked = list.filter(m => m.compliant === null).length
  if (unmarked) return `${unmarked} item${unmarked === 1 ? ' is' : 's are'} not marked yet.`
  if (list.some(m => m.compliant === false)) return 'An offer is non-compliant: return the award to Procurement instead.'
  return null
}

/* The TWG's check of an IT or hardware award: each lot's winning supplier, and under it every item with its awarded
   price and what was offered (as Procurement typed it from the RFQ; the TWG may correct it), marked Compliant or
   Non-Compliant (with the reason), the returned RFQs beside it. The marks are reported to the page with
   onChange(marks) for its Certify or Return; Save keeps them to finish later.
   prId: the PR; canvass: GET /canvass/:prId; canEdit: this member may mark them. */
export default function TwgEvaluation({ prId, canvass, canEdit, onChange }) {
  const qc = useQueryClient()
  const lots = canvass.under_check || []
  const [marks, setMarks] = useState(() => fromServer(lots))
  useEffect(() => { onChange?.(marks) }, [marks, onChange])
  const set = (id, change) => setMarks(m => ({ ...m, [id]: { ...m[id], ...change } }))

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => api.put(`/twg/${prId}/evaluation`, evaluationPayload(marks)),
    onSuccess: () => { toast.success('Marks saved'); qc.invalidateQueries({ queryKey: ['canvass', String(prId)] }) },
    onError: (err) => toast.error(err.response?.data?.message || 'The marks could not be saved'),
  })

  const list = Object.values(marks)
  const done = list.filter(m => m.compliant !== null).length

  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-5">
      <section className="space-y-3 2xl:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">The winning offers</h3>
          <p className="text-xs text-[--color-text-secondary]"><span className="font-semibold text-[--color-text-primary]">{done} of {list.length}</span> items marked</p>
        </div>
        <div className="rounded-xl border border-[--color-border] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                <th className="px-3 py-2.5 min-w-40">Item</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Unit price</th>
                <th className="px-3 py-2.5 min-w-40">Offered specification</th>
                <th className="px-3 py-2.5 min-w-56">Compliant / Non-compliant</th>
              </tr>
            </thead>
            <tbody>
              {lots.map(l => (
                <Fragment key={l.lot_id}>
                  <tr className="border-t border-[--color-border] bg-[--color-canvas]">
                    <td colSpan={4} className="px-3 py-2">
                      <span className="font-semibold text-[--color-text-primary]">{l.title || l.lot_number}: {l.awarded_to}</span>
                      <span className="text-xs text-[--color-text-muted]"> · {fmtCurrency(l.total)}</span>
                    </td>
                  </tr>
                  {l.items.map(i => {
                    const m = marks[i.pr_item_id]
                    const above = Number(i.estimated_cost) > 0 && cents(i.unit_price) > cents(i.estimated_cost)
                    return (
                      <tr key={i.pr_item_id} className="border-t border-[--color-border] align-top">
                        <td className="px-3 py-2">
                          <span className="font-medium text-[--color-text-primary]">{i.item_name}</span>
                          <span className="block text-[11px] text-[--color-text-muted]">
                            {Number(i.quantity)} {i.unit || ''}{Number(i.estimated_cost) > 0 ? ` · budget ${fmtCurrency(i.estimated_cost)} each` : ''}
                          </span>
                          {i.notes && <span className="block text-xs text-[--color-text-secondary] whitespace-pre-wrap">{i.notes}</span>}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${above ? 'text-amber-800' : ''}`}>{fmtCurrency(i.unit_price)}</td>
                        <td className="px-3 py-1.5">
                          <Input value={m.offered_spec} maxLength={1000} disabled={!canEdit} aria-label={`What ${l.awarded_to} offered for ${i.item_name}`}
                            onChange={e => set(i.pr_item_id, { offered_spec: e.target.value })} className="h-8 text-xs" />
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="inline-flex overflow-hidden rounded-lg border border-[--color-border]">
                            {[[true, 'Compliant', Check, 'bg-emerald-600'], [false, 'Non-compliant', X, 'bg-red-600']].map(([v, label, Icon, on]) => (
                              <button key={label} type="button" disabled={!canEdit} onClick={() => set(i.pr_item_id, { compliant: v })}
                                aria-pressed={m.compliant === v}
                                className={`inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1 text-xs font-semibold transition-colors ${
                                  m.compliant === v ? `${on} text-white` : 'bg-white text-[--color-text-secondary] hover:bg-[--color-overlay]'}`}>
                                <Icon className="size-3" /> {label}
                              </button>
                            ))}
                          </div>
                          {m.compliant === false && (
                            <Input value={m.remarks} maxLength={500} disabled={!canEdit} placeholder="State the reason" aria-label={`Why ${l.awarded_to}'s offer is non-compliant`}
                              onChange={e => set(i.pr_item_id, { remarks: e.target.value })}
                              className={`mt-1.5 h-8 text-xs ${m.remarks.trim() ? '' : 'border-amber-400'}`} />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" className="gap-1.5" disabled={isPending || !list.length} onClick={() => save()}>
              <Save className="size-3.5" /> {isPending ? 'Saving…' : 'Save to finish later'}
            </Button>
          </div>
        )}
      </section>
      <div className="2xl:col-span-2"><CanvassFiles prId={String(prId)} /></div>
    </div>
  )
}

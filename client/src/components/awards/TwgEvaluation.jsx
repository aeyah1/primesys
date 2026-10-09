import { useEffect, useState, Fragment } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Check, X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'
import { cents, DQBadge } from './supplier'
import CanvassFiles from './CanvassFiles'

const key = (bidderId, itemId) => `${bidderId}:${itemId}`

// The TWG's marks as the server keeps them, one per open bid.
function fromServer(canvass) {
  const open = canvass.items.filter(i => i.state === 'pending')
  const marks = {}
  for (const i of open) {
    for (const b of canvass.bidders) {
      if (b.prices[i.id] == null) continue
      const ev = b.evaluation?.[i.id] || {}
      marks[key(b.id, i.id)] = {
        bidder_id: b.id, pr_item_id: i.id, compliant: ev.compliant ?? null,
        offered_spec: ev.offered_spec ?? 'As specified', remarks: ev.remarks ?? '',
      }
    }
  }
  return marks
}
// What the server takes: each bid's mark, the reason only for a non-compliant one.
export const evaluationPayload = (marks) => ({
  bids: Object.values(marks).map(m => ({
    bidder_id: m.bidder_id, pr_item_id: m.pr_item_id, compliant: m.compliant,
    offered_spec: m.offered_spec.trim() || undefined, remarks: m.compliant === false ? m.remarks.trim() || undefined : undefined,
  })),
})
// Why the evaluation can't be certified yet (null when it can): every lot needs an offer compliant on all of it.
export function evaluationBlock(marks, canvass) {
  const list = Object.values(marks)
  if (!list.length) return 'No bid waits for the evaluation.'
  const unmarked = list.filter(m => m.compliant === null).length
  if (unmarked) return `${unmarked} bid${unmarked === 1 ? ' is' : 's are'} not marked yet.`
  if (list.some(m => m.compliant === false && !m.remarks.trim())) return 'State the reason for every non-compliant bid.'
  const open = new Set((canvass?.items || []).filter(i => i.state === 'pending').map(i => i.id))
  const lots = (canvass?.lots || []).map(l => ({ name: l.name, ids: l.item_ids.filter(id => open.has(id)) })).filter(l => l.ids.length)
  const bare = lots.find(l => !canvass.bidders.some(b => l.ids.every(id => marks[key(b.id, id)]?.compliant === true)))
  if (bare) return `No offer ${lots.length > 1 ? `for ${bare.name} ` : ''}is compliant. Choose Re-canvass.`
  return null
}

/* The TWG's evaluation of a canvass: every bid the BAC entered, under its item,
   with what the bidder offered (as the BAC typed it from the RFQ; the TWG may
   correct it), marked Compliant or Non-Compliant (with the reason), a bidder
   non-compliant on everything it offered marked DQ, and the canvasser's files
   beside it. The marks are reported to the
   page with onChange(marks) for its Certify; Save keeps them to finish later.
   prId: the PR; canvass: GET /canvass/:prId; canEdit: this member may mark them. */
export default function TwgEvaluation({ prId, canvass, canEdit, onChange }) {
  const qc = useQueryClient()
  const [marks, setMarks] = useState(() => fromServer(canvass))
  useEffect(() => { onChange?.(marks) }, [marks, onChange])
  const set = (k, change) => setMarks(m => ({ ...m, [k]: { ...m[k], ...change } }))

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => api.put(`/twg/${prId}/evaluation`, evaluationPayload(marks)),
    onSuccess: () => { toast.success('Evaluation saved'); qc.invalidateQueries({ queryKey: ['canvass', String(prId)] }) },
    onError: (err) => toast.error(err.response?.data?.message || 'The evaluation could not be saved'),
  })

  const open = canvass.items.filter(i => i.state === 'pending')
  const list = Object.values(marks)
  const done = list.filter(m => m.compliant !== null).length
  const bidderOf = (id) => canvass.bidders.find(b => b.id === id)
  // DQ as marked so far: non-compliant on every item it offered.
  const dq = (id) => list.filter(m => m.bidder_id === id).every(m => m.compliant === false)

  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-5">
      <section className="space-y-3 2xl:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">Every bid</h3>
          <p className="text-xs text-[--color-text-secondary]"><span className="font-semibold text-[--color-text-primary]">{done} of {list.length}</span> bids marked</p>
        </div>
        <div className="rounded-xl border border-[--color-border] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                <th className="px-3 py-2.5">Bidder</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Unit price</th>
                <th className="px-3 py-2.5 min-w-40">Offered specification</th>
                <th className="px-3 py-2.5 min-w-56">Compliant / Non-compliant</th>
              </tr>
            </thead>
            <tbody>
              {open.map(i => (
                <Fragment key={i.id}>
                  <tr className="border-t border-[--color-border] bg-[--color-canvas]">
                    <td colSpan={4} className="px-3 py-2">
                      <span className="font-semibold text-[--color-text-primary]">{i.item_name}</span>
                      <span className="text-xs text-[--color-text-muted]">
                        {' · '}{Number(i.quantity)} {i.unit || ''}{Number(i.estimated_cost) > 0 ? ` · budget ${fmtCurrency(i.estimated_cost)} each` : ''}
                      </span>
                      {i.notes && <span className="block text-xs text-[--color-text-secondary] whitespace-pre-wrap">{i.notes}</span>}
                    </td>
                  </tr>
                  {list.filter(m => m.pr_item_id === i.id).map(m => {
                    const b = bidderOf(m.bidder_id)
                    const k = key(m.bidder_id, i.id)
                    const above = Number(i.estimated_cost) > 0 && cents(b.prices[i.id]) > cents(i.estimated_cost)
                    return (
                      <tr key={k} className="border-t border-[--color-border] align-top">
                        <td className="px-3 py-2">
                          <span className="font-medium text-[--color-text-primary]">{b.name}</span>
                          {dq(b.id) && <DQBadge />}
                          {b.rfq_no && <span className="block text-[11px] text-[--color-text-muted]">RFQ No. {b.rfq_no}</span>}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${above ? 'text-amber-800' : ''}`}>{fmtCurrency(b.prices[i.id])}</td>
                        <td className="px-3 py-1.5">
                          <Input value={m.offered_spec} maxLength={1000} disabled={!canEdit} aria-label={`What ${b.name} offered for ${i.item_name}`}
                            onChange={e => set(k, { offered_spec: e.target.value })} className="h-8 text-xs" />
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="inline-flex overflow-hidden rounded-lg border border-[--color-border]">
                            {[[true, 'Compliant', Check, 'bg-emerald-600'], [false, 'Non-compliant', X, 'bg-red-600']].map(([v, label, Icon, on]) => (
                              <button key={label} type="button" disabled={!canEdit} onClick={() => set(k, { compliant: v })}
                                aria-pressed={m.compliant === v}
                                className={`inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1 text-xs font-semibold transition-colors ${
                                  m.compliant === v ? `${on} text-white` : 'bg-white text-[--color-text-secondary] hover:bg-[--color-overlay]'}`}>
                                <Icon className="size-3" /> {label}
                              </button>
                            ))}
                          </div>
                          {m.compliant === false && (
                            <Input value={m.remarks} maxLength={500} disabled={!canEdit} placeholder="State the reason" aria-label={`Why ${b.name}'s offer is non-compliant`}
                              onChange={e => set(k, { remarks: e.target.value })}
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
            <Button size="sm" variant="secondary" className="gap-1.5" disabled={isPending} onClick={() => save()}>
              <Save className="size-3.5" /> {isPending ? 'Saving…' : 'Save to finish later'}
            </Button>
          </div>
        )}
      </section>
      <div className="2xl:col-span-2"><CanvassFiles prId={String(prId)} /></div>
    </div>
  )
}

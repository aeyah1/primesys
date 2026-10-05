import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Scale, FileText, Undo2, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency, fmtDate, fmtDatetime } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'
import { useRefreshAwards } from './supplier'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const TEXTAREA = 'w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y'

/* ── The BAC's decision: approve (a resolution, then the TWG) or return ── */
function DecideDialog({ prId, approve, onClose }) {
  const refresh = useRefreshAwards(prId)
  const [text, setText] = useState('')
  const { mutate, isPending } = useMutation({
    mutationFn: () => (approve
      ? api.post(`/bac/${prId}/approve`, { notes: text.trim() || undefined })
      : api.post(`/bac/${prId}/return`, { reason: text.trim() })),
    onSuccess: ({ data }) => {
      toast.success(approve
        ? (data.resolution ? `Approved in BAC Resolution No. ${data.resolution.resolution_number}` : 'Approved')
        : 'Returned to Procurement',
        approve ? { description: 'The TWG certifies it next.' } : undefined)
      refresh()
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || (approve ? 'Failed to approve it' : 'Failed to return it')),
  })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title={approve ? 'Approve the Canvass Result' : 'Return to Procurement'}
        description={approve
          ? 'The winners are adopted in a BAC Resolution and the request goes to the TWG for certification.'
          : 'Procurement can correct the winners or the documents, then submit it back.'}>
        <div className="space-y-1.5">
          <Label>{approve ? <>Notes <span className="text-[--color-text-muted] font-normal text-xs">(optional, on the resolution)</span></>
            : <>Reason <span className="text-red-600 text-xs">*</span></>}</Label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={approve ? 2000 : 500} autoFocus className={TEXTAREA}
            placeholder={approve ? 'e.g. Lowest calculated and responsive offers' : 'e.g. The mice went to the wrong supplier on the abstract'} />
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant={approve ? 'primary' : 'danger'} disabled={isPending || (!approve && !text.trim())} onClick={() => mutate()}>
            {isPending ? 'Saving…' : approve ? 'Approve' : 'Return'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* Where a canvass result stands with the BAC. part 'status': the BAC
   approves or returns it, the TWG certifies it (Procurement submits it from the
   canvass page's checklist). part 'resolutions': each BAC Resolution with its Notices of Award. */
export default function BacPanel({ prId, part = 'status' }) {
  const [deciding, setDeciding] = useState(null)   // 'approve' | 'return'
  const { data } = useQuery({
    queryKey: ['bac', 'pr', prId],
    queryFn: () => api.get(`/bac/${prId}`).then(r => r.data),
  })
  if (!data) return null
  if (part === 'resolutions' && !data.resolutions.length) {
    return <p className="text-sm text-[--color-text-muted]">The BAC has not adopted a resolution for this request yet.</p>
  }

  const can = data.permissions
  const print = (endpoint, label) => openPdf(endpoint)
    .catch(async (err) => toast.error(await blobErrorMessage(err, `Could not open the ${label}`)))

  if (part === 'resolutions') {
    return (
      <div className="space-y-3">
        {data.resolutions.map(r => (
          <div key={r.id} className="rounded-xl border border-[--color-border] px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[--color-text-primary]">BAC Resolution No. {r.resolution_number}</p>
                <p className="text-xs text-[--color-text-muted]">
                  {fmtDate(r.resolved_on)}, by {r.approved_by_name}
                  {' · '}{plural(r.lots.length, 'award')} for {fmtCurrency(r.lots.reduce((s, l) => s + Number(l.awarded_amount), 0))}
                </p>
              </div>
              {can.print && (
                <Button size="sm" variant="outline" className="gap-1.5"
                  onClick={() => print(`/bac/${prId}/resolutions/${r.id}/pdf`, 'BAC Resolution')}>
                  <FileText className="size-3.5" /> Resolution
                </Button>
              )}
            </div>
            {can.print && (
              <div className="flex flex-wrap gap-1.5">
                {r.notices.map(n => (
                  <button key={n.lot_id} onClick={() => print(`/bac/${prId}/resolutions/${r.id}/notice/${n.lot_id}`, 'Notice of Award')}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[--color-border-strong] bg-white px-2.5 py-1 text-[11px] font-medium text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand] transition-colors">
                    <FileText className="size-3" /> Notice of Award: {n.awarded_to}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {data.return_reason && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span><span className="font-semibold">Returned by the BAC:</span> {data.return_reason}</span>
        </p>
      )}

      {data.with_bac && (
        <div className="space-y-2 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-indigo-900">
              <Scale className="size-4 shrink-0" />
              <span>
                <span className="font-semibold">With the BAC for review</span> since {fmtDatetime(data.submitted_at)}
                {data.submitted_by_name ? `, submitted by ${data.submitted_by_name}` : ''}. The winners are locked.
              </span>
            </p>
            {(can.approve || can.return) && (
              <div className="flex flex-wrap gap-2">
                {can.return && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDeciding('return')}>
                    <Undo2 className="size-3.5" /> Return to Procurement
                  </Button>
                )}
                {can.approve && (
                  <Button size="sm" className="gap-1.5" onClick={() => setDeciding('approve')}>
                    <CheckCircle2 className="size-3.5" /> Approve
                  </Button>
                )}
              </div>
            )}
          </div>
          {data.certification_return_reason && (
            <p className="flex items-start gap-2 text-sm text-amber-900">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span><span className="font-semibold">Returned by the TWG:</span> {data.certification_return_reason}</span>
            </p>
          )}
        </div>
      )}

      {data.status === 'twg_certification' && (
        <p className="flex items-center gap-2 rounded-xl border border-teal-300 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          <ShieldCheck className="size-4 shrink-0" />
          <span><span className="font-semibold">Approved by the BAC.</span> The TWG checks the result against the request and certifies it.</span>
        </p>
      )}

      {deciding && <DecideDialog prId={prId} approve={deciding === 'approve'} onClose={() => setDeciding(null)} />}
    </div>
  )
}

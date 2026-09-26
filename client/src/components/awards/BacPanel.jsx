import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Scale, FileText, Send, Undo2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency, fmtDate, fmtDatetime } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'
import { SectionTitle, nameKey, useRefreshAwards } from './supplier'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/* ── The BAC hands the canvass back to Procurement, with the reason ───── */
function ReturnDialog({ prId, onClose }) {
  const refresh = useRefreshAwards(prId)
  const [reason, setReason] = useState('')
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/bac/${prId}/return`, { reason: reason.trim() }),
    onSuccess: () => { toast.success('Returned to Procurement'); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to return it'),
  })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Return to Procurement"
        description="Procurement can change the canvass again, then submit it back. Awards already made stay.">
        <div className="space-y-1.5">
          <Label>Reason <span className="text-red-600 text-xs">*</span></Label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500} autoFocus
            placeholder="e.g. Get a third quotation for the laptops"
            className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y" />
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="danger" disabled={isPending || !reason.trim()} onClick={() => mutate()}>
            {isPending ? 'Returning…' : 'Return'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* Where a canvass stands with the BAC: Procurement submits it, the BAC
   evaluates and awards on the canvass below or returns it, and each award
   is a BAC Resolution with its Notices of Award. */
export default function BacPanel({ prId }) {
  const refresh = useRefreshAwards(prId)
  const [returning, setReturning] = useState(false)
  const { data } = useQuery({
    queryKey: ['bac', 'pr', prId],
    queryFn: () => api.get(`/bac/${prId}`).then(r => r.data),
  })
  const { mutate: submit, isPending: submitting } = useMutation({
    mutationFn: () => api.post(`/bac/${prId}/submit`),
    onSuccess: () => { toast.success('Submitted to the BAC for evaluation'); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to submit it'),
  })
  if (!data || (!data.required && !data.resolutions.length)) return null

  const can = data.permissions
  const print = (endpoint, label) => openPdf(endpoint)
    .catch(async (err) => toast.error(await blobErrorMessage(err, `Could not open the ${label}`)))

  return (
    <div className="space-y-3">
      {data.with_bac && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-indigo-900">
            <Scale className="size-4 shrink-0" />
            <span>
              <span className="font-semibold">With the BAC for evaluation</span> since {fmtDatetime(data.submitted_at)}
              {data.submitted_by_name ? `, submitted by ${data.submitted_by_name}` : ''}. The quotations are locked.
            </span>
          </p>
          {can.return && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setReturning(true)}>
              <Undo2 className="size-3.5" /> Return to Procurement
            </Button>
          )}
        </div>
      )}

      {data.return_reason && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span><span className="font-semibold">Returned by the BAC:</span> {data.return_reason}</span>
        </p>
      )}

      {can.submit && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[--color-border] bg-[--color-canvas] px-4 py-3">
          <p className="text-sm text-[--color-text-secondary]">
            Once the quotations are in, submit the canvass to the BAC. It evaluates them and makes the award.
          </p>
          <Button size="sm" className="gap-1.5" disabled={submitting}
            onClick={() => { if (window.confirm('Submit this canvass to the BAC? The quotations lock until the BAC awards or returns it.')) submit() }}>
            <Send className="size-3.5" /> {submitting ? 'Submitting…' : 'Submit to the BAC'}
          </Button>
        </div>
      )}

      {data.resolutions.length > 0 && <SectionTitle>BAC Resolutions</SectionTitle>}
      {data.resolutions.map(r => {
        // One Notice of Award per supplier in the resolution.
        const suppliers = [...new Map(r.lots.map(l => [nameKey(l.awarded_to), l])).values()]
        return (
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
              <div className="flex flex-wrap gap-2">
                {suppliers.map(l => (
                  <button key={l.id} onClick={() => print(`/bac/${prId}/resolutions/${r.id}/notice/${l.id}`, 'Notice of Award')}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[--color-border-strong] bg-white px-2.5 py-1 text-[11px] font-medium text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand] transition-colors">
                    <FileText className="size-3" /> Notice of Award: {l.awarded_to}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {returning && <ReturnDialog prId={prId} onClose={() => setReturning(false)} />}
    </div>
  )
}

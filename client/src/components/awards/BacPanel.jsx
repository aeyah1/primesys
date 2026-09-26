import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Scale, FileText, CheckCircle2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency, fmtDate } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'
import { SectionTitle, nameKey, useRefreshAwards } from './supplier'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const TEXTAREA = 'w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y'
const pad = (n) => String(n).padStart(2, '0')
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

/* ── Approve every recommendation on the PR in one resolution ─────────── */
function ApproveDialog({ prId, pending, onClose }) {
  const refresh = useRefreshAwards(prId)
  const [date, setDate]   = useState(today())
  const [notes, setNotes] = useState('')
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/bac/${prId}/approve`, { resolved_on: date, notes: notes.trim() || undefined }),
    onSuccess: ({ data }) => { toast.success(`Approved in BAC Resolution No. ${data.resolution_number}`); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to approve'),
  })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Approve the Recommended Award"
        description={`${plural(pending.lots, 'award')} for ${fmtCurrency(pending.total)} become final, and their purchase orders can be issued.`}>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Resolution date</Label>
            <Input type="date" max={today()} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes <span className="text-[--color-text-muted] font-normal text-xs">(optional, printed on the resolution)</span></Label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={2000} className={TEXTAREA} />
          </div>
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button disabled={isPending || !date} onClick={() => mutate()}>{isPending ? 'Approving…' : 'Approve'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Return every recommendation to Procurement, with the reason ─────── */
function ReturnDialog({ prId, onClose }) {
  const refresh = useRefreshAwards(prId)
  const [reason, setReason] = useState('')
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/bac/${prId}/return`, { reason: reason.trim() }),
    onSuccess: () => { toast.success('Returned to Procurement'); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to return the award'),
  })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Return to Procurement"
        description="The recommendation is cancelled and kept on record with your reason; its items need an award again.">
        <div className="space-y-1.5">
          <Label>Reason <span className="text-red-600 text-xs">*</span></Label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500} autoFocus
            placeholder="e.g. Ask the supplier to confirm the warranty terms" className={TEXTAREA} />
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

/* The BAC's part of a PR: awards waiting for its approval, and the
   resolutions made with their BAC Resolution and Notices of Award. */
export default function BacPanel({ prId }) {
  const [dialog, setDialog] = useState(null)   // 'approve' | 'return'
  const { data } = useQuery({
    queryKey: ['bac', 'pr', prId],
    queryFn: () => api.get(`/bac/${prId}`).then(r => r.data),
  })
  if (!data || (!data.pending.lots && !data.resolutions.length)) return null

  const print = (endpoint, label) => openPdf(endpoint)
    .catch(async (err) => toast.error(await blobErrorMessage(err, `Could not open the ${label}`)))

  return (
    <div className="space-y-3">
      <SectionTitle>Bids and Awards Committee</SectionTitle>

      {data.pending.lots > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-indigo-900">
            <Scale className="size-4 shrink-0" />
            <span><span className="font-semibold">{plural(data.pending.lots, 'recommended award')}</span> for {fmtCurrency(data.pending.total)} waiting for the BAC's approval</span>
          </p>
          {data.permissions.decide && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDialog('return')}>
                <Undo2 className="size-3.5" /> Return
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setDialog('approve')}>
                <CheckCircle2 className="size-3.5" /> Approve
              </Button>
            </div>
          )}
        </div>
      )}

      {data.resolutions.map(r => {
        // One Notice of Award per supplier in the resolution.
        const suppliers = [...new Map(r.lots.map(l => [nameKey(l.awarded_to), l])).values()]
        return (
          <div key={r.id} className="rounded-xl border border-[--color-border] px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[--color-text-primary]">BAC Resolution No. {r.resolution_number}</p>
                <p className="text-xs text-[--color-text-muted]">
                  {fmtDate(r.resolved_on)}, approved by {r.approved_by_name}
                  {' · '}{plural(r.lots.length, 'award')} for {fmtCurrency(r.lots.reduce((s, l) => s + Number(l.awarded_amount), 0))}
                </p>
              </div>
              {data.permissions.print && (
                <Button size="sm" variant="outline" className="gap-1.5"
                  onClick={() => print(`/bac/${prId}/resolutions/${r.id}/pdf`, 'BAC Resolution')}>
                  <FileText className="size-3.5" /> Resolution
                </Button>
              )}
            </div>
            {data.permissions.print && <div className="flex flex-wrap gap-2">
              {suppliers.map(l => (
                <button key={l.id} onClick={() => print(`/bac/${prId}/resolutions/${r.id}/notice/${l.id}`, 'Notice of Award')}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[--color-border-strong] bg-white px-2.5 py-1 text-[11px] font-medium text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand] transition-colors">
                  <FileText className="size-3" /> Notice of Award: {l.awarded_to}
                </button>
              ))}
            </div>}
          </div>
        )
      })}

      {dialog === 'approve' && <ApproveDialog prId={prId} pending={data.pending} onClose={() => setDialog(null)} />}
      {dialog === 'return'  && <ReturnDialog prId={prId} onClose={() => setDialog(null)} />}
    </div>
  )
}

import { useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, RotateCcw, XCircle, ShieldCheck, Undo2, PenLine, RefreshCcw } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtCurrency, RE_PR_TYPES, groupItemsBySection, typedSpec } from '@/lib/utils'
import PpmpComparison, { usePrPpmp, ViewPpmpButton } from '@/components/ppmp/PpmpComparison'
import { evaluationPayload } from '@/components/awards/TwgEvaluation'
import SignatureDialog from '@/components/shared/SignatureDialog'
import useMySignature from '@/hooks/useMySignature'
import { useAuth } from '@/context/AuthContext'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

const TITLES = {
  approve: 'Approve the request', revise: 'Return for changes', reject: 'Reject the request',
  certify: 'Certify the canvass result', recanvass: 'Order a re-canvass', return: 'Return to Procurement', repr: 'Propose a Re-PR',
}
const CERTIFYING = ['certify', 'recanvass', 'return', 'repr']

/* The TWG's decision on a request, from the request page: on the request itself (approve, return for changes, reject),
   or on its canvass (certify, re-canvass, return to Procurement, Re-PR; `marks` and `dqRemarks` from TwgEvaluation are
   saved first). Approving and certifying issue a numbered TWG Certification, signed or not. action: one of TITLES. */
export default function TwgReviewDialog({ pr, action, marks = {}, dqRemarks = {}, onClose }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const id = String(pr.id)
  const certifyAction = CERTIFYING.includes(action)
  const issuesCert = action === 'certify' || action === 'approve'
  const needsComment = ['revise', 'reject', 'return', 'recanvass', 'repr'].includes(action)
  const mySignature = useMySignature(user?.role === 'twg')

  const { data: items = [] } = useQuery({ queryKey: ['pr', id, 'items'], queryFn: () => api.get(`/pr/${id}/items`).then(r => r.data) })
  const { data: bac } = useQuery({ queryKey: ['bac', 'pr', id], queryFn: () => api.get(`/bac/${id}`).then(r => r.data) })
  const { data: review } = usePrPpmp(id)
  const planName = review?.plan ? `${review.plan.office_code} PPMP, FY ${review.plan.fiscal_year}` : null

  const [comment, setComment] = useState('')
  const [rePrType, setRePrType] = useState('')
  const [certNo, setCertNo] = useState(null)        // null until changed: the server's suggestion shows meanwhile
  const [signature, setSignature] = useState(undefined)   // undefined: this member's saved signature
  const [signing, setSigning] = useState(false)
  const shownSignature = signature === undefined ? (issuesCert ? mySignature.saved : null) : signature
  const shownCertNo = certNo ?? bac?.suggested_cert_no ?? ''

  const grandTotal = items.reduce((sum, it) => sum + parseFloat(it.quantity || 0) * parseFloat(it.estimated_cost || 0), 0)
  const groups = groupItemsBySection(items)
  // ICT specifications the End User typed and the TWG hasn't marked checked yet: approving waits for them.
  const unchecked = action === 'approve' ? items.filter(it => typedSpec(it) && !it.dropped_at && !it.spec_checked_at) : []

  const { mutate: submit, isPending } = useMutation({
    mutationFn: async () => {
      // The marks are saved first: the certificate lists every bid as marked, and a re-canvass or Re-PR keeps them on record.
      if (['certify', 'recanvass', 'repr'].includes(action)) await api.put(`/twg/${id}/evaluation`, evaluationPayload(marks, dqRemarks))
      return api.post(`/twg/${id}/${certifyAction ? 'certify' : 'review'}`, {
        action, comment: comment.trim() || null,
        ...(action === 'repr' ? { re_pr_type: rePrType } : {}),
        ...(issuesCert ? { cert_no: shownCertNo.trim() || undefined, signature: shownSignature?.image, sign_method: shownSignature?.method } : {}),
      })
    },
    onSuccess: ({ data }) => {
      const msg = action === 'approve' ? `Approved and sent to Procurement${data.certificate ? `, certified in Cert. No. ${data.certificate.cert_no}` : ''}`
        : action === 'revise' ? 'Returned for changes. The End User has been told.'
        : ['certify', 'recanvass', 'repr'].includes(action) ? data.message
        : action === 'return' ? 'Returned to Procurement with your comment'
        : 'Rejected. The End User has been told.'
      toast.success(msg, issuesCert && data.certificate ? {
        action: { label: 'Print certificate', onClick: () => openPdf(`/bac/${id}/certificates/${data.certificate.id}/pdf`).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the TWG Certification'))) },
      } : undefined)
      for (const key of [['twg'], ['bac', 'pr', id], ['pr', id], ['canvass', id], ['pr-logs', id], ['pr-tasks']]) qc.invalidateQueries({ queryKey: key })
      onClose()
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'The decision could not be saved'),
  })

  return (
    <>
    <Dialog open onOpenChange={(open) => { if (!open && !isPending) onClose() }}>
      <DialogContent className={certifyAction ? 'max-w-2xl' : 'max-w-4xl'} title={TITLES[action]}>
        <div className="space-y-3 pt-2">
          <p className="text-ui-sm text-[--color-text-secondary]">
            {action === 'approve' && <>You're approving <b className="font-mono text-[--color-brand]">{pr.pr_number}</b>. It goes to Procurement for the canvass, and you issue the TWG's Certification that you checked its market price and specifications. You can leave an optional note.</>}
            {action === 'revise' && <>Tell <b className="font-medium text-[--color-text-primary]">{pr.created_by_name}</b> what needs to change. Your comment shows on the request and in their notice.</>}
            {action === 'certify' && <>You're certifying your evaluation of every bid on <b className="font-mono text-[--color-brand]">{pr.pr_number}</b>. The certificate lists each offer as you marked it, and the BAC chooses the supplier next. You can leave an optional note.</>}
            {action === 'recanvass' && <>Say which lot has no compliant offer, and why. <b className="font-mono text-[--color-brand]">{pr.pr_number}</b> goes back to canvass for new quotations; the bids you marked keep their marks. The BAC, Procurement and <b className="font-medium text-[--color-text-primary]">{pr.created_by_name}</b> are told the reason.</>}
            {action === 'return' && <>Tell Procurement what is wrong with the bids of <b className="font-mono text-[--color-brand]">{pr.pr_number}</b>. It corrects them and sends the canvass again.</>}
            {action === 'repr' && <>Every supplier is DQ, so the specifications or the budget of <b className="font-mono text-[--color-brand]">{pr.pr_number}</b> have to change. Procurement checks your reason and sends the request back to <b className="font-medium text-[--color-text-primary]">{pr.created_by_name}</b>, who changes it and submits it to you again. Your marks stay on record.</>}
            {action === 'reject' && <>Reject <b className="font-mono text-[--color-brand]">{pr.pr_number}</b>. It won't go on to Procurement. Give the reason, so <b className="font-medium text-[--color-text-primary]">{pr.created_by_name}</b> understands why.</>}
          </p>

          {unchecked.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-ui-sm text-amber-900">
              <p className="font-semibold">Check the specifications the End User typed first</p>
              <p className="mt-0.5 text-xs">
                {unchecked.map(it => it.item_name).join('; ')}: close this, then press Mark as checked under each one on the request.
              </p>
            </div>
          )}

          {/* Deciding the request: each item beside its PPMP line, and the whole PPMP a click away (in a new tab, so the comment stays). */}
          {!certifyAction && items.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted]">
                  Requested items and the PPMP{planName ? `: ${planName}` : ''} · Total {fmtCurrency(grandTotal)}
                </p>
                <ViewPpmpButton plan={review?.plan} newTab />
              </div>
              <div className="max-h-[42vh] overflow-y-auto"><PpmpComparison prId={id} items={items} compact /></div>
            </div>
          )}
          {/* Deciding the canvass: the requested items for reference, scrolling when long. */}
          {certifyAction && items.length > 0 && (
            <div className="rounded-lg border border-[--color-border] bg-[--color-canvas]">
              <div className="flex items-center justify-between border-b border-[--color-border] px-3.5 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted]">Requested Items ({items.length})</p>
                <p className="text-[10px] font-semibold tabular-nums text-[--color-text-secondary]">Total: {fmtCurrency(grandTotal)}</p>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {groups.map((g, gi) => (
                  <Fragment key={`g-${gi}`}>
                    {g.label && <div className="bg-[--color-overlay] px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[--color-text-secondary]">{g.label}</div>}
                    {g.items.map((it, ii) => (
                      <div key={it.id} className="flex items-start justify-between gap-3 border-b border-[--color-border] px-3.5 py-2.5 last:border-0">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug text-[--color-text-primary]"><span className="mr-1.5 text-[--color-text-muted]">{ii + 1}.</span>{it.item_name}</p>
                          {it.notes && <p className="mt-1 whitespace-pre-wrap text-xs leading-snug text-[--color-text-secondary]">{it.notes}</p>}
                        </div>
                        <p className="shrink-0 text-right text-xs font-medium tabular-nums text-[--color-text-primary]">{it.quantity} {it.unit || ''}</p>
                      </div>
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>
          )}

          {/* The certificate: its number and, optionally, the certifier's signature. */}
          {issuesCert && (
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-[--color-border] bg-[--color-canvas] p-3.5 sm:grid-cols-[200px_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="cert-no">Cert. No.</Label>
                <Input id="cert-no" value={shownCertNo} maxLength={30} onChange={e => setCertNo(e.target.value)} placeholder="e.g. 2026-10-001" />
                <p className="text-[10px] text-[--color-text-muted]">Suggested. Change it to follow the paper numbering.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Signature on the certificate <span className="text-xs font-normal text-[--color-text-muted]">(optional)</span></Label>
                {shownSignature ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-md border border-[--color-border] bg-white px-2 py-1"><img src={shownSignature.image} alt={`Signature of ${user?.name || 'the TWG member'}`} className="h-10" /></div>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSignature(null)}>Remove</Button>
                    {user?.role !== 'twg' ? null : shownSignature.image === mySignature.saved?.image
                      ? <span className="text-[11px] text-[--color-text-muted]">Your saved signature</span>
                      : <Button type="button" size="sm" variant="ghost" disabled={mySignature.saving} onClick={() => mySignature.save(shownSignature)}>Save as my signature</Button>}
                  </div>
                ) : <p className="text-xs text-[--color-text-secondary]">Unsigned, the certificate prints a blank line to sign by hand.</p>}
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setSigning(true)}>
                  <PenLine className="size-3.5" /> {shownSignature ? 'Sign again' : 'Sign the certificate'}
                </Button>
              </div>
            </div>
          )}

          {/* A Re-PR's kind: always about the specifications. */}
          {action === 'repr' && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted]">Why it goes back</legend>
              {Object.entries(RE_PR_TYPES).map(([key, label]) => (
                <label key={key} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-ui-sm transition-colors ${
                  rePrType === key ? 'border-red-400 bg-red-50 text-red-900' : 'border-[--color-border] hover:border-[--color-border-strong]'}`}>
                  <input type="radio" name="re-pr-type" value={key} checked={rePrType === key} onChange={() => setRePrType(key)} className="mt-0.5 accent-red-600" />
                  {label}
                </label>
              ))}
            </fieldset>
          )}

          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={5} autoFocus={action !== 'certify'}
            placeholder={action === 'approve' ? 'Optional note for Procurement…'
              : action === 'certify' ? 'Optional note…'
              : action === 'return' ? 'Which bid was entered wrong, and what its RFQ says…'
              : action === 'recanvass' ? 'Which lot has no compliant offer, and what the specifications require…'
              : action === 'repr' ? 'The details: what the suppliers offered against the specifications, for example only higher-end models above the ABC…'
              : action === 'revise' ? 'Be specific: which items, what to fix, why…'
              : 'Reason for rejecting (required)…'}
            className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-ui-sm text-[--color-text-primary] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-brand]" />
          {needsComment && !comment.trim() && (
            <p className="text-[10px] text-amber-700">{action === 'repr' ? 'Pick why it goes back, and give the details.' : action === 'reject' ? 'A reason is required to reject it.' : 'A comment is required.'}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={() => submit()} disabled={isPending || (needsComment && !comment.trim()) || (action === 'repr' && !rePrType) || unchecked.length > 0}
            className={action === 'approve' || action === 'certify' ? 'gap-1.5 border-0 bg-emerald-600 text-white hover:bg-emerald-700'
              : ['revise', 'return', 'recanvass'].includes(action) ? 'gap-1.5 border-0 bg-amber-600 text-white hover:bg-amber-700'
              : 'gap-1.5 border-0 bg-red-600 text-white hover:bg-red-700'}>
            {isPending ? 'Saving…'
              : action === 'approve' ? <><CheckCircle2 className="size-4" /> Approve</>
              : action === 'certify' ? <><ShieldCheck className="size-4" /> Certify</>
              : action === 'recanvass' ? <><RefreshCcw className="size-4" /> Re-canvass</>
              : action === 'return' ? <><Undo2 className="size-4" /> Return to Procurement</>
              : action === 'repr' ? <><Undo2 className="size-4" /> Propose the Re-PR</>
              : action === 'revise' ? <><RotateCcw className="size-4" /> Return for changes</>
              : <><XCircle className="size-4" /> Reject</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {signing && <SignatureDialog signer={user?.name} onClose={() => setSigning(false)} onSave={setSignature} />}
    </>
  )
}

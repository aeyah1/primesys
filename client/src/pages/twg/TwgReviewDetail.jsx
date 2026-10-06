import { useState, Fragment } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, CheckCircle2, RotateCcw, XCircle, Paperclip, FileDown,
  Package, Info, Calendar, User, ShieldCheck, Undo2, ListChecks, PenLine,
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { PRStatusBadge, CategoryBadge } from '@/components/shared/StatusBadge'
import { fmtCurrency, fmtDatetime, CATEGORY_LABELS, PR_STATUS_LABELS, groupItemsBySection } from '@/lib/utils'
import RequestContextDisplay from '@/components/shared/RequestContextDisplay'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import PpmpComparison, { usePrPpmp, ViewPpmpButton } from '@/components/ppmp/PpmpComparison'
import TwgCertificates from '@/components/awards/TwgCertificates'
import TwgEvaluation, { evaluationPayload, evaluationBlock } from '@/components/awards/TwgEvaluation'
import SignatureDialog from '@/components/shared/SignatureDialog'
import { useAuth } from '@/context/AuthContext'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

export default function TwgReviewDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()

  const [action, setAction] = useState(null)   // 'approve' | 'revise' | 'reject', or 'certify' | 'return' for a canvass result
  const [comment, setComment] = useState('')
  const [certNo, setCertNo] = useState('')           // the certificate's number, suggested by the server
  const [signature, setSignature] = useState(null)   // { image, method } on the certificate, or null
  const [signing, setSigning] = useState(false)
  const [marks, setMarks] = useState({})             // the TWG's marks on the canvass's bids (TwgEvaluation)

  const { data: pr, isLoading: prLoading } = useQuery({
    queryKey: ['pr', id],
    queryFn: () => api.get(`/pr/${id}`).then(r => r.data),
  })

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['pr', id, 'items'],
    queryFn: () => api.get(`/pr/${id}/items`).then(r => r.data),
  })

  // Same key as the attachments panel below, so the list is fetched once.
  const attachmentsKey = `pr-attachments-${id}`
  const { data: attachments = [] } = useQuery({
    queryKey: [attachmentsKey],
    queryFn: () => api.get(`/pr/${id}/attachments`).then(r => r.data),
  })

  // The office's PPMP the items are drawn from, to compare with.
  const { data: review } = usePrPpmp(id)
  const planName = review?.plan ? `${review.plan.office_code} PPMP, FY ${review.plan.fiscal_year}` : null

  // The canvass the BAC sent, while the TWG evaluates and certifies its bids.
  const certifying = pr?.status === 'twg_certification'
  // Every bid the BAC entered, with this member's marks so far.
  const { data: canvass } = useQuery({
    queryKey: ['canvass', id],
    queryFn: () => api.get(`/canvass/${id}`).then(r => r.data),
    enabled: certifying,
  })
  // The suggested Cert. No. for the certificate (same query as the resolutions panel): approving a request issues one too.
  const { data: bac } = useQuery({
    queryKey: ['bac', 'pr', id],
    queryFn: () => api.get(`/bac/${id}`).then(r => r.data),
    enabled: certifying || pr?.status === 'submitted',
  })

  const openPRForm = async () => {
    try { await openPdf(`/pr/${id}/pdf`) }
    catch (err) { toast.error(await blobErrorMessage(err, 'Failed to open the PR Form')) }
  }

  const certifyAction = action === 'certify' || action === 'return'
  // Approving the request and certifying the bids each issue a TWG Certification.
  const issuesCert = action === 'certify' || action === 'approve'
  const { mutate: submitReview, isPending: submitting } = useMutation({
    mutationFn: async () => {
      // Certifying saves the marks first: the certificate lists every bid as marked.
      if (action === 'certify') await api.put(`/twg/${id}/evaluation`, evaluationPayload(marks))
      return api.post(`/twg/${id}/${certifyAction ? 'certify' : 'review'}`, {
        action, comment: comment.trim() || null,
        ...(issuesCert ? { cert_no: certNo.trim() || undefined, signature: signature?.image, sign_method: signature?.method } : {}),
      })
    },
    onSuccess: ({ data }) => {
      const msg = action === 'approve' ? `PR approved and forwarded to Procurement${data.certificate ? `, certified in Cert. No. ${data.certificate.cert_no}` : ''}`
                : action === 'revise'  ? 'Revision requested. The End User has been notified.'
                : action === 'certify' ? data.message
                : action === 'return'  ? 'Returned to the BAC with your comment'
                                       : 'PR rejected. The End User has been notified.'
      toast.success(msg, issuesCert && data.certificate ? {
        action: { label: 'Print certificate', onClick: () => openPdf(`/bac/${id}/certificates/${data.certificate.id}/pdf`).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the TWG Certification'))) },
      } : undefined)
      qc.invalidateQueries({ queryKey: ['twg'] })
      qc.invalidateQueries({ queryKey: ['bac', 'pr', id] })
      qc.invalidateQueries({ queryKey: ['pr', id] })
      qc.invalidateQueries({ queryKey: ['canvass', id] })
      setAction(null)
      setComment('')
      nav(certifyAction ? '/twg/reviews?stage=certify' : '/twg/reviews')
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Failed to submit review'),
  })

  if (prLoading) {
    return <div className="space-y-4"><Skeleton className="h-12" /><Skeleton className="h-64" /><Skeleton className="h-48" /></div>
  }
  if (!pr) {
    return (
      <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-8 text-center">
        <p className="text-ui-sm text-[--color-text-secondary]">PR not found.</p>
        <Button asChild variant="outline" className="mt-3"><Link to="/twg/reviews">Back to queue</Link></Button>
      </div>
    )
  }

  // Only a reviewer of the PR's area (or an admin) decides it; the server says which.
  const isReviewable = pr.status === 'submitted' && !!pr.permissions?.twg_review
  const outsideArea  = (pr.status === 'submitted' && !pr.permissions?.twg_review) || (certifying && !pr.permissions?.twg_certify)
  const isCertifiable = certifying && !!pr.permissions?.twg_certify
  const certifyBlock = isCertifiable ? evaluationBlock(marks) : null
  const grandTotal = items.reduce(
    (sum, it) => sum + (parseFloat(it.quantity || 0) * parseFloat(it.estimated_cost || 0)),
    0
  )
  const groups = groupItemsBySection(items)

  function openAction(next) {
    setAction(next)
    setComment('')
    setCertNo(bac?.suggested_cert_no || '')
    setSignature(null)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="gap-1.5 -ml-2 mb-1.5">
            <Link to="/twg/reviews"><ArrowLeft className="size-3.5" /> Back to queue</Link>
          </Button>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-mono text-ui-xl font-bold text-[--color-brand]">{pr.pr_number}</h2>
            <PRStatusBadge status={pr.status} />
            <CategoryBadge category={pr.category} />
          </div>
          {pr.title && (
            <p className="text-ui-sm text-[--color-text-primary] mt-1">{pr.title}</p>
          )}
        </div>

        {isCertifiable && (
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => openAction('return')}>
              <Undo2 className="size-4" /> Return to the BAC
            </Button>
            <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white border-0" disabled={!!certifyBlock}
              title={certifyBlock || undefined} onClick={() => openAction('certify')}>
              <ShieldCheck className="size-4" /> Certify
            </Button>
          </div>
        )}

        {isReviewable && (
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
              onClick={() => openAction('reject')}
            >
              <XCircle className="size-4" /> Reject
            </Button>
            <Button
              variant="outline"
              className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => openAction('revise')}
            >
              <RotateCcw className="size-4" /> Request Revision
            </Button>
            <Button
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white border-0"
              onClick={() => openAction('approve')}
            >
              <CheckCircle2 className="size-4" /> Approve & Forward
            </Button>
          </div>
        )}
      </div>

      {/* Resubmitted: who asked for changes last time, and why */}
      {pr.status === 'submitted' && pr.revision && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-3.5">
          <div className="flex items-start gap-2">
            <RotateCcw className="size-4 text-amber-700 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                Resubmitted after changes were requested by {pr.revision.by_name}
              </p>
              {pr.revision.note && (
                <p className="text-ui-sm text-amber-900/90 mt-1 whitespace-pre-wrap">{pr.revision.note}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Visible (you reviewed it before) but its area is no longer yours */}
      {outsideArea && (
        <div className="rounded-xl border border-[--color-border-strong] bg-[--color-canvas] px-5 py-3.5">
          <div className="flex items-start gap-2">
            <Info className="size-4 text-[--color-text-muted] mt-0.5 shrink-0" />
            <p className="text-ui-xs text-[--color-text-secondary]">
              This PR is in <span className="font-semibold">{CATEGORY_LABELS[pr.category] || pr.category}</span>, which is not one of
              your review areas. Its area reviewers decide it.
            </p>
          </div>
        </div>
      )}

      {/* The bids to evaluate: every offer the BAC entered, with the canvasser's files beside them */}
      {certifying && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-[--color-text-muted]" />
              <CardTitle>Bids to Evaluate</CardTitle>
            </div>
            <p className="text-ui-xs text-[--color-text-secondary] mt-1">
              The BAC entered every supplier's bid from the returned RFQs. Check each offer against the item's required specification and
              mark it Compliant or Non-Compliant (state the reason), then click Certify. The BAC picks the winners after your certification.
              If a bid was entered wrong, return the canvass to the BAC with your comment.
            </p>
            {certifyBlock && <p className="text-ui-xs font-medium text-amber-700 mt-1">{certifyBlock}</p>}
          </CardHeader>
          <CardContent>
            {canvass
              ? <TwgEvaluation key={pr.id} prId={id} canvass={canvass} canEdit={isCertifiable} onChange={setMarks} />
              : <Skeleton className="h-40" />}
          </CardContent>
        </Card>
      )}

      <TwgCertificates prId={String(pr.id)} />

      {/* Notice if already reviewed */}
      {!['submitted', 'twg_certification'].includes(pr.status) && (
        <div className="rounded-xl border border-[--color-border] bg-[--color-canvas] px-5 py-3.5">
          <div className="flex items-start gap-2">
            <Info className="size-4 text-[--color-text-muted] mt-0.5 shrink-0" />
            <div className="text-ui-xs text-[--color-text-secondary]">
              This PR is now <span className="font-semibold">{PR_STATUS_LABELS[pr.status] || pr.status}</span> and is no longer in the TWG's queue.
              {pr.twg_comment && (
                <div className="mt-2 rounded-lg border border-[--color-border] bg-[--color-surface] px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted] mb-1">Latest TWG comment</p>
                  <p className="text-ui-sm text-[--color-text-primary] whitespace-pre-wrap">{pr.twg_comment}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Meta card */}
      <Card>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 py-5">
          <Meta icon={User} label="Requested by" value={pr.created_by_name} />
          <Meta icon={Calendar} label="Submitted on" value={fmtDatetime(pr.created_at)} />
          <Meta icon={Info} label="Category" value={CATEGORY_LABELS[pr.category] || pr.category || '—'} />
          <Meta icon={Info} label="Quarter" value={pr.quarter_label ? `${pr.quarter_label} ${pr.quarter_year}` : '—'} />
        </CardContent>
      </Card>

      {/* Request Context — purpose, department, date needed, recommended by */}
      <RequestContextDisplay pr={pr} />

      {/* Items table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="size-4 text-[--color-text-muted]" />
            <CardTitle>Requested Items</CardTitle>
            <span className="text-xs text-[--color-text-muted] font-normal">({items.length})</span>
          </div>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={openPRForm}>
            <FileDown className="size-3.5" /> Download PDF
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {itemsLoading
            ? <div className="p-6 space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            : !items.length
              ? <div className="px-6 py-10 text-center text-ui-xs text-[--color-text-muted]">No items recorded.</div>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[--color-canvas] border-b border-[--color-border]">
                        <th className="px-4 py-3 text-left text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider">Item</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider w-20">Qty</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider w-20">Unit</th>
                        <th className="px-4 py-3 text-right  text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider w-32">Estimated Cost</th>
                        <th className="px-4 py-3 text-right  text-xs font-bold text-[--color-text-secondary] uppercase tracking-wider w-32">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g, gi) => (
                        <Fragment key={`g-${gi}`}>
                          {g.label && (
                            <tr className="bg-[--color-overlay]">
                              <td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[--color-text-secondary]">
                                {g.label}
                              </td>
                            </tr>
                          )}
                          {g.items.map(it => {
                            const sub = parseFloat(it.quantity || 0) * parseFloat(it.estimated_cost || 0)
                            return (
                              <tr key={it.id} className="border-b border-[--color-border] last:border-0">
                                <td className="px-4 py-3 text-[--color-text-primary]">
                                  <div>{it.item_name}</div>
                                  {it.notes && (
                                    <div className="text-sm text-[--color-text-secondary] mt-2 whitespace-pre-wrap leading-relaxed">{it.notes}</div>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center tabular-nums">{it.quantity}</td>
                                <td className="px-4 py-3 text-center text-[--color-text-secondary]">{it.unit || '—'}</td>
                                <td className="px-4 py-3 text-right tabular-nums text-[--color-text-secondary]">{it.estimated_cost ? fmtCurrency(it.estimated_cost) : '—'}</td>
                                <td className="px-4 py-3 text-right tabular-nums font-medium">{sub ? fmtCurrency(sub) : '—'}</td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      ))}
                      <tr className="bg-[--color-canvas] border-t-2 border-[--color-border]">
                        <td colSpan={4} className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                          Total Estimated Cost
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-[--color-brand]">{fmtCurrency(grandTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )
          }
        </CardContent>
      </Card>

      {/* The PPMP lines the items come from, beside them */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ListChecks className="size-4 text-[--color-text-muted]" />
            <CardTitle>Compared with the PPMP</CardTitle>
            {planName && <span className="text-xs text-[--color-text-muted] font-normal truncate">{planName}</span>}
          </div>
          <ViewPpmpButton plan={review?.plan} />
        </CardHeader>
        <CardContent className="p-0">
          <PpmpComparison prId={id} items={items} />
        </CardContent>
      </Card>

      {/* Attachments */}
      {attachments.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Paperclip className="size-4 text-[--color-text-muted]" />
              <CardTitle>Attachments</CardTitle>
              <span className="text-xs text-[--color-text-muted] font-normal">({attachments.length})</span>
            </div>
          </CardHeader>
          <CardContent>
            {/* Read-only for the TWG: download through the signed-in session */}
            <AttachmentsPanel endpoint={`/pr/${id}`} queryKey={attachmentsKey} canUpload={false} canDelete={false} />
          </CardContent>
        </Card>
      )}

      {/* Action Dialog */}
      <Dialog open={!!action} onOpenChange={(open) => { if (!open) { setAction(null); setComment('') } }}>
        <DialogContent
          className={certifyAction ? 'max-w-2xl' : 'max-w-4xl'}
          title={
            action === 'approve' ? 'Approve & Forward to Procurement'
            : action === 'revise' ? 'Request Revision from End User'
            : action === 'certify' ? 'Certify the Canvass Result'
            : action === 'return' ? 'Return to the BAC'
            : 'Reject Purchase Request'
          }
        >
          <div className="space-y-3 pt-2">
            <p className="text-ui-sm text-[--color-text-secondary]">
              {action === 'approve' && (
                <>You're approving <span className="font-mono font-bold text-[--color-brand]">{pr.pr_number}</span>. It will move to Procurement's queue for canvass, and you issue the TWG's Certification that you checked its market price and specifications. You can leave an optional note.</>
              )}
              {action === 'revise' && (
                <>Tell <span className="font-medium text-[--color-text-primary]">{pr.created_by_name}</span> what needs to change. This comment will appear on the PR and in their notification.</>
              )}
              {action === 'certify' && (
                <>You're certifying your evaluation of every bid on <span className="font-mono font-bold text-[--color-brand]">{pr.pr_number}</span>. The certificate lists each offer as you marked it, and the BAC picks the winners next. You can leave an optional note.</>
              )}
              {action === 'return' && (
                <>Tell the BAC what is wrong with the bids of <span className="font-mono font-bold text-[--color-brand]">{pr.pr_number}</span>. It corrects them and sends the canvass again.</>
              )}
              {action === 'reject' && (
                <>Reject <span className="font-mono font-bold text-[--color-brand]">{pr.pr_number}</span> outright. The PR won't move forward to Procurement. A reason is required so <span className="font-medium text-[--color-text-primary]">{pr.created_by_name}</span> understands why.</>
              )}
            </p>

            {/* Reviewing: each requested item beside its PPMP line, and the whole PPMP a click away (in a new tab, so the comment stays). */}
            {!certifyAction && items.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted]">
                    Requested items and the PPMP{planName ? `: ${planName}` : ''} · Total {fmtCurrency(grandTotal)}
                  </p>
                  <ViewPpmpButton plan={review?.plan} newTab />
                </div>
                <div className="max-h-[42vh] overflow-y-auto">
                  <PpmpComparison prId={id} items={items} compact />
                </div>
              </div>
            )}
            {/* Requested items reference — TWG can see what they're commenting on
                without closing the dialog. Scrolls if many items. */}
            {certifyAction && items.length > 0 && (
              <div className="rounded-lg border border-[--color-border] bg-[--color-canvas]">
                <div className="px-3.5 py-2 border-b border-[--color-border] flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted]">
                    Requested Items ({items.length})
                  </p>
                  <p className="text-[10px] font-semibold tabular-nums text-[--color-text-secondary]">
                    Total: {fmtCurrency(grandTotal)}
                  </p>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {groups.map((g, gi) => (
                    <Fragment key={`d-g-${gi}`}>
                      {g.label && (
                        <div className="px-3.5 py-1.5 bg-[--color-overlay] text-[10px] font-semibold uppercase tracking-wider text-[--color-text-secondary]">
                          {g.label}
                        </div>
                      )}
                      {g.items.map((it, ii) => {
                        const sub = parseFloat(it.quantity || 0) * parseFloat(it.estimated_cost || 0)
                        return (
                          <div key={it.id} className="px-3.5 py-2.5 border-b border-[--color-border] last:border-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-[--color-text-primary] leading-snug">
                                  <span className="text-[--color-text-muted] mr-1.5">{ii + 1}.</span>
                                  {it.item_name}
                                </p>
                                {it.notes && (
                                  <p className="mt-1 text-xs text-[--color-text-secondary] whitespace-pre-wrap leading-snug">
                                    {it.notes}
                                  </p>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-medium text-[--color-text-primary] tabular-nums">
                                  {it.quantity} {it.unit || ''}
                                </p>
                                <p className="text-[10px] text-[--color-text-muted] tabular-nums">
                                  {it.estimated_cost ? `${fmtCurrency(it.estimated_cost)} ea` : '—'}
                                </p>
                                {sub > 0 && (
                                  <p className="text-[11px] font-semibold text-[--color-brand] tabular-nums mt-0.5">
                                    {fmtCurrency(sub)}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
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
                  <Input id="cert-no" value={certNo} maxLength={30} onChange={e => setCertNo(e.target.value)} placeholder="e.g. 2026-10-001" />
                  <p className="text-[10px] text-[--color-text-muted]">Suggested. Change it to follow the paper numbering.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Signature on the certificate <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span></Label>
                  {signature ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="rounded-md border border-[--color-border] bg-white px-2 py-1"><img src={signature.image} alt={`Signature of ${user?.name || 'the TWG member'}`} className="h-10" /></div>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setSignature(null)}>Remove</Button>
                    </div>
                  ) : (
                    <p className="text-xs text-[--color-text-secondary]">Unsigned, the certificate prints a blank line to sign by hand.</p>
                  )}
                  <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setSigning(true)}>
                    <PenLine className="size-3.5" /> {signature ? 'Sign again' : 'Sign the certificate'}
                  </Button>
                </div>
              </div>
            )}

            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={5}
              placeholder={
                action === 'approve' ? 'Optional note for procurement…'
                : action === 'certify' ? 'Optional note…'
                : action === 'return' ? 'Which bid was entered wrong, and what its RFQ says…'
                : action === 'revise' ? 'Be specific: which items, what to fix, why…'
                : 'Reason for rejection (required)…'
              }
              autoFocus={action !== 'certify'}
              className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-ui-sm text-[--color-text-primary] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent"
            />
            {action === 'revise' && !comment.trim() && (
              <p className="text-[10px] text-amber-700">A comment is required when requesting revision.</p>
            )}
            {action === 'reject' && !comment.trim() && (
              <p className="text-[10px] text-red-700">A reason is required when rejecting.</p>
            )}
            {action === 'return' && !comment.trim() && (
              <p className="text-[10px] text-amber-700">A comment is required when returning it to the BAC.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={submitting}>Cancel</Button>
            <Button
              onClick={() => submitReview()}
              disabled={submitting || (['revise', 'reject', 'return'].includes(action) && !comment.trim())}
              className={
                action === 'approve' || action === 'certify' ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-0 gap-1.5'
                : action === 'revise' || action === 'return' ? 'bg-amber-600 hover:bg-amber-700 text-white border-0 gap-1.5'
                : 'bg-red-600 hover:bg-red-700 text-white border-0 gap-1.5'
              }
            >
              {submitting
                ? 'Submitting…'
                : action === 'approve' ? <><CheckCircle2 className="size-4" /> Approve & Forward</>
                : action === 'certify' ? <><ShieldCheck className="size-4" /> Certify</>
                : action === 'return' ? <><Undo2 className="size-4" /> Return to the BAC</>
                : action === 'revise' ? <><RotateCcw className="size-4" /> Send for Revision</>
                : <><XCircle className="size-4" /> Reject PR</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {signing && <SignatureDialog signer={user?.name} onClose={() => setSigning(false)} onSave={setSignature} />}
    </div>
  )
}

function Meta({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="size-4 text-[--color-text-muted] mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted]">{label}</p>
        <p className="text-ui-sm text-[--color-text-primary] mt-0.5 truncate">{value}</p>
      </div>
    </div>
  )
}

import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, FileText, Paperclip, Printer, Scale } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PRStatusBadge, CategoryBadge, RecanvassBadge } from '@/components/shared/StatusBadge'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import { useAuth } from '@/context/AuthContext'
import { openPdf, downloadFile, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'
import CanvassPanel from '@/components/awards/CanvassPanel'
import BacPanel from '@/components/awards/BacPanel'
import BacBidSheet from '@/components/awards/BacBidSheet'
import BacAwardSheet from '@/components/awards/BacAwardSheet'
import TwgCertificates from '@/components/awards/TwgCertificates'
import ProcurementActions from './ProcurementActions'

// The steps of a canvass, from the bids to the purchase orders.
const STEPS = [
  { key: 'bidding',           label: 'Canvass: the BAC enters the bids' },
  { key: 'twg_certification', label: 'TWG evaluation' },
  { key: 'bac_review',        label: 'BAC award' },
  { key: 'for_po',            label: 'Purchase orders' },
]

function StepBar({ status }) {
  const index = status === 'completed' ? STEPS.length : STEPS.findIndex(s => s.key === status)
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
            i < index ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
              : i === index ? 'border-[--color-brand] bg-[--color-brand] text-white'
              : 'border-[--color-border] bg-white text-[--color-text-secondary]'}`}>
            {i < index ? <Check className="size-3" /> : <span>{i + 1}</span>} {s.label}
          </span>
          {i < STEPS.length - 1 && <span className="h-px w-4 bg-[--color-border-strong]" />}
        </li>
      ))}
    </ol>
  )
}

// Procurement's part of the canvass: the RFQ, signed by hand for the canvasser; then the BAC has it.
function ProcurementPart({ canvass, onPrintRfq, onWordRfq }) {
  const bidders = canvass.bidders.length
  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-[--color-text-primary]">
            <span className="flex size-6 items-center justify-center rounded-full border border-[--color-border-strong] text-xs font-bold text-[--color-text-secondary]">1</span>
            Print the RFQ
          </p>
          <p className="flex-1 text-xs text-[--color-text-secondary]">Sign it by hand and give it to the canvasser, who canvasses the suppliers on paper.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onPrintRfq}><Printer className="size-3.5" /> Print RFQ</Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onWordRfq} title="The same RFQ as a Word file, to edit or print"><FileText className="size-3.5" /> Word copy</Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-[--color-text-primary]">
            <span className="flex size-6 items-center justify-center rounded-full border border-[--color-border-strong] text-xs font-bold text-[--color-text-secondary]">2</span>
            With the BAC
          </p>
          <p className="flex items-start gap-1.5 text-xs text-[--color-text-secondary]">
            <Scale className="size-3.5 shrink-0 mt-0.5 text-[--color-text-muted]" />
            The canvasser gives the returned RFQs to the BAC, which enters the bids for the TWG to check; the BAC then picks
            the winners. You are told when they are awarded.
            {bidders > 0 ? ` ${bidders} bidder${bidders === 1 ? '' : 's'} entered so far.` : ''}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

const Heading = ({ id, children }) => <h3 id={id} className="scroll-mt-20 text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">{children}</h3>

// A request's canvass on a page of its own. The canvass is done outside the
// system: Procurement prints the RFQ for the canvasser; the BAC enters the
// bids from the returned RFQs and sends them to the TWG; the TWG marks each
// compliant or not and certifies them (on its review page); the BAC picks the
// winners and awards. The request page links here.
export default function CanvassPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const qc = useQueryClient()
  const canManage = ['admin', 'procurement'].includes(user?.role)

  const { data: pr, isLoading } = useQuery({
    queryKey: ['pr', id],
    queryFn: () => api.get(`/pr/${id}`).then(r => r.data),
  })
  const opened = !!pr && !['draft', 'submitted', 'revision_requested', 'twg_review', 'rejected'].includes(pr.status)
  const { data: canvass } = useQuery({
    queryKey: ['canvass', id],
    queryFn: () => api.get(`/canvass/${id}`).then(r => r.data),
    enabled: opened,
  })
  const { data: bac } = useQuery({
    queryKey: ['bac', 'pr', id],
    queryFn: () => api.get(`/bac/${id}`).then(r => r.data),
    enabled: opened,
  })
  const printRfq = () => openPdf(`/pr/${id}/rfq`)
    .catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the Request for Quotation')))
  const wordRfq = () => downloadFile(`/pr/${id}/rfq/docx`, `RFQ ${pr.pr_number}.docx`)
    .catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not download the Request for Quotation')))

  if (isLoading || !pr) return <div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
  const bidding = !!canvass?.permissions?.bid
  const awarding = !!canvass?.permissions?.award

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <Link to={`/pr/${pr.id}`} className="mt-1 rounded-lg p-1.5 text-[--color-text-muted] hover:bg-[--color-overlay] hover:text-[--color-text-primary]" title="Back to the request">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-ui-xs font-semibold uppercase tracking-wide text-[--color-text-muted]">Canvass &amp; Award</p>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-ui-xl font-bold text-[--color-text-primary]">{pr.pr_number}</h2>
            <PRStatusBadge status={pr.status} />
            <RecanvassBadge count={pr.recanvass_count} />
            <CategoryBadge category={pr.category} />
          </div>
          {pr.title && <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">{pr.title}</p>}
          {pr.mode_of_procurement && <p className="text-ui-xs text-[--color-text-muted] mt-0.5">{pr.mode_of_procurement}</p>}
        </div>
        {canManage && !pr.deleted_at && (
          <div className="flex flex-wrap items-center gap-2">
            <ProcurementActions pr={pr} compact downloadRFQ={printRfq} downloadRFQWord={wordRfq} />
          </div>
        )}
      </div>

      <StepBar status={pr.status} />

      {!opened ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[--color-text-secondary]">
            {pr.status === 'twg_review'
              ? 'The canvass has not started yet. Use Start canvass above, then print the RFQ for the canvasser.'
              : 'This request is not in canvass.'}
          </CardContent>
        </Card>
      ) : (
        <>
          {canManage && canvass && ['bidding', 'twg_certification', 'bac_review'].includes(pr.status) && <ProcurementPart canvass={canvass} onPrintRfq={printRfq} onWordRfq={wordRfq} />}
          <BacPanel prId={String(pr.id)} part="status" />

          {bidding ? <BacBidSheet key={pr.id} pr={pr} canvass={canvass} />
            : awarding ? <BacAwardSheet key={pr.id} pr={pr} canvass={canvass} /> : (
            <>
              <section className="space-y-3">
                <Heading id="winners">Items &amp; winners</Heading>
                <CanvassPanel pr={pr} />
              </section>

              <section className="space-y-3">
                <Heading id="documents">Canvass documents</Heading>
                <p className="flex items-start gap-2 text-xs text-[--color-text-secondary]">
                  <Paperclip className="size-3.5 shrink-0 mt-0.5 text-[--color-text-muted]" />
                  The canvasser's documents the BAC attached: the abstract and the suppliers' RFQs.
                </p>
                <AttachmentsPanel endpoint={`/pr/${pr.id}`} queryKey={`pr-attachments-${pr.id}`}
                  canUpload={canManage && !pr.deleted_at} canDelete={canManage && !pr.deleted_at && !['completed', 'rejected', 'cancelled'].includes(pr.status)}
                  onChange={() => qc.invalidateQueries({ queryKey: ['canvass', String(pr.id)] })} />
              </section>
            </>
          )}

          {bac?.resolutions?.length > 0 && (
            <section className="space-y-3">
              <Heading id="resolutions">BAC resolutions</Heading>
              <BacPanel prId={String(pr.id)} part="resolutions" />
            </section>
          )}

          {bac?.certificates?.length > 0 && (
            <section className="space-y-3">
              <Heading id="certificates">TWG certificates</Heading>
              <TwgCertificates prId={String(pr.id)} />
            </section>
          )}
        </>
      )}
    </div>
  )
}

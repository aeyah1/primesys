import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Paperclip, Printer, Send, FileSpreadsheet } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PRStatusBadge, CategoryBadge } from '@/components/shared/StatusBadge'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { useAuth } from '@/context/AuthContext'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'
import CanvassPanel from '@/components/awards/CanvassPanel'
import BacPanel from '@/components/awards/BacPanel'
import { useRefreshAwards } from '@/components/awards/supplier'
import ProcurementActions from './ProcurementActions'

// The steps of a canvass result, from the canvass to the purchase orders.
const STEPS = [
  { key: 'bidding',           label: 'Canvass' },
  { key: 'bac_review',        label: 'BAC review' },
  { key: 'twg_certification', label: 'TWG certification' },
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

/* Procurement's four steps while the request is in canvass, each with where it
   stands and what to do: print the RFQ, enter the winners, attach the canvass
   documents, submit to the BAC. */
function Checklist({ pr, canvass, bac, onPrintRfq }) {
  const confirm = useConfirm()
  const refresh = useRefreshAwards(String(pr.id))
  const { mutate: submit, isPending: submitting } = useMutation({
    mutationFn: () => api.post(`/bac/${pr.id}/submit`),
    onSuccess: () => { toast.success('Submitted to the BAC for review'); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to submit it'),
  })
  const items = canvass.items.filter(i => i.state !== 'dropped')
  const won = items.filter(i => i.state === 'awarded').length
  const docs = canvass.documents || 0
  const ready = !!bac?.permissions?.submit
  const steps = [
    { title: 'Print the RFQ', text: 'For the canvasser, who canvasses the suppliers on paper.', done: null,
      action: <Button size="sm" variant="outline" className="gap-1.5" onClick={onPrintRfq}><Printer className="size-3.5" /> Print RFQ</Button> },
    { title: 'Enter the winners', text: `${won} of ${items.length} item${items.length === 1 ? ' has its' : 's have their'} winner, from the canvasser's abstract.`, done: items.length > 0 && won === items.length,
      action: <Button size="sm" variant="ghost" asChild className="gap-1.5"><a href="#winners"><FileSpreadsheet className="size-3.5" /> Go to the sheet</a></Button> },
    { title: 'Attach the canvass documents', text: docs ? `${docs} file${docs === 1 ? '' : 's'} attached.` : 'The canvasser\'s RFQs and abstract, scanned.', done: docs > 0,
      action: <Button size="sm" variant="ghost" asChild className="gap-1.5"><a href="#documents"><Paperclip className="size-3.5" /> Attach</a></Button> },
    { title: 'Submit to the BAC', text: ready ? 'Everything is in. The winners lock while the BAC reviews them.' : (bac?.submit_blocked || 'Finish the steps above.'), done: false,
      action: (
        <Button size="sm" className="gap-1.5" disabled={!ready || submitting}
          onClick={async () => { if (await confirm({ title: 'Submit the canvass result to the BAC?', message: 'The winners lock until the BAC approves or returns it.', confirmLabel: 'Submit to the BAC' })) submit() }}>
          <Send className="size-3.5" /> {submitting ? 'Submitting…' : 'Submit to the BAC'}
        </Button>
      ) },
  ]
  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, k) => (
          <div key={s.title} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                s.done ? 'bg-emerald-600 text-white' : 'border border-[--color-border-strong] text-[--color-text-secondary]'}`}>
                {s.done ? <Check className="size-3.5" /> : k + 1}
              </span>
              <p className="text-sm font-semibold text-[--color-text-primary]">{s.title}</p>
            </div>
            <p className="text-xs text-[--color-text-secondary] flex-1">{s.text}</p>
            <div>{s.action}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

const Heading = ({ id, children }) => <h3 id={id} className="scroll-mt-20 text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">{children}</h3>

// A request's canvass on a page of its own. The canvass is done outside the
// system; here Procurement enters its winners on one sheet and attaches its
// documents, the BAC reviews it, and the TWG certifies it. The request page links here.
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
  const pdf = (endpoint, label) => openPdf(endpoint)
    .catch(async (err) => toast.error(await blobErrorMessage(err, `Could not open the ${label}`)))
  const printRfq = () => pdf(`/pr/${id}/rfq`, 'Request for Quotation')

  if (isLoading || !pr) return <div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
  const inCanvass = pr.status === 'bidding'

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
            <CategoryBadge category={pr.category} />
          </div>
          {pr.title && <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">{pr.title}</p>}
          {pr.mode_of_procurement && <p className="text-ui-xs text-[--color-text-muted] mt-0.5">{pr.mode_of_procurement}</p>}
        </div>
        {canManage && !pr.deleted_at && (
          <div className="flex flex-wrap items-center gap-2">
            <ProcurementActions pr={pr} compact downloadRFQ={printRfq} />
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
          {inCanvass && canManage && canvass && <Checklist pr={pr} canvass={canvass} bac={bac} onPrintRfq={printRfq} />}
          <BacPanel prId={String(pr.id)} part="status" />

          <section className="space-y-3">
            <Heading id="winners">Items &amp; winners</Heading>
            <CanvassPanel pr={pr} />
          </section>

          <section className="space-y-3">
            <Heading id="documents">Canvass documents</Heading>
            <p className="flex items-start gap-2 text-xs text-[--color-text-secondary]">
              <Paperclip className="size-3.5 shrink-0 mt-0.5 text-[--color-text-muted]" />
              The canvasser's RFQs and abstract, scanned. The BAC and the TWG review the winners against them.
            </p>
            <AttachmentsPanel endpoint={`/pr/${pr.id}`} queryKey={`pr-attachments-${pr.id}`}
              canUpload={canManage && !pr.deleted_at} canDelete={canManage && !pr.deleted_at && !['completed', 'rejected', 'cancelled'].includes(pr.status)}
              onChange={() => { qc.invalidateQueries({ queryKey: ['bac', 'pr', String(pr.id)] }); qc.invalidateQueries({ queryKey: ['canvass', String(pr.id)] }) }} />
          </section>

          {bac?.resolutions?.length > 0 && (
            <section className="space-y-3">
              <Heading id="resolutions">BAC resolutions</Heading>
              <BacPanel prId={String(pr.id)} part="resolutions" />
            </section>
          )}
        </>
      )}
    </div>
  )
}

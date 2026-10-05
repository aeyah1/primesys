import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Paperclip } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PRStatusBadge, CategoryBadge } from '@/components/shared/StatusBadge'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import { useAuth } from '@/context/AuthContext'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'
import CanvassPanel from '@/components/awards/CanvassPanel'
import BacPanel from '@/components/awards/BacPanel'
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

const TABS = [
  { key: 'winners',     label: 'Items & Winners' },
  { key: 'documents',   label: 'Canvass Documents' },
  { key: 'resolutions', label: 'BAC Resolutions' },
]

// A request's canvass on a page of its own. The canvass is done outside the
// system; here Procurement records its winners and attaches its documents, the
// BAC reviews it, and the TWG certifies it. The request page links here.
export default function CanvassPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const qc = useQueryClient()
  const canManage = ['admin', 'procurement'].includes(user?.role)
  const [params, setParams] = useSearchParams()
  const tab = TABS.find(t => t.key === params.get('tab'))?.key || 'winners'

  const { data: pr, isLoading } = useQuery({
    queryKey: ['pr', id],
    queryFn: () => api.get(`/pr/${id}`).then(r => r.data),
  })
  const pdf = (endpoint, label) => openPdf(endpoint)
    .catch(async (err) => toast.error(await blobErrorMessage(err, `Could not open the ${label}`)))

  if (isLoading || !pr) return <div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
  const opened = !['draft', 'submitted', 'revision_requested', 'twg_review', 'rejected'].includes(pr.status)

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
            <ProcurementActions pr={pr} compact downloadRFQ={() => pdf(`/pr/${pr.id}/rfq`, 'Request for Quotation')} />
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
          <BacPanel prId={String(pr.id)} part="status" />

          <div className="flex items-center gap-1 border-b border-[--color-border] overflow-x-auto">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setParams({ tab: t.key }, { replace: true })}
                className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                  tab === t.key ? 'border-[--color-brand] text-[--color-brand]' : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'winners' && <CanvassPanel pr={pr} />}
          {tab === 'documents' && (
            <div className="space-y-3">
              <p className="flex items-start gap-2 text-sm text-[--color-text-secondary]">
                <Paperclip className="size-4 shrink-0 mt-0.5 text-[--color-text-muted]" />
                The canvasser's RFQs and abstract, scanned. The BAC and the TWG review the winners against them.
              </p>
              <AttachmentsPanel endpoint={`/pr/${pr.id}`} queryKey={`pr-attachments-${pr.id}`}
                canUpload={canManage && !pr.deleted_at} canDelete={canManage && !pr.deleted_at && !['completed', 'rejected', 'cancelled'].includes(pr.status)}
                onChange={() => qc.invalidateQueries({ queryKey: ['bac', 'pr', String(pr.id)] })} />
            </div>
          )}
          {tab === 'resolutions' && <BacPanel prId={String(pr.id)} part="resolutions" />}
        </>
      )}
    </div>
  )
}

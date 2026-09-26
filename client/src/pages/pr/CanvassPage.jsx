import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Check, FileDown } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PRStatusBadge, CategoryBadge } from '@/components/shared/StatusBadge'
import { useAuth } from '@/context/AuthContext'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'
import CanvassPanel from '@/components/awards/CanvassPanel'
import BacPanel from '@/components/awards/BacPanel'
import ProcurementActions from './ProcurementActions'

// Where a request is in its canvass: which step, in the order the law sets.
function steps(pr, bacOn) {
  const list = [
    { key: 'quotations', label: 'Quotations' },
    ...(bacOn ? [{ key: 'bac', label: 'BAC evaluation' }] : []),
    { key: 'award', label: 'Award' },
    { key: 'po', label: 'Purchase orders' },
  ]
  const at = pr.status === 'for_po' || pr.status === 'completed' ? 'po'
    : pr.status === 'bidding' && pr.bac_submitted_at ? 'bac'
    : pr.status === 'bidding' && !bacOn && !pr.quotations_due ? 'award'
    : 'quotations'
  const index = pr.status === 'completed' ? list.length : list.findIndex(s => s.key === at)
  return { list, index }
}

function StepBar({ pr, bacOn }) {
  const { list, index } = steps(pr, bacOn)
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {list.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
            i < index ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
              : i === index ? 'border-[--color-brand] bg-[--color-brand] text-white'
              : 'border-[--color-border] bg-white text-[--color-text-muted]'}`}>
            {i < index ? <Check className="size-3" /> : <span>{i + 1}</span>} {s.label}
          </span>
          {i < list.length - 1 && <span className="h-px w-4 bg-[--color-border-strong]" />}
        </li>
      ))}
    </ol>
  )
}

const TABS = [
  { key: 'quotations', label: 'Quotations' },
  { key: 'award',      label: 'Items & Award' },
  { key: 'resolutions', label: 'BAC Resolutions', bacOnly: true },
]

// A request's canvass on a page of its own: the schedule and quotations, the
// BAC's evaluation, the award, and the resolutions. The request page keeps a
// summary and links here.
export default function CanvassPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const canManage = ['admin', 'procurement'].includes(user?.role)
  const [params, setParams] = useSearchParams()

  const { data: pr, isLoading } = useQuery({
    queryKey: ['pr', id],
    queryFn: () => api.get(`/pr/${id}`).then(r => r.data),
  })
  const { data: bac } = useQuery({
    queryKey: ['bac', 'pr', id],
    queryFn: () => api.get(`/bac/${id}`).then(r => r.data),
  })
  const bacOn = !!bac?.required || !!bac?.resolutions?.length
  const tabs = TABS.filter(t => !t.bacOnly || bacOn)
  // The BAC starts on the award (its work); everyone else on the quotations.
  const tab = tabs.find(t => t.key === params.get('tab'))?.key || (user?.role === 'bac' ? 'award' : 'quotations')

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
        <div className="flex flex-wrap items-center gap-2">
          {user?.role === 'bac' && opened && (
            <button onClick={() => pdf(`/lots/pr/${pr.id}/pdf`, 'Abstract of Quotations')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[--color-border] text-xs font-medium text-[--color-text-secondary] hover:text-[--color-brand] hover:border-[--color-brand] transition-colors">
              <FileDown className="size-3.5" /> Abstract
            </button>
          )}
          {canManage && !pr.deleted_at && (
            <ProcurementActions pr={pr} compact
              downloadRFQ={() => pdf(`/pr/${pr.id}/rfq`, 'Request for Quotation')}
              downloadAbstract={() => pdf(`/lots/pr/${pr.id}/pdf`, 'Abstract of Quotations')} />
          )}
        </div>
      </div>

      <StepBar pr={pr} bacOn={bacOn} />

      {!opened ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[--color-text-secondary]">
            {pr.status === 'twg_review'
              ? 'This request has not been opened for quotations yet. Use Open for quotations above.'
              : 'This request is not under canvass.'}
          </CardContent>
        </Card>
      ) : (
        <>
          <BacPanel prId={String(pr.id)} part="status" />

          <div className="flex items-center gap-1 border-b border-[--color-border] overflow-x-auto">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setParams({ tab: t.key }, { replace: true })}
                className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                  tab === t.key ? 'border-[--color-brand] text-[--color-brand]' : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'resolutions'
            ? <BacPanel prId={String(pr.id)} part="resolutions" />
            : <CanvassPanel pr={pr} view={tab} />}
        </>
      )}
    </div>
  )
}

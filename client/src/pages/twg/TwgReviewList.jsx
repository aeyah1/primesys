import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, ClipboardCheck, ShieldCheck, ChevronRight, CheckCircle2, AlertTriangle, History } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { PRStatusBadge, CategoryBadge, RecanvassBadge } from '@/components/shared/StatusBadge'
import { FilterChip } from '@/components/shared/ListParts'
import { fmtDatetime, CATEGORY_LABELS, plural, daysSince } from '@/lib/utils'
import api from '@/lib/axios'

// The signed-in member's review areas (admins: all). A TWG member's queue
// holds only PRs in these categories; the admin assigns them.
export function useTwgAreas() {
  return useQuery({
    queryKey: ['twg', 'areas'],
    queryFn: () => api.get('/twg/areas').then(r => r.data),
    staleTime: 60_000,
  })
}

export const areasText = (areasInfo) => !areasInfo ? ''
  : areasInfo.all ? 'All areas (administrator)'
  : areasInfo.areas.map(a => CATEGORY_LABELS[a]).join(', ')

// The two things the TWG decides: a request before the canvass, and the canvass result after the BAC.
const STAGES = [
  { key: 'review',  label: 'To review',  icon: ClipboardCheck, what: 'Requests to check before the canvass', action: 'Review request',
    empty: 'No purchase request in your areas is waiting for the TWG\'s review.' },
  { key: 'certify', label: 'To certify', icon: ShieldCheck, what: 'Canvass results to evaluate and certify', action: 'Evaluate bids',
    empty: 'No canvass result in your areas is waiting for the TWG\'s certification.' },
]

// How many wait at a stage and since when (the list is oldest first), in the chosen area.
function useStageCount(stage, area, enabled) {
  return useQuery({
    queryKey: ['twg', 'pending', 'count', { stage, area }],
    queryFn: () => api.get(`/twg/pending?${new URLSearchParams({ stage, limit: '1', ...(area ? { category: area } : {}) })}`)
      .then(r => ({ total: Number(r.data.total), oldest: r.data.data[0]?.submitted_at ?? null })),
    enabled,
  })
}

// One stage as a panel: what it holds, how many wait, how long the oldest has waited.
function StagePanel({ stage, count, active, onClick }) {
  const Icon = stage.icon
  const days = count?.oldest ? daysSince(count.oldest) : null
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`rounded-xl border bg-[--color-surface] p-5 text-left shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:-translate-y-0.5 ${
        active ? 'border-[--color-brand] ring-1 ring-[--color-brand]' : 'border-[--color-border] hover:border-[--color-border-strong]'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-xs font-semibold uppercase tracking-widest ${active ? 'text-[--color-brand]' : 'text-[--color-text-secondary]'}`}>{stage.label}</p>
          <p className="text-ui-sm text-[--color-text-secondary] mt-1">{stage.what}</p>
        </div>
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
          active ? 'bg-[--color-brand] text-white' : 'bg-[--color-brand-light] text-[--color-brand]'}`}>
          <Icon className="size-5" />
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className={`text-ui-2xl font-bold leading-none tabular-nums ${count?.total ? 'text-[--color-brand]' : 'text-[--color-text-muted]'}`}>
          {count ? count.total : '-'}
          <span className="ml-1.5 text-ui-sm font-medium text-[--color-text-secondary]">waiting</span>
        </p>
        <p className={`text-xs ${days >= 3 ? 'font-semibold text-amber-700' : 'text-[--color-text-muted]'}`}>
          {!count?.total ? 'Nothing waiting' : days === 0 ? 'Oldest sent today' : `Oldest waiting ${plural(days, 'day')}`}
        </p>
      </div>
    </button>
  )
}

export default function TwgReviewList() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [area, setArea]     = useState('')
  const { data: areasInfo } = useTwgAreas()
  const myAreas = areasInfo?.areas ?? []
  const noAreas = areasInfo && !areasInfo.all && myAreas.length === 0

  const reviewCount  = useStageCount('review', area, !noAreas)
  const certifyCount = useStageCount('certify', area, !noAreas)
  const counted = reviewCount.isSuccess && certifyCount.isSuccess
  // Opens on the stage with work: To certify when nothing waits for review but a canvass result does.
  const asked = ['review', 'certify'].includes(params.get('stage')) ? params.get('stage') : null
  const stage = asked || (counted && !reviewCount.data.total && certifyCount.data.total ? 'certify' : 'review')
  const current = STAGES.find(s => s.key === stage)
  const other = STAGES.find(s => s.key !== stage)
  const otherWaiting = (other.key === 'review' ? reviewCount : certifyCount).data?.total || 0

  const { data, isLoading } = useQuery({
    queryKey: ['twg', 'pending', { search, area, stage }],
    queryFn: () => {
      const q = new URLSearchParams({ stage })
      if (search) q.set('search', search)
      if (area)   q.set('category', area)
      return api.get(`/twg/pending?${q}`).then(r => r.data)
    },
    enabled: !noAreas && (!!asked || counted),
  })

  const items = data?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">TWG Review Queue</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            {areasInfo && !noAreas
              ? <>Your review areas: <span className="font-medium text-[--color-text-primary]">{areasText(areasInfo)}</span></>
              : 'Purchase Requests awaiting specification review'}
          </p>
        </div>
        <div className="relative max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input
            placeholder="Search by PR number or title…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {!noAreas && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {STAGES.map(s => (
            <StagePanel key={s.key} stage={s} active={stage === s.key}
              count={(s.key === 'review' ? reviewCount : certifyCount).data}
              onClick={() => setParams({ stage: s.key }, { replace: true })} />
          ))}
        </div>
      )}

      {/* One chip per review area (only worth showing with more than one) */}
      {myAreas.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {['', ...myAreas].map(a => (
            <FilterChip key={a || 'all'} active={area === a} onClick={() => setArea(a)}>
              {a ? CATEGORY_LABELS[a] : 'All my areas'}
            </FilterChip>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {noAreas
            ? (
              <div className="px-6 py-16 text-center">
                <AlertTriangle className="size-10 text-amber-500 mx-auto mb-3" />
                <p className="text-ui-sm font-semibold text-[--color-text-primary]">No review areas assigned yet</p>
                <p className="text-ui-xs text-[--color-text-muted] mt-1">
                  PRs reach you by category. Ask the administrator to assign your review areas in User Management.
                </p>
              </div>
            )
            : isLoading || (!asked && !counted)
            ? <div className="p-6 space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            : !items.length
              ? (
                <div className="px-6 py-16 text-center">
                  <CheckCircle2 className="size-10 text-[--color-text-muted] mx-auto mb-3" />
                  <p className="text-ui-sm font-semibold text-[--color-text-primary]">Nothing {stage === 'certify' ? 'to certify' : 'to review'} right now</p>
                  <p className="text-ui-xs text-[--color-text-muted] mt-1">{current.empty}</p>
                  {otherWaiting > 0 && (
                    <button type="button" onClick={() => setParams({ stage: other.key }, { replace: true })}
                      className="mt-4 inline-flex items-center gap-1 rounded-md border border-[--color-brand] px-3 py-1.5 text-xs font-semibold text-[--color-brand] transition-colors hover:bg-[--color-brand-light]">
                      {other.label}: {otherWaiting} waiting <ChevronRight className="size-3.5" />
                    </button>
                  )}
                </div>
              )
              : items.map(pr => (
                <Link key={pr.id} to={`/twg/reviews/${pr.id}`}
                  className="group block px-6 py-4 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{pr.pr_number}</span>
                        <PRStatusBadge status={pr.status} />
                        <RecanvassBadge count={pr.recanvass_count} />
                        <CategoryBadge category={pr.category} />
                        {pr.uncovered && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                            <AlertTriangle className="size-3" /> No reviewer for this area
                          </span>
                        )}
                      </div>
                      {pr.title && (
                        <p className="text-ui-sm text-[--color-text-primary] mt-1 line-clamp-2">{pr.title}</p>
                      )}
                      <p className="text-[10px] text-[--color-text-muted] mt-1.5">
                        Requested by <span className="font-medium text-[--color-text-secondary]">{pr.created_by_name}</span>
                        {' · '}
                        <span>{pr.item_count} item{pr.item_count === 1 ? '' : 's'}</span>
                        {' · '}
                        {stage === 'certify'
                          ? <>Bids sent by the BAC {fmtDatetime(pr.submitted_at)}{Number(pr.bidders) > 0 && <> · {pr.bidders} bidder{Number(pr.bidders) === 1 ? '' : 's'}</>}</>
                          : <>Submitted {fmtDatetime(pr.submitted_at)}</>}
                      </p>
                      {stage === 'review' && pr.last_reviewer_name && (
                        <p className="flex items-center gap-1 text-[10px] font-medium text-amber-700 mt-1">
                          <History className="size-3" /> Resubmitted after a review by {pr.last_reviewer_name}
                        </p>
                      )}
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[--color-border-strong] bg-[--color-surface] px-3 py-1.5 text-xs font-semibold text-[--color-brand] transition-colors group-hover:border-[--color-brand] group-hover:bg-[--color-brand-light]">
                      {current.action} <ChevronRight className="size-3.5" />
                    </span>
                  </div>
                </Link>
              ))
          }
        </CardContent>
      </Card>
    </div>
  )
}

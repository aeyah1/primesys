import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, ClipboardCheck, ChevronRight, CheckCircle2, AlertTriangle, History } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { PRStatusBadge, CategoryBadge } from '@/components/shared/StatusBadge'
import { fmtDatetime, CATEGORY_LABELS } from '@/lib/utils'
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

export default function TwgReviewList() {
  const [search, setSearch] = useState('')
  const [area, setArea]     = useState('')
  const { data: areasInfo } = useTwgAreas()
  const myAreas = areasInfo?.areas ?? []
  const noAreas = areasInfo && !areasInfo.all && myAreas.length === 0

  const { data, isLoading } = useQuery({
    queryKey: ['twg', 'pending', { search, area }],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (area)   params.set('category', area)
      return api.get(`/twg/pending?${params}`).then(r => r.data)
    },
    enabled: !noAreas,
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

      {/* One chip per review area (only worth showing with more than one) */}
      {myAreas.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {['', ...myAreas].map(a => (
            <button key={a || 'all'} onClick={() => setArea(a)}
              className={`rounded-full border px-3 py-1 text-ui-xs font-medium transition-colors ${
                area === a
                  ? 'border-[--color-brand] bg-[--color-brand] text-white'
                  : 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'
              }`}>
              {a ? CATEGORY_LABELS[a] : 'All my areas'}
            </button>
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
            : isLoading
            ? <div className="p-6 space-y-3">{Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            : !items.length
              ? (
                <div className="px-6 py-16 text-center">
                  <CheckCircle2 className="size-10 text-[--color-text-muted] mx-auto mb-3" />
                  <p className="text-ui-sm font-semibold text-[--color-text-primary]">All caught up</p>
                  <p className="text-ui-xs text-[--color-text-muted] mt-1">
                    No purchase requests in your areas are awaiting TWG review right now.
                  </p>
                </div>
              )
              : items.map(pr => (
                <Link key={pr.id} to={`/twg/reviews/${pr.id}`}
                  className="block px-6 py-4 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{pr.pr_number}</span>
                        <PRStatusBadge status={pr.status} />
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
                        Submitted {fmtDatetime(pr.submitted_at)}
                      </p>
                      {pr.last_reviewer_name && (
                        <p className="flex items-center gap-1 text-[10px] font-medium text-amber-700 mt-1">
                          <History className="size-3" /> Resubmitted after a review by {pr.last_reviewer_name}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <ClipboardCheck className="size-4 text-[--color-brand]" />
                      <ChevronRight className="size-4 text-[--color-text-muted]" />
                    </div>
                  </div>
                </Link>
              ))
          }
        </CardContent>
      </Card>
    </div>
  )
}

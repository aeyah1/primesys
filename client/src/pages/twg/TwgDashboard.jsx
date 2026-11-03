import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  ClipboardCheck, Clock, CheckCircle2, RotateCcw, XCircle, ChevronRight, Timer, AlertTriangle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import { EmptyState } from '@/components/shared/ListParts'
import { DashboardHeader } from '@/components/dashboard/DashboardParts'
import MyTasks from '@/components/dashboard/MyTasks'
import { fmtDatetime, CATEGORY_LABELS } from '@/lib/utils'
import api from '@/lib/axios'

// The member's review areas (GET /twg/areas), and them in words.
function useTwgAreas() {
  return useQuery({
    queryKey: ['twg', 'areas'],
    queryFn: () => api.get('/twg/areas').then(r => r.data),
    staleTime: 60_000,
  })
}
const areasText = (areasInfo) => !areasInfo ? ''
  : areasInfo.all ? 'All areas (administrator)'
  : areasInfo.areas.map(a => CATEGORY_LABELS[a]).join(', ')

// The TWG's home: what needs it (MyTasks: reviews and offer checks in its areas), its counts, and its latest decisions.
export default function TwgDashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['twg', 'stats'],
    queryFn: () => api.get('/twg/stats').then(r => r.data),
  })

  const { data: recent = [], isLoading: recentLoading } = useQuery({
    queryKey: ['twg', 'recent'],
    queryFn: () => api.get('/twg/recent').then(r => r.data),
  })

  const avgHours = stats?.avg_review_hours
  const { data: areasInfo } = useTwgAreas()
  const noAreas = areasInfo && !areasInfo.all && areasInfo.areas.length === 0

  return (
    <div className="space-y-6">
      <DashboardHeader sub={areasInfo && !noAreas
        ? <>Reviewing requests in: <span className="font-medium text-[--color-text-primary]">{areasText(areasInfo)}</span></>
        : 'Check the specifications of each request, then the offers of each canvass sent to you.'} />

      {noAreas && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
          <AlertTriangle className="size-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-900">No review areas assigned yet</p>
            <p className="text-ui-xs text-amber-800 mt-0.5">
              PRs reach TWG members by category. Ask the administrator to assign your review areas in User Management.
            </p>
          </div>
        </div>
      )}

      <MyTasks />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        <StatsCard
          title="Pending Review"
          value={statsLoading ? '…' : (stats?.pending ?? 0)}
          icon={Clock}
          color="amber"
          sub={`in your areas, plus ${stats?.certify_pending ?? 0} to certify`}
        />
        <StatsCard
          title="Approved (7 days)"
          value={statsLoading ? '…' : (stats?.approved_week ?? 0)}
          icon={CheckCircle2}
          color="green"
          sub={`${stats?.approved_total ?? 0} all-time`}
        />
        <StatsCard
          title="Revisions Requested (7 days)"
          value={statsLoading ? '…' : (stats?.revised_week ?? 0)}
          icon={RotateCcw}
          color="blue"
          sub={`${stats?.revision_requested_total ?? 0} currently in revision`}
        />
        <StatsCard
          title="Avg Review Time"
          value={statsLoading || avgHours == null ? '…' : avgHours}
          icon={Timer}
          color="brand"
          sub={avgHours == null ? 'no decisions yet' : 'hours, from submission to the decision'}
        />
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle>Recently reviewed</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentLoading
              ? <div className="p-4 space-y-2">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              : !recent.length
                ? <EmptyState
                    icon={ClipboardCheck}
                    title="No reviews yet"
                    sub="Your approvals, revision requests and certifications will appear here."
                  />
                : recent.map(log => (
                  <Link key={log.id} to={`/pr/${log.pr_id}`}
                    className="block px-5 py-3 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold text-[--color-brand]">{log.pr_number}</span>
                          {log.to_status === 'twg_review' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] text-emerald-700 font-semibold"><CheckCircle2 className="size-2.5" /> Approved</span>
                          )}
                          {log.to_status === 'revision_requested' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] text-amber-700 font-semibold"><RotateCcw className="size-2.5" /> Revision</span>
                          )}
                          {log.from_status === 'twg_certification' && ['bac_review', 'for_po'].includes(log.to_status) && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] text-blue-700 font-semibold"><CheckCircle2 className="size-2.5" /> Certified</span>
                          )}
                          {log.from_status === 'twg_certification' && log.to_status === 'bidding' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] text-amber-700 font-semibold"><RotateCcw className="size-2.5" /> {/^Re-canvass/.test(log.note || '') ? 'Re-canvass' : 'Returned to Procurement'}</span>
                          )}
                          {log.from_status === 'twg_certification' && log.to_status === 're_pr' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-300 px-2 py-0.5 text-[10px] text-red-700 font-semibold"><RotateCcw className="size-2.5" /> Re-PR</span>
                          )}
                          {log.to_status === 'rejected' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] text-red-700 font-semibold"><XCircle className="size-2.5" /> Rejected</span>
                          )}
                        </div>
                        {log.title && (
                          <p className="text-[10px] text-[--color-text-secondary] mt-0.5 truncate">{log.title}</p>
                        )}
                        <p className="text-[10px] text-[--color-text-muted] mt-0.5">{fmtDatetime(log.created_at)}</p>
                      </div>
                      <ChevronRight className="size-4 text-[--color-text-muted] shrink-0 mt-0.5" />
                    </div>
                  </Link>
                ))
            }
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

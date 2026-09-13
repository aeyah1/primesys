import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  ClipboardCheck, Clock, CheckCircle2, RotateCcw, XCircle, ChevronRight, Timer, AlertTriangle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import { PRStatusBadge, CategoryBadge } from '@/components/shared/StatusBadge'
import { fmtDatetime, CATEGORY_LABELS } from '@/lib/utils'
import { useTwgAreas, areasText } from './TwgReviewList'
import api from '@/lib/axios'

function Empty({ icon: Icon, title, sub }) {
  return (
    <div className="px-6 py-12 text-center">
      <Icon className="size-8 text-[--color-text-muted] mx-auto mb-3" />
      <p className="text-ui-sm font-semibold text-[--color-text-primary]">{title}</p>
      {sub && <p className="text-ui-xs text-[--color-text-muted] mt-1">{sub}</p>}
    </div>
  )
}

export default function TwgDashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['twg', 'stats'],
    queryFn: () => api.get('/twg/stats').then(r => r.data),
  })

  const { data: pendingRes, isLoading: pendingLoading } = useQuery({
    queryKey: ['twg', 'pending', { limit: 5 }],
    queryFn: () => api.get('/twg/pending?limit=5').then(r => r.data),
  })

  const { data: recent = [], isLoading: recentLoading } = useQuery({
    queryKey: ['twg', 'recent'],
    queryFn: () => api.get('/twg/recent').then(r => r.data),
  })

  const pending = pendingRes?.data ?? []
  const avgHours = stats?.avg_review_hours
  const { data: areasInfo } = useTwgAreas()
  const noAreas = areasInfo && !areasInfo.all && areasInfo.areas.length === 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">Technical Working Group</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            {areasInfo && !noAreas
              ? <>Reviewing PRs in: <span className="font-medium text-[--color-text-primary]">{areasText(areasInfo)}</span></>
              : 'Review submitted Purchase Request specifications and approve or send back for revision'}
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link to="/twg/reviews"><ClipboardCheck className="size-4" /> Review Queue</Link>
        </Button>
      </div>

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        <StatsCard
          title="Pending Review"
          value={statsLoading ? '—' : (stats?.pending ?? 0)}
          icon={Clock}
          color="amber"
          sub="in your review areas"
        />
        <StatsCard
          title="Approved (7 days)"
          value={statsLoading ? '—' : (stats?.approved_week ?? 0)}
          icon={CheckCircle2}
          color="green"
          sub={`${stats?.approved_total ?? 0} all-time`}
        />
        <StatsCard
          title="Revisions Requested (7 days)"
          value={statsLoading ? '—' : (stats?.revised_week ?? 0)}
          icon={RotateCcw}
          color="violet"
          sub={`${stats?.revision_requested_total ?? 0} currently in revision`}
        />
        <StatsCard
          title="Avg Review Time"
          value={statsLoading || avgHours == null ? '—' : `${avgHours}h`}
          icon={Timer}
          color="brand"
          sub="across all TWG actions"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Pending Reviews</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/twg/reviews">View all</Link>
            </Button>
          </CardHeader>
          {/* Waiting per review area */}
          {stats?.pending_by_area?.length > 1 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-6 pb-3 text-ui-xs text-[--color-text-secondary]">
              {stats.pending_by_area.map(a => (
                <span key={a.category}>
                  {CATEGORY_LABELS[a.category]}: <span className={`font-semibold ${a.pending ? 'text-[--color-text-primary]' : 'text-[--color-text-muted]'}`}>{a.pending}</span>
                </span>
              ))}
            </div>
          )}
          <CardContent className="p-0">
            {pendingLoading
              ? <div className="p-6 space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
              : !pending.length
                ? <Empty
                    icon={CheckCircle2}
                    title="Queue is clear"
                    sub="No purchase requests awaiting TWG review right now."
                  />
                : pending.map(pr => (
                  <Link key={pr.id} to={`/twg/reviews/${pr.id}`}
                    className="block px-6 py-3.5 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{pr.pr_number}</span>
                          <PRStatusBadge status={pr.status} />
                          <CategoryBadge category={pr.category} />
                        </div>
                        {pr.title && (
                          <p className="text-ui-xs text-[--color-text-secondary] mt-0.5 truncate">{pr.title}</p>
                        )}
                        <p className="text-[10px] text-[--color-text-muted] mt-0.5">
                          By {pr.created_by_name} · {pr.item_count} item{pr.item_count === 1 ? '' : 's'} · Submitted {fmtDatetime(pr.submitted_at)}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-[--color-text-muted] shrink-0 mt-1" />
                    </div>
                  </Link>
                ))
            }
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recently Reviewed</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentLoading
              ? <div className="p-4 space-y-2">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              : !recent.length
                ? <Empty
                    icon={ClipboardCheck}
                    title="No reviews yet"
                    sub="Your approvals and revision requests will appear here."
                  />
                : recent.map(log => (
                  <Link key={log.id} to={`/twg/reviews/${log.pr_id}`}
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

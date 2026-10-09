import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, ChevronRight, AlertCircle, Clock, CheckCircle2, Wallet } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PRStatusBadge, MarkerBadges } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/ListParts'
import { DashboardHeader, StatLink, ListSkeleton, WaitingCard, useDashboard } from '@/components/dashboard/DashboardParts'
import { useAuth } from '@/context/AuthContext'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

const IN_PROGRESS = ['submitted', 'twg_review', 'bidding', 'twg_certification', 'bac_review', 're_pr', 'for_po']
// Where the requests are, in the order they move; "sent back" waits on the Fund Administrator.
const PIPELINE = [
  { label: 'Not sent yet',       statuses: ['draft'] },
  { label: 'Sent back to you',   statuses: ['revision_requested'], action: true },
  { label: 'With the TWG',       statuses: ['submitted'] },
  { label: 'Finding a supplier', statuses: ['twg_review', 'bidding', 'twg_certification', 'bac_review', 're_pr'] },
  { label: 'Being ordered',      statuses: ['for_po'] },
  { label: 'Delivered',          statuses: ['completed'] },
]

// A Fund Administrator's home: what needs them, where their requests are, and what waits longest.
export default function RequestorDashboard() {
  const { user } = useAuth()
  const { data: stats } = useQuery({
    queryKey: ['pr-stats'],
    queryFn: () => api.get('/pr/stats').then(r => r.data),
  })
  const { data: attention, isLoading } = useQuery({
    queryKey: ['pr-list', 'requestor-attention'],
    queryFn: () => api.get('/pr?status=draft,revision_requested&limit=5&sort=oldest').then(r => r.data),
  })
  const dash = useDashboard(IN_PROGRESS)

  const sum = (statuses) => statuses.reduce((n, s) => n + (stats?.[s] ?? 0), 0)
  const needsMe = sum(['draft', 'revision_requested'])
  const most = Math.max(...PIPELINE.map(p => sum(p.statuses)), 1)
  const rows = attention?.data ?? []

  return (
    <div className="space-y-6">
      <DashboardHeader sub={`Welcome, ${user?.name}. Here is how your requests are doing.`}>
        <Button asChild className="gap-2"><Link to="/pr/create"><Plus className="size-4" /> New Request</Link></Button>
      </DashboardHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        <StatLink to="/my-requests" title="Needs You" value={needsMe} icon={AlertCircle} color="amber"
          sub="drafts and requests sent back" className={needsMe > 0 ? 'border-amber-300' : ''} />
        <StatLink to="/my-requests?tab=in_progress" title="In Progress" value={sum(IN_PROGRESS)} icon={Clock} color="blue" sub="with the TWG, Procurement or the BAC" />
        <StatLink to="/my-requests?tab=done" title="Completed" value={stats?.completed ?? 0} icon={CheckCircle2} color="green" sub="delivered in full" />
        <StatLink to="/archive" title={`Requested in ${dash.data?.year ?? ''}`} value={dash.data ? fmtCurrency(dash.data.amounts.requested) : '…'}
          icon={Wallet} color="brand" sub="estimate of the requests you sent" />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Needs your attention</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/my-requests">View all</Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? <ListSkeleton />
              : !rows.length ? <EmptyState icon={CheckCircle2} title="Nothing waits for you" sub="Drafts and requests sent back for changes appear here." />
              : rows.map(pr => (
                <Link key={pr.id} to={`/pr/${pr.id}`}
                  className="flex items-center justify-between gap-3 px-6 py-3.5 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                  <div className="min-w-0">
                    <p className="text-ui-sm font-semibold text-[--color-text-primary] truncate">{pr.title || pr.pr_number}</p>
                    <p className="text-ui-xs text-amber-700 mt-0.5 truncate">
                      <span className="font-mono text-[--color-text-muted]">{pr.pr_number}</span> · {pr.status === 'draft'
                        ? 'Not sent yet. Finish it and submit it to the TWG.'
                        : 'Changes were requested. Open it to read why.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <MarkerBadges pr={pr} />
                    <PRStatusBadge status={pr.status} />
                    <ChevronRight className="size-4 text-[--color-text-muted]" />
                  </div>
                </Link>
              ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Where your requests are</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {PIPELINE.map(p => {
              const n = sum(p.statuses)
              return (
                <div key={p.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-ui-sm font-medium text-[--color-text-primary]">{p.label}</span>
                    <span className="text-ui-sm font-bold tabular-nums text-[--color-text-primary]">{n}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[--color-border] overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${p.action ? 'bg-amber-500' : 'bg-[--color-brand]'}`}
                      style={{ width: `${(n / most) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <WaitingCard data={dash.data} isLoading={dash.isLoading} title="Waiting the longest"
        empty="Requests you sent appear here while the TWG, Procurement or the BAC work on them." />
    </div>
  )
}

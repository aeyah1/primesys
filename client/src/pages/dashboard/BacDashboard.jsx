import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Scale, ClipboardCheck, Trophy, FileText, ChevronRight, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/ListParts'
import { DashboardHeader, StatLink, ListSkeleton } from '@/components/dashboard/DashboardParts'
import { fmtCurrency, fmtDate, daysSince, plural } from '@/lib/utils'
import { MarkerBadges } from '@/components/shared/StatusBadge'
import api from '@/lib/axios'

// What the BAC does next with a request in its queue.
const nextStep = (row) => row.status === 'bac_review' ? 'Certified by the TWG: pick the winners'
  : row.status === 're_pr' ? 'Re-PR proposed by the TWG: check it'
  : row.recanvass_reason ? 'Re-canvass ordered by the TWG: enter the new quotations'
  : row.certification_return_reason ? 'Returned by the TWG: correct the bids'
  : 'Enter the bids'

// The BAC's home: its counts, the oldest work first, and the latest resolutions.
export default function BacDashboard() {
  const { data: stats } = useQuery({
    queryKey: ['pr-stats'],
    queryFn: () => api.get('/pr/stats').then(r => r.data),
  })
  const { data: pending, isLoading } = useQuery({
    queryKey: ['bac', 'queue', 'dashboard-pending'],
    queryFn: () => api.get('/bac/queue?view=pending&limit=6').then(r => r.data),
  })
  const { data: approved, isLoading: loadingApproved } = useQuery({
    queryKey: ['bac', 'queue', 'dashboard-approved'],
    queryFn: () => api.get('/bac/queue?view=approved&limit=5').then(r => r.data),
  })
  const rows = pending?.data ?? []
  const resolutions = approved?.data ?? []

  return (
    <div className="space-y-6">
      <DashboardHeader sub="Enter the bids from the returned RFQs and send them to the TWG; once the TWG certifies them, pick the winners.">
        <Button asChild className="gap-2"><Link to="/bac"><Scale className="size-4" /> For Evaluation</Link></Button>
      </DashboardHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        <StatLink to="/bac" title="In Canvass" value={stats?.bidding ?? 0} icon={Scale} color="amber" sub="bids to enter or correct" />
        <StatLink to="/pr?status=twg_certification" title="With the TWG" value={stats?.twg_certification ?? 0} icon={ClipboardCheck} color="teal" sub="checking the offers" />
        <StatLink to="/bac" title="Awards to Make" value={stats?.bac_review ?? 0} icon={Trophy} color="brand" sub="certified by the TWG" />
        <StatLink to="/bac" title="Resolutions" value={pending?.counts?.approved ?? 0} icon={FileText} color="green" sub="adopted so far" />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Oldest first</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/bac">View all</Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? <ListSkeleton />
              : !rows.length ? <EmptyState icon={CheckCircle2} title="All caught up" sub="No request is waiting for the BAC." />
              : rows.map(row => {
                const days = daysSince(row.since)
                return (
                  <Link key={row.id} to={`/pr/${row.id}/canvass`}
                    className="flex items-center justify-between gap-3 px-6 py-3.5 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-ui-sm font-semibold text-[--color-text-primary] min-w-0">
                        <span className="font-mono text-[--color-brand] shrink-0">{row.pr_number}</span>
                        <span className="truncate">{row.title}</span>
                        <MarkerBadges pr={row} />
                      </p>
                      <p className="text-ui-xs mt-0.5 truncate">
                        <span className={`font-semibold ${row.status === 're_pr' ? 'text-red-700' : (row.recanvass_reason || row.certification_return_reason) && row.status === 'bidding' ? 'text-amber-700' : 'text-[--color-brand]'}`}>{nextStep(row)}</span>
                        <span className="text-[--color-text-muted]"> · {Number(row.bidders) ? plural(Number(row.bidders), 'bidder') : 'No bids yet'}</span>
                      </p>
                    </div>
                    <span className={`text-ui-xs whitespace-nowrap ${days > 3 ? 'font-semibold text-amber-700' : 'text-[--color-text-muted]'}`}>{plural(days, 'day')}</span>
                    <ChevronRight className="size-4 text-[--color-text-muted] shrink-0" />
                  </Link>
                )
              })}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Latest resolutions</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loadingApproved ? <ListSkeleton />
              : !resolutions.length ? <EmptyState icon={FileText} title="No resolutions yet" sub="Each award the BAC makes is adopted as a resolution." />
              : resolutions.map(r => (
                <Link key={r.resolution_id} to={`/pr/${r.id}/canvass#resolutions`}
                  className="block px-5 py-3 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ui-sm font-semibold text-[--color-text-primary]">Resolution No. {r.resolution_number}</span>
                    <span className="text-ui-sm font-bold text-[--color-brand]">{fmtCurrency(r.total)}</span>
                  </div>
                  <p className="text-ui-xs text-[--color-text-muted] mt-0.5 truncate">
                    <span className="font-mono">{r.pr_number}</span> · {r.suppliers} · {fmtDate(r.resolved_on)}
                  </p>
                </Link>
              ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

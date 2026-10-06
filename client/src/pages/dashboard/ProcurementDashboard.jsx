import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Gavel, Scale, ClipboardCheck, ShoppingCart, ChevronRight, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CategoryBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/ListParts'
import StartCanvassDialog from '@/components/awards/StartCanvassDialog'
import { DashboardHeader, StatLink, ListSkeleton, WaitingCard, SpendingTrendCard, useDashboard } from '@/components/dashboard/DashboardParts'
import { fmtCurrency, daysSince, plural } from '@/lib/utils'
import api from '@/lib/axios'

// The Work Queue's stages a tile opens (lots.controller STAGES).
const STAGE_TILES = [
  { stage: 'to_canvass',  title: 'To Canvass',   icon: Gavel,          color: 'amber', sub: 'approved by the TWG' },
  { stage: 'needs_award', title: 'With the BAC', icon: Scale,          color: 'blue',  sub: 'bids or award' },
  { stage: 'with_twg',    title: 'With the TWG', icon: ClipboardCheck, color: 'teal',  sub: 'checking the offers' },
  { stage: 'awaiting_po', title: 'Issue PO',     icon: ShoppingCart,   color: 'brand', sub: 'awards without a PO' },
]
// Purchase order views (po.controller VIEWS), the late ones first.
const PO_LINES = [
  { view: 'overdue',  label: 'Overdue',           alert: true },
  { view: 'due_week', label: 'Due this week' },
  { view: 'pending',  label: 'Nothing delivered yet' },
  { view: 'partial',  label: 'Partly delivered' },
]

// Procurement's home: the Work Queue's counts, what to canvass next, purchase orders, and bottlenecks.
export default function ProcurementDashboard() {
  const navigate = useNavigate()
  const [opening, setOpening] = useState(null)   // the request whose canvass is being started
  const { data: queue, isLoading } = useQuery({
    queryKey: ['lot-queue', 'dashboard'],
    queryFn: () => api.get('/lots/queue?stage=to_canvass&limit=5').then(r => r.data),
  })
  const { data: pos } = useQuery({
    queryKey: ['po-list', 'dashboard'],
    queryFn: () => api.get('/po?view=open&limit=1').then(r => r.data),
  })
  const { data: report } = useQuery({
    queryKey: ['reports-summary'],
    queryFn: () => api.get('/reports/summary').then(r => r.data),
  })
  const dash = useDashboard()
  const stages = queue?.counts?.stages ?? {}
  const rows = queue?.data ?? []

  return (
    <div className="space-y-6">
      <DashboardHeader sub="What needs Procurement today: canvasses to start, purchase orders to issue, and deliveries to follow.">
        <Button asChild variant="secondary" className="gap-2"><Link to="/pr">All Requests</Link></Button>
        <Button asChild className="gap-2"><Link to="/bidding"><Gavel className="size-4" /> Work Queue</Link></Button>
      </DashboardHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        {STAGE_TILES.map(t => (
          <StatLink key={t.stage} to={`/bidding?stage=${t.stage}`} title={t.title} value={isLoading ? '…' : stages[t.stage] ?? 0}
            icon={t.icon} color={t.color} sub={t.sub} />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Next to canvass</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/bidding">Open Work Queue</Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? <ListSkeleton />
              : !rows.length ? <EmptyState icon={CheckCircle2} title="Nothing to canvass" sub="Requests the TWG approves appear here, the longest waiting first." />
              : rows.map(pr => {
                const days = daysSince(pr.stage_since)
                return (
                  <div key={pr.id} className="flex items-center justify-between gap-3 px-6 py-3.5 border-b border-[--color-border] last:border-0">
                    <Link to={`/pr/${pr.id}`} className="min-w-0 flex-1 group">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-ui-sm font-bold text-[--color-brand] group-hover:underline">{pr.pr_number}</span>
                        <CategoryBadge category={pr.category} />
                      </div>
                      <p className="text-ui-xs text-[--color-text-secondary] mt-0.5 truncate">
                        {pr.title || 'Untitled request'}
                        <span className="text-[--color-text-muted]"> · {pr.created_by_name}{pr.department ? `, ${pr.department}` : ''}</span>
                      </p>
                    </Link>
                    <span className={`text-ui-xs whitespace-nowrap ${days > 3 ? 'font-semibold text-amber-700' : 'text-[--color-text-muted]'}`}>
                      {plural(days, 'day')}
                    </span>
                    <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setOpening(pr)}>
                      <Gavel className="size-3.5" /> Start canvass
                    </Button>
                  </div>
                )
              })}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Purchase orders</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/po">View all</Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {PO_LINES.map(l => {
              const n = pos?.counts?.[l.view] ?? 0
              return (
                <Link key={l.view} to={`/po?view=${l.view}`}
                  className="flex items-center justify-between px-6 py-3 border-b border-[--color-border] hover:bg-overlay/60 transition-colors">
                  <span className="text-ui-sm text-[--color-text-primary]">{l.label}</span>
                  <span className="flex items-center gap-2">
                    <span className={`text-ui-sm font-bold tabular-nums ${l.alert && n > 0 ? 'text-red-600' : 'text-[--color-text-primary]'}`}>{n}</span>
                    <ChevronRight className="size-4 text-[--color-text-muted]" />
                  </span>
                </Link>
              )
            })}
            <div className="flex items-center justify-between px-6 py-3">
              <span className="text-ui-xs text-[--color-text-muted]">Ordered in {dash.data?.year ?? ''}</span>
              <span className="text-ui-sm font-bold text-[--color-brand]">{dash.data ? fmtCurrency(dash.data.amounts.ordered) : '…'}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <WaitingCard data={dash.data} isLoading={dash.isLoading} className="lg:col-span-3"
          empty="Open requests appear here, the one waiting longest in its stage first." />
        <SpendingTrendCard monthly={report?.monthly} className="lg:col-span-2" />
      </div>

      {opening && (
        <StartCanvassDialog pr={opening} onClose={() => setOpening(null)}
          onStarted={() => navigate(`/pr/${opening.id}/canvass`)} />
      )}
    </div>
  )
}

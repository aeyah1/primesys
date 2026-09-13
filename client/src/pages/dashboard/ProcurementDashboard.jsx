import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  FileText, Gavel, Plus, CheckCircle2, ShoppingCart,
  CalendarDays, ChevronRight, TrendingUp, ClipboardCheck,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import { PRStatusBadge, DeliveryStatusBadge, CategoryBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

const daysSince = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5))

function Empty({ icon: Icon, title, sub, action }) {
  return (
    <div className="px-6 py-14 text-center">
      <Icon className="size-9 text-[--color-text-muted] mx-auto mb-3" />
      <p className="text-ui-sm font-semibold text-[--color-text-primary]">{title}</p>
      {sub && <p className="text-ui-xs text-[--color-text-muted] mt-1 mb-5">{sub}</p>}
      {action && action}
    </div>
  )
}

export default function ProcurementDashboard() {
  const { data: stats } = useQuery({
    queryKey: ['pr-stats'],
    queryFn: () => api.get('/pr/stats').then(r => r.data),
  })

  const { data: recentPRs, isLoading: prsLoading } = useQuery({
    queryKey: ['pr-list', 'proc-dashboard'],
    queryFn: () => api.get('/pr?limit=8').then(r => r.data),
  })

  // Awards waiting for their purchase order (one PO per supplier), oldest first.
  const { data: readyForPO, isLoading: readyLoading } = useQuery({
    queryKey: ['lot-queue', 'proc-dashboard'],
    queryFn: () => api.get('/lots/queue?stage=awaiting_po&limit=6').then(r => r.data),
  })

  const { data: quarters = [] } = useQuery({
    queryKey: ['quarters', 'active'],
    queryFn: () => api.get('/quarters?active_only=true').then(r => r.data),
  })

  const awaitingPO = readyForPO?.data ?? []
  const inProgress = (stats?.bidding ?? 0) + (stats?.for_po ?? 0)
  // Approved by TWG, waiting for canvass, per category: the longest wait first.
  const awaitingCanvass = [...(stats?.awaiting_canvass ?? [])]
    .sort((a, b) => new Date(a.oldest_approved_at) - new Date(b.oldest_approved_at))

  const chartData = [
    { name: 'Draft',     value: stats?.draft               ?? 0 },
    { name: 'At TWG',    value: stats?.submitted           ?? 0 },
    { name: 'Revision',  value: stats?.revision_requested  ?? 0 },
    { name: 'Approved',  value: stats?.twg_review          ?? 0 },
    { name: 'Bidding',   value: stats?.bidding             ?? 0 },
    { name: 'For PO',    value: stats?.for_po              ?? 0 },
    { name: 'Completed', value: stats?.completed           ?? 0 },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">Procurement Dashboard</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            Manage purchase requests, bidding, and delivery
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link to="/pr/create"><Plus className="size-4" /> New PR</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        <StatsCard
          title="Total PRs"
          value={stats?.total ?? 0}
          icon={FileText}
          color="brand"
          sub={`${stats?.draft ?? 0} draft`}
        />
        <StatsCard
          title="Ready to Canvass"
          value={stats?.twg_review ?? 0}
          icon={ClipboardCheck}
          color="blue"
          sub={`${stats?.submitted ?? 0} still at TWG`}
        />
        <StatsCard
          title="In Progress"
          value={inProgress}
          icon={Gavel}
          color="amber"
          sub="bidding + for PO"
        />
        <StatsCard
          title="Completed"
          value={stats?.completed ?? 0}
          icon={CheckCircle2}
          color="green"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Purchase Requests</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/pr">View all</Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {prsLoading
              ? <div className="p-6 space-y-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              : !recentPRs?.data?.length
                ? <Empty
                    icon={FileText}
                    title="No purchase requests yet"
                    sub="Create the first PR to begin the procurement process."
                    action={
                      <Button asChild size="sm">
                        <Link to="/pr/create"><Plus className="size-3.5 mr-1.5" />New PR</Link>
                      </Button>
                    }
                  />
                : recentPRs.data.map(pr => (
                  <Link key={pr.id} to={`/pr/${pr.id}`}
                    className="flex items-center justify-between px-6 py-3.5 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{pr.pr_number}</span>
                        {pr.quarter_label && (
                          <span className="text-[10px] text-[--color-text-muted]">{pr.quarter_label} {pr.quarter_year}</span>
                        )}
                      </div>
                      {pr.title && <p className="text-ui-xs text-[--color-text-secondary] truncate mt-0.5">{pr.title}</p>}
                      <p className="text-[10px] text-[--color-text-muted] mt-0.5">{fmtDate(pr.created_at)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {pr.total_amount
                        ? <span className="text-ui-sm font-bold text-[--color-brand]">{fmtCurrency(pr.total_amount)}</span>
                        : null
                      }
                      <div className="flex items-center gap-1.5">
                        {pr.po_id && <DeliveryStatusBadge status={pr.delivery_status} />}
                        <PRStatusBadge status={pr.status} />
                      </div>
                    </div>
                  </Link>
                ))
            }
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="size-4 text-[--color-text-muted]" />
                <CardTitle>Ready to Canvass</CardTitle>
              </div>
              <Button variant="ghost" size="sm" asChild><Link to="/pr?status=twg_review">View all</Link></Button>
            </CardHeader>
            <CardContent className="p-0">
              {!awaitingCanvass.length
                ? <div className="px-5 py-8 text-center">
                    <ClipboardCheck className="size-7 text-[--color-text-muted] mx-auto mb-2" />
                    <p className="text-ui-xs text-[--color-text-muted]">Nothing approved by the TWG is waiting for canvass</p>
                  </div>
                : awaitingCanvass.map(a => {
                    const days = daysSince(a.oldest_approved_at)
                    return (
                      <Link key={a.category} to={`/pr?status=twg_review&category=${a.category}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                        <div className="min-w-0">
                          <CategoryBadge category={a.category} />
                          <p className={`text-[10px] mt-1 ${days > 3 ? 'text-amber-700 font-medium' : 'text-[--color-text-muted]'}`}>
                            Oldest approval waiting {days} day{days === 1 ? '' : 's'}
                          </p>
                        </div>
                        <span className="flex items-center gap-0.5 text-ui-sm font-bold text-[--color-text-primary] shrink-0">
                          {a.count} <ChevronRight className="size-3.5 text-[--color-text-muted]" />
                        </span>
                      </Link>
                    )
                  })
              }
            </CardContent>
          </Card>

          {quarters.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CalendarDays className="size-4 text-[--color-text-muted]" />
                  <CardTitle>Active Quarter{quarters.length > 1 ? 's' : ''}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pb-4">
                {quarters.slice(0, 3).map(q => (
                  <div key={q.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-ui-sm font-semibold text-[--color-text-primary]">{q.label} {q.year}</span>
                      <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-300 px-2 py-0.5 text-[10px] text-blue-700 font-semibold">
                        Active
                      </span>
                    </div>
                    {q.budget && (
                      <p className="text-ui-xs text-[--color-text-secondary]">Budget: {fmtCurrency(q.budget)}</p>
                    )}
                  </div>
                ))}
                <Button variant="ghost" size="sm" asChild className="w-full">
                  <Link to="/quarters">Manage quarters</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <ShoppingCart className="size-4 text-[--color-text-muted]" />
                <CardTitle>Awaiting Purchase Order</CardTitle>
              </div>
              {readyForPO?.total > 0 && (
                <Button variant="ghost" size="sm" asChild><Link to="/bidding?stage=awaiting_po">View all ({readyForPO.total})</Link></Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {readyLoading
                ? <div className="p-4 space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                : !awaitingPO.length
                  ? <div className="px-5 py-8 text-center">
                      <ShoppingCart className="size-7 text-[--color-text-muted] mx-auto mb-2" />
                      <p className="text-ui-xs text-[--color-text-muted]">No awards are waiting for a purchase order</p>
                    </div>
                  : awaitingPO.map(pr => (
                    <Link key={pr.id} to={`/pr/${pr.id}#purchase-order`}
                      className="flex items-center justify-between px-5 py-3 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors gap-3">
                      <div className="min-w-0">
                        <span className="font-mono text-[10px] font-bold text-[--color-brand]">{pr.pr_number}</span>
                        {pr.suppliers && <p className="text-ui-xs text-[--color-text-secondary] truncate mt-0.5">{pr.suppliers}</p>}
                      </div>
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold text-[--color-brand] shrink-0">
                        Issue PO <ChevronRight className="size-3.5" />
                      </span>
                    </Link>
                  ))
              }
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-[--color-text-muted]" />
            <CardTitle>PR Pipeline Distribution</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} barSize={40}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 13 }} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="hsl(222,62%,24%)" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

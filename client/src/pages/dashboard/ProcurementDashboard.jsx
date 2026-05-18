import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  FileText, Gavel, Plus, Clock, CheckCircle2,
  CalendarDays, ChevronRight, TrendingUp,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import { PRStatusBadge, DeliveryStatusBadge, LotStatusBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

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

  const { data: allLots = [], isLoading: lotsLoading } = useQuery({
    queryKey: ['lots', 'proc-dashboard'],
    queryFn: () => api.get('/lots').then(r => r.data),
  })

  const { data: quarters = [] } = useQuery({
    queryKey: ['quarters', 'active'],
    queryFn: () => api.get('/quarters?active_only=true').then(r => r.data),
  })

  const actionLots = allLots.filter(l => ['open', 'closed'].includes(l.status)).slice(0, 6)
  const inProgress = (stats?.bidding ?? 0) + (stats?.for_po ?? 0)

  const chartData = [
    { name: 'Draft',     value: stats?.draft     ?? 0 },
    { name: 'Submitted', value: stats?.submitted  ?? 0 },
    { name: 'Bidding',   value: stats?.bidding    ?? 0 },
    { name: 'For PO',    value: stats?.for_po     ?? 0 },
    { name: 'Completed', value: stats?.completed  ?? 0 },
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
          title="Submitted"
          value={stats?.submitted ?? 0}
          icon={CalendarDays}
          color="blue"
          sub="awaiting review"
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
                      <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-300 px-2 py-0.5 text-[10px] text-emerald-700 font-semibold">
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
                <Gavel className="size-4 text-[--color-text-muted]" />
                <CardTitle>Lots Needing Action</CardTitle>
              </div>
              <Button variant="ghost" size="sm" asChild><Link to="/bidding">View all</Link></Button>
            </CardHeader>
            <CardContent className="p-0">
              {lotsLoading
                ? <div className="p-4 space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                : !actionLots.length
                  ? <div className="px-5 py-8 text-center">
                      <Gavel className="size-7 text-[--color-text-muted] mx-auto mb-2" />
                      <p className="text-ui-xs text-[--color-text-muted]">All lots are resolved</p>
                    </div>
                  : actionLots.map(lot => (
                    <Link key={lot.id} to="/bidding"
                      className="flex items-center justify-between px-5 py-3 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold text-[--color-brand]">{lot.lot_number}</span>
                          <LotStatusBadge status={lot.status} />
                        </div>
                        {lot.closing_date && (
                          <span className="flex items-center gap-1 text-[10px] text-[--color-text-muted] mt-0.5">
                            <Clock className="size-3" /> Closes {fmtDate(lot.closing_date)}
                          </span>
                        )}
                      </div>
                      <ChevronRight className="size-4 text-[--color-text-muted] shrink-0" />
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
              <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="hsl(145,62%,24%)" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

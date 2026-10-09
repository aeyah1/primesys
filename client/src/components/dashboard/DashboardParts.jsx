import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clock, TrendingUp } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import { PRStatusBadge, RecanvassBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/ListParts'
import { fmtCurrency, plural } from '@/lib/utils'
import api from '@/lib/axios'

// The pieces every role's dashboard shares.

// This year's amounts and the requests waiting longest (GET /dashboard); `statuses` narrows the waiting list.
export function useDashboard(statuses) {
  return useQuery({
    queryKey: ['dashboard', statuses?.join(',') || 'all'],
    queryFn: () => api.get(`/dashboard${statuses ? `?statuses=${statuses.join(',')}` : ''}`).then(r => r.data),
  })
}

// A dashboard's title row, with its main actions on the right.
export function DashboardHeader({ title = 'Dashboard', sub, children }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">{title}</h2>
        {sub && <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">{sub}</p>}
      </div>
      {children && <div className="flex gap-2 flex-wrap">{children}</div>}
    </div>
  )
}

// A figure that opens the list it counts.
export function StatLink({ to, ...card }) {
  return <Link to={to} className="block"><StatsCard {...card} /></Link>
}

// Rows of a dashboard list while it loads.
export function ListSkeleton({ rows = 4 }) {
  return <div className="p-6 space-y-3">{Array(rows).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
}

// The open requests that have waited longest in their current stage, from useDashboard().
export function WaitingCard({ data, isLoading, title = 'Waiting longest', empty, className }) {
  const rows = data?.waiting ?? []
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
        {data?.stuck > 0 && (
          <span className="text-ui-xs font-semibold text-amber-700">
            {plural(data.stuck, 'request')} waiting {data.stuck_days} days or more
          </span>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? <ListSkeleton />
          : !rows.length ? <EmptyState icon={Clock} title="Nothing is waiting" sub={empty} />
          : rows.map(pr => (
            <Link key={pr.id} to={`/pr/${pr.id}`}
              className="flex items-center justify-between gap-3 px-6 py-3.5 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
              <div className="min-w-0">
                <p className="text-ui-sm font-semibold text-[--color-text-primary] truncate">{pr.title || 'Untitled request'}</p>
                <p className="text-ui-xs text-[--color-text-muted] truncate">
                  <span className="font-mono">{pr.pr_number}</span>{pr.department ? ` · ${pr.department}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <RecanvassBadge count={pr.recanvass_count} />
                <PRStatusBadge status={pr.status} />
                <span className={`w-14 text-right text-ui-xs tabular-nums ${pr.days > 3 ? 'font-semibold text-amber-700' : 'text-[--color-text-muted]'}`}>
                  {plural(pr.days, 'day')}
                </span>
              </div>
            </Link>
          ))}
      </CardContent>
    </Card>
  )
}

// Monthly spending on purchase orders, from GET /reports/summary (staff only).
export function SpendingTrendCard({ monthly = [], className }) {
  const data = monthly.map(m => ({ month: m.month?.slice(5) ?? m.month, spending: parseFloat(m.total_spending) }))
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Monthly Spending Trend</CardTitle>
        <Button variant="ghost" size="sm" asChild><Link to="/reports">Full report</Link></Button>
      </CardHeader>
      <CardContent>
        {!data.length
          ? <div className="flex flex-col items-center justify-center h-[200px] text-center">
              <TrendingUp className="size-8 text-[--color-text-muted] mb-2" />
              <p className="text-ui-xs text-[--color-text-muted]">No spending data yet</p>
            </div>
          : <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="10%" stopColor="hsl(222,62%,24%)" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="hsl(222,62%,24%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} tickFormatter={v => `₱${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip
                  formatter={(v) => [fmtCurrency(v), 'Spending']}
                  contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 13 }}
                  cursor={{ stroke: 'var(--color-border)', strokeWidth: 1 }}
                />
                <Area type="monotone" dataKey="spending" stroke="hsl(222,62%,24%)" strokeWidth={2} fill="url(#spendGrad)"
                  dot={false} activeDot={{ r: 5, fill: 'hsl(222,62%,24%)' }} />
              </AreaChart>
            </ResponsiveContainer>
        }
      </CardContent>
    </Card>
  )
}

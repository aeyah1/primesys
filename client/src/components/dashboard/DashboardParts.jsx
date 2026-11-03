import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import PageHeader from '@/components/shared/PageHeader'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

// The pieces every role's dashboard shares.

// This year's amounts (GET /dashboard); `statuses` narrows its waiting list.
export function useDashboard(statuses) {
  return useQuery({
    queryKey: ['dashboard', statuses?.join(',') || 'all'],
    queryFn: () => api.get(`/dashboard${statuses ? `?statuses=${statuses.join(',')}` : ''}`).then(r => r.data),
  })
}

// A dashboard's title row (the shared page header, named My tasks), with its main actions on the right.
export function DashboardHeader({ title = 'My tasks', ...props }) {
  return <PageHeader title={title} {...props} />
}

// A figure that opens the list it counts.
export function StatLink({ to, ...card }) {
  return <Link to={to} className="block"><StatsCard interactive {...card} /></Link>
}

// Rows of a dashboard list while it loads.
export function ListSkeleton({ rows = 4 }) {
  return <div className="p-6 space-y-3">{Array(rows).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
}

// Monthly spending on purchase orders, from GET /reports/summary (staff only).
export function SpendingTrendCard({ monthly = [], className }) {
  const data = monthly.map(m => ({ month: m.month?.slice(5) ?? m.month, spending: parseFloat(m.total_spending) }))
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Monthly spending</CardTitle>
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

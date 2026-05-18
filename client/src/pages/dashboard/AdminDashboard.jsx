import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  FileText, Users, Settings, CalendarDays, CheckCircle2,
  TrendingUp, Wallet, ShieldCheck, ChevronRight, AlertCircle,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import { PRStatusBadge } from '@/components/shared/StatusBadge'
import { RoleBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

const ROLE_META = [
  { key: 'procurement', label: 'Procurement',    color: 'bg-blue-500' },
  { key: 'extension',   label: 'Extension',       color: 'bg-teal-500' },
  { key: 'supply',      label: 'Supply Officer',  color: 'bg-orange-500' },
  { key: 'admin',       label: 'Admin',           color: 'bg-purple-500' },
]

function SectionHeader({ title, action }) {
  return (
    <div className="flex items-center justify-between mb-0">
      <CardTitle>{title}</CardTitle>
      {action}
    </div>
  )
}

function QuarterBudgetBar({ label, year, budget, spent }) {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0
  const over = pct >= 90
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-ui-sm font-semibold text-[--color-text-primary]">{label} {year}</span>
        <span className={`text-[10px] font-semibold ${over ? 'text-red-600' : 'text-[--color-text-muted]'}`}>
          {fmtCurrency(spent)} / {fmtCurrency(budget)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-[--color-border] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : 'bg-[--color-brand]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={`text-[10px] ${over ? 'text-red-500 font-medium' : 'text-[--color-text-muted]'}`}>
        {pct.toFixed(0)}% utilised{over && ' â€” near limit'}
      </p>
    </div>
  )
}

export default function AdminDashboard() {
  const { data: stats } = useQuery({
    queryKey: ['pr-stats'],
    queryFn: () => api.get('/pr/stats').then(r => r.data),
  })

  const { data: report } = useQuery({
    queryKey: ['reports-summary'],
    queryFn: () => api.get('/reports/summary').then(r => r.data),
  })

  const { data: usersRes } = useQuery({
    queryKey: ['users', 'admin-dashboard'],
    queryFn: () => api.get('/users?limit=200').then(r => r.data),
  })

  const { data: recentPRs, isLoading: prsLoading } = useQuery({
    queryKey: ['pr-list', 'admin-dashboard'],
    queryFn: () => api.get('/pr?limit=8').then(r => r.data),
  })

  const users    = usersRes?.data ?? []
  const totalUsers = usersRes?.total ?? users.length

  const roleCounts = ROLE_META.map(r => ({
    ...r,
    count: users.filter(u => u.role === r.key).length,
  }))
  const maxRoleCount = Math.max(...roleCounts.map(r => r.count), 1)

  const monthlyData = (report?.monthly ?? []).map(m => ({
    month: m.month?.slice(5) ?? m.month,
    spending: parseFloat(m.total_spending),
    prs: m.pr_count,
  }))

  const statusChartData = [
    { name: 'Draft',     value: stats?.draft     ?? 0 },
    { name: 'Submitted', value: stats?.submitted  ?? 0 },
    { name: 'Bidding',   value: stats?.bidding    ?? 0 },
    { name: 'For PO',    value: stats?.for_po     ?? 0 },
    { name: 'Completed', value: stats?.completed  ?? 0 },
    { name: 'Cancelled', value: stats?.cancelled  ?? 0 },
  ]

  const activeQuarters = (report?.byQuarter ?? []).filter(q => q.budget > 0).slice(0, 4)
  const totalSpending  = report?.totals?.total_spending ?? 0
  const completedPRs   = report?.totals?.completed ?? stats?.completed ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[--color-brand-light]">
              <ShieldCheck className="size-4 text-[--color-brand]" />
            </div>
            <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">System Overview</h2>
          </div>
          <p className="text-ui-sm text-[--color-text-secondary]">
            Full visibility across all procurement activity
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild variant="secondary" size="sm" className="gap-1.5">
            <Link to="/users"><Users className="size-3.5" /> Manage Users</Link>
          </Button>
          <Button asChild variant="secondary" size="sm" className="gap-1.5">
            <Link to="/quarters"><CalendarDays className="size-3.5" /> Quarters</Link>
          </Button>
          <Button asChild variant="secondary" size="sm" className="gap-1.5">
            <Link to="/reports"><TrendingUp className="size-3.5" /> Reports</Link>
          </Button>
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/settings"><Settings className="size-3.5" /> Settings</Link>
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        <StatsCard
          title="Total PRs"
          value={stats?.total ?? 0}
          icon={FileText}
          color="brand"
          sub={`${stats?.cancelled ?? 0} cancelled`}
        />
        <StatsCard
          title="Total Users"
          value={totalUsers}
          icon={Users}
          color="violet"
          sub={`${users.filter(u => u.is_active).length} active`}
        />
        <StatsCard
          title="Total Spending"
          value={fmtCurrency(totalSpending)}
          icon={Wallet}
          color="teal"
          sub="across all POs"
        />
        <StatsCard
          title="Completed PRs"
          value={completedPRs}
          icon={CheckCircle2}
          color="green"
          sub={stats?.total ? `${((completedPRs / stats.total) * 100).toFixed(0)}% of total` : undefined}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <SectionHeader
              title="Monthly Spending Trend"
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/reports">Full report</Link>
                </Button>
              }
            />
          </CardHeader>
          <CardContent>
            {!monthlyData.length
              ? <div className="flex flex-col items-center justify-center h-[200px] text-center">
                  <TrendingUp className="size-8 text-[--color-text-muted] mb-2" />
                  <p className="text-ui-xs text-[--color-text-muted]">No spending data yet</p>
                </div>
              : <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={monthlyData}>
                    <defs>
                      <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="10%" stopColor="hsl(145,62%,24%)" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="hsl(145,62%,24%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} tickFormatter={v => `â‚±${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                    <Tooltip
                      formatter={(v) => [fmtCurrency(v), 'Spending']}
                      contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 13 }}
                      cursor={{ stroke: 'var(--color-border)', strokeWidth: 1 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="spending"
                      stroke="hsl(145,62%,24%)"
                      strokeWidth={2}
                      fill="url(#spendGrad)"
                      dot={false}
                      activeDot={{ r: 5, fill: 'hsl(145,62%,24%)' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeader
              title="Users by Role"
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/users">Manage</Link>
                </Button>
              }
            />
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            {!users.length
              ? <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Users className="size-8 text-[--color-text-muted] mb-2" />
                  <p className="text-ui-xs text-[--color-text-muted]">No users found</p>
                </div>
              : roleCounts.map(r => (
                <div key={r.key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-ui-sm font-medium text-[--color-text-primary]">{r.label}</span>
                    <span className="text-ui-sm font-bold text-[--color-text-primary]">{r.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[--color-border] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${r.color}`}
                      style={{ width: `${(r.count / maxRoleCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            }

            <div className="pt-2 border-t border-[--color-border]">
              <div className="flex items-center justify-between">
                <span className="text-ui-xs text-[--color-text-muted]">Total registered</span>
                <span className="text-ui-sm font-bold text-[--color-text-primary]">{totalUsers}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-ui-xs text-[--color-text-muted]">Inactive accounts</span>
                <span className="text-ui-xs font-semibold text-amber-600">
                  {users.filter(u => !u.is_active).length}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent PRs + Quarter budgets */}
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
                ? <div className="px-6 py-14 text-center">
                    <FileText className="size-9 text-[--color-text-muted] mx-auto mb-3" />
                    <p className="text-ui-sm font-semibold text-[--color-text-primary]">No purchase requests yet</p>
                  </div>
                : recentPRs.data.map(pr => (
                  <Link key={pr.id} to={`/pr/${pr.id}`}
                    className="flex items-center justify-between px-6 py-3.5 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{pr.pr_number}</span>
                        {pr.quarter_label && (
                          <span className="text-[10px] text-[--color-text-muted]">{pr.quarter_label} {pr.quarter_year}</span>
                        )}
                      </div>
                      <p className="text-ui-xs text-[--color-text-secondary] mt-0.5 truncate">
                        {pr.title || 'â€”'}
                        {pr.created_by_name && (
                          <span className="text-[--color-text-muted]"> Â· {pr.created_by_name}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {pr.total_amount
                        ? <span className="text-ui-sm font-bold text-[--color-brand]">{fmtCurrency(pr.total_amount)}</span>
                        : null
                      }
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[--color-text-muted] hidden sm:block">{fmtDate(pr.created_at)}</span>
                        <PRStatusBadge status={pr.status} />
                      </div>
                    </div>
                  </Link>
                ))
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Budget Utilisation</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/quarters">Manage</Link></Button>
          </CardHeader>
          <CardContent className="space-y-5">
            {!activeQuarters.length
              ? <div className="py-10 text-center">
                  <Wallet className="size-8 text-[--color-text-muted] mx-auto mb-2" />
                  <p className="text-ui-xs text-[--color-text-muted]">No quarters with budgets set</p>
                  <Button asChild variant="ghost" size="sm" className="mt-2">
                    <Link to="/quarters">Set up quarters</Link>
                  </Button>
                </div>
              : activeQuarters.map(q => (
                <QuarterBudgetBar
                  key={q.id}
                  label={q.label}
                  year={q.year}
                  budget={parseFloat(q.budget)}
                  spent={parseFloat(q.total_spending)}
                />
              ))
            }
          </CardContent>
        </Card>
      </div>

      {/* PR Status full-width chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-[--color-text-muted]" />
            <CardTitle>PR Status Distribution</CardTitle>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-[--color-text-muted]">
            <span>{stats?.total ?? 0} total</span>
            {(stats?.cancelled ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-red-500">
                <AlertCircle className="size-3" /> {stats.cancelled} cancelled
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={statusChartData} barSize={44}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 13 }}
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="hsl(145,62%,24%)" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Category spending */}
      {(report?.byCategory ?? []).length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Spending by Category</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/reports">Full breakdown</Link></Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {report.byCategory.slice(0, 5).map((cat, i) => {
              const maxCat = parseFloat(report.byCategory[0]?.total ?? 1)
              const pct = (parseFloat(cat.total) / maxCat) * 100
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-ui-sm font-medium text-[--color-text-primary]">{cat.category}</span>
                    <span className="text-ui-sm font-bold text-[--color-brand]">{fmtCurrency(cat.total)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[--color-border] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[--color-brand] transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-[--color-text-muted] mt-0.5">{cat.pr_count} PR{cat.pr_count !== 1 ? 's' : ''}</p>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}


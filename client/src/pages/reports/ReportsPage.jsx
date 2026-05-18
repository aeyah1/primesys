import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts'
import { Download } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

const CATEGORY_LABELS = {
  food: 'Food & Supplies', hardware: 'Hardware / Equipment',
  technical: 'Technical Equipment', office: 'Office Supplies',
  tarpaulin: 'Tarpaulin / Signage', token: 'Token / Gift', other: 'Other',
}

const CATEGORY_COLORS = [
  '#166534', '#15803d', '#16a34a', '#b45309',
  '#d97706', '#0f766e', '#7c3aed', '#be123c',
]

const STATUS_LABELS = {
  submitted: 'Submitted',
  for_bidding: 'For Bidding', bidding_done: 'Bidding Done', awarded: 'Awarded',
  po_issued: 'PO Issued', waiting_delivery: 'Waiting Delivery',
  delivered: 'Delivered', cancelled: 'Cancelled',
}

function StatCard({ label, value, sub }) {
  return (
    <Card>
      <CardContent className="py-5 px-6">
        <p className="text-ui-xs font-medium text-[--color-text-muted] uppercase tracking-wide">{label}</p>
        <p className="text-ui-2xl font-bold text-[--color-text-primary] mt-1">{value}</p>
        {sub && <p className="text-ui-xs text-[--color-text-secondary] mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

const fmtK = (v) => {
  if (v >= 1_000_000) return `₱${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `₱${(v / 1_000).toFixed(0)}K`
  return `₱${v}`
}

const toCSV = (rows) => rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')

const downloadCSV = (filename, rows) => {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

export default function ReportsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['reports-summary'],
    queryFn: () => api.get('/reports/summary').then(r => r.data),
  })

  if (isLoading) return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )

  const { byQuarter = [], byCategory = [], byStatus = [], monthly = [], totals = {} } = data ?? {}

  const exportReport = () => {
    const date = new Date().toISOString().slice(0, 10)
    // Quarterly summary sheet
    const quarterRows = [
      ['Quarter', 'PRs', 'Total Spending (PHP)', 'Budget (PHP)', 'Utilization %'],
      ...byQuarter.map(q => {
        const spending = parseFloat(q.total_spending)
        const budget   = q.budget ? parseFloat(q.budget) : ''
        const pct      = budget ? ((spending / budget) * 100).toFixed(1) : ''
        return [`${q.label} ${q.year}`, q.pr_count, spending.toFixed(2), budget || '', pct]
      }),
    ]
    // Category breakdown sheet
    const categoryRows = [
      ['Category', 'PRs', 'Total Spending (PHP)'],
      ...byCategory.map(c => [
        CATEGORY_LABELS[c.category] || c.category,
        c.pr_count,
        parseFloat(c.total).toFixed(2),
      ]),
    ]
    // Status breakdown
    const statusRows = [
      ['Status', 'Count'],
      ...byStatus.map(s => [STATUS_LABELS[s.status] || s.status, s.count]),
    ]
    downloadCSV(`PRimeSys-Quarterly-${date}.csv`, quarterRows)
    setTimeout(() => downloadCSV(`PRimeSys-Categories-${date}.csv`, categoryRows), 300)
    setTimeout(() => downloadCSV(`PRimeSys-Status-${date}.csv`, statusRows), 600)
  }

  const quarterChartData = byQuarter.slice(0, 8).map(q => ({
    name: `${q.label} ${q.year}`,
    spending: parseFloat(q.total_spending),
    budget: q.budget ? parseFloat(q.budget) : null,
    prs: q.pr_count,
  })).reverse()

  const categoryChartData = byCategory.map(c => ({
    name: CATEGORY_LABELS[c.category] || c.category,
    value: parseFloat(c.total),
    count: c.pr_count,
  }))

  const monthlyChartData = monthly.map(m => ({
    name: m.month,
    spending: parseFloat(m.total_spending),
    prs: m.pr_count,
  }))

  const statusChartData = byStatus
    .filter(s => s.status !== 'cancelled')
    .map(s => ({ name: STATUS_LABELS[s.status] || s.status, value: parseInt(s.count) }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-ui-xl font-bold text-[--color-text-primary]">Reports & Analytics</h2>
          <p className="text-ui-xs text-[--color-text-secondary] mt-0.5">Procurement spending and pipeline overview</p>
        </div>
        {!isLoading && data && (
          <Button variant="secondary" size="sm" className="gap-1.5 shrink-0" onClick={exportReport}>
            <Download className="size-3.5" /> Export CSV
          </Button>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total PRs" value={totals.total_prs ?? 0} />
        <StatCard label="Total Spending" value={fmtCurrency(totals.total_spending)} />
        <StatCard label="In Progress" value={totals.in_progress ?? 0} sub="bidding → delivery" />
        <StatCard label="Delivered" value={totals.delivered ?? 0} sub="completed PRs" />
      </div>

      {/* Quarterly Spending Bar Chart */}
      <Card>
        <CardHeader><CardTitle>Spending by Quarter</CardTitle></CardHeader>
        <CardContent>
          {quarterChartData.length === 0
            ? <p className="text-center text-ui-sm text-[--color-text-muted] py-10">No data yet</p>
            : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={quarterChartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} width={60} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v, name) => [fmtCurrency(v), name === 'spending' ? 'Spending' : 'Budget']} />
                  <Bar dataKey="spending" fill="hsl(145,62%,24%)" radius={[4, 4, 0, 0]} name="spending" />
                  {quarterChartData.some(d => d.budget) && (
                    <Bar dataKey="budget" fill="hsl(145,55%,85%)" radius={[4, 4, 0, 0]} name="budget" />
                  )}
                </BarChart>
              </ResponsiveContainer>
            )
          }
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Category Pie Chart */}
        <Card>
          <CardHeader><CardTitle>Spending by Category</CardTitle></CardHeader>
          <CardContent>
            {categoryChartData.length === 0
              ? <p className="text-center text-ui-sm text-[--color-text-muted] py-10">No data yet</p>
              : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={categoryChartData}
                      cx="50%" cy="50%"
                      innerRadius={60} outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {categoryChartData.map((_, i) => (
                        <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => fmtCurrency(v)} />
                    <Legend formatter={(v) => <span className="text-ui-xs">{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )
            }
          </CardContent>
        </Card>

        {/* Monthly Trend Area Chart */}
        <Card>
          <CardHeader><CardTitle>Monthly Trend (Last 12 months)</CardTitle></CardHeader>
          <CardContent>
            {monthlyChartData.length === 0
              ? <p className="text-center text-ui-sm text-[--color-text-muted] py-10">No data yet</p>
              : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={monthlyChartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <defs>
                      <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(145,62%,24%)" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="hsl(145,62%,24%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} width={60} />
                    <Tooltip formatter={(v) => fmtCurrency(v)} />
                    <Area type="monotone" dataKey="spending" stroke="hsl(145,62%,24%)" strokeWidth={2}
                      fill="url(#spendGrad)" name="Spending" />
                  </AreaChart>
                </ResponsiveContainer>
              )
            }
          </CardContent>
        </Card>
      </div>

      {/* PR Status Breakdown */}
      <Card>
        <CardHeader><CardTitle>PR Status Breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {statusChartData.map(s => (
              <div key={s.name} className="rounded-xl border border-[--color-border] bg-[--color-canvas] px-4 py-4 text-center">
                <p className="text-ui-2xl font-bold text-[--color-text-primary]">{s.value}</p>
                <p className="text-xs text-[--color-text-muted] mt-1 leading-snug">{s.name}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quarterly Table */}
      <Card>
        <CardHeader><CardTitle>Quarter Summary</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-ui-sm">
            <thead className="border-b border-[--color-border] bg-[--color-brand-light]/50">
              <tr className="text-left">
                <th className="px-6 py-3 text-xs font-bold text-[--color-brand] uppercase tracking-wide">Quarter</th>
                <th className="px-6 py-3 text-xs font-bold text-[--color-brand] uppercase tracking-wide text-right">PRs</th>
                <th className="px-6 py-3 text-xs font-bold text-[--color-brand] uppercase tracking-wide text-right">Total Spending</th>
                <th className="px-6 py-3 text-xs font-bold text-[--color-brand] uppercase tracking-wide text-right">Budget</th>
                <th className="px-6 py-3 text-xs font-bold text-[--color-brand] uppercase tracking-wide text-right">Utilization</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border]">
              {byQuarter.map(q => {
                const spending = parseFloat(q.total_spending)
                const budget   = q.budget ? parseFloat(q.budget) : null
                const pct      = budget ? Math.min((spending / budget) * 100, 100) : null
                return (
                  <tr key={q.id} className="hover:bg-[--color-overlay] transition-colors bg-white">
                    <td className="px-6 py-3.5 font-semibold text-[--color-text-primary]">{q.label} {q.year}</td>
                    <td className="px-6 py-3.5 text-right text-[--color-text-secondary]">{q.pr_count}</td>
                    <td className="px-6 py-3.5 text-right font-semibold text-[--color-text-primary]">{fmtCurrency(spending)}</td>
                    <td className="px-6 py-3.5 text-right text-[--color-text-secondary]">{budget ? fmtCurrency(budget) : '—'}</td>
                    <td className="px-6 py-3.5 text-right">
                      {pct !== null ? (
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-[--color-overlay] overflow-hidden">
                            <div className={`h-full rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-[--color-text-secondary]">{pct.toFixed(0)}%</span>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

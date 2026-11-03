import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Clock, CheckCircle2, Wallet } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DashboardHeader, StatLink, useDashboard } from '@/components/dashboard/DashboardParts'
import MyTasks from '@/components/dashboard/MyTasks'
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

// An End User's home: what needs them and what they wait on (MyTasks), then where their requests are.
export default function RequestorDashboard() {
  const { user } = useAuth()
  const { data: stats } = useQuery({
    queryKey: ['pr-stats'],
    queryFn: () => api.get('/pr/stats').then(r => r.data),
  })
  const dash = useDashboard(IN_PROGRESS)

  const sum = (statuses) => statuses.reduce((n, s) => n + (stats?.[s] ?? 0), 0)
  const most = Math.max(...PIPELINE.map(p => sum(p.statuses)), 1)

  return (
    <div className="space-y-6">
      <DashboardHeader sub={`Welcome, ${user?.name}. Here is how your requests are doing.`}>
        <Button asChild className="gap-2"><Link to="/pr/create"><Plus className="size-4" /> New Request</Link></Button>
      </DashboardHeader>

      <MyTasks />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 card-grid">
        <StatLink to="/my-requests?tab=in_progress" title="In Progress" value={sum(IN_PROGRESS)} icon={Clock} color="blue" sub="with the TWG or Procurement" />
        <StatLink to="/my-requests?tab=done" title="Completed" value={stats?.completed ?? 0} icon={CheckCircle2} color="green" sub="delivered in full" />
        <StatLink to="/archive" title={`Requested in ${dash.data?.year ?? ''}`} value={dash.data ? fmtCurrency(dash.data.amounts.requested) : '…'}
          icon={Wallet} color="brand" sub="estimate of the requests you sent" />
      </div>

      <div>
        <Card>
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

    </div>
  )
}

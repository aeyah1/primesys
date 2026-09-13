import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  FileText, Plus, CheckCircle2, Clock, ChevronRight, AlertCircle, BookOpen, Archive, Building2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import { PRStatusBadge } from '@/components/shared/StatusBadge'
import { useAuth } from '@/context/AuthContext'
import { REQUEST_STEPS, requestProgress } from '@/lib/requestProgress'
import api from '@/lib/axios'

// One line per step of REQUEST_STEPS, for the "How it works" panel.
const STEP_HELP = [
  'You describe what you need and submit it.',
  'The Technical Working Group checks the details and may ask for changes.',
  'The Procurement Office asks suppliers for prices and picks one.',
  'A purchase order is sent to the supplier.',
  'The Supply Office receives the items, and your request is done.',
]

// A requestor's home: what needs them, where each request is (in plain
// words), and how the process works. No procurement pages or terms.
export default function RequestorDashboard() {
  const { user } = useAuth()

  const { data: stats } = useQuery({
    queryKey: ['pr-stats'],
    queryFn: () => api.get('/pr/stats').then(r => r.data),
  })

  const { data: prsRes, isLoading } = useQuery({
    queryKey: ['pr-list', 'requestor-dashboard'],
    queryFn: () => api.get('/pr?limit=10').then(r => r.data),
  })

  const prs      = prsRes?.data ?? []
  const needsYou = prs.filter(p => ['draft', 'revision_requested'].includes(p.status))
  const s        = stats || {}
  const count    = (...keys) => keys.reduce((n, k) => n + (s[k] ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">
            Welcome, {user?.name?.split(' ')[0]}
          </h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            Here is where your requests are.
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link to="/pr/create"><Plus className="size-4" /> New Request</Link>
        </Button>
      </div>

      {needsYou.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <AlertCircle className="size-4 text-amber-600" />
            <CardTitle>Needs your attention</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {needsYou.map(pr => (
              <Link key={pr.id} to={`/pr/${pr.id}`}
                className="flex items-center justify-between gap-3 px-6 py-3 border-t border-[--color-border] hover:bg-overlay/60 transition-colors">
                <div className="min-w-0">
                  <p className="text-ui-sm font-semibold text-[--color-text-primary] truncate">{pr.title || pr.pr_number}</p>
                  <p className="text-ui-xs text-amber-700 mt-0.5">
                    {pr.status === 'draft' ? 'Not sent yet. Finish it and submit it to the TWG.' : 'Changes were requested. Open it to read why, update it, and submit it again.'}
                  </p>
                </div>
                <ChevronRight className="size-4 text-[--color-text-muted] shrink-0" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        <StatsCard title="Needs you"        value={count('draft', 'revision_requested')}     icon={AlertCircle}  color="amber" sub="drafts and requested changes" />
        <StatsCard title="With the TWG"     value={count('submitted')}                       icon={Clock}        color="blue"  sub="being checked" />
        <StatsCard title="With Procurement" value={count('twg_review', 'bidding', 'for_po')} icon={Building2}    color="brand" sub="supplier, order, delivery" />
        <StatsCard title="Delivered"        value={count('completed')}                       icon={CheckCircle2} color="green" />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>My requests</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/pr">View all</Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading
              ? <div className="p-6 space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              : !prs.length
                ? (
                  <div className="px-6 py-12 text-center">
                    <FileText className="size-8 text-[--color-text-muted] mx-auto mb-3" />
                    <p className="text-ui-sm font-semibold text-[--color-text-primary]">No requests yet</p>
                    <p className="text-ui-xs text-[--color-text-muted] mt-1 mb-4">File your first one. You can save it as a draft and finish later.</p>
                    <Button asChild size="sm" className="gap-1.5"><Link to="/pr/create"><Plus className="size-3.5" /> New Request</Link></Button>
                  </div>
                )
                : prs.map(pr => (
                  <Link key={pr.id} to={`/pr/${pr.id}`}
                    className="flex items-center justify-between px-6 py-3.5 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors gap-3">
                    <div className="min-w-0">
                      <p className="text-ui-sm font-semibold text-[--color-text-primary] truncate">{pr.title || pr.pr_number}</p>
                      <p className="text-ui-xs text-[--color-text-secondary] mt-0.5">
                        <span className="font-mono text-[--color-text-muted]">{pr.pr_number}</span> · {requestProgress(pr).title}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PRStatusBadge status={pr.status} />
                      <ChevronRight className="size-4 text-[--color-text-muted]" />
                    </div>
                  </Link>
                ))
            }
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>How it works</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {REQUEST_STEPS.map((step, i) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[--color-border] bg-[--color-canvas] text-[11px] font-bold text-[--color-text-secondary]">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-ui-sm font-semibold text-[--color-text-primary]">{step}</p>
                      <p className="text-ui-xs text-[--color-text-muted] leading-snug">{STEP_HELP[i]}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4 space-y-2">
              <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
                <Link to="/pr"><FileText className="size-3.5" /> All my requests</Link>
              </Button>
              <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
                <Link to="/archive"><Archive className="size-3.5" /> Finished and past requests</Link>
              </Button>
              <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
                <Link to="/guide"><BookOpen className="size-3.5" /> User Guide</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

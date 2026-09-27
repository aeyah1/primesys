import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { FileText, Plus, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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

// The requestor's three lists: what waits for them, what is moving, what is finished.
const TABS = [
  { key: 'needs_me',    label: 'Needs me',    statuses: ['draft', 'revision_requested'],
    empty: 'Nothing waits for you. Drafts and requests sent back for changes appear here.' },
  { key: 'in_progress', label: 'In progress', statuses: ['submitted', 'twg_review', 'bidding', 'for_po'],
    empty: 'No request is moving right now.' },
  { key: 'done',        label: 'Done',        statuses: ['completed', 'rejected', 'cancelled'],
    empty: 'Finished, rejected and cancelled requests appear here.' },
]
const PAGE_SIZE = 15

// A requestor's home, and their only list: their requests by what they need next.
export default function RequestorDashboard() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab  = TABS.find(t => t.key === params.get('tab')) || TABS[0]
  const page = Math.max(parseInt(params.get('page'), 10) || 1, 1)
  const go   = (next) => setParams(Object.fromEntries(Object.entries({ tab: tab.key, page, ...next }).filter(([, v]) => v && v !== 1)))

  const { data: stats } = useQuery({
    queryKey: ['pr-stats'],
    queryFn: () => api.get('/pr/stats').then(r => r.data),
  })
  const { data, isLoading } = useQuery({
    queryKey: ['pr-list', 'requestor-home', tab.key, page],
    queryFn: () => api.get(`/pr?${new URLSearchParams({ status: tab.statuses.join(','), page, limit: PAGE_SIZE })}`).then(r => r.data),
  })
  const prs   = data?.data ?? []
  const count = (t) => t.statuses.reduce((n, k) => n + (stats?.[k] ?? 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">My Requests</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">Welcome, {user?.name}. Here is where each of your requests is.</p>
        </div>
        <Button asChild className="gap-2">
          <Link to="/pr/create"><Plus className="size-4" /> New Request</Link>
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-0">
            <div className="flex flex-wrap gap-2">
              {TABS.map(t => (
                <button key={t.key} onClick={() => go({ tab: t.key, page: 1 })}
                  className={`rounded-full border px-3 py-1 text-ui-xs font-medium transition-colors ${
                    tab.key === t.key
                      ? 'border-[--color-brand] bg-[--color-brand] text-white'
                      : t.key === 'needs_me' && count(t) > 0
                        ? 'border-amber-400 bg-amber-50 text-amber-800 hover:border-amber-500'
                        : 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'
                  }`}>
                  {t.label} <span className="opacity-80">({count(t)})</span>
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-0 pt-3">
            {isLoading
              ? <div className="p-6 space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              : !prs.length
                ? (
                  <div className="px-6 py-12 text-center">
                    <FileText className="size-8 text-[--color-text-muted] mx-auto mb-3" />
                    <p className="text-ui-xs text-[--color-text-muted]">{tab.empty}</p>
                  </div>
                )
                : prs.map(pr => (
                  <Link key={pr.id} to={`/pr/${pr.id}`}
                    className="flex items-center justify-between px-6 py-3.5 border-t border-[--color-border] hover:bg-overlay/60 transition-colors gap-3">
                    <div className="min-w-0">
                      <p className="text-ui-sm font-semibold text-[--color-text-primary] truncate">{pr.title || pr.pr_number}</p>
                      <p className={`text-ui-xs mt-0.5 ${tab.key === 'needs_me' ? 'text-amber-700' : 'text-[--color-text-secondary]'}`}>
                        <span className="font-mono text-[--color-text-muted]">{pr.pr_number}</span> · {
                          pr.status === 'draft' ? 'Not sent yet. Finish it and submit it to the TWG.'
                          : pr.status === 'revision_requested' ? 'Changes were requested. Open it to read why.'
                          : requestProgress(pr).title}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PRStatusBadge status={pr.status} />
                      <ChevronRight className="size-4 text-[--color-text-muted]" />
                    </div>
                  </Link>
                ))}
            {data?.totalPages > 1 && (
              <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-[--color-border]">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => go({ page: page - 1 })}>Previous</Button>
                <span className="text-ui-xs text-[--color-text-muted]">Page {page} of {data.totalPages}</span>
                <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => go({ page: page + 1 })}>Next</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 self-start">
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
      </div>
    </div>
  )
}

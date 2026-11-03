import { useState } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import PageHeader from '@/components/shared/PageHeader'
import DeletePRDialog from '@/components/shared/DeletePRDialog'
import { TabBar, Tab, Toolbar, SearchBox, ListCount, Pager } from '@/components/shared/ListParts'
import RequestTable from '@/components/request/RequestTable'
import { STEPS } from '@/lib/nextStep'
import useUrlParams from '@/hooks/useUrlParams'
import api from '@/lib/axios'

// One line per step (lib/nextStep.js STEPS, the steps on every request page).
const STEP_HELP = [
  'You describe what you need and submit it to the TWG.',
  'The Technical Working Group checks the specifications and may ask for changes.',
  'Procurement gives the RFQ to the canvasser, who collects suppliers\' prices; Procurement enters them.',
  'The BAC chooses the supplier of each lot at its meeting and Procurement records it; for IT equipment the TWG checks every offer first.',
  'Procurement issues the purchase order to the supplier.',
  'The Supply Office receives the items, and your request is done.',
]

// The End User's three lists: what waits for them, what is moving, what is finished.
const TABS = [
  { key: 'needs_me',    label: 'Needs me',    statuses: ['draft', 'revision_requested'],
    empty: 'Nothing waits for you. Drafts and requests sent back for changes appear here.' },
  { key: 'in_progress', label: 'In progress', statuses: ['submitted', 'twg_review', 'bidding', 'bac_review', 'twg_certification', 're_pr', 'for_po'],
    empty: 'No request is moving right now.' },
  { key: 'done',        label: 'Done',        statuses: ['completed', 'rejected', 'cancelled'],
    empty: 'Finished, rejected and cancelled requests appear here.' },
]
const PAGE_SIZE = 15

// An End User's own requests, by what they need next, and how a request moves.
export default function MyRequests() {
  const qc = useQueryClient()
  const [params, update] = useUrlParams()
  const tab  = TABS.find(t => t.key === params.get('tab')) || TABS[0]
  const page = Math.max(parseInt(params.get('page'), 10) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')
  const [deleteTarget, setDeleteTarget] = useState(null)

  const { data: stats } = useQuery({
    queryKey: ['pr-stats'],
    queryFn: () => api.get('/pr/stats').then(r => r.data),
  })
  const { data, isLoading, isError } = useQuery({
    queryKey: ['pr-list', 'mine', tab.key, search, page],
    queryFn: () => {
      const q = new URLSearchParams({ status: tab.statuses.join(','), page, limit: PAGE_SIZE })
      if (search) q.set('search', search)
      return api.get(`/pr?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })
  const count = (t) => t.statuses.reduce((n, k) => n + (stats?.[k] ?? 0), 0)

  return (
    <div className="space-y-5">
      <PageHeader title="My Requests" sub="Every request you filed, by what it needs next. Open one to see its steps.">
        <Button asChild className="gap-1.5"><Link to="/pr/create"><Plus className="size-4" /> New Request</Link></Button>
      </PageHeader>

      <Card className="overflow-hidden">
        <TabBar>
          {TABS.map(t => (
            <Tab key={t.key} active={tab.key === t.key} count={count(t)} alert={t.key === 'needs_me'} onClick={() => update({ tab: t.key === 'needs_me' ? '' : t.key, page: '' })}>
              {t.label}
            </Tab>
          ))}
        </TabBar>
        <Toolbar end={<ListCount n={data?.total} one="request" />}>
          <SearchBox value={search} placeholder="Search by PR number or title" onChange={v => { setSearch(v); update({ q: v, page: '' }) }} />
        </Toolbar>
        <RequestTable rows={data?.data ?? []} isLoading={isLoading} isError={isError} category={false} onDelete={setDeleteTarget}
          empty={{ title: search ? 'No request matches your search' : 'Nothing here', sub: search ? 'Try another PR number or title.' : tab.empty }} />
        <Pager page={page} totalPages={data?.totalPages} onPage={(n) => update({ page: n > 1 ? n : '' })} />
      </Card>

      <section aria-labelledby="how-it-moves">
        <h3 id="how-it-moves" className="mb-3 text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">How a request moves</h3>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-3 rounded-xl border border-[--color-border] bg-[--color-surface] p-4 shadow-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[--color-brand-light] text-[11px] font-bold text-[--color-brand]">{i + 1}</span>
              <div>
                <p className="text-ui-sm font-semibold text-[--color-text-primary]">{step}</p>
                <p className="mt-0.5 text-ui-xs leading-snug text-[--color-text-muted]">{STEP_HELP[i]}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <DeletePRDialog pr={deleteTarget} onClose={() => setDeleteTarget(null)}
        onDeleted={() => { qc.invalidateQueries({ queryKey: ['pr-list'] }); qc.invalidateQueries({ queryKey: ['pr-stats'] }); setDeleteTarget(null) }} />
    </div>
  )
}

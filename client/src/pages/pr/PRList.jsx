import { useState } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, ArrowUpDown } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import DeletePRDialog from '@/components/shared/DeletePRDialog'
import PageHeader from '@/components/shared/PageHeader'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TabBar, Tab, Toolbar, SearchBox, ListCount, Pager } from '@/components/shared/ListParts'
import RequestTable from '@/components/request/RequestTable'
import { CATEGORY_LABELS, PR_STATUS_LABELS } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import useUrlParams from '@/hooks/useUrlParams'
import api from '@/lib/axios'

// Status tabs in workflow order, named as the statuses read everywhere; a status with no request is left out.
const STATUSES = ['draft', 'submitted', 'revision_requested', 'twg_review', 'bidding', 'twg_certification', 're_pr',
  'bac_review', 'for_po', 'completed', 'rejected', 'cancelled']
// Server-side orders (pr.controller LIST_SORTS).
const SORTS = [
  { key: 'newest',          label: 'Newest first' },
  { key: 'oldest_approval', label: 'Oldest TWG approval first' },
  { key: 'total',           label: 'Largest estimated total' },
]
const CATEGORIES = Object.keys(CATEGORY_LABELS)
const ANY = 'any'

// What each role finds on this page.
const SUB = {
  procurement: 'Every purchase request from draft to delivery. Open one to see its steps and do your part.',
  admin:       'Every purchase request from draft to delivery. Open one to see its steps.',
  bac:         'The requests the TWG approved, through their canvass and award.',
  twg:         'The requests in your review areas, and the ones you decided on.',
}

// Every request the viewer may see, by status, with who has each one now.
export default function PRList() {
  const { user }     = useAuth()
  const qc           = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState(null)

  // Tab, category, sort, search, and page live in the URL, so the back button, a refresh, and a shared link keep the view.
  const [params, update] = useUrlParams()
  const tab      = STATUSES.includes(params.get('status')) ? params.get('status') : 'all'
  const category = CATEGORIES.includes(params.get('category')) ? params.get('category') : ''
  const sort     = SORTS.some(s => s.key === params.get('sort')) ? params.get('sort')
                 : tab === 'twg_review' ? 'oldest_approval' : 'newest'
  const page     = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')

  const isStaff = ['procurement', 'admin'].includes(user?.role)
  const canCreate = ['admin', 'procurement', 'requestor'].includes(user?.role)

  // Requests Procurement opened, for the New mark on TWG approvals it hasn't looked at yet.
  const { data: readSet = new Set() } = useQuery({
    queryKey: ['pr-reads', user?.id],
    queryFn: () => api.get('/pr/reads').then(r => new Set(r.data.map(String))),
    enabled: isStaff,
    staleTime: 60_000,
  })
  const { data: stats } = useQuery({
    queryKey: ['pr-stats'],
    queryFn: () => api.get('/pr/stats').then(r => r.data),
  })
  const tabCount = (key) => (key === 'all' ? stats?.total : stats?.[key]) ?? 0
  const catCount = (c) => tab === 'all'
    ? Object.values(stats?.by_category || {}).reduce((n, byCat) => n + (byCat[c] || 0), 0)
    : stats?.by_category?.[tab]?.[c] || 0

  const { data, isLoading, isError } = useQuery({
    queryKey: ['pr-list', { search, tab, category, sort, page }],
    queryFn: () => {
      const q = new URLSearchParams({ page, limit: 15, sort })
      if (search)        q.set('search', search)
      if (tab !== 'all') q.set('status', tab)
      if (category)      q.set('category', category)
      return api.get(`/pr?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []

  const afterDelete = () => {
    qc.invalidateQueries({ queryKey: ['pr-list'] })
    qc.invalidateQueries({ queryKey: ['pr-stats'] })
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Requests" sub={SUB[user?.role] || 'The purchase requests you can see.'}>
        {canCreate && <Button asChild className="gap-1.5"><Link to="/pr/create"><Plus className="size-4" /> New Request</Link></Button>}
      </PageHeader>

      <Card className="overflow-hidden">
        <TabBar>
          <Tab active={tab === 'all'} count={tabCount('all')} onClick={() => update({ status: '', sort: '', page: '' })}>All</Tab>
          {STATUSES.filter(s => tabCount(s) > 0 || s === tab).map(s => (
            <Tab key={s} active={tab === s} count={tabCount(s)} onClick={() => update({ status: s, sort: '', page: '' })}>
              {PR_STATUS_LABELS[s]}
            </Tab>
          ))}
        </TabBar>

        <Toolbar end={<ListCount n={data?.total} one="request" />}>
          <SearchBox value={search} placeholder="Search by PR number or title" onChange={v => { setSearch(v); update({ q: v, page: '' }) }} />
          <Select value={category || ANY} onValueChange={v => update({ category: v === ANY ? '' : v, page: '' })}>
            <SelectTrigger className="h-9 w-52 text-ui-xs" aria-label="Category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY} className="text-ui-xs">All categories ({tabCount(tab)})</SelectItem>
              {CATEGORIES.map(c => <SelectItem key={c} value={c} className="text-ui-xs">{CATEGORY_LABELS[c]} ({catCount(c)})</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={v => update({ sort: v, page: '' })}>
            <SelectTrigger className="h-9 w-56 gap-2 text-ui-xs" aria-label="Order"><ArrowUpDown className="size-3.5 text-[--color-text-muted]" /><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORTS.map(s => <SelectItem key={s.key} value={s.key} className="text-ui-xs">{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Toolbar>

        <RequestTable rows={rows} isLoading={isLoading} isError={isError} onDelete={setDeleteTarget}
          isNew={(pr) => isStaff && pr.status === 'twg_review' && !readSet.has(String(pr.id))}
          empty={{ title: 'No request here', sub: search || category || tab !== 'all' ? 'Try another tab, category or search.' : 'Requests appear here once they are filed.' }} />
        <Pager page={page} totalPages={data?.totalPages} summary={`${data?.total} requests`} onPage={(n) => update({ page: n > 1 ? n : '' })} />
      </Card>

      <DeletePRDialog pr={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={afterDelete} />
    </div>
  )
}

import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import PageHeader from '@/components/shared/PageHeader'
import { Toolbar, SearchBox, ListCount, Pager } from '@/components/shared/ListParts'
import AuditTable, { KINDS, RESULTS, ROLES } from '@/components/shared/AuditTable'
import useUrlParams from '@/hooks/useUrlParams'
import api from '@/lib/axios'

const PAGE_SIZE = 50

// Every change and sign-in in PRimeSys, for the admin (server/controllers/audit.controller.js); filters live in the URL,
// so "Activity" in User Management opens one person's history.
export default function AuditLogPage() {
  const [params, setUrl] = useUrlParams()
  const [search, setSearch] = useState(params.get('q') || '')
  const filters = { user: params.get('user') || '', category: params.get('category') || '', outcome: params.get('outcome') || '', from: params.get('from') || '', to: params.get('to') || '' }
  const page = Math.max(parseInt(params.get('page')) || 1, 1)
  const set = (k) => (v) => setUrl({ [k]: v === 'all' ? '' : v, page: '' })
  const filtering = search || Object.values(filters).some(Boolean)

  const { data: people = [] } = useQuery({
    queryKey: ['users', 'audit-pick'],
    queryFn: () => api.get('/users?limit=200&sort=name').then(r => r.data.data),
    staleTime: 60_000,
  })
  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit', { search, ...filters, page }],
    queryFn: () => {
      const q = new URLSearchParams({ page, limit: PAGE_SIZE })
      for (const [k, v] of Object.entries({ ...filters, q: search })) if (v) q.set(k, v)
      return api.get(`/audit?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })
  const rows = data?.data || []
  const totalPages = Math.ceil((data?.total || 0) / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <PageHeader title="Audit Log" sub="Every change and sign-in in PRimeSys, newest first: who, what, which item, when, and from where. Kept for a year; only administrators see it." />

      <Card className="overflow-hidden">
        <Toolbar end={data && <ListCount n={data.total} one="entry" many="entries" />}>
          <SearchBox value={search} placeholder="Search a person, an action, a PR number or an address"
            onChange={v => { setSearch(v); setUrl({ q: v, page: '' }) }} />
          <Select value={filters.user || 'all'} onValueChange={set('user')}>
            <SelectTrigger className="h-9 w-52 text-ui-xs" aria-label="Person"><SelectValue placeholder="Everyone" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {people.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name} ({ROLES[p.role] || p.role})</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.category || 'all'} onValueChange={set('category')}>
            <SelectTrigger className="h-9 w-52 text-ui-xs" aria-label="Kind of activity"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All activity</SelectItem>
              {Object.entries(KINDS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.outcome || 'all'} onValueChange={set('outcome')}>
            <SelectTrigger className="h-9 w-36 text-ui-xs" aria-label="Result"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any result</SelectItem>
              {Object.entries(RESULTS).map(([k, [label]]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 text-ui-xs text-[--color-text-secondary]">
            <span>From</span>
            <Input type="date" value={filters.from} onChange={e => set('from')(e.target.value)} className="h-9 w-40" aria-label="From date" />
            <span>to</span>
            <Input type="date" value={filters.to} onChange={e => set('to')(e.target.value)} className="h-9 w-40" aria-label="To date" />
          </div>
          {filtering && (
            <Button type="button" variant="ghost" size="sm" className="gap-1"
              onClick={() => { setSearch(''); setUrl({ q: '', user: '', category: '', outcome: '', from: '', to: '', page: '' }) }}>
              <X className="size-3.5" /> Clear filters
            </Button>
          )}
        </Toolbar>

          <AuditTable rows={rows} isLoading={isLoading} isError={isError} admin onPickUser={(id) => setUrl({ user: id, page: '' })}
            empty={filtering ? { title: 'Nothing matches these filters', sub: 'Clear or change a filter.' } : { title: 'Nothing recorded yet', sub: 'Changes and sign-ins appear here as people use PRimeSys.' }} />
          <Pager page={page} totalPages={totalPages} summary={`${data?.total?.toLocaleString() || 0} entries`} onPage={p => setUrl({ page: p })} />
      </Card>
    </div>
  )
}

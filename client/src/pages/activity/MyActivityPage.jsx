import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Lock, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import PageHeader from '@/components/shared/PageHeader'
import { Toolbar, ListCount, Pager } from '@/components/shared/ListParts'
import AuditTable, { KINDS } from '@/components/shared/AuditTable'
import { useAuth } from '@/context/AuthContext'
import useUrlParams from '@/hooks/useUrlParams'
import api from '@/lib/axios'

const PAGE_SIZE = 50

// Everyone's own history, read only (GET /audit/mine): what they did in PRimeSys and what was done to their account,
// with when and from where. Nobody can change or delete an entry; filters live in the URL.
export default function MyActivityPage() {
  const { user } = useAuth()
  const [params, setUrl] = useUrlParams()
  const filters = { category: params.get('category') || '', from: params.get('from') || '', to: params.get('to') || '' }
  const page = Math.max(parseInt(params.get('page')) || 1, 1)
  const set = (k) => (v) => setUrl({ [k]: v === 'all' ? '' : v, page: '' })
  const filtering = Object.values(filters).some(Boolean)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit', 'mine', { ...filters, page }],
    queryFn: () => {
      const q = new URLSearchParams({ page, limit: PAGE_SIZE })
      for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v)
      return api.get(`/audit/mine?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })
  const rows = data?.data || []
  const totalPages = Math.ceil((data?.total || 0) / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <PageHeader title="My activity" sub="Everything you did in PRimeSys and every sign-in to your account, newest first, with when and from where." />

      <p className="flex items-start gap-2 rounded-xl border border-[--color-border-strong] bg-[--color-overlay] px-4 py-2.5 text-ui-xs text-[--color-text-secondary]">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        Read only: nobody can change or delete these entries, you included. Entries are kept for a year. If you see a sign-in you
        don't recognise, change your password under Settings and tell the administrator.
      </p>

      <Card className="overflow-hidden">
        <Toolbar end={data && <ListCount n={data.total} one="entry" many="entries" />}>
          <Select value={filters.category || 'all'} onValueChange={set('category')}>
            <SelectTrigger className="h-9 w-52 text-ui-xs" aria-label="Kind of activity"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All activity</SelectItem>
              {Object.entries(KINDS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 text-ui-xs text-[--color-text-secondary]">
            <span>From</span>
            <Input type="date" value={filters.from} onChange={e => set('from')(e.target.value)} className="h-9 w-40" aria-label="From date" />
            <span>to</span>
            <Input type="date" value={filters.to} onChange={e => set('to')(e.target.value)} className="h-9 w-40" aria-label="To date" />
          </div>
          {filtering && (
            <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => setUrl({ category: '', from: '', to: '', page: '' })}>
              <X className="size-3.5" /> Clear filters
            </Button>
          )}
        </Toolbar>
        <AuditTable rows={rows} isLoading={isLoading} isError={isError} meId={user?.id}
          empty={filtering ? { title: 'Nothing matches these filters', sub: 'Clear or change a filter.' } : { title: 'Nothing recorded yet', sub: 'Your sign-ins and changes appear here.' }} />
        <Pager page={page} totalPages={totalPages} summary={`${data?.total?.toLocaleString() || 0} entries`} onPage={p => setUrl({ page: p })} />
      </Card>
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Search, ScrollText, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Pager, EmptyState } from '@/components/shared/ListParts'
import { fmtDatetime } from '@/lib/utils'
import useUrlParams from '@/hooks/useUrlParams'
import api from '@/lib/axios'

// The kinds of activity the audit log groups by (server/utils/audit.js categories).
const KINDS = {
  sign_in: 'Sign-ins', requests: 'Requests and TWG review', canvass: 'Canvass and awards', orders: 'POs and deliveries',
  ppmp: 'PPMP', users: 'Users, offices and suppliers', settings: 'Settings', account: 'Own account and reminders', other: 'Other',
}
const RESULTS = { ok: ['Done', 'border-green-300 bg-green-50 text-green-800'], refused: ['Refused', 'border-amber-300 bg-amber-50 text-amber-800'], error: ['Error', 'border-red-300 bg-red-50 text-red-700'] }
const ROLES = { admin: 'Admin', procurement: 'Procurement', requestor: 'End User', supply: 'Supply', twg: 'TWG', bac: 'BAC' }
const PAGE_SIZE = 50

// An entry's item, linked where it has a page of its own; one since deleted shows its number.
function Item({ row }) {
  if (!row.target_type) return <span className="text-[--color-text-muted]">—</span>
  const label = row.target_label || `#${row.target_id} (deleted)`
  const to = row.target_label && { pr: `/pr/${row.target_id}`, ppmp: `/ppmp/${row.target_id}`, supplier: `/suppliers/${row.target_id}`, user: `/audit?user=${row.target_id}` }[row.target_type]
  return to ? <Link to={to} className="font-medium text-[--color-brand] hover:underline">{label}</Link> : <span>{label}</span>
}

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
    <div className="space-y-4">
      <div>
        <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">Audit Log</h2>
        <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
          Every change and sign-in in PRimeSys, newest first: who, what, which item, when, and from where. Kept for a year; only administrators see it.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
              <Input placeholder="Search a person, an action, a PR number or an address" value={search} className="pl-9"
                onChange={e => { setSearch(e.target.value); setUrl({ q: e.target.value, page: '' }) }} />
            </div>
            <Select value={filters.user || 'all'} onValueChange={set('user')}>
              <SelectTrigger className="w-52" aria-label="Person"><SelectValue placeholder="Everyone" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {people.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name} ({ROLES[p.role] || p.role})</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.category || 'all'} onValueChange={set('category')}>
              <SelectTrigger className="w-52" aria-label="Kind of activity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All activity</SelectItem>
                {Object.entries(KINDS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.outcome || 'all'} onValueChange={set('outcome')}>
              <SelectTrigger className="w-36" aria-label="Result"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any result</SelectItem>
                {Object.entries(RESULTS).map(([k, [label]]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-ui-xs text-[--color-text-secondary]">
            <span>From</span>
            <Input type="date" value={filters.from} onChange={e => set('from')(e.target.value)} className="h-9 w-40" aria-label="From date" />
            <span>to</span>
            <Input type="date" value={filters.to} onChange={e => set('to')(e.target.value)} className="h-9 w-40" aria-label="To date" />
            {filtering && (
              <Button type="button" variant="ghost" size="sm" className="gap-1"
                onClick={() => { setSearch(''); setUrl({ q: '', user: '', category: '', outcome: '', from: '', to: '', page: '' }) }}>
                <X className="size-3.5" /> Clear filters
              </Button>
            )}
            {data && <span className="ml-auto text-[--color-text-muted]">{data.total.toLocaleString()} {data.total === 1 ? 'entry' : 'entries'}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>From</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? [...Array(6)].map((_, i) => (
                <TableRow key={i}>{[...Array(6)].map((__, k) => <TableCell key={k}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              )) : isError ? (
                <TableEmpty colSpan={6} message={<span className="text-red-500">The audit log could not be loaded.</span>} />
              ) : !rows.length ? (
                <TableRow><TableCell colSpan={6}>
                  <EmptyState icon={ScrollText} title={filtering ? 'Nothing matches these filters' : 'Nothing recorded yet'}
                    sub={filtering ? 'Clear or change a filter.' : 'Changes and sign-ins appear here as people use PRimeSys.'} />
                </TableCell></TableRow>
              ) : rows.map(row => {
                const [result, tone] = RESULTS[row.outcome] || [row.outcome, '']
                return (
                  <TableRow key={row.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-ui-xs tabular-nums text-[--color-text-secondary]">{fmtDatetime(row.created_at)}</TableCell>
                    <TableCell className="text-ui-sm">
                      {row.user_id
                        ? <button type="button" onClick={() => setUrl({ user: row.user_id, page: '' })} className="text-left font-medium text-[--color-text-primary] hover:text-[--color-brand]">{row.user_name || `User #${row.user_id}`}</button>
                        : <span className="text-[--color-text-muted]">Not signed in</span>}
                      {row.user_role && <span className="block text-[11px] text-[--color-text-muted]">{ROLES[row.user_role] || row.user_role}</span>}
                    </TableCell>
                    <TableCell className="text-ui-sm">
                      {row.summary}
                      {row.detail && <span className="block text-[11px] text-[--color-text-muted]">{row.detail}</span>}
                    </TableCell>
                    <TableCell className="text-ui-sm"><Item row={row} /></TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`} title={row.status ? `Answered ${row.status}` : undefined}>{result}</span>
                    </TableCell>
                    <TableCell className="text-[11px] text-[--color-text-muted]">
                      {row.device && <span className="block">{row.device}</span>}
                      {row.ip && <span className="block font-mono">{row.ip.replace(/^::ffff:/, '')}</span>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pager page={page} totalPages={totalPages} summary={`${data?.total?.toLocaleString() || 0} entries`} onPage={p => setUrl({ page: p })} />
        </CardContent>
      </Card>
    </div>
  )
}

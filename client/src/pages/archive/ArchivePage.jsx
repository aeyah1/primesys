import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Archive, Search, FileDown, FileText, CheckCircle2, Clock, XCircle, Wallet, Receipt } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { PRStatusBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

// Every purchase request by the quarter it was filed under (the quarter on
// its form), finished or not, with the quarter's figures and its printable
// Quarter Register. Deleted PRs are kept and open read-only. The year,
// quarter, view, search, and page live in the URL, so a view can be linked.
const VIEWS = [
  { key: 'all',         label: 'All',         count: 'prs' },
  { key: 'completed',   label: 'Completed',   count: 'completed',   params: { status: 'completed' } },
  { key: 'in_progress', label: 'In progress', count: 'in_progress', params: { status: 'draft,submitted,revision_requested,twg_review,bidding,for_po' } },
  { key: 'cancelled',   label: 'Cancelled',   count: 'cancelled',   params: { status: 'cancelled' } },
  { key: 'rejected',    label: 'Rejected',    count: 'rejected',    params: { status: 'rejected' } },
  { key: 'deleted',     label: 'Deleted',     count: 'deleted',     params: { deleted: 'only' } },
]
const PAGE_SIZE = 25

function Figure({ icon: Icon, label, value, detail }) {
  return (
    <Card>
      <CardContent className="py-3.5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[--color-text-muted]">
          <Icon className="size-3.5 text-[--color-brand]" /> {label}
        </p>
        <p className="mt-1 text-ui-lg font-bold tabular-nums text-[--color-text-primary]">{value}</p>
        {detail && <p className="text-[11px] text-[--color-text-secondary]">{detail}</p>}
      </CardContent>
    </Card>
  )
}

export default function ArchivePage() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') || '')
  const update = (changes) => setParams(prev => {
    const next = new URLSearchParams(prev)
    for (const [k, v] of Object.entries(changes)) (v === '' || v == null ? next.delete(k) : next.set(k, String(v)))
    return next
  }, { replace: true })

  const { data: quarters = [], isLoading: loadingQuarters } = useQuery({
    queryKey: ['archive', 'quarters'],
    queryFn: () => api.get('/archive/quarters').then(r => r.data),
  })
  // The quarter asked for, else the current one, else the newest.
  const quarter = quarters.find(q => String(q.id) === params.get('quarter'))
    || quarters.find(q => q.is_active) || quarters[0]
  const years = [...new Set(quarters.map(q => q.year))]
  const view = VIEWS.find(v => v.key === params.get('view')) || VIEWS[0]
  const page = Math.max(parseInt(params.get('page')) || 1, 1)

  const { data: summary } = useQuery({
    queryKey: ['archive', 'quarter', quarter?.id],
    queryFn: () => api.get(`/archive/quarters/${quarter.id}`).then(r => r.data),
    enabled: !!quarter,
  })
  const { data: list, isLoading: loadingList, isError } = useQuery({
    queryKey: ['archive', 'list', quarter?.id, view.key, search, page],
    queryFn: () => api.get(`/pr?${new URLSearchParams({ quarter_id: quarter.id, ...view.params, ...(search ? { search } : {}), page, limit: PAGE_SIZE })}`).then(r => r.data),
    enabled: !!quarter,
    placeholderData: keepPreviousData,
  })
  const totals = summary?.totals

  const printRegister = () => openPdf(`/archive/quarters/${quarter.id}/register`)
    .catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the Quarter Register')))

  if (loadingQuarters) return <div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
  if (!quarter) {
    return (
      <div className="py-20 text-center">
        <Archive className="size-10 text-[--color-text-muted] mx-auto mb-3" />
        <p className="text-ui-sm font-semibold text-[--color-text-primary]">No quarters yet</p>
        <p className="text-ui-xs text-[--color-text-muted] mt-1">An admin sets up the quarters under Quarters; requests are filed under them.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <Archive className="size-5 text-[--color-brand]" />
          <div>
            <h2 className="text-ui-xl font-bold text-[--color-text-primary]">Archive</h2>
            <p className="text-ui-xs text-[--color-text-muted] mt-0.5">Every purchase request, by the quarter it was filed under.</p>
          </div>
        </div>
        <Button className="gap-1.5" onClick={printRegister}><FileDown className="size-4" /> Print Quarter Register</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(quarter.year)} onValueChange={(y) => {
          const first = quarters.find(q => String(q.year) === y)
          update({ quarter: first?.id, page: '' })
        }}>
          <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        {quarters.filter(q => q.year === quarter.year).slice().reverse().map(q => (
          <button key={q.id} onClick={() => update({ quarter: q.id, page: '' })}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-ui-xs font-semibold transition-colors ${
              q.id === quarter.id ? 'border-[--color-brand] bg-[--color-brand] text-white'
                : 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'}`}>
            {q.label}
            <span className={`rounded-full px-1.5 text-[10px] ${q.id === quarter.id ? 'bg-white/20' : 'bg-[--color-overlay] text-[--color-text-muted]'}`}>{q.prs}</span>
            {q.is_active && <span className={`text-[10px] font-medium ${q.id === quarter.id ? 'text-white/80' : 'text-[--color-brand]'}`}>current</span>}
          </button>
        ))}
        <span className="text-ui-xs text-[--color-text-muted] ml-1">{fmtDate(quarter.start_date)} to {fmtDate(quarter.end_date)}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Figure icon={FileText} label="Filed" value={totals?.prs ?? '…'} detail={totals?.deleted ? `${totals.deleted} deleted, kept apart` : null} />
        <Figure icon={CheckCircle2} label="Completed" value={totals?.completed ?? '…'} />
        <Figure icon={Clock} label="In progress" value={totals?.in_progress ?? '…'} />
        <Figure icon={XCircle} label="Cancelled or rejected" value={totals ? totals.cancelled + totals.rejected : '…'} />
        <Figure icon={Wallet} label="Estimated budget" value={totals ? fmtCurrency(totals.budget) : '…'} detail="Cancelled and rejected left out" />
        <Figure icon={Receipt} label="Paid on POs" value={totals ? fmtCurrency(totals.paid) : '…'} detail={totals ? `${totals.pos} PO${totals.pos === 1 ? '' : 's'}, less undelivered balances` : null} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 pt-3 border-b border-[--color-border]">
          <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
            {VIEWS.map(v => {
              const n = totals?.[v.count] ?? 0
              return (
                <button key={v.key} onClick={() => update({ view: v.key === 'all' ? '' : v.key, page: '' })}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                    view.key === v.key ? 'border-[--color-brand] text-[--color-brand]' : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'}`}>
                  {v.label}
                  {n > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${view.key === v.key ? 'bg-[--color-brand-light] text-[--color-brand]' : 'bg-[--color-overlay] text-[--color-text-muted]'}`}>{n}</span>}
                </button>
              )
            })}
          </div>
          <div className="relative w-full sm:w-64 pb-2">
            <Search className="absolute left-3 top-[calc(50%-4px)] -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
            <Input placeholder="Search PR number or purpose…" value={search} className="pl-9 h-9"
              onChange={e => { setSearch(e.target.value); update({ q: e.target.value, page: '' }) }} />
          </div>
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PR</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>{view.key === 'deleted' ? 'Deleted' : 'Filed'}</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Purchase orders</TableHead>
                <TableHead className="text-right">Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingList
                ? Array(5).fill(0).map((_, i) => <TableRow key={i}>{Array(7).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)
                : isError
                  ? <TableEmpty colSpan={7} message={<span className="text-red-500">Failed to load the requests.</span>} />
                  : !list?.data?.length
                    ? <TableEmpty colSpan={7} message={search ? 'No request matches your search.' : `No ${view.key === 'all' ? '' : `${view.label.toLowerCase()} `}requests in ${quarter.label} ${quarter.year}.`} />
                    : list.data.map(pr => (
                      <TableRow key={pr.id}>
                        <TableCell>
                          <Link to={`/pr/${pr.id}`} className="font-mono font-semibold text-[--color-brand] hover:underline whitespace-nowrap">{pr.pr_number}</Link>
                        </TableCell>
                        <TableCell className="max-w-52">
                          <span className="block truncate text-sm text-[--color-text-primary]" title={pr.title}>{pr.title || 'No purpose given'}</span>
                          <span className="block text-xs text-[--color-text-muted]">{[pr.department, pr.created_by_name].filter(Boolean).join(' · ')}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-[--color-text-secondary]">
                          {view.key === 'deleted'
                            ? <>{fmtDate(pr.deleted_at)}{pr.deleted_by_name && <span className="block text-xs text-[--color-text-muted]">by {pr.deleted_by_name}</span>}</>
                            : fmtDate(pr.created_at)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums text-sm whitespace-nowrap ${['cancelled', 'rejected'].includes(pr.status) ? 'text-[--color-text-muted] line-through' : ''}`}
                          title={['cancelled', 'rejected'].includes(pr.status) ? 'Not counted in the quarter budget' : undefined}>{fmtCurrency(pr.estimated_total)}</TableCell>
                        <TableCell><PRStatusBadge status={pr.status} /></TableCell>
                        <TableCell className="text-sm">
                          {pr.po_count > 0 ? (
                            <>
                              <span className="font-mono text-xs font-semibold text-[--color-text-primary]">{pr.po_number}{pr.po_count > 1 ? ` +${pr.po_count - 1}` : ''}</span>
                              <span className="block max-w-36 truncate text-xs text-[--color-text-muted]" title={pr.supplier_name}>{pr.supplier_name}</span>
                              {pr.delivery_date && <span className="block text-[11px] text-emerald-700">Delivered {fmtDate(pr.delivery_date)}</span>}
                            </>
                          ) : <span className="text-xs text-[--color-text-muted]">None</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-semibold">
                          {pr.po_count > 0 ? fmtCurrency(pr.total_amount) : ''}
                        </TableCell>
                      </TableRow>
                    ))}
            </TableBody>
          </Table>

          {list && list.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[--color-border]">
              <span className="text-xs text-[--color-text-muted]">Page {list.page} of {list.totalPages} · {list.total} requests</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => update({ page: page - 1 > 1 ? page - 1 : '' })} disabled={page <= 1}>Previous</Button>
                <Button variant="secondary" size="sm" onClick={() => update({ page: page + 1 })} disabled={page >= list.totalPages}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

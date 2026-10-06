import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Archive, Search, FileDown, Download, FileText, CheckCircle2, Clock, XCircle, Wallet, Receipt, ArrowUpDown } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { PRStatusBadge } from '@/components/shared/StatusBadge'
import { Tab, Pager } from '@/components/shared/ListParts'
import useUrlParams from '@/hooks/useUrlParams'
import { fmtDate, fmtCurrency, CATEGORY_LABELS, PR_STATUS_LABELS } from '@/lib/utils'
import { openPdf, blobErrorMessage, downloadCSV } from '@/lib/download'
import api from '@/lib/axios'

// Every purchase request the user may see, by the quarter it was filed under
// (the quarter on its form) or by that quarter's year, finished or not, with
// the period's figures, its printable register, and a CSV of the list.
// Deleted PRs are kept and open read-only. Every choice lives in the URL.
const VIEWS = [
  { key: 'all',         label: 'All',         count: 'prs' },
  { key: 'completed',   label: 'Completed',   count: 'completed',   params: { status: 'completed' } },
  { key: 'in_progress', label: 'In progress', count: 'in_progress', params: { status: 'draft,submitted,revision_requested,twg_review,bidding,twg_certification,bac_review,for_po' } },
  { key: 'cancelled',   label: 'Cancelled',   count: 'cancelled',   params: { status: 'cancelled' } },
  { key: 'rejected',    label: 'Rejected',    count: 'rejected',    params: { status: 'rejected' } },
  { key: 'deleted',     label: 'Deleted',     count: 'deleted',     params: { deleted: 'only' } },
]
// Server-side orders (pr.controller LIST_SORTS).
const SORTS = [
  { key: 'newest',    label: 'Newest first' },
  { key: 'oldest',    label: 'Oldest first' },
  { key: 'total',     label: 'Largest budget' },
  { key: 'pr_number', label: 'PR number' },
]
const PAGE_SIZE = 25
const ANY = 'any'          // a Select needs a value for "every category" and "every office"
const EXPORT_PAGES = 50    // a CSV holds at most 5,000 requests

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

// A period to pick: one quarter, or the whole year.
function PeriodPill({ active, count, note, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-ui-xs font-semibold transition-colors ${
        active ? 'border-[--color-brand] bg-[--color-brand] text-white'
          : 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'}`}>
      {children}
      <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/20' : 'bg-[--color-overlay] text-[--color-text-muted]'}`}>{count}</span>
      {note && <span className={`text-[10px] font-medium ${active ? 'text-white/80' : 'text-[--color-brand]'}`}>{note}</span>}
    </button>
  )
}

export default function ArchivePage() {
  const [params, update] = useUrlParams()
  const [search, setSearch] = useState(params.get('q') || '')
  const [exporting, setExporting] = useState(false)

  const { data: quarters = [], isLoading: loadingQuarters } = useQuery({
    queryKey: ['archive', 'quarters'],
    queryFn: () => api.get('/archive/quarters').then(r => r.data),
  })
  const { data: offices = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then(r => r.data),
  })
  const years = [...new Set(quarters.map(q => q.year))]
  // A whole year (?year=), else the quarter asked for, else the current one, else the newest.
  const wholeYear = years.includes(Number(params.get('year'))) ? Number(params.get('year')) : null
  const quarter = wholeYear ? null
    : quarters.find(q => String(q.id) === params.get('quarter')) || quarters.find(q => q.is_current) || quarters[0]
  const year = wholeYear ?? quarter?.year
  const view = VIEWS.find(v => v.key === params.get('view')) || VIEWS[0]
  const sort = SORTS.some(s => s.key === params.get('sort')) ? params.get('sort') : 'newest'
  const category = CATEGORY_LABELS[params.get('category')] ? params.get('category') : ''
  const office = /^\d+$/.test(params.get('office') || '') ? params.get('office') : ''
  const page = Math.max(parseInt(params.get('page')) || 1, 1)

  const periodPath = wholeYear ? `/archive/years/${wholeYear}` : quarter ? `/archive/quarters/${quarter.id}` : null
  const periodName = wholeYear ? `${wholeYear}` : quarter ? `${quarter.label} ${quarter.year}` : ''
  const filter = {
    ...(wholeYear ? { year: wholeYear } : { quarter_id: quarter?.id }), ...view.params, sort,
    ...(search ? { search } : {}), ...(category ? { category } : {}), ...(office ? { department_id: office } : {}),
  }

  const { data: summary } = useQuery({
    queryKey: ['archive', 'period', periodPath],
    queryFn: () => api.get(periodPath).then(r => r.data),
    enabled: !!periodPath,
  })
  const { data: list, isLoading: loadingList, isError } = useQuery({
    queryKey: ['archive', 'list', filter, page],
    queryFn: () => api.get(`/pr?${new URLSearchParams({ ...filter, page, limit: PAGE_SIZE })}`).then(r => r.data),
    enabled: !!periodPath,
    placeholderData: keepPreviousData,
  })
  const totals = summary?.totals

  const printRegister = () => openPdf(`${periodPath}/register`)
    .catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the register')))

  // Every request in the current view, page by page, saved as one CSV file.
  const exportCSV = async () => {
    setExporting(true)
    try {
      const rows = []
      for (let p = 1; p <= EXPORT_PAGES; p++) {
        const { data } = await api.get(`/pr?${new URLSearchParams({ ...filter, page: p, limit: 100 })}`)
        rows.push(...data.data)
        if (p >= data.totalPages) break
      }
      const deleted = view.key === 'deleted'
      downloadCSV(`PRimeSys-Archive-${periodName.replace(' ', '-')}-${view.key}.csv`, [
        ['PR No.', 'Purpose', 'Office', 'Filed by', deleted ? 'Deleted' : 'Filed', 'Status', 'Budget', 'Purchase orders', 'Suppliers', 'Paid',
          ...(deleted ? ['Deleted by', 'Reason'] : [])],
        ...rows.map(pr => [
          pr.pr_number, pr.title || '', pr.department || '', pr.created_by_name || '',
          fmtDate(deleted ? pr.deleted_at : pr.created_at), PR_STATUS_LABELS[pr.status] || pr.status,
          Number(pr.estimated_total) || 0,
          pr.po_count > 0 ? `${pr.po_number}${pr.po_count > 1 ? ` +${pr.po_count - 1}` : ''}` : '',
          pr.supplier_name || '', pr.po_count > 0 ? Number(pr.total_amount) || 0 : '',
          ...(deleted ? [pr.deleted_by_name || '', pr.delete_reason || ''] : []),
        ]),
      ])
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not export the list')
    } finally {
      setExporting(false)
    }
  }

  if (loadingQuarters) return <div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
  if (!periodPath) {
    return (
      <div className="py-20 text-center">
        <Archive className="size-10 text-[--color-text-muted] mx-auto mb-3" />
        <p className="text-ui-sm font-semibold text-[--color-text-primary]">No quarters yet</p>
        <p className="text-ui-xs text-[--color-text-muted] mt-1">Quarters are added on their own: the current year's, and each year an office uploads a PPMP for.</p>
      </div>
    )
  }

  const inYear = quarters.filter(q => q.year === year)
  const range = wholeYear ? [`${wholeYear}-01-01`, `${wholeYear}-12-31`] : [quarter.start_date, quarter.end_date]
  const filtered = search || category || office

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <Archive className="size-5 text-[--color-brand]" />
          <div>
            <h2 className="text-ui-xl font-bold text-[--color-text-primary]">Archive</h2>
            <p className="text-ui-xs text-[--color-text-muted] mt-0.5">Every purchase request you can see, by the quarter or the year it was filed under.</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" className="gap-1.5" onClick={exportCSV} disabled={exporting || !list?.total}>
            <Download className="size-4" /> {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
          <Button className="gap-1.5" onClick={printRegister}><FileDown className="size-4" /> Print Register</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(year)} onValueChange={(y) => update({ year: y, quarter: '', page: '' })}>
          <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        <PeriodPill active={!!wholeYear} count={inYear.reduce((n, q) => n + q.prs, 0)} onClick={() => update({ year, quarter: '', page: '' })}>
          Whole year
        </PeriodPill>
        {inYear.slice().reverse().map(q => (
          <PeriodPill key={q.id} active={q.id === quarter?.id} count={q.prs} note={q.is_current ? 'current' : null}
            onClick={() => update({ quarter: q.id, year: '', page: '' })}>
            {q.label}
          </PeriodPill>
        ))}
        <span className="text-ui-xs text-[--color-text-muted] ml-1">{fmtDate(range[0])} to {fmtDate(range[1])}</span>
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
            {VIEWS.map(v => (
              <Tab key={v.key} active={view.key === v.key} count={totals?.[v.count] ?? 0}
                onClick={() => update({ view: v.key === 'all' ? '' : v.key, page: '' })}>
                {v.label}
              </Tab>
            ))}
          </div>
          <div className="relative w-full sm:w-64 pb-2">
            <Search className="absolute left-3 top-[calc(50%-4px)] -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
            <Input placeholder="Search PR number or purpose…" value={search} className="pl-9 h-9"
              onChange={e => { setSearch(e.target.value); update({ q: e.target.value, page: '' }) }} />
          </div>
        </div>

        {/* Category, office, and order */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[--color-border]">
          <Select value={category || ANY} onValueChange={v => update({ category: v === ANY ? '' : v, page: '' })}>
            <SelectTrigger className="h-8 w-48 text-ui-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY} className="text-ui-xs">All categories</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => <SelectItem key={k} value={k} className="text-ui-xs">{label}</SelectItem>)}
            </SelectContent>
          </Select>
          {offices.length > 1 && (
            <Select value={office || ANY} onValueChange={v => update({ office: v === ANY ? '' : v, page: '' })}>
              <SelectTrigger className="h-8 w-48 text-ui-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY} className="text-ui-xs">All offices</SelectItem>
                {offices.map(o => <SelectItem key={o.id} value={String(o.id)} className="text-ui-xs">{o.code}: {o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <ArrowUpDown className="size-3.5 text-[--color-text-muted]" />
            <Select value={sort} onValueChange={v => update({ sort: v === 'newest' ? '' : v, page: '' })}>
              <SelectTrigger className="h-8 w-44 text-ui-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORTS.map(s => <SelectItem key={s.key} value={s.key} className="text-ui-xs">{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
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
                    ? <TableEmpty colSpan={7} message={filtered ? 'No request matches these filters.' : `No ${view.key === 'all' ? '' : `${view.label.toLowerCase()} `}requests in ${periodName}.`} />
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
                            ? <>{fmtDate(pr.deleted_at)}{pr.deleted_by_name && <span className="block text-xs text-[--color-text-muted]">by {pr.deleted_by_name}</span>}
                                {pr.delete_reason && <span className="block max-w-48 truncate text-xs text-[--color-text-muted]" title={pr.delete_reason}>{pr.delete_reason}</span>}</>
                            : fmtDate(pr.created_at)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums text-sm whitespace-nowrap ${['cancelled', 'rejected'].includes(pr.status) ? 'text-[--color-text-muted] line-through' : ''}`}
                          title={['cancelled', 'rejected'].includes(pr.status) ? 'Not counted in the budget' : undefined}>{fmtCurrency(pr.estimated_total)}</TableCell>
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

          <Pager page={page} totalPages={list?.totalPages} summary={`${list?.total} requests`}
            onPage={(n) => update({ page: n > 1 ? n : '' })} />
        </CardContent>
      </Card>
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, FileText, Pencil, Trash2, Eye, ArrowUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { PRStatusBadge, DeliveryStatusBadge, CategoryBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency, localToday, CATEGORY_LABELS } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

// Status tabs in workflow order. "Approved by TWG" is Procurement's inbox.
const TABS = [
  { key: 'all',                label: 'All' },
  { key: 'draft',              label: 'Draft' },
  { key: 'submitted',          label: 'At TWG' },
  { key: 'revision_requested', label: 'Revision' },
  { key: 'twg_review',         label: 'Approved by TWG' },
  { key: 'bidding',            label: 'Bidding' },
  { key: 'for_po',             label: 'Ready for PO' },
  { key: 'completed',          label: 'Completed' },
  { key: 'rejected',           label: 'Rejected' },
  { key: 'cancelled',          label: 'Cancelled' },
]
// Server-side orders (pr.controller LIST_SORTS).
const SORTS = [
  { key: 'newest',          label: 'Newest first' },
  { key: 'oldest_approval', label: 'Oldest TWG approval first' },
  { key: 'date_needed',     label: 'Date needed, soonest' },
  { key: 'total',           label: 'Largest estimated total' },
]
const CATEGORIES = Object.keys(CATEGORY_LABELS)
const FINAL      = ['completed', 'cancelled', 'rejected']
const daysSince  = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5))

// Amount: the PO total once there is a PO, before that the items' estimate.
function Amount({ pr }) {
  if (pr.total_amount) return <span className="text-[--color-text-secondary]">{fmtCurrency(pr.total_amount)}</span>
  if (Number(pr.estimated_total) > 0) {
    return <span className="text-[--color-text-muted]" title="Estimated from the PR items">est. {fmtCurrency(pr.estimated_total)}</span>
  }
  return <span className="text-[--color-text-muted]">—</span>
}

export default function PRList() {
  const { user }     = useAuth()
  const navigate     = useNavigate()
  const qc           = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState(null)

  // Tab, category, sort, search, and page live in the URL, so the back button,
  // a refresh, and a shared link all keep the same view.
  const [params, setParams] = useSearchParams()
  const tab      = TABS.some(t => t.key === params.get('status')) ? params.get('status') : 'all'
  const category = CATEGORIES.includes(params.get('category')) ? params.get('category') : ''
  const sort     = SORTS.some(s => s.key === params.get('sort')) ? params.get('sort')
                 : tab === 'twg_review' ? 'oldest_approval' : 'newest'
  const page     = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')
  const update = (changes) => setParams(prev => {
    const next = new URLSearchParams(prev)
    for (const [k, v] of Object.entries(changes)) (v === '' || v == null ? next.delete(k) : next.set(k, String(v)))
    return next
  }, { replace: true })

  const isRequestor = user?.role === 'requestor'
  const isStaff     = ['procurement', 'admin'].includes(user?.role)

  // Server-backed "I've opened this PR" set, for the NEW marker on TWG
  // approvals Procurement hasn't looked at yet.
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
      const q = new URLSearchParams({ page, limit: 10, sort })
      if (search)        q.set('search', search)
      if (tab !== 'all') q.set('status', tab)
      if (category)      q.set('category', category)
      return api.get(`/pr?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })

  const { mutate: deletePR, isPending: deleting } = useMutation({
    mutationFn: (id) => api.delete(`/pr/${id}`),
    onSuccess: () => {
      toast.success('Purchase request deleted')
      qc.invalidateQueries({ queryKey: ['pr-list'] })
      qc.invalidateQueries({ queryKey: ['pr-stats'] })
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete PR'),
  })

  const canCreate = ['admin', 'procurement', 'requestor'].includes(user?.role)
  const today     = localToday()

  // column count for empty/skeleton states
  const colCount = isStaff ? 11 : isRequestor ? 8 : 7

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input
            placeholder="Search by PR number or title…"
            value={search}
            onChange={e => { setSearch(e.target.value); update({ q: e.target.value, page: '' }) }}
            className="pl-9"
          />
        </div>
        {canCreate && (
          <Button asChild className="ml-auto gap-1.5">
            <Link to="/pr/create"><Plus className="size-4" /> New Purchase Request</Link>
          </Button>
        )}
      </div>

      <Card>
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-[--color-border] overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => update({ status: t.key === 'all' ? '' : t.key, sort: '', page: '' })}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                tab === t.key
                  ? 'border-[--color-brand] text-[--color-brand]'
                  : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
              }`}
            >
              {t.label}
              {tabCount(t.key) > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  tab === t.key ? 'bg-[--color-brand-light] text-[--color-brand]' : 'bg-[--color-overlay] text-[--color-text-muted]'
                }`}>{tabCount(t.key)}</span>
              )}
            </button>
          ))}
        </div>

        {/* Category filter (counts follow the tab) and sort order */}
        <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-[--color-border]">
          <div className="flex flex-wrap gap-1.5">
            {['', ...CATEGORIES].map(c => {
              const n = c ? catCount(c) : tabCount(tab)
              return (
                <button key={c || 'all'} onClick={() => update({ category: c, page: '' })}
                  className={`rounded-full border px-3 py-1 text-ui-xs font-medium transition-colors ${
                    category === c
                      ? 'border-[--color-brand] bg-[--color-brand] text-white'
                      : n
                        ? 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'
                        : 'border-[--color-border] bg-white text-[--color-text-muted] hover:border-[--color-border-strong]'
                  }`}>
                  {c ? CATEGORY_LABELS[c] : 'All categories'} <span className="opacity-80">({n})</span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ArrowUpDown className="size-3.5 text-[--color-text-muted]" />
            <Select value={sort} onValueChange={v => update({ sort: v, page: '' })}>
              <SelectTrigger className="h-8 w-56 text-ui-xs"><SelectValue /></SelectTrigger>
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
                {isStaff && <TableHead className="w-24 p-0" />}
                <TableHead>PR Number</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>{isStaff ? 'Request' : 'Title'}</TableHead>
                {isStaff && <TableHead>TWG Review</TableHead>}
                {isStaff && <TableHead>Needed By</TableHead>}
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>PR Status</TableHead>
                <TableHead>Delivery</TableHead>
                {!isStaff && <TableHead>Filed</TableHead>}
                {(isRequestor || isStaff) && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      {Array(colCount).fill(0).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : isError
                  ? (
                    <TableEmpty colSpan={colCount}>
                      <p className="text-red-500">Failed to load purchase requests.</p>
                    </TableEmpty>
                  )
                : data?.data?.length === 0
                  ? (
                    <TableEmpty colSpan={colCount}>
                      <FileText className="size-8 text-[--color-text-muted] mx-auto mb-2" />
                      <p>No purchase requests found.</p>
                      {(category || tab !== 'all') && <p className="text-ui-xs mt-1">Try another tab or category.</p>}
                    </TableEmpty>
                  )
                  : data?.data?.map(pr => {
                      // TWG approvals this user hasn't opened yet: Procurement's new work.
                      const isNew    = isStaff && pr.status === 'twg_review' && !readSet.has(String(pr.id))
                      const isOpened = isStaff && pr.status === 'twg_review' && readSet.has(String(pr.id))
                      const waiting  = pr.status === 'twg_review' && pr.twg_reviewed_at ? daysSince(pr.twg_reviewed_at) : null
                      const neededLate = pr.date_needed && pr.date_needed < today && !FINAL.includes(pr.status)
                      return (
                        <TableRow
                          key={pr.id}
                          className={`cursor-pointer transition-colors ${isNew ? 'bg-amber-50/50' : ''}`}
                          onClick={() => navigate(`/pr/${pr.id}`)}
                        >
                          {isStaff && (
                            <TableCell className="p-1.5 w-24">
                              {isNew ? (
                                <div className="flex flex-col items-center justify-center rounded-lg bg-amber-500 px-1.5 py-2 text-center leading-tight select-none">
                                  <span className="text-[10px] font-bold text-white uppercase tracking-wide">New</span>
                                  <span className="text-[10px] font-bold text-white uppercase tracking-wide">Approval</span>
                                </div>
                              ) : isOpened ? (
                                <div className="flex flex-col items-center justify-center rounded-lg border border-[--color-border] bg-[--color-canvas] px-1.5 py-2 text-center leading-tight select-none">
                                  <Eye className="size-3 text-[--color-text-muted] mb-0.5" />
                                  <span className="text-[10px] text-[--color-text-muted] uppercase tracking-wide">Opened</span>
                                </div>
                              ) : null}
                            </TableCell>
                          )}

                          <TableCell className="font-mono font-semibold text-[--color-brand] whitespace-nowrap">
                            {pr.pr_number}
                          </TableCell>
                          <TableCell><CategoryBadge category={pr.category} /></TableCell>
                          <TableCell className="text-sm max-w-56">
                            <p className="truncate text-[--color-text-primary]">
                              {pr.title || <span className="text-[--color-text-muted] italic">No title</span>}
                            </p>
                            {isStaff && (
                              <p className="truncate text-[11px] text-[--color-text-muted] mt-0.5">
                                {pr.created_by_name}{pr.department ? ` · ${pr.department}` : ''}
                              </p>
                            )}
                          </TableCell>
                          {isStaff && (
                            <TableCell className="text-sm whitespace-nowrap">
                              {pr.twg_reviewer_name && pr.twg_reviewed_at ? (
                                <>
                                  <p className="text-[--color-text-secondary]">{pr.twg_reviewer_name}</p>
                                  <p className={`text-[11px] mt-0.5 ${waiting > 3 ? 'text-amber-700 font-medium' : 'text-[--color-text-muted]'}`}>
                                    {fmtDate(pr.twg_reviewed_at)}{waiting !== null && ` · waiting ${waiting} day${waiting === 1 ? '' : 's'}`}
                                  </p>
                                </>
                              ) : <span className="text-[--color-text-muted]">—</span>}
                            </TableCell>
                          )}
                          {isStaff && (
                            <TableCell className={`text-sm whitespace-nowrap ${neededLate ? 'text-red-600 font-medium' : 'text-[--color-text-secondary]'}`}>
                              {pr.date_needed ? fmtDate(pr.date_needed) : <span className="text-[--color-text-muted]">—</span>}
                            </TableCell>
                          )}
                          <TableCell className="text-right text-sm whitespace-nowrap"><Amount pr={pr} /></TableCell>
                          <TableCell><PRStatusBadge status={pr.status} /></TableCell>
                          <TableCell>
                            {pr.po_id
                              ? <DeliveryStatusBadge status={pr.delivery_status} />
                              : <span className="text-xs text-[--color-text-muted]">No PO yet</span>
                            }
                          </TableCell>
                          {!isStaff && (
                            <TableCell className="text-sm text-[--color-text-muted] whitespace-nowrap">
                              {fmtDate(pr.created_at)}
                            </TableCell>
                          )}

                          {/* Actions column */}
                          {(isRequestor || isStaff) && (
                            <TableCell onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                {isRequestor && pr.permissions?.edit && (
                                  <button
                                    onClick={() => navigate(`/pr/${pr.id}/edit`)}
                                    title="Edit PR"
                                    className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors"
                                  >
                                    <Pencil className="size-3.5" />
                                  </button>
                                )}
                                {pr.permissions?.delete && (
                                  <button
                                    onClick={() => setDeleteTarget(pr)}
                                    title="Delete PR"
                                    className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })
              }
            </TableBody>
          </Table>

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[--color-border]">
              <span className="text-xs text-[--color-text-muted]">
                Page {data.page} of {data.totalPages} · {data.total} total
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => update({ page: page - 1 })} disabled={page <= 1}>Previous</Button>
                <Button variant="secondary" size="sm" onClick={() => update({ page: page + 1 })} disabled={page >= data.totalPages}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
        <DialogContent title="Delete Purchase Request">
          <p className="text-sm text-[--color-text-secondary] pt-1">
            Delete <strong>{deleteTarget?.pr_number}</strong>? It will be removed from active lists and kept in the Archive under Deleted.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deletePR(deleteTarget.id)} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

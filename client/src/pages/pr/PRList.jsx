import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, FileText, Pencil, Trash2, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { PRStatusBadge, DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const TABS = [
  { key: 'all',       label: 'All' },
  { key: 'draft',     label: 'Draft' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'bidding',   label: 'Bidding' },
  { key: 'awarded',   label: 'Awarded' },
  { key: 'for_po',    label: 'Ready for PO' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
]

export default function PRList() {
  const { user }     = useAuth()
  const navigate     = useNavigate()
  const qc           = useQueryClient()
  const [search, setSearch] = useState('')
  const [tab, setTab]       = useState('all')
  const [page, setPage]     = useState(1)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const isExtension   = user?.role === 'extension'
  const isProcurement = ['procurement', 'admin'].includes(user?.role)

  // Server-backed "I've viewed this PR" set. Only fetched for procurement/admin
  // because that's the only role that uses the unread highlight.
  const { data: readSet = new Set() } = useQuery({
    queryKey: ['pr-reads', user?.id],
    queryFn: () => api.get('/pr/reads').then(r => new Set(r.data.map(String))),
    enabled: isProcurement,
    staleTime: 60_000,
  })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['pr-list', { search, tab, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page, limit: 10 })
      if (search)        params.set('search', search)
      if (tab !== 'all') params.set('status', tab)
      return api.get(`/pr?${params}`).then(r => r.data)
    },
    keepPreviousData: true,
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

  const canCreate = ['admin', 'procurement', 'extension'].includes(user?.role)

  // column count for empty/skeleton states
  let colCount = 7
  if (isProcurement) colCount = 9  // +1 for left indicator column, +1 for actions column
  if (isExtension)   colCount = 8  // +1 for actions column

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input
            placeholder="Search by PR number or title…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
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
              onClick={() => { setTab(t.key); setPage(1) }}
              className={`flex items-center px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                tab === t.key
                  ? 'border-[--color-brand] text-[--color-brand]'
                  : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {isProcurement && <TableHead className="w-24 p-0" />}
                <TableHead>PR Number</TableHead>
                <TableHead>Quarter</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>PR Status</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Date</TableHead>
                {(isExtension || isProcurement) && <TableHead className="w-20" />}
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
                    </TableEmpty>
                  )
                  : data?.data?.map(pr => {
                      const isUnread = isProcurement && pr.status === 'submitted' && !readSet.has(String(pr.id))
                      const isReadSubmitted = isProcurement && pr.status === 'submitted' && readSet.has(String(pr.id))
                      return (
                        <TableRow
                          key={pr.id}
                          className={`cursor-pointer transition-colors ${isUnread ? 'bg-amber-50/50' : ''}`}
                          onClick={() => navigate(`/pr/${pr.id}`)}
                        >
                          {/* Left indicator column — procurement only */}
                          {isProcurement && (
                            <TableCell className="p-1.5 w-24">
                              {isUnread ? (
                                <div className="flex flex-col items-center justify-center rounded-lg bg-amber-500 px-1.5 py-2 text-center leading-tight select-none">
                                  <span className="text-[10px] font-bold text-white uppercase tracking-wide">New</span>
                                  <span className="text-[10px] font-bold text-white uppercase tracking-wide">Submission</span>
                                </div>
                              ) : isReadSubmitted ? (
                                <div className="flex flex-col items-center justify-center rounded-lg border border-[--color-border] bg-[--color-canvas] px-1.5 py-2 text-center leading-tight select-none">
                                  <Eye className="size-3 text-[--color-text-muted] mb-0.5" />
                                  <span className="text-[10px] text-[--color-text-muted] uppercase tracking-wide">Reviewed</span>
                                </div>
                              ) : null}
                            </TableCell>
                          )}

                          <TableCell className="font-mono font-semibold text-[--color-brand]">
                            {pr.pr_number}
                          </TableCell>
                          <TableCell className="text-sm font-medium text-[--color-text-secondary] whitespace-nowrap">
                            {pr.quarter_label ? `${pr.quarter_label} ${pr.quarter_year}` : <span className="text-[--color-text-muted]">—</span>}
                          </TableCell>
                          <TableCell className="text-sm text-[--color-text-primary] max-w-48 truncate">
                            {pr.title || <span className="text-[--color-text-muted] italic">No title</span>}
                          </TableCell>
                          <TableCell className="text-right text-sm text-[--color-text-secondary]">
                            {pr.total_amount ? fmtCurrency(pr.total_amount) : '—'}
                          </TableCell>
                          <TableCell><PRStatusBadge status={pr.status} /></TableCell>
                          <TableCell>
                            {pr.po_id
                              ? <DeliveryStatusBadge status={pr.delivery_status} />
                              : <span className="text-xs text-[--color-text-muted]">No PO yet</span>
                            }
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-[--color-text-muted]">{fmtDate(pr.created_at)}</div>
                            {isProcurement && pr.created_by_name && (
                              <div className="text-[11px] text-[--color-text-muted] mt-0.5">
                                by {pr.created_by_name}
                              </div>
                            )}
                          </TableCell>

                          {/* Actions column */}
                          {(isExtension || isProcurement) && (
                            <TableCell onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                {isExtension && pr.created_by === user?.id && (
                                  <>
                                    {pr.status === 'draft' && (
                                      <button
                                        onClick={() => navigate(`/pr/${pr.id}/edit`)}
                                        title="Edit PR"
                                        className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors"
                                      >
                                        <Pencil className="size-3.5" />
                                      </button>
                                    )}
                                    {pr.status === 'draft' && (
                                      <button
                                        onClick={() => setDeleteTarget(pr)}
                                        title="Delete PR"
                                        className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors"
                                      >
                                        <Trash2 className="size-3.5" />
                                      </button>
                                    )}
                                  </>
                                )}
                                {isProcurement && (
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
                <Button variant="secondary" size="sm" onClick={() => setPage(p => p - 1)} disabled={page <= 1}>Previous</Button>
                <Button variant="secondary" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= data.totalPages}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
        <DialogContent title="Delete Purchase Request">
          <p className="text-sm text-[--color-text-secondary] pt-1">
            Permanently delete <strong>{deleteTarget?.pr_number}</strong>? This cannot be undone.
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

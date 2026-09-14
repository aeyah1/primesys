import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Search, ShoppingCart, FileDown, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { DeliveryStatusBadge, POStatusBadge } from '@/components/shared/StatusBadge'
import PODetailDialog from '@/components/delivery/PODetailDialog'
import ReceiveDialog from '@/components/delivery/ReceiveDialog'
import { receivedText } from '@/components/delivery/shared'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

// Views (po.controller VIEWS): the work to receive first.
const TABS = [
  { key: 'all',       label: 'Active' },
  { key: 'overdue',   label: 'Overdue' },
  { key: 'due_week',  label: 'Due this week' },
  { key: 'pending',   label: 'Nothing delivered' },
  { key: 'partial',   label: 'Partly delivered' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
]
const PAGE_SIZE = 20

export default function POList() {
  const { user } = useAuth()
  const canReceive = ['admin', 'procurement', 'supply'].includes(user?.role)

  // View, search, page, and the PO being viewed live in the URL, so a link
  // (e.g. from Deliveries or the dashboard) opens the same view.
  const [params, setParams] = useSearchParams()
  const view  = TABS.some(t => t.key === params.get('view')) ? params.get('view') : 'all'
  const page  = Math.max(parseInt(params.get('page')) || 1, 1)
  const open  = params.get('po')
  const [search, setSearch]       = useState(params.get('q') || params.get('search') || '')
  const [receiving, setReceiving] = useState(null)
  const update = (changes) => setParams(prev => {
    const next = new URLSearchParams(prev)
    for (const [k, v] of Object.entries(changes)) (v === '' || v == null ? next.delete(k) : next.set(k, String(v)))
    next.delete('search')   // older links used ?search=
    return next
  }, { replace: true })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['po-list', { search, view, page }],
    queryFn: () => {
      const q = new URLSearchParams({ page, limit: PAGE_SIZE, view })
      if (search) q.set('search', search)
      return api.get(`/po?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })
  const pdf = (po) => openPdf(`/po/${po.id}/pdf`).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the PO')))

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
        <Input
          placeholder="Search by PO number, PR, or supplier…"
          value={search}
          onChange={e => { setSearch(e.target.value); update({ q: e.target.value, page: '' }) }}
          className="pl-9"
        />
      </div>

      <Card>
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-[--color-border] overflow-x-auto">
          {TABS.map(t => {
            const n = data?.counts?.[t.key] ?? 0
            const alert = t.key === 'overdue' && n > 0
            return (
              <button key={t.key} onClick={() => update({ view: t.key === 'all' ? '' : t.key, page: '' })}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                  view === t.key ? 'border-[--color-brand] text-[--color-brand]' : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
                }`}>
                {t.label}
                {n > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    alert ? 'bg-red-50 border border-red-300 text-red-700'
                      : view === t.key ? 'bg-[--color-brand-light] text-[--color-brand]' : 'bg-[--color-overlay] text-[--color-text-muted]'
                  }`}>{n}</span>
                )}
              </button>
            )
          })}
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO Number</TableHead>
                <TableHead>PR</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>{Array(8).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                  ))
                : isError
                  ? <TableEmpty colSpan={8} message={<span className="text-red-500">Failed to load purchase orders.</span>} />
                  : !data?.data?.length
                    ? (
                      <TableEmpty colSpan={8} message={
                        <>
                          <ShoppingCart className="block size-8 text-[--color-text-muted] mx-auto mb-2" />
                          <span>{search ? 'No purchase orders match your search.' : view === 'overdue' ? 'Nothing is overdue.' : 'No purchase orders here.'}</span>
                        </>
                      } />
                    )
                    : data.data.map(po => {
                        const openPO = po.po_status === 'active' && po.delivery_status !== 'delivered'
                        return (
                          <TableRow key={po.id} className={`cursor-pointer ${po.po_status === 'cancelled' ? 'opacity-60' : ''}`}
                            onClick={() => update({ po: po.id })}>
                            <TableCell className="font-mono font-semibold text-[--color-brand]">{po.po_number}</TableCell>
                            <TableCell>
                              <Link to={`/pr/${po.pr_id}`} onClick={e => e.stopPropagation()}
                                className="font-mono text-sm text-[--color-text-secondary] hover:text-[--color-brand] hover:underline">{po.pr_number}</Link>
                            </TableCell>
                            <TableCell className="text-sm text-[--color-text-primary]">{po.supplier_name}</TableCell>
                            <TableCell className="text-right text-sm font-medium tabular-nums">{fmtCurrency(po.total_amount)}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              {po.expected_delivery_date ? (
                                <span className={po.is_overdue ? 'font-semibold text-red-700' : 'text-[--color-text-secondary]'}>{fmtDate(po.expected_delivery_date)}</span>
                              ) : <span className="text-[--color-text-muted]">Not set</span>}
                              {po.is_overdue && <span className="block text-[11px] font-medium text-red-600">{po.days_late} days late</span>}
                              {!po.is_overdue && po.rescheduled_at && <span className="block text-[11px] text-[--color-text-muted]" title={po.reschedule_reason}>Moved</span>}
                            </TableCell>
                            <TableCell className="text-xs text-[--color-text-secondary] whitespace-nowrap">{receivedText(po) || <span className="text-[--color-text-muted]">—</span>}</TableCell>
                            <TableCell>{po.po_status === 'cancelled' ? <POStatusBadge status="cancelled" /> : <DeliveryStatusBadge status={po.delivery_status} />}</TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                                {canReceive && openPO && (
                                  <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setReceiving(po.id)}>
                                    <Truck className="size-3.5" /> Receive
                                  </Button>
                                )}
                                <button onClick={() => pdf(po)} title="Purchase order (PDF)"
                                  className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors">
                                  <FileDown className="size-4" />
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
              }
            </TableBody>
          </Table>

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[--color-border]">
              <span className="text-xs text-[--color-text-muted]">Page {data.page} of {data.totalPages} · {data.total} total</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => update({ page: page - 1 > 1 ? page - 1 : '' })} disabled={page <= 1}>Previous</Button>
                <Button variant="secondary" size="sm" onClick={() => update({ page: page + 1 })} disabled={page >= data.totalPages}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PODetailDialog poId={open} onClose={() => update({ po: '' })} />
      {receiving && <ReceiveDialog poId={receiving} open onClose={() => setReceiving(null)} />}
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ShoppingCart, FileDown, Truck } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { DeliveryStatusBadge, POStatusBadge } from '@/components/shared/StatusBadge'
import PageHeader from '@/components/shared/PageHeader'
import { TabBar, Tab, Toolbar, SearchBox, ListCount, SkeletonRows, EmptyRow, Pager } from '@/components/shared/ListParts'
import PODetailDialog from '@/components/delivery/PODetailDialog'
import ReceiveDialog from '@/components/delivery/ReceiveDialog'
import { receivedText } from '@/components/delivery/shared'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import { useAuth } from '@/context/AuthContext'
import useUrlParams from '@/hooks/useUrlParams'
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
const COLS = 8

// Every purchase order issued, by how its delivery stands; a row opens the PO (its items, deliveries and documents).
export default function POList() {
  const { user } = useAuth()
  const canReceive = ['admin', 'procurement', 'supply'].includes(user?.role)

  // View, search, page, and the PO open live in the URL, so a link (from Deliveries or a request) opens the same view.
  const [params, setUrl] = useUrlParams()
  const view  = TABS.some(t => t.key === params.get('view')) ? params.get('view') : 'all'
  const page  = Math.max(parseInt(params.get('page')) || 1, 1)
  const open  = params.get('po')
  const [search, setSearch]       = useState(params.get('q') || params.get('search') || '')
  const [receiving, setReceiving] = useState(null)   // a PO id, or 'pick' to choose the PO in the dialog
  const update = (changes) => setUrl({ ...changes, search: '' })   // older links used ?search=

  const { data, isLoading, isError } = useQuery({
    queryKey: ['po-list', { search, view, page }],
    queryFn: () => {
      const q = new URLSearchParams({ page, limit: PAGE_SIZE, view })
      if (search) q.set('search', search)
      return api.get(`/po?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const pdf = (po) => openPdf(`/po/${po.id}/pdf`).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the PO')))

  return (
    <div className="space-y-5">
      <PageHeader title="Purchase Orders" sub="Every purchase order issued, by how its delivery stands. Open one to see its items, deliveries and documents.">
        {canReceive && <Button className="gap-1.5" onClick={() => setReceiving('pick')}><Truck className="size-4" /> Record a delivery</Button>}
      </PageHeader>

      <Card className="overflow-hidden">
        <TabBar>
          {TABS.map(t => (
            <Tab key={t.key} active={view === t.key} count={data?.counts?.[t.key] ?? 0} alert={t.key === 'overdue'}
              onClick={() => update({ view: t.key === 'all' ? '' : t.key, page: '' })}>
              {t.label}
            </Tab>
          ))}
        </TabBar>
        <Toolbar end={<ListCount n={data?.total} one="purchase order" />}>
          <SearchBox value={search} placeholder="Search by PO number, PR number or supplier" onChange={v => { setSearch(v); update({ q: v, page: '' }) }} />
        </Toolbar>

        <Table framed={false}>
          <TableHeader>
            <TableRow>
              <TableHead>PO No.</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Delivery</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={COLS} />
              : isError ? <EmptyRow cols={COLS} error="The purchase orders could not be loaded. Refresh the page to try again." />
              : !rows.length ? (
                <EmptyRow cols={COLS} icon={ShoppingCart}
                  title={search ? 'No purchase order matches your search' : view === 'overdue' ? 'Nothing is overdue' : 'No purchase order here'}
                  sub={search ? 'Try another PO number, PR number or supplier.' : 'Purchase orders appear here once Procurement issues them.'} />
              )
              : rows.map(po => {
                  const openPO = po.po_status === 'active' && po.delivery_status !== 'delivered'
                  return (
                    <TableRow key={po.id} className={`cursor-pointer ${po.po_status === 'cancelled' ? 'opacity-60' : ''}`} onClick={() => update({ po: po.id })}>
                      <TableCell className="whitespace-nowrap font-mono font-semibold text-[--color-brand]">{po.po_number}</TableCell>
                      <TableCell className="max-w-72">
                        <Link to={`/pr/${po.pr_id}?tab=orders`} onClick={e => e.stopPropagation()}
                          className="font-mono text-ui-xs font-semibold text-[--color-text-secondary] hover:text-[--color-brand] hover:underline">{po.pr_number}</Link>
                        {po.pr_title && <p className="truncate text-[11px] text-[--color-text-muted]">{po.pr_title}</p>}
                      </TableCell>
                      <TableCell>{po.supplier_name}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{fmtCurrency(po.total_amount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-ui-xs">
                        {po.expected_delivery_date
                          ? <span className={po.is_overdue ? 'font-semibold text-red-700' : 'text-[--color-text-secondary]'}>{fmtDate(po.expected_delivery_date)}</span>
                          : <span className="text-[--color-text-muted]">Not set</span>}
                        {po.is_overdue && <span className="block text-[11px] font-medium text-red-600">{po.days_late} days late</span>}
                        {!po.is_overdue && po.rescheduled_at && <span className="block text-[11px] text-[--color-text-muted]" title={po.reschedule_reason}>Moved</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ui-xs text-[--color-text-secondary]">{receivedText(po) || <span className="text-[--color-text-muted]">Nothing yet</span>}</TableCell>
                      <TableCell>
                        {po.po_status === 'cancelled' ? <POStatusBadge status="cancelled" /> : <DeliveryStatusBadge status={po.delivery_status} />}
                        {po.closed_at && <span className="block text-[11px] text-[--color-text-muted]" title="The supplier couldn't deliver the rest">Balance closed</span>}
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {canReceive && openPO && (
                            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setReceiving(po.id)}>
                              <Truck className="size-3.5" /> Receive
                            </Button>
                          )}
                          <button onClick={() => pdf(po)} title="Purchase order (PDF)" aria-label={`${po.po_number} PDF`}
                            className="rounded-lg p-1.5 text-[--color-text-muted] transition-colors hover:bg-[--color-overlay] hover:text-[--color-brand]">
                            <FileDown className="size-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
          </TableBody>
        </Table>
        <Pager page={page} totalPages={data?.totalPages} summary={`${data?.total} purchase orders`} onPage={(n) => update({ page: n > 1 ? n : '' })} />
      </Card>

      <PODetailDialog poId={open} onClose={() => update({ po: '' })} />
      {receiving && <ReceiveDialog poId={receiving === 'pick' ? null : receiving} open onClose={() => setReceiving(null)} />}
    </div>
  )
}

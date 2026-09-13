import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  ShoppingCart, CheckCircle2, Truck, AlertCircle, CalendarDays, PackageCheck, ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import ReceiveDialog from '@/components/delivery/ReceiveDialog'
import { qty, receivedText } from '@/components/delivery/shared'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

function Empty({ icon: Icon, title, sub }) {
  return (
    <div className="px-6 py-12 text-center">
      <Icon className="size-8 text-[--color-text-muted] mx-auto mb-3" />
      <p className="text-ui-sm font-semibold text-[--color-text-primary]">{title}</p>
      {sub && <p className="text-ui-xs text-[--color-text-muted] mt-1">{sub}</p>}
    </div>
  )
}

export default function SupplyDashboard() {
  const navigate = useNavigate()
  const [receiving, setReceiving] = useState(null)   // a PO id, or 'pick' to choose one

  // The POs still to be delivered, soonest due first, and every view's count
  // (counted on the server, so nothing beyond the first page is missed).
  const { data: openRes, isLoading: posLoading } = useQuery({
    queryKey: ['po-list', 'supply-open'],
    queryFn:  () => api.get('/po?view=open&limit=8').then(r => r.data),
  })
  const { data: recent = [], isLoading: recentLoading } = useQuery({
    queryKey: ['deliveries', 'recent'],
    queryFn:  () => api.get('/delivery?limit=6').then(r => r.data?.data ?? []),
  })

  const toReceive = openRes?.data ?? []
  const counts    = openRes?.counts ?? {}
  const STATS = [
    { view: 'overdue',   title: 'Overdue',          icon: AlertCircle,  color: 'red',   sub: 'past the expected date' },
    { view: 'due_week',  title: 'Due This Week',    icon: CalendarDays, color: 'amber', sub: 'expected in the next 7 days' },
    { view: 'partial',   title: 'Partly Delivered', icon: Truck,        color: 'blue',  sub: 'the rest still to come' },
    { view: 'delivered', title: 'Fully Delivered',  icon: CheckCircle2, color: 'green', sub: 'POs completed' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">Supply Office Overview</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            Monitor deliveries and manage goods receipt
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="secondary" className="gap-2">
            <Link to="/po"><ShoppingCart className="size-4" /> All Purchase Orders</Link>
          </Button>
          <Button className="gap-2" onClick={() => setReceiving('pick')}>
            <Truck className="size-4" /> Record Delivery
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        {STATS.map(s => (
          <Link key={s.view} to={`/po?view=${s.view}`} className="block">
            <StatsCard title={s.title} value={posLoading ? '…' : counts[s.view] ?? 0} icon={s.icon} color={s.color} sub={s.sub}
              className={s.view === 'overdue' && counts.overdue > 0 ? 'border-red-300' : ''} />
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>To Receive{counts.open > 0 ? ` (${counts.open})` : ''}</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/po">View all POs</Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {posLoading
              ? <div className="p-6 space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
              : !toReceive.length
                ? <Empty icon={Truck} title="Nothing to receive" sub="Every purchase order is fully delivered." />
                : toReceive.map(po => (
                    <div key={po.id} role="link" tabIndex={0}
                      onClick={() => navigate(`/po?po=${po.id}`)}
                      onKeyDown={e => { if (e.key === 'Enter') navigate(`/po?po=${po.id}`) }}
                      className="cursor-pointer px-6 py-3.5 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{po.po_number}</span>
                            <DeliveryStatusBadge status={po.delivery_status} />
                            {po.is_overdue && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] text-red-700 font-semibold">
                                <AlertCircle className="size-3" /> {po.days_late} days late
                              </span>
                            )}
                          </div>
                          <p className="text-ui-xs text-[--color-text-secondary] mt-0.5 truncate">{po.supplier_name} · PR {po.pr_number}</p>
                          <p className={`text-[10px] mt-0.5 ${po.is_overdue ? 'text-red-600 font-medium' : 'text-[--color-text-muted]'}`}>
                            {po.expected_delivery_date ? `Expected ${fmtDate(po.expected_delivery_date)}` : 'No expected date'}
                            {receivedText(po) ? ` · ${receivedText(po)}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="text-ui-sm font-bold text-[--color-brand]">{fmtCurrency(po.total_amount)}</span>
                          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
                            onClick={e => { e.stopPropagation(); setReceiving(po.id) }}>
                            <Truck className="size-3.5" /> Receive
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
            }
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recently Received</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/delivery">View all</Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {recentLoading
              ? <div className="p-4 space-y-2">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              : !recent.length
                ? <Empty icon={PackageCheck} title="No deliveries yet" sub="Goods you record as received appear here." />
                : recent.map(d => (
                  <Link key={d.id} to={`/po?po=${d.po_id}`}
                    className="block px-5 py-3 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold text-[--color-brand]">{d.po_number}</span>
                          <span className="text-[10px] text-[--color-text-muted]">{fmtDate(d.delivered_date)}</span>
                        </div>
                        <p className="text-[10px] font-medium text-[--color-text-secondary] mt-0.5 truncate">
                          {d.items?.length
                            ? d.items.map(i => `${i.item_name} × ${qty(i.quantity)}`).join(', ')
                            : d.supplier_name}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <DeliveryStatusBadge status={d.status === 'complete' ? 'delivered' : 'partial'} />
                        <ChevronRight className="size-4 text-[--color-text-muted]" />
                      </div>
                    </div>
                  </Link>
                ))
            }
          </CardContent>
        </Card>
      </div>

      {receiving && <ReceiveDialog poId={receiving === 'pick' ? null : receiving} open onClose={() => setReceiving(null)} />}
    </div>
  )
}

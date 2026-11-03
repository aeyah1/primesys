import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ShoppingCart, CheckCircle2, Truck, AlertCircle, CalendarDays, PackageCheck, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/ListParts'
import { DashboardHeader } from '@/components/dashboard/DashboardParts'
import MyTasks from '@/components/dashboard/MyTasks'
import ReceiveDialog from '@/components/delivery/ReceiveDialog'
import { qty } from '@/components/delivery/shared'
import { fmtDate } from '@/lib/utils'
import api from '@/lib/axios'

// The Supply Office's home: what needs it and what it waits on (MyTasks), then its purchase orders by due date and
// the latest deliveries.
export default function SupplyDashboard() {
  const [receiving, setReceiving] = useState(null)   // 'pick' while choosing the PO a delivery is for

  // Every view's count, counted on the server.
  const { data: openRes, isLoading: posLoading } = useQuery({
    queryKey: ['po-list', 'supply-open'],
    queryFn:  () => api.get('/po?view=open&limit=1').then(r => r.data),
  })
  const { data: recent = [], isLoading: recentLoading } = useQuery({
    queryKey: ['deliveries', 'recent'],
    queryFn:  () => api.get('/delivery?limit=6').then(r => r.data?.data ?? []),
  })

  const counts = openRes?.counts ?? {}
  const STATS = [
    { view: 'overdue',   title: 'Overdue',          icon: AlertCircle,  color: 'red',   sub: 'past the expected date' },
    { view: 'due_week',  title: 'Due This Week',    icon: CalendarDays, color: 'amber', sub: 'expected in the next 7 days' },
    { view: 'partial',   title: 'Partly Delivered', icon: Truck,        color: 'blue',  sub: 'the rest still to come' },
    { view: 'delivered', title: 'Fully Delivered',  icon: CheckCircle2, color: 'green', sub: 'POs completed' },
  ]

  return (
    <div className="space-y-6">
      <DashboardHeader sub="Record what arrives on each purchase order, and follow what is still to come.">
        <Button asChild variant="secondary" className="gap-2"><Link to="/po"><ShoppingCart className="size-4" /> Purchase orders</Link></Button>
        <Button variant="secondary" className="gap-2" onClick={() => setReceiving('pick')}><Truck className="size-4" /> Record a delivery</Button>
      </DashboardHeader>

      <MyTasks />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        {STATS.map(s => (
          <Link key={s.view} to={`/po?view=${s.view}`} className="block">
            <StatsCard interactive title={s.title} value={posLoading ? '…' : counts[s.view] ?? 0} icon={s.icon} color={s.color} sub={s.sub}
              className={s.view === 'overdue' && counts.overdue > 0 ? 'border-red-300' : ''} />
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recently received</CardTitle>
          <Button variant="ghost" size="sm" asChild><Link to="/delivery">View all</Link></Button>
        </CardHeader>
        <CardContent className="p-0">
          {recentLoading
            ? <div className="p-4 space-y-2">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            : !recent.length
              ? <EmptyState icon={PackageCheck} title="No deliveries yet" sub="Goods you record as received appear here." />
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
                        {d.items?.length ? d.items.map(i => `${i.item_name} × ${qty(i.quantity)}`).join(', ') : d.supplier_name}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <DeliveryStatusBadge status={d.status === 'complete' ? 'delivered' : 'partial'} />
                      <ChevronRight className="size-4 text-[--color-text-muted]" />
                    </div>
                  </div>
                </Link>
              ))}
        </CardContent>
      </Card>

      {receiving && <ReceiveDialog poId={null} open onClose={() => setReceiving(null)} />}
    </div>
  )
}

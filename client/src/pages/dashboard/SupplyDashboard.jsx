import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  ShoppingCart, Gavel, CheckCircle2, Truck, AlertCircle, ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
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
  const { data: allPOsRes, isLoading: posLoading } = useQuery({
    queryKey: ['po-list', 'supply-all'],
    queryFn: () => api.get('/po?limit=50').then(r => r.data),
  })

  const { data: awardedLots = [], isLoading: lotsLoading } = useQuery({
    queryKey: ['lots', 'awarded'],
    queryFn: () => api.get('/lots?status=awarded').then(r => r.data),
  })

  const allPOs       = allPOsRes?.data ?? []
  const pendingPOs   = allPOs.filter(po => po.delivery_status === 'pending')
  const partialPOs   = allPOs.filter(po => po.delivery_status === 'partial')
  const deliveredPOs = allPOs.filter(po => po.delivery_status === 'delivered')

  // Partial deliveries first (already started), then pending
  const actionPOs = [...partialPOs, ...pendingPOs].slice(0, 8)

  const today = new Date()
  const isOverdue = (po) =>
    po.expected_delivery_date &&
    new Date(po.expected_delivery_date) < today &&
    po.delivery_status !== 'delivered'

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
            <Link to="/bidding"><Gavel className="size-4" /> Awarded Lots</Link>
          </Button>
          <Button asChild className="gap-2">
            <Link to="/po"><ShoppingCart className="size-4" /> All Purchase Orders</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        <StatsCard
          title="Pending Delivery"
          value={pendingPOs.length}
          icon={Truck}
          color="amber"
          sub="awaiting first delivery"
        />
        <StatsCard
          title="Partial Delivery"
          value={partialPOs.length}
          icon={AlertCircle}
          color="blue"
          sub="incomplete deliveries"
        />
        <StatsCard
          title="Fully Delivered"
          value={deliveredPOs.length}
          icon={CheckCircle2}
          color="green"
          sub="POs completed"
        />
        <StatsCard
          title="Awarded Lots"
          value={awardedLots.length}
          icon={Gavel}
          color="brand"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Pending Deliveries</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/po">View all POs</Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {posLoading
              ? <div className="p-6 space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
              : !actionPOs.length
                ? <Empty
                    icon={Truck}
                    title="All deliveries complete"
                    sub="No pending or partial deliveries at this time."
                  />
                : actionPOs.map(po => {
                    const overdue = isOverdue(po)
                    return (
                      <Link key={po.id} to="/po"
                        className="block px-6 py-3.5 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{po.po_number}</span>
                              <DeliveryStatusBadge status={po.delivery_status} />
                              {overdue && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] text-red-700 font-semibold">
                                  <AlertCircle className="size-3" /> Overdue
                                </span>
                              )}
                            </div>
                            {po.supplier_name && (
                              <p className="text-ui-xs text-[--color-text-secondary] mt-0.5 truncate">{po.supplier_name}</p>
                            )}
                            {po.expected_delivery_date && (
                              <p className={`text-[10px] mt-0.5 ${overdue ? 'text-red-600 font-medium' : 'text-[--color-text-muted]'}`}>
                                Expected {fmtDate(po.expected_delivery_date)}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {po.total_amount && (
                              <span className="text-ui-sm font-bold text-[--color-brand]">{fmtCurrency(po.total_amount)}</span>
                            )}
                            <ChevronRight className="size-4 text-[--color-text-muted]" />
                          </div>
                        </div>
                      </Link>
                    )
                  })
            }
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Awarded Lots</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/bidding">View all</Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {lotsLoading
              ? <div className="p-4 space-y-2">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              : !awardedLots.length
                ? <Empty
                    icon={Gavel}
                    title="No awarded lots yet"
                    sub="Lots will appear here once procurement records bid winners."
                  />
                : awardedLots.slice(0, 8).map(lot => (
                  <Link key={lot.id} to="/bidding"
                    className="block px-5 py-3 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold text-[--color-brand]">{lot.lot_number}</span>
                          {lot.pr_number && (
                            <span className="text-[10px] text-[--color-text-muted]">{lot.pr_number}</span>
                          )}
                        </div>
                        {lot.awarded_to && (
                          <p className="text-[10px] font-medium text-emerald-700 mt-0.5">{lot.awarded_to}</p>
                        )}
                        {lot.awarded_amount && (
                          <p className="text-[10px] text-[--color-text-muted]">{fmtCurrency(lot.awarded_amount)}</p>
                        )}
                      </div>
                      <ChevronRight className="size-4 text-[--color-text-muted] shrink-0 mt-0.5" />
                    </div>
                  </Link>
                ))
            }
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


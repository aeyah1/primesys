import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  FileText, Gavel, ShoppingCart, History,
  CheckCircle2, Clock, ChevronRight, Truck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/shared/StatsCard'
import { PRStatusBadge, DeliveryStatusBadge, LotStatusBadge } from '@/components/shared/StatusBadge'
import { fmtDate } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
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

export default function ExtensionDashboard() {
  const { user } = useAuth()

  const { data: prsRes, isLoading: prsLoading } = useQuery({
    queryKey: ['pr-list', 'ext-dashboard'],
    queryFn: () => api.get('/pr?limit=20').then(r => r.data),
  })

  const { data: lots = [], isLoading: lotsLoading } = useQuery({
    queryKey: ['lots', 'ext-dashboard'],
    queryFn: () => api.get('/lots').then(r => r.data),
  })

  const { data: posRes, isLoading: posLoading } = useQuery({
    queryKey: ['po-list', 'ext-dashboard'],
    queryFn: () => api.get('/po?limit=5').then(r => r.data),
  })

  const prs  = prsRes?.data ?? []
  const pos  = posRes?.data ?? []
  const recentLots = lots.slice(0, 5)

  const totalPRs     = prsRes?.total ?? prs.length
  const submittedPRs = prs.filter(p => p.status === 'submitted').length
  const activePRs    = prs.filter(p => ['bidding', 'for_po'].includes(p.status)).length
  const completedPRs = prs.filter(p => p.status === 'completed').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">
            Welcome, {user?.name?.split(' ')[0]}
          </h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            View procurement activity and monitor lot award progress
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button asChild variant="secondary" className="gap-2">
            <Link to="/bidding"><Gavel className="size-4" /> Lots & Bidding</Link>
          </Button>
          <Button asChild variant="secondary" className="gap-2">
            <Link to="/po"><ShoppingCart className="size-4" /> Purchase Orders</Link>
          </Button>
          <Button asChild className="gap-2">
            <Link to="/pr"><FileText className="size-4" /> View All PRs</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 card-grid">
        <StatsCard title="Total PRs"   value={totalPRs}     icon={FileText}     color="brand" />
        <StatsCard title="Submitted"   value={submittedPRs} icon={Clock}        color="blue"  sub="awaiting action" />
        <StatsCard title="In Progress" value={activePRs}    icon={Gavel}        color="amber" sub="bidding + for PO" />
        <StatsCard title="Completed"   value={completedPRs} icon={CheckCircle2} color="green" />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Purchase Requests</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/pr">View all</Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {prsLoading
              ? <div className="p-6 space-y-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              : !prs.length
                ? <Empty
                    icon={FileText}
                    title="No purchase requests yet"
                    sub="Procurement will create PRs and they will appear here."
                  />
                : prs.slice(0, 10).map(pr => (
                  <Link key={pr.id} to={`/pr/${pr.id}`}
                    className="flex items-center justify-between px-6 py-3.5 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{pr.pr_number}</span>
                        {pr.quarter_label && (
                          <span className="text-[10px] text-[--color-text-muted]">{pr.quarter_label} {pr.quarter_year}</span>
                        )}
                      </div>
                      {pr.title && <p className="text-ui-xs text-[--color-text-secondary] truncate mt-0.5">{pr.title}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {pr.po_id && <DeliveryStatusBadge status={pr.delivery_status} />}
                      <PRStatusBadge status={pr.status} />
                      <ChevronRight className="size-4 text-[--color-text-muted]" />
                    </div>
                  </Link>
                ))
            }
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <Gavel className="size-4 text-[--color-text-muted]" />
                <CardTitle>Recent Lots</CardTitle>
              </div>
              <Button variant="ghost" size="sm" asChild><Link to="/bidding">View all</Link></Button>
            </CardHeader>
            <CardContent className="p-0">
              {lotsLoading
                ? <div className="p-4 space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                : !recentLots.length
                  ? <div className="px-5 py-8 text-center">
                      <Gavel className="size-7 text-[--color-text-muted] mx-auto mb-2" />
                      <p className="text-ui-xs text-[--color-text-muted]">No lots yet</p>
                    </div>
                  : recentLots.map(lot => (
                    <Link key={lot.id} to="/bidding"
                      className="flex items-center justify-between px-5 py-3 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold text-[--color-brand]">{lot.lot_number}</span>
                          <LotStatusBadge status={lot.status} />
                        </div>
                        {lot.awarded_to && (
                          <p className="text-[10px] font-medium text-emerald-700 mt-0.5">Awarded to {lot.awarded_to}</p>
                        )}
                      </div>
                      <ChevronRight className="size-4 text-[--color-text-muted] shrink-0" />
                    </Link>
                  ))
              }
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <ShoppingCart className="size-4 text-[--color-text-muted]" />
                <CardTitle>Recent POs</CardTitle>
              </div>
              <Button variant="ghost" size="sm" asChild><Link to="/po">View all</Link></Button>
            </CardHeader>
            <CardContent className="p-0">
              {posLoading
                ? <div className="p-4 space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                : !pos.length
                  ? <div className="px-5 py-8 text-center">
                      <ShoppingCart className="size-7 text-[--color-text-muted] mx-auto mb-2" />
                      <p className="text-ui-xs text-[--color-text-muted]">No purchase orders yet</p>
                    </div>
                  : pos.map(po => (
                    <div key={po.id}
                      className="flex items-center justify-between px-5 py-3 border-b border-[--color-border] last:border-0 gap-2">
                      <div className="min-w-0">
                        <p className="text-ui-xs font-semibold text-[--color-text-primary] truncate">{po.po_number}</p>
                        <p className="text-[10px] text-[--color-text-muted]">{po.supplier_name || 'â€”'}</p>
                      </div>
                      <DeliveryStatusBadge status={po.delivery_status} />
                    </div>
                  ))
              }
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <History className="size-4 text-[--color-text-muted]" />
                <CardTitle>Quick Links</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
                <Link to="/pr"><FileText className="size-3.5" /> Purchase Requests</Link>
              </Button>
              <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
                <Link to="/po"><ShoppingCart className="size-3.5" /> Purchase Orders</Link>
              </Button>
              <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
                <Link to="/bidding"><Gavel className="size-3.5" /> Lots & Awards</Link>
              </Button>
              <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
                <Link to="/delivery"><Truck className="size-3.5" /> Deliveries</Link>
              </Button>
              <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
                <Link to="/history"><History className="size-3.5" /> Audit History</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}


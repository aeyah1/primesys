import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { History, ChevronDown, ChevronRight, CalendarDays, Truck, FileText } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

function getQuarterLabel(dateStr) {
  const d = new Date(dateStr)
  const q = Math.ceil((d.getMonth() + 1) / 3)
  return `Q${q} ${d.getFullYear()}`
}

function groupByQuarter(items, dateKey = 'created_at') {
  return items.reduce((acc, item) => {
    const label = getQuarterLabel(item[dateKey])
    if (!acc[label]) acc[label] = []
    acc[label].push(item)
    return acc
  }, {})
}

function QuarterSection({ label, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-[--color-border] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-[--color-canvas] hover:bg-overlay/60 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <CalendarDays className="size-4 text-[--color-brand]" />
          <span className="text-ui-sm font-bold text-[--color-text-primary]">{label}</span>
        </div>
        {open
          ? <ChevronDown className="size-4 text-[--color-text-muted]" />
          : <ChevronRight className="size-4 text-[--color-text-muted]" />
        }
      </button>
      {open && <div className="divide-y divide-[--color-border]">{children}</div>}
    </div>
  )
}

export default function HistoryPage() {
  const { data: prData, isLoading } = useQuery({
    queryKey: ['history-pr'],
    queryFn: () => api.get('/pr?status=completed&limit=200').then(r => r.data),
  })

  const prList      = prData?.data ?? []
  const prByQuarter = groupByQuarter(prList, 'created_at')

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <History className="size-5 text-[--color-brand]" />
        <div>
          <h2 className="text-ui-xl font-bold text-[--color-text-primary]">History</h2>
          <p className="text-ui-xs text-[--color-text-muted] mt-0.5">
            Completed purchase requests grouped by quarter
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : !Object.keys(prByQuarter).length ? (
        <div className="text-center py-16">
          <FileText className="size-10 text-[--color-text-muted] mx-auto mb-3" />
          <p className="text-ui-sm font-semibold text-[--color-text-primary]">No completed purchase requests yet</p>
          <p className="text-ui-xs text-[--color-text-muted] mt-1">Completed PRs will appear here grouped by quarter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(prByQuarter).map(([label, prs], i) => {
            const totalAmount = prs.reduce((s, pr) => s + (parseFloat(pr.total_amount) || 0), 0)
            return (
              <QuarterSection
                key={label}
                label={`${label} — ${prs.length} PR${prs.length !== 1 ? 's' : ''}${totalAmount > 0 ? ` · ${fmtCurrency(totalAmount)}` : ''}`}
                defaultOpen={i === 0}
              >
                {prs.map(pr => (
                  <Link
                    key={pr.id}
                    to={`/pr/${pr.id}`}
                    className="flex items-center justify-between px-5 py-3.5 hover:bg-overlay/60 transition-colors gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{pr.pr_number}</span>
                      </div>
                      {pr.title && <p className="text-ui-xs text-[--color-text-secondary] mt-0.5 truncate">{pr.title}</p>}
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {pr.po_number && (
                          <span className="flex items-center gap-1 text-ui-xs text-[--color-text-muted]">
                            <FileText className="size-3" /> {pr.po_number}
                          </span>
                        )}
                        {pr.supplier_name && (
                          <span className="text-ui-xs text-[--color-text-muted]">{pr.supplier_name}</span>
                        )}
                        {pr.delivery_date && (
                          <span className="flex items-center gap-1 text-ui-xs text-emerald-600">
                            <Truck className="size-3" /> Delivered {fmtDate(pr.delivery_date)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {pr.total_amount > 0 && (
                        <span className="text-ui-sm font-bold text-emerald-700">{fmtCurrency(pr.total_amount)}</span>
                      )}
                      <DeliveryStatusBadge status={pr.delivery_status || 'pending'} />
                    </div>
                  </Link>
                ))}
              </QuarterSection>
            )
          })}
        </div>
      )}
    </div>
  )
}

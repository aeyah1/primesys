import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Archive, ChevronDown, ChevronRight, CalendarDays, Truck, FileText } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { DeliveryStatusBadge, PRStatusBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

// Finished and deleted purchase requests, sorted by category and grouped by
// quarter. Deleted PRs are kept (soft delete) and open read-only.
const CATEGORIES = [
  { key: 'completed', label: 'Completed', params: { status: 'completed' }, empty: 'Completed PRs will appear here.' },
  { key: 'cancelled', label: 'Cancelled', params: { status: 'cancelled' }, empty: 'Cancelled PRs will appear here.' },
  { key: 'rejected',  label: 'Rejected',  params: { status: 'rejected' },  empty: 'PRs rejected by TWG will appear here.' },
  { key: 'deleted',   label: 'Deleted',   params: { deleted: 'only' },     empty: 'Deleted PRs are kept here instead of being erased.' },
]
const LIMIT = 100

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

// Second line of a row: what matters for that category.
function RowDetails({ pr, category }) {
  if (category === 'deleted') {
    return (
      <span className="text-ui-xs text-[--color-text-muted]">
        Deleted {fmtDate(pr.deleted_at)}{pr.deleted_by_name ? ` by ${pr.deleted_by_name}` : ''}
      </span>
    )
  }
  if (category !== 'completed') {
    return (
      <span className="text-ui-xs text-[--color-text-muted]">
        Created {fmtDate(pr.created_at)}{pr.created_by_name ? ` by ${pr.created_by_name}` : ''}
      </span>
    )
  }
  return (
    <>
      {pr.po_number && (
        <span className="flex items-center gap-1 text-ui-xs text-[--color-text-muted]">
          <FileText className="size-3" /> {pr.po_number}
        </span>
      )}
      {pr.supplier_name && <span className="text-ui-xs text-[--color-text-muted]">{pr.supplier_name}</span>}
      {pr.delivery_date && (
        <span className="flex items-center gap-1 text-ui-xs text-blue-600">
          <Truck className="size-3" /> Delivered {fmtDate(pr.delivery_date)}
        </span>
      )}
    </>
  )
}

export default function ArchivePage() {
  const [category, setCategory] = useState('completed')
  const active = CATEGORIES.find(c => c.key === category)

  const { data: stats } = useQuery({
    queryKey: ['pr-stats'],
    queryFn: () => api.get('/pr/stats').then(r => r.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['archive', category],
    queryFn: () => api.get(`/pr?${new URLSearchParams({ ...active.params, limit: LIMIT })}`).then(r => r.data),
  })

  const prs       = data?.data ?? []
  const byQuarter = groupByQuarter(prs)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Archive className="size-5 text-[--color-brand]" />
        <div>
          <h2 className="text-ui-xl font-bold text-[--color-text-primary]">Archive</h2>
          <p className="text-ui-xs text-[--color-text-muted] mt-0.5">
            Finished and deleted purchase requests, grouped by quarter
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-[--color-border] overflow-x-auto">
        {CATEGORIES.map(c => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
              category === c.key
                ? 'border-[--color-brand] text-[--color-brand]'
                : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
            }`}
          >
            {c.label}
            {stats?.[c.key] > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                category === c.key ? 'bg-[--color-brand] text-white' : 'bg-[--color-border] text-[--color-text-muted]'
              }`}>{stats[c.key]}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : !prs.length ? (
        <div className="text-center py-16">
          <Archive className="size-10 text-[--color-text-muted] mx-auto mb-3" />
          <p className="text-ui-sm font-semibold text-[--color-text-primary]">No {active.label.toLowerCase()} purchase requests</p>
          <p className="text-ui-xs text-[--color-text-muted] mt-1">{active.empty}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.total > LIMIT && (
            <p className="text-ui-xs text-[--color-text-muted]">Showing the latest {LIMIT} of {data.total}.</p>
          )}
          {Object.entries(byQuarter).map(([label, group], i) => {
            const totalAmount = group.reduce((s, pr) => s + (parseFloat(pr.total_amount) || 0), 0)
            return (
              <QuarterSection
                key={label}
                label={`${label} · ${group.length} PR${group.length !== 1 ? 's' : ''}${totalAmount > 0 ? ` · ${fmtCurrency(totalAmount)}` : ''}`}
                defaultOpen={i === 0}
              >
                {group.map(pr => (
                  <Link
                    key={pr.id}
                    to={`/pr/${pr.id}`}
                    className="flex items-center justify-between px-5 py-3.5 hover:bg-overlay/60 transition-colors gap-4"
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{pr.pr_number}</span>
                      {pr.title && <p className="text-ui-xs text-[--color-text-secondary] mt-0.5 truncate">{pr.title}</p>}
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <RowDetails pr={pr} category={category} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {category === 'completed' ? (
                        <>
                          {pr.total_amount > 0 && (
                            <span className="text-ui-sm font-bold text-blue-700">{fmtCurrency(pr.total_amount)}</span>
                          )}
                          <DeliveryStatusBadge status={pr.delivery_status || 'pending'} />
                        </>
                      ) : (
                        <PRStatusBadge status={pr.status} />
                      )}
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

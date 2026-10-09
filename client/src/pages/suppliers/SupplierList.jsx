import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Search, Plus, Store, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FilterChip, Pager, EmptyState } from '@/components/shared/ListParts'
import { SupplierDialog, BlacklistedBadge } from '@/components/suppliers/SupplierParts'
import useUrlParams from '@/hooks/useUrlParams'
import api from '@/lib/axios'

const STATUSES = [
  { key: 'all',         label: 'All' },
  { key: 'active',      label: 'Active' },
  { key: 'blacklisted', label: 'Blacklisted' },
]

// The supplier profiles Procurement and Admin keep, each with its quotations, awards and DQs.
export default function SupplierList() {
  const [params, update] = useUrlParams()
  const status = STATUSES.some(s => s.key === params.get('status')) ? params.get('status') : 'all'
  const page = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')
  const [adding, setAdding] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', { status, search, page }],
    queryFn: () => {
      const q = new URLSearchParams({ page })
      if (status !== 'all') q.set('status', status)
      if (search.trim()) q.set('search', search.trim())
      return api.get(`/suppliers?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">Suppliers</h2>
          <p className="mt-0.5 text-ui-sm text-[--color-text-secondary]">
            Each supplier's profile, and the requests it quoted on. The BAC fills a quotation from these.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72 max-w-full">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[--color-text-muted]" />
            <Input placeholder="Search by name, address, contact or TIN…" value={search} className="pl-9"
              onChange={e => { setSearch(e.target.value); update({ q: e.target.value, page: '' }) }} />
          </div>
          <Button className="gap-1.5" onClick={() => setAdding(true)}><Plus className="size-4" /> Add supplier</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map(s => (
          <FilterChip key={s.key} active={status === s.key} count={data?.counts?.[s.key] ?? 0}
            onClick={() => update({ status: s.key === 'all' ? '' : s.key, page: '' })}>
            {s.label}
          </FilterChip>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading
            ? <div className="space-y-3 p-6">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            : !rows.length
              ? <EmptyState icon={Store} title="No supplier found"
                  sub={search.trim() ? 'Try another name, address, contact or TIN.' : 'Add a supplier from its RFQ, business permit or letterhead.'} />
              : rows.map(s => (
                <Link key={s.id} to={`/suppliers/${s.id}`}
                  className="flex items-center justify-between gap-4 border-b border-[--color-border] px-6 py-4 transition-colors last:border-0 hover:bg-overlay/60">
                  <div className="min-w-0 flex-1">
                    <p className="text-ui-sm font-bold text-[--color-text-primary]">
                      {s.name}{s.status === 'blacklisted' && <BlacklistedBadge note={s.status_note} />}
                    </p>
                    <p className="mt-0.5 truncate text-ui-xs text-[--color-text-secondary]">
                      {[s.address, s.contact_person, s.phone].filter(Boolean).join(' · ') || 'No details yet'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-5 text-right">
                    {[['Quotations', s.quotations, ''], ['Awards', s.awards, 'text-emerald-700'], ['DQ', s.dqs, 'text-red-700']].map(([label, n, tone]) => (
                      <div key={label} className="hidden sm:block">
                        <p className={`text-ui-sm font-bold tabular-nums ${Number(n) ? tone || 'text-[--color-text-primary]' : 'text-[--color-text-muted]'}`}>{n}</p>
                        <p className="text-[10px] uppercase tracking-wider text-[--color-text-muted]">{label}</p>
                      </div>
                    ))}
                    <ChevronRight className="size-4 text-[--color-text-muted]" />
                  </div>
                </Link>
              ))}
          <Pager page={page} totalPages={data?.totalPages} summary={`${data?.total ?? 0} total`}
            onPage={(n) => update({ page: n > 1 ? n : '' })} />
        </CardContent>
      </Card>

      {adding && <SupplierDialog supplier={null} onClose={() => setAdding(false)} />}
    </div>
  )
}

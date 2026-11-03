import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Plus, Store } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import PageHeader from '@/components/shared/PageHeader'
import { TabBar, Tab, Toolbar, SearchBox, ListCount, SkeletonRows, EmptyRow, Pager } from '@/components/shared/ListParts'
import { SupplierDialog, BlacklistedBadge } from '@/components/suppliers/SupplierParts'
import useUrlParams from '@/hooks/useUrlParams'
import api from '@/lib/axios'

const STATUSES = [
  { key: 'all',         label: 'All' },
  { key: 'active',      label: 'Active' },
  { key: 'blacklisted', label: 'Blacklisted' },
]
const COLS = 5

// A count in a supplier's row: muted at zero, else in its tone.
const Count = ({ n, tone }) => <span className={`font-semibold tabular-nums ${Number(n) ? tone : 'text-[--color-text-muted]'}`}>{n}</span>

// The supplier profiles Procurement and Admin keep, each with its quotations, awards and DQs.
export default function SupplierList() {
  const navigate = useNavigate()
  const [params, update] = useUrlParams()
  const status = STATUSES.some(s => s.key === params.get('status')) ? params.get('status') : 'all'
  const page = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')
  const [adding, setAdding] = useState(false)

  const { data, isLoading, isError } = useQuery({
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
    <div className="space-y-5">
      <PageHeader title="Suppliers" sub="Each supplier's profile and the requests it quoted on. Procurement fills a quotation from these.">
        <Button className="gap-1.5" onClick={() => setAdding(true)}><Plus className="size-4" /> Add supplier</Button>
      </PageHeader>

      <Card className="overflow-hidden">
        <TabBar>
          {STATUSES.map(s => (
            <Tab key={s.key} active={status === s.key} count={data?.counts?.[s.key] ?? 0} alert={s.key === 'blacklisted'}
              onClick={() => update({ status: s.key === 'all' ? '' : s.key, page: '' })}>
              {s.label}
            </Tab>
          ))}
        </TabBar>
        <Toolbar end={<ListCount n={data?.total} one="supplier" />}>
          <SearchBox value={search} placeholder="Search by name, address, contact or TIN" onChange={v => { setSearch(v); update({ q: v, page: '' }) }} />
        </Toolbar>
        <Table framed={false}>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead>Address and contact</TableHead>
              <TableHead className="text-right">Quotations</TableHead>
              <TableHead className="text-right">Awards</TableHead>
              <TableHead className="text-right">DQ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={COLS} />
              : isError ? <EmptyRow cols={COLS} error="The suppliers could not be loaded. Refresh the page to try again." />
              : !rows.length ? (
                <EmptyRow cols={COLS} icon={Store} title="No supplier found"
                  sub={search.trim() ? 'Try another name, address, contact or TIN.' : 'Add a supplier from its RFQ, business permit or letterhead.'} />
              )
              : rows.map(s => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(`/suppliers/${s.id}`)}>
                    <TableCell className="font-semibold">{s.name}{s.status === 'blacklisted' && <BlacklistedBadge note={s.status_note} />}</TableCell>
                    <TableCell className="max-w-96">
                      <p className="truncate text-ui-xs text-[--color-text-secondary]">{[s.address, s.contact_person, s.phone].filter(Boolean).join(' · ') || 'No details yet'}</p>
                    </TableCell>
                    <TableCell className="text-right"><Count n={s.quotations} tone="text-[--color-text-primary]" /></TableCell>
                    <TableCell className="text-right"><Count n={s.awards} tone="text-emerald-700" /></TableCell>
                    <TableCell className="text-right"><Count n={s.dqs} tone="text-red-700" /></TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        <Pager page={page} totalPages={data?.totalPages} summary={`${data?.total ?? 0} suppliers`} onPage={(n) => update({ page: n > 1 ? n : '' })} />
      </Card>

      {adding && <SupplierDialog supplier={null} onClose={() => setAdding(false)} />}
    </div>
  )
}

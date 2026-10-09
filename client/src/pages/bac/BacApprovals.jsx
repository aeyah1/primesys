import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, Scale, ChevronRight, CheckCircle2, FileText } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FilterChip, Pager } from '@/components/shared/ListParts'
import { RecanvassBadge } from '@/components/shared/StatusBadge'
import { fmtCurrency, fmtDate, fmtDatetime } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

const VIEWS = [
  { key: 'pending',  label: 'To do',       empty: 'No request is waiting for the BAC.' },
  { key: 'approved', label: 'Resolutions', empty: 'The BAC has not approved any canvass result yet.' },
]

// The Bids and Awards Committee's queue: requests in canvass, whose bids it
// enters and sends to the TWG, and requests the TWG certified, whose winners it
// picks (both on the canvass page), and the resolutions it adopted.
export default function BacApprovals() {
  const [view, setView]     = useState('pending')
  const [search, setSearch] = useState('')
  const [page, setPage]     = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['bac', 'queue', { view, search, page }],
    queryFn: () => api.get(`/bac/queue?${new URLSearchParams({ view, search, page })}`).then(r => r.data),
  })
  const rows = data?.data ?? []
  const current = VIEWS.find(v => v.key === view)

  const printResolution = (row) => openPdf(`/bac/${row.id}/resolutions/${row.resolution_id}/pdf`)
    .catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the BAC Resolution')))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">For Evaluation</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            Enter the bids from the canvasser's returned RFQs and send them to the TWG; once the TWG certifies them, pick the winners and award
          </p>
        </div>
        <div className="relative max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input placeholder="Search by PR number or title…" value={search} className="pl-9"
            onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {VIEWS.map(v => (
          <FilterChip key={v.key} active={view === v.key} count={data?.counts?.[v.key] ?? 0} onClick={() => { setView(v.key); setPage(1) }}>
            {v.label}
          </FilterChip>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading
            ? <div className="p-6 space-y-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            : !rows.length
              ? (
                <div className="px-6 py-16 text-center">
                  <CheckCircle2 className="size-10 text-[--color-text-muted] mx-auto mb-3" />
                  <p className="text-ui-sm font-semibold text-[--color-text-primary]">All caught up</p>
                  <p className="text-ui-xs text-[--color-text-muted] mt-1">{current.empty}</p>
                </div>
              )
              : rows.map(row => (
                <div key={view === 'approved' ? row.resolution_id : row.id}
                  className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                  <Link to={`/pr/${row.id}/canvass${view === 'approved' ? '#resolutions' : ''}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {view === 'approved' && (
                        <span className="text-ui-sm font-bold text-[--color-text-primary]">Resolution No. {row.resolution_number}</span>
                      )}
                      <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{row.pr_number}</span>
                      {view === 'pending' && <RecanvassBadge count={row.recanvass_count} />}
                    </div>
                    {row.title && <p className="text-ui-sm text-[--color-text-primary] mt-1 line-clamp-2">{row.title}</p>}
                    <p className="text-[10px] text-[--color-text-muted] mt-1.5">
                      {view === 'pending'
                        ? <><span className="font-semibold text-[--color-brand]">{row.status === 'bac_review' ? 'Certified by the TWG: pick the winners' : 'Enter the bids'}</span>{' · '}{Number(row.bidders) ? `${row.bidders} bidder${Number(row.bidders) === 1 ? '' : 's'}` : 'No bids yet'} · {row.items} item{Number(row.items) === 1 ? '' : 's'}, budget <span className="font-semibold text-[--color-text-secondary]">{fmtCurrency(row.total)}</span>{' · '}{row.mode_of_procurement || 'No mode set'}{' · '}Since {fmtDatetime(row.since)}{row.status === 'bidding' && row.recanvass_reason ? ' · Re-canvass ordered by the TWG' : row.status === 'bidding' && row.certification_return_reason ? ' · Returned by the TWG' : ''}</>
                        : <>{row.suppliers}{' · '}<span className="font-semibold text-[--color-text-secondary]">{fmtCurrency(row.total)}</span>{' · '}Approved {fmtDate(row.resolved_on)} by {row.approved_by_name}</>}
                    </p>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    {view === 'approved' ? (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => printResolution(row)}>
                        <FileText className="size-3.5" /> Resolution
                      </Button>
                    ) : <Scale className="size-4 text-[--color-brand]" />}
                    <Link to={`/pr/${row.id}/canvass${view === 'approved' ? '#resolutions' : ''}`} aria-label={`Open ${row.pr_number}`}>
                      <ChevronRight className="size-4 text-[--color-text-muted]" />
                    </Link>
                  </div>
                </div>
              ))}
          <Pager page={page} totalPages={data?.totalPages} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  )
}

import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FileBadge, FileText } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import PageHeader from '@/components/shared/PageHeader'
import { Toolbar, SearchBox, ListCount, SkeletonRows, EmptyRow, Pager } from '@/components/shared/ListParts'
import { awardRecordName } from '@/components/awards/supplier'
import { fmtCurrency, fmtDate } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import useUrlParams from '@/hooks/useUrlParams'
import api from '@/lib/axios'

const COLS = 7

// Every award the BAC made: each in a BAC Resolution, or below the resolution threshold on the Abstract alone. A row
// opens its request at its documents; what Procurement still has to record is on My tasks.
export default function BacApprovals() {
  const navigate = useNavigate()
  const [params, update] = useUrlParams()
  const page = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bac', 'queue', { view: 'approved', search, page }],
    queryFn: () => api.get(`/bac/queue?${new URLSearchParams({ view: 'approved', search, page })}`).then(r => r.data),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []

  const printResolution = (row) => openPdf(`/bac/${row.id}/resolutions/${row.resolution_id}/pdf`)
    .catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the BAC Resolution')))

  return (
    <div className="space-y-5">
      <PageHeader title="Awards" sub="Every award the BAC made, with its BAC Resolution or on its Abstract. Open one to see its request." />

      <Card className="overflow-hidden">
        <Toolbar end={<ListCount n={data?.total} one="award" />}>
          <SearchBox value={search} placeholder="Search by PR number or title" onChange={v => { setSearch(v); update({ q: v, page: '' }) }} />
        </Toolbar>
        <Table framed={false}>
          <TableHeader>
            <TableRow>
              <TableHead>Award</TableHead>
              <TableHead>PR No.</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Approved</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={COLS} />
              : isError ? <EmptyRow cols={COLS} error="The awards could not be loaded. Refresh the page to try again." />
              : !rows.length ? (
                <EmptyRow cols={COLS} icon={FileBadge} title={search ? 'No award matches your search' : 'No award yet'}
                  sub={search ? 'Try another PR number or title.' : 'Each award appears here once Procurement records it.'} />
              )
              : rows.map(row => (
                  <TableRow key={row.resolution_id} className="cursor-pointer" onClick={() => navigate(`/pr/${row.id}?tab=documents`)}>
                    <TableCell className="whitespace-nowrap font-semibold">{awardRecordName(row)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono font-semibold text-[--color-brand]">{row.pr_number}</TableCell>
                    <TableCell className="max-w-72"><p className="truncate">{row.title || 'No title'}</p></TableCell>
                    <TableCell className="max-w-56"><p className="truncate text-ui-xs text-[--color-text-secondary]" title={row.suppliers}>{row.suppliers}</p></TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{fmtCurrency(row.total)}</TableCell>
                    <TableCell className="whitespace-nowrap text-ui-xs text-[--color-text-secondary]">
                      {fmtDate(row.resolved_on)}
                      <span className="block text-[11px] text-[--color-text-muted]">by {row.approved_by_name}</span>
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end">
                        {row.kind === 'abstract' ? <span className="text-[11px] text-[--color-text-muted]">On the BAC's Abstract</span> : (
                          <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => printResolution(row)}>
                            <FileText className="size-3.5" /> Resolution
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        <Pager page={page} totalPages={data?.totalPages} summary={`${data?.total} awards`} onPage={(n) => update({ page: n > 1 ? n : '' })} />
      </Card>
    </div>
  )
}

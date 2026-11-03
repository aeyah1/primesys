import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FileText, FileBadge } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import PageHeader from '@/components/shared/PageHeader'
import { LockedChip } from '@/components/awards/QuotesLocked'
import { TabBar, Tab, Toolbar, SearchBox, ListCount, SkeletonRows, EmptyRow, Pager } from '@/components/shared/ListParts'
import { fmtDatetime } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import useUrlParams from '@/hooks/useUrlParams'
import api from '@/lib/axios'

const KINDS = [
  { key: 'all',    label: 'All' },
  { key: 'review', label: 'Request checked',      note: 'Request checked (market price and specifications)' },
  { key: 'bids',   label: 'Canvass bids checked', note: 'Canvass bids checked' },
]
const COLS = 7

// Every TWG Certification already issued on the requests this user may see, newest first, each printable.
export default function CertificatesPage() {
  const navigate = useNavigate()
  const [params, update] = useUrlParams()
  const kind = KINDS.some(k => k.key === params.get('kind')) ? params.get('kind') : 'all'
  const page = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bac', 'certificates', { kind, search, page }],
    queryFn: () => {
      const q = new URLSearchParams({ page })
      if (kind !== 'all') q.set('kind', kind)
      if (search.trim())  q.set('search', search.trim())
      return api.get(`/bac/certificates?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []

  const print = (c) => openPdf(`/bac/${c.pr_id}/certificates/${c.id}/pdf`)
    .catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the TWG Certification')))

  return (
    <div className="space-y-5">
      <PageHeader title="Certificates" sub="The TWG Certifications issued so far: when the TWG approves a request, and when it certifies a canvass's bids." />

      <Card className="overflow-hidden">
        <TabBar>
          {KINDS.map(k => (
            <Tab key={k.key} active={kind === k.key} count={data?.counts?.[k.key] ?? 0} onClick={() => update({ kind: k.key === 'all' ? '' : k.key, page: '' })}>
              {k.label}
            </Tab>
          ))}
        </TabBar>
        <Toolbar end={<ListCount n={data?.total} one="certificate" />}>
          <SearchBox value={search} placeholder="Search by Cert. No., PR number or title" onChange={v => { setSearch(v); update({ q: v, page: '' }) }} />
        </Toolbar>
        <Table framed={false}>
          <TableHeader>
            <TableRow>
              <TableHead>Cert. No.</TableHead>
              <TableHead>What it certifies</TableHead>
              <TableHead>PR No.</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Signature</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={COLS} />
              : isError ? <EmptyRow cols={COLS} error="The certificates could not be loaded. Refresh the page to try again." />
              : !rows.length ? (
                <EmptyRow cols={COLS} icon={FileBadge} title="No certificate found"
                  sub={search.trim() ? 'Try another Cert. No., PR number or title.' : 'Certificates appear here once the TWG issues them.'} />
              )
              : rows.map(c => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/pr/${c.pr_id}?tab=documents`)}>
                    <TableCell className="whitespace-nowrap font-semibold">No. {c.cert_no}</TableCell>
                    <TableCell className="text-ui-xs text-[--color-text-secondary]">{KINDS.find(k => k.key === c.kind)?.note || KINDS[2].note}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono font-semibold text-[--color-brand]">{c.pr_number}</TableCell>
                    <TableCell className="max-w-72">
                      <p className="truncate">{c.title || 'No title'}</p>
                      {c.department && <p className="truncate text-[11px] text-[--color-text-muted]">{c.department}</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-ui-xs text-[--color-text-secondary]">
                      {fmtDatetime(c.created_at)}
                      {c.certified_by_name && <span className="block text-[11px] text-[--color-text-muted]">by {c.certified_by_name}</span>}
                    </TableCell>
                    <TableCell className="text-ui-xs">{c.signed ? 'Signed' : <span className="text-amber-800">To sign by hand</span>}</TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end">
                        {c.locked ? <LockedChip label="Certificate" short /> : (
                          <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => print(c)}>
                            <FileText className="size-3.5" /> Certificate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        <Pager page={page} totalPages={data?.totalPages} summary={`${data?.total} certificates`} onPage={(n) => update({ page: n > 1 ? n : '' })} />
      </Card>
    </div>
  )
}

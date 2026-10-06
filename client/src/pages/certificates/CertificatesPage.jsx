import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, FileText, FileBadge, ChevronRight } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FilterChip, Pager, EmptyState } from '@/components/shared/ListParts'
import { fmtDate } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import useUrlParams from '@/hooks/useUrlParams'
import api from '@/lib/axios'

const KINDS = [
  { key: 'all',    label: 'All' },
  { key: 'review', label: 'Request checked', note: 'Request checked (market price and specifications)' },
  { key: 'bids',   label: 'Canvass bids',    note: 'Canvass bids checked' },
]

// Every TWG Certification already issued on the requests this user may see, newest first, each printable.
export default function CertificatesPage() {
  const [params, update] = useUrlParams()
  const kind = KINDS.some(k => k.key === params.get('kind')) ? params.get('kind') : 'all'
  const page = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')

  const { data, isLoading } = useQuery({
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
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">Certificates</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            The TWG Certifications issued so far: when the TWG approves a request, and when it certifies a canvass's bids
          </p>
        </div>
        <div className="relative max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input placeholder="Search by Cert. No., PR number or title…" value={search} className="pl-9"
            onChange={e => { setSearch(e.target.value); update({ q: e.target.value, page: '' }) }} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {KINDS.map(k => (
          <FilterChip key={k.key} active={kind === k.key} count={data?.counts?.[k.key] ?? 0}
            onClick={() => update({ kind: k.key === 'all' ? '' : k.key, page: '' })}>
            {k.label}
          </FilterChip>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading
            ? <div className="p-6 space-y-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            : !rows.length
              ? <EmptyState icon={FileBadge} title="No certificate found"
                  sub={search.trim() ? 'Try another Cert. No., PR number or title.' : 'Certificates appear here once the TWG issues them.'} />
              : rows.map(c => (
                <div key={c.id}
                  className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[--color-border] last:border-0 hover:bg-overlay/60 transition-colors">
                  <Link to={`/pr/${c.pr_id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-ui-sm font-bold text-[--color-text-primary]">TWG Certification No. {c.cert_no}</span>
                      <span className="font-mono text-ui-sm font-bold text-[--color-brand]">{c.pr_number}</span>
                    </div>
                    {c.title && <p className="text-ui-sm text-[--color-text-primary] mt-1 line-clamp-2">{c.title}</p>}
                    <p className="text-[10px] text-[--color-text-muted] mt-1.5">
                      {KINDS.find(k => k.key === c.kind)?.note || KINDS[2].note}
                      {' · '}{fmtDate(c.created_at)}{c.certified_by_name ? `, by ${c.certified_by_name}` : ''}
                      {c.department ? ` · ${c.department}` : ''}
                      {' · '}{c.signed ? 'Signed' : 'Unsigned (to sign by hand)'}
                    </p>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => print(c)}>
                      <FileText className="size-3.5" /> Certificate
                    </Button>
                    <Link to={`/pr/${c.pr_id}`} aria-label={`Open ${c.pr_number}`}>
                      <ChevronRight className="size-4 text-[--color-text-muted]" />
                    </Link>
                  </div>
                </div>
              ))}
          <Pager page={page} totalPages={data?.totalPages} summary={`${data?.total} total`}
            onPage={(n) => update({ page: n > 1 ? n : '' })} />
        </CardContent>
      </Card>
    </div>
  )
}

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { FileStack, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import PageHeader from '@/components/shared/PageHeader'
import { Toolbar, SearchBox, ListCount, Pager, EmptyState } from '@/components/shared/ListParts'
import { DQBadge } from '@/components/awards/supplier'
import DocumentViewer from '@/components/awards/DocumentViewer'
import useUrlParams from '@/hooks/useUrlParams'
import { fmtCurrency, fmtDatetime } from '@/lib/utils'
import api from '@/lib/axios'

const PILL = 'ml-1.5 inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-bold'
const keyOf = (q) => `${q.file_id}:${q.quotation_id ?? 0}`

// A quotation's outcome on its request: awarded, DQ, not awarded once the request moved on, or cancelled.
function Outcome({ q }) {
  if (!q.quotation_id) return null
  if (q.awarded_amount != null) return <span className={`${PILL} border-emerald-300 bg-emerald-50 text-emerald-700`}>Awarded</span>
  if (q.dq) return <DQBadge />
  if (['for_po', 'completed'].includes(q.pr_status)) return <span className={`${PILL} border-[--color-border-strong] bg-[--color-overlay] text-[--color-text-secondary]`}>Not awarded</span>
  if (q.pr_status === 'cancelled') return <span className={`${PILL} border-[--color-border-strong] bg-[--color-overlay] text-[--color-text-secondary]`}>Cancelled</span>
  return null
}

/* Every RFQ uploaded to a request, newest first, found by search, each opened whole beside the list; with its quotation,
   the supplier, RFQ No., total and outcome. Procurement's and admins' only (server utils/quoteAccess.js). */
export default function RfqHistory() {
  const [params, update] = useUrlParams()
  const page = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')
  const [shown, setShown] = useState(null)   // the RFQ open beside the list; the newest unless one is picked
  const viewer = useRef(null)

  const { data, isLoading } = useQuery({
    queryKey: ['rfqs', { search, page }],
    queryFn: () => {
      const q = new URLSearchParams({ page })
      if (search.trim()) q.set('search', search.trim())
      return api.get(`/rfqs?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const current = rows.find(q => keyOf(q) === shown) || rows[0]
  // On a narrow screen the RFQ is under the list, so it is scrolled into view.
  const pick = (q) => { setShown(keyOf(q)); viewer.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }

  return (
    <div className="space-y-5">
      <PageHeader title="RFQ History" sub="Every RFQ uploaded to a request, newest first. Pick one to read it beside the list." />

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-5">
        <Card className={`overflow-hidden ${current ? 'xl:col-span-3' : 'xl:col-span-5'}`}>
          <Toolbar end={<ListCount n={data?.total} one="RFQ" />}>
            <SearchBox value={search} placeholder="Search by supplier, RFQ or PR number" onChange={v => { setSearch(v); update({ q: v, page: '' }) }} />
          </Toolbar>
          {isLoading
            ? <div className="space-y-3 p-6">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            : !rows.length
              ? <EmptyState icon={FileStack} title="No RFQ found"
                  sub={search.trim() ? 'Try another supplier, file name or request.' : 'The RFQs uploaded to the requests show here.'} />
              : rows.map(q => (
                <button key={keyOf(q)} type="button" onClick={() => pick(q)} aria-pressed={q === current}
                  className={`flex w-full items-center justify-between gap-4 border-b border-l-2 border-b-[--color-border] px-5 py-3.5 text-left transition-colors last:border-b-0 ${
                    q === current ? 'border-l-[--color-brand] bg-[--color-brand-light]' : 'border-l-transparent hover:bg-[--color-overlay]'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui-sm font-bold text-[--color-text-primary]">{q.supplier || q.file_name}<Outcome q={q} />
                      {q.removed_at && <span className={`${PILL} border-amber-300 bg-amber-50 text-amber-800`} title="Removed under the retention rule">File removed</span>}</p>
                    <p className="mt-0.5 truncate text-ui-xs text-[--color-text-secondary]">
                      {q.pr_number}{q.title ? `: ${q.title}` : ''}
                      {q.quotation_id ? ` · ${q.items} item${q.items === 1 ? '' : 's'}` : ` · uploaded by ${q.uploaded_by}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-5 text-right">
                    {[['RFQ No.', q.rfq_no || 'None'], ['Total', q.total == null ? 'None' : fmtCurrency(q.total)], ['Uploaded', fmtDatetime(q.uploaded_at)]].map(([label, value]) => (
                      <div key={label} className="hidden sm:block">
                        <p className="text-ui-sm font-bold tabular-nums text-[--color-text-primary]">{value}</p>
                        <p className="text-[10px] uppercase tracking-wider text-[--color-text-muted]">{label}</p>
                      </div>
                    ))}
                    <ChevronRight className="size-4 text-[--color-text-muted]" />
                  </div>
                </button>
              ))}
          <Pager page={page} totalPages={data?.totalPages} summary={`${data?.total ?? 0} RFQs`} onPage={(n) => update({ page: n > 1 ? n : '' })} />
        </Card>

        {current && (
          <section ref={viewer} className="space-y-3 xl:sticky xl:top-4 xl:col-span-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="min-w-0 truncate text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">
                {current.supplier ? `${current.supplier}, RFQ No. ${current.rfq_no || 'none'}` : current.file_name}
              </h3>
              <Link to={`/pr/${current.pr_id}`} className="inline-flex items-center gap-0.5 text-ui-xs font-semibold text-[--color-brand] hover:underline">
                Open {current.pr_number} <ChevronRight className="size-3.5" />
              </Link>
            </div>
            <div className="overflow-hidden rounded-xl border border-[--color-border] bg-white shadow-sm">
              <DocumentViewer prId={String(current.pr_id)} file={{ id: current.file_id, original_name: current.file_name, mimetype: current.file_type, removed_at: current.removed_at }} />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

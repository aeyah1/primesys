import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Trophy, ChevronRight, Search, ShoppingCart, Gavel, AlertTriangle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryBadge, DeliveryStatusBadge, PRStatusBadge, RecanvassBadge } from '@/components/shared/StatusBadge'
import StartCanvassDialog from '@/components/awards/StartCanvassDialog'
import { FilterChip, Tab, Pager } from '@/components/shared/ListParts'
import { fmtCurrency, daysSince, plural, CATEGORY_LABELS } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import useUrlParams from '@/hooks/useUrlParams'
import api from '@/lib/axios'

const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS)
const PAGE_SIZE = 20

// Procurement's work, in the order a request moves (lots.controller STAGES).
// A PR awarded in part can be in more than one: its other items go through the
// canvass, the BAC's award and the TWG again while the certified suppliers wait for their POs.
const STAGES = [
  { key: 'to_canvass',  label: 'To canvass',   empty: 'No request approved by the TWG is waiting to be canvassed.' },
  { key: 'needs_award', label: 'With the BAC', empty: 'No request is with the BAC for its bids or its award.' },
  { key: 'with_twg',    label: 'With the TWG', empty: 'No request is waiting for the TWG\'s evaluation.' },
  { key: 'awaiting_po', label: 'Issue PO',     empty: 'No awards are waiting for a purchase order.' },
  { key: 'po_issued',   label: 'PO issued',    empty: 'No purchase orders have been issued yet.' },
  { key: 'cancelled',   label: 'Cancelled',   empty: 'No PRs were cancelled after an award.' },
]

/* ── One PR in the queue, on one line; a click opens its canvass ──────── */
function AwardRow({ row, stage, canManage, onOpen, onStart }) {
  const days      = daysSince(row.stage_since)
  const estimate  = Number(row.estimated_total)
  const awarded   = Number(row.awarded_total)
  const toAward   = row.item_count - row.dropped_items

  return (
    <div onClick={onOpen}
      className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 sm:px-5 py-4 border-b border-[--color-border] last:border-0 cursor-pointer hover:bg-[--color-overlay] transition-colors">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/pr/${row.id}`} onClick={e => e.stopPropagation()} title="Open the PR"
            className="font-mono text-sm font-bold text-[--color-brand] hover:underline">{row.pr_number}</Link>
          <CategoryBadge category={row.category} />
          <RecanvassBadge count={row.recanvass_count} />
        </div>
        <button type="button" onClick={e => { e.stopPropagation(); onOpen() }}
          className="block max-w-full truncate text-left text-sm font-semibold text-[--color-text-primary] hover:underline mt-0.5">
          {row.title || 'Untitled request'}
        </button>
        <p className="text-xs text-[--color-text-muted] truncate">
          {row.created_by_name}{row.department ? `, ${row.department}` : ''}
        </p>
      </div>

      <div className="min-w-0 basis-52">
        {row.suppliers ? (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-[--color-text-primary] truncate" title={row.suppliers}>
            <Trophy className="size-3.5 text-blue-600 shrink-0" /> {row.suppliers}
          </p>
        ) : (
          <p className="text-sm italic text-[--color-text-muted]">
            No supplier yet{row.cancelled_lots > 0 ? ` (${plural(row.cancelled_lots, 'cancelled award')})` : ''}
          </p>
        )}
        <p className="text-xs text-[--color-text-muted] mt-0.5 tabular-nums">
          {row.awarded_items} of {plural(toAward, 'item')} with a winner
          {awarded > 0 && <>, <span className="font-semibold text-blue-700">{fmtCurrency(awarded)}</span></>}
          {estimate > 0 && ` (budget ${fmtCurrency(estimate)})`}
        </p>
      </div>

      <div className="basis-32 text-xs space-y-1">
        {['to_canvass', 'needs_award', 'with_twg', 'awaiting_po'].includes(stage) && (
          <p className={days > 3 ? 'font-semibold text-amber-700' : 'text-[--color-text-muted]'}>Waiting {plural(days, 'day')}</p>
        )}
        {stage === 'needs_award' && (row.recanvass_reason || row.certification_return_reason) && (
          <p className="flex items-center gap-1 font-semibold text-amber-700" title={row.recanvass_reason || row.certification_return_reason}>
            <AlertTriangle className="size-3 shrink-0" /> {row.recanvass_reason ? 'Re-canvass ordered by the TWG' : 'Returned by the TWG'}
          </p>
        )}
        {row.po_count > 0 && (stage === 'po_issued' || stage === 'awaiting_po') && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono font-semibold text-[--color-text-secondary]">{row.po_count > 1 ? plural(row.po_count, 'PO') : row.po_number}</span>
            {row.delivery_status && <DeliveryStatusBadge status={row.delivery_status} />}
          </div>
        )}
        {stage === 'cancelled' && <PRStatusBadge status={row.status} />}
      </div>

      <div className="flex items-center gap-1.5 ml-auto" onClick={e => e.stopPropagation()}>
        {canManage && stage === 'to_canvass' ? (
          <Button size="sm" className="gap-1.5" onClick={onStart}>
            <Gavel className="size-3.5" /> Start canvass
          </Button>
        ) : canManage && stage === 'awaiting_po' ? (
          <Button size="sm" asChild className="gap-1.5">
            <Link to={`/pr/${row.id}#purchase-order`}>
              <ShoppingCart className="size-3.5" /> Issue PO
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="gap-1 text-[--color-text-secondary]" onClick={onOpen}>
            View <ChevronRight className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

/* ── Main Page ────────────────────────────────────────────────────────── */
export default function Bidding() {
  const { user } = useAuth()
  const canManage = ['admin', 'procurement'].includes(user?.role)

  // Stage, category, search, and page live in the URL, so the back button,
  // a refresh, and a shared link all keep the same view.
  const [params, update] = useUrlParams()
  const navigate = useNavigate()
  const stage    = STAGES.some(s => s.key === params.get('stage')) ? params.get('stage') : canManage ? 'to_canvass' : 'po_issued'
  const category = CATEGORY_KEYS.includes(params.get('category')) ? params.get('category') : ''
  const page     = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')

  const { data, isLoading } = useQuery({
    queryKey: ['lot-queue', { stage, category, search, page }],
    queryFn: () => {
      const q = new URLSearchParams({ stage, page, limit: PAGE_SIZE })
      if (category) q.set('category', category)
      if (search)   q.set('search', search)
      return api.get(`/lots/queue?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
    refetchInterval: 30000,
  })
  // Start canvass: the request moves into canvass and its canvass page opens.
  const [opening, setOpening] = useState(null)   // the row being opened
  const rows    = data?.data ?? []
  const counts  = data?.counts
  const inStage = Object.values(counts?.categories || {}).reduce((a, b) => a + b, 0)
  const current = STAGES.find(s => s.key === stage)

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">Work Queue</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            Every request the TWG approved, by what it needs next: canvass it, send the winners to the BAC and the TWG, then issue the purchase orders.
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input
            placeholder="Search by PR number, title, or supplier…"
            value={search}
            onChange={e => { setSearch(e.target.value); update({ q: e.target.value, page: '' }) }}
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-[--color-border] overflow-x-auto">
          {STAGES.map(s => (
            <Tab key={s.key} active={stage === s.key} count={counts?.stages?.[s.key] ?? 0} onClick={() => update({ stage: s.key, page: '' })}>
              {s.label}
            </Tab>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-[--color-border]">
          <FilterChip active={!category} count={inStage} onClick={() => update({ category: '', page: '' })}>All categories</FilterChip>
          {CATEGORY_KEYS.map(c => (
            <FilterChip key={c} active={category === c} count={counts?.categories?.[c] ?? 0} onClick={() => update({ category: c, page: '' })}>
              {CATEGORY_LABELS[c]}
            </FilterChip>
          ))}
        </div>

        {isLoading ? (
          <div className="p-5 space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
        ) : !rows.length ? (
          <div className="py-16 text-center px-4">
            <Trophy className="size-10 text-[--color-text-muted] mx-auto mb-3" />
            <p className="text-ui-sm font-semibold text-[--color-text-primary]">
              {search || category ? 'No PRs match these filters.' : current.empty}
            </p>
            {canManage && stage === 'needs_award' && !search && !category && (
              <p className="text-ui-xs text-[--color-text-muted] mt-1">A request moves here when you start its canvass under To canvass; the BAC then enters the bids and awards.</p>
            )}
          </div>
        ) : (
          rows.map(row => (
            <AwardRow key={row.id} row={row} stage={stage} canManage={canManage} onOpen={() => navigate(`/pr/${row.id}/canvass`)}
              onStart={() => setOpening(row)} />
          ))
        )}

        <Pager page={page} totalPages={data?.totalPages} summary={data && plural(data.total, 'PR')}
          onPage={(n) => update({ page: n > 1 ? n : '' })} />
      </Card>

      {opening && (
        <StartCanvassDialog pr={opening} onClose={() => setOpening(null)}
          onStarted={() => navigate(`/pr/${opening.id}/canvass`)} />
      )}
    </div>
  )
}

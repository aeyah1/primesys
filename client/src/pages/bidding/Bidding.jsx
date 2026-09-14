import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Trophy, ChevronRight, FileDown, Search, ShoppingCart, Gavel, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { CategoryBadge, DeliveryStatusBadge, PRStatusBadge } from '@/components/shared/StatusBadge'
import CanvassPanel from '@/components/awards/CanvassPanel'
import { fmtCurrency, CATEGORY_LABELS } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS)
const PAGE_SIZE = 20

// What each PR needs next (lots.controller STAGES). A PR awarded in part can
// be in more than one: its other items still need an award while the awarded
// suppliers wait for their POs.
const STAGES = [
  { key: 'needs_award', label: 'Needs award', empty: 'No PRs are waiting for an award.' },
  { key: 'awaiting_po', label: 'Awaiting PO', empty: 'No awards are waiting for a purchase order.' },
  { key: 'po_issued',   label: 'PO issued',   empty: 'No purchase orders have been issued yet.' },
  { key: 'cancelled',   label: 'Cancelled',   empty: 'No PRs were cancelled after an award.' },
]
const daysSince = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5))
const plural    = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// A filter chip with its count (same look as the PR list's category chips).
function Chip({ active, count, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1 text-ui-xs font-medium transition-colors ${
        active
          ? 'border-[--color-brand] bg-[--color-brand] text-white'
          : count
            ? 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'
            : 'border-[--color-border] bg-white text-[--color-text-muted] hover:border-[--color-border-strong]'
      }`}>
      {children} <span className="opacity-80">({count})</span>
    </button>
  )
}

const abstractPdf = (prId) => openPdf(`/lots/pr/${prId}/pdf`)
  .catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the Abstract of Quotations')))

/* ── One PR in the queue, on one line; a click opens its canvass ──────── */
function AwardRow({ row, stage, canManage, onOpen }) {
  const days      = daysSince(row.stage_since)
  const estimate  = Number(row.estimated_total)
  const awarded   = Number(row.awarded_total)
  const toAward   = row.item_count - row.dropped_items
  const hasRecord = row.awarded_lots + row.cancelled_lots > 0

  return (
    <div onClick={onOpen}
      className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 sm:px-5 py-4 border-b border-[--color-border] last:border-0 cursor-pointer hover:bg-[--color-overlay] transition-colors">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/pr/${row.id}`} onClick={e => e.stopPropagation()} title="Open the PR"
            className="font-mono text-sm font-bold text-[--color-brand] hover:underline">{row.pr_number}</Link>
          <CategoryBadge category={row.category} />
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
          {row.awarded_items} of {plural(toAward, 'item')} awarded
          {awarded > 0 && <>, <span className="font-semibold text-blue-700">{fmtCurrency(awarded)}</span></>}
          {estimate > 0 && ` (budget ${fmtCurrency(estimate)})`}
        </p>
      </div>

      <div className="basis-32 text-xs space-y-1">
        {(stage === 'needs_award' || stage === 'awaiting_po') && (
          <p className={days > 3 ? 'font-semibold text-amber-700' : 'text-[--color-text-muted]'}>Waiting {plural(days, 'day')}</p>
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
        {canManage && stage === 'needs_award' ? (
          <Button size="sm" className="gap-1.5" onClick={onOpen}>
            <Gavel className="size-3.5" /> Canvass
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
        {hasRecord && (
          <Button variant="ghost" size="icon" title="Abstract of Quotations (PDF)" onClick={() => abstractPdf(row.id)}>
            <FileDown className="size-4 text-[--color-text-muted]" />
          </Button>
        )}
      </div>
    </div>
  )
}

/* ── The canvass of one PR, in a window over the list ─────────────────
   Opened by ?pr=ID, so one PR is open at a time, and a refresh, a link, or
   coming back from the PR page opens it again. The PR is loaded on its own,
   so the window stays open when an award moves the PR to another tab. */
function CanvassDialog({ prId, row, canManage, onClose }) {
  const id = prId ? String(prId) : ''
  const { data: loaded } = useQuery({
    queryKey: ['pr', id],
    queryFn:  () => api.get(`/pr/${id}`).then(r => r.data),
    enabled:  !!id,
  })
  // The same queries as the canvass panel inside (shared, not fetched twice).
  const { data: lots = [] } = useQuery({
    queryKey: ['lots', id],
    queryFn:  () => api.get(`/lots/pr/${id}`).then(r => r.data),
    enabled:  !!id,
  })
  const { data: canvass } = useQuery({
    queryKey: ['canvass', id],
    queryFn:  () => api.get(`/canvass/${id}`).then(r => r.data),
    enabled:  !!id,
  })
  const pr = loaded || row
  const hasRecord  = lots.length > 0 || canvass?.quotations?.length > 0
  const waitingPO  = canManage && lots.some(l => l.status === 'awarded' && !l.po_id)

  return (
    <Dialog open={!!id} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Canvass & Awards" description={pr ? `${pr.pr_number} · ${pr.title || 'Untitled request'}` : 'Loading…'} className="max-w-4xl">
        {!pr ? (
          <div className="space-y-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[--color-border] bg-[--color-canvas] px-4 py-3">
              <CategoryBadge category={pr.category} />
              <PRStatusBadge status={pr.status} />
              <span className="text-xs text-[--color-text-secondary]">
                {pr.created_by_name}{pr.department ? `, ${pr.department}` : ''}
              </span>
              <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                {hasRecord && (
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => abstractPdf(id)}>
                    <FileDown className="size-3.5" /> Abstract
                  </Button>
                )}
                {waitingPO && (
                  <Button size="sm" asChild className="gap-1.5">
                    <Link to={`/pr/${id}#purchase-order`}><ShoppingCart className="size-3.5" /> Issue PO</Link>
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild className="gap-1.5">
                  <Link to={`/pr/${id}`}>Open PR <ExternalLink className="size-3" /></Link>
                </Button>
              </div>
            </div>
            <CanvassPanel pr={pr} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── Main Page ────────────────────────────────────────────────────────── */
export default function Bidding() {
  const { user } = useAuth()
  const canManage = ['admin', 'procurement'].includes(user?.role)

  // Stage, category, search, and page live in the URL, so the back button,
  // a refresh, and a shared link all keep the same view.
  const [params, setParams] = useSearchParams()
  const stage    = STAGES.some(s => s.key === params.get('stage')) ? params.get('stage') : canManage ? 'needs_award' : 'po_issued'
  const category = CATEGORY_KEYS.includes(params.get('category')) ? params.get('category') : ''
  const page     = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')
  const update = (changes) => setParams(prev => {
    const next = new URLSearchParams(prev)
    for (const [k, v] of Object.entries(changes)) (v === '' || v == null ? next.delete(k) : next.set(k, String(v)))
    return next
  }, { replace: true })

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
  const rows    = data?.data ?? []
  const counts  = data?.counts
  const inStage = Object.values(counts?.categories || {}).reduce((a, b) => a + b, 0)
  const current = STAGES.find(s => s.key === stage)
  const openId  = params.get('pr')

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">Lots & Awards</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            {canManage
              ? 'Record suppliers\' quotations, award each item, then issue each supplier\'s purchase order.'
              : 'The suppliers awarded for each PR, and the items each award covers.'}
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
          {STAGES.map(s => {
            const n = counts?.stages?.[s.key] ?? 0
            return (
              <button key={s.key}
                onClick={() => update({ stage: s.key, page: '' })}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                  stage === s.key
                    ? 'border-[--color-brand] text-[--color-brand]'
                    : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
                }`}>
                {s.label}
                {n > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    stage === s.key ? 'bg-[--color-brand-light] text-[--color-brand]' : 'bg-[--color-overlay] text-[--color-text-muted]'
                  }`}>{n}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-[--color-border]">
          <Chip active={!category} count={inStage} onClick={() => update({ category: '', page: '' })}>All categories</Chip>
          {CATEGORY_KEYS.map(c => (
            <Chip key={c} active={category === c} count={counts?.categories?.[c] ?? 0} onClick={() => update({ category: c, page: '' })}>
              {CATEGORY_LABELS[c]}
            </Chip>
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
              <p className="text-ui-xs text-[--color-text-muted] mt-1">A PR appears here once you click Canvass PR on it.</p>
            )}
          </div>
        ) : (
          rows.map(row => <AwardRow key={row.id} row={row} stage={stage} canManage={canManage} onOpen={() => update({ pr: row.id })} />)
        )}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[--color-border]">
            <span className="text-xs text-[--color-text-muted]">Page {data.page} of {data.totalPages} · {plural(data.total, 'PR')}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => update({ page: page - 1 > 1 ? page - 1 : '' })} disabled={page <= 1}>Previous</Button>
              <Button variant="secondary" size="sm" onClick={() => update({ page: page + 1 })} disabled={page >= data.totalPages}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      <CanvassDialog prId={openId} row={rows.find(r => String(r.id) === openId)} canManage={canManage} onClose={() => update({ pr: '' })} />
    </div>
  )
}

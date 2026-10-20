import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Search, FileStack, ChevronRight, Lock, LockOpen, Timer } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Pager, EmptyState } from '@/components/shared/ListParts'
import { DQBadge } from '@/components/awards/supplier'
import DocumentViewer from '@/components/awards/DocumentViewer'
import { useAuth } from '@/context/AuthContext'
import useUrlParams from '@/hooks/useUrlParams'
import useRfqAccess from '@/hooks/useRfqAccess'
import { fmtCurrency, fmtDate, fmtDatetime } from '@/lib/utils'
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

// How long the BAC may open the RFQs for (server utils/quoteAccess.js DURATIONS), in hours.
const DURATIONS = [[1, '1 hour'], [4, '4 hours'], [24, '1 day'], [72, '3 days'], [168, '7 days']]

// The time left until `until`, in words: "2 h 15 min left", "3 days left".
function timeLeft(until, now) {
  const min = Math.max(Math.ceil((Date.parse(until) - now) / 60_000), 0)
  if (min < 1) return 'less than a minute left'
  if (min < 60) return `${min} min left`
  if (min < 48 * 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''} left`
  return `${Math.floor(min / 1440)} days left`
}

// The clock, ticking every `ms`, for a countdown.
function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

// Whether the RFQs are open (until the BAC locks them, or until a time, with the time left), or who locked them last.
function AccessLine({ access }) {
  const now = useNow()
  if (access.open) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-ui-sm text-emerald-900">
        <LockOpen className="size-4 shrink-0" />
        {access.until
          ? <>
              <span>Open to Procurement and admins until <span className="font-semibold">{fmtDatetime(access.until)}</span>, then they lock again by themselves.</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-semibold"><Timer className="size-3" /> {timeLeft(access.until, now)}</span>
            </>
          : <span>Open to Procurement and admins until a BAC member locks them.</span>}
        {access.by && <span className="text-emerald-800">Opened by {access.by}, {fmtDatetime(access.at)}.</span>}
      </p>
    )
  }
  return (
    <p className="flex items-center gap-2 rounded-xl border border-[--color-border-strong] bg-[--color-overlay] px-4 py-2.5 text-ui-sm text-[--color-text-secondary]">
      <Lock className="size-4 shrink-0" /> Locked: only the BAC sees the RFQs on this page.
      {access.at && (access.by ? ` Locked by ${access.by}, ${fmtDatetime(access.at)}.` : ` Locked by itself at ${fmtDatetime(access.at)}, when its time ran out.`)}
    </p>
  )
}

// One choice of how long the RFQs stay open: a radio card, its details shown when picked.
function Choice({ checked, onPick, title, sub, children }) {
  return (
    <div role="radio" aria-checked={checked} tabIndex={0} onClick={onPick} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onPick() } }}
      className={`cursor-pointer rounded-xl border px-4 py-3 transition-colors ${checked ? 'border-[--color-brand] bg-[--color-brand-light]' : 'border-[--color-border-strong] hover:border-[--color-brand]'}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${checked ? 'border-[--color-brand]' : 'border-[--color-border-strong]'}`}>
          {checked && <span className="size-2 rounded-full bg-[--color-brand]" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-ui-sm font-semibold text-[--color-text-primary]">{title}</p>
          <p className="text-ui-xs text-[--color-text-secondary]">{sub}</p>
          {checked && children}
        </div>
      </div>
    </div>
  )
}

// The BAC opens the RFQs, until it locks them or for a set time; or (`changing`, already open) changes that from now.
function OpenDialog({ open, changing, current, onClose, onOpen, busy }) {
  const [timed, setTimed] = useState(!!current)
  const [hours, setHours] = useState(24)
  const now = useNow(15_000)
  const until = new Date(now + hours * 3_600_000).toISOString()
  const label = DURATIONS.find(([h]) => h === hours)[1]
  const action = changing ? (timed ? `Keep open for ${label}` : 'Keep open until we lock them') : (timed ? `Open for ${label}` : 'Open the RFQs')
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg" title={changing ? 'Change how long the RFQs stay open' : 'Open the RFQs for Procurement and admins?'}
        description={changing
          ? `They are open to Procurement and admins ${current ? `until ${fmtDatetime(current)}` : 'until the BAC locks them'}. Pick again; they are told the change.`
          : "They can then see every returned RFQ on this page, with each supplier's total and outcome. They are notified when the RFQs open and when they lock."}>
        <div className="space-y-2.5" role="radiogroup" aria-label="How long the RFQs stay open">
          <p className="text-ui-sm font-semibold text-[--color-text-primary]">How long do they stay open?</p>
          <Choice checked={!timed} onPick={() => setTimed(false)} title="Until we lock them" sub="They stay open until a BAC member clicks Lock the RFQs now." />
          <Choice checked={timed} onPick={() => setTimed(true)} title="For a set time" sub="They lock again by themselves when the time is up.">
            <div className="mt-3 flex flex-wrap gap-2" aria-label="For how long">
              {DURATIONS.map(([h, text]) => (
                <button key={h} type="button" aria-pressed={hours === h} onClick={(e) => { e.stopPropagation(); setHours(h) }}
                  className={`rounded-full border px-3 py-1 text-ui-xs font-medium transition-colors ${hours === h
                    ? 'border-[--color-brand] bg-[--color-brand] text-white'
                    : 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'}`}>
                  {text}
                </button>
              ))}
            </div>
            <p className="mt-2.5 flex items-center gap-1.5 text-ui-xs text-[--color-text-secondary]">
              <Timer className="size-3.5 shrink-0 text-[--color-brand]" />
              <span>Locks again at <span className="font-semibold text-[--color-text-primary]">{fmtDatetime(until)}</span>, or sooner if you lock it.</span>
            </p>
          </Choice>
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button className="gap-1.5" onClick={() => onOpen(timed ? hours : null)} disabled={busy}>
            {changing ? <Timer className="size-4" /> : <LockOpen className="size-4" />} {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* Every RFQ uploaded to a request, newest first, found by search, each opened whole beside the list; with its quotation,
   the supplier, RFQ No., total and outcome. The BAC opens the page to Procurement and admins here, or locks it again
   (server utils/quoteAccess.js). */
export default function RfqHistory() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [opening, setOpening] = useState(false)
  const isBac = user?.role === 'bac'
  const [params, update] = useUrlParams()
  const page = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')
  const [shown, setShown] = useState(null)   // the RFQ open beside the list; the newest unless one is picked
  const viewer = useRef(null)

  const { data: access } = useRfqAccess()
  const locked = ['procurement', 'admin'].includes(user?.role) && access && !access.open
  const { data, isLoading } = useQuery({
    queryKey: ['rfqs', { search, page }],
    queryFn: () => {
      const q = new URLSearchParams({ page })
      if (search.trim()) q.set('search', search.trim())
      return api.get(`/rfqs?${q}`).then(r => r.data)
    },
    enabled: !!access && !locked,
    placeholderData: keepPreviousData,
  })
  // Opening (for a set time) or locking now; opening is confirmed in OpenDialog first.
  const { mutate: setOpen, isPending } = useMutation({
    mutationFn: (body) => api.put('/rfqs/access', body).then(r => r.data),
    onSuccess: (res) => { toast.success(res.message); qc.setQueryData(['rfq-access'], res.access); setOpening(false) },
    onError: (err) => toast.error(err.response?.data?.message || 'The page could not be changed'),
  })
  const rows = data?.data ?? []
  const current = rows.find(q => keyOf(q) === shown) || rows[0]
  // On a narrow screen the RFQ is under the list, so it is scrolled into view.
  const pick = (q) => { setShown(keyOf(q)); viewer.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">RFQ History</h2>
          <p className="mt-0.5 text-ui-sm text-[--color-text-secondary]">Every RFQ uploaded to a request, newest first.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isBac && access && (access.open
            ? <>
                <Button variant="secondary" className="gap-1.5" disabled={isPending} onClick={() => setOpening(true)}><Timer className="size-4" /> Change the time</Button>
                <Button variant="secondary" className="gap-1.5" disabled={isPending} onClick={() => setOpen({ open: false })}><Lock className="size-4" /> Lock the RFQs now</Button>
              </>
            : <Button className="gap-1.5" disabled={isPending} onClick={() => setOpening(true)}><LockOpen className="size-4" /> Open for Procurement and admins</Button>)}
          {!locked && (
            <div className="relative w-72 max-w-full">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[--color-text-muted]" />
              <Input placeholder="Supplier, RFQ or PR No." value={search} className="pl-9"
                onChange={e => { setSearch(e.target.value); update({ q: e.target.value, page: '' }) }} />
            </div>
          )}
        </div>
      </div>

      {access && !locked && <AccessLine access={access} />}
      {isBac && opening && <OpenDialog open changing={!!access?.open} current={access?.open ? access.until : null} onClose={() => setOpening(false)} busy={isPending}
        onOpen={(hours) => setOpen(hours ? { open: true, hours } : { open: true })} />}

      {locked ? (
        <Card>
          <EmptyState icon={Lock} title="The BAC has locked the RFQs"
            sub="The RFQ History stays with the BAC until it opens it to you. You get a notification when it does." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-5">
          <Card className="overflow-hidden 2xl:col-span-3">
            <CardContent className="p-0">
              {isLoading || !access
                ? <div className="space-y-3 p-6">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
                : !rows.length
                  ? <EmptyState icon={FileStack} title="No RFQ found"
                      sub={search.trim() ? 'Try another supplier, file name or request.' : 'The RFQs uploaded to the requests show here.'} />
                  : rows.map(q => (
                    <button key={keyOf(q)} type="button" onClick={() => pick(q)} aria-pressed={q === current}
                      className={`flex w-full items-center justify-between gap-4 border-b border-l-2 border-b-[--color-border] px-6 py-4 text-left transition-colors last:border-b-0 ${
                        q === current ? 'border-l-[--color-brand] bg-[--color-brand-light]' : 'border-l-transparent hover:bg-overlay/60'}`}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-ui-sm font-bold text-[--color-text-primary]">{q.supplier || q.file_name}<Outcome q={q} /></p>
                        <p className="mt-0.5 truncate text-ui-xs text-[--color-text-secondary]">
                          {q.pr_number}{q.title ? `: ${q.title}` : ''}
                          {q.quotation_id ? ` · ${q.items} item${q.items === 1 ? '' : 's'}` : ` · uploaded by ${q.uploaded_by}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-5 text-right">
                        {[['RFQ No.', q.rfq_no || 'None'], ['Total', q.total == null ? 'None' : fmtCurrency(q.total)], ['Uploaded', fmtDate(q.uploaded_at)]].map(([label, value]) => (
                          <div key={label} className="hidden sm:block">
                            <p className="text-ui-sm font-bold tabular-nums text-[--color-text-primary]">{value}</p>
                            <p className="text-[10px] uppercase tracking-wider text-[--color-text-muted]">{label}</p>
                          </div>
                        ))}
                        <ChevronRight className="size-4 text-[--color-text-muted]" />
                      </div>
                    </button>
                  ))}
              <Pager page={page} totalPages={data?.totalPages} summary={`${data?.total ?? 0} total`}
                onPage={(n) => update({ page: n > 1 ? n : '' })} />
            </CardContent>
          </Card>

          {current && (
            <section ref={viewer} className="space-y-3 2xl:sticky 2xl:top-4 2xl:col-span-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="min-w-0 truncate text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">
                  {current.supplier ? `${current.supplier}, RFQ No. ${current.rfq_no || 'none'}` : current.file_name}
                </h3>
                <Link to={`/pr/${current.pr_id}`} className="inline-flex items-center gap-0.5 text-ui-xs font-semibold text-[--color-brand] hover:underline">
                  {current.pr_number} <ChevronRight className="size-3.5" />
                </Link>
              </div>
              <div className="overflow-hidden rounded-xl border border-[--color-border] bg-white">
                <DocumentViewer prId={String(current.pr_id)} file={{ id: current.file_id, original_name: current.file_name, mimetype: current.file_type }} />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

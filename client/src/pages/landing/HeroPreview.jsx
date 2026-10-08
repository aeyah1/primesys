import { useEffect, useState } from 'react'
import { Check, UserRound } from 'lucide-react'
import { PRStatusBadge } from '@/components/shared/StatusBadge'
import { REQUEST_STEPS, requestProgress } from '@/lib/requestProgress'
import { fmtCurrency } from '@/lib/utils'
import { useInView, reducedMotion } from './LandingParts'

// A made-up request walking through the real status flow; none of this is live data.
const FRAMES = [
  { status: 'submitted',         event: 'Submitted to the TWG',              by: 'End User',    at: 'Oct 1, 9:12 AM' },
  { status: 'twg_review',        event: 'Approved, review certificate issued', by: 'TWG',       at: 'Oct 2, 2:40 PM' },
  { status: 'bidding',           event: 'Canvass started, RFQ printed',      by: 'Procurement', at: 'Oct 3, 10:05 AM' },
  { status: 'twg_certification', event: 'Three quotations recorded',         by: 'BAC',         at: 'Oct 9, 3:18 PM' },
  { status: 'bac_review',        event: 'Offers checked and certified',      by: 'TWG',         at: 'Oct 10, 11:30 AM' },
  { status: 'for_po',            event: 'Lot awarded',                       by: 'BAC',         at: 'Oct 13, 9:02 AM' },
  { status: 'for_po',            event: 'Purchase order issued',             by: 'Procurement', at: 'Oct 14, 8:47 AM', pos: [{ delivery_status: 'pending' }] },
  { status: 'completed',         event: 'Delivery received in full',         by: 'Supply',      at: 'Oct 21, 1:45 PM' },
]
const STILL = 4

// `compact` leaves out the activity list, for tighter spaces like the sign-in panel.
export default function HeroPreview({ compact = false }) {
  const [ref, visible] = useInView({ once: false, threshold: 0.2, rootMargin: '0px' })
  const [i, setI] = useState(() => (reducedMotion() ? STILL : 0))

  useEffect(() => {
    if (!visible || reducedMotion()) return
    const t = setTimeout(() => setI(n => (n + 1) % FRAMES.length), i === FRAMES.length - 1 ? 4200 : 2400)
    return () => clearTimeout(t)
  }, [i, visible])

  const frame = FRAMES[i]
  const p = requestProgress(frame)
  const last = REQUEST_STEPS.length - 1
  const recent = FRAMES.slice(0, i + 1).reverse().slice(0, 3)

  return (
    <div ref={ref} aria-label="Example of a purchase request moving through PRimeSys" role="img"
      className="w-full overflow-hidden rounded-lg border border-white/15 bg-[--color-surface] shadow-lg">
      {/* app bar */}
      <div className="flex items-center justify-between border-b border-[--color-border] bg-[--color-canvas] px-6 py-3 text-ui-xs">
        <span className="text-[--color-text-muted]">My Requests <span className="px-1.5">/</span> <span className="font-semibold text-[--color-text-secondary]">Request details</span></span>
        <span className="flex items-center gap-2 font-medium text-[--color-text-secondary]">
          <span className="relative flex size-2">
            <span className="absolute size-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
            <span className="relative size-2 rounded-full bg-emerald-500" />
          </span>
          Updated live
        </span>
      </div>

      {/* request header */}
      <div className="flex flex-col gap-3 px-6 pb-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p key={i >= 2 ? 'numbered' : 'pending'} className="text-ui-xs font-semibold tabular-nums text-[--color-text-muted] motion-safe:animate-fade-in">
            {i >= 2 ? 'PR No. 2026-10-0142' : 'PR No. given at canvass'}
          </p>
          <p className="mt-1 truncate text-ui-lg font-bold text-[--color-text-primary]">Printer toner and bond paper</p>
          <p className="mt-1.5 flex items-center gap-2 text-ui-xs text-[--color-text-secondary]">
            Registrar <span className="size-1 rounded-full bg-[--color-border-strong]" />
            Q4 2026 <span className="size-1 rounded-full bg-[--color-border-strong]" />
            6 items
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
          <span key={i} className="motion-safe:animate-scale-in"><PRStatusBadge status={frame.status} /></span>
          <p className="text-ui-sm font-bold tabular-nums text-[--color-text-primary]">{fmtCurrency(48250)}</p>
        </div>
      </div>

      {/* tracker */}
      <div className="border-t border-[--color-border] px-6 py-5">
        <ol className="relative grid grid-cols-5">
          <span className="absolute left-[10%] right-[10%] top-4 h-0.5 bg-[--color-border]" />
          <span className="absolute left-[10%] top-4 h-0.5 bg-[--color-brand] transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${(Math.min(p.step, last) / last) * 80}%` }} />
          {REQUEST_STEPS.map((label, s) => {
            const done = s < p.step
            const current = s === p.step
            return (
              <li key={label} className="relative flex flex-col items-center gap-2 text-center">
                <span className={`flex size-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors duration-500 ${
                  done ? 'border-[--color-brand] bg-[--color-brand] text-white'
                  : current ? 'border-[--color-brand] bg-[--color-surface] text-[--color-brand] shadow-[0_0_0_4px_hsl(var(--brand)/0.15)]'
                  : 'border-[--color-border] bg-[--color-surface] text-[--color-text-muted]'
                }`}>
                  {done ? <Check className="size-4" /> : s + 1}
                </span>
                <span className={`px-1 text-[11px] leading-tight transition-colors duration-500 ${current ? 'font-semibold text-[--color-text-primary]' : 'text-[--color-text-muted]'}`}>
                  {label}
                </span>
              </li>
            )
          })}
        </ol>

        <div className="mt-5 rounded-md border border-[--color-border-strong] bg-[--color-canvas] px-4 py-3">
          <p key={p.title} className="text-ui-sm font-semibold text-[--color-text-primary] motion-safe:animate-fade-in">{p.title}</p>
          <p className="mt-1.5 flex items-center gap-2 text-ui-xs text-[--color-text-secondary]">
            <UserRound className="size-3.5 shrink-0 text-[--color-text-muted]" />
            <span><span className="font-semibold">Who has it now:</span> {p.who}</span>
          </p>
        </div>
      </div>

      {/* activity */}
      {!compact && <div className="border-t border-[--color-border] px-6 py-4">
        <p className="text-ui-xs font-semibold uppercase tracking-wide text-[--color-text-muted]">Activity</p>
        <ul className="mt-3 min-h-[5.25rem] space-y-2.5">
          {recent.map((f, k) => (
            <li key={f.event} className={`flex items-center gap-3 text-ui-xs ${k === 0 ? 'motion-safe:animate-fade-in-down' : ''}`}>
              <span className={`size-2 shrink-0 rounded-full ${k === 0 ? 'bg-[--color-gold]' : 'bg-[--color-border-strong]'}`} />
              <span className={`flex-1 truncate ${k === 0 ? 'font-semibold text-[--color-text-primary]' : 'text-[--color-text-secondary]'}`}>{f.event}</span>
              <span className="hidden text-[--color-text-muted] sm:inline">{f.by}</span>
              <span className="w-[6.5rem] shrink-0 text-right tabular-nums text-[--color-text-muted]">{f.at}</span>
            </li>
          ))}
        </ul>
      </div>}
    </div>
  )
}

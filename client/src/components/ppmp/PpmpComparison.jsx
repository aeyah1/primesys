import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MONTHS } from '@/components/ppmp/PpmpStatusBadge'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

const qty = (n) => Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 })
const months = (list) => (list?.length === 12 ? 'Every month' : (list || []).map(m => MONTHS[m - 1]).join(', ') || 'Not scheduled')

// A request's items against its office's PPMP, as the server checks them (GET /pr/:id/ppmp).
export function usePrPpmp(prId) {
  return useQuery({
    queryKey: ['pr-ppmp', String(prId)],
    queryFn: () => api.get(`/pr/${prId}/ppmp`).then(r => r.data),
    enabled: !!prId,
  })
}

// Opens the whole PPMP; in a new tab from a dialog, so a comment being written stays.
export function ViewPpmpButton({ plan, newTab = false }) {
  if (!plan) return null
  // The sign-in lives in this tab's sessionStorage, which window.open copies to the new tab (a noopener link would start it signed out).
  if (newTab) {
    return (
      <Button type="button" variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => window.open(`/ppmp/${plan.id}`, '_blank')}>
        <ExternalLink className="size-3.5" /> View whole PPMP
      </Button>
    )
  }
  return (
    <Button asChild variant="outline" size="sm" className="gap-1.5 shrink-0">
      <Link to={`/ppmp/${plan.id}`}>
        <ExternalLink className="size-3.5" /> View whole PPMP
      </Link>
    </Button>
  )
}

/* Each requested item beside the PPMP line it is drawn from: the price and
   quantity asked against the PPMP's price, what is planned and still left
   (other requests' holds counted), and when it is scheduled, with anything
   that doesn't match pointed out. items: the request's items (id, item_name,
   quantity, unit, estimated_cost). compact: two stacked columns, for a dialog. */
export default function PpmpComparison({ prId, items, compact = false }) {
  const { data: review, isLoading } = usePrPpmp(prId)
  if (isLoading) return <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
  if (!review?.plan) {
    return <p className="text-ui-sm text-[--color-text-secondary]">{review?.problems?.[0] || 'No PPMP in effect to compare with.'}</p>
  }
  const byId = new Map(review.items.map(r => [r.id, r]))
  const rows = items.map(it => ({ it, r: byId.get(it.id) || { line: null, warnings: [], problem: null } }))

  if (compact) {
    return (
      <div className="divide-y divide-[--color-border] rounded-lg border border-[--color-border]">
        <div className="grid grid-cols-2 gap-3 bg-[--color-canvas] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted]">
          <span>Requested</span><span>In the PPMP</span>
        </div>
        {rows.map(({ it, r }, k) => (
          <div key={it.id} className="px-3 py-2.5 space-y-1.5">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="min-w-0">
                <p className="font-medium text-[--color-text-primary] leading-snug"><span className="text-[--color-text-muted] mr-1">{k + 1}.</span>{it.item_name}</p>
                <p className="text-[--color-text-secondary] tabular-nums">{qty(it.quantity)} {it.unit || ''}{it.estimated_cost ? ` at ${fmtCurrency(it.estimated_cost)}` : ''}</p>
              </div>
              {r.line ? (
                <div className="min-w-0">
                  <p className="font-medium text-[--color-text-primary] leading-snug">{r.line.description}</p>
                  <p className="text-[--color-text-secondary] tabular-nums">{fmtCurrency(r.line.unit_cost)} each; planned {qty(r.line.planned)}, {qty(r.line.remaining)} available</p>
                  <p className="text-[--color-text-muted]">{months(r.line.months)}</p>
                </div>
              ) : <p className="text-red-700">Not in the PPMP</p>}
            </div>
            {[r.problem, ...r.warnings].filter(Boolean).map(w => (
              <p key={w} className={`flex items-start gap-1.5 text-[11px] ${r.problem === w ? 'text-red-700' : 'text-amber-800'}`}>
                <AlertTriangle className="size-3 shrink-0 mt-px" /> {w}
              </p>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[--color-border] text-[10px] font-bold uppercase tracking-wider text-[--color-text-secondary]">
            <th colSpan={3} className="bg-[--color-canvas] px-4 pt-2.5 text-left">Requested</th>
            <th colSpan={5} className="bg-[--color-brand-light] px-4 pt-2.5 text-left text-[--color-brand]">In the PPMP</th>
          </tr>
          <tr className="border-b border-[--color-border] text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
            <th className="bg-[--color-canvas] px-4 py-2 text-left">Item</th>
            <th className="bg-[--color-canvas] px-3 py-2 text-right">Qty</th>
            <th className="bg-[--color-canvas] px-3 py-2 text-right">Price each</th>
            <th className="bg-[--color-brand-light] px-4 py-2 text-left">Line</th>
            <th className="bg-[--color-brand-light] px-3 py-2 text-right">Price each</th>
            <th className="bg-[--color-brand-light] px-3 py-2 text-right">Planned</th>
            <th className="bg-[--color-brand-light] px-3 py-2 text-right" title="Planned, less what other requests hold">Available</th>
            <th className="bg-[--color-brand-light] px-3 py-2 text-left">Schedule</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ it, r }) => {
            const notes = [r.problem, ...r.warnings].filter(Boolean)
            const over = r.line && it.estimated_cost != null && Number(it.estimated_cost) > r.line.unit_cost
            return (
              <tr key={it.id} className="border-b border-[--color-border] last:border-0 align-top">
                <td className="px-4 py-2.5 min-w-44">
                  <p className="text-[--color-text-primary]">{it.item_name}</p>
                  {notes.map(w => (
                    <p key={w} className={`mt-1 flex items-start gap-1.5 text-[11px] ${r.problem === w ? 'text-red-700' : 'text-amber-800'}`}>
                      <AlertTriangle className="size-3 shrink-0 mt-px" /> {w}
                    </p>
                  ))}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{qty(it.quantity)} {it.unit || ''}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${over ? 'font-semibold text-amber-700' : ''}`}>{it.estimated_cost != null ? fmtCurrency(it.estimated_cost) : 'None'}</td>
                {r.line ? (
                  <>
                    <td className="px-4 py-2.5 min-w-44 text-[--color-text-primary]">{r.line.description}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtCurrency(r.line.unit_cost)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{qty(r.line.planned)} {r.line.unit}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${Number(r.line.remaining) < Number(it.quantity) ? 'font-semibold text-red-700' : ''}`}>{qty(r.line.remaining)}</td>
                    <td className="px-3 py-2.5 text-xs text-[--color-text-secondary]">{months(r.line.months)}</td>
                  </>
                ) : <td colSpan={5} className="px-4 py-2.5 text-xs text-red-700">Not in the PPMP</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

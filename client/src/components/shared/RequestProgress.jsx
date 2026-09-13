import { Check, UserRound, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { REQUEST_STEPS, requestProgress } from '@/lib/requestProgress'
import { fmtDate } from '@/lib/utils'

const TONE = {
  action:  'border-amber-300 bg-amber-50',
  stopped: 'border-red-300 bg-red-50',
  done:    'border-blue-300 bg-blue-50',
}

// "Where is my request?" for the person who filed the PR: five plain steps,
// the current state in one line, who has it now, and what happens next.
export default function RequestProgress({ pr }) {
  const p = requestProgress(pr)
  // The soonest expected date among its POs not yet delivered.
  const next = (pr.pos || []).filter(po => po.delivery_status !== 'delivered' && po.expected_delivery_date)
    .map(po => String(po.expected_delivery_date).slice(0, 10)).sort()[0]
  const expected = ['for_po', 'bidding'].includes(pr.status) && next ? ` Expected by ${fmtDate(next)}.` : ''

  return (
    <Card>
      <CardContent className="py-5 space-y-5">
        <div>
          <p className="text-ui-xs font-semibold uppercase tracking-wide text-[--color-text-muted]">Where your request is</p>
          <ol className="mt-3 grid grid-cols-5 gap-2">
            {REQUEST_STEPS.map((label, i) => {
              const done    = p.step !== null && i < p.step
              const current = p.step === i && p.tone !== 'stopped'
              const stopped = p.tone === 'stopped' && p.step === i
              return (
                <li key={label} className="flex flex-col items-center text-center gap-1.5">
                  <div className={`flex size-8 items-center justify-center rounded-full border-2 text-xs font-bold ${
                    done    ? 'border-blue-600 bg-blue-600 text-white'
                    : stopped ? 'border-red-500 bg-red-50 text-red-600'
                    : current ? 'border-blue-600 bg-white text-blue-700'
                    : 'border-[--color-border] bg-[--color-canvas] text-[--color-text-muted]'
                  }`}>
                    {done ? <Check className="size-4" /> : i + 1}
                  </div>
                  <span className={`text-[11px] leading-tight ${
                    current || stopped ? 'font-semibold text-[--color-text-primary]' : 'text-[--color-text-muted]'
                  }`}>
                    {label}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>

        <div className={`rounded-lg border px-4 py-3 space-y-2 ${TONE[p.tone] || 'border-[--color-border] bg-[--color-canvas]'}`}>
          <p className="text-sm font-semibold text-[--color-text-primary]">{p.title}</p>
          <p className="flex items-start gap-2 text-ui-xs text-[--color-text-secondary]">
            <UserRound className="size-3.5 shrink-0 mt-0.5 text-[--color-text-muted]" />
            <span><span className="font-semibold">Who has it now:</span> {p.who}</span>
          </p>
          <p className="flex items-start gap-2 text-ui-xs text-[--color-text-secondary]">
            <ArrowRight className="size-3.5 shrink-0 mt-0.5 text-[--color-text-muted]" />
            <span><span className="font-semibold">What happens next:</span> {p.next}{expected}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

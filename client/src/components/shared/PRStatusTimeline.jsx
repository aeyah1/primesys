import { Check, Circle } from 'lucide-react'

const STEPS = [
  { key: 'submitted',        label: 'Submitted' },
  { key: 'for_bidding',      label: 'For Bidding' },
  { key: 'bidding_done',     label: 'Bidding Done' },
  { key: 'awarded',          label: 'Awarded' },
  { key: 'po_issued',        label: 'PO Issued' },
  { key: 'waiting_delivery', label: 'Waiting Delivery' },
  { key: 'delivered',        label: 'Delivered' },
]

const ORDER = STEPS.map((s) => s.key)

export function PRStatusTimeline({ status }) {
  const currentIdx = ORDER.indexOf(status)

  return (
    <div className="flex items-start gap-0">
      {STEPS.map((step, i) => {
        const done    = i < currentIdx || status === 'delivered'
        const active  = i === currentIdx
        const future  = i > currentIdx

        return (
          <div key={step.key} className="flex flex-col items-center flex-1">
            <div className="flex items-center w-full">
              {i > 0 && <div className={`h-0.5 flex-1 ${done ? 'bg-brand' : 'bg-[--color-border]'}`} />}
              <div className={`
                flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors
                ${done   ? 'bg-brand border-brand text-white' : ''}
                ${active ? 'bg-white border-brand text-brand' : ''}
                ${future ? 'bg-white border-[--color-border] text-[--color-text-muted]' : ''}
              `}>
                {done ? <Check className="size-3.5" /> : <Circle className="size-2.5 fill-current" />}
              </div>
              {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 ${done ? 'bg-brand' : 'bg-[--color-border]'}`} />}
            </div>
            <p className={`mt-2 text-center text-ui-xs font-medium ${active ? 'text-brand' : done ? 'text-[--color-text-secondary]' : 'text-[--color-text-muted]'}`}>
              {step.label}
            </p>
          </div>
        )
      })}
    </div>
  )
}

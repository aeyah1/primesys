import {
  Send, Pencil, Undo2, RotateCcw, CheckCircle2, XCircle, Gavel, Printer, FileText, Scale, ShieldCheck,
  ShoppingCart, Truck, BellRing, UserRound, Hourglass, PartyPopper,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// Each action's button: its words and icon (lib/nextStep.js names them); My tasks uses them too.
export const ACTIONS = {
  submit:           ['Submit to TWG', Send],
  edit:             ['Edit request', Pencil],
  withdraw:         ['Pull back to edit', Undo2],
  reopen:           ['Edit and resubmit', RotateCcw],
  twg_approve:      ['Approve', CheckCircle2],
  twg_revise:       ['Return for changes', RotateCcw],
  twg_reject:       ['Reject', XCircle],
  start_canvass:    ['Start canvass', Gavel],
  print_rfq:        ['Print RFQ', Printer],
  word_rfq:         ['RFQ as Word', FileText],
  record_award:     ['Record the award', Scale],
  check_offers:     ['Check the award', ShieldCheck],
  issue_po:         ['Issue purchase order', ShoppingCart],
  record_delivery:  ['Record delivery', Truck],
  remind:           ['Remind Procurement', BellRing],
}

/* The one place on every request that says what happens next: gold with the button(s) when it is the viewer's turn,
   plain with who has it when it is not. step: lib/nextStep.js nextStepOf; onAction(key) runs one; busy and
   labels ({ key: words }) adjust a button (pending, or "Reminder sent"); disabled: keys that can't run now. */
export default function NextStepPanel({ step, onAction, busy, disabled = [], labels = {} }) {
  const { mine, done, title, text, actions = [] } = step
  const [main, ...rest] = actions
  const Icon = mine ? ACTIONS[main]?.[1] || Hourglass : done ? PartyPopper : UserRound
  const button = (key, primary) => {
    const [label, BIcon] = ACTIONS[key] || [key, null]
    return (
      <Button key={key} variant={primary ? 'primary' : 'outline'} size={primary ? 'lg' : 'md'} className="gap-1.5"
        disabled={busy || disabled.includes(key)} onClick={() => onAction(key)}>
        {BIcon && <BIcon className="size-4" />} {labels[key] || label}
      </Button>
    )
  }
  return (
    <section aria-label="Your next step"
      className={`flex flex-col gap-4 rounded-2xl border px-5 py-5 shadow-sm sm:flex-row sm:items-center ${mine
        ? 'border-amber-300 bg-amber-50'
        : 'border-[--color-border] bg-[--color-surface]'}`}>
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl border bg-[--color-surface] ${mine ? 'border-amber-300 text-amber-700' : 'border-[--color-border] text-[--color-brand]'}`}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className={`text-[11px] font-bold uppercase tracking-wider ${mine ? 'text-amber-800' : 'text-[--color-text-muted]'}`}>
            {mine ? 'Your next step' : done ? 'Finished' : 'Nothing for you to do now'}
          </p>
          <h3 className="mt-0.5 text-ui-lg font-bold text-[--color-text-primary]">{title}</h3>
          {text && <p className="mt-0.5 whitespace-pre-wrap text-ui-sm text-[--color-text-secondary]">{text}</p>}
        </div>
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {mine ? <>{rest.map(k => button(k, false))}{button(main, true)}</> : actions.map(k => button(k, false))}
        </div>
      )}
    </section>
  )
}

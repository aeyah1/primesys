import { Lock } from 'lucide-react'

// What shows where the suppliers' RFQs and quotations would be, for those who may not see them (server utils/quoteAccess.js).

// A line saying what is hidden and why.
export function QuotesLockedNote({ children = 'Only Procurement sees the suppliers\' RFQs and prices.' }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-[--color-border-strong] bg-[--color-overlay] px-4 py-2.5 text-ui-xs text-[--color-text-secondary]">
      <Lock className="mt-0.5 size-3.5 shrink-0" /> {children}
    </p>
  )
}

// In place of a print button: the document is Procurement's only; `short` in a narrow table column.
export function LockedChip({ label, short = false }) {
  return (
    <span title="Only Procurement sees the suppliers' RFQs and quotations"
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[--color-border-strong] bg-[--color-overlay] px-2.5 py-1 text-[11px] font-medium text-[--color-text-muted]">
      <Lock className="size-3" /> {short ? 'Locked' : `${label}: Procurement only`}
    </span>
  )
}

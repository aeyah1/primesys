import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs) => twMerge(clsx(inputs))

export const fmtCurrency = (val) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val ?? 0)

export const fmtDate = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}

export const fmtDatetime = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const fmtDateRange = (start, end) => {
  if (!start) return '—'
  if (!end) return fmtDate(start)
  const s = new Date(start)
  const e = new Date(end)
  // Normalize to date-only comparison
  const sStr = s.toISOString().slice(0, 10)
  const eStr = e.toISOString().slice(0, 10)
  if (sStr === eStr) return fmtDate(start)
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-PH', { day: 'numeric', year: 'numeric' })}`
  }
  return `${fmtDate(start)} – ${fmtDate(end)}`
}

// Keep these in sync with the server-side validation lists in pr.controller / lots.controller.
export const PR_STATUS_LABELS = {
  draft:     'Draft',
  submitted: 'Submitted',
  bidding:   'Bidding',
  for_po:    'Ready for PO',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const PR_STATUS_COLORS = {
  draft:     'bg-slate-50 text-slate-600 border-slate-300',
  submitted: 'bg-blue-50 text-blue-700 border-blue-300',
  bidding:   'bg-orange-50 text-orange-700 border-orange-300',
  for_po:    'bg-violet-50 text-violet-700 border-violet-300',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  cancelled: 'bg-red-50 text-red-700 border-red-300',
}

export const LOT_STATUS_LABELS = {
  draft:     'Draft',
  open:      'Open',
  closed:    'Closed',
  awarded:   'Awarded',
  cancelled: 'Cancelled',
}

export const LOT_STATUS_COLORS = {
  draft:     'bg-slate-50 text-slate-600 border-slate-300',
  open:      'bg-blue-50 text-blue-700 border-blue-300',
  closed:    'bg-amber-50 text-amber-700 border-amber-300',
  awarded:   'bg-emerald-50 text-emerald-700 border-emerald-300',
  cancelled: 'bg-red-50 text-red-700 border-red-300',
}

export const DELIVERY_STATUS_COLORS = {
  pending:   'bg-amber-50 text-amber-700 border-amber-300',
  partial:   'bg-orange-50 text-orange-700 border-orange-300',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-300',
}

export const DELIVERY_STATUS_LABELS = {
  pending:   'Pending Delivery',
  partial:   'Partial Delivery',
  delivered: 'Delivered',
}

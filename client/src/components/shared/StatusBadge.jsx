import { RefreshCcw, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  PR_STATUS_LABELS, PR_STATUS_COLORS, PR_STATUS_HELP, prStatusKey,
  DELIVERY_STATUS_COLORS, DELIVERY_STATUS_LABELS,
  LOT_STATUS_LABELS, LOT_STATUS_COLORS,
  CATEGORY_LABELS, CATEGORY_COLORS,
} from '@/lib/utils'

// A request's status in plain words; given the request itself (`pr`), one whose every award has its PO reads Ordered.
export function PRStatusBadge({ status, pr }) {
  const key = pr ? prStatusKey(pr) : status
  return (
    <Badge className={PR_STATUS_COLORS[key] || 'bg-slate-50 text-slate-600 border-slate-300'} title={PR_STATUS_HELP[key]}>
      {PR_STATUS_LABELS[key] || key}
    </Badge>
  )
}

// A request the TWG sent back to canvass for new quotations keeps this mark, with the count when more than once.
export function RecanvassBadge({ count }) {
  const n = Number(count) || 0
  if (!n) return null
  return (
    <Badge className="gap-1 whitespace-nowrap bg-amber-50 text-amber-800 border-amber-300"
      title={`The TWG ordered a re-canvass ${n === 1 ? 'once' : `${n} times`}: no offer met the specifications`}>
      <RefreshCcw className="size-3" /> {n === 1 ? 'Re-canvassed' : `Re-canvassed ${n} times`}
    </Badge>
  )
}

// A request the TWG sent back to its End User (a Re-PR) keeps this mark, with the count when more than once.
export function RePrBadge({ count }) {
  const n = Number(count) || 0
  if (!n) return null
  return (
    <Badge className="gap-1 whitespace-nowrap bg-red-50 text-red-700 border-red-300"
      title={`Sent back to its End User ${n === 1 ? 'once' : `${n} times`} (Re-PR): no supplier's offer met the specifications`}>
      <Undo2 className="size-3" /> {n === 1 ? 'Re-PR' : `Re-PR ${n} times`}
    </Badge>
  )
}

// Both marks of a request's history: re-canvassed, and sent back to its End User.
export function MarkerBadges({ pr }) {
  return <><RecanvassBadge count={pr.recanvass_count} /><RePrBadge count={pr.re_pr_count} /></>
}

export function DeliveryStatusBadge({ status }) {
  return (
    <Badge className={DELIVERY_STATUS_COLORS[status] || 'bg-slate-50 text-slate-600 border-slate-300'}>
      {DELIVERY_STATUS_LABELS[status] || status}
    </Badge>
  )
}

// A role is named, not colored: colors are kept for what needs attention.
export function RoleBadge({ role }) {
  const labels = { admin: 'Admin', procurement: 'Procurement', requestor: 'End User', supply: 'Supply Officer', twg: 'TWG' }
  return <Badge className="whitespace-nowrap bg-[--color-canvas] text-[--color-text-secondary] border-[--color-border-strong]">{labels[role] || role}</Badge>
}

export function LotStatusBadge({ status }) {
  return (
    <Badge className={LOT_STATUS_COLORS[status] || 'bg-slate-50 text-slate-600 border-slate-300'}>
      {LOT_STATUS_LABELS[status] || status}
    </Badge>
  )
}

export function CategoryBadge({ category }) {
  if (!category) return null
  return (
    <Badge className={CATEGORY_COLORS[category] || 'bg-slate-50 text-slate-600 border-slate-300'}>
      {CATEGORY_LABELS[category] || category}
    </Badge>
  )
}

export function POStatusBadge({ status }) {
  if (status === 'cancelled') {
    return <Badge className="bg-red-50 text-red-700 border-red-300">Cancelled</Badge>
  }
  if (status === 'active') {
    return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-300">Active</Badge>
  }
  return null
}

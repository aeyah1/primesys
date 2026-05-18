import { Badge } from '@/components/ui/badge'
import {
  PR_STATUS_LABELS, PR_STATUS_COLORS,
  DELIVERY_STATUS_COLORS, DELIVERY_STATUS_LABELS,
  LOT_STATUS_LABELS, LOT_STATUS_COLORS,
} from '@/lib/utils'

export function PRStatusBadge({ status }) {
  return (
    <Badge className={PR_STATUS_COLORS[status] || 'bg-slate-50 text-slate-600 border-slate-300'}>
      {PR_STATUS_LABELS[status] || status}
    </Badge>
  )
}

export function DeliveryStatusBadge({ status }) {
  return (
    <Badge className={DELIVERY_STATUS_COLORS[status] || 'bg-slate-50 text-slate-600 border-slate-300'}>
      {DELIVERY_STATUS_LABELS[status] || status}
    </Badge>
  )
}

export function RoleBadge({ role }) {
  const map = {
    admin:       'bg-purple-50 text-purple-700 border-purple-300',
    procurement: 'bg-blue-50 text-blue-700 border-blue-300',
    extension:   'bg-teal-50 text-teal-700 border-teal-300',
    supply:      'bg-orange-50 text-orange-700 border-orange-300',
  }
  const labels = { admin: 'Admin', procurement: 'Procurement', extension: 'Extension', supply: 'Supply Officer' }
  return <Badge className={map[role] || 'bg-slate-50 text-slate-600 border-slate-300'}>{labels[role] || role}</Badge>
}

export function LotStatusBadge({ status }) {
  return (
    <Badge className={LOT_STATUS_COLORS[status] || 'bg-slate-50 text-slate-600 border-slate-300'}>
      {LOT_STATUS_LABELS[status] || status}
    </Badge>
  )
}

export function POStatusBadge({ status }) {
  if (status === 'pending_approval') {
    return <Badge className="bg-amber-50 text-amber-700 border-amber-300">Pending Approval</Badge>
  }
  if (status === 'approved') {
    return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-300">Approved</Badge>
  }
  return null
}

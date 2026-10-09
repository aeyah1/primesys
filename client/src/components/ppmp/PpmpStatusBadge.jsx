import { Badge } from '@/components/ui/badge'

// The months and parts of a PPMP, as the PPMP form names them.
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const PARTS = { ps: 'Part I: Available at PS-DBM', other: 'Part II: Other items' }

// A PPMP's status as a badge: in effect once complete, not in effect until then, replaced by a later version,
// withdrawn by an admin as a mistake, or ended with its fiscal year.
const LOOK = {
  draft:      ['Not in effect', 'bg-amber-50 text-amber-800 border-amber-300'],
  approved:   ['In effect', 'bg-green-50 text-green-800 border-green-300'],
  ended:      ['Ended', 'bg-slate-50 text-slate-600 border-slate-300'],
  superseded: ['Replaced', 'bg-slate-50 text-slate-500 border-slate-300'],
  withdrawn:  ['Withdrawn', 'bg-red-50 text-red-700 border-red-300'],
}
export const STATUS_LABELS = Object.fromEntries(Object.entries(LOOK).map(([k, [label]]) => [k, label]))

// A PPMP in effect for a past fiscal year shows as ended, since requests can no longer draw on it.
export const shownStatus = (status, year) => (status === 'approved' && year < new Date().getFullYear() ? 'ended' : status)

export function PpmpStatusBadge({ status, year }) {
  const [label, cls] = LOOK[shownStatus(status, year)] || [status, LOOK.superseded[1]]
  return <Badge className={`whitespace-nowrap ${cls}`}>{label}</Badge>
}

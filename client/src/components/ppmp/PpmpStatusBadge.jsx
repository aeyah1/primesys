import { Badge } from '@/components/ui/badge'

// The months and parts of a PPMP, as the PPMP form names them.
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const PARTS = { ps: 'Part I: Available at PS-DBM', other: 'Part II: Other items' }

// A PPMP's status as a badge: in effect once signed and complete, not in effect until then, replaced by a later version.
const LOOK = {
  draft:      ['Not in effect', 'bg-amber-50 text-amber-800 border-amber-300'],
  approved:   ['In effect', 'bg-green-50 text-green-800 border-green-300'],
  superseded: ['Replaced', 'bg-slate-50 text-slate-500 border-slate-300'],
}
export const STATUS_LABELS = Object.fromEntries(Object.entries(LOOK).map(([k, [label]]) => [k, label]))

export function PpmpStatusBadge({ status }) {
  const [label, cls] = LOOK[status] || [status, LOOK.superseded[1]]
  return <Badge className={`whitespace-nowrap ${cls}`}>{label}</Badge>
}

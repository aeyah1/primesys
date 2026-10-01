import { Badge } from '@/components/ui/badge'

// A PPMP's status as a badge; a returned one (status draft) says Returned.
const LOOK = {
  draft:      ['Draft', 'bg-slate-50 text-slate-700 border-slate-300'],
  returned:   ['Returned', 'bg-amber-50 text-amber-800 border-amber-300'],
  submitted:  ['Waiting for verification', 'bg-amber-50 text-amber-800 border-amber-300'],
  approved:   ['Verified', 'bg-blue-50 text-blue-700 border-blue-300'],
  superseded: ['Superseded', 'bg-slate-50 text-slate-500 border-slate-300'],
}

export function PpmpStatusBadge({ status, returned }) {
  const [label, cls] = LOOK[status === 'draft' && returned ? 'returned' : status] || [status, LOOK.draft[1]]
  return <Badge className={`whitespace-nowrap ${cls}`}>{label}</Badge>
}

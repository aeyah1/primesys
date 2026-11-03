import { useNavigate } from 'react-router-dom'
import { FileText, Pencil, Trash2 } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { PRStatusBadge, MarkerBadges } from '@/components/shared/StatusBadge'
import { SkeletonRows, EmptyRow } from '@/components/shared/ListParts'
import { fmtDatetime, fmtCurrency, CATEGORY_LABELS } from '@/lib/utils'
import { nextStepOf } from '@/lib/nextStep'
import { useAuth } from '@/context/AuthContext'

// Amount: the PO total once there is a PO, before that the items' estimate.
function Amount({ pr }) {
  if (pr.total_amount) return <span>{fmtCurrency(pr.total_amount)}</span>
  if (Number(pr.estimated_total) > 0) return <span className="text-[--color-text-secondary]" title="Estimated from the request's items">est. {fmtCurrency(pr.estimated_total)}</span>
  return <span className="text-[--color-text-muted]">None</span>
}

const iconBtn = 'rounded-lg p-1.5 text-[--color-text-muted] transition-colors'

/* The rows of a list of requests, the same on Requests and My Requests: number and filing date, what it is, amount,
   status, the next step (the viewer's own in amber), and edit or delete where allowed. A row opens the request. */
export default function RequestTable({ rows, isLoading, isError, empty, category = true, isNew = () => false, onDelete }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const cols = 6
  return (
    <Table framed={false}>
      <TableHeader>
        <TableRow>
          <TableHead>PR No.</TableHead>
          <TableHead>Request</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Next step</TableHead>
          <TableHead className="w-16" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? <SkeletonRows cols={cols} />
          : isError ? <EmptyRow cols={cols} error="The requests could not be loaded. Refresh the page to try again." />
          : !rows.length ? <EmptyRow cols={cols} icon={FileText} {...empty} />
          : rows.map(pr => {
              const step = nextStepOf(pr, user)
              return (
                <TableRow key={pr.id} className="cursor-pointer" onClick={() => navigate(`/pr/${pr.id}`)}>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-mono font-semibold text-[--color-brand]">{pr.pr_number}</span>
                    {isNew(pr) && <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" title="A TWG approval you haven't opened yet">New</span>}
                    <span className="mt-0.5 block text-[11px] text-[--color-text-muted]">Filed {fmtDatetime(pr.created_at)}</span>
                  </TableCell>
                  <TableCell className="max-w-72">
                    <p className="truncate">{pr.title || <span className="italic text-[--color-text-muted]">No title</span>}</p>
                    <p className="mt-0.5 truncate text-[11px] text-[--color-text-muted]">
                      {[category && CATEGORY_LABELS[pr.category], pr.department, pr.created_by_name].filter(Boolean).join(' · ')}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums"><Amount pr={pr} /></TableCell>
                  <TableCell><div className="flex flex-wrap items-center gap-1.5"><PRStatusBadge pr={pr} /><MarkerBadges pr={pr} /></div></TableCell>
                  <TableCell className="w-60 min-w-52">
                    <p className={`line-clamp-2 text-ui-xs ${step.mine ? 'font-semibold text-amber-800' : 'text-[--color-text-secondary]'}`} title={step.title}>
                      {step.mine ? `You: ${step.title}` : step.title}
                    </p>
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {pr.permissions?.edit && (
                        <button onClick={() => navigate(`/pr/${pr.id}/edit`)} title="Edit the request" aria-label={`Edit ${pr.pr_number}`}
                          className={`${iconBtn} hover:bg-[--color-overlay] hover:text-[--color-brand]`}>
                          <Pencil className="size-3.5" />
                        </button>
                      )}
                      {pr.permissions?.delete && onDelete && (
                        <button onClick={() => onDelete(pr)} title="Delete the request" aria-label={`Delete ${pr.pr_number}`}
                          className={`${iconBtn} hover:bg-red-50 hover:text-red-600`}>
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
      </TableBody>
    </Table>
  )
}

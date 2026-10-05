import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Gavel, Send, ShoppingCart, MoreHorizontal, Undo2, RotateCcw, XCircle, FileDown, Clock, Scale, ShieldCheck, Trophy } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import api from '@/lib/axios'
import StartCanvassDialog from '@/components/awards/StartCanvassDialog'
import { useRefreshAwards } from '@/components/awards/supplier'
import { useConfirm } from '@/components/shared/ConfirmDialog'

const chip = (Icon, text, cls = 'border-[--color-border] bg-[--color-canvas] text-[--color-text-secondary]') => (
  <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium shrink-0 ${cls}`}>
    <Icon className="size-3.5" /> {text}
  </span>
)

/* Procurement's actions on a request: the one next step for where it stands,
   and the rest under More. pr: the request with its permissions;
   updateStatus({ status, notes }) / isPending: the page's status change;
   onReturn(): opens "Return for revision"; downloadRFQ: the printed RFQ.
   compact: the next step and the PDF only (the status changes stay on the request page). */
export default function ProcurementActions({ pr, updateStatus, isPending, onReturn, downloadRFQ, compact = false }) {
  const confirm = useConfirm()
  const refresh = useRefreshAwards(String(pr.id))
  const [starting, setStarting] = useState(false)
  const changes = compact ? [] : (pr.permissions?.next_statuses || [])
  const bidding = pr.status === 'bidding'

  // Whether the canvass result can go to the BAC now (the same query as the canvass's BAC panel).
  const { data: bac } = useQuery({
    queryKey: ['bac', 'pr', String(pr.id)],
    queryFn: () => api.get(`/bac/${pr.id}`).then(r => r.data),
    enabled: bidding,
  })
  // Certified awards still waiting for their purchase order (the same query as the canvass's award list).
  const { data: lots = [] } = useQuery({
    queryKey: ['lots', String(pr.id)],
    queryFn: () => api.get(`/lots/pr/${pr.id}`).then(r => r.data),
    enabled: pr.status === 'for_po',
  })
  const waitingPO = lots.some(l => l.status === 'awarded' && !l.po_id && l.certified_at)
  const { mutate: submitToBac, isPending: submitting } = useMutation({
    mutationFn: () => api.post(`/bac/${pr.id}/submit`),
    onSuccess: () => { toast.success('Submitted to the BAC for review'); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to submit it'),
  })

  // The one next step.
  let primary = null
  if (pr.status === 'twg_review') {
    primary = (
      <Button size="sm" className="gap-2 shrink-0" onClick={() => setStarting(true)}>
        <Gavel className="size-4" /> Start canvass
      </Button>
    )
  } else if (bidding && bac?.permissions?.submit) {
    primary = (
      <Button size="sm" className="gap-2 shrink-0" disabled={submitting}
        onClick={async () => { if (await confirm({ title: 'Submit the canvass result to the BAC?', message: 'The winners lock until the BAC approves or returns it.', confirmLabel: 'Submit to the BAC' })) submitToBac() }}>
        <Send className="size-4" /> {submitting ? 'Submitting…' : 'Submit to the BAC'}
      </Button>
    )
  } else if (bidding && !compact) {
    primary = (
      <Button size="sm" asChild className="gap-2 shrink-0">
        <Link to={`/pr/${pr.id}/canvass`}><Trophy className="size-4" /> Record winners</Link>
      </Button>
    )
  } else if (pr.status === 'bac_review') {
    primary = chip(Scale, 'With the BAC for review', 'border-indigo-300 bg-indigo-50 text-indigo-800')
  } else if (pr.status === 'twg_certification') {
    primary = chip(ShieldCheck, 'With the TWG for certification', 'border-teal-300 bg-teal-50 text-teal-800')
  } else if (pr.status === 'for_po' && !waitingPO) {
    primary = chip(Clock, 'Waiting for delivery')
  } else if (pr.status === 'for_po') {
    primary = (
      <Button size="sm" asChild className="gap-2 shrink-0">
        <Link to={`/pr/${pr.id}#purchase-order`}><ShoppingCart className="size-4" /> Issue PO</Link>
      </Button>
    )
  }

  const cancel = async () => {
    if (await confirm({
      title: 'Cancel this request?', danger: true, confirmLabel: 'Cancel request', cancelLabel: 'Keep it',
      message: 'It is kept in the Archive, and any award without a purchase order is cancelled with it.',
    })) {
      updateStatus({ status: 'cancelled' })
    }
  }
  const recanvass = async () => {
    if (await confirm({
      title: 'Return this PR to canvassing?', danger: true, confirmLabel: 'Return to canvassing',
      message: 'Its awards are cancelled; the new winners go through the BAC and the TWG again before a PO can be issued.',
    })) {
      updateStatus({ status: 'bidding', notes: 'Recanvass initiated by procurement' })
    }
  }
  const printable = !['draft', 'submitted', 'revision_requested', 'rejected'].includes(pr.status)
  const hasMore = printable || changes.includes('revision_requested') || changes.includes('cancelled') || (pr.status === 'for_po' && changes.includes('bidding'))

  return (
    <>
      {primary}
      {hasMore && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" disabled={isPending}>
              <MoreHorizontal className="size-4" /> More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {printable && <DropdownMenuItem onClick={downloadRFQ} className="gap-2"><FileDown className="size-3.5" /> Request for Quotation (PDF)</DropdownMenuItem>}
            {(changes.includes('revision_requested') || (pr.status === 'for_po' && changes.includes('bidding')) || changes.includes('cancelled')) && printable && <DropdownMenuSeparator />}
            {changes.includes('revision_requested') && (
              <DropdownMenuItem onClick={onReturn} className="gap-2"><Undo2 className="size-3.5" /> Return for revision</DropdownMenuItem>
            )}
            {pr.status === 'for_po' && changes.includes('bidding') && (
              <DropdownMenuItem onClick={recanvass} className="gap-2"><RotateCcw className="size-3.5" /> Recanvass</DropdownMenuItem>
            )}
            {changes.includes('cancelled') && (
              <DropdownMenuItem onClick={cancel} className="gap-2 text-red-600"><XCircle className="size-3.5" /> Cancel request</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {starting && <StartCanvassDialog pr={pr} onClose={() => setStarting(false)} />}
    </>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, Undo2, RefreshCcw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import TwgEvaluation, { evaluationBlock } from '@/components/awards/TwgEvaluation'
import api from '@/lib/axios'
import TwgReviewDialog from './TwgReviewDialog'

/* The TWG's check of a canvass, in the request's Canvass & award tab: every bid Procurement entered, with the canvasser's
   files beside them, each marked Compliant or Non-Compliant; then Certify, Re-canvass (no offer for a lot is
   compliant), Re-PR (every supplier DQ) or Return to Procurement (a bid entered wrong). pr: GET /pr/:id. */
export default function TwgBidReview({ pr }) {
  const id = String(pr.id)
  const canDecide = !!pr.permissions?.twg_certify
  const [marks, setMarks] = useState({})
  const [dqRemarks, setDqRemarks] = useState({})
  const [action, setAction] = useState(null)
  const { data: canvass } = useQuery({ queryKey: ['canvass', id], queryFn: () => api.get(`/canvass/${id}`).then(r => r.data) })

  const certifyBlock = canDecide ? evaluationBlock(marks, canvass) : null
  // A Re-PR only when every supplier is DQ: every bid marked non-compliant, each with its reason.
  const markList = Object.values(marks)
  const rePrBlock = !markList.length || markList.some(m => m.compliant !== false || !m.remarks.trim())
    ? 'A Re-PR is only for when every supplier is DQ: mark every bid non-compliant, with its reason.' : null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-[--color-text-muted]" />
            <CardTitle>Bids to check</CardTitle>
          </div>
          {canDecide && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setAction('return')}><Undo2 className="size-4" /> Return to Procurement</Button>
              <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setAction('recanvass')}><RefreshCcw className="size-4" /> Re-canvass</Button>
              <Button variant="secondary" size="sm" className="gap-1.5" disabled={!!rePrBlock} title={rePrBlock || 'Send the request back to its End User, through Procurement, to change its specifications or budget'}
                onClick={() => setAction('repr')}><Undo2 className="size-4" /> Re-PR</Button>
              <Button size="sm" className="gap-1.5" disabled={!!certifyBlock} title={certifyBlock || undefined} onClick={() => setAction('certify')}>
                <ShieldCheck className="size-4" /> Certify
              </Button>
            </div>
          )}
        </div>
        <p className="mt-1 text-ui-xs text-[--color-text-secondary]">
          Check each offered specification against the item's (correct it if the RFQ says otherwise), mark it Compliant or Non-Compliant with the
          reason, then Certify. A supplier non-compliant on every item is DQ.
        </p>
        {certifyBlock && <p className="mt-1 text-ui-xs font-medium text-amber-700">{certifyBlock}</p>}
      </CardHeader>
      <CardContent>
        {canvass
          ? <TwgEvaluation key={pr.id} prId={id} canvass={canvass} canEdit={canDecide} onChange={setMarks} onDq={setDqRemarks} />
          : <Skeleton className="h-40" />}
      </CardContent>
      {action && <TwgReviewDialog pr={pr} action={action} marks={marks} dqRemarks={dqRemarks} onClose={() => setAction(null)} />}
    </Card>
  )
}

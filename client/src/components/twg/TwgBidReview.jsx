import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, Undo2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import TwgEvaluation, { evaluationBlock } from '@/components/awards/TwgEvaluation'
import api from '@/lib/axios'
import TwgReviewDialog from './TwgReviewDialog'

/* The TWG's check of an IT or hardware award, in the request's Canvass & award tab: the winning supplier's offer on
   each item, with the returned RFQs beside it, each marked Compliant or Non-Compliant; then Certify (every offer
   compliant: the purchase orders can be issued) or Return to Procurement (the award is cancelled and the BAC's
   next choice recorded). pr: GET /pr/:id. */
export default function TwgBidReview({ pr }) {
  const id = String(pr.id)
  const canDecide = !!pr.permissions?.twg_certify
  const [marks, setMarks] = useState({})
  const [action, setAction] = useState(null)
  const { data: canvass } = useQuery({ queryKey: ['canvass', id], queryFn: () => api.get(`/canvass/${id}`).then(r => r.data) })
  const certifyBlock = canDecide ? evaluationBlock(marks) : null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-[--color-text-muted]" />
            <CardTitle>Award to check</CardTitle>
          </div>
          {canDecide && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setAction('return')}><Undo2 className="size-4" /> Return to Procurement</Button>
              <Button size="sm" className="gap-1.5" disabled={!!certifyBlock} title={certifyBlock || undefined} onClick={() => setAction('certify')}>
                <ShieldCheck className="size-4" /> Certify
              </Button>
            </div>
          )}
        </div>
        <p className="mt-1 text-ui-xs text-[--color-text-secondary]">
          Check what the winning supplier offered against each item's specifications (correct it if its RFQ says otherwise) and mark it
          Compliant or Non-Compliant with the reason. Certify when every offer complies; otherwise return the award to Procurement for the BAC's next choice.
        </p>
        {certifyBlock && <p className="mt-1 text-ui-xs font-medium text-amber-700">{certifyBlock}</p>}
      </CardHeader>
      <CardContent>
        {canvass
          ? <TwgEvaluation key={pr.id} prId={id} canvass={canvass} canEdit={canDecide} onChange={setMarks} />
          : <Skeleton className="h-40" />}
      </CardContent>
      {action && <TwgReviewDialog pr={pr} action={action} marks={marks} onClose={() => setAction(null)} />}
    </Card>
  )
}

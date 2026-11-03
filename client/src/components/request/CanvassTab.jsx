import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Paperclip } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import CanvassPanel from '@/components/awards/CanvassPanel'
import CanvassFiles from '@/components/awards/CanvassFiles'
import BacBidSheet from '@/components/awards/BacBidSheet'
import BacAwardSheet from '@/components/awards/BacAwardSheet'
import RePrPanel from '@/components/awards/RePrPanel'
import TwgBidReview from '@/components/twg/TwgBidReview'
import { QuotesLockedNote } from '@/components/awards/QuotesLocked'
import api from '@/lib/axios'

const Heading = ({ children }) => <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">{children}</h3>

/* The request's Canvass & award tab: the work of whoever has the canvass now, in the request itself. Procurement enters
   the quotations (BacBidSheet) and chooses the winners (BacAwardSheet) or checks a Re-PR; the TWG checks the offers
   (TwgBidReview); otherwise everyone allowed sees the items with their winners and the canvasser's files. pr: GET /pr/:id. */
export default function CanvassTab({ pr, role }) {
  const id = String(pr.id)
  const qc = useQueryClient()
  const staff = ['admin', 'procurement'].includes(role)
  const { data: canvass } = useQuery({ queryKey: ['canvass', id], queryFn: () => api.get(`/canvass/${id}`).then(r => r.data) })

  if (role === 'twg' && pr.status === 'twg_certification') return <TwgBidReview pr={pr} />
  if (!canvass) return <div className="space-y-3">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
  if (canvass.permissions?.bid) return <BacBidSheet key={pr.id} pr={pr} canvass={canvass} />
  if (canvass.permissions?.award) return <BacAwardSheet key={pr.id} pr={pr} canvass={canvass} />

  return (
    <div className="space-y-5">
      {pr.status === 're_pr' && <RePrPanel pr={pr} canAct={!!canvass.permissions?.re_pr} />}
      <section className="space-y-3">
        <Heading>Items and winners</Heading>
        <CanvassPanel pr={pr} />
      </section>
      <section className="space-y-3">
        <Heading>Canvasser's files</Heading>
        {!pr.quotes_visible && <QuotesLockedNote>Only Procurement sees the suppliers' returned RFQs.</QuotesLockedNote>}
        {role === 'twg' ? <CanvassFiles prId={id} /> : (
          <>
            {pr.quotes_visible && (
              <p className="flex items-start gap-2 text-xs text-[--color-text-secondary]">
                <Paperclip className="mt-0.5 size-3.5 shrink-0 text-[--color-text-muted]" />
                The canvasser's documents Procurement attached: the suppliers' returned RFQs and the abstract.
              </p>
            )}
            <AttachmentsPanel endpoint={`/pr/${id}`} queryKey={`pr-attachments-${id}`} rfq
              canUpload={staff && !pr.deleted_at} canDelete={staff && !pr.deleted_at && !['completed', 'rejected', 'cancelled'].includes(pr.status)}
              onChange={() => qc.invalidateQueries({ queryKey: ['canvass', id] })} />
          </>
        )}
      </section>
    </div>
  )
}

import { FileDown, FileText, Printer, Paperclip, Scale } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import TwgCertificates from '@/components/awards/TwgCertificates'
import BacPanel from '@/components/awards/BacPanel'
import { QuotesLockedNote } from '@/components/awards/QuotesLocked'
import { isTemporaryPrNumber } from '@/lib/utils'
import { openPdf, downloadFile, blobErrorMessage } from '@/lib/download'

// Who reads the award records (GET /bac/:id): Procurement, admins and the TWG.
const AWARD_READERS = ['procurement', 'admin', 'twg']

/* Everything printable about a request in one place, the same for every role (each sees what is theirs to see): the
   PR form, the RFQ, the TWG's certificates, the award records (Resolution or Abstract, Notices of Award), and the
   attached files. Purchase orders print from the Orders & delivery tab. pr: GET /pr/:id. */
export default function DocumentsTab({ pr, role }) {
  const id = String(pr.id)
  const staff = ['admin', 'procurement'].includes(role)
  const open = (endpoint, label) => openPdf(endpoint).catch(async (err) => toast.error(await blobErrorMessage(err, `Could not open the ${label}`)))
  // The RFQ carries the PR number, so it prints once the number is assigned.
  const rfq = staff && !['draft', 'submitted', 'revision_requested', 'rejected'].includes(pr.status) && !isTemporaryPrNumber(pr.pr_number)
  const awarded = AWARD_READERS.includes(role) && ['for_po', 'completed', 'cancelled', 'bidding'].includes(pr.status)

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-center gap-2"><Printer className="size-4 text-[--color-text-muted]" /><CardTitle>Forms</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => open(`/pr/${id}/pdf`, 'PR Form')}><FileDown className="size-4" /> Purchase Request form</Button>
          {rfq && (
            <>
              <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => open(`/pr/${id}/rfq`, 'Request for Quotation')}><FileDown className="size-4" /> Request for Quotation</Button>
              <Button variant="secondary" size="sm" className="gap-1.5"
                onClick={() => downloadFile(`/pr/${id}/rfq/docx`, `RFQ ${pr.pr_number}.docx`).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not download the Request for Quotation')))}>
                <FileText className="size-4" /> RFQ as Word
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {role !== 'requestor' && <TwgCertificates prId={id} title="TWG certificates" />}

      {awarded && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]"><Scale className="size-4" /> Awards</h3>
          <BacPanel prId={id} />
        </section>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center gap-2"><Paperclip className="size-4 text-[--color-text-muted]" /><CardTitle>Attachments</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!pr.quotes_visible && Number(pr.quotes) > 0 && (
            <QuotesLockedNote>The suppliers' returned RFQs are not listed here: only Procurement sees them.</QuotesLockedNote>
          )}
          <AttachmentsPanel endpoint={`/pr/${id}`} queryKey={`pr-attachments-${id}`}
            canUpload={!pr.deleted_at && role !== 'twg'}
            canDelete={staff && !pr.deleted_at && !['completed', 'rejected', 'cancelled'].includes(pr.status)} />
        </CardContent>
      </Card>
    </div>
  )
}

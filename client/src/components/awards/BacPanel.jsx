import { useQuery } from '@tanstack/react-query'
import { FileText, AlertTriangle, ShieldCheck } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { fmtCurrency, fmtDate, plural } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

/* Where a canvass stands between the BAC and the TWG. part 'status': returned
   by the TWG (the BAC corrects the bids, BacBidSheet), with the TWG for its
   evaluation, or certified and waiting for the BAC's award (BacAwardSheet).
   part 'resolutions': each BAC Resolution with its Notices of Award. */
export default function BacPanel({ prId, part = 'status' }) {
  const { data } = useQuery({
    queryKey: ['bac', 'pr', prId],
    queryFn: () => api.get(`/bac/${prId}`).then(r => r.data),
  })
  if (!data) return null
  if (part === 'resolutions' && !data.resolutions.length) {
    return <p className="text-sm text-[--color-text-muted]">The BAC has not adopted a resolution for this request yet.</p>
  }

  const can = data.permissions
  const print = (endpoint, label) => openPdf(endpoint)
    .catch(async (err) => toast.error(await blobErrorMessage(err, `Could not open the ${label}`)))

  if (part === 'resolutions') {
    return (
      <div className="space-y-3">
        {data.resolutions.map(r => (
          <div key={r.id} className="rounded-xl border border-[--color-border] px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[--color-text-primary]">BAC Resolution No. {r.resolution_number}</p>
                <p className="text-xs text-[--color-text-muted]">
                  {fmtDate(r.resolved_on)}, by {r.approved_by_name}
                  {' · '}{plural(r.lots.length, 'award')} for {fmtCurrency(r.lots.reduce((s, l) => s + Number(l.awarded_amount), 0))}
                </p>
              </div>
              {can.print && (
                <Button size="sm" variant="outline" className="gap-1.5"
                  onClick={() => print(`/bac/${prId}/resolutions/${r.id}/pdf`, 'BAC Resolution')}>
                  <FileText className="size-3.5" /> Resolution
                </Button>
              )}
            </div>
            {can.print && (
              <div className="flex flex-wrap gap-1.5">
                {r.notices.map(n => (
                  <button key={n.lot_id} onClick={() => print(`/bac/${prId}/resolutions/${r.id}/notice/${n.lot_id}`, 'Notice of Award')}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[--color-border-strong] bg-white px-2.5 py-1 text-[11px] font-medium text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand] transition-colors">
                    <FileText className="size-3" /> Notice of Award: {n.awarded_to}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {data.certification_return_reason && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span><span className="font-semibold">Returned by the TWG:</span> {data.certification_return_reason}. The BAC corrects the bids and sends the canvass again.</span>
        </p>
      )}

      {data.recanvass_reason && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span><span className="font-semibold">Re-canvass ordered by the TWG:</span> {data.recanvass_reason}. The canvasser gets new quotations; the BAC enters them and sends the canvass again.</span>
        </p>
      )}

      {data.status === 'twg_certification' && (
        <p className="flex items-center gap-2 rounded-xl border border-teal-300 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          <ShieldCheck className="size-4 shrink-0" />
          <span><span className="font-semibold">With the TWG.</span> It checks every bid against the required specifications, marks each compliant or not, and certifies them or orders a re-canvass.</span>
        </p>
      )}

      {data.status === 'bac_review' && (
        <p className="flex items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <ShieldCheck className="size-4 shrink-0" />
          <span><span className="font-semibold">Certified by the TWG.</span> The BAC picks each lot's winner; the system recommends the lowest compliant total.</span>
        </p>
      )}
    </div>
  )
}

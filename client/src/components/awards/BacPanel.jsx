import { useQuery } from '@tanstack/react-query'
import { FileText, AlertTriangle, ShieldCheck } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { fmtCurrency, fmtDate } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/* Where a canvass stands after the BAC. part 'status': returned by the TWG
   (the BAC awards it again on its bid sheet, BacBidSheet), or with the TWG.
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
          <span><span className="font-semibold">Returned by the TWG:</span> {data.certification_return_reason}. That award was cancelled; the BAC picks the winners again.</span>
        </p>
      )}

      {data.status === 'twg_certification' && (
        <p className="flex items-center gap-2 rounded-xl border border-teal-300 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          <ShieldCheck className="size-4 shrink-0" />
          <span><span className="font-semibold">Awarded by the BAC.</span> The TWG checks the winners against the request and certifies them.</span>
        </p>
      )}
    </div>
  )
}

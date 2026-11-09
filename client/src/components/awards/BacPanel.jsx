import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { fmtCurrency, fmtDate, plural } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'
import { awardRecordName } from './supplier'

/* A request's award records (its Documents tab): each award, in a BAC Resolution or (below the resolution threshold)
   on the BAC's Abstract alone, with its Notices of Award. The Abstract itself is the BAC's, kept outside PRimeSys. */
export default function BacPanel({ prId }) {
  const { data } = useQuery({
    queryKey: ['bac', 'pr', prId],
    queryFn: () => api.get(`/bac/${prId}`).then(r => r.data),
  })
  if (!data) return null
  if (!data.resolutions.length) return <p className="text-sm text-[--color-text-muted]">No award is recorded on this request yet.</p>

  const can = data.permissions
  const print = (endpoint, label) => openPdf(endpoint)
    .catch(async (err) => toast.error(await blobErrorMessage(err, `Could not open the ${label}`)))

  return (
    <div className="space-y-3">
      {data.resolutions.map(r => {
        const live = r.lots.filter(l => l.status === 'awarded')
        return (
          <div key={r.id} className="rounded-xl border border-[--color-border] px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[--color-text-primary]">{awardRecordName(r)}</p>
                <p className="text-xs text-[--color-text-muted]">
                  {fmtDate(r.resolved_on)}, by {r.approved_by_name}
                  {' · '}{live.length ? `${plural(live.length, 'award')} for ${fmtCurrency(live.reduce((s, l) => s + Number(l.awarded_amount), 0))}` : 'its awards were cancelled'}
                  {r.kind === 'abstract' && ' · approved budget below the resolution threshold'}
                </p>
              </div>
              {can.print && r.kind !== 'abstract' && (
                <Button size="sm" variant="outline" className="gap-1.5"
                  onClick={() => print(`/bac/${prId}/resolutions/${r.id}/pdf`, 'BAC Resolution')}>
                  <FileText className="size-3.5" /> Resolution
                </Button>
              )}
            </div>
            {can.print && r.notices.length > 0 && (
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
        )
      })}
    </div>
  )
}

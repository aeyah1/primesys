import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, ShieldAlert } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { fmtDate, typedSpec } from '@/lib/utils'
import api from '@/lib/axios'

/* Under an ICT item's specification the End User typed: whether the TWG has checked it, and while the request is under
   the viewer's review, the button to mark it checked; the TWG can't approve until every one is (server utils/ictSpecs.js). */
export default function SpecCheck({ pr, item }) {
  const qc = useQueryClient()
  const { mutate: mark, isPending } = useMutation({
    mutationFn: (checked) => api.patch(`/twg/${pr.id}/items/${item.id}/spec-check`, { checked }),
    onSuccess: () => {
      for (const key of [['pr-items', String(pr.id)], ['pr', String(pr.id), 'items']]) qc.invalidateQueries({ queryKey: key })
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'The check could not be saved'),
  })
  if (!typedSpec(item)) return null
  const checked = !!item.spec_checked_at
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 font-normal">
      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${checked ? 'text-emerald-700' : 'text-amber-700'}`}>
        {checked
          ? <><ShieldCheck className="size-3.5" /> Specification checked by {item.spec_checked_by_name || 'the TWG'}, {fmtDate(item.spec_checked_at)}</>
          : <><ShieldAlert className="size-3.5" /> Specification typed by the End User: for TWG checking</>}
      </span>
      {pr.permissions?.twg_review && (
        <Button type="button" size="sm" variant={checked ? 'ghost' : 'outline'} className="h-7 text-xs" disabled={isPending} onClick={() => mark(!checked)}>
          {checked ? 'Undo' : 'Mark as checked'}
        </Button>
      )}
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { fmtDate } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

// The TWG's certificates for a request, each printable as the Certification (Goods and services); nothing when there are none.
export default function TwgCertificates({ prId }) {
  const { data } = useQuery({
    queryKey: ['bac', 'pr', prId],
    queryFn: () => api.get(`/bac/${prId}`).then(r => r.data),
  })
  const list = data?.certificates || []
  if (!list.length) return null
  const print = (c) => openPdf(`/bac/${prId}/certificates/${c.id}/pdf`)
    .catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the TWG Certification')))

  return (
    <div className="space-y-2">
      {list.map(c => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[--color-border] px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-[--color-text-primary]">TWG Certification No. {c.cert_no}</p>
            <p className="text-xs text-[--color-text-muted]">
              {fmtDate(c.created_at)}{c.certified_by_name ? `, by ${c.certified_by_name}` : ''}
              {c.signed ? ', signed' : ', unsigned (to sign by hand)'}
            </p>
          </div>
          {data.permissions?.print && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => print(c)}>
              <FileText className="size-3.5" /> Certificate
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import api from '@/lib/axios'
import { previewable } from './ScanViewer'
import DocumentViewer from './DocumentViewer'

/* The canvasser's files attached to a PR (the returned RFQs, the abstract),
   the newest first, one opened whole in the page (DocumentViewer): the latest
   PDF or picture unless another is picked. Shown beside the bid sheets and the TWG's evaluation.
   prId: the PR; shown / onShow (optional): the file opened, kept by the page. */
export default function CanvassFiles({ prId, shown: kept, onShow }) {
  const [own, setOwn] = useState(null)
  const shown = kept ?? own
  const show = onShow || setOwn
  const { data: files = [] } = useQuery({
    queryKey: [`pr-attachments-${prId}`],
    queryFn: () => api.get(`/pr/${prId}/attachments`).then(r => r.data),
  })
  const docs = [...files].reverse()
  const current = docs.find(f => f.id === shown) || docs.find(f => previewable(f.mimetype)) || docs[0]
  return (
    <section className="space-y-3">
      <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">Canvass documents</h3>
      {docs.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {docs.map(f => (
            <button key={f.id} onClick={() => show(f.id)} title={f.original_name}
              className={`inline-flex max-w-56 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                f.id === current?.id ? 'border-[--color-brand] bg-[--color-brand] text-white'
                  : 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'}`}>
              <FileText className="size-3 shrink-0" /> <span className="truncate">{f.original_name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-[--color-border] bg-white">
        <DocumentViewer prId={prId} file={current} />
      </div>
    </section>
  )
}

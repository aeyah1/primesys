import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import api from '@/lib/axios'
import { previewable } from './ScanViewer'
import DocumentViewer from './DocumentViewer'

/* The canvasser's files attached to a PR (the returned RFQs, the abstract),
   the newest first, one opened whole in the page (DocumentViewer): the latest
   PDF or picture unless another is picked. Shown beside the bid sheets and the TWG's evaluation.
   prId: the PR; shown / onShow (optional): the file opened, kept by the page;
   canRemove: each file has a remove button, for one attached by mistake (the BAC while it enters the bids). */
export default function CanvassFiles({ prId, shown: kept, onShow, canRemove = false }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [own, setOwn] = useState(null)
  const shown = kept ?? own
  const show = onShow || setOwn
  const key = [`pr-attachments-${prId}`]
  const { data: files = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get(`/pr/${prId}/attachments`).then(r => r.data),
  })
  const docs = [...files].reverse()
  const current = docs.find(f => f.id === shown) || docs.find(f => previewable(f.mimetype)) || docs[0]

  const remove = async (f) => {
    if (!(await confirm({ title: 'Remove this file?', message: `${f.original_name} is deleted from the request.`, confirmLabel: 'Remove', danger: true }))) return
    try {
      await api.delete(`/pr/${prId}/attachments/${f.id}`)
      toast.success('File removed', { description: f.original_name })
      if (f.id === current?.id) show(null)
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['canvass', prId] })
    } catch (err) {
      toast.error(err.response?.data?.message || 'The file could not be removed')
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">Canvass documents</h3>
      {(docs.length > 1 || (canRemove && docs.length > 0)) && (
        <div className="flex flex-wrap gap-1.5">
          {docs.map(f => {
            const on = f.id === current?.id
            return (
              <span key={f.id} className={`inline-flex max-w-64 items-center rounded-full border text-[11px] font-medium transition-colors ${
                on ? 'border-[--color-brand] bg-[--color-brand] text-white'
                  : 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'}`}>
                <button type="button" onClick={() => show(f.id)} title={f.original_name}
                  className={`inline-flex min-w-0 items-center gap-1.5 py-1 pl-2.5 ${canRemove ? 'pr-1' : 'pr-2.5'}`}>
                  <FileText className="size-3 shrink-0" /> <span className="truncate">{f.original_name}</span>
                </button>
                {canRemove && (
                  <button type="button" onClick={() => remove(f)} aria-label={`Remove ${f.original_name}`} title="Remove this file"
                    className={`mr-1 rounded-full p-0.5 transition-colors ${on ? 'hover:bg-white/20' : 'hover:bg-red-50 hover:text-red-600'}`}>
                    <X className="size-3" />
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-[--color-border] bg-white">
        <DocumentViewer prId={prId} file={current} />
      </div>
    </section>
  )
}

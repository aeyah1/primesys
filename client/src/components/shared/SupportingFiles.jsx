import { useRef } from 'react'
import { Paperclip, Upload, X, FileText, FileImage } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import api from '@/lib/axios'

const MAX_BYTES = 10 * 1024 * 1024   // the server's limit (utils/upload.js)
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx'
const fmtSize = (bytes) => (bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)

// Uploads a new request's waiting files to it once it is saved; resolves with the names that failed.
export async function uploadPendingFiles(prId, files = []) {
  const failed = []
  for (const file of files) {
    const form = new FormData()
    form.append('file', file)
    try { await api.post(`/pr/${prId}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } }) } catch { failed.push(file.name) }
  }
  return failed
}

/* A request's supporting documents: a proposal for an event or project, a
   quotation already in hand, pictures of the item. On a saved request (prId)
   they upload at once to its attachments; on a new one they wait in `files`
   (onFiles) and go up once it is saved (uploadPendingFiles). */
export default function SupportingFiles({ prId, files = [], onFiles }) {
  const pick = useRef(null)
  const add = (list) => {
    const ok = [...list].filter(f => {
      if (f.size <= MAX_BYTES) return true
      toast.error(`${f.name} is larger than 10 MB`)
      return false
    })
    onFiles([...files, ...ok])
  }

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-[--color-text-primary]">
        Supporting documents
        <span className="ml-1 font-normal text-[--color-text-muted] text-xs">(optional)</span>
      </p>
      <p className="text-[11px] text-[--color-text-muted]">
        For example the activity proposal for an event or project, a quotation you already have, or a picture of the item.
        PDF, images, Word or Excel, up to 10 MB each.
      </p>
      {prId ? (
        <AttachmentsPanel endpoint={`/pr/${prId}`} queryKey={`pr-attachments-${prId}`} canUpload canDelete={false} />
      ) : (
        <div className="space-y-2">
          {files.length > 0 && (
            <ul className="divide-y divide-[--color-border] rounded-lg border border-[--color-border] overflow-hidden">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-3 bg-[--color-surface] px-4 py-2.5">
                  {f.type.startsWith('image/') ? <FileImage className="size-4 text-blue-500 shrink-0" /> : <FileText className="size-4 text-slate-400 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui-sm font-medium text-[--color-text-primary]">{f.name}</p>
                    <p className="text-[10px] text-[--color-text-muted]">{fmtSize(f.size)} · uploaded when the request is saved</p>
                  </div>
                  <button type="button" onClick={() => onFiles(files.filter((_, k) => k !== i))} aria-label={`Remove ${f.name}`}
                    className="rounded-lg p-1.5 text-[--color-text-muted] transition-colors hover:bg-red-50 hover:text-red-600">
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!files.length && (
            <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-[--color-border-strong] py-5">
              <Paperclip className="size-6 text-[--color-text-muted]" />
              <p className="text-ui-xs text-[--color-text-muted]">No documents yet</p>
            </div>
          )}
          <input ref={pick} type="file" multiple accept={ACCEPT} className="hidden"
            onChange={e => { add(e.target.files || []); e.target.value = '' }} />
          <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={() => pick.current?.click()}>
            <Upload className="size-3.5" /> Add files
          </Button>
        </div>
      )}
    </div>
  )
}

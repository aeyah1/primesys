import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { downloadFile, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

export const previewable = (type) => type === 'application/pdf' || type?.startsWith('image/')

// One of a PR's attached files shown in the page (a PDF or a picture); other types download.
export default function ScanViewer({ prId, file }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!file || !previewable(file.mimetype)) return undefined
    let made = null
    setUrl(null); setFailed(false)
    api.get(`/pr/${prId}/attachments/${file.id}/download`, { responseType: 'blob' })
      .then(r => { made = URL.createObjectURL(new Blob([r.data], { type: file.mimetype })); setUrl(made) })
      .catch(() => setFailed(true))
    return () => { if (made) URL.revokeObjectURL(made) }
  }, [prId, file])
  const download = () => downloadFile(`/pr/${prId}/attachments/${file.id}/download`, file.original_name)
    .catch(async (err) => toast.error(await blobErrorMessage(err, 'Download failed')))

  if (!file) return <p className="px-4 py-16 text-center text-sm text-[--color-text-muted]">No canvass documents are attached yet.</p>
  if (!previewable(file.mimetype) || failed) {
    return (
      <div className="px-4 py-16 text-center space-y-3">
        <p className="text-sm text-[--color-text-secondary]">{failed ? 'The file could not be opened here.' : 'This file type opens outside the page.'}</p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={download}><Download className="size-3.5" /> Download {file.original_name}</Button>
      </div>
    )
  }
  if (!url) return <Skeleton className="h-[70vh] rounded-none" />
  return file.mimetype === 'application/pdf'
    ? <iframe src={url} title={file.original_name} className="block h-[70vh] w-full" />
    : <div className="max-h-[70vh] overflow-auto bg-[--color-canvas]"><img src={url} alt={file.original_name} className="mx-auto max-w-full" /></div>
}

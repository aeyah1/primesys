import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Paperclip, Upload, Trash2, FileText, FileImage, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDate } from '@/lib/utils'
import api from '@/lib/axios'

function fileIcon(mimetype) {
  if (mimetype?.startsWith('image/')) return <FileImage className="size-4 text-blue-500 shrink-0" />
  return <FileText className="size-4 text-slate-400 shrink-0" />
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function AttachmentsPanel({ endpoint, queryKey, canDelete, canUpload }) {
  const qc      = useQueryClient()
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)

  const { data: attachments = [], isLoading } = useQuery({
    queryKey: [queryKey],
    queryFn: () => api.get(`${endpoint}/attachments`).then(r => r.data),
  })

  const { mutate: deleteFile } = useMutation({
    mutationFn: (id) => api.delete(`${endpoint}/attachments/${id}`),
    onSuccess: () => { toast.success('Attachment removed'); qc.invalidateQueries({ queryKey: [queryKey] }) },
    onError: () => toast.error('Failed to remove attachment'),
  })

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    setUploading(true)
    try {
      await api.post(`${endpoint}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success(`${file.name} uploaded`)
      qc.invalidateQueries({ queryKey: [queryKey] })
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function download(att) {
    const url = `${import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}${endpoint}/attachments/${att.id}/download`
    const token = localStorage.getItem('primesys_token')
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = att.original_name
        link.click()
        URL.revokeObjectURL(link.href)
      })
      .catch(() => toast.error('Download failed'))
  }

  return (
    <div className="space-y-3">
      {/* File list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
        </div>
      ) : attachments.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-2 rounded-lg border border-dashed border-[--color-border]">
          <Paperclip className="size-7 text-[--color-text-muted]" />
          <p className="text-ui-xs text-[--color-text-muted]">No attachments yet</p>
        </div>
      ) : (
        <div className="divide-y divide-[--color-border] rounded-lg border border-[--color-border] overflow-hidden">
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-[--color-surface] transition-colors">
              {fileIcon(att.mimetype)}
              <div className="flex-1 min-w-0">
                <p className="text-ui-sm font-medium text-[--color-text-primary] truncate">{att.original_name}</p>
                <p className="text-[10px] text-[--color-text-muted] mt-0.5">
                  {fmtSize(att.size)} · {att.uploaded_by_name} · {fmtDate(att.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => download(att)}
                  title="Download"
                  className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors"
                >
                  <Download className="size-3.5" />
                </button>
                {canDelete && (
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete attachment "${att.original_name}"?`)) deleteFile(att.id)
                    }}
                    title="Remove"
                    className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {canUpload && (
        <>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
            onChange={handleUpload}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-2 w-full"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {uploading ? 'Uploading…' : 'Upload File'}
          </Button>
          <p className="text-[10px] text-[--color-text-muted] text-center">
            PDF, images, Word, Excel · max 10 MB
          </p>
        </>
      )}
    </div>
  )
}

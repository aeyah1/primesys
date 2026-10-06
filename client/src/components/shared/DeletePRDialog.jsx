import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

// Deletes a purchase request into the Archive; someone else's request takes a reason, which whoever filed it is told.
export default function DeletePRDialog({ pr, onClose, onDeleted }) {
  const { user } = useAuth()
  const [reason, setReason] = useState('')
  useEffect(() => { setReason('') }, [pr?.id])
  const theirs = !!pr && pr.created_by !== user?.id

  const { mutate: remove, isPending } = useMutation({
    mutationFn: () => api.delete(`/pr/${pr.id}`, { data: { reason: reason.trim() } }),
    onSuccess: () => { toast.success('Purchase request deleted'); onDeleted?.() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete PR'),
  })

  return (
    <Dialog open={!!pr} onOpenChange={o => { if (!o && !isPending) onClose() }}>
      <DialogContent title="Delete Purchase Request">
        <div className="pt-1 space-y-3">
          <p className="text-sm text-[--color-text-secondary]">
            Delete <strong>{pr?.pr_number}</strong>? It will be removed from active lists and kept, with its items,
            attachments, and history, in the Archive under Deleted.
          </p>
          <div className="space-y-1.5">
            <Label>{theirs ? 'Why it is deleted' : 'Why it is deleted (optional)'}</Label>
            <textarea
              rows={3}
              maxLength={500}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Filed twice; the office keeps REQ-000074"
              className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y"
            />
            {theirs && <p className="text-xs text-[--color-text-muted]">{pr.created_by_name || 'Whoever filed it'} is told, with this reason.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="danger" onClick={() => remove()} disabled={isPending || (theirs && !reason.trim())}>
            {isPending ? 'Deleting…' : 'Delete PR'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

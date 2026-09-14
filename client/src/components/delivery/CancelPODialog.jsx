import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import api from '@/lib/axios'
import { TEXTAREA, useRefreshDeliveries } from './shared'

/* Cancels a purchase order before anything is delivered. Its awards are
   cancelled with it and their items go back to canvass; other suppliers' POs
   on the PR are not affected. po: { id, po_number, supplier_name }. */
export default function CancelPODialog({ po, onClose }) {
  const refresh = useRefreshDeliveries()
  const [reason, setReason] = useState('')
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.patch(`/po/${po.id}/cancel`, { reason: reason.trim() }),
    onSuccess: () => { toast.success(`${po.po_number} cancelled. Its items go back to canvass.`); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to cancel the purchase order'),
  })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Cancel Purchase Order">
        <div className="space-y-3">
          <p className="text-sm text-[--color-text-secondary]">
            Cancel <strong>{po.po_number}</strong> to {po.supplier_name}? It is kept on record as cancelled, its awards are cancelled with it,
            and their items go back to canvass for a new award. Other suppliers' POs on this PR are not affected.
          </p>
          <div className="space-y-1.5">
            <Label>Reason <span className="text-red-600 text-xs">*</span></Label>
            <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} autoFocus
              placeholder="e.g. Supplier can no longer deliver" className={TEXTAREA} />
          </div>
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Keep PO</Button>
          <Button variant="danger" onClick={() => mutate()} disabled={isPending || !reason.trim()}>
            {isPending ? 'Cancelling…' : 'Cancel PO'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

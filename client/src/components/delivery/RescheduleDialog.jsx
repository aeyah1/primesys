import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtDate } from '@/lib/utils'
import api from '@/lib/axios'
import { TEXTAREA, useRefreshDeliveries } from './shared'

/* The supplier's new delivery date for a PO, and why. The requestor and the
   supply officers are told. po: { id, po_number, issued_date, expected_delivery_date }. */
export default function RescheduleDialog({ po, onClose }) {
  const refresh = useRefreshDeliveries()
  const issued = String(po.issued_date || '').slice(0, 10)
  const [date, setDate]     = useState(po.expected_delivery_date ? String(po.expected_delivery_date).slice(0, 10) : '')
  const [reason, setReason] = useState('')
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.patch(`/po/${po.id}/expected-date`, { expected_delivery_date: date, reason: reason.trim() }),
    onSuccess: () => { toast.success(`${po.po_number} is now expected on ${fmtDate(date)}`); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to change the date'),
  })
  const valid = !!date && date >= issued && !!reason.trim()
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Change Expected Delivery" description={`${po.po_number}${po.expected_delivery_date ? `, now expected ${fmtDate(po.expected_delivery_date)}` : ''}`}>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>New expected date <span className="text-red-500">*</span></Label>
            <Input type="date" value={date} min={issued} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Reason <span className="text-red-500">*</span></Label>
            <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} autoFocus
              placeholder="e.g. The supplier's shipment was delayed" className={TEXTAREA} />
          </div>
          <p className="text-xs text-[--color-text-muted]">The requestor and the supply officers are told.</p>
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button disabled={isPending || !valid} onClick={() => mutate()} className="gap-2">
            <CalendarDays className="size-4" /> {isPending ? 'Saving…' : 'Change Date'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

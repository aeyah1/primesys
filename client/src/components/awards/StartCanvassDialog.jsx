import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Gavel } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { PROCUREMENT_MODES } from '@/lib/utils'
import api from '@/lib/axios'

const SELECT = 'w-full h-10 rounded-md border border-[--color-border] bg-[--color-surface] px-3 text-sm text-[--color-text-primary] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent'

/* Starts the canvass of a request the TWG approved, choosing how it is procured.
   The canvass itself is done on paper by the canvasser, with the printed RFQ.
   pr: { id, pr_number, title, mode_of_procurement }; onStarted(): after it starts, e.g. to show its canvass. */
export default function StartCanvassDialog({ pr, onClose, onStarted }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState(pr.mode_of_procurement || 'Small Value Procurement')
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/canvass/${pr.id}/start`, { mode_of_procurement: mode }),
    onSuccess: () => {
      toast.success(`${pr.pr_number} is in canvass`, { description: 'Print the RFQ for the canvasser, then record the winners.' })
      for (const key of [['lot-queue'], ['pr', String(pr.id)], ['pr-list'], ['pr-stats'], ['canvass', String(pr.id)], ['bac'], ['pr-logs', String(pr.id)]]) {
        qc.invalidateQueries({ queryKey: key })
      }
      onStarted?.()
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not start the canvass'),
  })

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Start the Canvass"
        description={`${pr.pr_number}${pr.title ? `: ${pr.title}` : ''}. The canvasser canvasses the suppliers with the printed RFQ; you then record each item's winner here.`}>
        <div className="space-y-1.5">
          <Label>Mode of procurement</Label>
          <select className={SELECT} value={mode} onChange={e => setMode(e.target.value)}>
            {PROCUREMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button className="gap-1.5" disabled={isPending} onClick={() => mutate()}>
            <Gavel className="size-3.5" /> {isPending ? 'Starting…' : 'Start canvass'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

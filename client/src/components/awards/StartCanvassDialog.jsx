import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Gavel } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { PROCUREMENT_MODES } from '@/lib/utils'
import api from '@/lib/axios'

const SELECT = 'w-full h-10 rounded-md border border-[--color-border] bg-[--color-surface] px-3 text-sm text-[--color-text-primary] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent'

/* Starts the canvass of a request the TWG approved: its PR number (the next
   one suggested, which Procurement confirms or changes) and how it is procured.
   The canvass itself is done on paper by the canvasser, with the printed RFQ.
   pr: { id, pr_number, title, mode_of_procurement }; onStarted(): after it starts, e.g. to show its canvass. */
export default function StartCanvassDialog({ pr, onClose, onStarted }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState(pr.mode_of_procurement || 'Small Value Procurement')
  const [number, setNumber] = useState(null)   // null until the suggestion loads
  const { data: canvass } = useQuery({
    queryKey: ['canvass', String(pr.id)],
    queryFn: () => api.get(`/canvass/${pr.id}`).then(r => r.data),
  })
  const assigned = !!canvass?.pr_number_assigned
  useEffect(() => {
    if (canvass && number === null) setNumber(canvass.suggested_pr_number || '')
  }, [canvass, number])

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/canvass/${pr.id}/start`, { mode_of_procurement: mode, ...(assigned ? {} : { pr_number: number.trim() }) }),
    onSuccess: ({ data }) => {
      toast.success(`${data.pr_number} is in canvass`, { description: 'Print the RFQ for the canvasser, then record the winners.' })
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
        description={`${pr.pr_number}${pr.title ? `: ${pr.title}` : ''}. The canvasser canvasses the suppliers with the printed RFQ and gives the returned RFQs to the BAC.`}>
        {!canvass ? (
          <div className="space-y-3">{Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>PR number</Label>
              {assigned ? (
                <p className="text-sm font-mono font-semibold text-[--color-text-primary]">{pr.pr_number}</p>
              ) : (
                <>
                  <Input maxLength={50} value={number ?? ''} onChange={e => setNumber(e.target.value)} className="font-mono" />
                  <p className="text-xs text-[--color-text-muted]">The next number is suggested. It prints on the PR form and the RFQ, and can't be changed later.</p>
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Mode of procurement</Label>
              <select className={SELECT} value={mode} onChange={e => setMode(e.target.value)}>
                {PROCUREMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
        )}
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button className="gap-1.5" disabled={isPending || !canvass || (!assigned && !number?.trim())} onClick={() => mutate()}>
            <Gavel className="size-3.5" /> {isPending ? 'Starting…' : 'Start canvass'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

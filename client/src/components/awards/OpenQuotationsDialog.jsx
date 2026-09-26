import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Gavel, AlertTriangle, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { PROCUREMENT_MODES } from '@/lib/utils'
import api from '@/lib/axios'

const pad = (n) => String(n).padStart(2, '0')
// Three days from now at 5 PM, the usual close of an RFQ.
const defaultDeadline = () => {
  const d = new Date(Date.now() + 3 * 864e5); d.setHours(17, 0, 0, 0)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const SELECT = 'w-full h-10 rounded-md border border-[--color-border] bg-[--color-surface] px-3 text-sm text-[--color-text-primary] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent'

/* Opens a PR the TWG approved for quotations, in one step: the mode of
   procurement, when quotations close, and the suppliers emailed the RFQ
   (none for a canvass on paper). pr: { id, pr_number, title, mode_of_procurement };
   onOpened(): after it opens, e.g. to show its canvass. */
export default function OpenQuotationsDialog({ pr, onClose, onOpened }) {
  const qc = useQueryClient()
  const [mode, setMode]         = useState(pr.mode_of_procurement || 'Small Value Procurement')
  const [deadline, setDeadline] = useState(defaultDeadline())
  const [chosen, setChosen]     = useState([])
  const { data } = useQuery({
    queryKey: ['suppliers', 'active-all'],
    queryFn: () => api.get('/suppliers?status=active&limit=200').then(r => r.data.data),
  })
  const suppliers = data ?? []
  const toggle = (id) => setChosen(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/canvass/${pr.id}/open`, { mode_of_procurement: mode, deadline, supplier_ids: chosen }),
    onSuccess: ({ data: r }) => {
      const failed = (r.results || []).some(x => !x.sent)
      ;(failed ? toast.warning : toast.success)(r.message)
      for (const key of [['lot-queue'], ['pr', String(pr.id)], ['pr-list'], ['pr-stats'], ['canvass', String(pr.id)], ['bac']]) qc.invalidateQueries({ queryKey: key })
      onOpened?.()
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not open it for quotations'),
  })

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Open for Quotations" className="max-w-xl"
        description={`${pr.pr_number}${pr.title ? `: ${pr.title}` : ''}. The request goes under canvass and the suppliers you choose are emailed the RFQ.`}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Mode of procurement</Label>
              <select className={SELECT} value={mode} onChange={e => setMode(e.target.value)}>
                {PROCUREMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Quotations close</Label>
              <Input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Email the RFQ to <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span></Label>
            {!suppliers.length ? (
              <p className="rounded-lg border border-[--color-border] bg-[--color-canvas] px-3 py-3 text-xs text-[--color-text-secondary]">
                No active supplier is on the list yet. <Link to="/suppliers" className="font-medium text-[--color-brand] hover:underline">Add suppliers</Link>, or open it for quotations on paper.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-[--color-border] divide-y divide-[--color-border]">
                {suppliers.map(s => (
                  <label key={s.id} className={`flex items-start gap-3 px-3 py-2.5 ${s.email ? 'cursor-pointer hover:bg-[--color-canvas]' : 'opacity-60'}`}>
                    <input type="checkbox" className="mt-0.5 size-4 accent-[--color-brand]" disabled={!s.email}
                      checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[--color-text-primary]">{s.name}</span>
                      <span className="block text-xs text-[--color-text-muted]">{s.email || 'No email on the list'}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {chosen.length === 0 ? (
            <p className="flex items-start gap-2 rounded-lg border border-[--color-border] bg-[--color-canvas] px-3 py-2 text-xs text-[--color-text-secondary]">
              <Info className="size-3.5 shrink-0 mt-0.5" /> Nobody will be emailed: a canvass on paper. Record each quotation with Add Quotation as it comes in.
            </p>
          ) : chosen.length < 3 && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" /> The RFQ should go to at least three suppliers ({chosen.length} chosen).
            </p>
          )}
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button className="gap-1.5" disabled={isPending || !deadline} onClick={() => mutate()}>
            <Gavel className="size-3.5" /> {isPending ? 'Opening…' : chosen.length ? `Open and email ${chosen.length}` : 'Open on paper'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

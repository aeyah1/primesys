import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Undo2, Send } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { RE_PR_TYPES } from '@/lib/utils'
import api from '@/lib/axios'
import { useRefreshAwards } from './supplier'

/* A Re-PR the TWG proposed because every supplier was DQ, waiting for the BAC:
   why, and for the BAC, sending it to the End User (an optional note) or
   returning it to the TWG (a reason). pr: GET /pr/:id; canAct: the BAC may decide. */
export default function RePrPanel({ pr, canAct }) {
  const [action, setAction] = useState(null)   // 'send' | 'return'
  const [note, setNote] = useState('')
  const refresh = useRefreshAwards(String(pr.id))
  const { mutate: settle, isPending } = useMutation({
    mutationFn: () => api.post(`/canvass/${pr.id}/re-pr`, { action, note: note.trim() || undefined }),
    onSuccess: ({ data }) => { toast.success(data.message); setAction(null); setNote(''); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'The Re-PR could not be saved'),
  })
  const close = () => { setAction(null); setNote('') }

  return (
    <div className="space-y-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
      <p className="flex items-start gap-2">
        <Undo2 className="size-4 shrink-0 mt-0.5" />
        <span><span className="font-semibold">Re-PR proposed by the TWG:</span> {RE_PR_TYPES[pr.re_pr_type] || 'Change the specifications'}.</span>
      </p>
      {pr.re_pr_reason && <p className="pl-6 whitespace-pre-wrap">{pr.re_pr_reason}</p>}
      <p className="pl-6 text-xs text-red-800">
        Every supplier was DQ, so the request goes back to its End User to change.{' '}
        {canAct ? 'Check it, then send it to the End User, or return it to the TWG if the offers need another look.' : 'The BAC checks it, then sends it to the End User.'}
      </p>
      {canAct && (
        <div className="flex flex-wrap gap-2 pl-6 pt-1">
          <Button size="sm" className="gap-1.5 bg-red-600 hover:bg-red-700 text-white border-0" onClick={() => setAction('send')}>
            <Send className="size-3.5" /> Send to the End User
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 border-red-300 text-red-700 hover:bg-white" onClick={() => setAction('return')}>
            <Undo2 className="size-3.5" /> Return to the TWG
          </Button>
        </div>
      )}

      <Dialog open={!!action} onOpenChange={(open) => { if (!open) close() }}>
        <DialogContent className="max-w-lg" title={action === 'send' ? 'Send the Re-PR to the End User' : 'Return the Re-PR to the TWG'}>
          <div className="space-y-3 pt-2">
            <p className="text-ui-sm text-[--color-text-secondary]">
              {action === 'send'
                ? <>{pr.created_by_name || 'The End User'} gets the TWG's reason and your note, changes the request (prices or items may go past the PPMP, taken from the office's PPMP budget), and submits it to the TWG again.</>
                : <>Tell the TWG why the offers need another look. It checks them again and certifies, re-canvasses, or proposes the Re-PR again.</>}
            </p>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} maxLength={2000} autoFocus
              placeholder={action === 'send' ? 'Optional note for the End User, for example the price to raise the item to…' : 'Why the offers need another look (required)…'}
              className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-ui-sm text-[--color-text-primary] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent" />
            {action === 'return' && !note.trim() && <p className="text-[10px] text-amber-700">A reason is required when returning it to the TWG.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={isPending}>Cancel</Button>
            <Button onClick={() => settle()} disabled={isPending || (action === 'return' && !note.trim())}
              className="gap-1.5 bg-red-600 hover:bg-red-700 text-white border-0">
              {isPending ? 'Saving…' : action === 'send' ? <><Send className="size-4" /> Send to the End User</> : <><Undo2 className="size-4" /> Return to the TWG</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Mail, Send, RefreshCw, CalendarClock, Lock, AlertTriangle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { fmtDatetime } from '@/lib/utils'
import api from '@/lib/axios'
import { SectionTitle, useRefreshAwards } from './supplier'
import { useConfirm } from '@/components/shared/ConfirmDialog'

const pad = (n) => String(n).padStart(2, '0')
const asInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
// Three days from now at 5 PM, the usual close of an RFQ.
const defaultDeadline = () => { const d = new Date(Date.now() + 3 * 864e5); d.setHours(17, 0, 0, 0); return asInput(d) }

/* ── Choose suppliers from the list and email them the RFQ ────────────── */
function SendDialog({ prId, invited, openDeadline, onClose }) {
  const refresh = useRefreshAwards(prId)
  const [chosen, setChosen]     = useState([])
  const [deadline, setDeadline] = useState(defaultDeadline())
  const { data } = useQuery({
    queryKey: ['suppliers', 'rfq-pick'],
    queryFn: () => api.get('/suppliers?status=active&limit=200').then(r => r.data),
  })
  const choices = (data?.data ?? []).filter(s => !invited.includes(s.name))
  const toggle = (id) => setChosen(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  const total = invited.length + chosen.length
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/canvass/${prId}/rfq`, { supplier_ids: chosen, deadline }),
    onSuccess: ({ data: r }) => { (r.results.every(x => x.sent) ? toast.success : toast.warning)(r.message); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to send the RFQ'),
  })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Send RFQ by Email" className="max-w-xl"
        description="Each supplier gets the RFQ as a PDF and a link to enter their prices. Their prices stay sealed until the deadline.">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Deadline for quotations</Label>
            {openDeadline
              ? <p className="text-sm text-[--color-text-secondary]">{fmtDatetime(openDeadline)}: new suppliers join the open RFQ on the same deadline.</p>
              : <Input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />}
          </div>
          <div className="space-y-1.5">
            <Label>Suppliers</Label>
            {!choices.length ? (
              <p className="rounded-lg border border-[--color-border] bg-[--color-canvas] px-3 py-3 text-xs text-[--color-text-secondary]">
                No other active supplier is on the list. <Link to="/suppliers" className="font-medium text-[--color-brand] hover:underline">Add suppliers</Link> first.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-[--color-border] divide-y divide-[--color-border]">
                {choices.map(s => (
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
          {total > 0 && total < 3 && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" /> The RFQ should go to at least three suppliers ({total} so far).
            </p>
          )}
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button className="gap-1.5" disabled={isPending || !chosen.length || (!openDeadline && !deadline)} onClick={() => mutate()}>
            <Send className="size-3.5" /> {isPending ? 'Sending…' : `Send to ${chosen.length || ''} supplier${chosen.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Extend the deadline: everyone yet to quote gets a new link ───────── */
function ExtendDialog({ prId, current, onClose }) {
  const refresh = useRefreshAwards(prId)
  const [deadline, setDeadline] = useState(() => { const d = new Date(new Date(current).getTime() + 2 * 864e5); return asInput(d) })
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.patch(`/canvass/${prId}/rfq/deadline`, { deadline }),
    onSuccess: ({ data }) => { toast.success(data.message); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to extend the deadline'),
  })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Extend the Deadline" description={`Currently ${fmtDatetime(current)}. Suppliers yet to quote are emailed a new link.`}>
        <div className="space-y-1.5">
          <Label>New deadline</Label>
          <Input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button disabled={isPending || !deadline} onClick={() => mutate()}>{isPending ? 'Extending…' : 'Extend'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InviteStatus({ inv }) {
  const chip = (cls, text) => <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{text}</span>
  if (inv.submitted_at) return chip('border-emerald-300 bg-emerald-50 text-emerald-700', `Quoted ${fmtDatetime(inv.submitted_at)}`)
  if (inv.send_error && !inv.sent_at) return chip('border-red-300 bg-red-50 text-red-700', 'Email failed')
  if (inv.opened_at) return chip('border-blue-300 bg-blue-50 text-blue-700', 'Opened, not quoted yet')
  if (inv.reminded_at) return chip('border-amber-300 bg-amber-50 text-amber-800', 'Reminded')
  return chip('border-slate-300 bg-slate-50 text-slate-600', 'Sent')
}

/* The canvass schedule and the RFQs emailed for one PR: when quotations
   close, who was invited, where each stands. Emailed prices stay sealed until
   the close. rfq / schedule / can: from the canvass. */
export default function RfqPanel({ prId, rfq, schedule, can }) {
  const confirm = useConfirm()
  const refresh = useRefreshAwards(prId)
  const [sending, setSending]   = useState(false)
  const [extending, setExtending] = useState(false)
  const { mutate: resend, isPending: resending, variables: resendingId } = useMutation({
    mutationFn: (inv) => api.post(`/canvass/${prId}/rfq/${inv.id}/resend`),
    onSuccess: ({ data }) => { toast.success(data.message); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to resend'),
  })
  const invites = rfq?.invitations ?? []
  // Closing early: once every invited supplier has quoted (they were promised the deadline), or any time on paper.
  const canClose = can.canvass && schedule?.open && invites.every(i => i.submitted_at)
  const { mutate: closeNow, isPending: closing } = useMutation({
    mutationFn: () => api.post(`/canvass/${prId}/rfq/close`),
    onSuccess: ({ data }) => { toast.success(data.message); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to close the quotations'),
  })
  if (!invites.length && !schedule?.due && !can.canvass) return null

  return (
    <div className="space-y-2">
      <SectionTitle action={can.canvass && (
        <div className="flex items-center gap-2">
          {canClose && (
            <Button size="sm" variant="ghost" className="gap-1.5 text-xs" disabled={closing}
              onClick={async () => {
                if (await confirm({
                  title: 'Close the quotations now?', confirmLabel: 'Close quotations',
                  message: invites.length
                    ? 'Every invited supplier has quoted. Closing opens their prices to Procurement and the BAC.'
                    : 'The schedule ends now, and the canvass can go on to the award.',
                })) closeNow()
              }}>
              <Lock className="size-3.5" /> {closing ? 'Closing…' : 'Close quotations now'}
            </Button>
          )}
          {schedule?.open && <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={() => setExtending(true)}><CalendarClock className="size-3.5" /> Extend deadline</Button>}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSending(true)}><Mail className="size-3.5" /> Send RFQ by email</Button>
        </div>
      )}>
        Quotations{invites.length ? ` · RFQ emailed to ${invites.length}` : ''}
      </SectionTitle>

      {schedule?.due && (
        <p className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${schedule.open ? 'border-indigo-300 bg-indigo-50 text-indigo-900' : 'border-[--color-border] bg-[--color-canvas] text-[--color-text-secondary]'}`}>
          <Lock className="size-3.5 shrink-0" />
          {schedule.open
            ? <>Quotations close <span className="font-semibold">{fmtDatetime(schedule.due)}</span>.{rfq.open ? ' Prices sent online stay sealed until then, and the canvass cannot be decided yet.' : ''}</>
            : <>Quotations closed {fmtDatetime(schedule.due)}.{invites.length ? ' The prices are open.' : ''}</>}
        </p>
      )}

      {invites.length > 0 && (
        <>
          <div className="rounded-xl border border-[--color-border] divide-y divide-[--color-border]">
            {invites.map(inv => (
              <div key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[--color-text-primary]">{inv.supplier_name}</p>
                  {inv.email && <p className="text-xs text-[--color-text-muted]">{inv.email}</p>}
                  {inv.send_error && <p className="text-xs text-red-700">{inv.send_error}</p>}
                </div>
                <InviteStatus inv={inv} />
                {can.canvass && rfq.open && (
                  <Button size="sm" variant="ghost" className="gap-1 text-xs" disabled={resending && resendingId?.id === inv.id}
                    onClick={() => resend(inv)} title="Email a new link; the earlier one stops working">
                    <RefreshCw className="size-3" /> Resend
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {sending && <SendDialog prId={prId} invited={invites.map(i => i.supplier_name)} openDeadline={schedule?.open ? schedule.due : null} onClose={() => setSending(false)} />}
      {extending && <ExtendDialog prId={prId} current={rfq.deadline} onClose={() => setExtending(false)} />}
    </div>
  )
}

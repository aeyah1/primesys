import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bell, Plus, CheckCircle2, Trash2, Link2, Pencil } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import PageHeader from '@/components/shared/PageHeader'
import { TabBar, Tab, SkeletonRows, EmptyRow } from '@/components/shared/ListParts'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { fmtDatetime } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'
import { useConfirm } from '@/components/shared/ConfirmDialog'

const TABS = [
  { key: 'mine',    label: 'For me' },
  { key: 'created', label: 'Set by me' },
]

function toDateObj(dateStr) {
  // The API sends an ISO timestamp; older "YYYY-MM-DD HH:mm:ss" values parse too.
  return new Date(String(dateStr).replace(' ', 'T'))
}

// The date-and-time field works in this device's local time ("YYYY-MM-DDTHH:mm").
function toLocalInput(value) {
  const d = toDateObj(value)
  if (isNaN(d)) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function isPast(dateStr) {
  return toDateObj(dateStr) < new Date()
}

function ReminderForm({ initial, onSubmit, isPending, onCancel }) {
  const { user } = useAuth()
  const [form, setForm] = useState(initial || {
    title: '', note: '', remind_at: '', assigned_to: '', pr_id: '', lot_id: '',
  })
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const { data: users = [] } = useQuery({
    queryKey: ['reminder-users'],
    queryFn: () => api.get('/reminders/users').then(r => r.data),
  })
  const { data: prList = [] } = useQuery({
    queryKey: ['pr-list', 'reminder-pick'],
    queryFn: () => api.get('/pr?limit=100').then(r => r.data?.data ?? []),
  })
  const { data: lots = [] } = useQuery({
    queryKey: ['lots-all'],
    queryFn: () => api.get('/lots').then(r => r.data),
    enabled: !!form.pr_id,
  })

  const filteredLots = form.pr_id
    ? lots.filter(l => String(l.purchase_request_id) === String(form.pr_id))
    : []

  // The server lists only the people this user may remind. A requestor can also
  // be reminded about a PR they filed, so that PR's requestor is offered once
  // the PR is linked. Someone who may only remind themselves gets it preselected.
  const linkedPR   = prList.find(p => String(p.id) === String(form.pr_id))
  const recipients = linkedPR && !users.some(u => u.id === linkedPR.created_by)
    ? [...users, { id: linkedPR.created_by, name: linkedPR.created_by_name, role: 'requestor' }]
    : users
  useEffect(() => {
    if (!form.assigned_to && users.length === 1) setF('assigned_to', String(users[0].id))
  }, [users])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.title || !form.remind_at || !form.assigned_to) {
      toast.error('Title, remind date, and recipient are required')
      return
    }
    onSubmit({
      ...form,
      pr_id:  form.pr_id  || null,
      lot_id: form.lot_id || null,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Title *</Label>
          <Input placeholder="e.g. Follow up on CSO 2026-001" value={form.title}
            onChange={e => setF('title', e.target.value)} required />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label>Note</Label>
          <Input placeholder="Optional details..." value={form.note}
            onChange={e => setF('note', e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label>Remind At *</Label>
          <Input type="datetime-local" value={form.remind_at}
            onChange={e => setF('remind_at', e.target.value)} required />
        </div>

        <div className="space-y-1.5">
          <Label>Send Reminder To *</Label>
          <Select value={String(form.assigned_to)} onValueChange={v => setF('assigned_to', v)}>
            <SelectTrigger><SelectValue placeholder="Pick a user" /></SelectTrigger>
            <SelectContent>
              {recipients.map(u => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name} <span className="text-[--color-text-muted] ml-1 text-xs capitalize">({u.role})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {user?.role === 'requestor' && (
            <p className="text-[10px] text-[--color-text-muted]">
              Reminders you create are sent to you. To nudge Procurement about a PR, use Remind Procurement on the PR.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Link to PR (optional)</Label>
          <Select value={String(form.pr_id || '')} onValueChange={v => { setF('pr_id', v); setF('lot_id', '') }}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {prList.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.pr_number}{p.title ? `: ${p.title}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Link to Lot (optional)</Label>
          <Select value={String(form.lot_id || '')} onValueChange={v => setF('lot_id', v)}
            disabled={!form.pr_id || !filteredLots.length}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {filteredLots.map(l => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.lot_number}{l.title ? `: ${l.title}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={isPending} className="gap-2">
          <Bell className="size-4" />
          {isPending ? 'Saving…' : 'Save the reminder'}
        </Button>
      </div>
    </form>
  )
}

// Where a reminder stands: done, overdue, its email sent, or waiting for its time.
function ReminderState({ r }) {
  if (r.is_done) return <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Done</span>
  if (isPast(r.remind_at)) return <span className="inline-flex rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Overdue</span>
  if (r.is_sent) return <span className="inline-flex rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800">Email sent</span>
  return <span className="inline-flex rounded-full border border-[--color-border-strong] bg-[--color-overlay] px-2 py-0.5 text-[11px] font-semibold text-[--color-text-secondary]">Waiting</span>
}

// One reminder's row, with marking it done, editing and deleting where allowed.
function ReminderRow({ r, tab, onEdit }) {
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { user } = useAuth()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['reminders'] })

  const { mutate: markDone, isPending: marking } = useMutation({
    mutationFn: () => api.patch(`/reminders/${r.id}/done`),
    onSuccess: () => { toast.success('Marked as done'); invalidate() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  })
  const { mutate: remove, isPending: removing } = useMutation({
    mutationFn: () => api.delete(`/reminders/${r.id}`),
    onSuccess: () => { toast.success('Reminder deleted'); invalidate() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  })
  const overdue = isPast(r.remind_at) && !r.is_done
  const canEdit = Number(r.created_by) === Number(user?.id) || user?.role === 'admin'
  const iconBtn = 'rounded-lg p-1.5 text-[--color-text-muted] transition-colors'

  return (
    <TableRow className={r.is_done ? 'opacity-60' : ''}>
      <TableCell className={`whitespace-nowrap text-ui-xs ${overdue ? 'font-semibold text-red-700' : 'text-[--color-text-secondary]'}`}>{fmtDatetime(r.remind_at)}</TableCell>
      <TableCell className="max-w-96">
        <p className={`font-semibold ${r.is_done ? 'line-through text-[--color-text-muted]' : ''}`}>{r.title}</p>
        {r.note && <p className="mt-0.5 text-ui-xs text-[--color-text-secondary]">{r.note}</p>}
      </TableCell>
      <TableCell className="text-ui-xs text-[--color-text-secondary]">{tab === 'mine' ? r.created_by_name : r.assigned_to_name}</TableCell>
      <TableCell className="whitespace-nowrap text-ui-xs">
        {r.pr_number
          ? <Link to={`/pr/${r.pr_id}`} className="inline-flex items-center gap-1 font-mono font-semibold text-[--color-brand] hover:underline"><Link2 className="size-3" />{r.pr_number}{r.lot_number ? ` / ${r.lot_number}` : ''}</Link>
          : <span className="text-[--color-text-muted]">None</span>}
      </TableCell>
      <TableCell><ReminderState r={r} /></TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          {!r.is_done && (
            <button onClick={() => markDone()} disabled={marking} title="Mark as done" aria-label="Mark as done" className={`${iconBtn} hover:bg-emerald-50 hover:text-emerald-700`}>
              <CheckCircle2 className="size-4" />
            </button>
          )}
          {!r.is_done && canEdit && (
            <button onClick={() => onEdit(r)} title="Edit" aria-label="Edit the reminder" className={`${iconBtn} hover:bg-[--color-overlay] hover:text-[--color-text-primary]`}>
              <Pencil className="size-3.5" />
            </button>
          )}
          {canEdit && (
            <button disabled={removing} title="Delete" aria-label="Delete the reminder" className={`${iconBtn} hover:bg-red-50 hover:text-red-600`}
              onClick={async () => { if (await confirm({ title: 'Delete this reminder?', message: `"${r.title}" is deleted.`, confirmLabel: 'Delete', danger: true })) remove() }}>
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

const COLS = 6

// Email reminders: the ones sent to this user, and the ones they set for someone; new and edited ones in a window.
export default function RemindersPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [tab, setTab] = useState('mine')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)

  const { data: reminders = [], isLoading, isError } = useQuery({
    queryKey: ['reminders', tab],
    queryFn: () => api.get(`/reminders?view=${tab}`).then(r => r.data),
  })
  const { data: other = [] } = useQuery({
    queryKey: ['reminders', tab === 'mine' ? 'created' : 'mine'],
    queryFn: () => api.get(`/reminders?view=${tab === 'mine' ? 'created' : 'mine'}`).then(r => r.data),
  })
  const counts = { [tab]: reminders.filter(r => !r.is_done).length, [tab === 'mine' ? 'created' : 'mine']: other.filter(r => !r.is_done).length }
  const invalidate = () => qc.invalidateQueries({ queryKey: ['reminders'] })

  const { mutate: create, isPending: saving } = useMutation({
    mutationFn: (body) => api.post('/reminders', body),
    onSuccess: () => { toast.success('Reminder saved: the email goes out at the time you set'); setCreating(false); invalidate() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create the reminder'),
  })
  const { mutate: update, isPending: updating } = useMutation({
    mutationFn: (body) => api.patch(`/reminders/${editing.id}`, body),
    onSuccess: () => { toast.success('Reminder updated'); setEditing(null); invalidate() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  })
  // Waiting ones first, soonest first; then the done ones.
  const rows = [...reminders].sort((a, b) => Number(a.is_done) - Number(b.is_done) || toDateObj(a.remind_at) - toDateObj(b.remind_at))

  return (
    <div className="space-y-5">
      <PageHeader title="Reminders" sub={user?.role === 'requestor'
        ? 'Email reminders you set for yourself, sent at the time you pick.'
        : 'Email reminders you set for yourself or a colleague, sent at the time you pick.'}>
        <Button onClick={() => setCreating(true)} className="gap-1.5"><Plus className="size-4" /> New reminder</Button>
      </PageHeader>

      <Card className="overflow-hidden">
        <TabBar>
          {TABS.map(t => <Tab key={t.key} active={tab === t.key} count={counts[t.key]} onClick={() => setTab(t.key)}>{t.label}</Tab>)}
        </TabBar>
        <Table framed={false}>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Reminder</TableHead>
              <TableHead>{tab === 'mine' ? 'From' : 'To'}</TableHead>
              <TableHead>About</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={COLS} rows={3} />
              : isError ? <EmptyRow cols={COLS} error="The reminders could not be loaded. Refresh the page to try again." />
              : !rows.length ? (
                <EmptyRow cols={COLS} icon={Bell}
                  title={tab === 'mine' ? 'No reminder for you' : 'You have not set a reminder yet'}
                  sub={tab === 'mine' ? 'Reminders a colleague sets for you, and the ones you set for yourself, appear here.' : 'Use New Reminder to set one.'} />
              )
              : rows.map(r => <ReminderRow key={r.id} r={r} tab={tab} onEdit={setEditing} />)}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-2xl" title="New reminder">
          <ReminderForm onSubmit={create} isPending={saving} onCancel={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <DialogContent className="max-w-2xl" title="Edit the reminder">
          {editing && (
            <ReminderForm
              initial={{
                title: editing.title, note: editing.note || '',
                remind_at: editing.remind_at ? toLocalInput(editing.remind_at) : '',
                assigned_to: String(editing.assigned_to), pr_id: String(editing.pr_id || ''), lot_id: String(editing.lot_id || ''),
              }}
              onSubmit={update} isPending={updating} onCancel={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

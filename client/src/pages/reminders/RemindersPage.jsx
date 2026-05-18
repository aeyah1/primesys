import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Plus, CheckCircle2, Trash2, Clock, Link2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { fmtDatetime } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const TABS = [
  { key: 'mine',    label: 'My Reminders' },
  { key: 'created', label: 'Created by Me' },
]

function toDateObj(dateStr) {
  // MySQL returns "2025-05-09 14:30:00" — replace space with T so browsers parse it correctly
  return new Date(String(dateStr).replace(' ', 'T'))
}

function isPast(dateStr) {
  return toDateObj(dateStr) < new Date()
}

function ReminderForm({ initial, onSubmit, isPending, onCancel }) {
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
          <Input placeholder="e.g. Follow up on PR-2025-001" value={form.title}
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
              {users.map(u => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name} <span className="text-[--color-text-muted] ml-1 text-xs capitalize">({u.role})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Link to PR (optional)</Label>
          <Select value={String(form.pr_id || '')} onValueChange={v => { setF('pr_id', v); setF('lot_id', '') }}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {prList.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.pr_number}{p.title ? ` — ${p.title}` : ''}
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
                  {l.lot_number}{l.title ? ` — ${l.title}` : ''}
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
          {isPending ? 'Saving…' : 'Save Reminder'}
        </Button>
      </div>
    </form>
  )
}

function ReminderCard({ r, tab }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const { user } = useAuth()

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['reminders', 'mine'] })
    qc.invalidateQueries({ queryKey: ['reminders', 'created'] })
  }

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

  const { mutate: update, isPending: updating } = useMutation({
    mutationFn: (body) => api.patch(`/reminders/${r.id}`, body),
    onSuccess: () => { toast.success('Reminder updated'); setEditing(false); invalidate() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  })

  const overdue = isPast(r.remind_at) && !r.is_done
  const canEdit = Number(r.created_by) === Number(user?.id) || user?.role === 'admin'

  return (
    <>
      <div className={`rounded-xl border px-5 py-4 transition-colors ${
        r.is_done
          ? 'border-[--color-border] bg-[--color-canvas] opacity-60'
          : overdue
            ? 'border-red-200 bg-red-50'
            : 'border-[--color-border] bg-[--color-surface]'
      }`}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            {r.is_done
              ? <CheckCircle2 className="size-5 text-emerald-500" />
              : overdue
                ? <Clock className="size-5 text-red-500" />
                : <Bell className="size-5 text-[--color-brand]" />
            }
          </div>

          <div className="flex-1 min-w-0">
            <p className={`text-ui-sm font-semibold ${r.is_done ? 'line-through text-[--color-text-muted]' : 'text-[--color-text-primary]'}`}>
              {r.title}
            </p>
            {r.note && (
              <p className="text-ui-xs text-[--color-text-secondary] mt-0.5 leading-relaxed">{r.note}</p>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
              <span className={`text-[10px] font-medium ${overdue && !r.is_done ? 'text-red-600' : 'text-[--color-text-muted]'}`}>
                {overdue && !r.is_done ? 'Overdue · ' : ''}{fmtDatetime(r.remind_at)}
              </span>

              {tab === 'mine' && (
                <span className="text-[10px] text-[--color-text-muted]">
                  From {r.created_by_name}
                </span>
              )}
              {tab === 'created' && (
                <span className="text-[10px] text-[--color-text-muted]">
                  To {r.assigned_to_name}
                </span>
              )}

              {(r.pr_number || r.lot_number) && (
                <span className="flex items-center gap-1 text-[10px] text-[--color-brand] font-medium">
                  <Link2 className="size-3" />
                  {r.pr_number}{r.lot_number ? ` / ${r.lot_number}` : ''}
                </span>
              )}

              {r.is_sent && !r.is_done && (
                <span className="text-[10px] text-emerald-600 font-medium">Email sent</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {!r.is_done && canEdit && (
              <button onClick={() => setEditing(true)}
                className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-text-primary] hover:bg-overlay transition-colors">
                <Pencil className="size-3.5" />
              </button>
            )}
            {!r.is_done && (
              <button onClick={() => markDone()} disabled={marking}
                className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                <CheckCircle2 className="size-3.5" />
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => {
                  if (window.confirm(`Delete reminder "${r.title}"?`)) remove()
                }}
                disabled={removing}
                className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-500 hover:bg-red-50 transition-colors">
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-lg" title="Edit Reminder">
          <ReminderForm
            initial={{
              title: r.title, note: r.note || '',
              remind_at: String(r.remind_at || '').replace(' ', 'T').slice(0, 16),
              assigned_to: String(r.assigned_to), pr_id: String(r.pr_id || ''), lot_id: String(r.lot_id || ''),
            }}
            onSubmit={update}
            isPending={updating}
            onCancel={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function RemindersPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState('mine')
  const [showCreate, setShowCreate] = useState(false)

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ['reminders', tab],
    queryFn: () => api.get(`/reminders?view=${tab}`).then(r => r.data),
  })

  const { mutate: create, isPending: creating } = useMutation({
    mutationFn: (body) => api.post('/reminders', body),
    onSuccess: () => {
      toast.success('Reminder created — email will be sent at the scheduled time')
      setShowCreate(false)
      qc.invalidateQueries({ queryKey: ['reminders', tab] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create reminder'),
  })

  const pending  = reminders.filter(r => !r.is_done)
  const done     = reminders.filter(r => r.is_done)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary] flex items-center gap-2">
            <Bell className="size-5" /> Reminders
          </h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            Schedule email reminders for yourself or any team member
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="size-4" /> New Reminder
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[--color-border]">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-ui-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? 'border-[--color-brand] text-[--color-brand]'
                : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
            }`}>
            {t.label}
            {t.key === 'mine' && pending.length > 0 && tab !== 'mine'
              ? null
              : t.key === 'mine' && tab === 'mine' && pending.length > 0
                ? <span className="ml-2 inline-flex items-center justify-center rounded-full bg-[--color-brand] text-white text-[10px] w-4 h-4">{pending.length}</span>
                : null
            }
          </button>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <Bell className="size-4 text-[--color-text-muted]" />
            <CardTitle>New Reminder</CardTitle>
          </CardHeader>
          <CardContent>
            <ReminderForm onSubmit={create} isPending={creating} onCancel={() => setShowCreate(false)} />
          </CardContent>
        </Card>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : !reminders.length ? (
        <div className="rounded-xl border border-[--color-border] bg-[--color-surface] px-6 py-16 text-center">
          <Bell className="size-10 text-[--color-text-muted] mx-auto mb-3" />
          <p className="text-ui-sm font-semibold text-[--color-text-primary]">
            {tab === 'mine' ? 'No reminders assigned to you' : 'You haven\'t created any reminders yet'}
          </p>
          <p className="text-ui-xs text-[--color-text-muted] mt-1">
            {tab === 'mine' ? 'Ask a teammate to set one, or create one for yourself.' : 'Click "New Reminder" to get started.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.map(r => <ReminderCard key={r.id} r={r} tab={tab} />)}
            </div>
          )}

          {done.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[--color-text-muted] uppercase tracking-wide">Completed</p>
              {done.map(r => <ReminderCard key={r.id} r={r} tab={tab} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

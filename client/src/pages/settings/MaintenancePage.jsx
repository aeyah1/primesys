import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Wrench, CalendarClock, Power, Save, Bell, Clock, Users, ShieldCheck } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import PageHeader from '@/components/shared/PageHeader'
import { useMaintenance, whenOf, windowOf } from '@/hooks/useMaintenance'
import api from '@/lib/axios'

const TEXTAREA = 'w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y'

// A stored ISO time as a datetime-local value, in this computer's time; '' for none.
const toLocal = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const toIso = (local) => (local ? new Date(local).toISOString() : null)

// What happens during maintenance, and the limits the server keeps (utils/maintenance.js LIMITS).
const RULES = [
  [Bell, 'Everyone is told first', 'Every page shows a notice from the moment it is scheduled until it starts.'],
  [ShieldCheck, 'Only admins work during it', 'Everyone else sees the maintenance page and can\'t sign in or save anything, so nothing changes half-way.'],
  [Clock, 'At most 12 hours at a time', 'It ends by itself at its end time. It can be set up to 30 days ahead, a few times an hour, with a pause after one ends.'],
  [Users, 'The other admins are told', 'Each change reaches every other admin by notice and email, with who made it.'],
]

/* The admin's maintenance switch (server/utils/maintenance.js): a start (blank = right away, at most 30 days ahead),
   an end (at most 12 hours later; a running one may be extended) and a message. Before it starts every page shows a
   notice; while it is on, everyone but admins sees the maintenance page and can't sign in or change anything; it ends
   by itself at its end time, or with End now. The server limits how often it changes and tells the other admins. */
export default function MaintenancePage() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { maintenance: m } = useMaintenance()
  const [form, setForm] = useState({ start: '', end: '', message: '' })
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const active = m && m.state !== 'off'

  useEffect(() => {
    if (m) setForm(active ? { start: toLocal(m.start), end: toLocal(m.end), message: m.message || '' } : { start: '', end: '', message: '' })
  }, [m?.state, m?.start, m?.end, m?.message])

  const done = ({ data }) => { toast.success(data.message); qc.setQueryData(['maintenance'], data.maintenance) }
  const failed = (err) => toast.error(err.response?.data?.message || 'Maintenance could not be changed')
  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => api.put('/maintenance', { start: toIso(form.start), end: toIso(form.end), message: form.message.trim() || null }),
    onSuccess: done, onError: failed,
  })
  const { mutate: end, isPending: ending } = useMutation({ mutationFn: () => api.delete('/maintenance'), onSuccess: done, onError: failed })

  const startsNow = !form.start || new Date(form.start) <= new Date()
  const submit = async () => {
    if (startsNow && m?.state !== 'on' && !(await confirm({
      title: 'Start maintenance now?',
      message: 'Everyone except admins sees the maintenance page at once and can\'t sign in or save anything until it ends.',
      confirmLabel: 'Start maintenance',
    }))) return
    save()
  }

  return (
    <div className="space-y-5">
    <PageHeader title="Maintenance" sub="Pause PRimeSys for everyone but the admins while it is updated or repaired." />
    <div className="grid items-start gap-5 xl:grid-cols-3">
    <Card className="xl:col-span-2">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wrench className="size-4 text-[--color-text-muted]" />
          <CardTitle>Schedule or start maintenance</CardTitle>
        </div>
        <CardDescription>Set when it starts and ends, and what everyone reads meanwhile.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${m?.state === 'on' ? 'border-amber-300 bg-amber-50 text-amber-900'
          : m?.state === 'scheduled' ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-[--color-border-strong] bg-[--color-canvas] text-[--color-text-secondary]'}`}>
          {m?.state === 'scheduled' ? <CalendarClock className="mt-0.5 size-4 shrink-0" /> : <Power className="mt-0.5 size-4 shrink-0" />}
          {m?.state === 'on' ? `On since ${whenOf(m.start)}, until ${whenOf(m.end)}. Only admins can use PRimeSys.`
            : m?.state === 'scheduled' ? `Scheduled: ${windowOf(m)}. Everyone sees the notice until it starts.`
              : 'Off. PRimeSys is open to everyone.'}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mt-start">Starts</Label>
            <Input id="mt-start" type="datetime-local" value={form.start} onChange={e => setF('start', e.target.value)} disabled={m?.state === 'on'} />
            <p className="text-[11px] text-[--color-text-muted]">Blank to start right away; at most 30 days ahead.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt-end">Ends <span className="text-red-600 text-xs">*</span></Label>
            <Input id="mt-end" type="datetime-local" value={form.end} onChange={e => setF('end', e.target.value)} />
            <p className="text-[11px] text-[--color-text-muted]">At most 12 hours after it starts; it ends by itself then. Save a later time to extend it.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mt-message">Message <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span></Label>
          <textarea id="mt-message" rows={2} maxLength={500} value={form.message} onChange={e => setF('message', e.target.value)} className={TEXTAREA}
            placeholder="e.g. Moving PRimeSys to a new server. Requests already filed are kept." />
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {active && (
            <Button variant="danger" className="gap-1.5" disabled={ending || saving} onClick={() => end()}>
              <Power className="size-3.5" /> {m.state === 'on' ? 'End now' : 'Cancel maintenance'}
            </Button>
          )}
          <Button className="gap-1.5" disabled={saving || ending || !form.end} onClick={submit}>
            <Save className="size-3.5" /> {active ? 'Save changes' : startsNow ? 'Start now' : 'Schedule'}
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>How it works</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {RULES.map(([Icon, title, text]) => (
          <div key={title} className="flex gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[--color-brand-light] text-[--color-brand]"><Icon className="size-4" /></span>
            <div>
              <p className="text-ui-sm font-semibold text-[--color-text-primary]">{title}</p>
              <p className="mt-0.5 text-ui-xs leading-snug text-[--color-text-secondary]">{text}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
    </div>
    </div>
  )
}

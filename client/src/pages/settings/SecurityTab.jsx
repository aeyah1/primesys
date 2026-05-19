import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Lock, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import api from '@/lib/axios'

export default function SecurityTab() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [show, setShow] = useState({ current: false, next: false, confirm: false })

  const matches  = form.next.length > 0 && form.next === form.confirm
  const noMatch  = form.confirm.length > 0 && form.next !== form.confirm
  const tooShort = form.next.length > 0 && form.next.length < 6

  const { mutate: submit, isPending } = useMutation({
    mutationFn: () => api.patch('/auth/password', {
      current_password: form.current,
      new_password:     form.next,
    }),
    onSuccess: () => {
      toast.success('Password changed. Use the new one next time you sign in.')
      setForm({ current: '', next: '', confirm: '' })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to change password'),
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (tooShort) return toast.error('New password must be at least 6 characters')
    if (!matches) return toast.error('New passwords do not match')
    submit()
  }

  const canSubmit = form.current && form.next && form.confirm && matches && !tooShort && !isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>You'll stay signed in on this device after changing it</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordField
            id="sec-current"
            label="Current password"
            value={form.current}
            onChange={v => setForm(p => ({ ...p, current: v }))}
            show={show.current}
            onToggle={() => setShow(p => ({ ...p, current: !p.current }))}
            autoComplete="current-password"
          />
          <PasswordField
            id="sec-next"
            label="New password"
            value={form.next}
            onChange={v => setForm(p => ({ ...p, next: v }))}
            show={show.next}
            onToggle={() => setShow(p => ({ ...p, next: !p.next }))}
            autoComplete="new-password"
            hint="Minimum 6 characters"
          />
          <PasswordField
            id="sec-confirm"
            label="Confirm new password"
            value={form.confirm}
            onChange={v => setForm(p => ({ ...p, confirm: v }))}
            show={show.confirm}
            onToggle={() => setShow(p => ({ ...p, confirm: !p.confirm }))}
            autoComplete="new-password"
            invalid={noMatch}
            valid={matches}
          />

          {noMatch && (
            <p className="flex items-center gap-1.5 text-ui-xs text-red-600 font-medium">
              <XCircle className="size-3.5" /> Passwords do not match
            </p>
          )}
          {matches && !tooShort && (
            <p className="flex items-center gap-1.5 text-ui-xs text-emerald-600 font-medium">
              <CheckCircle className="size-3.5" /> Passwords match
            </p>
          )}

          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={!canSubmit} className="gap-1.5" size="sm">
              <Lock className="size-3.5" />
              {isPending ? 'Changing…' : 'Change password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function PasswordField({ id, label, value, onChange, show, onToggle, autoComplete, hint, invalid, valid }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete}
          className={`pr-10 ${invalid ? 'border-red-400 focus-visible:ring-red-300' : valid ? 'border-emerald-400 focus-visible:ring-emerald-200' : ''}`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[--color-text-muted] hover:text-[--color-text-primary] transition-colors"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {hint && <p className="text-ui-xs text-[--color-text-muted]">{hint}</p>}
    </div>
  )
}

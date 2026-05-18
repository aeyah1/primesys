import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { User, Lock, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { fmtDate } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const ROLE_LABELS = {
  admin:       'Administrator',
  procurement: 'Procurement Officer',
  extension:   'Extension Officer',
  supply:      'Supply Officer',
}

export default function ProfilePage() {
  const { user } = useAuth()
  const qc = useQueryClient()

  const [nameVal, setNameVal]   = useState(user?.name || '')
  const [pwForm, setPwForm]     = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError]   = useState('')

  const { mutate: saveName, isPending: savingName } = useMutation({
    mutationFn: () => api.patch('/auth/me', { name: nameVal }),
    onSuccess: () => {
      toast.success('Name updated — reload the page to see it reflected in the sidebar')
      qc.invalidateQueries({ queryKey: ['auth-me'] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update name'),
  })

  const { mutate: changePassword, isPending: changingPw } = useMutation({
    mutationFn: (body) => api.patch('/auth/password', body),
    onSuccess: () => {
      toast.success('Password changed successfully')
      setPwForm({ current: '', next: '', confirm: '' })
      setPwError('')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to change password'),
  })

  function submitPassword(e) {
    e.preventDefault()
    setPwError('')
    if (pwForm.next !== pwForm.confirm) { setPwError('New passwords do not match'); return }
    if (pwForm.next.length < 6)         { setPwError('New password must be at least 6 characters'); return }
    changePassword({ current_password: pwForm.current, new_password: pwForm.next })
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <h2 className="text-ui-xl font-bold text-[--color-text-primary]">My Profile</h2>
        <p className="text-ui-xs text-[--color-text-secondary] mt-0.5">Manage your account information and password</p>
      </div>

      {/* Account info */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <User className="size-4 text-[--color-text-muted]" />
          <CardTitle>Account Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center py-2 border-b border-[--color-border]">
            <span className="text-ui-xs font-medium uppercase tracking-wide text-[--color-text-muted]">Email</span>
            <span className="text-ui-sm text-[--color-text-primary]">{user?.email}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-[--color-border]">
            <span className="text-ui-xs font-medium uppercase tracking-wide text-[--color-text-muted]">Role</span>
            <Badge className="bg-[--color-brand-light] text-[--color-brand] border-[--color-brand]/20">
              {ROLE_LABELS[user?.role] || user?.role}
            </Badge>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-[--color-border]">
            <span className="text-ui-xs font-medium uppercase tracking-wide text-[--color-text-muted]">Member since</span>
            <span className="text-ui-sm text-[--color-text-secondary]">{user?.created_at ? fmtDate(user.created_at) : '—'}</span>
          </div>

          <div className="space-y-1.5 pt-1">
            <Label htmlFor="display-name">Display Name</Label>
            <div className="flex gap-2">
              <Input
                id="display-name"
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                placeholder="Your full name"
                className="flex-1"
              />
              <Button
                onClick={() => saveName()}
                disabled={savingName || !nameVal.trim() || nameVal === user?.name}
                className="gap-1.5 shrink-0"
                size="sm"
              >
                <Save className="size-3.5" />
                {savingName ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Lock className="size-4 text-[--color-text-muted]" />
          <CardTitle>Change Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitPassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current-pw">Current Password</Label>
              <Input
                id="current-pw"
                type="password"
                placeholder="Enter current password"
                value={pwForm.current}
                onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">New Password</Label>
              <Input
                id="new-pw"
                type="password"
                placeholder="At least 6 characters"
                value={pwForm.next}
                onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw">Confirm New Password</Label>
              <Input
                id="confirm-pw"
                type="password"
                placeholder="Re-enter new password"
                value={pwForm.confirm}
                onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
                autoComplete="new-password"
              />
            </div>
            {pwError && (
              <p className="text-ui-xs text-red-600 font-medium">{pwError}</p>
            )}
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={changingPw || !pwForm.current || !pwForm.next || !pwForm.confirm}
                className="gap-1.5"
              >
                <Lock className="size-3.5" />
                {changingPw ? 'Changing…' : 'Change Password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

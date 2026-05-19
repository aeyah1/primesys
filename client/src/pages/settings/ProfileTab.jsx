import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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

export default function ProfileTab() {
  const { user, refreshUser } = useAuth()

  const [name, setName] = useState(user?.name || '')
  const [fc,   setFc]   = useState(user?.fund_cluster || '')
  const [rcc,  setRcc]  = useState(user?.responsibility_center_code || '')

  // Keep form in sync if user object reloads (e.g. on first mount after sign-in).
  useEffect(() => {
    setName(user?.name || '')
    setFc(user?.fund_cluster || '')
    setRcc(user?.responsibility_center_code || '')
  }, [user])

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => api.patch('/auth/me', {
      name:                        name.trim(),
      fund_cluster:                fc.trim() || null,
      responsibility_center_code:  rcc.trim() || null,
    }),
    onSuccess: async () => {
      await refreshUser()
      toast.success('Profile updated')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save profile'),
  })

  const dirty =
    name.trim() !== (user?.name || '') ||
    fc.trim()   !== (user?.fund_cluster || '') ||
    rcc.trim()  !== (user?.responsibility_center_code || '')

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Read-only information from your registration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="Username" value={user?.username || '—'} />
          <Row label="Email"    value={user?.email} />
          <Row
            label="Role"
            value={
              <Badge className="bg-[--color-brand-light] text-[--color-brand] border-[--color-brand]/20">
                {ROLE_LABELS[user?.role] || user?.role}
              </Badge>
            }
          />
          <Row label="Member since" value={user?.created_at ? fmtDate(user.created_at) : '—'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Editable details</CardTitle>
          <CardDescription>These appear on the PRs you create and in the user directory</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prof-name">Display name</Label>
            <Input id="prof-name" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prof-fc">Fund cluster</Label>
            <Input id="prof-fc" value={fc} onChange={e => setFc(e.target.value)} placeholder="e.g. 101" />
            <p className="text-ui-xs text-[--color-text-muted]">Defaults onto PRs you create. Leave blank to use the org default.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prof-rcc">Responsibility center code</Label>
            <Input id="prof-rcc" value={rcc} onChange={e => setRcc(e.target.value)} placeholder="e.g. 08 016 0300064" />
          </div>
          <div className="flex justify-end pt-1">
            <Button onClick={() => save()} disabled={saving || !dirty || !name.trim()} className="gap-1.5" size="sm">
              <Save className="size-3.5" />
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-ui-xs font-medium uppercase tracking-wide text-[--color-text-muted]">{label}</span>
      <span className="text-ui-sm text-[--color-text-primary]">{value}</span>
    </div>
  )
}

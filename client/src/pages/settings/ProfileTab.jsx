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
  requestor:   'Requestor',
  supply:      'Supply Officer',
  twg:         'Technical Working Group',
  bac:         'Bids and Awards Committee',
}

export default function ProfileTab() {
  const { user, refreshUser } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [designation, setDesignation] = useState(user?.designation || '')

  useEffect(() => {
    setName(user?.name || '')
    setDesignation(user?.designation || '')
  }, [user])

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => api.patch('/auth/me', { name: name.trim(), designation: designation.trim() }),
    onSuccess: async () => {
      await refreshUser()
      toast.success('Profile updated')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save profile'),
  })

  const dirty = name.trim() !== (user?.name || '') || designation.trim() !== (user?.designation || '')

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
          <CardTitle>Name and designation</CardTitle>
          <CardDescription>How you appear across the app and on the PRs you file</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prof-name">Full name</Label>
            <Input id="prof-name" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prof-designation">Designation</Label>
            <Input
              id="prof-designation"
              value={designation}
              onChange={e => setDesignation(e.target.value)}
              placeholder="e.g. Department Chair, DCS"
            />
            <p className="text-[11px] text-[--color-text-muted]">
              Printed under your name on the "Requested by" line of every PR form you file.
              PRs you have already filed keep the designation they were filed with.
            </p>
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

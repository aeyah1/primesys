import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Save, PenLine } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { fmtDate } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import SignatureDialog from '@/components/shared/SignatureDialog'
import useMySignature from '@/hooks/useMySignature'
import api from '@/lib/axios'

const ROLE_LABELS = {
  admin:       'Administrator',
  procurement: 'Procurement Officer',
  requestor:   'End User',
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

      {user?.role === 'twg' && <MySignatureCard />}
    </div>
  )
}

// A TWG member's saved signature, filled in on the certificates they issue (they can still change it each time).
function MySignatureCard() {
  const confirm = useConfirm()
  const { user } = useAuth()
  const { saved, save, saving, remove, removing } = useMySignature()
  const [signing, setSigning] = useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>My signature</CardTitle>
        <CardDescription>
          Saved, it is filled in on the certificate each time you approve a request or certify bids. You still see it
          there, and can sign differently or leave it off before you confirm. Only you can see it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {saved
          ? <img src={saved.image} alt={`Signature of ${user?.name || 'you'}`} className="h-12 max-w-56 rounded-md border border-[--color-border] bg-white object-contain px-2" />
          : <p className="text-ui-sm text-[--color-text-secondary]">No signature saved: certificates print a blank line unless you sign them.</p>}
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={saving} onClick={() => setSigning(true)}>
            <PenLine className="size-3.5" /> {saved ? 'Replace' : 'Add signature'}
          </Button>
          {saved && (
            <Button type="button" size="sm" variant="ghost" disabled={removing}
              onClick={async () => { if (await confirm({ title: 'Remove your saved signature?', message: 'Certificates print a blank line unless you sign them.', confirmLabel: 'Remove', danger: true })) remove() }}>
              Remove
            </Button>
          )}
        </div>
      </CardContent>
      {signing && <SignatureDialog signer={user?.name} description="Your signature, filled in on the TWG certificates you issue."
        onClose={() => setSigning(false)} onSave={save} />}
    </Card>
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

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ScanFace, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fmtDatetime } from '@/lib/utils'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { useMyFace } from '@/hooks/useMyFace'
import FaceSetup from '@/components/face/FaceSetup'
import api from '@/lib/axios'

// A staff member's own face check (server/utils/faceCheck.js): set up, set up again, or removed.
export default function FaceCard() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { data: face } = useMyFace()
  const [setup, setSetup] = useState(false)
  const [removing, setRemoving] = useState(false)
  if (!face?.staff) return null

  const done = () => { setSetup(false); qc.invalidateQueries({ queryKey: ['my-face'] }) }
  const remove = async () => {
    const yes = await confirm({
      title: 'Remove your face check?',
      message: face.in_force ? 'Your face measurements are deleted. While face checks are required, you can\'t do critical actions until you set one up again.' : 'Your face measurements are deleted.',
      confirmLabel: 'Remove', danger: true,
    })
    if (!yes) return
    setRemoving(true)
    try {
      await api.delete('/auth/face')
      toast.success('Face check removed')
      done()
    } catch (err) {
      toast.error(err.response?.data?.message || 'The face check couldn\'t be removed')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ScanFace className="size-4 text-[--color-text-muted]" />
          <CardTitle>Face check</CardTitle>
        </div>
        <CardDescription>
          {face.in_force
            ? 'Required for staff: your face is checked when you sign in and before critical actions.'
            : 'Not required yet. Set it up now, and you\'re ready when the administrator turns face checks on.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!face.can_enrol ? (
          <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-ui-xs text-amber-900">
            Face checks can't be set up yet: the server has no key to keep faces encrypted. Tell your administrator.
          </p>
        ) : setup ? (
          <FaceSetup onDone={done} onCancel={() => setSetup(false)} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {face.enrolled_at ? (
              <p className="flex flex-1 items-center gap-2 text-ui-sm text-[--color-text-primary]">
                <ShieldCheck className="size-4 shrink-0 text-emerald-600" /> Set up {fmtDatetime(face.enrolled_at)}
              </p>
            ) : (
              <p className="flex-1 text-ui-sm text-[--color-text-secondary]">Not set up. You need a camera, and it takes about a minute.</p>
            )}
            <Button size="sm" className="gap-1.5" onClick={() => setSetup(true)}>
              <ScanFace className="size-3.5" /> {face.enrolled_at ? 'Set up again' : 'Set up face check'}
            </Button>
            {face.enrolled_at && (
              <Button size="sm" variant="outline" className="gap-1.5" disabled={removing} onClick={remove}>
                <Trash2 className="size-3.5" /> Remove
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

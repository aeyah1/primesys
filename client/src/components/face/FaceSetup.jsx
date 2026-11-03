import { useState } from 'react'
import { ScanFace, ArrowLeft } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import api from '@/lib/axios'
import FaceCamera from './FaceCamera'

// What a face check keeps and why, for the person's consent (Data Privacy Act of 2012, RA 10173: sensitive personal information).
const NOTICE = [
  ['What is kept', 'The camera picture is turned into 128 numbers that describe the shape of your face. Only those numbers are kept, never a photo or video.'],
  ['Why', 'To confirm it is you when you sign in and before critical actions: recording an award, issuing, cancelling or closing a purchase order, certifying bids, cancelling or deleting a request, and changing user accounts or organization settings.'],
  ['How', 'Encrypted (AES-256) on PRimeSys\'s server. Nobody can view them, the administrator included, and they are never shared.'],
  ['How long', 'Until you remove them here, an administrator removes them, or your account is deactivated, deleted or made an End User.'],
  ['Your rights', 'You may withdraw your consent at any time by removing them. While face checks are required, critical actions then wait until you set one up again. Questions go to the campus Data Protection Officer.'],
]

/* Setting up a face check (server/controllers/face.controller.js): the notice and consent, the password, then the
   camera reads the face five times. onDone() after it is saved; onCancel() closes it. */
export default function FaceSetup({ onDone, onCancel }) {
  const [agreed, setAgreed] = useState(false)
  const [password, setPassword] = useState('')
  const [camera, setCamera] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const save = async (samples) => {
    setBusy(true)
    try {
      await api.put('/auth/face', { samples, password, consent: true })
      toast.success('Face check set up', { description: 'It is asked for at sign-in and before critical actions while face checks are on.' })
      onDone()
    } catch (err) {
      const res = err.response
      // A wrong password goes back to the form; anything else is shown on the camera to try again.
      if (res?.status === 401) { setCamera(false); toast.error(res.data?.message || 'Your password isn\'t right.') }
      else setError(res?.data?.message || 'The face check couldn\'t be saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (camera) {
    return (
      <div className="space-y-4">
        <p className="text-ui-sm text-[--color-text-secondary]">Look at the camera, turn your head a little to one side and back, then hold still while your face is read.</p>
        <FaceCamera count={5} onCapture={save} busy={busy} error={error} onRetry={() => setError(null)} />
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { setCamera(false); setError(null) }}>
          <ArrowLeft className="size-3.5" /> Back
        </Button>
      </div>
    )
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setCamera(true) }}>
      <dl className="space-y-2.5 rounded-xl border border-blue-300 bg-blue-50 p-4 text-ui-xs text-blue-900">
        {NOTICE.map(([term, text]) => (
          <div key={term}>
            <dt className="font-semibold">{term}</dt>
            <dd className="mt-0.5 text-blue-800">{text}</dd>
          </div>
        ))}
      </dl>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[--color-brand]" />
        <span className="text-ui-sm text-[--color-text-primary]">I have read this notice and agree to PRimeSys keeping my face measurements for these purposes.</span>
      </label>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="face-password">Your password</Label>
        <Input id="face-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" className="gap-1.5" disabled={!agreed || !password}><ScanFace className="size-4" /> Start the camera</Button>
      </div>
    </form>
  )
}

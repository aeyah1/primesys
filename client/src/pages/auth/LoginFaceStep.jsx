import { useState } from 'react'
import { ScanFace, AlertCircle, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import FaceCamera from '@/components/face/FaceCamera'
import api from '@/lib/axios'

/* The last step of a staff sign-in while face checks are on: the face, matched against the one on record.
   challenge: { ticket } from POST /auth/login or /auth/login/verify; onDone(data) gets the signed-in reply; onBack() starts over. */
export default function LoginFaceStep({ challenge, onDone, onBack }) {
  const [error, setError] = useState(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)

  const check = async (samples) => {
    setBusy(true)
    try {
      const { data } = await api.post('/auth/login/face', { ticket: challenge.ticket, samples })
      onDone(data)
    } catch (err) {
      const data = err.response?.data || {}
      setError(data.message || (err.response ? 'Something went wrong. Please try again.' : 'PRimeSys can\'t be reached. Check your internet connection.'))
      setOver(data.type === 'expired' || data.type === 'inactive')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8 space-y-5">
      <div className="flex items-start gap-3 rounded-md border border-blue-300 bg-blue-50 p-3.5">
        <ScanFace className="mt-0.5 size-4 shrink-0 text-blue-600" />
        <div>
          <p className="text-ui-sm font-semibold text-blue-800">Face check</p>
          <p className="mt-0.5 text-ui-xs text-blue-700">Staff accounts confirm it's them with their face. Look at the camera, turn your head a little to one side and back, then hold still.</p>
        </div>
      </div>

      {over ? (
        <>
          <div role="alert" className="flex items-start gap-3 rounded-md border border-red-300 bg-red-50 p-3.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
            <p className="text-ui-xs text-red-700">{error}</p>
          </div>
          <Button type="button" size="lg" className="w-full" onClick={onBack}>Sign in again</Button>
        </>
      ) : (
        <FaceCamera count={3} onCapture={check} busy={busy} error={error} onRetry={() => setError(null)} />
      )}

      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-ui-xs text-[--color-text-muted] transition-colors hover:text-[--color-text-primary]">
        <ArrowLeft className="size-3.5" /> Use another account
      </button>
    </div>
  )
}

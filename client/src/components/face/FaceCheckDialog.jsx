import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import api, { setFaceAsker } from '@/lib/axios'
import FaceCamera from './FaceCamera'

/* The face check before a critical action (server/middleware/face.middleware.js): lib/axios.js opens this when the
   server holds an action for one, and sends the action again once the face matches. */
export default function FaceCheckDialog() {
  const [asked, setAsked] = useState(null)   // { enrolled, resolve }
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setFaceAsker((info) => new Promise(resolve => {
      setError(null)
      setAttempt(a => a + 1)
      setAsked({ enrolled: info?.enrolled !== false, resolve })
    }))
    return () => setFaceAsker(null)
  }, [])

  const answer = (passed) => { asked?.resolve(passed); setAsked(null) }
  const check = async (samples) => {
    setBusy(true)
    try {
      await api.post('/auth/face/check', { samples })
      answer(true)
    } catch (err) {
      setError(err.response?.data?.message || 'The face check couldn\'t be finished. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!asked} onOpenChange={v => { if (!v) answer(false) }}>
      <DialogContent title="Confirm it's you" className="max-w-md"
        description={asked?.enrolled ? 'This action needs a face check. Look at the camera, turn your head a little to one side and back, then hold still.' : 'This action needs a face check, and you haven\'t set one up yet.'}>
        {asked?.enrolled
          ? <FaceCamera key={attempt} count={3} onCapture={check} busy={busy} error={error} onRetry={() => setError(null)} />
          : <p className="text-ui-sm text-[--color-text-secondary]">Set it up once in Settings, Security. It takes about a minute and needs a camera.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>Cancel</Button>
          {!asked?.enrolled && <Button asChild onClick={() => answer(false)}><Link to="/settings?tab=security">Set up face check</Link></Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

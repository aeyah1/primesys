import { useEffect, useRef, useState } from 'react'
import { CameraOff, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadFace, openCamera, captureFace } from '@/lib/face'

const PROBLEMS = {
  denied:  'PRimeSys wasn\'t allowed to use the camera. Allow it from the camera icon in the address bar, then try again.',
  none:    'No camera was found. Connect one, or use a laptop or phone that has one.',
  busy:    'The camera is being used by another app. Close it, then try again.',
  timeout: 'No head turn was seen. Face the camera in good light, turn your head a little to one side and back, then hold still.',
  load:    'The face check couldn\'t be loaded. Check your internet connection, then try again.',
}

/* The camera picture and what to do, for a face check or for setting one up (lib/face.js). onCapture(samples) gets the
   face measurements; the picture itself never leaves this browser, and the camera turns off once the face is read.
   error: why the server refused the last reading; Try again clears it (onRetry) and reads the face once more. */
export default function FaceCamera({ count = 3, onCapture, busy = false, error = null, onRetry }) {
  const video = useRef(null)
  const [status, setStatus] = useState('Starting the camera')
  const [problem, setProblem] = useState(null)
  const [run, setRun] = useState(0)

  useEffect(() => {
    const stop = new AbortController()
    let stream = null
    setProblem(null)
    setStatus('Starting the camera')
    ;(async () => {
      try {
        const models = loadFace()
        stream = await openCamera()
        if (stop.signal.aborted) return
        video.current.srcObject = stream
        await video.current.play()
        setStatus('Getting ready (the first time takes a moment)')
        await models
        const samples = await captureFace(video.current, { count, onStatus: setStatus, signal: stop.signal })
        if (samples) onCapture(samples)
      } catch (err) {
        if (!stop.signal.aborted) setProblem(PROBLEMS[err.reason] || PROBLEMS.load)
      } finally {
        stream?.getTracks().forEach(t => t.stop())
      }
    })()
    return () => { stop.abort(); stream?.getTracks().forEach(t => t.stop()) }
  }, [run])   // eslint-disable-line react-hooks/exhaustive-deps

  const shown = problem || error
  const retry = () => { onRetry?.(); setRun(r => r + 1) }

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-sm overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-sm">
        <video ref={video} muted playsInline className="size-full -scale-x-100 object-cover" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="aspect-[3/4] h-[78%] rounded-[50%] border-2 border-white/70" />
        </div>
        {shown ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/85 px-6 text-center">
            <CameraOff className="size-6 text-amber-300" />
            <p role="alert" className="text-ui-sm text-white">{shown}</p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={retry}><RotateCcw className="size-3.5" /> Try again</Button>
          </div>
        ) : (
          <p role="status" className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-lg bg-black/65 px-3 py-1.5 text-ui-xs font-medium text-white">
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? 'Checking' : status}
          </p>
        )}
      </div>
      <p className="text-center text-[11px] text-[--color-text-muted]">
        The picture stays on this device. Only face measurements are sent, and PRimeSys keeps them encrypted.
      </p>
    </div>
  )
}

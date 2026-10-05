import { useEffect, useRef, useState } from 'react'
import { PenLine, Upload, Eraser, Check } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'

const PAD_W = 480
const PAD_H = 160
// Uploaded pictures are scaled down to this box, so the saved PNG stays small (the server takes 100 KB at most).
const MAX_W = 420
const MAX_H = 140
const WAYS = [
  { key: 'drawn',    label: 'Sign on the spot', icon: PenLine },
  { key: 'uploaded', label: 'Upload a signature', icon: Upload },
]

/* A signature for a document: signed on the spot inside a box (mouse, finger,
   or pen), or a picture of it uploaded. signer: whose signature it is.
   onSave({ image, method }): image is a PNG data URL, method 'drawn' or 'uploaded'. */
export default function SignatureDialog({ signer, onSave, onClose }) {
  const [way, setWay] = useState('drawn')
  const [image, setImage] = useState(null)   // the uploaded picture, as a PNG data URL
  const [drawn, setDrawn] = useState(false)
  const pad = useRef(null)
  const drawing = useRef(false)

  const ctx = () => {
    const c = pad.current.getContext('2d')
    c.lineWidth = 2.5; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#0b1f4d'
    return c
  }
  const clear = () => { if (pad.current) ctx().clearRect(0, 0, PAD_W, PAD_H); setDrawn(false) }
  useEffect(() => { if (way === 'drawn') clear() }, [way])

  const at = (e) => {
    const r = pad.current.getBoundingClientRect()
    return [(e.clientX - r.left) * (PAD_W / r.width), (e.clientY - r.top) * (PAD_H / r.height)]
  }
  const down = (e) => { drawing.current = true; pad.current.setPointerCapture(e.pointerId); const c = ctx(); c.beginPath(); c.moveTo(...at(e)) }
  const move = (e) => { if (!drawing.current) return; const c = ctx(); c.lineTo(...at(e)); c.stroke(); setDrawn(true) }
  const up = () => { drawing.current = false }

  // Draws the picked picture within MAX_W x MAX_H and keeps it as a PNG.
  const upload = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toast.error('Use a PNG or JPG picture of the signature')
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(MAX_W / img.width, MAX_H / img.height, 1)
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(img.src)
      setImage(c.toDataURL('image/png'))
    }
    img.onerror = () => toast.error('That picture could not be read')
    img.src = URL.createObjectURL(file)
  }

  const ready = way === 'drawn' ? drawn : !!image
  const save = () => {
    onSave({ image: way === 'drawn' ? pad.current.toDataURL('image/png') : image, method: way })
    onClose()
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Signature" description={signer ? `The signature of ${signer}, printed on the Requested by line of the form.` : undefined} className="max-w-xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {WAYS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" onClick={() => setWay(key)}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                  way === key ? 'border-[--color-brand] bg-[--color-brand-light] text-[--color-brand]' : 'border-[--color-border] text-[--color-text-secondary] hover:border-[--color-border-strong]'}`}>
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>

          {way === 'drawn' ? (
            <div className="space-y-2">
              <canvas ref={pad} width={PAD_W} height={PAD_H}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
                className="w-full aspect-[3/1] rounded-lg border border-dashed border-[--color-border-strong] bg-white touch-none cursor-crosshair" />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-[--color-text-muted]">{signer || 'The person who requested it'} signs inside the box, with a mouse, finger, or pen.</p>
                <Button type="button" variant="ghost" size="sm" onClick={clear} className="gap-1.5"><Eraser className="size-3.5" /> Clear</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {image
                ? <div className="flex justify-center rounded-lg border border-[--color-border] bg-white p-3"><img src={image} alt="The uploaded signature" className="max-h-28" /></div>
                : <p className="text-sm text-[--color-text-secondary]">A picture of the signature on white paper (PNG or JPG).</p>}
              <label className="inline-flex">
                <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={upload} />
                <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[--color-border] bg-[--color-surface] text-sm font-medium cursor-pointer hover:bg-[--color-overlay]">
                  <Upload className="size-3.5" /> {image ? 'Choose another picture' : 'Choose a picture'}
                </span>
              </label>
            </div>
          )}
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!ready} onClick={save} className="gap-1.5"><Check className="size-3.5" /> Use this signature</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PenLine, Upload, Eraser, Save, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const PAD_W = 480
const PAD_H = 160
// Uploaded images are scaled down to this box, so the saved PNG stays small.
const MAX_W = 420
const MAX_H = 140

// The signature stamped on documents this user signs (a PPMP they verify): drawn here or uploaded.
export default function SignatureCard() {
  const { refreshUser } = useAuth()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const pad = useRef(null)
  const drawing = useRef(false)
  const [drawn, setDrawn] = useState(false)
  const [editing, setEditing] = useState(false)

  const { data } = useQuery({ queryKey: ['my-signature'], queryFn: () => api.get('/auth/me/signature').then(r => r.data) })
  const saved = data?.signature

  const done = async (message) => {
    toast.success(message)
    qc.invalidateQueries({ queryKey: ['my-signature'] })
    await refreshUser()
    setEditing(false)
  }
  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: (image) => api.put('/auth/me/signature', { image }),
    onSuccess: (res) => done(res.data.message),
    onError: (err) => toast.error(err.response?.data?.message || 'Could not save the signature'),
  })
  const { mutate: remove } = useMutation({
    mutationFn: () => api.delete('/auth/me/signature'),
    onSuccess: (res) => done(res.data.message),
    onError: (err) => toast.error(err.response?.data?.message || 'Could not remove the signature'),
  })

  const ctx = () => {
    const c = pad.current.getContext('2d')
    c.lineWidth = 2.5; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#0b1f4d'
    return c
  }
  const clear = () => { ctx().clearRect(0, 0, PAD_W, PAD_H); setDrawn(false) }
  useEffect(() => { if (editing && pad.current) clear() }, [editing])

  const at = (e) => {
    const r = pad.current.getBoundingClientRect()
    return [(e.clientX - r.left) * (PAD_W / r.width), (e.clientY - r.top) * (PAD_H / r.height)]
  }
  const down = (e) => { drawing.current = true; pad.current.setPointerCapture(e.pointerId); const c = ctx(); c.beginPath(); c.moveTo(...at(e)) }
  const move = (e) => { if (!drawing.current) return; const c = ctx(); c.lineTo(...at(e)); c.stroke(); setDrawn(true) }
  const up = () => { drawing.current = false }

  // Draws an uploaded image onto a canvas within MAX_W x MAX_H and saves it as PNG.
  const upload = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toast.error('Use a PNG or JPG image of your signature')
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(MAX_W / img.width, MAX_H / img.height, 1)
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(img.src)
      save(c.toDataURL('image/png'))
    }
    img.onerror = () => toast.error('That image could not be read')
    img.src = URL.createObjectURL(file)
  }

  const askRemove = async () => {
    if (await confirm({ title: 'Remove your signature?', message: 'Documents you already signed keep it. You need one again to verify a PPMP.', confirmLabel: 'Remove', danger: true })) remove()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signature</CardTitle>
        <CardDescription>Stamped on the documents you sign in PRimeSys, such as a PPMP you verify</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!editing && (
          saved
            ? <div className="rounded-lg border border-[--color-border] bg-white p-3 flex justify-center"><img src={saved} alt="Your saved signature" className="max-h-24" /></div>
            : <p className="text-ui-sm text-[--color-text-secondary]">No signature saved yet. Draw one, or upload a picture of it on white paper.</p>
        )}
        {editing && (
          <div className="space-y-2">
            <canvas
              ref={pad} width={PAD_W} height={PAD_H}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
              className="w-full max-w-[480px] aspect-[3/1] rounded-lg border border-dashed border-[--color-border-strong] bg-white touch-none cursor-crosshair"
            />
            <p className="text-[11px] text-[--color-text-muted]">Sign inside the box with your mouse, finger, or pen.</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              <Button variant="secondary" size="sm" onClick={clear} className="gap-1.5"><Eraser className="size-3.5" /> Clear</Button>
              <Button size="sm" onClick={() => save(pad.current.toDataURL('image/png'))} disabled={!drawn || saving} className="gap-1.5">
                <Save className="size-3.5" /> {saving ? 'Saving...' : 'Save signature'}
              </Button>
            </>
          ) : (
            <>
              {saved && <Button variant="ghost" size="sm" onClick={askRemove} className="gap-1.5 text-red-600"><Trash2 className="size-3.5" /> Remove</Button>}
              <label className="inline-flex">
                <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={upload} />
                <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[--color-border] bg-[--color-surface] text-ui-sm font-medium cursor-pointer hover:bg-[--color-overlay]">
                  <Upload className="size-3.5" /> Upload image
                </span>
              </label>
              <Button size="sm" onClick={() => setEditing(true)} className="gap-1.5"><PenLine className="size-3.5" /> {saved ? 'Draw a new one' : 'Draw signature'}</Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

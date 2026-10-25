import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'

// Signs the browser out after 30 minutes without activity, for shared computers, warning a minute before. Every tab
// shares the sign-in, so the tabs share their activity and sign out together.
const IDLE_MS = 30 * 60_000
const WARN_MS = 60_000
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart']
const MESSAGE = 'You were signed out after 30 minutes without activity, to keep your account safe on shared computers.'
const SEEN = 'primesys_active'   // the sign-in's last activity, so the time a closed browser sat unused counts too

export default function IdleSignOut() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const last = useRef(Date.now())
  const [left, setLeft] = useState(null)   // seconds until sign-out while the warning shows, else null
  const warning = left !== null

  useEffect(() => {
    // The sign-in this tab shares with other windows, told apart by its token's last characters.
    const key = (localStorage.getItem('primesys_token') || '').slice(-24)
    try { const s = JSON.parse(localStorage.getItem(SEEN)); if (key && s?.key === key) last.current = s.at } catch { /* not kept: counts from now */ }
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('primesys-activity') : null
    let marked = 0
    let ended = false
    const end = (tell) => {
      if (ended) return
      ended = true
      if (tell) channel?.postMessage({ key, out: true })
      sessionStorage.setItem('primesys_notice', MESSAGE)
      logout({ reason: 'idle' })
      navigate('/login', { replace: true })
    }
    // Activity counts every few seconds at most; while the warning shows, only "Stay signed in" keeps the session.
    const mark = () => {
      const now = Date.now()
      if (now - marked < 5000 || document.querySelector('[data-idle-warning]')) return
      marked = now
      last.current = now
      try { localStorage.setItem(SEEN, JSON.stringify({ key, at: now })) } catch { /* not kept: a reopened browser counts from then */ }
      channel?.postMessage({ key, at: now })
    }
    if (channel) channel.onmessage = ({ data }) => {
      if (!key || data?.key !== key) return
      if (data.out) end(false)
      else if (data.at > last.current) { last.current = data.at; setLeft(null) }
    }
    // Checked every second from the clock, so time spent asleep (a closed laptop) counts too, and once right away.
    const check = () => {
      const idle = Date.now() - last.current
      if (idle >= IDLE_MS) end(true)
      else if (idle >= IDLE_MS - WARN_MS) setLeft(Math.ceil((IDLE_MS - idle) / 1000))
      else setLeft(l => (l === null ? l : null))
    }
    check()
    EVENTS.forEach(e => window.addEventListener(e, mark, { passive: true, capture: true }))
    const tick = setInterval(check, 1000)
    return () => {
      clearInterval(tick)
      EVENTS.forEach(e => window.removeEventListener(e, mark, { capture: true }))
      channel?.close()
    }
  }, [logout, navigate])

  const stay = () => {
    last.current = Date.now()
    setLeft(null)
    const seen = { key: (localStorage.getItem('primesys_token') || '').slice(-24), at: last.current }
    try { localStorage.setItem(SEEN, JSON.stringify(seen)) } catch { /* not kept */ }
    try { new BroadcastChannel('primesys-activity').postMessage(seen) } catch { /* only this tab */ }
  }

  return (
    <Dialog open={warning} onOpenChange={(open) => { if (!open) stay() }}>
      <DialogContent title="Still there?" className="max-w-md">
        <div data-idle-warning className="flex items-start gap-3">
          <Clock className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <p className="text-ui-sm text-[--color-text-secondary]">
            For your security, PRimeSys signs you out after 30 minutes without activity. You'll be signed out in
            <strong className="tabular-nums text-[--color-text-primary]"> {left} {left === 1 ? 'second' : 'seconds'}</strong>. Anything not saved on this page is lost.
          </p>
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="secondary" onClick={() => { logout(); navigate('/login', { replace: true }) }}>Sign out now</Button>
          <Button onClick={stay}>Stay signed in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

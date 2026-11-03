import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WifiOff } from 'lucide-react'
import api from '@/lib/axios'

/* While PRimeSys can't be reached (no internet, or the server down or still waking up): says so, checks every five
   seconds, and once the server answers again goes away and refreshes what the page shows (lib/axios.js raises it). */
export default function ConnectionBanner() {
  const qc = useQueryClient()
  const [down, setDown] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)

  useEffect(() => {
    const lost = () => setDown(true)
    window.addEventListener('primesys:unreachable', lost)
    window.addEventListener('offline', lost)
    return () => { window.removeEventListener('primesys:unreachable', lost); window.removeEventListener('offline', lost) }
  }, [])

  useEffect(() => {
    if (!down) return
    const id = setInterval(async () => {
      try {
        await api.get('/health', { timeout: 4000 })
        setDown(false)
        qc.invalidateQueries()
      } catch { /* still down: try again next time */ }
    }, 5000)
    return () => clearInterval(id)
  }, [down, qc])

  if (!down) return null
  return (
    <p role="status" className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-6 lg:px-10">
      <WifiOff className="mt-px size-3.5 shrink-0" />
      <span><span className="font-semibold">PRimeSys can't be reached.</span> Check your internet connection; retrying every few seconds. Anything not saved yet stays on the page.</span>
    </p>
  )
}

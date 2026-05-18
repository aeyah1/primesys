import { useEffect, useRef, useState } from 'react'
import { useIsFetching, useIsMutating } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'

/**
 * Thin top progress bar that lights up while any of the following is happening:
 *   - A route chunk is loading (lazy-loaded page)
 *   - A React Query is fetching
 *   - A mutation is in flight
 *
 * Behavior: jumps to ~30% on activity start, creeps toward 90% slowly,
 * snaps to 100% on completion, then fades out.
 */
export default function GlobalLoadingBar() {
  const isFetching = useIsFetching()
  const isMutating = useIsMutating()
  const { pathname } = useLocation()

  const [progress, setProgress] = useState(0)
  const [visible,  setVisible]  = useState(false)
  const creepRef  = useRef(null)
  const hideRef   = useRef(null)

  const busy = isFetching > 0 || isMutating > 0

  // Pulse on every route change — covers lazy-chunk load time.
  useEffect(() => {
    setVisible(true)
    setProgress((p) => Math.max(p, 25))
    clearTimeout(hideRef.current)
    hideRef.current = setTimeout(() => {
      setProgress(100)
      hideRef.current = setTimeout(() => { setVisible(false); setProgress(0) }, 250)
    }, 350)
    return () => clearTimeout(hideRef.current)
  }, [pathname])

  // Network busy state.
  useEffect(() => {
    clearInterval(creepRef.current)
    clearTimeout(hideRef.current)

    if (busy) {
      setVisible(true)
      setProgress((p) => Math.max(p, 30))
      creepRef.current = setInterval(() => {
        setProgress((p) => (p < 88 ? p + (90 - p) * 0.08 : p))
      }, 200)
    } else {
      setProgress(100)
      hideRef.current = setTimeout(() => { setVisible(false); setProgress(0) }, 250)
    }
    return () => { clearInterval(creepRef.current); clearTimeout(hideRef.current) }
  }, [busy])

  return (
    <div
      className="fixed top-0 left-0 right-0 h-[2px] z-[101] pointer-events-none transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div
        className="h-full ease-out"
        style={{
          width: `${progress}%`,
          background: 'linear-gradient(90deg, hsl(145,62%,45%), hsl(160,72%,60%))',
          boxShadow: '0 0 8px rgba(52,211,153,0.55)',
          transition: 'width 200ms ease-out',
        }}
      />
    </div>
  )
}

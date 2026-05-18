import { useEffect, useRef, useState } from 'react'

/**
 * AnimatedNumber — smoothly counts up from 0 (or previous value) to `value`.
 *
 * Props:
 *   value    — target number (string or number)
 *   prefix   — string prepended to display value (e.g. "PHP ")
 *   suffix   — string appended  (e.g. "%")
 *   decimals — decimal places to show (0 = integer, 2 = currency-style)
 *   duration — animation duration in ms (default 900)
 *   className
 */
export default function AnimatedNumber({
  value,
  prefix   = '',
  suffix   = '',
  decimals = 0,
  duration = 900,
  className = '',
}) {
  const [display, setDisplay] = useState(0)
  const rafRef     = useRef(null)
  const targetRef  = useRef(0)   // last value we tried to animate TO
  const displayRef = useRef(0)   // current visible value — mirrors `display` synchronously

  useEffect(() => {
    const target = parseFloat(value) || 0

    // Skip if target unchanged AND we're already showing it (avoids restart on parent re-render).
    if (target === targetRef.current && Math.round(displayRef.current) === Math.round(target)) {
      return
    }

    // Interrupt in-flight animation: start from where we visibly are, not from the last target.
    const from  = displayRef.current
    const start = performance.now()
    targetRef.current = target

    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased    = 1 - Math.pow(1 - progress, 3)  // ease-out cubic
      const next     = from + (target - from) * eased
      displayRef.current = next
      setDisplay(next)
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }

    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])

  const formatted =
    decimals > 0
      ? display.toFixed(decimals)
      : Math.round(display).toLocaleString('en-PH')

  return (
    <span className={className}>
      {prefix}{formatted}{suffix}
    </span>
  )
}

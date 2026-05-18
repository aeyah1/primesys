/**
 * AnimatedPage — wraps page content with a fade-in-up entry animation.
 * Apply `key={pathname}` on this component from AppLayout so it remounts
 * (and re-triggers the animation) on every route change.
 */
export default function AnimatedPage({ children }) {
  return (
    <div className="animate-page">
      {children}
    </div>
  )
}

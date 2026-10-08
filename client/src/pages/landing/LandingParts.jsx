import { useEffect, useRef, useState } from 'react'

// Entrance used across the landing page; skipped when the visitor prefers less motion.
export const ENTER = 'motion-safe:animate-[fade-in-up_0.7s_cubic-bezier(0.22,1,0.36,1)_both]'

export const NAVY_BG = { background: 'linear-gradient(180deg, var(--sidebar-bg-top) 0%, var(--sidebar-bg-bottom) 100%)' }

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Tracks whether the element is on screen; with `once` it stays true after the first time.
export function useInView({ once = true, threshold = 0.15, rootMargin = '0px 0px -60px 0px' } = {}) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      setInView(once ? v => v || e.isIntersecting : e.isIntersecting)
      if (once && e.isIntersecting) obs.disconnect()
    }, { threshold, rootMargin })
    obs.observe(el)
    return () => obs.disconnect()
  }, [once, threshold, rootMargin])
  return [ref, inView]
}

// Slides its children up into place the first time they scroll into view.
export function Reveal({ children, delay = 0, className = '' }) {
  const [ref, inView] = useInView()
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={`transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0 ${
        inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      } ${className}`}>
      {children}
    </div>
  )
}

export function SectionHead({ eyebrow, title, children, className = '' }) {
  return (
    <Reveal className={className}>
      <p className="flex items-center gap-3 text-ui-xs font-semibold uppercase tracking-[0.14em] text-[--color-brand]">
        <span className="h-px w-8 bg-[--color-gold]" />
        {eyebrow}
      </p>
      <h2 className="mt-4 max-w-2xl text-balance font-bold tracking-tight leading-[1.12] text-[--color-text-primary] text-[clamp(1.75rem,3.2vw,2.5rem)]">
        {title}
      </h2>
      {children && <p className="mt-4 max-w-xl text-ui-md leading-relaxed text-[--color-text-secondary]">{children}</p>}
    </Reveal>
  )
}

const DOCS = [
  { name: 'Purchase Request',      lines: [92, 70, 84], table: 4 },
  { name: 'Request for Quotation', lines: [88, 64],     table: 5 },
  { name: 'TWG Certificate',       lines: [94, 90, 76, 82, 58] },
  { name: 'Notice of Award',       lines: [90, 86, 72, 64] },
  { name: 'Purchase Order',        lines: [80, 66],     table: 4 },
]

// The forms the system prints, fanned out like papers on a desk once they scroll into view.
export function DocumentStack() {
  const [ref, inView] = useInView({ threshold: 0.35 })
  const mid = (DOCS.length - 1) / 2
  return (
    <div ref={ref} aria-hidden="true" className="relative mx-auto h-[300px] w-full max-w-[440px] scale-[0.7] sm:h-[380px] sm:scale-100">
      {DOCS.map((d, i) => {
        const fan = i - mid
        const spread = inView || reducedMotion()
        return (
          <div key={d.name}
            className="group absolute left-1/2 top-1/2 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{
              zIndex: i,
              transitionDelay: `${i * 70}ms`,
              transform: spread
                ? `translate(calc(-50% + ${fan * 58}px), calc(-50% + ${Math.abs(fan) * 12}px)) rotate(${fan * 5}deg)`
                : 'translate(-50%, -50%)',
            }}>
            <div className="relative h-[290px] w-[220px] rounded-md border border-[--color-border-strong] bg-[--color-surface] p-5 shadow-md transition-[transform,box-shadow] duration-200 group-hover:-translate-y-4 group-hover:shadow-lg">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[--color-text-muted]">NEMSU Cantilan</p>
              <p className="mt-1 text-ui-sm font-bold leading-tight text-[--color-text-primary]">{d.name}</p>
              <div className="mt-4 space-y-2">
                {d.lines.map((w, k) => <div key={k} className="h-1.5 rounded-full bg-[--color-border]" style={{ width: `${w}%` }} />)}
              </div>
              {d.table && (
                <div className="mt-4 border-t border-[--color-border-strong]">
                  {Array.from({ length: d.table }, (_, k) => (
                    <div key={k} className="flex gap-2 border-b border-[--color-border] py-1.5">
                      <div className="h-1.5 w-3/5 rounded-full bg-[--color-border]" />
                      <div className="ml-auto h-1.5 w-1/5 rounded-full bg-[--color-border]" />
                    </div>
                  ))}
                </div>
              )}
              <div className="absolute inset-x-5 bottom-5 flex justify-between gap-4">
                {[0, 1].map(k => (
                  <div key={k} className="flex-1">
                    <div className="h-px bg-[--color-border-strong]" />
                    <div className="mx-auto mt-1.5 h-1 w-2/3 rounded-full bg-[--color-border]" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

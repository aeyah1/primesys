import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'
import { ENTER, NAVY_BG } from '@/pages/landing/LandingParts'

function Brand() {
  return (
    <Link to="/" className="flex w-fit items-center gap-3">
      <img src="/nemsu-logo.png" alt="NEMSU seal" className="size-9 object-contain" />
      <span>
        <span className="block text-base font-bold leading-none tracking-tight text-white">PRimeSys</span>
        <span className="mt-1 block text-[11px] font-medium leading-none text-[--color-gold]">Procurement Management System</span>
      </span>
    </Link>
  )
}

// Eyebrow, headline and one line of text at the top of the brand panel.
export function PanelIntro({ eyebrow, title, children }) {
  return (
    <>
      <p className={`flex items-center gap-3 text-ui-xs font-semibold uppercase tracking-[0.16em] text-[--color-gold] ${ENTER}`}>
        <span className="h-px w-8 bg-[--color-gold]" />
        {eyebrow}
      </p>
      <h2 className={`mt-5 max-w-md text-balance font-bold leading-[1.1] tracking-[-0.02em] text-white text-[clamp(2rem,2.8vw,2.75rem)] ${ENTER}`}
        style={{ animationDelay: '80ms' }}>
        {title}
      </h2>
      <p className={`mt-4 max-w-md text-ui-md leading-relaxed text-white/65 ${ENTER}`} style={{ animationDelay: '160ms' }}>
        {children}
      </p>
    </>
  )
}

// Numbered steps joined by a line that draws itself in; the first `done` steps show a tick.
export function PanelSteps({ steps, done = 0 }) {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 250); return () => clearTimeout(t) }, [])
  return (
    <ol className="relative mt-10 max-w-md space-y-7">
      <span className={`absolute bottom-4 left-[17px] top-4 w-px origin-top bg-white/25 transition-transform duration-1000 ease-out motion-reduce:scale-y-100 motion-reduce:transition-none ${drawn ? 'scale-y-100' : 'scale-y-0'}`} />
      {steps.map((s, i) => (
        <li key={s.title} className={`relative flex gap-5 ${ENTER}`} style={{ animationDelay: `${300 + i * 150}ms` }}>
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-full border text-ui-sm font-bold transition-colors duration-500 ${
            i < done ? 'border-[--color-gold] bg-[--color-gold] text-[--sidebar-bg-top]' : 'border-white/25 bg-[--sidebar-bg-top] text-[--color-gold]'
          }`}>
            {i < done ? <Check className="size-4" /> : i + 1}
          </span>
          <div className="pt-1.5">
            <p className="text-ui-md font-semibold text-white">{s.title}</p>
            <p className="mt-1 text-pretty text-ui-sm leading-relaxed text-white/60">{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

// Split screen for sign-in and sign-up: navy brand panel on large screens, and a form side that scrolls on its own.
export default function AuthLayout({ panel, switchText, switchTo, switchLabel, wide = false, children }) {
  const switchLink = (
    <p className="text-ui-sm text-[--color-text-secondary]">
      {switchText}{' '}
      <Link to={switchTo} className="font-semibold text-[--color-brand] hover:underline">{switchLabel}</Link>
    </p>
  )

  return (
    <div className="flex h-screen bg-[--color-canvas]">
      <aside className="relative hidden w-[46%] max-w-[720px] shrink-0 overflow-hidden motion-safe:animate-fade-in lg:block" style={NAVY_BG}>
        <div className="pointer-events-none absolute -right-48 -top-48 size-[680px] rounded-full"
          style={{ background: 'radial-gradient(closest-side, hsl(var(--brand) / 0.45), transparent)' }} />
        <div className="relative flex h-full flex-col px-12 py-10 xl:px-16">
          <Brand />
          <div className="my-auto py-8">{panel}</div>
          <p className="text-ui-xs text-white/40">&copy; {new Date().getFullYear()} NEMSU Cantilan Campus</p>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col">
          <div className="px-6 py-4 lg:hidden" style={NAVY_BG}><Brand /></div>

          <div className="px-6 py-5 sm:px-10">
            <Link to="/" className="group inline-flex items-center gap-2 text-ui-sm font-medium text-[--color-text-secondary] transition-colors duration-200 hover:text-[--color-text-primary]">
              <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
              Back to home
            </Link>
          </div>

          <div className="flex flex-1 items-center justify-center px-6 pb-14 pt-2 sm:px-10">
            <div className={`w-full ${wide ? 'max-w-md' : 'max-w-sm'}`}>
              {children}
              {switchTo && <div className="mt-8 border-t border-[--color-border] pt-6 text-center">{switchLink}</div>}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

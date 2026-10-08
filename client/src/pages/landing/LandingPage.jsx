import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import {
  ArrowRight, UserRound, ClipboardCheck, Building2, Gavel, PackageCheck, ShieldCheck,
  Activity, Printer, CalendarRange, History, BellRing, BarChart3,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import HeroPreview from './HeroPreview'
import HowItWorks from './HowItWorks'
import { ENTER, NAVY_BG, Reveal, SectionHead, DocumentStack, reducedMotion } from './LandingParts'

const NAV = [
  { id: 'how',      label: 'How it works' },
  { id: 'roles',    label: 'Who uses it' },
  { id: 'features', label: 'Features' },
]

const ROLES = [
  { icon: UserRound,      name: 'End User',                  text: 'Files requests from the office PPMP and follows each one until it is delivered.' },
  { icon: ClipboardCheck, name: 'Technical Working Group',   text: 'Reviews requests in their assigned categories and certifies the offers suppliers send.' },
  { icon: Building2,      name: 'Procurement Office',        text: 'Starts the canvass, prints the Request for Quotation and issues the purchase orders.' },
  { icon: Gavel,          name: 'Bids and Awards Committee', text: 'Records the quotations and awards each lot to a supplier the TWG found compliant.' },
  { icon: PackageCheck,   name: 'Supply Office',             text: 'Receives what was ordered and records each delivery, item by item.' },
  { icon: ShieldCheck,    name: 'Administrator',             text: 'Manages accounts, roles, offices and signatories, and oversees the whole flow.' },
]

const FEATURES = [
  { icon: Activity,      title: 'Live status',          text: 'Changes appear without reloading. The next person is notified in the app, and by email for deliveries and reminders.' },
  { icon: Printer,       title: 'Forms ready to sign',  text: 'Purchase requests, RFQs, certificates, notices and purchase orders print straight from the record.' },
  { icon: CalendarRange, title: 'PPMP by quarter',      text: 'Requests draw on the office plan quarter by quarter, so nothing goes past what was planned.' },
  { icon: History,       title: 'Full history',         text: 'Every status change keeps who made it and when. Finished requests move to the Archive and stay there.' },
  { icon: BellRing,      title: 'Reminders',            text: 'Set a reminder on a request for yourself or a colleague. It arrives by email when it is due.' },
  { icon: BarChart3,     title: 'Reports and export',   text: 'Spending by quarter and category, filters for the whole year, and CSV export from the Archive.' },
]

// Header turns from navy to a light bar once the page scrolls past the top.
function useScrolled(ref) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => setScrolled(el.scrollTop > 24)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [ref])
  return scrolled
}

const scrollToId = id => document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' })

const NAVY_PRIMARY = 'bg-white text-[--sidebar-bg-top] hover:bg-white hover:shadow-lg hover:-translate-y-px shadow-md'
const NAVY_GHOST   = 'text-white border border-white/30 hover:bg-white/10 hover:text-white hover:border-white/50'

export default function LandingPage() {
  // Signed in already: offer the way back in, not a sign-in the user doesn't need.
  const { user } = useAuth()
  const containerRef = useRef(null)
  const scrolled = useScrolled(containerRef)

  const ctas = user ? (
    <Button asChild size="lg" className={`h-12 px-7 ${NAVY_PRIMARY}`}>
      <Link to="/dashboard">Go to dashboard <ArrowRight className="size-4" /></Link>
    </Button>
  ) : (
    <>
      <Button asChild size="lg" className={`h-12 px-7 ${NAVY_PRIMARY}`}>
        <Link to="/login">Sign in <ArrowRight className="size-4" /></Link>
      </Button>
      <Button asChild size="lg" variant="ghost" className={`h-12 px-7 ${NAVY_GHOST}`}>
        <Link to="/register">Create an account</Link>
      </Button>
    </>
  )

  return (
    <div ref={containerRef} className="h-screen overflow-y-auto overflow-x-hidden bg-[--color-canvas]">

      {/* Header */}
      <header className={`sticky top-0 z-50 border-b transition-[background-color,border-color,box-shadow] duration-300 ${
        scrolled ? 'border-[--color-border] shadow-sm backdrop-blur-md' : 'border-transparent bg-[--sidebar-bg-top]'
      }`} style={scrolled ? { background: 'color-mix(in srgb, var(--color-surface) 90%, transparent)' } : undefined}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-6 sm:px-8">
          <Link to="/" className="flex items-center gap-3">
            <img src="/nemsu-logo.png" alt="NEMSU seal" className="size-9 object-contain" />
            <span>
              <span className={`block text-base font-bold leading-none tracking-tight transition-colors duration-300 ${scrolled ? 'text-[--color-text-primary]' : 'text-white'}`}>PRimeSys</span>
              <span className={`mt-1 block text-[11px] font-medium leading-none transition-colors duration-300 ${scrolled ? 'text-[--color-text-muted]' : 'text-[--color-gold]'}`}>Procurement Management System</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map(n => (
              <button key={n.id} type="button" onClick={() => scrollToId(n.id)}
                className={`rounded-md px-3.5 py-2 text-ui-sm font-medium transition-colors duration-200 ${
                  scrolled ? 'text-[--color-text-secondary] hover:bg-[--color-overlay] hover:text-[--color-text-primary]' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}>
                {n.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {user ? (
              <Button asChild size="sm" className={scrolled ? '' : NAVY_PRIMARY}>
                <Link to="/dashboard">Go to dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className={scrolled ? '' : 'text-white hover:bg-white/10 hover:text-white'}>
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm" className={`hidden sm:inline-flex ${scrolled ? '' : NAVY_PRIMARY}`}>
                  <Link to="/register">Create an account</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden" style={NAVY_BG}>
        <div className="pointer-events-none absolute -right-48 top-0 size-[760px] rounded-full"
          style={{ background: 'radial-gradient(closest-side, hsl(var(--brand) / 0.45), transparent)' }} />
        <div className="relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl grid-cols-1 items-center gap-14 px-6 pb-20 pt-14 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pb-24 lg:pt-20">
          <div>
            <p className={`flex items-center gap-3 text-ui-xs font-semibold uppercase tracking-[0.16em] text-[--color-gold] ${ENTER}`}>
              <span className="h-px w-8 bg-[--color-gold]" />
              NEMSU Cantilan Campus
            </p>
            <h1 className={`mt-6 text-balance font-bold leading-[1.05] tracking-[-0.025em] text-white text-[clamp(2.5rem,5.2vw,4.25rem)] ${ENTER}`}
              style={{ animationDelay: '80ms' }}>
              Every purchase request, from PPMP to delivery.
            </h1>
            <p className={`mt-6 max-w-xl text-ui-md leading-relaxed text-white/70 ${ENTER}`} style={{ animationDelay: '160ms' }}>
              PRimeSys puts End Users, the TWG, the BAC, Procurement and Supply on the same record.
              Anyone involved can see where a request is, who has it now, and what happens next.
            </p>
            <div className={`mt-9 flex flex-wrap items-center gap-3 ${ENTER}`} style={{ animationDelay: '240ms' }}>
              {ctas}
            </div>
            {!user && (
              <p className={`mt-5 text-ui-sm text-white/50 ${ENTER}`} style={{ animationDelay: '320ms' }}>
                New accounts start as End User. The administrator assigns staff roles.
              </p>
            )}
          </div>

          <div className={ENTER} style={{ animationDelay: '300ms' }}>
            <HeroPreview />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-16 px-6 pb-24 pt-20 sm:px-8 lg:pb-28 lg:pt-24">
        <div className="mx-auto max-w-7xl">
          <HowItWorks />
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="scroll-mt-16 border-y border-[--color-border] bg-[--color-surface] px-6 py-24 sm:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionHead eyebrow="Who uses it" title="Six roles, each with its own desk">
            Everyone signs in to a dashboard for their part of the work and sees only the records that belong to it.
          </SectionHead>
          <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-[--color-border-strong] bg-[--color-border] sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map(({ icon: Icon, name, text }, i) => (
              <div key={name} className="group bg-[--color-surface] transition-colors duration-200 hover:bg-[--color-canvas]">
                <Reveal delay={i * 60} className="h-full p-7 sm:p-8">
                  <Icon className="size-5 text-[--color-brand] transition-transform duration-200 group-hover:-translate-y-0.5" />
                  <p className="mt-5 text-ui-md font-semibold text-[--color-text-primary]">{name}</p>
                  <p className="mt-2 text-ui-sm leading-relaxed text-[--color-text-secondary]">{text}</p>
                </Reveal>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-16 overflow-hidden px-6 py-24 sm:px-8 lg:py-32">
        <div className="mx-auto max-w-7xl">
          <SectionHead eyebrow="Features" title="The paperwork stays. The chasing stops.">
            Procurement still runs on signed forms. PRimeSys prints them from the record and keeps track of everything in between.
          </SectionHead>
          <div className="mt-16 grid grid-cols-1 items-center gap-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <DocumentStack />
            <div className="grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, text }, i) => (
                <Reveal key={title} delay={(i % 2) * 80 + Math.floor(i / 2) * 60} className="border-t border-[--color-border-strong] pt-5">
                  <Icon className="size-5 text-[--color-brand]" />
                  <p className="mt-3 text-ui-md font-semibold text-[--color-text-primary]">{title}</p>
                  <p className="mt-1.5 text-ui-sm leading-relaxed text-[--color-text-secondary]">{text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="relative overflow-hidden" style={NAVY_BG}>
        <div className="mx-auto flex max-w-7xl flex-col gap-10 px-6 py-20 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:py-24">
          <Reveal className="flex items-start gap-6">
            <img src="/nemsu-logo.png" alt="" className="hidden size-16 shrink-0 object-contain sm:block" />
            <div>
              <h2 className="max-w-xl text-balance font-bold leading-[1.15] tracking-tight text-white text-[clamp(1.75rem,3vw,2.5rem)]">
                {user ? 'Pick up where you left off.' : 'See where your requests stand.'}
              </h2>
              <p className="mt-3 max-w-lg text-ui-md leading-relaxed text-white/65">
                {user ? 'Your dashboard shows what is waiting on you today.' : 'Sign in with your PRimeSys account, or create one if you file requests for your office.'}
              </p>
            </div>
          </Reveal>
          <Reveal delay={100} className="flex flex-wrap gap-3">{ctas}</Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[--color-surface]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <img src="/nemsu-logo.png" alt="NEMSU seal" className="size-8 object-contain" />
            <div>
              <p className="font-bold leading-tight text-[--color-text-primary]">PRimeSys</p>
              <p className="mt-0.5 text-ui-xs text-[--color-text-muted]">Procurement Management System</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-ui-sm text-[--color-text-secondary]">
            {NAV.map(n => (
              <button key={n.id} type="button" onClick={() => scrollToId(n.id)} className="transition-colors duration-200 hover:text-[--color-brand]">{n.label}</button>
            ))}
            {user
              ? <Link to="/dashboard" className="transition-colors duration-200 hover:text-[--color-brand]">Dashboard</Link>
              : <Link to="/login" className="transition-colors duration-200 hover:text-[--color-brand]">Sign in</Link>}
          </nav>
          <p className="text-ui-sm text-[--color-text-muted]">&copy; {new Date().getFullYear()} NEMSU Cantilan Campus</p>
        </div>
      </footer>
    </div>
  )
}

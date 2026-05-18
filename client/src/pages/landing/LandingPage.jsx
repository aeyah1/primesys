import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Leaf, FileText, Gavel, Package, ArrowRight,
  Clock, Users, BarChart3, ChevronDown,
  CheckCircle2, Zap, ShieldCheck, Bell,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AnimatedNumber } from '@/animations'

/* ── data ─────────────────────────────────────────────────────── */

const FEATURES = [
  {
    icon: FileText,
    accent: 'from-blue-500 to-indigo-600',
    badge: 'bg-blue-100 text-blue-700',
    glow: 'hover:shadow-blue-100',
    label: 'PR Tracking',
    desc: 'Submit purchase requests and monitor every status change in real time — from draft to delivered.',
    large: true,
  },
  {
    icon: Gavel,
    accent: 'from-amber-500 to-orange-500',
    badge: 'bg-amber-100 text-amber-700',
    glow: 'hover:shadow-amber-100',
    label: 'Bidding Module',
    desc: 'Transparent supplier canvassing with bid logging, winner selection, and a full audit trail.',
  },
  {
    icon: Package,
    accent: 'from-teal-500 to-emerald-500',
    badge: 'bg-teal-100 text-teal-700',
    glow: 'hover:shadow-teal-100',
    label: 'Delivery Monitor',
    desc: 'Track purchase orders from issuance to receipt, with partial-delivery support.',
  },
  {
    icon: BarChart3,
    accent: 'from-violet-500 to-purple-600',
    badge: 'bg-violet-100 text-violet-700',
    glow: 'hover:shadow-violet-100',
    label: 'Reports & Analytics',
    desc: 'Quarterly spending breakdowns, PR status charts, and monthly trends — all exportable.',
    large: true,
  },
]

const STEPS = [
  { num: '01', label: 'Event Request',    desc: 'Extension officer submits an event request with items and estimated costs.' },
  { num: '02', label: 'Purchase Request', desc: 'Procurement consolidates requests into a formal purchase request.' },
  { num: '03', label: 'Lot & Award',      desc: 'Items grouped into lots, bids evaluated, winner recorded.' },
  { num: '04', label: 'Issue PO',         desc: 'Purchase order issued to the awarded contractor.' },
  { num: '05', label: 'Delivery',         desc: 'Goods received and confirmed — the cycle closes with an IAR.' },
]

const BENEFITS = [
  { icon: Zap,         label: 'Real-time updates',   desc: 'Every status change triggers instant in-app and email notifications to all stakeholders.' },
  { icon: ShieldCheck, label: 'Complete audit trail', desc: 'Every action is timestamped and tied to a user. Nothing gets lost or changed silently.' },
  { icon: Bell,        label: 'Smart reminders',      desc: 'Set deadline reminders on lots, POs, and deliveries. Get pinged before anything goes overdue.' },
]

const METRICS = [
  { value: 5,   suffix: '',   label: 'Workflow stages',      icon: CheckCircle2 },
  { value: 4,   suffix: '',   label: 'User roles supported', icon: Users },
  { value: 100, suffix: '%',  label: 'Digital — no paper',  icon: ShieldCheck },
  { value: 0,   suffix: '',   label: 'Manual follow-ups',   icon: Zap },
]

/* ── hooks ────────────────────────────────────────────────────── */

function useContainerScroll(ref) {
  const [scrolled,  setScrolled]  = useState(false)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handler = () => {
      setScrolled(el.scrollTop > 52)
      const max = el.scrollHeight - el.clientHeight
      setProgress(max > 0 ? (el.scrollTop / max) * 100 : 0)
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [ref])
  return { scrolled, progress }
}

/* ── Reveal ───────────────────────────────────────────────────── */

function Reveal({ children, from = 'bottom', delay = 0, className = '' }) {
  const ref  = useRef(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShow(true); obs.disconnect() } },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  const anims = {
    bottom: `fade-in-up 0.55s ${delay}ms cubic-bezier(0.22,1,0.36,1) both`,
    left:   `fade-in-right 0.55s ${delay}ms cubic-bezier(0.22,1,0.36,1) both`,
    right:  `fade-in-left 0.55s ${delay}ms cubic-bezier(0.22,1,0.36,1) both`,
    scale:  `scale-in 0.55s ${delay}ms cubic-bezier(0.22,1,0.36,1) both`,
  }
  return (
    <div ref={ref} className={className}
      style={show ? { animation: anims[from] } : { opacity: 0 }}>
      {children}
    </div>
  )
}

/* ── MetricCounter ────────────────────────────────────────────── */

function MetricCounter({ value, suffix, label, icon: Icon, delay }) {
  const ref = useRef(null)
  const [started, setStarted] = useState(false)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true)
          setTimeout(() => setStarted(true), delay)
          obs.disconnect()
        }
      },
      { threshold: 0.2 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [delay])
  return (
    <div ref={ref} className="flex flex-col items-center text-center"
      style={visible ? { animation: `fade-in-up 0.5s ${delay}ms ease-out both` } : { opacity: 0 }}>
      <div className="flex size-12 items-center justify-center rounded-2xl bg-white/10 mb-4">
        <Icon className="size-5 text-emerald-300" />
      </div>
      <div className="text-4xl font-bold text-white tabular-nums mb-1">
        {started
          ? <AnimatedNumber value={value} duration={1200} suffix={suffix} />
          : <span>0{suffix}</span>
        }
      </div>
      <p className="text-emerald-200/60 text-sm font-medium">{label}</p>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────────── */

export default function LandingPage() {
  const containerRef = useRef(null)
  const { scrolled, progress } = useContainerScroll(containerRef)

  return (
    <div ref={containerRef} className="h-screen overflow-y-auto flex flex-col bg-[--color-canvas]">

      {/* scroll progress */}
      <div className="fixed top-0 left-0 h-[3px] z-[100] pointer-events-none"
        style={{ width: `${progress}%`, background: 'linear-gradient(90deg, hsl(145,62%,45%), hsl(160,70%,60%))' }} />

      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 transition-all duration-300"
        style={scrolled
          ? { background: 'rgba(255,255,255,0.93)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--color-border)', boxShadow: '0 2px 16px rgba(15,74,34,0.07)' }
          : { background: 'transparent', borderBottom: '1px solid rgba(255,255,255,0.07)' }
        }>
        <div className="max-w-7xl mx-auto px-6 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3" style={{ animation: 'fade-in-right 0.45s ease-out both' }}>
            <div className={`flex size-9 items-center justify-center rounded-xl transition-all duration-300 ${scrolled ? 'bg-[--color-brand]' : 'bg-white/12'}`}>
              <Leaf className={`size-4 animate-float transition-colors duration-300 ${scrolled ? 'text-emerald-200' : 'text-emerald-300'}`} />
            </div>
            <div>
              <p className={`font-bold text-base leading-none tracking-tight transition-colors duration-300 ${scrolled ? 'text-[--color-text-primary]' : 'text-white'}`}>
                PRimeSys
              </p>
              <p className={`text-[10px] mt-0.5 leading-none transition-colors duration-300 ${scrolled ? 'text-[--color-text-muted]' : 'text-emerald-300/50'}`}>
                Alleah Carmel and Friends
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-2" style={{ animation: 'fade-in-left 0.45s 0.05s ease-out both' }}>
            <Button asChild variant="ghost" size="sm"
              className={scrolled ? '' : 'text-white/75 hover:text-white hover:bg-white/10'}>
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm"
              className={scrolled ? '' : 'bg-white text-[hsl(145,62%,18%)] hover:bg-white/92 font-bold shadow-lg shadow-black/20'}>
              <Link to="/register">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section
        className="relative flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] overflow-hidden px-6"
        style={{ background: 'linear-gradient(155deg, hsl(145,75%,8%) 0%, hsl(145,62%,15%) 55%, hsl(150,55%,20%) 100%)' }}
      >
        {/* dot grid */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle, hsl(145,70%,70%) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />

        {/* orbs */}
        <div className="pointer-events-none absolute -top-40 -left-40 size-[700px] rounded-full opacity-[0.13]"
          style={{ background: 'radial-gradient(circle, hsl(145,62%,45%) 0%, transparent 65%)', animation: 'float 9s ease-in-out infinite' }} />
        <div className="pointer-events-none absolute -bottom-48 -right-32 size-[600px] rounded-full opacity-[0.09]"
          style={{ background: 'radial-gradient(circle, hsl(160,58%,38%) 0%, transparent 65%)', animation: 'float 12s ease-in-out infinite reverse' }} />
        <div className="pointer-events-none absolute top-1/3 left-1/4 size-[350px] rounded-full opacity-[0.06]"
          style={{ background: 'radial-gradient(circle, hsl(145,50%,55%) 0%, transparent 65%)', animation: 'float 7s ease-in-out infinite 2s' }} />

        {/* content */}
        <div className="relative z-10 text-center max-w-4xl mx-auto py-16">
          <div className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.07] px-5 py-2 mb-10"
            style={{ animation: 'fade-in-down 0.5s ease-out both' }}>
            <span className="relative flex size-2">
              <span className="animate-ping absolute size-full rounded-full bg-emerald-400 opacity-70" />
              <span className="relative size-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-emerald-300/90 text-[11px] font-semibold tracking-[0.12em] uppercase">NEMSU Cantilan Campus</span>
          </div>

          <h1 className="font-bold text-white leading-[1.06] tracking-tight mb-7"
            style={{ fontSize: 'clamp(2.8rem, 7vw, 5.5rem)', animation: 'fade-in-up 0.55s 0.12s cubic-bezier(0.22,1,0.36,1) both' }}>
            Procurement,
            <br />
            <span style={{
              background: 'linear-gradient(105deg, hsl(145,68%,70%) 0%, hsl(162,62%,78%) 50%, hsl(145,62%,62%) 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>Start to Finish.</span>
          </h1>

          <p className="text-emerald-100/45 leading-relaxed mx-auto mb-10"
            style={{ fontSize: 'clamp(1rem, 2vw, 1.15rem)', maxWidth: '34rem', animation: 'fade-in-up 0.5s 0.24s cubic-bezier(0.22,1,0.36,1) both' }}>
            One platform for purchase requests, supplier bidding, purchase orders,
            and delivery monitoring — built for NEMSU.
          </p>

          <div className="flex items-center justify-center gap-3 flex-wrap mb-12"
            style={{ animation: 'fade-in-up 0.5s 0.36s cubic-bezier(0.22,1,0.36,1) both' }}>
            <Button asChild size="lg"
              className="h-12 px-8 text-[15px] bg-white text-[hsl(145,62%,16%)] hover:bg-white/94 font-bold shadow-2xl shadow-black/35">
              <Link to="/register">
                <span className="flex items-center gap-2">Get started free <ArrowRight className="size-4" /></span>
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost"
              className="h-12 px-8 text-[15px] text-white/80 hover:text-white hover:bg-white/10 border border-white/18">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2"
            style={{ animation: 'fade-in-up 0.5s 0.48s cubic-bezier(0.22,1,0.36,1) both' }}>
            {[
              { icon: FileText,    label: 'PR Tracking' },
              { icon: Gavel,       label: 'Bidding' },
              { icon: Package,     label: 'Delivery' },
              { icon: BarChart3,   label: 'Reports' },
              { icon: Users,       label: '4 Roles' },
              { icon: Clock,       label: 'Real-time' },
              { icon: ShieldCheck, label: 'Audit Trail' },
            ].map(({ icon: Icon, label }) => (
              <div key={label}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 hover:bg-white/12 hover:border-white/18 transition-all duration-200">
                <Icon className="size-3 text-emerald-400/75 shrink-0" />
                <span className="text-white/55 text-xs font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* stats strip */}
        <div className="relative z-10 w-full max-w-4xl mx-auto"
          style={{ animation: 'fade-in-up 0.5s 0.6s cubic-bezier(0.22,1,0.36,1) both' }}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.08] rounded-t-2xl overflow-hidden border border-white/[0.09] border-b-0">
            {[
              { label: 'Workflow Stages', value: '5',    icon: CheckCircle2 },
              { label: 'User Roles',      value: '4',    icon: Users },
              { label: 'Live Updates',    value: '∞',    icon: Zap },
              { label: 'Audit Trail',     value: '100%', icon: ShieldCheck },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-white/[0.05] px-6 py-5 text-center hover:bg-white/[0.09] transition-colors duration-200">
                <Icon className="size-4 text-emerald-400/65 mx-auto mb-1.5" />
                <p className="text-white font-bold text-xl">{value}</p>
                <p className="text-white/40 text-xs mt-0.5 font-medium">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* scroll hint */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 opacity-30"
          style={{ animation: 'fade-in-up 0.5s 1s ease-out both' }}>
          <span className="text-white text-[9px] uppercase tracking-[0.2em]">Scroll</span>
          <ChevronDown className="size-4 text-white animate-bounce" />
        </div>
      </section>

      {/* ── Features ── */}
      <section className="bg-[--color-canvas] py-28 px-6">
        <div className="max-w-7xl mx-auto">
          <Reveal className="text-center mb-16">
            <span className="inline-block rounded-full bg-[--color-brand-light] text-[--color-brand] text-xs font-bold uppercase tracking-[0.12em] px-4 py-1.5 mb-5">
              Core Modules
            </span>
            <h2 className="font-bold text-[--color-text-primary] tracking-tight mb-4"
              style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)' }}>
              Everything procurement needs
            </h2>
            <p className="text-[--color-text-secondary] text-base max-w-lg mx-auto leading-relaxed">
              Built specifically for campus procurement workflows — no bloat, no workarounds.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, accent, badge, glow, label, desc, large }, i) => (
              <Reveal key={label} delay={i * 85} className={large ? 'lg:col-span-2' : ''}>
                <div className={`group h-full rounded-2xl border border-[--color-border] bg-white p-7 hover:-translate-y-2 hover:shadow-xl ${glow} hover:border-transparent transition-all duration-300`}>
                  <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${accent} mb-5 shadow-md group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
                    <Icon className="size-5 text-white" />
                  </div>
                  <span className={`inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 mb-3 ${badge}`}>
                    {label}
                  </span>
                  <p className="text-[--color-text-muted] text-sm leading-relaxed">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Metrics ── */}
      <section className="py-24 px-6"
        style={{ background: 'linear-gradient(135deg, hsl(145,75%,8%) 0%, hsl(145,62%,15%) 100%)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-10">
            {METRICS.map(({ value, suffix, label, icon }, i) => (
              <MetricCounter key={label} value={value} suffix={suffix} label={label} icon={icon} delay={i * 100} />
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-[--color-surface] py-28 px-6">
        <div className="max-w-7xl mx-auto">
          <Reveal className="text-center mb-20">
            <span className="inline-block rounded-full bg-[--color-brand-light] text-[--color-brand] text-xs font-bold uppercase tracking-[0.12em] px-4 py-1.5 mb-5">
              Workflow
            </span>
            <h2 className="font-bold text-[--color-text-primary] tracking-tight mb-4"
              style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)' }}>
              How it works
            </h2>
            <p className="text-[--color-text-secondary] text-base max-w-sm mx-auto leading-relaxed">
              Five structured stages. Nothing falls through the cracks.
            </p>
          </Reveal>

          <div className="relative">
            <div className="hidden lg:block absolute top-[2.25rem] left-[10%] right-[10%] h-px"
              style={{ background: 'linear-gradient(90deg, transparent, var(--color-border) 15%, var(--color-border) 85%, transparent)' }} />
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-6 relative z-10">
              {STEPS.map(({ num, label, desc }, i) => (
                <Reveal key={num} delay={i * 90}>
                  <div className="group flex flex-col items-center text-center">
                    <div className="flex size-[4.5rem] items-center justify-center rounded-full bg-white border-2 border-[--color-border] mb-5 shadow-sm group-hover:border-[--color-brand]/50 group-hover:shadow-md group-hover:scale-110 transition-all duration-300">
                      <span className="text-[--color-brand] font-bold text-lg">{num}</span>
                    </div>
                    <p className="font-bold text-[--color-text-primary] text-sm mb-2">{label}</p>
                    <p className="text-[--color-text-muted] text-xs leading-relaxed">{desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Benefits ── */}
      <section className="bg-[--color-canvas] py-28 px-6">
        <div className="max-w-7xl mx-auto">
          <Reveal className="text-center mb-16">
            <span className="inline-block rounded-full bg-[--color-brand-light] text-[--color-brand] text-xs font-bold uppercase tracking-[0.12em] px-4 py-1.5 mb-5">
              Why PRimeSys
            </span>
            <h2 className="font-bold text-[--color-text-primary] tracking-tight mb-4"
              style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)' }}>
              Built for accountability
            </h2>
            <p className="text-[--color-text-secondary] text-base max-w-md mx-auto leading-relaxed">
              Every decision traces back to one principle — nothing gets lost, delayed, or disputed.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {BENEFITS.map(({ icon: Icon, label, desc }, i) => (
              <Reveal key={label} delay={i * 100}
                from={i === 0 ? 'left' : i === 2 ? 'right' : 'bottom'}>
                <div className="group h-full rounded-2xl border border-[--color-border] bg-white p-8 hover:-translate-y-1 hover:shadow-lg hover:border-[--color-brand]/20 transition-all duration-300">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-[--color-brand-light] mb-5 group-hover:scale-110 group-hover:bg-[--color-brand] transition-all duration-300">
                    <Icon className="size-5 text-[--color-brand] group-hover:text-white transition-colors duration-300" />
                  </div>
                  <p className="font-bold text-[--color-text-primary] text-base mb-2.5">{label}</p>
                  <p className="text-[--color-text-muted] text-sm leading-relaxed">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-6 bg-[--color-canvas]">
        <div className="max-w-7xl mx-auto">
          <Reveal from="scale">
            <div className="relative rounded-3xl overflow-hidden"
              style={{ background: 'linear-gradient(150deg, hsl(145,78%,7%) 0%, hsl(145,65%,14%) 50%, hsl(150,55%,18%) 100%)' }}>
              <div className="absolute inset-0 pointer-events-none opacity-[0.06]"
                style={{ backgroundImage: 'radial-gradient(circle, hsl(145,70%,70%) 1px, transparent 1px)', backgroundSize: '26px 26px' }} />
              <div className="pointer-events-none absolute -top-20 -right-16 size-72 rounded-full opacity-[0.12]"
                style={{ background: 'radial-gradient(circle, hsl(145,62%,45%) 0%, transparent 70%)', animation: 'float 8s ease-in-out infinite' }} />
              <div className="pointer-events-none absolute -bottom-20 -left-12 size-80 rounded-full opacity-[0.09]"
                style={{ background: 'radial-gradient(circle, hsl(160,58%,40%) 0%, transparent 70%)', animation: 'float 10s ease-in-out infinite reverse' }} />

              <div className="relative px-8 py-20 text-center">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-white/12 mx-auto mb-7">
                  <Leaf className="size-8 text-emerald-300 animate-float" />
                </div>
                <h2 className="font-bold text-white tracking-tight mb-5"
                  style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)' }}>
                  Ready to get started?
                </h2>
                <p className="text-emerald-100/45 text-base mb-10 max-w-lg mx-auto leading-relaxed">
                  Create your account and start managing procurement with full transparency,
                  accountability, and zero paperwork.
                </p>
                <div className="flex items-center justify-center gap-4 flex-wrap">
                  <Button asChild size="lg"
                    className="h-12 px-10 text-[15px] bg-white text-[hsl(145,62%,16%)] hover:bg-white/94 font-bold shadow-2xl shadow-black/35">
                    <Link to="/register">
                      <span className="flex items-center gap-2">Create free account <ArrowRight className="size-4" /></span>
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="ghost"
                    className="h-12 px-8 text-[15px] text-white/75 hover:text-white hover:bg-white/10 border border-white/18">
                    <Link to="/login">Sign in instead</Link>
                  </Button>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[--color-border] bg-[--color-canvas] mt-auto">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-[--color-brand]">
                <Leaf className="size-4 text-emerald-200" />
              </div>
              <div>
                <p className="font-bold text-[--color-text-primary] leading-tight">PRimeSys</p>
                <p className="text-[--color-text-muted] text-xs mt-0.5">Procurement Management System</p>
              </div>
            </div>
            <div className="flex items-center gap-8 text-sm text-[--color-text-muted]">
              <Link to="/login"    className="hover:text-[--color-brand] transition-colors">Sign in</Link>
              <Link to="/register" className="hover:text-[--color-brand] transition-colors">Register</Link>
            </div>
            <p className="text-[--color-text-muted] text-sm">&copy; {new Date().getFullYear()} NEMSU Cantilan Campus</p>
          </div>
        </div>
      </footer>

    </div>
  )
}

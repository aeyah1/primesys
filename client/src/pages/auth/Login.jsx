import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Leaf, Eye, EyeOff, AtSign, Lock,
  AlertCircle, Clock, ShieldAlert,
  FileText, Gavel, Package, BarChart3,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import api from '@/lib/axios'

const FEATURES = [
  { icon: FileText,  label: 'PR Tracking',      sub: 'Full lifecycle — draft to delivery' },
  { icon: Gavel,     label: 'Bidding Module',    sub: 'Transparent canvass & award' },
  { icon: Package,   label: 'Purchase Orders',   sub: 'Issuance, approval & tracking' },
  { icon: BarChart3, label: 'Reports',           sub: 'Quarterly analytics & exports' },
]

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm]         = useState({ identifier: '', password: '' })
  const [show, setShow]         = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    if (countdown <= 0) {
      clearInterval(timerRef.current)
      if (error?.type === 'lockout') setError(null)
      return
    }
    timerRef.current = setInterval(() => setCountdown(c => c - 1), 1000)
    return () => clearInterval(timerRef.current)
  }, [countdown])

  const handleChange = (field) => (e) => {
    setForm(p => ({ ...p, [field]: e.target.value }))
    if (error?.type === 'credentials') setError(null)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (countdown > 0) return
    setError(null)
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', form)
      login(data)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const res  = err.response
      const data = res?.data || {}
      if (res?.status === 429) {
        const secs = data.secondsLeft || 60
        setCountdown(secs)
        setError({ type: 'lockout', message: data.message, secondsLeft: secs })
      } else if (res?.status === 403 && data.type === 'unverified') {
        setError({ type: 'unverified', message: data.message, email: form.identifier })
      } else if (res?.status === 403) {
        setError({ type: 'inactive', message: data.message })
      } else if (res?.status === 401) {
        setError({
          type: 'credentials',
          message: data.message || 'Incorrect username or password.',
          attemptsLeft: data.attemptsLeft ?? null,
        })
      } else {
        setError({ type: 'server', message: 'Something went wrong. Please try again.' })
      }
    } finally {
      setLoading(false)
    }
  }

  const isLocked = countdown > 0

  return (
    <div className="min-h-screen flex bg-[--color-canvas]">

      {/* ── Brand panel ── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[44%] p-10 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, hsl(145,70%,11%) 0%, hsl(145,60%,19%) 100%)', animation: 'fade-in-right 0.45s ease-out both' }}
      >
        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-white/[0.03]" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-white/[0.03]" />
        <div className="pointer-events-none absolute top-1/3 right-0 w-px h-64 bg-gradient-to-b from-transparent via-white/10 to-transparent" />

        <div className="relative flex items-center gap-3" style={{ animation: 'fade-in-down 0.4s 0.1s ease-out both' }}>
          <div className="flex size-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
            <Leaf className="size-5 text-emerald-300 animate-float" />
          </div>
          <div>
            <p className="text-white font-bold text-lg leading-none tracking-tight">PRimeSys</p>
            <p className="text-emerald-300/70 text-xs mt-0.5">Procurement Management</p>
          </div>
        </div>

        <div className="relative space-y-8" style={{ animation: 'fade-in-up 0.45s 0.2s ease-out both' }}>
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 px-3 py-1 mb-5">
              <div className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-300 text-xs font-medium tracking-wide">NEMSU Cantilan Campus</span>
            </div>
            <h2 className="text-white font-bold leading-[1.15] mb-3 text-4xl">
              Streamlined<br />Procurement,<br />Start to Finish.
            </h2>
            <p className="text-emerald-100/50 leading-relaxed text-sm max-w-xs">
              One platform for purchase requests, bidding, purchase orders, and delivery monitoring.
            </p>
          </div>

          <div className="space-y-1">
            {FEATURES.map(({ icon: Icon, label, sub }, i) => (
              <div key={label} className="flex items-center gap-3 py-2.5 border-b border-white/8 last:border-0"
                style={{ animation: `fade-in-left 0.35s ${0.3 + i * 0.07}s ease-out both` }}>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="size-4 text-emerald-300/80" />
                </div>
                <div>
                  <p className="text-white text-sm font-semibold leading-none">{label}</p>
                  <p className="text-white/40 text-xs mt-1">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-white/20 text-xs">&copy; {new Date().getFullYear()} NEMSU Cantilan Campus</p>
      </div>

      {/* ── Form panel ── */}
      <div className="flex flex-1 flex-col justify-center p-8" style={{ animation: 'fade-in-left 0.45s 0.1s ease-out both' }}>
        <div className="w-full max-w-sm mx-auto py-8">

          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-xl bg-[--color-brand]">
              <Leaf className="size-4 text-emerald-200" />
            </div>
            <span className="font-bold text-xl text-[--color-text-primary] tracking-tight">PRimeSys</span>
          </div>

          <h1 className="font-bold text-[--color-text-primary] mb-1 text-2xl tracking-tight"
            style={{ animation: 'fade-in-up 0.35s 0.2s ease-out both' }}>
            Welcome back
          </h1>
          <p className="text-[--color-text-secondary] mb-8 text-sm"
            style={{ animation: 'fade-in-up 0.35s 0.27s ease-out both' }}>
            Sign in using your username and password
          </p>

          <form onSubmit={submit} className="space-y-4" style={{ animation: 'fade-in-up 0.35s 0.34s ease-out both' }}>

            <div className="space-y-1.5">
              <Label htmlFor="identifier">Username or Email</Label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                <Input
                  id="identifier"
                  type="text"
                  placeholder="Username or email address"
                  value={form.identifier}
                  onChange={handleChange('identifier')}
                  required autoFocus
                  autoComplete="username"
                  disabled={isLocked}
                  className={`pl-9 ${error?.type === 'credentials' ? 'border-red-400 focus-visible:ring-red-200' : ''}`}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-[--color-text-muted] hover:text-[--color-brand] transition-colors"
                  tabIndex={-1}
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                <Input
                  id="password"
                  type={show ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={form.password}
                  onChange={handleChange('password')}
                  required
                  autoComplete="current-password"
                  disabled={isLocked}
                  className={`pl-9 pr-10 ${error?.type === 'credentials' ? 'border-red-400 focus-visible:ring-red-200' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShow(p => !p)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[--color-text-muted] hover:text-[--color-text-primary] transition-colors"
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Error banners */}
            {error?.type === 'lockout' && (
              <div className="flex gap-3 items-start rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                <Clock className="size-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Too many failed attempts</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Please wait{' '}
                    <span className="font-bold tabular-nums">{countdown}s</span>
                    {' '}before trying again.
                  </p>
                </div>
              </div>
            )}

            {error?.type === 'credentials' && (
              <div className="flex gap-3 items-start rounded-xl border border-red-200 bg-red-50 p-3.5">
                <AlertCircle className="size-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Incorrect credentials</p>
                  <p className="text-xs text-red-700 mt-0.5">
                    {error.attemptsLeft != null && error.attemptsLeft > 0
                      ? <>The username or password you entered is wrong.{' '}
                          <span className="font-semibold">{error.attemptsLeft} attempt{error.attemptsLeft === 1 ? '' : 's'} left</span>
                          {' '}before a 2-minute lockout.</>
                      : 'The username or password you entered is wrong.'
                    }
                  </p>
                </div>
              </div>
            )}

            {error?.type === 'unverified' && (
              <div className="flex gap-3 items-start rounded-xl border border-blue-200 bg-blue-50 p-3.5">
                <ShieldAlert className="size-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-blue-800">Email not verified</p>
                  <p className="text-xs text-blue-700 mt-0.5">
                    Check your inbox for the verification link.{' '}
                    <button
                      type="button"
                      className="font-semibold underline hover:no-underline"
                      onClick={async () => {
                        try {
                          await api.post('/auth/resend-verification', { email: error.email })
                          setError(null)
                          window.alert('A new verification link has been sent to your email.')
                        } catch { /* silent */ }
                      }}
                    >
                      Resend link
                    </button>
                  </p>
                </div>
              </div>
            )}

            {error?.type === 'inactive' && (
              <div className="flex gap-3 items-start rounded-xl border border-orange-200 bg-orange-50 p-3.5">
                <ShieldAlert className="size-4 text-orange-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-orange-800">Account deactivated</p>
                  <p className="text-xs text-orange-700 mt-0.5">Your account has been deactivated. Contact your administrator.</p>
                </div>
              </div>
            )}

            {error?.type === 'server' && (
              <div className="flex gap-3 items-start rounded-xl border border-red-200 bg-red-50 p-3.5">
                <AlertCircle className="size-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Something went wrong</p>
                  <p className="text-xs text-red-700 mt-0.5">Unable to reach the server. Please try again in a moment.</p>
                </div>
              </div>
            )}

            <Button
              type="submit"
              className="w-full mt-2"
              disabled={loading || isLocked}
              size="lg"
            >
              {isLocked
                ? `Locked — wait ${countdown}s`
                : loading
                  ? 'Signing in…'
                  : 'Sign in'
              }
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-[--color-border] text-center space-y-2">
            <p className="text-[--color-text-secondary] text-sm">
              No account yet?{' '}
              <Link to="/register" className="text-[--color-brand] font-semibold hover:underline">
                Create one
              </Link>
            </p>
            <p>
              <Link to="/" className="text-[--color-text-muted] hover:text-[--color-brand] text-xs transition-colors">
                Back to home
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

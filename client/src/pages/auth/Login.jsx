import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, AtSign, Lock, AlertCircle, Clock, ShieldAlert, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import HeroPreview from '@/pages/landing/HeroPreview'
import { ENTER } from '@/pages/landing/LandingParts'
import AuthLayout, { PanelIntro } from './AuthLayout'
import api from '@/lib/axios'

const LOCKOUT_PAUSE_S = 30

// One banner per kind of failed sign-in; without `text` the server's message is shown.
const ALERTS = {
  lockout:     { icon: Clock,       tone: 'amber',  title: 'Too many sign-in attempts', text: 'Please wait a few minutes before trying again. Forgot your password? You can reset it.' },
  credentials: { icon: AlertCircle, tone: 'red',    title: "Couldn't sign you in" },
  pending:     { icon: Clock,       tone: 'blue',   title: 'Waiting for approval' },
  inactive:    { icon: ShieldAlert, tone: 'orange', title: 'Account deactivated', text: 'Your account has been deactivated. Contact your administrator.' },
  server:      { icon: AlertCircle, tone: 'red',    title: 'Something went wrong', text: 'Unable to reach the server. Please try again in a moment.' },
}

const TONES = {
  amber:  { box: 'border-amber-300 bg-amber-50',   icon: 'text-amber-600',  title: 'text-amber-800',  text: 'text-amber-700' },
  red:    { box: 'border-red-300 bg-red-50',       icon: 'text-red-600',    title: 'text-red-800',    text: 'text-red-700' },
  blue:   { box: 'border-blue-300 bg-blue-50',     icon: 'text-blue-600',   title: 'text-blue-800',   text: 'text-blue-700' },
  orange: { box: 'border-orange-300 bg-orange-50', icon: 'text-orange-600', title: 'text-orange-800', text: 'text-orange-700' },
}

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
        // The server doesn't say how long; pause the form briefly so a retry
        // isn't instant, then let the person try again.
        setCountdown(LOCKOUT_PAUSE_S)
        setError({ type: 'lockout', message: data.message })
      } else if (res?.status === 403 && data.type === 'pending') {
        setError({ type: 'pending', message: data.message })
      } else if (res?.status === 403) {
        setError({ type: 'inactive', message: data.message })
      } else if (res?.status === 401) {
        setError({ type: 'credentials', message: data.message || 'Invalid username/email or password.' })
      } else {
        setError({ type: 'server', message: 'Something went wrong. Please try again.' })
      }
    } finally {
      setLoading(false)
    }
  }

  const isLocked = countdown > 0
  const notice = error && ALERTS[error.type]
  const tone = notice && TONES[notice.tone]
  const badCredentials = error?.type === 'credentials' ? 'border-red-400 focus:border-red-400 focus:ring-red-200' : ''

  const panel = (
    <>
      <PanelIntro eyebrow="NEMSU Cantilan Campus" title="Pick up where your requests left off.">
        See what is waiting on you, and where every request you follow stands.
      </PanelIntro>
      <div className={`mt-10 hidden max-w-xl [@media(min-height:840px)]:block ${ENTER}`} style={{ animationDelay: '260ms' }}>
        <HeroPreview compact />
      </div>
    </>
  )

  return (
    <AuthLayout panel={panel} switchText="No account yet?" switchTo="/register" switchLabel="Create one">
      <h1 className={`text-ui-3xl font-bold tracking-tight text-[--color-text-primary] ${ENTER}`}>Sign in</h1>
      <p className={`mt-2 text-ui-base text-[--color-text-secondary] ${ENTER}`} style={{ animationDelay: '60ms' }}>
        Use your username or email and your password.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <div className={ENTER} style={{ animationDelay: '120ms' }}>
          <Label htmlFor="identifier">Username or Email</Label>
          <div className="relative">
            <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
            <Input
              id="identifier"
              type="text"
              placeholder="Username or email address"
              value={form.identifier}
              onChange={handleChange('identifier')}
              required autoFocus
              autoComplete="username"
              disabled={isLocked}
              className={`pl-10 ${badCredentials}`}
            />
          </div>
        </div>

        <div className={ENTER} style={{ animationDelay: '180ms' }}>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              to="/forgot-password"
              className="mb-1.5 text-ui-xs font-medium text-[--color-text-muted] transition-colors hover:text-[--color-brand]"
              tabIndex={-1}
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
            <Input
              id="password"
              type={show ? 'text' : 'password'}
              placeholder="Enter your password"
              value={form.password}
              onChange={handleChange('password')}
              required
              autoComplete="current-password"
              disabled={isLocked}
              className={`pl-10 pr-11 ${badCredentials}`}
            />
            <button
              type="button"
              onClick={() => setShow(p => !p)}
              tabIndex={-1}
              aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[--color-text-muted] transition-colors hover:text-[--color-text-primary]"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {notice && (
          <div role="alert" className={`flex items-start gap-3 rounded-md border p-3.5 motion-safe:animate-fade-in-down ${tone.box}`}>
            <notice.icon className={`mt-0.5 size-4 shrink-0 ${tone.icon}`} />
            <div>
              <p className={`text-ui-sm font-semibold ${tone.title}`}>{notice.title}</p>
              <p className={`mt-0.5 text-ui-xs ${tone.text}`}>{notice.text ?? error.message}</p>
            </div>
          </div>
        )}

        <div className={`pt-1 ${ENTER}`} style={{ animationDelay: '240ms' }}>
          <Button type="submit" size="lg" className="w-full" disabled={loading || isLocked}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            {isLocked ? `Please wait ${countdown}s` : loading ? 'Signing in' : 'Sign in'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  )
}

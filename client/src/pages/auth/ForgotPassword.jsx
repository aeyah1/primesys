import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, MailCheck, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ENTER } from '@/pages/landing/LandingParts'
import AuthLayout, { PanelIntro, PanelSteps } from './AuthLayout'
import api from '@/lib/axios'

// What resetting takes; the server keeps a link for one hour, single use, and a new request cancels older ones.
const RESET_STEPS = [
  { title: 'Enter your email',      text: 'Use the email address on your PRimeSys account.' },
  { title: 'Open the link we send', text: 'It works once, for one hour. Asking again cancels any older link.' },
  { title: 'Set a new password',    text: 'Choose one with at least 8 characters, then sign in with it.' },
]

export default function ForgotPassword() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const panel = (
    <>
      <PanelIntro eyebrow="Account help" title="Locked out? Get back in from your inbox.">
        The reset link goes to the email address on your account.
      </PanelIntro>
      <PanelSteps steps={RESET_STEPS} done={sent ? 1 : 0} />
    </>
  )

  if (sent) {
    return (
      <AuthLayout panel={panel}>
        <div className="text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-[--color-border-strong] bg-[--color-surface] shadow-sm motion-safe:animate-scale-in-fast">
            <MailCheck className="size-7 text-[--color-brand]" />
          </div>
          <h1 className={`mt-6 text-ui-3xl font-bold tracking-tight text-[--color-text-primary] ${ENTER}`} style={{ animationDelay: '80ms' }}>
            Check your email
          </h1>
          <p className={`mt-3 text-ui-base leading-relaxed text-[--color-text-secondary] ${ENTER}`} style={{ animationDelay: '140ms' }}>
            If an account matches <strong className="break-words text-[--color-text-primary]">{email}</strong>, we have
            sent a link to set a new password. It works for 1 hour.
          </p>
        </div>

        <div className={`mt-7 rounded-md border border-[--color-border-strong] bg-[--color-surface] px-4 py-3.5 text-ui-sm ${ENTER}`} style={{ animationDelay: '200ms' }}>
          <p className="font-semibold text-[--color-text-primary]">Nothing arrived?</p>
          <p className="mt-1 leading-relaxed text-[--color-text-secondary]">Check your spam folder, or wait a few minutes and try again.</p>
        </div>

        <div className={`mt-7 space-y-3 text-center ${ENTER}`} style={{ animationDelay: '260ms' }}>
          <Button asChild size="lg" className="w-full">
            <Link to="/login">Back to sign in</Link>
          </Button>
          <button type="button" onClick={() => setSent(false)}
            className="text-ui-sm font-semibold text-[--color-brand] transition-colors hover:underline">
            Use a different email
          </button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout panel={panel} switchText="Remembered it?" switchTo="/login" switchLabel="Sign in">
      <h1 className={`text-ui-3xl font-bold tracking-tight text-[--color-text-primary] ${ENTER}`}>Forgot your password?</h1>
      <p className={`mt-2 text-ui-base leading-relaxed text-[--color-text-secondary] ${ENTER}`} style={{ animationDelay: '60ms' }}>
        Enter the email address on your account and we'll send you a reset link.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <div className={ENTER} style={{ animationDelay: '120ms' }}>
          <Label htmlFor="email">Email address</Label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              required
              autoFocus
              autoComplete="email"
              className={`pl-10 ${error ? 'border-red-400 focus:border-red-400 focus:ring-red-200' : ''}`}
            />
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-3 rounded-md border border-red-300 bg-red-50 p-3.5 motion-safe:animate-fade-in-down">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
            <p className="text-ui-sm text-red-700">{error}</p>
          </div>
        )}

        <div className={`pt-1 ${ENTER}`} style={{ animationDelay: '180ms' }}>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading ? 'Sending' : 'Send reset link'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  )
}

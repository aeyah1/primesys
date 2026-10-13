import { useState, useEffect } from 'react'
import { MailCheck, AlertCircle, Loader2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { keepDeviceKey, forgetDeviceKey } from '@/lib/device'
import api from '@/lib/axios'

const RESEND_AFTER_S = 60

/* The second step of signing in on a browser the account hasn't verified: the 6-digit code emailed to it.
   challenge: { ticket, email, minutes } from POST /auth/login; onDone(data) gets the signed-in reply; onBack() starts over. */
export default function LoginCodeStep({ challenge, onDone, onBack }) {
  const [code, setCode]       = useState('')
  const [error, setError]     = useState(null)
  const [note, setNote]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [wait, setWait]       = useState(RESEND_AFTER_S)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(w => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const verify = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login/verify', { ticket: challenge.ticket, code })
      // A key comes back only when "Remember this device" was ticked.
      if (data.device) keepDeviceKey(data.device)
      else forgetDeviceKey()
      onDone(data)
    } catch (err) {
      const data = err.response?.data || {}
      setError({ message: data.message || 'Something went wrong. Please try again.', over: data.type === 'expired' || data.type === 'inactive' })
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  const resend = async () => {
    setError(null)
    try {
      const { data } = await api.post('/auth/login/resend', { ticket: challenge.ticket })
      setNote(data.message)
      setWait(RESEND_AFTER_S)
    } catch (err) {
      const data = err.response?.data || {}
      if (data.wait) setWait(data.wait)
      setError({ message: data.message || 'The code could not be sent. Please try again.', over: data.type === 'expired' })
    }
  }

  return (
    <form onSubmit={verify} className="mt-8 space-y-5">
      <div className="flex items-start gap-3 rounded-md border border-blue-300 bg-blue-50 p-3.5">
        <MailCheck className="mt-0.5 size-4 shrink-0 text-blue-600" />
        <div>
          <p className="text-ui-sm font-semibold text-blue-800">Check your email</p>
          <p className="mt-0.5 text-ui-xs text-blue-700">
            This browser hasn't been used with your account before, so we sent a 6-digit code to <strong>{challenge.email}</strong>.
            It works for {challenge.minutes} minutes. Not there? Check Spam.
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor="code">Sign-in code</Label>
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} placeholder="6-digit code"
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={error?.over}
          className="text-center text-lg font-semibold tracking-[0.5em]" />
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-md border border-red-300 bg-red-50 p-3.5">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
          <p className="text-ui-xs text-red-700">{error.message}</p>
        </div>
      )}
      {note && !error && <p className="text-ui-xs text-[--color-text-secondary]">{note}</p>}

      {error?.over ? (
        <Button type="button" size="lg" className="w-full" onClick={onBack}>Sign in again</Button>
      ) : (
        <Button type="submit" size="lg" className="w-full" disabled={loading || code.length !== 6}>
          {loading && <Loader2 className="size-4 animate-spin" />}
          {loading ? 'Checking' : 'Verify and sign in'}
        </Button>
      )}

      <div className="flex items-center justify-between text-ui-xs">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[--color-text-muted] transition-colors hover:text-[--color-text-primary]">
          <ArrowLeft className="size-3.5" /> Use another account
        </button>
        {!error?.over && (
          <button type="button" onClick={resend} disabled={wait > 0}
            className="font-medium text-[--color-brand] transition-colors hover:underline disabled:cursor-not-allowed disabled:text-[--color-text-muted] disabled:no-underline">
            {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          </button>
        )}
      </div>
    </form>
  )
}

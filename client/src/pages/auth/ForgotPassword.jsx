import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Leaf, AtSign, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import api from '@/lib/axios'

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

  return (
    <div className="min-h-screen flex flex-col justify-center bg-[--color-canvas] p-6">
      <div className="w-full max-w-sm mx-auto py-8">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[--color-brand]">
            <Leaf className="size-4 text-emerald-200" />
          </div>
          <span className="font-bold text-xl text-[--color-text-primary] tracking-tight">PRimeSys</span>
        </div>

        {sent ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center space-y-3">
            <CheckCircle2 className="size-10 text-emerald-600 mx-auto" />
            <h2 className="font-bold text-lg text-emerald-900">Check your email</h2>
            <p className="text-sm text-emerald-800 leading-relaxed">
              If <strong>{email}</strong> is registered, you'll receive a password reset link shortly.
              The link expires in 1 hour.
            </p>
            <Link
              to="/login"
              className="inline-block mt-2 text-sm font-semibold text-[--color-brand] hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-bold text-2xl text-[--color-text-primary] mb-1 tracking-tight">
              Forgot your password?
            </h1>
            <p className="text-sm text-[--color-text-secondary] mb-8 leading-relaxed">
              Enter the email address on your account and we'll send you a reset link.
            </p>

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <div className="relative">
                  <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError('') }}
                    required
                    autoFocus
                    className="pl-9"
                  />
                </div>
              </div>

              {error && (
                <div className="flex gap-3 items-start rounded-xl border border-red-200 bg-red-50 p-3.5">
                  <AlertCircle className="size-4 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <Button type="submit" className="w-full mt-2" size="lg" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-[--color-border] text-center">
              <Link to="/login" className="text-sm text-[--color-text-muted] hover:text-[--color-brand] transition-colors">
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

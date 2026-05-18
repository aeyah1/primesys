import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { Leaf, Lock, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import api from '@/lib/axios'

export default function ResetPassword() {
  const [params]   = useSearchParams()
  const navigate   = useNavigate()
  const token      = params.get('token') || ''

  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [show, setShow]           = useState(false)
  const [loading, setLoading]     = useState(false)
  const [done, setDone]           = useState(false)
  const [error, setError]         = useState('')

  if (!token) {
    return (
      <div className="min-h-screen flex flex-col justify-center bg-[--color-canvas] p-6">
        <div className="text-center space-y-3 mx-auto">
          <AlertCircle className="size-10 text-red-500 mx-auto" />
          <p className="font-semibold text-[--color-text-primary]">Invalid reset link</p>
          <Link to="/forgot-password" className="text-sm text-[--color-brand] hover:underline">
            Request a new one
          </Link>
        </div>
      </div>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, password })
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. The link may have expired.')
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

        {done ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center space-y-3">
            <CheckCircle2 className="size-10 text-emerald-600 mx-auto" />
            <h2 className="font-bold text-lg text-emerald-900">Password reset!</h2>
            <p className="text-sm text-emerald-800">
              Your password has been updated. Redirecting you to sign in…
            </p>
          </div>
        ) : (
          <>
            <h1 className="font-bold text-2xl text-[--color-text-primary] mb-1 tracking-tight">
              Set a new password
            </h1>
            <p className="text-sm text-[--color-text-secondary] mb-8">
              Choose a strong password for your account.
            </p>

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                  <Input
                    id="password"
                    type={show ? 'text' : 'password'}
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError('') }}
                    required
                    autoFocus
                    className="pl-9 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[--color-text-muted] hover:text-[--color-text-primary] transition-colors"
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm new password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                  <Input
                    id="confirm"
                    type={show ? 'text' : 'password'}
                    placeholder="Repeat your password"
                    value={confirm}
                    onChange={e => { setConfirm(e.target.value); setError('') }}
                    required
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
                {loading ? 'Resetting…' : 'Reset password'}
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

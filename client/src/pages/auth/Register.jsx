import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Leaf, Eye, EyeOff, User, AtSign, Lock, Mail,
  ShieldCheck, ClipboardCheck, Package, Truck,
  CheckCircle, XCircle, MailCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import api from '@/lib/axios'

const ROLES = [
  {
    value: 'procurement',
    icon: ClipboardCheck,
    label: 'Procurement Staff',
    desc: 'Submit PRs, manage bidding, purchase orders, and delivery',
  },
  {
    value: 'extension',
    icon: Package,
    label: 'Extension Officer',
    desc: 'Submit event requests and monitor their procurement status',
  },
  {
    value: 'supply',
    icon: Truck,
    label: 'Supply Officer',
    desc: 'Receive deliveries, confirm goods receipt, and monitor POs',
  },
]

export default function Register() {
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', confirm: '', role: 'extension' })
  const [show, setShow] = useState({ pw: false, confirm: false })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(null)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const pwMatch   = form.confirm.length > 0 && form.password === form.confirm
  const pwNoMatch = form.confirm.length > 0 && form.password !== form.confirm

  const submit = async (e) => {
    e.preventDefault()
    if (form.password.length < 6)       { toast.error('Password must be at least 6 characters'); return }
    if (form.password !== form.confirm)  { toast.error('Passwords do not match'); return }
    if (!/^[a-zA-Z0-9_]+$/.test(form.username)) {
      toast.error('Username may only contain letters, numbers, and underscores')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/register', {
        name: form.name,
        username: form.username,
        email: form.email,
        password: form.password,
        role: form.role,
      })
      setDone(form.email)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

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

        <div className="relative space-y-7" style={{ animation: 'fade-in-up 0.45s 0.2s ease-out both' }}>
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 px-3 py-1 mb-5">
              <div className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-300 text-xs font-medium tracking-wide">NEMSU Cantilan Campus</span>
            </div>
            <h2 className="text-white font-bold leading-[1.15] mb-3 text-4xl">
              Create your<br />account.
            </h2>
            <p className="text-emerald-100/50 leading-relaxed text-sm max-w-xs">
              Choose your role carefully — it determines what you can access and manage within the system.
            </p>
          </div>

          {/* Role cards */}
          <div className="space-y-2">
            <p className="text-white/35 text-xs font-semibold uppercase tracking-wider mb-3">Available roles</p>
            {ROLES.map(({ value, icon: Icon, label, desc }, i) => (
              <div
                key={value}
                onClick={() => set('role', value)}
                style={{ animation: `fade-in-left 0.35s ${0.3 + i * 0.07}s ease-out both` }}
                className={`flex items-start gap-3 rounded-xl p-3.5 border cursor-pointer transition-all duration-[180ms] ${
                  form.role === value
                    ? 'bg-white/20 border-white/40 shadow-sm'
                    : 'bg-white/[0.06] border-white/10 hover:bg-white/12 hover:border-white/20'
                }`}
              >
                <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg mt-0.5 transition-colors ${
                  form.role === value ? 'bg-white/25' : 'bg-white/10'
                }`}>
                  <Icon className={`size-4 transition-colors ${form.role === value ? 'text-white' : 'text-white/60'}`} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className={`text-sm font-semibold transition-colors ${form.role === value ? 'text-white' : 'text-white/80'}`}>
                      {label}
                    </p>
                    {form.role === value && (
                      <div className="size-1.5 rounded-full bg-emerald-400" />
                    )}
                  </div>
                  <p className="text-white/45 text-xs mt-0.5 leading-snug">{desc}</p>
                </div>
              </div>
            ))}

            {/* Admin — locked */}
            <div className="flex items-start gap-3 rounded-xl p-3.5 border border-white/[0.07] bg-white/[0.03] opacity-60">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] mt-0.5">
                <ShieldCheck className="size-4 text-white/30" />
              </div>
              <div>
                <p className="text-white/35 text-sm font-semibold">Admin</p>
                <p className="text-white/25 text-xs mt-0.5 leading-snug">Assigned by system administrator only</p>
              </div>
            </div>
          </div>
        </div>

        <p className="relative text-white/20 text-xs">&copy; {new Date().getFullYear()} NEMSU Cantilan Campus</p>
      </div>

      {/* ── Form panel ── */}
      <div className="flex flex-1 items-center justify-center p-8 overflow-y-auto" style={{ animation: 'fade-in-left 0.45s 0.1s ease-out both' }}>
        <div className="w-full max-w-sm py-4">

          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-xl bg-[--color-brand]">
              <Leaf className="size-4 text-emerald-200" />
            </div>
            <span className="font-bold text-xl text-[--color-text-primary] tracking-tight">PRimeSys</span>
          </div>

          <h1 className="font-bold text-[--color-text-primary] mb-1 text-2xl tracking-tight"
            style={{ animation: 'fade-in-up 0.35s 0.2s ease-out both' }}>
            Create account
          </h1>
          <p className="text-[--color-text-secondary] mb-8 text-sm"
            style={{ animation: 'fade-in-up 0.35s 0.27s ease-out both' }}>
            Fill in your details to get started
          </p>

          <form onSubmit={submit} className="space-y-4" style={{ animation: 'fade-in-up 0.35s 0.34s ease-out both' }}>

            <div className="space-y-1.5">
              <Label htmlFor="name">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                <Input
                  id="name"
                  type="text"
                  placeholder="Juan dela Cruz"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  required autoFocus
                  autoComplete="name"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                <Input
                  id="username"
                  type="text"
                  placeholder="juan_delacruz"
                  value={form.username}
                  onChange={e => set('username', e.target.value)}
                  required
                  autoComplete="username"
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-[--color-text-muted]">Letters, numbers, and underscores only — used to sign in</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@nemsu.edu.ph"
                  value={form.email}
                  onChange={e => set('email', e.target.value)}
                  required
                  autoComplete="email"
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-[--color-text-muted]">A verification link will be sent here to activate your account</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                <Input
                  id="password"
                  type={show.pw ? 'text' : 'password'}
                  placeholder="At least 6 characters"
                  value={form.password}
                  onChange={e => set('password', e.target.value)}
                  required
                  autoComplete="new-password"
                  className="pl-9 pr-10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShow(p => ({ ...p, pw: !p.pw }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[--color-text-muted] hover:text-[--color-text-primary] transition-colors"
                >
                  {show.pw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                <Input
                  id="confirm"
                  type={show.confirm ? 'text' : 'password'}
                  placeholder="Re-enter your password"
                  value={form.confirm}
                  onChange={e => set('confirm', e.target.value)}
                  required
                  autoComplete="new-password"
                  className={`pl-9 pr-10 ${pwNoMatch ? 'border-red-400 focus-visible:ring-red-300' : pwMatch ? 'border-emerald-400 focus-visible:ring-emerald-200' : ''}`}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShow(p => ({ ...p, confirm: !p.confirm }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[--color-text-muted] hover:text-[--color-text-primary] transition-colors"
                >
                  {show.confirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {pwNoMatch && (
                <p className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
                  <XCircle className="size-3.5 shrink-0" /> Passwords do not match
                </p>
              )}
              {pwMatch && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                  <CheckCircle className="size-3.5 shrink-0" /> Passwords match
                </p>
              )}
            </div>

            {/* Mobile role selector */}
            <div className="space-y-2 lg:hidden">
              <Label>Role</Label>
              <div className="space-y-2">
                {ROLES.map(({ value, icon: Icon, label, desc }) => (
                  <div
                    key={value}
                    onClick={() => set('role', value)}
                    className={`flex items-center gap-3 rounded-xl p-3 border cursor-pointer transition-all ${
                      form.role === value
                        ? 'border-[--color-brand] bg-[--color-brand-light]'
                        : 'border-[--color-border] hover:border-[--color-brand]/40'
                    }`}
                  >
                    <div className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
                      form.role === value ? 'bg-[--color-brand]' : 'bg-[--color-surface-raised]'
                    }`}>
                      <Icon className={`size-3.5 ${form.role === value ? 'text-white' : 'text-[--color-text-muted]'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[--color-text-primary]">{label}</p>
                      <p className="text-xs text-[--color-text-muted] leading-snug">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button
              type="submit"
              className="w-full mt-2"
              disabled={loading || pwNoMatch}
              size="lg"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-[--color-border] text-center space-y-2">
            <p className="text-[--color-text-secondary] text-sm">
              Already have an account?{' '}
              <Link to="/login" className="text-[--color-brand] font-semibold hover:underline">
                Sign in
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

      {/* Verification pending dialog */}
      <Dialog open={!!done} onOpenChange={(open) => { if (!open) setDone(null) }}>
        <DialogContent className="max-w-sm text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-50 border border-emerald-200 mx-auto mb-1">
            <MailCheck className="size-7 text-emerald-600" />
          </div>
          <h2 className="text-lg font-bold text-[--color-text-primary]">Check your inbox</h2>
          <p className="text-sm text-[--color-text-secondary] leading-relaxed">
            We sent a verification link to{' '}
            <strong className="text-[--color-text-primary] break-all">{done}</strong>.
            Click it to activate your account — the link expires in 24 hours.
          </p>
          <p className="text-xs text-[--color-text-muted]">
            Didn't receive it? Check your spam folder, or{' '}
            <button
              type="button"
              onClick={async () => {
                try {
                  await api.post('/auth/resend-verification', { email: done })
                  toast.success('A new verification link has been sent.')
                } catch { toast.error('Could not resend. Please try again.') }
              }}
              className="text-[--color-brand] font-medium hover:underline"
            >
              resend the email
            </button>.
          </p>
          <Link
            to="/login"
            className="inline-block w-full rounded-lg bg-[--color-brand] text-white text-sm font-semibold py-2.5 hover:opacity-90 transition-opacity mt-1"
          >
            Back to sign in
          </Link>
        </DialogContent>
      </Dialog>

    </div>
  )
}

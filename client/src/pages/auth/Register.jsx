import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Eye, EyeOff, User, AtSign, Lock, Mail,
  FileText, Bell, ClipboardCheck,
  CheckCircle, XCircle, MailCheck, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import CaptchaField, { captchaEnabled } from '@/components/shared/CaptchaField'
import api from '@/lib/axios'

// What a new (Requestor) account can do. Other roles are assigned by an admin.
const REQUESTOR_CAN = [
  { icon: FileText,       label: 'File purchase requests', desc: 'For personal, event, office, or project needs' },
  { icon: ClipboardCheck, label: 'Follow every step',      desc: 'From TWG review to delivery' },
  { icon: Bell,           label: 'Get notified',           desc: 'When your request moves or needs changes' },
]

const EMPTY = { first_name: '', last_name: '', username: '', email: '', password: '', confirm: '', website: '', captcha: '' }

export default function Register() {
  const [form, setForm] = useState(EMPTY)
  const [show, setShow] = useState({ pw: false, confirm: false })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  // Email domains the server accepts for sign-up ([] = any).
  const [domains, setDomains] = useState([])
  useEffect(() => {
    api.get('/auth/registration-info').then(r => setDomains(r.data?.email_domains || [])).catch(() => {})
  }, [])
  const domainList = domains.map(d => '@' + d).join(' or ')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const onCaptcha = useCallback((token) => setForm(p => ({ ...p, captcha: token })), [])

  const pwMatch   = form.confirm.length > 0 && form.password === form.confirm
  const pwNoMatch = form.confirm.length > 0 && form.password !== form.confirm

  const submit = async (e) => {
    e.preventDefault()
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(form.username)) {
      toast.error('Username must be 3 to 30 letters, numbers, or underscores')
      return
    }
    if (domains.length && !domains.includes(form.email.split('@').pop().toLowerCase())) {
      toast.error(`Please sign up with your NEMSU email address (ending in ${domainList})`)
      return
    }
    if (form.password.length < 8)       { toast.error('Password must be at least 8 characters'); return }
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return }
    if (captchaEnabled && !form.captcha) { toast.error('Please complete the verification challenge'); return }
    setLoading(true)
    try {
      // No role is sent: every new account is a Requestor, decided by the server.
      await api.post('/auth/register', {
        first_name:       form.first_name,
        last_name:        form.last_name,
        username:         form.username,
        email:            form.email,
        password:         form.password,
        confirm_password: form.confirm,
        website:          form.website,
        ...(captchaEnabled && { captcha_token: form.captcha }),
      })
      setDone(form.email)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Registration failed')
      if (captchaEnabled) { setForm(p => ({ ...p, captcha: '' })); setCaptchaKey(k => k + 1) }   // tokens are single use
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen flex bg-[--color-canvas]">

      {/* ── Brand panel ── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[44%] p-10 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, hsl(225,75%,10%) 0%, hsl(222,65%,22%) 100%)', animation: 'fade-in-right 0.45s ease-out both' }}
      >
        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-white/[0.03]" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-white/[0.03]" />
        <div className="pointer-events-none absolute top-1/3 right-0 w-px h-64 bg-gradient-to-b from-transparent via-white/10 to-transparent" />

        <div className="relative flex items-center gap-3" style={{ animation: 'fade-in-down 0.4s 0.1s ease-out both' }}>
          <div className="flex size-11 items-center justify-center rounded-xl bg-white/95 shadow-md">
            <img src="/nemsu-logo.png" alt="NEMSU seal" className="size-9 object-contain" />
          </div>
          <div>
            <p className="text-white font-bold text-lg leading-none tracking-tight">PRimeSys</p>
            <p className="text-[#ECB22E]/85 text-xs mt-0.5">Procurement Management</p>
          </div>
        </div>

        <div className="relative space-y-7" style={{ animation: 'fade-in-up 0.45s 0.2s ease-out both' }}>
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 px-3 py-1 mb-5">
              <div className="size-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-blue-300 text-xs font-medium tracking-wide">NEMSU-Cantilan</span>
            </div>
            <h2 className="text-white font-bold leading-[1.15] mb-3 text-4xl">
              Create your<br />account.
            </h2>
            <p className="text-blue-100/50 leading-relaxed text-sm max-w-xs">
              Sign up to file purchase requests and follow them through to delivery.
            </p>
          </div>

          <div className="space-y-2">
            {REQUESTOR_CAN.map(({ icon: Icon, label, desc }, i) => (
              <div
                key={label}
                style={{ animation: `fade-in-left 0.35s ${0.3 + i * 0.07}s ease-out both` }}
                className="flex items-start gap-3 rounded-xl p-3.5 border border-white/10 bg-white/[0.06]"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg mt-0.5 bg-white/10">
                  <Icon className="size-4 text-white/70" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white/85">{label}</p>
                  <p className="text-white/45 text-xs mt-0.5 leading-snug">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-white/20 text-xs">&copy; {new Date().getFullYear()} NEMSU Cantilan Campus</p>
      </div>

      {/* ── Form panel ── */}
      {/* Own scroll container: index.css sets html/body to overflow:hidden, and on
          mobile the form is taller than the viewport, so this panel scrolls itself. */}
      <div className="flex-1 overflow-y-auto" style={{ animation: 'fade-in-left 0.45s 0.1s ease-out both' }}>
        <div className="min-h-full flex flex-col px-6 py-10 lg:justify-center lg:p-8">
        <div className="w-full max-w-sm mx-auto py-8">

          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-xl bg-white border border-[--color-border] shadow-sm">
              <img src="/nemsu-logo.png" alt="NEMSU seal" className="size-7 object-contain" />
            </div>
            <div>
              <span className="block font-bold text-xl text-[--color-text-primary] tracking-tight leading-none">PRimeSys</span>
              <span className="block text-xs text-[--color-text-muted] mt-0.5">NEMSU-Cantilan</span>
            </div>
          </div>

          <h1 className="font-bold text-[--color-text-primary] mb-1 text-2xl tracking-tight"
            style={{ animation: 'fade-in-up 0.35s 0.2s ease-out both' }}>
            Create Account
          </h1>
          <p className="text-[--color-text-secondary] mb-8 text-sm"
            style={{ animation: 'fade-in-up 0.35s 0.27s ease-out both' }}>
            Fill in your details to get started
          </p>

          <form onSubmit={submit} className="space-y-4" style={{ animation: 'fade-in-up 0.35s 0.34s ease-out both' }}>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="first_name">First Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                  <Input
                    id="first_name"
                    type="text"
                    placeholder="Juan"
                    value={form.first_name}
                    onChange={e => set('first_name', e.target.value)}
                    required autoFocus maxLength={50}
                    autoComplete="given-name"
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="last_name">Last Name</Label>
                <Input
                  id="last_name"
                  type="text"
                  placeholder="dela Cruz"
                  value={form.last_name}
                  onChange={e => set('last_name', e.target.value)}
                  required maxLength={50}
                  autoComplete="family-name"
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
                  required maxLength={30}
                  autoComplete="username"
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-[--color-text-muted]">3 to 30 letters, numbers, or underscores. You can sign in with it.</p>
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
                  required maxLength={150}
                  autoComplete="email"
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-[--color-text-muted]">
                {domains.length
                  ? `Use your NEMSU email address (ending in ${domainList}). A verification link will be sent there.`
                  : 'A verification link will be sent here to activate your account'}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]" />
                <Input
                  id="password"
                  type={show.pw ? 'text' : 'password'}
                  placeholder="At least 8 characters"
                  value={form.password}
                  onChange={e => set('password', e.target.value)}
                  required minLength={8} maxLength={72}
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
                  required maxLength={72}
                  autoComplete="new-password"
                  className={`pl-9 pr-10 ${pwNoMatch ? 'border-red-400 focus-visible:ring-red-300' : pwMatch ? 'border-blue-400 focus-visible:ring-blue-200' : ''}`}
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
                <p className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                  <CheckCircle className="size-3.5 shrink-0" /> Passwords match
                </p>
              )}
            </div>

            {/* Honeypot: invisible to people and screen readers, so only a bot fills it in. */}
            <div aria-hidden="true" className="absolute -left-[10000px] top-auto size-px overflow-hidden">
              <label htmlFor="website">Website</label>
              <input
                id="website" name="website" type="text" tabIndex={-1} autoComplete="off"
                value={form.website} onChange={e => set('website', e.target.value)}
              />
            </div>

            <CaptchaField key={captchaKey} onToken={onCaptcha} />

            <Button
              type="submit"
              className="w-full mt-2"
              disabled={loading || pwNoMatch}
              size="lg"
            >
              {loading ? 'Creating account…' : 'Create Account'}
            </Button>

            <div className="flex items-start gap-2 rounded-lg border border-[--color-border] bg-[--color-surface] px-3 py-2.5 text-xs text-[--color-text-secondary] leading-snug">
              <Info className="size-3.5 shrink-0 mt-0.5 text-[--color-text-muted]" />
              <div className="space-y-1">
                <p>New accounts are registered as Requestors. Other system roles are assigned by authorized administrators.</p>
                <p>Accounts are for NEMSU faculty and staff. Students and outside partners can ask their adviser or the office concerned to file a request for them.</p>
              </div>
            </div>
          </form>

          <div className="mt-6 pt-6 border-t border-[--color-border] text-center space-y-2">
            <p className="text-[--color-text-secondary] text-sm">
              Already have an account?{' '}
              <Link to="/login" className="text-[--color-brand] font-semibold hover:underline">
                Sign In
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

      {/* Verification pending dialog */}
      <Dialog open={!!done} onOpenChange={(open) => { if (!open) setDone(null) }}>
        <DialogContent className="max-w-sm text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-50 border border-blue-200 mx-auto mb-1">
            <MailCheck className="size-7 text-blue-600" />
          </div>
          <h2 className="text-lg font-bold text-[--color-text-primary]">Check your inbox</h2>
          {/* Same text for new and existing emails: the server reply is identical on purpose. */}
          <p className="text-sm text-[--color-text-secondary] leading-relaxed">
            We sent an email to{' '}
            <strong className="text-[--color-text-primary] break-all">{done}</strong>.
            Follow it to finish signing up. Verification links expire in 24 hours.
          </p>
          <p className="text-xs text-[--color-text-secondary]">
            Already have an account?{' '}
            <Link to="/login" className="text-[--color-brand] font-medium hover:underline">Sign in</Link>
            , or{' '}
            <Link to="/forgot-password" className="text-[--color-brand] font-medium hover:underline">reset your password</Link>.
          </p>
          <p className="text-xs text-[--color-text-muted]">
            Didn't receive it? Check your spam folder, or{' '}
            <button
              type="button"
              onClick={async () => {
                try {
                  await api.post('/auth/resend-verification', { identifier: done })
                  toast.success('If your account still needs verifying, a new link is on its way.')
                } catch (err) { toast.error(err.response?.data?.message || 'Could not resend. Please try again.') }
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

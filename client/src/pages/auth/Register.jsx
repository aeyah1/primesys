import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Eye, EyeOff, AtSign, Lock, Mail, Building2,
  CheckCircle, Circle, XCircle, Clock, Info, Loader2,
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import CaptchaField, { captchaEnabled } from '@/components/shared/CaptchaField'
import { ENTER } from '@/pages/landing/LandingParts'
import AuthLayout, { PanelIntro, PanelSteps } from './AuthLayout'
import api from '@/lib/axios'

// How a new End User gets going. Other roles are assigned by an admin.
const JOIN_STEPS = [
  { title: 'Sign up',                 text: 'Give your name, your email and the office you file requests for.' },
  { title: 'Wait for approval',       text: 'An administrator checks your sign-up and emails you once you can sign in.' },
  { title: 'File your first request', text: 'Pick the quarter, add items from your office PPMP and send it to the TWG.' },
]

const EMPTY = { first_name: '', last_name: '', username: '', email: '', office: '', password: '', confirm: '', website: '', captcha: '' }

const ICON = 'absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-[--color-text-muted]'
const EYE  = 'absolute right-3.5 top-1/2 -translate-y-1/2 text-[--color-text-muted] transition-colors hover:text-[--color-text-primary]'

export default function Register() {
  const [form, setForm] = useState(EMPTY)
  const [show, setShow] = useState({ pw: false, confirm: false })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  // Email domains the server accepts for sign-up ([] = any), and the active offices.
  const [domains, setDomains] = useState([])
  const [offices, setOffices] = useState([])
  useEffect(() => {
    api.get('/auth/registration-info').then(r => {
      setDomains(r.data?.email_domains || [])
      setOffices(r.data?.offices || [])
    }).catch(() => {})
  }, [])
  const domainList = domains.map(d => '@' + d).join(' or ')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const onCaptcha = useCallback((token) => setForm(p => ({ ...p, captcha: token })), [])

  const pwLong    = form.password.length >= 8
  const pwMatch   = form.confirm.length > 0 && form.password === form.confirm
  const pwNoMatch = form.confirm.length > 0 && form.password !== form.confirm

  const submit = async (e) => {
    e.preventDefault()
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(form.username)) {
      toast.error('Username must be 3 to 30 letters, numbers, or underscores')
      return
    }
    if (domains.length && !domains.includes(form.email.split('@').pop().toLowerCase())) {
      toast.error(`Please sign up with an email address ending in ${domainList}`)
      return
    }
    if (!form.office)                   { toast.error('Pick your office'); return }
    if (form.password.length < 8)       { toast.error('Password must be at least 8 characters'); return }
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return }
    if (captchaEnabled && !form.captcha) { toast.error('Please complete the verification challenge'); return }
    setLoading(true)
    try {
      // No role is sent: every new account is its office's Fund Administrator, decided by the server.
      await api.post('/auth/register', {
        first_name:       form.first_name,
        last_name:        form.last_name,
        username:         form.username,
        email:            form.email,
        department_id:    Number(form.office),
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

  const panel = (
    <>
      <PanelIntro eyebrow="For End Users" title="Request for your office, and follow it to delivery.">
        Sign-up is for NEMSU faculty and staff who file purchase requests for their office.
      </PanelIntro>
      <PanelSteps steps={JOIN_STEPS} />
      <p className={`mt-10 max-w-md text-ui-sm text-white/45 ${ENTER}`} style={{ animationDelay: '800ms' }}>
        TWG, BAC, Procurement and Supply accounts are set up by the administrator.
      </p>
    </>
  )

  return (
    <AuthLayout panel={panel} wide switchText="Already have an account?" switchTo="/login" switchLabel="Sign in">
      <h1 className={`text-ui-3xl font-bold tracking-tight text-[--color-text-primary] ${ENTER}`}>Create your account</h1>
      <p className={`mt-2 text-ui-base text-[--color-text-secondary] ${ENTER}`} style={{ animationDelay: '60ms' }}>
        For faculty and staff who file purchase requests for their office.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-8">
        <section className={`space-y-4 ${ENTER}`} style={{ animationDelay: '120ms' }}>
          <p className="text-ui-xs font-semibold uppercase tracking-[0.12em] text-[--color-text-muted]">About you</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="first_name">First Name</Label>
              <Input
                id="first_name"
                type="text"
                placeholder="Juan"
                value={form.first_name}
                onChange={e => set('first_name', e.target.value)}
                required autoFocus maxLength={50}
                autoComplete="given-name"
              />
            </div>
            <div>
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

          <div>
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className={ICON} />
              <Input
                id="email"
                type="email"
                placeholder={`you@${domains[0] || 'nemsu.edu.ph'}`}
                value={form.email}
                onChange={e => set('email', e.target.value)}
                required maxLength={150}
                autoComplete="email"
                className="pl-10"
              />
            </div>
            <p className="mt-1.5 text-ui-xs text-[--color-text-muted]">
              {domains.length
                ? `Use an email address ending in ${domainList}. You will be emailed there once your account is approved.`
                : 'You will be emailed here once your account is approved'}
            </p>
          </div>

          <div>
            <Label htmlFor="office">Office</Label>
            <Select value={form.office} onValueChange={v => set('office', v)}>
              <SelectTrigger id="office" className="relative pl-10">
                <Building2 className={ICON} />
                <SelectValue placeholder="The office you handle" />
              </SelectTrigger>
              <SelectContent>
                {offices.map(o => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.code} - {o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className={`space-y-4 border-t border-[--color-border] pt-7 ${ENTER}`} style={{ animationDelay: '180ms' }}>
          <p className="text-ui-xs font-semibold uppercase tracking-[0.12em] text-[--color-text-muted]">Sign-in details</p>

          <div>
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <AtSign className={ICON} />
              <Input
                id="username"
                type="text"
                placeholder="juan_delacruz"
                value={form.username}
                onChange={e => set('username', e.target.value)}
                required maxLength={30}
                autoComplete="username"
                className="pl-10"
              />
            </div>
            <p className="mt-1.5 text-ui-xs text-[--color-text-muted]">3 to 30 letters, numbers, or underscores. You can sign in with it.</p>
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className={ICON} />
              <Input
                id="password"
                type={show.pw ? 'text' : 'password'}
                placeholder="At least 8 characters"
                value={form.password}
                onChange={e => set('password', e.target.value)}
                required minLength={8} maxLength={72}
                autoComplete="new-password"
                className="pl-10 pr-11"
              />
              <button type="button" tabIndex={-1} className={EYE}
                aria-label={show.pw ? 'Hide password' : 'Show password'}
                onClick={() => setShow(p => ({ ...p, pw: !p.pw }))}>
                {show.pw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className={`mt-1.5 flex items-center gap-1.5 text-ui-xs font-medium transition-colors duration-200 ${pwLong ? 'text-emerald-600' : 'text-[--color-text-muted]'}`}>
              {pwLong ? <CheckCircle className="size-3.5 shrink-0" /> : <Circle className="size-3.5 shrink-0" />}
              At least 8 characters
            </p>
          </div>

          <div>
            <Label htmlFor="confirm">Confirm Password</Label>
            <div className="relative">
              <Lock className={ICON} />
              <Input
                id="confirm"
                type={show.confirm ? 'text' : 'password'}
                placeholder="Re-enter your password"
                value={form.confirm}
                onChange={e => set('confirm', e.target.value)}
                required maxLength={72}
                autoComplete="new-password"
                className={`pl-10 pr-11 ${pwNoMatch ? 'border-red-400 focus:border-red-400 focus:ring-red-200' : pwMatch ? 'border-emerald-500 focus:border-emerald-500 focus:ring-emerald-200' : ''}`}
              />
              <button type="button" tabIndex={-1} className={EYE}
                aria-label={show.confirm ? 'Hide password' : 'Show password'}
                onClick={() => setShow(p => ({ ...p, confirm: !p.confirm }))}>
                {show.confirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {pwNoMatch && (
              <p className="mt-1.5 flex items-center gap-1.5 text-ui-xs font-medium text-red-600 motion-safe:animate-fade-in">
                <XCircle className="size-3.5 shrink-0" /> Passwords do not match
              </p>
            )}
            {pwMatch && (
              <p className="mt-1.5 flex items-center gap-1.5 text-ui-xs font-medium text-emerald-600 motion-safe:animate-fade-in">
                <CheckCircle className="size-3.5 shrink-0" /> Passwords match
              </p>
            )}
          </div>
        </section>

        {/* Honeypot: invisible to people and screen readers, so only a bot fills it in. */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto size-px overflow-hidden">
          <label htmlFor="website">Website</label>
          <input
            id="website" name="website" type="text" tabIndex={-1} autoComplete="off"
            value={form.website} onChange={e => set('website', e.target.value)}
          />
        </div>

        <div className={`space-y-4 ${ENTER}`} style={{ animationDelay: '240ms' }}>
          <CaptchaField key={captchaKey} onToken={onCaptcha} />

          <Button type="submit" size="lg" className="w-full" disabled={loading || pwNoMatch}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading ? 'Creating account' : 'Create account'}
          </Button>

          <div className="flex items-start gap-2.5 rounded-md border border-[--color-border-strong] bg-[--color-surface] px-4 py-3 text-ui-xs leading-snug text-[--color-text-secondary]">
            <Info className="mt-0.5 size-3.5 shrink-0 text-[--color-text-muted]" />
            <div className="space-y-1">
              <p>New accounts are End Users of the office picked. An administrator reviews each sign-up before it can sign in; other roles are assigned by the administrator.</p>
              <p>Accounts are for NEMSU faculty and staff. Students and outside partners can ask their adviser or the office concerned to file a request for them.</p>
            </div>
          </div>
        </div>
      </form>

      {/* Waiting for approval dialog */}
      <Dialog open={!!done} onOpenChange={(open) => { if (!open) setDone(null) }}>
        <DialogContent className="max-w-sm text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-50 border border-blue-300 mx-auto mb-1">
            <Clock className="size-7 text-blue-600" />
          </div>
          <h2 className="text-lg font-bold text-[--color-text-primary]">Waiting for approval</h2>
          {/* Same text for new and existing emails: the server reply is identical on purpose. */}
          <p className="text-sm text-[--color-text-secondary] leading-relaxed">
            An administrator will review your sign-up. We will email{' '}
            <strong className="text-[--color-text-primary] break-all">{done}</strong>{' '}
            once your account is approved, and then you can sign in.
          </p>
          <p className="text-xs text-[--color-text-secondary]">
            Already have an account?{' '}
            <Link to="/login" className="text-[--color-brand] font-medium hover:underline">Sign in</Link>
            , or{' '}
            <Link to="/forgot-password" className="text-[--color-brand] font-medium hover:underline">reset your password</Link>.
          </p>
          <Link
            to="/login"
            className="inline-block w-full rounded-lg bg-[--color-brand] text-white text-sm font-semibold py-2.5 hover:opacity-90 transition-opacity mt-1"
          >
            Back to sign in
          </Link>
        </DialogContent>
      </Dialog>
    </AuthLayout>
  )
}

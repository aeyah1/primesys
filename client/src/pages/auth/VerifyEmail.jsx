import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2, XCircle, Leaf } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'
import api from '@/lib/axios'

export default function VerifyEmail() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')
  const [state, setState] = useState('loading') // loading | error

  useEffect(() => {
    if (!token) { setState('error'); return }
    api.post('/auth/verify-email', { token })
      .then(() => {
        toast.success('Account verified! You can now sign in.', { duration: 4000 })
        setTimeout(() => navigate('/login', { replace: true }), 1500)
      })
      .catch(() => setState('error'))
  }, [token])

  return (
    <div className="min-h-screen flex flex-col justify-center bg-[--color-canvas] p-8">
      <div className="w-full max-w-sm mx-auto py-8 text-center space-y-5">

        <div className="flex size-10 items-center justify-center rounded-xl bg-[--color-brand] mx-auto">
          <Leaf className="size-5 text-emerald-200" />
        </div>

        {state === 'loading' && (
          <>
            <Loader2 className="size-8 animate-spin text-[--color-brand] mx-auto" />
            <p className="text-sm text-[--color-text-secondary]">Verifying your account…</p>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="flex size-14 items-center justify-center rounded-2xl bg-red-50 border border-red-200 mx-auto">
              <XCircle className="size-7 text-red-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[--color-text-primary]">Link expired or invalid</h2>
              <p className="text-sm text-[--color-text-secondary] mt-2 leading-relaxed">
                This link has already been used or has expired (24 hours).
                Go back and register again, or ask your administrator to verify your account.
              </p>
            </div>
            <Button variant="outline" asChild className="w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </>
        )}

      </div>
    </div>
  )
}

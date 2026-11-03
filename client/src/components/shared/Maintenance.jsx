import { Link } from 'react-router-dom'
import { Wrench, RefreshCw, LogOut, CalendarClock, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useMaintenance, whenOf, windowOf } from '@/hooks/useMaintenance'

/* While maintenance is on, everyone but an admin sees this page over the app (the server refuses them meanwhile).
   The page underneath stays as it was, so anything typed but not saved is still there when it lifts by itself. */
export function MaintenanceGate({ children }) {
  const { user, logout } = useAuth()
  const { maintenance, check, checking } = useMaintenance()
  const shut = maintenance?.state === 'on' && user?.role !== 'admin'
  return (
    <>
      {children}
      {shut && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="maintenance-title"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[--color-border] bg-[--color-surface] p-8 text-center shadow-lg">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[--color-brand-light]">
              <Wrench className="size-6 text-[--color-brand]" />
            </div>
            <h1 id="maintenance-title" className="mt-4 text-ui-xl font-bold text-[--color-text-primary]">PRimeSys is under maintenance</h1>
            <p className="mt-2 text-sm text-[--color-text-secondary]">
              {maintenance.end ? `It should be back by ${whenOf(maintenance.end)}.` : 'It will be back once the administrator finishes.'}
              {' '}Nothing can be saved meanwhile; anything you were typing stays on the page underneath, to save once it is back.
            </p>
            {maintenance.message && (
              <p className="mt-3 rounded-lg border border-[--color-border-strong] bg-[--color-canvas] px-3 py-2 text-sm text-[--color-text-primary]">{maintenance.message}</p>
            )}
            <p className="mt-3 text-xs text-[--color-text-muted]">This checks again every minute and closes by itself once PRimeSys is back.</p>
            <div className="mt-6 flex justify-center gap-2">
              <Button variant="outline" className="gap-1.5" onClick={() => logout()}><LogOut className="size-3.5" /> Sign out</Button>
              <Button className="gap-1.5" disabled={checking} onClick={() => check()} autoFocus>
                <RefreshCw className={`size-3.5 ${checking ? 'animate-spin' : ''}`} /> Check again
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* Above every page: maintenance coming up (everyone), or on (admins, who still work). */
export function MaintenanceBanner() {
  const { user } = useAuth()
  const { maintenance } = useMaintenance()
  if (maintenance?.state === 'scheduled') {
    return (
      <p role="status" className="flex items-start gap-2 border-b border-blue-300 bg-blue-50 px-4 py-2 text-xs text-blue-900 sm:px-6 lg:px-10">
        <CalendarClock className="mt-px size-3.5 shrink-0" />
        <span>
          <span className="font-semibold">Maintenance {windowOf(maintenance)}:</span> PRimeSys will be unavailable.
          {maintenance.message ? ` ${maintenance.message}` : ''} Save your work before then.
        </span>
      </p>
    )
  }
  if (maintenance?.state === 'on' && user?.role === 'admin') {
    return (
      <p role="status" className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-6 lg:px-10">
        <ShieldAlert className="mt-px size-3.5 shrink-0" />
        <span>
          <span className="font-semibold">Maintenance is on:</span> only admins can use PRimeSys{maintenance.end ? ` until ${whenOf(maintenance.end)}` : ''}.
          {' '}<Link to="/maintenance" className="font-semibold underline">Manage</Link>
        </span>
      </p>
    )
  }
  return null
}

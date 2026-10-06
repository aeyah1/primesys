import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import AppLayout from '@/components/layout/AppLayout'
import LandingPage from '@/pages/landing/LandingPage'
import Login from '@/pages/auth/Login'
import PageSkeleton from '@/components/shared/PageSkeleton'

// Lazy-loaded routes — split into separate chunks. The landing page and login
// stay eager because they're the most common cold-entry points.
const Register          = lazy(() => import('@/pages/auth/Register'))
const ForgotPassword    = lazy(() => import('@/pages/auth/ForgotPassword'))
const ResetPassword     = lazy(() => import('@/pages/auth/ResetPassword'))

// Signed-in pages are lazy too, and their code is preloaded once someone signs in.
const signedInPages = []
const page = (load) => { signedInPages.push(load); return lazy(load) }
const Dashboard         = page(() => import('@/pages/dashboard/Dashboard'))
const PRList            = page(() => import('@/pages/pr/PRList'))
const MyRequests        = page(() => import('@/pages/pr/MyRequests'))
const PRCreate          = page(() => import('@/pages/pr/PRUpload'))
const PRDetail          = page(() => import('@/pages/pr/PRDetail'))
const PREdit            = page(() => import('@/pages/pr/PREdit'))
const CanvassPage       = page(() => import('@/pages/pr/CanvassPage'))
const POList            = page(() => import('@/pages/po/POList'))
const DeliveryList      = page(() => import('@/pages/delivery/DeliveryList'))
const Bidding           = page(() => import('@/pages/bidding/Bidding'))
const ReportsPage       = page(() => import('@/pages/reports/ReportsPage'))
const UserList          = page(() => import('@/pages/users/UserList'))
const ArchivePage       = page(() => import('@/pages/archive/ArchivePage'))
const RemindersPage     = page(() => import('@/pages/reminders/RemindersPage'))
const NotificationsPage = page(() => import('@/pages/notifications/NotificationsPage'))
const SettingsPage      = page(() => import('@/pages/settings/Settings'))
const GuidePage         = page(() => import('@/pages/guide/GuidePage'))
const TwgReviewList     = page(() => import('@/pages/twg/TwgReviewList'))
const TwgReviewDetail   = page(() => import('@/pages/twg/TwgReviewDetail'))
const BacApprovals      = page(() => import('@/pages/bac/BacApprovals'))
const CertificatesPage  = page(() => import('@/pages/certificates/CertificatesPage'))
const PpmpList          = page(() => import('@/pages/ppmp/PpmpList'))
const PpmpDetail        = page(() => import('@/pages/ppmp/PpmpDetail'))
const PpmpEdit          = page(() => import('@/pages/ppmp/PpmpEdit'))

// Fetches every signed-in page's code while the browser is idle, so a first visit opens without a loading screen.
function usePreloadPages(signedIn) {
  useEffect(() => {
    if (!signedIn) return
    const preload = () => signedInPages.forEach((load) => load().catch(() => {}))
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 5000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(preload, 2000)
    return () => clearTimeout(id)
  }, [signedIn])
}

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()
  if (loading) return <PageSkeleton />
  if (!user)   return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />
  return children
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <PageSkeleton />
  if (user)    return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  const { user } = useAuth()
  usePreloadPages(Boolean(user))

  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/"         element={<LandingPage />} />
        <Route path="/login"           element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register"        element={<PublicRoute><Register /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
        <Route path="/reset-password"  element={<PublicRoute><ResetPassword /></PublicRoute>} />

        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="dashboard" element={<Dashboard />} />

          <Route path="pr"          element={<PRList />} />
          <Route path="my-requests" element={<ProtectedRoute roles={['requestor']}><MyRequests /></ProtectedRoute>} />
          <Route path="pr/create"  element={<ProtectedRoute roles={['procurement','admin','requestor']}><PRCreate /></ProtectedRoute>} />
          <Route path="pr/:id"     element={<PRDetail />} />
          <Route path="pr/:id/canvass" element={<ProtectedRoute roles={['procurement','admin','bac']}><CanvassPage /></ProtectedRoute>} />
          <Route path="pr/:id/edit" element={<ProtectedRoute roles={['procurement','admin','requestor']}><PREdit /></ProtectedRoute>} />

          <Route path="po"         element={<ProtectedRoute roles={['procurement','admin','supply','requestor']}><POList /></ProtectedRoute>} />
          <Route path="delivery"   element={<ProtectedRoute roles={['procurement','admin','supply']}><DeliveryList /></ProtectedRoute>} />
          <Route path="bidding"    element={<ProtectedRoute roles={['procurement','admin']}><Bidding /></ProtectedRoute>} />
          <Route path="archive"       element={<ArchivePage />} />
          <Route path="history"       element={<Navigate to="/archive" replace />} />
          <Route path="reminders"     element={<ProtectedRoute roles={['admin','procurement']}><RemindersPage /></ProtectedRoute>} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings"      element={<SettingsPage />} />
          <Route path="guide"         element={<GuidePage />} />
          <Route path="profile"       element={<Navigate to="/settings" replace />} />
          <Route path="reports"       element={<ProtectedRoute roles={['admin','procurement']}><ReportsPage /></ProtectedRoute>} />
          <Route path="users"         element={<ProtectedRoute roles={['admin']}><UserList /></ProtectedRoute>} />
          <Route path="quarters"      element={<Navigate to="/settings?tab=organization" replace />} />

          <Route path="twg/reviews"     element={<ProtectedRoute roles={['twg']}><TwgReviewList /></ProtectedRoute>} />
          <Route path="twg/reviews/:id" element={<ProtectedRoute roles={['twg']}><TwgReviewDetail /></ProtectedRoute>} />
          <Route path="bac"             element={<ProtectedRoute roles={['bac','admin','procurement']}><BacApprovals /></ProtectedRoute>} />
          <Route path="certificates"    element={<ProtectedRoute roles={['twg','bac','admin','procurement']}><CertificatesPage /></ProtectedRoute>} />
          <Route path="ppmp"            element={<ProtectedRoute roles={['requestor','admin','procurement','bac','twg']}><PpmpList /></ProtectedRoute>} />
          <Route path="ppmp/:id"        element={<ProtectedRoute roles={['requestor','admin','procurement','bac','twg']}><PpmpDetail /></ProtectedRoute>} />
          <Route path="ppmp/:id/edit"   element={<ProtectedRoute roles={['requestor']}><PpmpEdit /></ProtectedRoute>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

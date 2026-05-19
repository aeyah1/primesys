import { lazy, Suspense } from 'react'
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
const VerifyEmail       = lazy(() => import('@/pages/auth/VerifyEmail'))
const Dashboard         = lazy(() => import('@/pages/dashboard/Dashboard'))
const PRList            = lazy(() => import('@/pages/pr/PRList'))
const PRCreate          = lazy(() => import('@/pages/pr/PRUpload'))
const PRDetail          = lazy(() => import('@/pages/pr/PRDetail'))
const PREdit            = lazy(() => import('@/pages/pr/PREdit'))
const POList            = lazy(() => import('@/pages/po/POList'))
const DeliveryList      = lazy(() => import('@/pages/delivery/DeliveryList'))
const Bidding           = lazy(() => import('@/pages/bidding/Bidding'))
const ReportsPage       = lazy(() => import('@/pages/reports/ReportsPage'))
const UserList          = lazy(() => import('@/pages/users/UserList'))
const QuarterList       = lazy(() => import('@/pages/quarters/QuarterList'))
const HistoryPage       = lazy(() => import('@/pages/history/HistoryPage'))
const RemindersPage     = lazy(() => import('@/pages/reminders/RemindersPage'))
const NotificationsPage = lazy(() => import('@/pages/notifications/NotificationsPage'))
const SettingsPage      = lazy(() => import('@/pages/settings/Settings'))

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
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/"         element={<LandingPage />} />
        <Route path="/login"           element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register"        element={<PublicRoute><Register /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
        <Route path="/reset-password"  element={<PublicRoute><ResetPassword /></PublicRoute>} />
        <Route path="/verify-email"    element={<PublicRoute><VerifyEmail /></PublicRoute>} />

        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="dashboard" element={<Dashboard />} />

          <Route path="pr"          element={<PRList />} />
          <Route path="pr/create"  element={<ProtectedRoute roles={['procurement','admin','extension']}><PRCreate /></ProtectedRoute>} />
          <Route path="pr/:id"     element={<PRDetail />} />
          <Route path="pr/:id/edit" element={<ProtectedRoute roles={['procurement','admin','extension']}><PREdit /></ProtectedRoute>} />

          <Route path="po"         element={<ProtectedRoute roles={['procurement','admin','supply','extension']}><POList /></ProtectedRoute>} />
          <Route path="delivery"   element={<ProtectedRoute roles={['procurement','admin','supply','extension']}><DeliveryList /></ProtectedRoute>} />
          <Route path="bidding"    element={<ProtectedRoute roles={['procurement','admin','extension','supply']}><Bidding /></ProtectedRoute>} />
          <Route path="history"       element={<HistoryPage />} />
          <Route path="reminders"     element={<RemindersPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings"      element={<SettingsPage />} />
          <Route path="profile"       element={<Navigate to="/settings" replace />} />
          <Route path="reports"       element={<ProtectedRoute roles={['admin','procurement']}><ReportsPage /></ProtectedRoute>} />
          <Route path="users"         element={<ProtectedRoute roles={['admin']}><UserList /></ProtectedRoute>} />
          <Route path="quarters"      element={<ProtectedRoute roles={['admin']}><QuarterList /></ProtectedRoute>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

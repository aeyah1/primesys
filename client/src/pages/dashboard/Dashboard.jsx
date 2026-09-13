import { useAuth } from '@/context/AuthContext'
import AdminDashboard from './AdminDashboard'
import ProcurementDashboard from './ProcurementDashboard'
import RequestorDashboard from './RequestorDashboard'
import SupplyDashboard from './SupplyDashboard'
import TwgDashboard from '@/pages/twg/TwgDashboard'

export default function Dashboard() {
  const { user } = useAuth()
  if (user?.role === 'admin')     return <AdminDashboard />
  if (user?.role === 'requestor') return <RequestorDashboard />
  if (user?.role === 'supply')    return <SupplyDashboard />
  if (user?.role === 'twg')       return <TwgDashboard />
  return <ProcurementDashboard />
}

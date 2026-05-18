import { useAuth } from '@/context/AuthContext'
import AdminDashboard from './AdminDashboard'
import ProcurementDashboard from './ProcurementDashboard'
import ExtensionDashboard from './ExtensionDashboard'
import SupplyDashboard from './SupplyDashboard'

export default function Dashboard() {
  const { user } = useAuth()
  if (user?.role === 'admin')     return <AdminDashboard />
  if (user?.role === 'extension') return <ExtensionDashboard />
  if (user?.role === 'supply')    return <SupplyDashboard />
  return <ProcurementDashboard />
}

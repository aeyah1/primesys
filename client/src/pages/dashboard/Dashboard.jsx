import { useAuth } from '@/context/AuthContext'
import AdminDashboard from './AdminDashboard'
import RequestorDashboard from './RequestorDashboard'
import ProcurementDashboard from './ProcurementDashboard'
import BacDashboard from './BacDashboard'
import SupplyDashboard from './SupplyDashboard'
import TwgDashboard from '@/pages/twg/TwgDashboard'

// Every role's home is its dashboard; its to-do list has its own menu item (Sidebar menuFor).
const DASHBOARDS = {
  admin: AdminDashboard, requestor: RequestorDashboard, procurement: ProcurementDashboard,
  bac: BacDashboard, supply: SupplyDashboard, twg: TwgDashboard,
}

export default function Dashboard() {
  const { user } = useAuth()
  const Home = DASHBOARDS[user?.role] || RequestorDashboard
  return <Home />
}
